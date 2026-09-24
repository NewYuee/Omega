import {createAttachments} from './attachments.js';
import { createGroupRoom } from './group-room.js';
import type {PastedTextTransport} from './pasted-content.js';
import type {RichPastePayload} from './RichPasteEditor.js';

const statusLabels={idle:'空闲',planning:'正在分配',plan_drafting:'正在分配',awaiting_confirmation:'等待回复',running:'回复中',finalizing:'正在整理回复',awaiting_acceptance:'已回复',paused:'需要处理',accepted:'已回复',cancelled:'已取消',draft:'准备中',queued:'排队中',reviewing:'回复中',completed:'已回复',failed:'失败',unknown:'待核对'};
type Mode='chats'|'groups';
interface GroupOptions{getKey():string;api(route:string,data?:any):Promise<any>;rpc(method:string,params?:Record<string,unknown>,extra?:Record<string,unknown>):Promise<any>;pastedText:PastedTextTransport;error(message:string):void;closeDrawer():void;openThread(id:string):any;getWorkspace():string;onModeChange?(mode:Mode):void;openDialog(name:string,props:any):Promise<any>;markRead?(scope:string,id:string):Promise<any>}
const label=(value?:string)=>(statusLabels as Record<string,string>)[value||'']||value||'未知';
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);

