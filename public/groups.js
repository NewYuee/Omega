import { createGroupRoom } from './group-room.js';

const $=id=>document.getElementById(id);
const statusLabels={idle:'空闲',planning:'正在分配',plan_drafting:'正在分配',awaiting_confirmation:'等待回复',running:'回复中',finalizing:'正在整理回复',awaiting_acceptance:'已回复',paused:'需要处理',accepted:'已回复',cancelled:'已取消',draft:'准备中',queued:'排队中',reviewing:'回复中',completed:'已回复',failed:'失败',unknown:'待核对'};
const label=value=>statusLabels[value]||value||'未知';
const button=(text,action,className='')=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.className=className;node.onclick=action;return node;};
const text=(tag,value,className='')=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};

export function initGroups({api,rpc,error,closeDrawer,openThread,getWorkspace,onModeChange,reactForm,markRead}){
  let mode='chats',groupId=sessionStorage.getItem('omega-group')||null,requirementId=sessionStorage.getItem('omega-requirement')||null,current=null,loading=false,acting=false;
  let listedGroups=[];
  const unreadGroups=new Set();
  const unreadGroupCounts=new Map();
  const withUnread=group=>({...group,unread:unreadGroups.has(group.id),unreadCount:unreadGroupCounts.get(group.id)||0});
  let replyTo=null,sending=false,refreshTimer=null,refreshAgain=false;
  const room=createGroupRoom({api,act,openThread,error,onSelect:id=>{requirementId=id;},onReply:target=>{replyTo=target;renderGroupComposer();globalThis.omegaReactGroupComposer?.focus();}});
  function renderGroupComposer(){globalThis.omegaReactGroupComposer?.render({members:current?.members||[],sending,enabled:!!groupId&&!!current?.members?.length,replyTo},{submit:sendGroupMessage,cancelReply:()=>{replyTo=null;renderGroupComposer();},report:message=>error(message)});}
  async function sendGroupMessage(content){
    if(sending||!groupId||!content.trim())return false;
    const targetGroup=groupId,targetReply=replyTo;sending=true;error('');renderGroupComposer();
    try{const result=await api('groups',{action:'submit',groupId:targetGroup,content:content.trim(),replyTaskId:targetReply?.taskId});if(groupId===targetGroup){current=result.group;if(replyTo===targetReply)replyTo=null;render();return true;}return false;}
    catch(e){error(`发送失败：${e.message}`);return false;}
    finally{sending=false;renderGroupComposer();}
  }
  window.addEventListener('omega:react-group-composer-ready',renderGroupComposer);
  const queue=document.createElement('div');queue.className='requirement-queue';
  const groupView=$('group-view'),memberPanelToggle=button('',()=>setPanelCollapsed('members',!groupView.classList.contains('members-collapsed')),'panel-toggle member-panel-toggle'),taskPanelToggle=button('',()=>setPanelCollapsed('tasks',!groupView.classList.contains('tasks-collapsed')),'panel-toggle task-panel-toggle');
  const queueLabel=text('label','需求队列');const queueSelect=document.createElement('select');queueSelect.id='requirement-select';queueLabel.append(queueSelect);
  const queueMeta=text('span','','queue-meta'),queueControls=document.createElement('div');queueControls.className='queue-controls';
  const concurrencyLabel=text('label','并发');concurrencyLabel.className='concurrency-control';const concurrencySelect=document.createElement('select');concurrencySelect.id='group-concurrency';concurrencySelect.setAttribute('aria-label','群组同时执行任务数');
  for(let value=1;value<=10;value++){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);concurrencySelect.append(option);}concurrencyLabel.append(concurrencySelect);queueControls.append(queueMeta,concurrencyLabel);queue.append(memberPanelToggle,queueLabel,queueControls,taskPanelToggle);document.querySelector('.group-center')?.prepend(queue);
  const narrowPanels=matchMedia('(max-width:800px)');
  function closeMobilePanels(){delete groupView.dataset.mobilePanel;for(const toggle of [memberPanelToggle,taskPanelToggle])toggle.setAttribute('aria-expanded','false');}
  function setPanelCollapsed(side,collapsed){
    if(narrowPanels.matches){const opening=groupView.dataset.mobilePanel!==side;closeMobilePanels();if(opening){groupView.dataset.mobilePanel=side;(side==='members'?memberPanelToggle:taskPanelToggle).setAttribute('aria-expanded','true');}return;}
    const isMembers=side==='members',className=isMembers?'members-collapsed':'tasks-collapsed',toggle=isMembers?memberPanelToggle:taskPanelToggle,label=isMembers?'成员栏':'问题定位栏';groupView.classList.toggle(className,collapsed);toggle.replaceChildren(text('span',label,'toggle-label'),text('span',isMembers?(collapsed?'›':'‹'):(collapsed?'‹':'›'),'toggle-glyph'));toggle.title=`${collapsed?'展开':'折叠'}${label}`;toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(!collapsed));localStorage.setItem(`omega-group-${side}-collapsed`,collapsed?'1':'0');}
  setPanelCollapsed('members',localStorage.getItem('omega-group-members-collapsed')==='1');setPanelCollapsed('tasks',localStorage.getItem('omega-group-tasks-collapsed')==='1');
  function syncPanelMode(){closeMobilePanels();if(narrowPanels.matches){memberPanelToggle.textContent='成员';taskPanelToggle.textContent='问题';memberPanelToggle.setAttribute('aria-label','展开成员栏');taskPanelToggle.setAttribute('aria-label','展开问题定位栏');}else{setPanelCollapsed('members',localStorage.getItem('omega-group-members-collapsed')==='1');setPanelCollapsed('tasks',localStorage.getItem('omega-group-tasks-collapsed')==='1');}}
  for(const panel of groupView.querySelectorAll('.group-panel'))panel.querySelector('.panel-title').append(button('关闭',closeMobilePanels,'mobile-panel-close'));
  const panelBackdrop=button('',closeMobilePanels,'group-panel-backdrop');panelBackdrop.setAttribute('aria-label','关闭侧栏');groupView.querySelector('.group-center').before(panelBackdrop);
  groupView.addEventListener('click',event=>{if(narrowPanels.matches&&event.target.closest('.question-link'))closeMobilePanels();});
  groupView.addEventListener('keydown',event=>{if(event.key==='Escape'&&groupView.dataset.mobilePanel){closeMobilePanels();event.stopPropagation();}});
  narrowPanels.addEventListener('change',syncPanelMode);syncPanelMode();
  document.querySelector('.task-panel .panel-title h2').textContent='问题定位';
  const addMemberButton=$('add-member'),groupTools=document.createElement('div');groupTools.className='group-tools';
  const deleteGroupButton=button('删除群组',deleteCurrentGroup,'group-delete');groupTools.append(addMemberButton,deleteGroupButton);document.querySelector('.group-top')?.append(groupTools);

  function switchMode(next){
    mode=next;document.body.classList.toggle('group-mode',next==='groups');
    globalThis.omegaAppState?.patch({mode:next});
    $('show-chats').classList.toggle('selected',next==='chats');$('show-groups').classList.toggle('selected',next==='groups');
    $('threads').hidden=next!=='chats';$('groups').hidden=next!=='groups';$('new').hidden=next!=='chats';$('new-group').hidden=next!=='groups';
    $('group-view').hidden=next!=='groups';$('section-caption').textContent=next==='groups'?'持续办公 / 群组':'持续办公 / 会话';
    $('side-caption').textContent=next==='groups'?'协作空间':'你的工作';
    $('mobile-new').setAttribute('aria-label',next==='groups'?'新建群组':'新建会话');
    if(next==='groups')refresh().catch(e=>error(e.message));
    else $('title').textContent=threadIdTitle();
    onModeChange?.(next);
  }

  function threadIdTitle(){return document.querySelector('.thread-row.selected .thread-open')?.textContent||'选择或新建会话';}

  async function list(){
    const result=await api('groups');listedGroups=result.groups;
    globalThis.omegaReactWorkspace?.renderGroups(result.groups.map(withUnread),groupId,{open:select,status:label});
    if(!groupId&&result.groups[0])groupId=result.groups[0].id;
    return result.groups;
  }

  async function refresh(){
    if(mode!=='groups')return;if(loading){refreshAgain=true;return;}loading=true;
    try{
      const groups=await list();
      if(groupId&&!groups.some(group=>group.id===groupId))groupId=groups[0]?.id||null;
      if(!groupId){current=null;renderEmpty();return;}
      const params=new URLSearchParams();if(requirementId)params.set('requirementId',requirementId);
      if(current?.id===groupId&&current.messageKeys)params.set('known',current.messageKeys.join(','));
      const response=await api('groups/'+encodeURIComponent(groupId)+'?'+params);
      if(response.messageIds){const cache=new Map([...(current?.id===groupId?current.messages:[])||[],...response.group.messages].map(message=>[message.id,message]));response.group.messages=response.messageIds.map(id=>cache.get(id)).filter(Boolean);response.group.messageKeys=response.messageKeys;}
      current=response.group;
      if(!current.requirement&&requirementId){requirementId=null;sessionStorage.removeItem('omega-requirement');current=(await api('groups/'+encodeURIComponent(groupId))).group;}render();
      if(unreadGroups.has(groupId)&&!document.hidden){unreadGroups.delete(groupId);unreadGroupCounts.delete(groupId);await markRead?.('group',groupId);}
    }finally{loading=false;if(refreshAgain){refreshAgain=false;setTimeout(()=>refresh().catch(e=>error(e.message)),150);}}
  }

  async function select(id){const anchor=sessionStorage.getItem('omega-group-unread:'+id);groupId=id;requirementId=anchor;sessionStorage.setItem('omega-group',id);if(anchor)sessionStorage.setItem('omega-requirement',anchor);else sessionStorage.removeItem('omega-requirement');closeDrawer();await refresh();sessionStorage.removeItem('omega-group-unread:'+id);if(anchor)await room.focus(anchor);}

  function renderEmpty(){
    $('title').textContent='创建你的第一个协作群组';$('group-state').textContent='尚无群组';$('group-description').textContent='把已有会话组织成设计、开发、测试等角色。';
    $('group-cwd').textContent='';queue.hidden=true;globalThis.omegaReactGroupPanels?.renderMembers({members:[],busy:new Set(),removable:false},{edit:()=>{},open:()=>{},remove:()=>{}});room.clear();
    $('group-actions').replaceChildren();$('requirement-form').hidden=true;$('add-member').disabled=true;deleteGroupButton.disabled=true;renderGroupComposer();
  }

  function render(){
    const group=current,req=group.requirement;$('title').textContent=group.name;$('group-state').textContent=label(group.status);$('group-state').dataset.status=group.status;
    $('group-description').textContent=group.description||'群组会话';$('group-cwd').textContent=group.runningTasks?`${group.runningTasks} 位成员正在回复`:`${group.members.length} 位成员可用`;$('member-count').textContent=`${group.members.length} 位`;$('add-member').disabled=false;deleteGroupButton.disabled=false;renderQueue(group);
    const busy=new Set(group.requirements?.flatMap(r=>r.tasks||[]).filter(t=>t.status==='running').map(t=>t.memberId));globalThis.omegaReactGroupPanels?.renderMembers({members:group.members,busy,removable:!req||['completed','accepted','cancelled'].includes(req.status)},{edit:openMemberEdit,open:openThread,remove:memberId=>act({action:'removeMember',memberId},'移出成员')});
    $('group-summary').textContent=req?.plan?.summary||group.summary||'协调者会持续整理目标、约束和进度。';
    room.render(group);$('group-actions').replaceChildren();$('requirement-form').hidden=false;renderGroupComposer();
  }

  window.addEventListener('omega:react-workspace-ready',()=>{if(listedGroups.length)globalThis.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});});
  window.addEventListener('omega:react-group-panels-ready',()=>{if(current){render();room.render(current);}});

  function renderQueue(group){queue.hidden=false;queueLabel.hidden=true;queueMeta.textContent='';concurrencySelect.value=String(group.limits.maxConcurrency);concurrencySelect.onchange=()=>act({action:'setConcurrency',maxConcurrency:Number(concurrencySelect.value),requirementId},'调整并发数');}

  async function act(input,labelText){
    if(acting||!groupId)return;acting=true;error('');
    try{current=(await api('groups',{...input,groupId})).group;if(current.requirement){requirementId=current.requirement.id;sessionStorage.setItem('omega-requirement',requirementId);}render();await list();return true;}
    catch(e){error(`${labelText}失败：${e.message}`);return false;}finally{acting=false;}
  }

  async function deleteCurrentGroup(){
    if(acting||!current)return;
    if(!confirm(`删除群组“${current.name}”？\n\n群组需求、任务和协作记录会被删除，专用协调者会话也会删除；成员会话和项目文件会保留。`))return;
    acting=true;error('');deleteGroupButton.disabled=true;
    try{await api('groups',{action:'deleteGroup',groupId:current.id});groupId=null;requirementId=null;current=null;sessionStorage.removeItem('omega-group');sessionStorage.removeItem('omega-requirement');await refresh();}
    catch(e){error(`删除群组失败：${e.message}`);deleteGroupButton.disabled=false;}
    finally{acting=false;}
  }

  async function openMember(){
    if(!current)return;const result=await rpc('thread/list',{limit:100,sourceKinds:[]}),bound=new Set(current.members.map(m=>m.threadId));
    const available=result.data.filter(t=>t.id!==current.coordinatorThreadId&&!bound.has(t.id));
    if(!available.length)return error('没有可添加的会话；请先新建会话，或该会话已属于其他群组。');
    const initial=available[0],project=(initial.cwd||'').split('/').filter(Boolean).at(-1)||'';
    await reactForm({id:'member-dialog',title:'添加会话成员',description:'成员沿用所选 Codex 会话的上下文和工作目录。',fields:memberFields({threadId:initial.id,name:initial.name||initial.preview||'',role:'',avatar:'preset:developer',projectName:project,cwd:initial.cwd||'',responsibilities:'',operations:'',skills:''},available),onChange:(values,name,value)=>{if(name!=='threadId')return;const thread=available.find(item=>item.id===value);return{cwd:thread?.cwd||'',projectName:(thread?.cwd||'').split('/').filter(Boolean).at(-1)||'',name:values.name||thread?.name||thread?.preview||''};},submitLabel:'添加成员',onSubmit:values=>act({action:'addMember',...values,requirementId:current?.requirement?.id},'添加成员').then(ok=>{if(!ok)throw Error('添加成员失败')})});
  }

  function memberFields(member,threads){return[{name:'threadId',id:'member-thread',label:'关联会话',type:'select',value:member.threadId,required:true,options:threads.map(thread=>({value:thread.id,label:`${thread.name||thread.preview||'新会话'} · ${thread.cwd||'未知目录'}`}))},{name:'avatar',id:'member-avatar',label:'成员头像',type:'avatar',value:member.avatar||''},{name:'name',id:'member-name',label:'成员名称',value:member.name,required:true,maxLength:80},{name:'role',id:'member-role',label:'身份定位',value:member.role,required:true,maxLength:80},{name:'projectName',id:'member-project',label:'项目名称',value:member.projectName||'',maxLength:120},{name:'cwd',id:'member-cwd',label:'实际工作目录',value:member.cwd||'',required:true,help:'必须位于关联会话的 Codex 工作目录内。'},{name:'responsibilities',id:'member-responsibilities',label:'职责范围',type:'textarea',value:member.responsibilities||'',maxLength:3000},{name:'operations',id:'member-operations',label:'允许的操作范围',type:'textarea',value:member.operations||'',maxLength:2000},{name:'skills',id:'member-skills',label:'擅长任务',type:'textarea',value:member.skills||'',maxLength:2000}];}
  async function openMemberEdit(member){if(!current)return;try{const result=await rpc('thread/list',{limit:100,sourceKinds:[]}),bound=new Set(current.members.filter(item=>item.id!==member.id).map(item=>item.threadId)),available=result.data.filter(thread=>thread.id!==current.coordinatorThreadId&&!bound.has(thread.id));if(!available.some(thread=>thread.id===member.threadId))available.unshift({id:member.threadId,name:'当前会话不可用',cwd:member.cwd});await reactForm({id:'member-dialog',title:'编辑成员',description:'修改后的定位用于后续派发，不改写历史任务。',fields:memberFields(member,available),onChange:(_values,name,value)=>{if(name!=='threadId'||value===member.threadId)return;const thread=available.find(item=>item.id===value);return{cwd:thread?.cwd||'',projectName:(thread?.cwd||'').split('/').filter(Boolean).at(-1)||''};},submitLabel:'保存修改',onSubmit:values=>act({action:'updateMember',memberId:member.id,requirementId:current?.requirement?.id,...values},'修改成员').then(ok=>{if(!ok)throw Error('修改成员失败')})});}catch(e){error(`读取可用会话失败：${e.message}`);}}

  $('show-chats').onclick=()=>switchMode('chats');$('show-groups').onclick=()=>switchMode('groups');
  $('new-group').onclick=()=>reactForm({id:'create-group-dialog',title:'新建群组',description:'群组可以添加不同项目、不同工作目录中的会话。',fields:[{name:'name',id:'group-name',label:'群组名称',required:true,maxLength:80},{name:'description',id:'group-project',label:'项目说明',type:'textarea',maxLength:4000},{name:'cwd',id:'group-workdir',label:'服务器工作目录',value:getWorkspace(),required:true},{name:'constraints',id:'group-constraints',label:'项目约束',type:'textarea',maxLength:8000}],submitLabel:'创建群组',onSubmit:async values=>{const response=await api('groups',{action:'create',...values});current=response.group;groupId=current.id;sessionStorage.setItem('omega-group',groupId);render();await list();}}).catch(e=>error(e.message));
  $('add-member').onclick=openMember;
  return {switchMode,refresh,applyReadState:state=>{unreadGroups.clear();unreadGroupCounts.clear();for(const id of state?.unread?.groups||[]){unreadGroups.add(id);unreadGroupCounts.set(id,state?.counts?.groups?.[id]||1);}if(listedGroups.length)globalThis.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});},onReadState:p=>{if(p.scope==='group'){unreadGroups.delete(p.id);unreadGroupCounts.delete(p.id);if(listedGroups.length)globalThis.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});}},onUnread:p=>{if(p.scope==='group'){unreadGroups.add(p.id);unreadGroupCounts.set(p.id,p.count||1);if(listedGroups.length)globalThis.omegaReactWorkspace?.renderGroups(listedGroups.map(withUnread),groupId,{open:select,status:label});}},onGroupUpdated:id=>{if(mode==='groups'&&(!groupId||id===groupId)&&!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=null;refresh().catch(e=>error(e.message));},200);},onGroupDeleted:id=>{unreadGroups.delete(id);unreadGroupCounts.delete(id);if(id===groupId){groupId=null;requirementId=null;current=null;sessionStorage.removeItem('omega-group');sessionStorage.removeItem('omega-requirement');}if(mode==='groups')setTimeout(()=>refresh().catch(e=>error(e.message)),loading?120:0);},isGroupMode:()=>mode==='groups',newAction:()=>mode==='groups'?$('new-group').click():$('new').click()};
}
