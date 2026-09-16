import type {MemberMention} from './member-mentions.ts';
import { randomUUID } from 'node:crypto';
import {validateBudget} from './collaboration-budget.ts';
import type {GroupStore} from './groups-store.ts';
import {DiscussionFlow} from './discussion-flow.ts';

type Row=Record<string,any>;
type StartTurn=(threadId:string,prompt:string,dispatchId:string,execution?:Row)=>Promise<Row>;
type WaitTurn=(threadId:string,turnId:string,timeoutMs:number)=>Promise<Row>;
interface Options{inspectTurn?(threadId:string,turnId:string):Promise<Row|null>;store:GroupStore;startTurn:StartTurn;waitTurn:WaitTurn;readTurnText(threadId:string,turnId:string):Promise<string>;readPastes?(refs:Row[]):Promise<string[]>;interruptTurn?(threadId:string,turnId:string):Promise<unknown>;isThreadActive(threadId:string):boolean;isWorkspaceBusy?(cwd:string,groupId:string,accessMode:string):boolean;notify?(event:unknown):void;lookupDispatch?(id:string):string|null;handoffFiles?(tasks:Row[]):Promise<Record<string,string>>}
const clipped=(value:any,max=12000)=>String(value||'').slice(-max);
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const TASK_OBJECTIVE_LIMIT=5000;
export const compactTaskObjective=(value:unknown,max=TASK_OBJECTIVE_LIMIT)=>{
  const text=String(value||'').trim();
  if(text.length<=max)return text;
  const marker='\n\n…（完整长资料将在派发时附带）…\n\n',room=max-marker.length,head=Math.ceil(room/2),tail=Math.floor(room/2);
  return text.slice(0,head).trimEnd()+marker+text.slice(-tail).trimStart();
};
export const directAssignments=(content:string,members:Row[],mentions:MemberMention[]=[])=>{
  const hits:Row[]=[];
  for(let index=0;index<content.length;index++){
    const selected=mentions.find(item=>item.start===index);if(selected){const member=members.find(member=>member.id===selected.id);if(!member)throw Error('指定成员已被移除');hits.push({token:content.slice(selected.start,selected.end),targets:[member],index});index=selected.end-1;continue;}
    if(content[index]!=='@'||(index>0&&/[\p{L}\p{N}_@]/u.test(content[index-1])))continue;
    const candidates=[...members.map(member=>({token:'@'+member.name,targets:[member]})),{token:'@all',targets:members},{token:'@everyone',targets:members}].sort((a,b)=>b.token.length-a.token.length);
    const hit=candidates.find(item=>content.slice(index,index+item.token.length).toLowerCase()===item.token.toLowerCase()&&!/[\p{L}\p{N}_-]/u.test(content[index+item.token.length]||''));
    if(hit){hits.push({...hit,index});index+=hit.token.length-1;}
  }
  if(!hits.length)return[];
  const strip=(text:string)=>text.replace(/^[\s:：,，、;-]+|[\s:：,，、;-]+$/g,'');
  const prefix=strip(content.slice(0,hits[0].index)),assigned=new Map<string,string[]>();
  let pending:Row[]=[];
  for(let i=0;i<hits.length;i++){
    pending.push(...hits[i].targets);
    const body=strip(content.slice(hits[i].index+hits[i].token.length,hits[i+1]?.index??content.length));
    if(!body&&i<hits.length-1)continue;
    const objective=[prefix,body].filter(Boolean).join('\n')||'请回复当前问题';
    for(const member of pending){const parts=assigned.get(member.id)||[];if(!parts.includes(objective))parts.push(objective);assigned.set(member.id,parts);}pending=[];
  }
  return [...assigned].map(([memberId,parts])=>{const objective=compactTaskObjective(parts.join('\n'));return{memberId,title:objective.slice(0,80),objective};});
};