export function initGroups({getKey,api,rpc,pastedText,error,closeDrawer,openThread,getWorkspace,onModeChange,openDialog,markRead}:GroupOptions){
  let mode:Mode='chats',groupId=sessionStorage.getItem('omega-group')||null,requirementId=sessionStorage.getItem('omega-requirement')||null,current:any=null,loading=false,acting=false;
  let listedGroups:any[]=[];
  const unreadGroups=new Set<string>();
  const unreadGroupCounts=new Map<string,number>();
  const withUnread=(group:any)=>({...group,unread:unreadGroups.has(group.id),unreadCount:unreadGroupCounts.get(group.id)||0});
  let replyTo:any=null,sending=false,refreshTimer:ReturnType<typeof setTimeout>|null=null,refreshAgain=false;
  const imageUploads=createAttachments({getKey,isLocked:()=>sending,onChange:()=>renderGroupComposer(),onError:error});
  const room=createGroupRoom({loadImage:imageUploads.loadImage,api,act,openThread,error,onSelect:(id:string)=>{requirementId=id;},onReply:(target:any)=>{replyTo=target;renderGroupComposer();window.omegaReactGroupComposer?.focus();},onBudget:openBudget,onDecision:openDecision,onCancel:cancelRequirement});
  function renderGroupComposer(){window.omegaReactGroupComposer?.render({scope:groupId||'',attachments:imageUploads.records,attachmentsReady:imageUploads.ready,members:current?.members||[],sending,enabled:!!groupId&&!!current?.members?.length,replyTo},{addFiles:(files:File[])=>imageUploads.ingest(files),removeImage:(key:string)=>imageUploads.removeKey(key),submit:sendGroupMessage,cancelReply:()=>{replyTo=null;renderGroupComposer();},openFeishuNotify:async(text='')=>{const sent=await(window.omegaFeishuNotify?.open(text)??Promise.reject(Error('飞书通知界面尚未就绪')));if(sent&&replyTo){replyTo=null;renderGroupComposer()}return sent},report:(message:string)=>error(message),...pastedText});}
  async function sendGroupMessage(message:RichPastePayload){
    const content=message.text;if(sending||!groupId||!content.trim())return false;
    const targetGroup=groupId,targetReply=replyTo;sending=true;error('');renderGroupComposer();
    try{const result=await api('groups',{view:'room',action:'submit',groupId:targetGroup,content:content.trim(),pasteIds:message.pasteIds,mentions:message.mentions,imageIds:imageUploads.ids,collaborationMode:message.collaborationMode,maxRounds:message.maxRounds,maxMinutes:message.maxMinutes,maxTokens:message.maxTokens,replyTaskId:targetReply?.taskId});if(groupId===targetGroup){current=result.group;if(replyTo===targetReply)replyTo=null;imageUploads.clear();render();return true;}return false;}
    catch(cause){error(`发送失败：${errorMessage(cause)}`);return false;}
    finally{sending=false;renderGroupComposer();}
  }
  async function openBudget(target:any){await openDialog('budget',{requirement:target,onSubmit:async(values:Record<string,unknown>)=>{const ok=await act({action:'setBudget',requirementId:target.id,maxRounds:Number(values.maxRounds),maxMinutes:Number(values.maxMinutes),maxTokens:Number(values.maxTokens)},'调整预算');if(!ok)throw Error('预算未更新')}});}
  async function openDecision(target:any){if(!target?.decision||acting)return;await openDialog('decision',{memberName:target.memberName,decision:target.decision,onSubmit:async(values:Record<string,unknown>)=>{const ok=await act({action:'resolveDecision',taskId:target.taskId,requirementId:target.requirementId,...values,decisionId:target.decision.id},'提交决定');if(!ok)throw Error('决定没有提交，请重试')}});}
  async function cancelRequirement(target:any){if(acting||!groupId||!target?.id)return;acting=true;error('');renderGroupHeader();try{const response=await api('groups',{view:'room',action:'cancel',groupId,requirementId:target.id});current=response.group;requirementId=target.id;sessionStorage.setItem('omega-requirement',target.id);render();await list();window.omegaReactGroupComposer?.refill({text:target.content,pastedTexts:target.pastedTexts||[],mentions:target.mentions||[]});}catch(cause){error(`取消发送失败：${errorMessage(cause)}`);}finally{acting=false;renderGroupHeader();}}
  window.addEventListener('omega:react-group-composer-ready',renderGroupComposer);
  function renderGroupHeader(group:any=current){const layout=window.omegaReactGroupPanels?.getLayout()||{mobile:false,membersOpen:true,questionsOpen:true};window.omegaAppState?.patch({groupTitle:group?.name||'创建你的第一个协作群组',groupHeader:group?{status:group.status,statusLabel:label(group.status),description:group.description||'群组会话',availability:group.runningTasks?`${group.runningTasks} 位成员正在回复`:`${group.members.length} 位成员可用`,maxConcurrency:group.limits.maxConcurrency,...layout,disabled:acting,actions:{toggleMembers:()=>window.omegaReactGroupPanels?.toggle('members'),toggleQuestions:()=>window.omegaReactGroupPanels?.toggle('tasks'),setConcurrency:(value:number)=>act({action:'setConcurrency',maxConcurrency:value,requirementId},'调整并发数'),addMember:openMember,deleteGroup:deleteCurrentGroup}}:null});}

  function switchMode(next:Mode){
    mode=next;
    window.omegaAppState?.patch({mode:next});
    if(next==='groups')refresh().catch(cause=>error(errorMessage(cause)));
    onModeChange?.(next);
  }

  async function list(){
    const result=await api('groups');listedGroups=result.groups;
    window.omegaReactWorkspace?.renderGroups(result.groups.map(withUnread),groupId,{open:select,status:label});
    if(!groupId&&result.groups[0])groupId=result.groups[0].id;
    return result.groups;
  }

  async function refresh(){
    if(mode!=='groups')return;if(loading){refreshAgain=true;return;}loading=true;
    try{
      const groups=await list();
      if(groupId&&!groups.some((group:any)=>group.id===groupId))groupId=groups[0]?.id||null;
      if(!groupId){current=null;renderEmpty();return;}
      const params=new URLSearchParams({view:'room'});if(requirementId)params.set('requirementId',requirementId);
      if(current?.id===groupId&&current.messageKeys)params.set('known',current.messageKeys.join(','));
      const targetGroup=groupId;const response=await api('groups/'+encodeURIComponent(targetGroup)+'?'+params);if(groupId!==targetGroup){refreshAgain=true;return;}
      if(response.messageIds){const cache=new Map<string,any>([...(current?.id===groupId?current.messages:[])||[],...response.group.messages].map((message:any)=>[message.id,message]));response.group.messages=response.messageIds.map((id:string)=>cache.get(id)).filter(Boolean);response.group.messageKeys=response.messageKeys;}
      current=response.group;
      if(!current.requirement&&requirementId){requirementId=null;sessionStorage.removeItem('omega-requirement');current=(await api('groups/'+encodeURIComponent(groupId)+'?view=room')).group;}render();
      if(unreadGroups.has(groupId)&&!document.hidden){unreadGroups.delete(groupId);unreadGroupCounts.delete(groupId);await markRead?.('group',groupId);}
    }finally{loading=false;if(refreshAgain){refreshAgain=false;setTimeout(()=>refresh().catch(cause=>error(errorMessage(cause))),150);}}
  }

  async function select(id:string){const anchor=sessionStorage.getItem('omega-group-unread:'+id);groupId=id;requirementId=anchor;sessionStorage.setItem('omega-group',id);if(anchor)sessionStorage.setItem('omega-requirement',anchor);else sessionStorage.removeItem('omega-requirement');closeDrawer();await refresh();sessionStorage.removeItem('omega-group-unread:'+id);if(anchor)await room.focus(anchor);}

  function renderEmpty(){
    renderGroupHeader(null);window.omegaReactGroupPanels?.renderMembers({members:[],busy:new Set(),removable:false,summary:'协调者会持续整理目标、约束和进度。',active:false},{edit:()=>{},open:()=>{},remove:()=>{}});room.clear();renderGroupComposer();
  }

  function render(){
    const group=current,req=group.requirement;renderGroupHeader(group);
    const busy=new Set<string>(group.requirements?.flatMap((requirement:any)=>requirement.tasks||[]).filter((task:any)=>task.status==='running').map((task:any)=>task.memberId));window.omegaReactGroupPanels?.renderMembers({members:group.members,coordinatorThreadId:group.coordinatorThreadId,coordinatorThreadName:group.coordinatorThreadName,coordinatorOwned:group.coordinatorOwned,busy,removable:!req||['completed','accepted','cancelled'].includes(req.status),summary:(req&&['running','queued','plan_drafting','finalizing'].includes(req.status)?req.plan?.summary:null)||group.memorySummary||group.summary||'协调者会持续整理目标、约束和进度。',active:true,groupId:group.id},{edit:openMemberEdit,editCoordinator:openCoordinatorEdit,open:openThread,remove:(memberId:string)=>act({action:'removeMember',memberId},'移出成员'),memoryList:(before?:string)=>api('group-memory?'+new URLSearchParams({groupId:group.id,...(before?{before}:{})})),memoryGet:(id:string)=>api('group-memory?'+new URLSearchParams({groupId:group.id,id})),memoryHistory:(id:string)=>api('group-memory?'+new URLSearchParams({groupId:group.id,id,history:'1'})),memorySave:(entry:any)=>api('group-memory',{groupId:group.id,...entry})});
    room.render(group);renderGroupComposer();
  }

  window.addEventListener('omega:react-workspace-ready',()=>{if(listedGroups.length)window.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});});
  window.addEventListener('omega:react-group-panels-ready',()=>{if(current){render();room.render(current);}});

  async function act(input:Record<string,unknown>,labelText:string){
    if(acting||!groupId)return;acting=true;error('');renderGroupHeader();
    try{current=(await api('groups',{view:'room',...input,groupId})).group;if(current.requirement){requirementId=current.requirement.id;sessionStorage.setItem('omega-requirement',current.requirement.id);}render();await list();return true;}
    catch(cause){error(`${labelText}失败：${errorMessage(cause)}`);return false;}finally{acting=false;renderGroupHeader();}
  }

  async function deleteCurrentGroup(){
    if(acting||!current)return;
    if(!confirm(`删除群组“${current.name}”？\n\n群组需求、任务和协作记录会被删除，${current.coordinatorOwned?'Omega 专用协调者会话也会删除；':'你指定的协调者会话会保留；'}成员会话和项目文件会保留。`))return;
    acting=true;error('');renderGroupHeader();
    try{await api('groups',{view:'room',action:'deleteGroup',groupId:current.id});groupId=null;requirementId=null;current=null;sessionStorage.removeItem('omega-group');sessionStorage.removeItem('omega-requirement');await refresh();}
    catch(cause){error(`删除群组失败：${errorMessage(cause)}`);}
    finally{acting=false;renderGroupHeader();}
  }

  async function openMember(){
    if(!current)return;const result=await rpc('thread/list',{limit:100,sourceKinds:[]}),bound=new Set<string>(current.members.map((member:any)=>member.threadId));
    const available=result.data.filter((thread:any)=>!thread.omegaBinding&&thread.id!==current.coordinatorThreadId&&!bound.has(thread.id));
    if(!available.length)return error('没有可添加的会话；请先新建会话，或该会话已属于其他群组。');
    const initial=available[0],project=(initial.cwd||'').split('/').filter(Boolean).at(-1)||'';
    await openDialog('member',{editing:false,member:{threadId:initial.id,name:initial.name||initial.preview||'',role:'',avatar:'preset:developer',projectName:project,cwd:initial.cwd||'',responsibilities:'',operations:'',skills:''},threads:available,onSubmit:(values:Record<string,unknown>)=>act({action:'addMember',...values,requirementId:current?.requirement?.id},'添加成员').then(ok=>{if(!ok)throw Error('添加成员失败')})});
  }

  async function openMemberEdit(member:any){if(!current)return;try{const result=await rpc('thread/list',{limit:100,sourceKinds:[]}),bound=new Set<string>(current.members.filter((item:any)=>item.id!==member.id).map((item:any)=>item.threadId)),available=result.data.filter((thread:any)=>(thread.id===member.threadId||!thread.omegaBinding)&&thread.id!==current.coordinatorThreadId&&!bound.has(thread.id));if(!available.some((thread:any)=>thread.id===member.threadId))available.unshift({id:member.threadId,name:'当前会话不可用',cwd:member.cwd});await openDialog('member',{editing:true,member,threads:available,onSubmit:(values:Record<string,unknown>)=>act({action:'updateMember',memberId:member.id,requirementId:current?.requirement?.id,...values},'修改成员').then(ok=>{if(!ok)throw Error('修改成员失败')})});}catch(cause){error(`读取可用会话失败：${errorMessage(cause)}`);}}

  async function openCoordinatorEdit(){
    if(!current)return;
    try{
      const expectedThreadId=current.coordinatorThreadId,result=await rpc('thread/list',{limit:100,sourceKinds:[]}),members=new Set(current.members.map((member:any)=>member.threadId));
      const available=result.data.filter((thread:any)=>thread.id===expectedThreadId||(!thread.omegaBinding&&!members.has(thread.id)));
      if(!available.some((thread:any)=>thread.id===expectedThreadId))available.unshift({id:expectedThreadId,name:current.coordinatorThreadName||'当前协调者会话'});
      await openDialog('coordinator',{threadId:expectedThreadId,threads:available,onSubmit:(values:Record<string,unknown>)=>act({action:'setCoordinator',expectedThreadId,threadId:values.threadId,requirementId:current?.requirement?.id},'指定协调者').then(ok=>{if(!ok)throw Error('协调者未更新')})});
    }catch(cause){error(`读取协调者候选会话失败：${errorMessage(cause)}`);}
  }

  const newGroup=()=>openDialog('createGroup',{cwd:getWorkspace(),onSubmit:async(values:Record<string,unknown>)=>{const response=await api('groups',{view:'room',action:'create',...values});current=response.group;groupId=current.id;sessionStorage.setItem('omega-group',current.id);render();await list();}}).catch(cause=>error(errorMessage(cause)));
  return {switchMode,newGroup,refresh,applyReadState:(state:any)=>{unreadGroups.clear();unreadGroupCounts.clear();for(const id of state?.unread?.groups||[]){unreadGroups.add(id);unreadGroupCounts.set(id,state?.counts?.groups?.[id]||1);}if(listedGroups.length)window.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});},onReadState:(params:any)=>{if(params.scope==='group'){unreadGroups.delete(params.id);unreadGroupCounts.delete(params.id);if(listedGroups.length)window.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});}},onUnread:(params:any)=>{if(params.scope==='group'){unreadGroups.add(params.id);unreadGroupCounts.set(params.id,params.count||1);if(listedGroups.length)window.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});}},onGroupUpdated:(id:string)=>{if(mode==='groups'&&(!groupId||id===groupId)&&!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=null;refresh().catch(cause=>error(errorMessage(cause)));},200);},onGroupDeleted:(id:string)=>{unreadGroups.delete(id);unreadGroupCounts.delete(id);if(id===groupId){groupId=null;requirementId=null;current=null;sessionStorage.removeItem('omega-group');sessionStorage.removeItem('omega-requirement');}if(mode==='groups')setTimeout(()=>refresh().catch(cause=>error(errorMessage(cause))),loading?120:0);},isGroupMode:()=>mode==='groups'};
}
