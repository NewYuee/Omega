import { randomUUID } from 'node:crypto';
import type {GroupStore} from './groups-store.ts';

type Row=Record<string,any>;
type StartTurn=(threadId:string,prompt:string,dispatchId:string,execution?:Row)=>Promise<Row>;
type WaitTurn=(threadId:string,turnId:string,timeoutMs:number)=>Promise<Row>;
interface Options{store:GroupStore;startTurn:StartTurn;waitTurn:WaitTurn;readTurnText(threadId:string,turnId:string):Promise<string>;isThreadActive(threadId:string):boolean;isWorkspaceBusy?(cwd:string,groupId:string,accessMode:string):boolean;notify?(event:unknown):void}
const clipped=(value:any,max=12000)=>String(value||'').slice(-max);
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const directAssignments=(content:string,members:Row[])=>{
  const hits=members.flatMap(member=>{const token='@'+member.name,result=[];let from=0,index;while((index=content.indexOf(token,from))>=0){result.push({index,member,token});from=index+token.length;}return result;}).sort((a,b)=>a.index-b.index||b.token.length-a.token.length).filter((hit,index,all)=>!index||hit.index!==all[index-1].index);
  if(!hits.length)return[];
  return hits.map((hit,index)=>{const end=hits[index+1]?.index??content.length,objective=content.slice(hit.index+hit.token.length,end).replace(/^[\s:：,，、-]+/,'').trim()||content.replace(hit.token,'').trim();return{memberId:hit.member.id,title:objective.slice(0,80)||content.slice(0,80),objective,accessMode:undefined};});
};

export function memberTaskPrompt(group:Row,req:Row,member:Row,task:Row){
  const mode=task.access_mode==='read'?'read':'write';
  const dependencies=new Set(JSON.parse(task.dependencies_json||'[]'));
  const handoffs=req.tasks.filter((item:Row)=>dependencies.has(item.id)&&item.status==='completed'&&item.memberId!==member.id);
  const lines=[task.objective||task.title];
  if(req.acceptance)lines.push(req.acceptance);
  lines.push(mode==='read'?'只读，直接回复。':`工作目录：${task.cwd||member.cwd}`);
  if(member.operations)lines.push(`操作限制：${member.operations}`);
  if(task.attempt>0&&task.error)lines.push(`本次补充/修正：${task.error}\n沿用本会话已有结果，仅补足上述问题。`);
  if(handoffs.length)lines.push('其他成员的必要交接：\n'+handoffs.map((item:Row)=>`${item.title}\n${clipped(item.result,8000)}`).join('\n\n'));
  return lines.join('\n\n');
}

