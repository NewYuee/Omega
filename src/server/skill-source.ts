import type {GroupMemoryStore} from './group-memory.ts';
import {findTurn} from './turn-lookup.ts';

type Row=Record<string,any>;
type Rpc={request(method:string,params:Row):Promise<Row>};
const MAX_TURNS=8,MAX_TEXT=60000;
const tooLong=()=>Object.assign(Error('所选任务过程超过 60000 字，第一版不会截断后冒充完整来源；请缩小轮次范围'),{status:413});
const append=(parts:string[],value:string,size:{value:number})=>{size.value+=value.length;if(size.value>MAX_TEXT)throw tooLong();parts.push(value)};
export type SkillSource={scope:'thread'|'group';targetId:string;ids:string[];labels:string[];text:string;omissions:string[]};

export async function threadSourceOptions(rpc:Rpc,threadId:string,cursor:string|null=null){
  if(!threadId)throw Error('请选择会话');
  const result=await rpc.request('thread/turns/list',{threadId,cursor,limit:60,sortDirection:'desc',itemsView:'summary'});
  return{items:(result.data||[]).map((turn:Row)=>({id:turn.id,status:turn.status,label:String((turn.items||[]).find((item:Row)=>item.type==='userMessage')?.content?.map((part:Row)=>part.text||'').join(' ')||turn.id).slice(0,120)})),nextCursor:result.nextCursor||null};
}

async function orderedTurns(rpc:Rpc,threadId:string,ids:string[]){
  if(!threadId||!Array.isArray(ids)||!ids.length||ids.length>MAX_TURNS||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('请选择 1–8 个连续轮次');
  const all:Row[]=[],seen=new Set<string>();let cursor:string|null=null;
  for(let page=0;page<20;page++){
    const listed=await rpc.request('thread/turns/list',{threadId,cursor,limit:60,sortDirection:'desc',itemsView:'summary'});
    all.push(...(listed.data||[]));if(ids.every(id=>all.some(item=>item.id===id)))break;
    if(!listed.nextCursor||seen.has(listed.nextCursor))throw Error('所选轮次未能完整读取，请刷新会话历史');
    seen.add(listed.nextCursor);cursor=listed.nextCursor;
  }
  const positions=ids.map(id=>all.findIndex(item=>item.id===id));if(positions.some(index=>index<0))throw Error('所选轮次超出可读取范围');
  const selected=all.slice(Math.min(...positions),Math.max(...positions)+1);
  if(selected.length!==ids.length||selected.some(turn=>!ids.includes(turn.id))||selected.some(turn=>turn.status!=='completed'))throw Error('仅能提炼连续且已完成的轮次');
  return selected.reverse();
}

async function turnItems(rpc:Rpc,threadId:string,turnId:string){
  const pages:Row[][]=[],seen=new Set<string>();let cursor:string|null=null;
  for(let page=0;page<20;page++){
    let result:Row;
    try{result=await rpc.request('thread/items/list',{threadId,turnId,cursor,limit:200,sortDirection:'desc'});}
    catch(error){if(!/thread\/items\/list.*(?:not supported|unsupported)|(?:not supported|unsupported method|method not found|not implemented).*thread\/items\/list/i.test(error instanceof Error?error.message:String(error)))throw error;const fallback=await findTurn(rpc,threadId,turnId);if(!fallback?.items?.length)throw Error('旧版轮次没有可读取的完整消息');return{items:fallback.items,legacy:true};}
    pages.push((result.data||[]).map((entry:Row)=>entry.item||entry));
    if(!result.nextCursor)return{items:pages.reverse().flatMap(items=>items.reverse()),legacy:false};
    if(seen.has(result.nextCursor))throw Error('会话条目分页异常，不能生成不完整 Skill');
    seen.add(result.nextCursor);cursor=result.nextCursor;
  }
  throw Error('会话条目过多，不能生成不完整 Skill');
}

export async function collectThreadSkillSource(rpc:Rpc,threadId:string,ids:string[]):Promise<SkillSource>{
  const turns=await orderedTurns(rpc,threadId,ids),parts:string[]=[],labels:string[]=[],omissions:string[]=[],size={value:0};
  for(const turn of turns){const loaded=await turnItems(rpc,threadId,turn.id),items=loaded.items;let label='';if(loaded.legacy)omissions.push(`${turn.id}：旧版会话使用完整轮次回退读取，请人工核对条目是否齐全`);append(parts,`\n## 轮次 ${turn.id}\n`,size);
    for(const item of items){
      if(item.type==='userMessage'){
        const content=(item.content||[]).map((part:Row)=>typeof part.text==='string'?part.text:'').join('\n');
        if((item.content||[]).some((part:Row)=>part.type!=='text'||typeof part.text!=='string'))omissions.push(`${turn.id}：用户消息含非文本附件`);
        label||=content.trim().slice(0,120)||turn.id;append(parts,`用户 [${item.id}]：${content}\n`,size);
      }else if(item.type==='agentMessage')append(parts,`助手 [${item.id}]：${item.text||''}\n`,size);
      else if(item.type==='commandExecution')append(parts,`命令记录 [${item.id}]：${item.command||''}\n${item.aggregatedOutput||''}\n`,size);
      else if(item.type==='fileChange')append(parts,`文件变更记录 [${item.id}]：${JSON.stringify(item.changes||item)}\n`,size);
      else if(!['reasoning','plan'].includes(item.type))omissions.push(`${turn.id}：未纳入 ${item.type||'未知'} 条目`);
    }
    labels.push(label||turn.id);
  }
  if(!parts.some(part=>part.startsWith('助手 [')))throw Error('所选轮次没有可提炼的会话回复');
  return{scope:'thread',targetId:threadId,ids:turns.map(turn=>turn.id),labels,text:parts.join(''),omissions:[...new Set(omissions)]};
}

export function collectGroupSkillSource(memory:GroupMemoryStore,groupId:string,requirementId:string):SkillSource{
  const entry=memory.get(groupId,requirementId),detail=entry.detail as Row,parts:string[]=[],size={value:0};
  append(parts,`群组问题：${detail.question||''}\n验收：${detail.acceptance||''}\n`,size);
  for(const item of detail.messages||[]){if(item.reference?.type==='progress'||item.reference?.type==='delivery'||item.reference?.type==='discussion-summary')continue;append(parts,`群组消息 [${item.id}] ${item.author||item.kind}：${item.content||''}\n`,size);}
  for(const task of detail.tasks||[])append(parts,`成员 ${task.member||task.memberId} · 第 ${task.round||1} 轮\n目标：${task.objective||''}\n结果：${task.result||''}\n`,size);
  for(const report of detail.reports||[])append(parts,`第 ${report.round} 轮主持人报告：${JSON.stringify(report.report)}\n`,size);
  append(parts,`最终交付：${detail.delivery||''}\n`,size);
  if(!detail.tasks?.length&&!detail.reports?.length)throw Error('群组档案没有可提炼的成员回复或讨论报告');
  return{scope:'group',targetId:groupId,ids:[requirementId],labels:[entry.title],text:parts.join(''),omissions:[]};
}