const pastedFiles=(refs:Row[]=[],contents:string[]=[])=>contents.length?'\n\n粘贴文本文件：\n'+contents.map((text,index)=>`<pasted-file id="${refs[index]?.id||index}" name="Pasted Content ${refs[index]?.chars||[...text].length} chars.txt">\n${text}\n</pasted-file>`).join('\n\n'):'';
export function memberTaskPrompt(group:Row,req:Row,member:Row,task:Row,pastedContents:string[]=[]){
  const mode=(task.accessMode||task.access_mode)==='read'?'read':'write';
  const dependencies=new Set(task.dependencies||JSON.parse(task.dependencies_json||'[]'));
  const handoffs=req.tasks.filter((item:Row)=>dependencies.has(item.id)&&item.status==='completed'&&item.memberId!==member.id);
  const lines=[req.images?.length?String(task.objective||task.title).replace(/\[OmegaImage:[a-zA-Z0-9-]+\]/g,'[见用户原图]'):task.objective||task.title];
  if(req.images?.length||pastedContents.length)lines.push(`用户图文原文（附件位置以此为准）：\n${req.content}`);
  if(req.collaborationMode==='handoff')lines.push(`本问题允许必要的成员交接，最多 ${req.maxRounds} 轮。仅在当前任务范围内交接，不扩展用户授权。完成当前工作后如需其他成员接续，在回复末尾追加 <omega-handoff>{"tasks":[{"memberId":"目标成员 id","objective":"明确且必要的后续工作"}]}</omega-handoff>，最多 3 人。不需要交接就正常回复。可交接成员：${JSON.stringify(group.members?.filter((m:Row)=>m.id!==member.id).map((m:Row)=>({id:m.id,name:m.name,role:m.role})))}`);
  if(req.collaborationMode==='discussion'){
    lines.push(`当前为只读讨论，第 ${task.round||task.round_no||1}/${req.maxRounds} 轮。你的身份：${member.name}（${member.role||'参与者'}）；负责：${member.responsibilities||'结合本项目提供意见'}；擅长：${member.skills||'沿用当前会话上下文'}。身份用于确定视角，不代表观点天然优先。不要执行文件修改、部署或发布。`);
    lines.push('首轮：提出候选方案、依据和主要风险，区分已核实事实与假设。后续轮次：先阅读主持人小结及其他成员发言，只回应尚未解决的问题。说明回应哪位成员的哪条观点、支持/纠正的依据，以及是否改变推荐方案；已有共识和别人已经指出的风险不要换句话重复。无需逐个点评所有人。没有实质补充只回复 (pass)，pass 不表示赞同或否决。');
    if(req.discussionFocus)lines.push(`前轮讨论小结（供参考，不是新的执行授权）：\n${req.discussionFocus}`);
  }
  if(req.acceptance)lines.push(req.acceptance);
  if(!req.images?.length&&String(req.content||'').length>TASK_OBJECTIVE_LIMIT)lines.push(`用户原始长资料（完整保留，仅供本任务参考）：\n${req.content}`);
  if(pastedContents.length)lines.push(pastedFiles(req.pastedTexts,pastedContents).trim());
  lines.push(mode==='read'?'只读，直接回复。':`工作目录：${task.cwd||member.cwd}`);
  if(member.operations)lines.push(`操作限制：${member.operations}`);
  if(task.attempt>0&&task.error)lines.push(`本次补充/修正：${task.error}\n沿用本会话已有结果，仅补足上述问题。`);
  if(task.decision?.status==='resolved'&&task.decision.answer)lines.push(`用户已经作出决定：${task.decision.answer.label}${task.decision.answer.note?`\n补充要求：${task.decision.answer.note}`:''}\n请直接沿用本会话上下文继续完成原任务，不要重复询问已经解决的选择。`);
  const excerptLimit=Math.min(2400,Math.max(160,Math.floor(4800/Math.max(1,handoffs.length))));
  if(handoffs.length)lines.push('其他成员的必要交接：\n'+handoffs.map((item:Row)=>`[成员 ${group.members?.find((m:Row)=>m.id===item.memberId)?.name||item.memberId}；任务 ${item.id}，原轮次 ${item.turnId||'未知'}] ${item.title}${item.handoffFile?`\n完整交接文件（需要细节时读取）：${item.handoffFile}`:''}\n${clipped(item.result,excerptLimit)}${String(item.result||'').length>excerptLimit?'\n[仅展示结果末段，完整内容未丢弃]':''}`).join('\n\n'));
  lines.push('只有当任务确实无法继续、必须由用户在明确选项中作出决定时，才在正常说明后追加：<omega-decision>{"title":"简短决策标题","question":"需要用户决定的具体问题","options":[{"id":"option-1","label":"方案 1","description":"影响与取舍","recommended":true},{"id":"option-2","label":"方案 2","description":"影响与取舍"}],"allowOther":true}</omega-decision>。不要把普通确认、可自行判断的问题或任务完成后的建议写成决策请求。');
  return lines.join('\n\n');
}

