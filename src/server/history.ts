export const PAGE_SIZE=12000;
export const TURN_PAGE_SIZE=60;
export const ITEM_PAGE_SIZE=200;
interface ContentPart{text?:string}
export interface HistoryItem{id?:string;type?:string;status?:string;text?:string;command?:string;aggregatedOutput?:string;content?:ContentPart[]}
interface Turn{id:string;status?:string;items?:HistoryItem[];itemsView?:string;startedAt?:number|null;completedAt?:number|null;durationMs?:number|null}
interface Thread{id:string;name?:string;preview?:string;cwd?:string;turns?:Turn[]}
interface PageInput{turnId?:string;itemId?:string;offset?:number;cursor?:string;selectionOnly?:boolean;outlineOnly?:boolean}
interface Attachment{id:string;expiresAt:number}
interface RpcClient{request(method:string,params:Record<string,unknown>):Promise<any>}
export function textOf(item:HistoryItem){if(item.type==='userMessage')return(item.content||[]).map(value=>value.text||'[附件]').join('\n');if(item.type==='agentMessage')return item.text||'';if(item.type==='commandExecution')return'$ '+(item.command||'')+'\n'+(item.aggregatedOutput||'');return JSON.stringify(item,null,2);}
export function historyPage(thread:Thread,input:PageInput={},attachments:(item:HistoryItem,turn:Turn)=>Attachment[]=()=>[]){const turns=thread.turns||[],index=input.turnId?turns.findIndex(turn=>turn.id===input.turnId):turns.length-1,turn=turns[index],offset=Math.max(0,Math.floor(Number(input.offset)||0));const mapped=(turn?.items||[]).map(item=>{const chat=['userMessage','agentMessage'].includes(item.type||''),full=textOf(item),start=input.itemId===item.id?offset:0;return{id:item.id,type:item.type,status:item.status,images:item.type==='userMessage'?attachments(item,turn):[],pageText:chat||input.itemId===item.id?full.slice(start,start+PAGE_SIZE):'',totalLength:full.length,offset:start,deferred:!chat&&input.itemId!==item.id};});return{thread:{id:thread.id,name:thread.name,preview:thread.preview?.slice(0,100),cwd:thread.cwd},outline:turns.map((entry,index)=>({id:entry.id,label:textOf((entry.items||[]).find(item=>item.type==='userMessage')||{}).slice(0,70)||'会话记录',index})),turn:turn?{id:turn.id,status:turn.status,startedAt:turn.startedAt,completedAt:turn.completedAt,durationMs:turn.durationMs,items:input.itemId?mapped.filter(item=>item.id===input.itemId):mapped}:null};}

/** Read a bounded history window using the App Server pagination APIs. */
export async function paginatedHistoryPage(
  rpc:RpcClient,
  thread:Thread,
  input:PageInput={},
  attachments:(item:HistoryItem,turn:Turn)=>Attachment[]=()=>[],
){
  if(input.selectionOnly&&input.turnId){
    const detail=await readTurnItems(rpc,thread.id,input.turnId);
    const page:any=historyPage({...thread,turns:[detail.turn]},input,attachments);
    page.outline=null;
    page.itemsTruncated=detail.truncated;
    return page;
  }
  const listed=await rpc.request('thread/turns/list',{threadId:thread.id,cursor:input.cursor||null,limit:TURN_PAGE_SIZE,sortDirection:'desc',itemsView:'summary'});
  const turns:Turn[]=[...(listed.data||[])].reverse();
  if(input.outlineOnly){
    const page:any=historyPage({...thread,turns},input,attachments);
    page.turn=null;
    page.nextCursor=listed.nextCursor||null;
    return page;
  }
  const selectedId=input.turnId||turns.at(-1)?.id;
  if(selectedId){
    const summary=turns.find(turn=>turn.id===selectedId);
    const detail=await readTurnItems(rpc,thread.id,selectedId,summary);
    const index=turns.findIndex(turn=>turn.id===selectedId);
    if(index>=0)turns[index]=detail.turn;
    const page:any=historyPage({...thread,turns},{...input,turnId:selectedId},attachments);
    page.itemsTruncated=detail.truncated;
    page.nextCursor=listed.nextCursor||null;
    return page;
  }
  const page:any=historyPage({...thread,turns},input,attachments);
  page.nextCursor=listed.nextCursor||null;
  return page;
}

async function readTurnItems(rpc:RpcClient,threadId:string,turnId:string,summary?:Turn){
  const listed=await rpc.request('thread/items/list',{threadId,turnId,cursor:null,limit:ITEM_PAGE_SIZE,sortDirection:'desc'});
  const recent:HistoryItem[]=(listed.data||[]).map((entry:any)=>entry.item).reverse();
  const firstUser=(summary?.items||[]).find(item=>item.type==='userMessage');
  if(firstUser&&!recent.some(item=>item.id===firstUser.id))recent.unshift(firstUser);
  return{turn:{id:turnId,status:summary?.status,startedAt:summary?.startedAt,completedAt:summary?.completedAt,durationMs:summary?.durationMs,items:recent,itemsView:'full'},truncated:Boolean(listed.nextCursor)};
}