function parseTagged(text:string,tag:string):Row{const candidates=[];const tagged=text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`,'i'));if(tagged)candidates.push(tagged[1]);for(const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))candidates.push(match[1]);const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)candidates.push(text.slice(first,last+1));for(const candidate of candidates)try{return JSON.parse(candidate);}catch{}throw new Error('没有返回可识别的 JSON');}
export function parseCoordinatorPlan(text:string){const value=parseTagged(text,'omega-plan');if(typeof value.summary!=='string'||!Array.isArray(value.tasks)||!value.tasks.length)throw new Error('协调者没有返回可识别的任务计划');return value;}
export function parseTaskReview(text:string){const value=parseTagged(text,'omega-review');if(!['pass','rework','blocked'].includes(value.decision)||typeof value.summary!=='string')throw new Error('协调者没有返回可识别的验证结论');return value;}

export class GroupOrchestrator{
  readonly store:GroupStore;readonly startTurn:StartTurn;readonly waitTurn:WaitTurn;readonly readTurnText:Options['readTurnText'];readonly isThreadActive:Options['isThreadActive'];readonly isWorkspaceBusy:NonNullable<Options['isWorkspaceBusy']>;readonly notify:NonNullable<Options['notify']>;
  readonly runningTasks=new Set<string>();readonly coordinatorBusy=new Set<string>();readonly pumping=new Set<string>();readonly pendingPumps=new Set<string>();readonly suspendedGroups=new Set<string>();
  constructor({store,startTurn,waitTurn,readTurnText,isThreadActive,isWorkspaceBusy=()=>false,notify=()=>{}}:Options){this.store=store;this.startTurn=startTurn;this.waitTurn=waitTurn;this.readTurnText=readTurnText;this.isThreadActive=isThreadActive;this.isWorkspaceBusy=isWorkspaceBusy;this.notify=notify;}
  changed(groupId:string){this.notify({method:'omega/group-updated',params:{groupId}});}
  submit(groupId:string,input:Row){const created=this.store.createRequirement(groupId,input),group=this.store.getGroup(groupId,created.requirement.id),direct=directAssignments(created.requirement.content,group.members);if(direct.length){this.store.setDirectPlan(created.requirement.id,`直接发送给 ${direct.map(task=>group.members.find((member:Row)=>member.id===task.memberId)?.name).join('、')}`,direct);this.store.confirmPlan(groupId,created.requirement.id,true);}this.changed(groupId);this.schedule(groupId);return this.store.getGroup(groupId,created.requirement.id);}
  confirm(groupId:string,requirementId:string){const group=this.store.confirmPlan(groupId,requirementId);this.changed(groupId);this.schedule(groupId);return group;}
  retry(groupId:string,requirementId:string){const state=this.store.retry(groupId,requirementId);this.changed(groupId);this.schedule(groupId);return state.group;}
  requestChanges(groupId:string,requirementId:string,input:Row){const group=this.store.requestChanges(groupId,requirementId,input);this.changed(groupId);this.schedule(groupId);return group;}
  resume(){for(const group of this.store.listGroups())if(group.openRequirementCount)this.schedule(group.id);}
  schedule(groupId:string){if(this.suspendedGroups.has(groupId))return;this.pendingPumps.add(groupId);queueMicrotask(()=>this.pump(groupId).catch(error=>console.error('[omega scheduler]',error)));}
  suspend(groupId:string){this.suspendedGroups.add(groupId);this.pendingPumps.delete(groupId);}
  unsuspend(groupId:string){this.suspendedGroups.delete(groupId);this.schedule(groupId);}
  forget(groupId:string){this.suspendedGroups.delete(groupId);this.pendingPumps.delete(groupId);this.coordinatorBusy.delete(groupId);this.pumping.delete(groupId);}
  async pump(groupId:string){if(this.suspendedGroups.has(groupId)||this.pumping.has(groupId))return;this.pumping.add(groupId);try{do{this.pendingPumps.delete(groupId);if(this.suspendedGroups.has(groupId))return;const group=this.store.getGroup(groupId);if(!this.coordinatorBusy.has(groupId)&&!this.isThreadActive(group.coordinatorThreadId)){const review=this.store.nextReview(groupId),plan=this.store.nextPlan(groupId),finalizable=this.store.nextFinalizable(groupId);const operation=review?()=>this.reviewTask(groupId,review.requirement_id,review.id):plan?()=>this.draftPlan(groupId,plan.id):finalizable?()=>this.finalize(groupId,finalizable.id):null;if(operation){this.coordinatorBusy.add(groupId);operation().catch(error=>this.handleCoordinatorError(groupId,review?.requirement_id||plan?.id||finalizable?.id,error)).finally(()=>{this.coordinatorBusy.delete(groupId);this.schedule(groupId);});}}
        const fresh=this.store.getGroup(groupId);let slots=Math.max(0,fresh.limits.maxConcurrency-this.store.runningCount(groupId));while(slots){const task=this.store.runnableTasks(groupId).find(item=>!this.runningTasks.has(item.id)&&!this.isThreadActive(item.thread_id)&&!this.isWorkspaceBusy(item.cwd,groupId,item.access_mode));if(!task)break;this.dispatchTask(groupId,task).catch(error=>console.error('[omega task]',error));slots--;}
      }while(this.pendingPumps.has(groupId));}finally{this.pumping.delete(groupId);if(this.pendingPumps.has(groupId))this.schedule(groupId);}}
  handleCoordinatorError(groupId:string,requirementId:string,error:unknown){this.store.failPhase(requirementId,errorMessage(error));this.changed(groupId);}
  async startAndRead(threadId:string,prompt:string,dispatchId:string,timeoutMs:number){const started=await this.startTurn(threadId,prompt,dispatchId),turnId=started.turn?.id;if(!turnId)throw new Error('没有返回执行轮次');const completion=await this.waitTurn(threadId,turnId,timeoutMs);if(completion.status!=='completed')throw new Error(`执行状态为 ${completion.status||'未知'}`);const text=await this.readTurnText(threadId,turnId);if(!text.trim())throw new Error('没有返回可交接的结果');return{turnId,text};}
  async draftPlan(groupId:string,requirementId:string){
    const req=this.store.getRequirement(requirementId);if(!req||req.status!=='plan_drafting')return;
    if(req.replyTaskId){
      const previous=this.store.getTask(req.replyTaskId),member=this.store.getGroup(groupId).members.find((m:Row)=>m.id===previous?.memberId);
      if(!member)throw new Error('原回答成员已移出群组，请重新提问');
      this.store.setPlan(requirementId,`交给 ${member.name} 继续处理`,[{memberId:member.id,title:req.content.slice(0,80),objective:req.content,accessMode:'write'}],null,'');
      this.store.confirmPlan(groupId,requirementId,true);this.changed(groupId);return;
    }
    const group=this.store.getGroup(groupId,requirementId),roster=group.members.map((m:Row)=>({id:m.id,name:m.name,role:m.role,responsibilities:m.responsibilities,project:m.projectName}));
    const prompt=`请分发用户问题，返回任务计划。成员会话已有项目上下文。\n用户原话：${req.content}\n用户补充要求：${req.acceptance||'无'}\n成员：${JSON.stringify(roster,null,2)}\n只选择负责人：一个问题交给一位对应成员；多个问题按负责人拆分，同一成员的问题合并。objective 直接摘录用户对应问题，保留日期、范围、字数等原始要求，不扩写、不添加调查步骤、背景、验收要求或审核/汇总任务。只有用户明确的先后依赖才填写 dependsOn（前面任务的零基索引），否则 []。最多 ${group.limits.maxTasks} 项。accessMode 纯查询为 read，涉及修改或不确定为 write。\n返回：<omega-plan>{"summary":"一句话分配说明","tasks":[{"memberId":"成员 id","title":"简短标题","objective":"用户问题原话","accessMode":"read 或 write","dependsOn":[]}]}</omega-plan>`;
    const {turnId,text}=await this.startAndRead(group.coordinatorThreadId,prompt,`group-plan:${requirementId}:${randomUUID()}`,group.limits.taskTimeoutMinutes*60000);
    const plan=parseCoordinatorPlan(text);const tasks=plan.tasks.map((t:Row)=>({...t,objective:plan.tasks.length===1?req.content:t.objective,acceptance:''}));
    this.store.setPlan(requirementId,plan.summary,tasks,turnId,text);this.store.confirmPlan(groupId,requirementId,true);this.changed(groupId);
  }
  async dispatchTask(groupId:string,raw:Row){this.runningTasks.add(raw.id);const dispatchId=`group-task:${raw.id}:${raw.attempt+1}:${randomUUID()}`;this.store.startTask(raw.id,dispatchId,null);this.changed(groupId);try{const group=this.store.getGroup(groupId,raw.requirement_id),req=group.requirement,member=group.members.find((item:Row)=>item.id===raw.member_id);if(!req||!member)throw new Error('需求或任务成员已不存在');const mode=raw.access_mode==='read'?'read':'write',prompt=memberTaskPrompt(group,req,member,raw);const started=await this.startTurn(member.threadId,prompt,dispatchId,{cwd:member.cwd,accessMode:mode}),turnId=started.turn?.id;if(!turnId)throw new Error('成员任务没有返回执行轮次');this.store.setTaskTurn(raw.id,turnId);this.changed(groupId);const completion=await this.waitTurn(member.threadId,turnId,group.limits.taskTimeoutMinutes*60000);if(completion.status!=='completed')throw new Error(`执行状态为 ${completion.status||'未知'}`);const result=await this.readTurnText(member.threadId,turnId);if(!result.trim())throw new Error('成员没有返回可交接的结果');this.store.completeTask(raw.id,result,turnId);this.changed(groupId);}catch(error){const detail=errorMessage(error),turnStarted=!!this.store.getTask(raw.id)?.turnId,missing=/thread not found|missing source rollout|does not exist/i.test(detail),message=missing?'成员会话不存在或已无法恢复，请编辑该成员并更换关联会话后重试':detail;this.store.failTask(raw.id,message,turnStarted?'unknown':'failed');this.changed(groupId);}finally{this.runningTasks.delete(raw.id);this.schedule(groupId);}}
  async reviewTask(groupId:string,requirementId:string,taskId:string){const task=this.store.getTask(taskId);if(task?.status!=='reviewing')return;this.store.completeTask(taskId,task.result,task.turnId);this.changed(groupId);}
  async finalize(groupId:string,requirementId:string){
    const group=this.store.getGroup(groupId,requirementId),req=group.requirement;if(!req||req.status!=='running')return;
    this.store.beginFinalize(requirementId);this.changed(groupId);
    this.store.completeDelivery(requirementId,req.tasks.map((t:Row)=>t.result).join('\n\n'),null,false);this.changed(groupId);return;
  }
  async run(groupId:string,requirementId:string){this.schedule(groupId);const timeout=Date.now()+this.store.getGroup(groupId,requirementId).limits.taskTimeoutMinutes*60000;while(Date.now()<timeout){const req=this.store.getRequirement(requirementId);if(!req||['awaiting_confirmation','completed','accepted','cancelled','paused'].includes(req.status))return;await wait(25);}throw new Error('等待协作流程超时');}
}