function parseTagged(text:string,tag:string):Row{const candidates=[];const tagged=text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`,'i'));if(tagged)candidates.push(tagged[1]);for(const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))candidates.push(match[1]);const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)candidates.push(text.slice(first,last+1));for(const candidate of candidates)try{return JSON.parse(candidate);}catch{}throw new Error('没有返回可识别的 JSON');}
export function parseCoordinatorPlan(text:string){const value=parseTagged(text,'omega-plan');if(typeof value.summary!=='string'||!Array.isArray(value.tasks)||!value.tasks.length)throw new Error('协调者没有返回可识别的任务计划');return value;}
export function parseTaskReview(text:string){const value=parseTagged(text,'omega-review');if(!['pass','rework','blocked'].includes(value.decision)||typeof value.summary!=='string')throw new Error('协调者没有返回可识别的验证结论');return value;}
export function parseMemberDecision(text:string){
  const tagged=text.match(/<omega-decision>\s*([\s\S]*?)\s*<\/omega-decision>/i);if(!tagged)return null;
  let value:Row;try{value=JSON.parse(tagged[1]);}catch{throw new Error('成员返回的决策请求格式不正确');}
  const title=String(value.title||'需要你的决定').trim().slice(0,120),question=String(value.question||'').trim().slice(0,1000),raw=Array.isArray(value.options)?value.options:[];
  if(!question||raw.length<2||raw.length>5)throw new Error('成员返回的决策请求缺少问题或有效选项');
  const seen=new Set<string>(),options=raw.map((option:Row,index:number)=>{const id=String(option?.id||`option-${index+1}`).trim().slice(0,60),label=String(option?.label||'').trim().slice(0,160),description=String(option?.description||'').trim().slice(0,600);if(!id||!label||seen.has(id))throw new Error('成员返回的决策选项格式不正确');seen.add(id);return{id,label,description,recommended:option?.recommended===true};});
  return{title,question,options,allowOther:value.allowOther!==false};
}
export function stripMemberDecision(text:string){return text.replace(/\s*<omega-decision>[\s\S]*?<\/omega-decision>\s*/i,'').trim();}

export class GroupOrchestrator{
  readonly discussion=new DiscussionFlow(this);
  readonly store:GroupStore;readonly startTurn:StartTurn;readonly waitTurn:WaitTurn;readonly readTurnText:Options['readTurnText'];readonly readPastes:NonNullable<Options['readPastes']>;readonly isThreadActive:Options['isThreadActive'];readonly isWorkspaceBusy:NonNullable<Options['isWorkspaceBusy']>;readonly notify:NonNullable<Options['notify']>;
  readonly inspectTurn:Options['inspectTurn'];readonly interruptTurn:NonNullable<Options['interruptTurn']>;readonly handoffFiles:(tasks:Row[])=>Promise<Record<string,string>>;readonly lookupDispatch:(id:string)=>string|null;readonly runningTasks=new Set<string>();readonly coordinatorBusy=new Set<string>();readonly pumping=new Set<string>();readonly pendingPumps=new Set<string>();readonly suspendedGroups=new Set<string>();
  constructor({inspectTurn,store,startTurn,waitTurn,readTurnText,readPastes=async()=>[],interruptTurn=async()=>{},isThreadActive,isWorkspaceBusy=()=>false,notify=()=>{},lookupDispatch=()=>null,handoffFiles=async()=>({})}:Options){this.inspectTurn=inspectTurn;this.handoffFiles=handoffFiles;this.lookupDispatch=lookupDispatch;this.store=store;this.startTurn=startTurn;this.waitTurn=waitTurn;this.readTurnText=readTurnText;this.readPastes=readPastes;this.interruptTurn=interruptTurn;this.isThreadActive=isThreadActive;this.isWorkspaceBusy=isWorkspaceBusy;this.notify=notify;store.externalQueueReason=task=>this.isThreadActive(task.threadId)?'等待成员当前会话结束':this.isWorkspaceBusy(task.cwd,task.group_id,task.access_mode)?'等待工作目录空闲':null;}
  changed(groupId:string){this.notify({method:'omega/group-updated',params:{groupId}});}
  submit(groupId:string,input:Row){const budget=validateBudget(input);const mode=input.collaborationMode||'direct',rounds=input.maxRounds??(mode==='handoff'?10:3);if(!['direct','handoff','discussion'].includes(mode)||!Number.isInteger(rounds)||rounds<1||rounds>100)throw new Error('协作模式无效或轮次不在 1–100 范围内');const created=this.store.createRequirement(groupId,input),group=this.store.getGroup(groupId,created.requirement.id),direct=directAssignments(created.requirement.content,group.members,created.requirement.mentions);this.store.configureCollaboration(created.requirement.id,mode,rounds);this.store.configureBudget(created.requirement.id,budget);if(!direct.length&&mode==='discussion')direct.push(...group.members.map((m:Row)=>({memberId:m.id,title:created.requirement.content.slice(0,80),objective:compactTaskObjective(created.requirement.content)})));if(!direct.length&&created.requirement.replyTaskId){const previous=this.store.getTask(created.requirement.replyTaskId),member=group.members.find((m:Row)=>m.id===previous?.memberId);if(member)direct.push({memberId:member.id,title:created.requirement.content.slice(0,80),objective:compactTaskObjective(created.requirement.content)});}if(mode==='discussion')for(const task of direct)(task as Row).accessMode='read';if(direct.length){this.store.setDirectPlan(created.requirement.id,`直接发送给 ${direct.map(task=>group.members.find((member:Row)=>member.id===task.memberId)?.name).join('、')}`,direct);this.store.confirmPlan(groupId,created.requirement.id,true);}this.changed(groupId);this.schedule(groupId);return this.store.getGroup(groupId,created.requirement.id);}
  confirm(groupId:string,requirementId:string){const group=this.store.confirmPlan(groupId,requirementId);this.changed(groupId);this.schedule(groupId);return group;}
  async retry(groupId:string,requirementId:string){const owned=this.store.db.prepare("SELECT status FROM requirements WHERE id=? AND group_id=?").get(requirementId,groupId);if(!owned||owned.status!=='paused'||this.coordinatorBusy.has(groupId))throw Object.assign(Error('当前流程不需要重试或仍在处理中'),{status:409});if(this.discussion.prepareRetry(requirementId)){this.changed(groupId);this.schedule(groupId);return this.store.getGroup(groupId,requirementId);}const unknown=this.store.getRequirement(requirementId)?.tasks?.filter((task:Row)=>task.status==='unknown')||[];if(unknown.length){for(const task of unknown){const turnId=task.turnId||this.lookupDispatch(task.dispatchId);if(!turnId)throw Object.assign(new Error('派发结果未知，不能安全重发。请先打开成员会话核对，取消原问题后再决定是否重新提问。'),{status:409});this.store.setTaskTurn(task.id,turnId);this.store.db.prepare("UPDATE tasks SET recovery_checked_at=NULL WHERE id=?").run(task.id);if(this.store.reattachTask(task.id)){const member=this.store.getGroup(groupId).members.find((m:Row)=>m.id===task.memberId);this.runningTasks.add(task.id);void this.recoverTask({...task,turnId,threadId:member.threadId});}}return this.store.getGroup(groupId,requirementId);}const state=this.store.retry(groupId,requirementId);this.changed(groupId);this.schedule(groupId);return state.group;}
  requestChanges(groupId:string,requirementId:string,input:Row){const group=this.store.requestChanges(groupId,requirementId,input);this.changed(groupId);this.schedule(groupId);return group;}
  async resume(){
    const recoveries=[];
    for(const task of this.store.db.prepare("SELECT id,dispatch_id FROM tasks WHERE status='unknown' AND turn_id IS NULL").all()){const turnId=this.lookupDispatch(task.dispatch_id);if(turnId)this.store.setTaskTurn(task.id,turnId);}
    for(const task of this.store.recoverableTasks())if(this.store.reattachTask(task.id)){this.runningTasks.add(task.id);this.changed(task.groupId);recoveries.push(this.recoverTask(task));}
    for(const group of this.store.listGroups())if(group.openRequirementCount)this.schedule(group.id);
    await Promise.allSettled(recoveries);
  }
  async recoverTask(task:Row){
    try{
      const fallback=Number(task.limits?.taskTimeoutMinutes||45)*60000,deadline=Date.parse(task.deadlineAt||''),remaining=Number.isFinite(deadline)?deadline-Date.now():fallback;
      const observed=this.inspectTurn?await this.inspectTurn(task.threadId,task.turnId):null;
      if(this.inspectTurn&&!observed)throw new Error('找不到对应执行轮次');
      const settled=observed&&['completed','interrupted','failed'].includes(observed.status);
      if(!settled&&remaining<=0)throw new Error('任务已超过等待时限，原执行仍未确认结束，请核对或停止原执行');
      const completion=settled?observed:await this.waitTurn(task.threadId,task.turnId,remaining);
      if(this.store.getTask(task.id)?.status==='cancelled')return;
      if(['interrupted','failed'].includes(completion.status)){this.store.failTask(task.id,`执行状态为 ${completion.status}，可明确重试；已产生的文件修改不会回滚`,'failed');this.changed(task.groupId);return;}
      if(completion.status!=='completed')throw new Error(`执行状态为 ${completion.status||'未知'}`);
      const result=await this.readTurnText(task.threadId,task.turnId);
      if(!result.trim())throw new Error('成员没有返回可交接的结果');
      this.finishMemberTurn(task.id,result,task.turnId);this.store.resumeRequirementIfRecoverable(task.requirementId);this.changed(task.groupId);
    }catch(error){if(this.store.getTask(task.id)?.status==='cancelled')return;const detail=errorMessage(error),missing=/thread not found|missing source rollout|does not exist|找不到对应执行轮次/i.test(detail);this.store.failTask(task.id,missing?'成员会话或执行轮次已无法恢复，请编辑成员关联或手动重试':detail,missing?'failed':'unknown');this.changed(task.groupId);}
    finally{this.runningTasks.delete(task.id);this.schedule(task.groupId);}
  }
  finishMemberTurn(taskId:string,result:string,turnId:string){const task=this.store.getTask(taskId);if(task?.status!=='running')return;if(task.turnId&&task.turnId!==turnId)return;const decision=parseMemberDecision(result);if(decision){this.store.recordTaskDecision(taskId,stripMemberDecision(result),turnId,decision);return;}const req=this.store.getRequirement(task.requirementId),tag=result.match(/<omega-handoff>\s*([\s\S]*?)\s*<\/omega-handoff>/i);let handoffs:Row[]=[];if(req.collaborationMode==='handoff'&&tag){const parsed=JSON.parse(tag[1]);if(!Array.isArray(parsed.tasks)||parsed.tasks.length>3)throw new Error('交接请求必须包含不超过 3 个目标');handoffs=parsed.tasks;}const text=result.replace(/\s*<omega-handoff>[\s\S]*?<\/omega-handoff>\s*/gi,'').trim();this.store.finishCollaboration(taskId,text||'工作已交接。',turnId,handoffs);}
  schedule(groupId:string){if(this.suspendedGroups.has(groupId))return;this.pendingPumps.add(groupId);queueMicrotask(()=>this.pump(groupId).catch(error=>console.error('[omega scheduler]',error)));}
  suspend(groupId:string){this.suspendedGroups.add(groupId);this.pendingPumps.delete(groupId);}
  unsuspend(groupId:string){this.suspendedGroups.delete(groupId);this.schedule(groupId);}
  forget(groupId:string){this.suspendedGroups.delete(groupId);this.pendingPumps.delete(groupId);this.coordinatorBusy.delete(groupId);this.pumping.delete(groupId);}
  async pump(groupId:string){if(this.suspendedGroups.has(groupId)||this.pumping.has(groupId))return;this.pumping.add(groupId);try{do{this.pendingPumps.delete(groupId);if(this.suspendedGroups.has(groupId))return;const group=this.store.getGroup(groupId);if(!this.coordinatorBusy.has(groupId)&&!this.isThreadActive(group.coordinatorThreadId)){const review=this.store.nextReview(groupId),plan=this.store.nextPlan(groupId),finalizable=this.store.nextFinalizable(groupId),discussion=this.discussion.next(groupId);const operation=discussion?()=>this.discussion.run(groupId,discussion.id,discussion.round):review?()=>this.reviewTask(groupId,review.requirement_id,review.id):plan?()=>this.draftPlan(groupId,plan.id):finalizable?()=>this.finalize(groupId,finalizable.id):null;if(operation){this.coordinatorBusy.add(groupId);operation().catch(error=>this.handleCoordinatorError(groupId,discussion?.id||review?.requirement_id||plan?.id||finalizable?.id,error)).finally(()=>{this.coordinatorBusy.delete(groupId);this.schedule(groupId);});}}
        for(const req of this.store.db.prepare("SELECT id FROM requirements WHERE group_id=? AND status='running'").all(groupId))this.store.enforceBudget(req.id);const fresh=this.store.getGroup(groupId);let slots=Math.max(0,fresh.limits.maxConcurrency-this.store.runningCount(groupId));while(slots){const task=this.store.runnableTasks(groupId).find(item=>!this.runningTasks.has(item.id)&&!this.isThreadActive(item.thread_id)&&!this.isWorkspaceBusy(item.cwd,groupId,item.access_mode));if(!task)break;this.dispatchTask(groupId,task).catch(error=>console.error('[omega task]',error));slots--;}
      }while(this.pendingPumps.has(groupId));}finally{this.pumping.delete(groupId);if(this.pendingPumps.has(groupId))this.schedule(groupId);}}
  handleCoordinatorError(groupId:string,requirementId:string,error:unknown){if(this.store.getRequirement(requirementId)?.status==='cancelled')return;this.store.failPhase(requirementId,errorMessage(error));this.changed(groupId);}
  async startAndRead(threadId:string,prompt:string,dispatchId:string,timeoutMs:number,imageIds:string[]=[]){const started=await this.startTurn(threadId,prompt,dispatchId,{imageIds}),turnId=started.turn?.id;if(!turnId)throw new Error('没有返回执行轮次');const completion=await this.waitTurn(threadId,turnId,timeoutMs);if(completion.status!=='completed')throw new Error(`执行状态为 ${completion.status||'未知'}`);const text=await this.readTurnText(threadId,turnId);if(!text.trim())throw new Error('没有返回可交接的结果');return{turnId,text};}
  async draftPlan(groupId:string,requirementId:string){
    const req=this.store.getRequirement(requirementId);if(!req||req.status!=='plan_drafting')return;
    if(req.replyTaskId){
      const previous=this.store.getTask(req.replyTaskId),member=this.store.getGroup(groupId).members.find((m:Row)=>m.id===previous?.memberId);
      if(!member)throw new Error('原回答成员已移出群组，请重新提问');
      this.store.setPlan(requirementId,`交给 ${member.name} 继续处理`,[{memberId:member.id,title:req.content.slice(0,80),objective:compactTaskObjective(req.content),accessMode:'write'}],null,'');
      this.store.confirmPlan(groupId,requirementId,true);this.changed(groupId);return;
    }
    const group=this.store.getGroup(groupId,requirementId),roster=group.members.map((m:Row)=>({id:m.id,name:m.name,role:m.role,responsibilities:m.responsibilities,project:m.projectName})),pasteContents=await this.readPastes(req.pastedTexts||[]);
    const prompt=`请分发用户问题，返回任务计划。成员会话已有项目上下文。\n用户原话：${req.content}${pastedFiles(req.pastedTexts,pasteContents)}\n用户补充要求：${req.acceptance||'无'}\n成员：${JSON.stringify(roster,null,2)}\n只选择负责人：一个问题交给一位对应成员；多个问题按负责人拆分，同一成员的问题合并。objective 直接摘录用户对应问题，保留日期、范围、字数等原始要求，不扩写、不添加调查步骤、背景、验收要求或审核/汇总任务。只有用户明确的先后依赖才填写 dependsOn（前面任务的零基索引），否则 []。最多 ${group.limits.maxTasks} 项。accessMode 纯查询为 read，涉及修改或不确定为 write。\n返回：<omega-plan>{"summary":"一句话分配说明","tasks":[{"memberId":"成员 id","title":"简短标题","objective":"用户问题原话","accessMode":"read 或 write","dependsOn":[]}]}</omega-plan>`;
    const {turnId,text}=await this.startAndRead(group.coordinatorThreadId,prompt,`group-plan:${requirementId}:${randomUUID()}`,group.limits.taskTimeoutMinutes*60000,(req.images||[]).map((image:Row)=>image.id));
    if(this.store.getRequirement(requirementId)?.status!=='plan_drafting')return;
    const plan=parseCoordinatorPlan(text);const tasks=plan.tasks.map((t:Row)=>({...t,objective:compactTaskObjective(t.objective||req.content),acceptance:''}));
    this.store.setPlan(requirementId,plan.summary,tasks,turnId,text);this.store.confirmPlan(groupId,requirementId,true);this.changed(groupId);
  }
  async dispatchTask(groupId:string,raw:Row){this.runningTasks.add(raw.id);let submitted=false;try{if(this.store.getTask(raw.id)?.status!=='queued')return;const dispatchId=`group-task:${raw.id}:${raw.attempt+1}:${randomUUID()}`,initial=this.store.getGroup(groupId,raw.requirement_id),timeoutMs=initial.limits.taskTimeoutMinutes*60000;this.store.startTask(raw.id,dispatchId,null,timeoutMs);this.changed(groupId);const group=this.store.getGroup(groupId,raw.requirement_id),req=group.requirement,member=group.members.find((item:Row)=>item.id===raw.member_id);if(!req||!member)throw new Error('需求或任务成员已不存在');req.discussionFocus=this.store.db.prepare("SELECT report_json FROM discussion_reports WHERE requirement_id=? AND status='completed' ORDER BY round_no DESC LIMIT 1").get(req.id)?.report_json;const dependencyIds=new Set(this.store.getTask(raw.id)?.dependencies||[]),files=await this.handoffFiles(req.tasks.filter((t:Row)=>dependencyIds.has(t.id)&&t.memberId!==member.id&&t.status==='completed'));for(const t of req.tasks)t.handoffFile=files[t.id];const mode=raw.access_mode==='read'?'read':'write',context=await this.prepareTopicContext(raw.id),prompt=[memberTaskPrompt(group,req,member,this.store.getTask(raw.id)||raw,await this.readPastes(req.pastedTexts||[])),context.text].filter(Boolean).join('\n\n');if(this.store.getTask(raw.id)?.status!=='running')return;submitted=true;const started=await this.startTurn(member.threadId,prompt,dispatchId,{cwd:member.cwd,accessMode:mode,imageIds:(req.images||[]).map((image:Row)=>image.id)}),turnId=started.turn?.id;if(!turnId)throw new Error('成员任务没有返回执行轮次');this.store.setTaskTurn(raw.id,turnId);this.store.ackTopicContext(raw.id,context.cursor);this.changed(groupId);if(this.store.getTask(raw.id)?.status==='cancelled'){await this.interruptTurn(member.threadId,turnId).catch(()=>{});return;}const completion=await this.waitTurn(member.threadId,turnId,timeoutMs);if(this.store.getTask(raw.id)?.status==='cancelled')return;if(completion.status!=='completed')throw new Error(`执行状态为 ${completion.status||'未知'}`);const result=await this.readTurnText(member.threadId,turnId);if(!result.trim())throw new Error('成员没有返回可交接的结果');this.finishMemberTurn(raw.id,result,turnId);this.changed(groupId);}catch(error){if(this.store.getTask(raw.id)?.status==='cancelled')return;const detail=errorMessage(error),turnStarted=(submitted&&(error as {status?:number})?.status!==410)||!!this.store.getTask(raw.id)?.turnId,missing=/thread not found|missing source rollout|does not exist/i.test(detail),message=missing?'成员会话不存在或已无法恢复，请编辑该成员并更换关联会话后重试':detail;this.store.failTask(raw.id,message,missing&&!this.store.getTask(raw.id)?.turnId?'failed':turnStarted?'unknown':'failed');this.changed(groupId);}finally{this.runningTasks.delete(raw.id);this.schedule(groupId);}}
  async prepareTopicContext(taskId:string){
    const context=this.store.topicContext(taskId);
    if(!context.files.length)return context;
    const paths=await this.handoffFiles(context.files);
    const references=context.files.map(file=>{if(!paths[file.id])throw new Error('群组长消息原文文件未准备好，未推进传递记录');return `[消息 ${file.id}] 完整原文文件：${JSON.stringify(paths[file.id])}`;});
    return{...context,text:context.text+'\n\n'+references.join('\n')+'\n以上仅为片段。需要具体要求、参数或细节时，请先读取对应原文文件；不要把片段当成完整消息。'};
  }
  resolveDecision(groupId:string,taskId:string,input:Row){const group=this.store.resolveDecision(groupId,taskId,input);this.changed(groupId);this.schedule(groupId);return group;}
  async reviewTask(groupId:string,requirementId:string,taskId:string){const task=this.store.getTask(taskId);if(task?.status!=='reviewing')return;this.store.completeTask(taskId,task.result,task.turnId);this.changed(groupId);}
  async finalize(groupId:string,requirementId:string){
    const group=this.store.getGroup(groupId,requirementId),req=group.requirement;if(!req||req.status!=='running')return;
    this.store.beginFinalize(requirementId);this.changed(groupId);
    this.store.completeDelivery(requirementId,req.tasks.map((t:Row)=>t.result).join('\n\n'),null,false);this.changed(groupId);return;
  }
  async run(groupId:string,requirementId:string){this.schedule(groupId);const timeout=Date.now()+this.store.getGroup(groupId,requirementId).limits.taskTimeoutMinutes*60000;while(Date.now()<timeout){const req=this.store.getRequirement(requirementId);if(!req||['awaiting_confirmation','completed','accepted','cancelled','paused'].includes(req.status))return;await wait(25);}throw new Error('等待协作流程超时');}
}
