import { markdownBody } from './markdown.js';
import { createGroupRoom } from './group-room.js';
import { AVATAR_PRESETS, avatarNode, avatarFromFile } from './avatars.js';

const $=id=>document.getElementById(id);
const statusLabels={idle:'空闲',planning:'正在分配',plan_drafting:'正在分配',awaiting_confirmation:'等待回复',running:'回复中',finalizing:'正在整理回复',awaiting_acceptance:'已回复',paused:'需要处理',accepted:'已回复',cancelled:'已取消',draft:'准备中',queued:'排队中',reviewing:'回复中',completed:'已回复',failed:'失败',unknown:'待核对'};
const label=value=>statusLabels[value]||value||'未知';
const button=(text,action,className='')=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.className=className;node.onclick=action;return node;};
const text=(tag,value,className='')=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};

export function initGroups({api,rpc,error,closeDrawer,openThread,getWorkspace,onModeChange}){
  let mode='chats',groupId=sessionStorage.getItem('omega-group')||null,requirementId=sessionStorage.getItem('omega-requirement')||null,current=null,loading=false,acting=false,editingMemberId=null;
  let replyTo=null,sending=false,refreshTimer=null,refreshAgain=false;
  const groupForm=$('requirement-form'),groupPrompt=$('group-prompt'),groupFormAnchor=document.createComment('group-composer'),groupEditor=document.createElement('dialog');groupEditor.className='group-editor-dialog';groupEditor.setAttribute('aria-label','全屏编辑群组消息');groupForm.before(groupFormAnchor);document.body.append(groupEditor);
  const groupEditorHeading=text('div','','group-editor-heading');groupEditorHeading.append(text('h2','编辑群组消息'),button('收起',closeGroupEditor,'secondary'));groupForm.prepend(groupEditorHeading);
  const groupExpand=button('全屏编辑',openGroupEditor,'group-expand');groupForm.querySelector('div:last-child')?.prepend(groupExpand);
  function resizeGroupPrompt(){if(groupEditor.open){groupPrompt.style.height='';return;}groupPrompt.style.height='0px';groupPrompt.style.height=Math.max(38,Math.min(groupPrompt.scrollHeight,120))+'px';groupPrompt.style.overflowY=groupPrompt.scrollHeight>120?'auto':'hidden';}
  function openGroupEditor(){groupEditor.append(groupForm);groupEditor.showModal();resizeGroupPrompt();groupPrompt.focus({preventScroll:true});}
  function closeGroupEditor(){if(groupEditor.open)groupEditor.close();if(groupForm.parentElement===groupEditor)groupFormAnchor.after(groupForm);resizeGroupPrompt();groupPrompt.focus({preventScroll:true});}
  groupEditor.addEventListener('close',()=>{if(groupForm.parentElement===groupEditor){groupFormAnchor.after(groupForm);resizeGroupPrompt();}});groupEditor.addEventListener('cancel',event=>{event.preventDefault();closeGroupEditor();});
  const mentionMenu=text('div','','mention-menu');mentionMenu.hidden=true;groupPrompt.before(mentionMenu);
  function refreshMentions(){const caret=groupPrompt.selectionStart??groupPrompt.value.length,before=groupPrompt.value.slice(0,caret),at=before.lastIndexOf('@');if(at<0||/\n/.test(before.slice(at))){mentionMenu.hidden=true;return;}const query=before.slice(at+1).trim().toLowerCase(),matches=(current?.members||[]).filter(member=>!query||member.name.toLowerCase().includes(query)).slice(0,8);mentionMenu.replaceChildren(...matches.map(member=>button(`@${member.name} · ${member.role}`,()=>{groupPrompt.setRangeText(`@${member.name} `,at,caret,'end');mentionMenu.hidden=true;resizeGroupPrompt();groupPrompt.focus();},'mention-option')));mentionMenu.hidden=!matches.length;}
  groupPrompt.addEventListener('input',()=>{resizeGroupPrompt();refreshMentions();});groupPrompt.addEventListener('click',refreshMentions);resizeGroupPrompt();
  groupPrompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();mentionMenu.hidden=true;groupForm.requestSubmit();}});
  const replyBar=text('div','','room-reply');replyBar.hidden=true;$('group-prompt').before(replyBar);
  const room=createGroupRoom({api,act,openThread,error,onSelect:id=>{requirementId=id;},onReply:target=>{replyTo=target;replyBar.replaceChildren(text('span',`回复 ${target.name}`),button('取消',()=>{replyTo=null;replyBar.hidden=true;}));replyBar.hidden=false;$('group-prompt').focus();}});
  $('group-prompt').placeholder='在群里提问，输入 @ 可指定成员…';$('group-acceptance').hidden=true;$('requirement-form').querySelector('div:last-child>span').textContent='@成员可直接发送 · Shift+Enter 换行';
  const createActions=$('create-group-form').querySelector('.dialog-actions');
  const createRoot=text('p','','group-root-hint');createRoot.id='create-group-root';
  const createError=text('p','','dialog-error');createError.id='create-group-error';createError.setAttribute('role','alert');
  createActions.before(createRoot,createError);
  const workdir=$('group-workdir');if(workdir?.closest('label'))workdir.closest('label').hidden=true;
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
  const projectLabel=text('label','项目名称');const projectInput=document.createElement('input');projectInput.id='member-project';projectInput.maxLength=120;projectInput.placeholder='默认使用目录名';projectLabel.append(projectInput);$('member-role')?.closest('label')?.after(projectLabel);
  const memberCwdLabel=text('label','实际工作目录');const memberCwdInput=document.createElement('input');memberCwdInput.id='member-cwd';memberCwdInput.maxLength=2000;memberCwdInput.placeholder='该会话 Codex 工作目录内的项目路径';memberCwdLabel.append(memberCwdInput,text('small','调度器按此目录判断写入冲突；可填写会话根目录下的具体项目目录。'));projectLabel.after(memberCwdLabel);
  const skillsLabel=text('label','擅长任务');const skillsInput=document.createElement('textarea');skillsInput.id='member-skills';skillsInput.rows=2;skillsInput.maxLength=2000;skillsInput.placeholder='例如前端交互、接口开发、自动化测试';skillsLabel.append(skillsInput);$('member-operations')?.closest('label')?.after(skillsLabel);
  let memberAvatar='';
  const avatarField=document.createElement('fieldset');avatarField.className='avatar-picker';avatarField.append(text('legend','成员头像'));
  const avatarRow=document.createElement('div');avatarRow.className='avatar-picker-row';const avatarPreview=document.createElement('div');avatarPreview.id='member-avatar-preview';
  const avatarOptions=document.createElement('div'),avatarPresets=document.createElement('div');avatarPresets.id='member-avatar-presets';
  const setAvatar=value=>{memberAvatar=value||'';avatarPreview.replaceChildren(avatarNode(memberAvatar,$('member-name').value,'avatar-preview-image'));for(const choice of avatarPresets.children)choice.classList.toggle('selected',choice.dataset.value===memberAvatar);};
  for(const preset of AVATAR_PRESETS){const choice=button('',()=>setAvatar(preset.value),'avatar-choice');choice.dataset.value=preset.value;choice.title=preset.name;choice.setAttribute('aria-label',preset.name+'头像');choice.append(avatarNode(preset.value,'','avatar-choice-image'));avatarPresets.append(choice);}
  const avatarActions=document.createElement('div');avatarActions.className='avatar-picker-actions';const avatarUpload=button('上传图片',()=>avatarFile.click(),'secondary'),avatarReset=button('使用首字',()=>setAvatar(''),'secondary'),avatarFile=document.createElement('input');avatarFile.id='member-avatar-file';avatarFile.type='file';avatarFile.accept='image/png,image/jpeg,image/webp';avatarFile.hidden=true;
  avatarFile.onchange=async()=>{const file=avatarFile.files?.[0];if(!file)return;avatarUpload.disabled=true;try{setAvatar(await avatarFromFile(file));}catch(e){error(e.message);}finally{avatarUpload.disabled=false;avatarFile.value='';}};
  avatarActions.append(avatarUpload,avatarReset,avatarFile);avatarOptions.append(avatarPresets,avatarActions);avatarRow.append(avatarPreview,avatarOptions);avatarField.append(avatarRow,text('p','可选择预设，或上传图片；图片只保存压缩后的 128 × 128 头像。'));
  $('member-name')?.closest('label')?.before(avatarField);$('member-name').addEventListener('input',()=>{if(!memberAvatar)setAvatar('');});setAvatar('preset:developer');
  const taskModeLabel=text('label','执行模式');const taskModeSelect=document.createElement('select');taskModeSelect.id='task-access-mode';for(const [value,title] of [['read','只读：查询、分析、审核'],['write','写入：修改文件或环境']]){const option=document.createElement('option');option.value=value;option.textContent=title;taskModeSelect.append(option);}taskModeLabel.append(taskModeSelect);$('task-member')?.closest('label')?.after(taskModeLabel);
  const memberTitle=$('member-dialog').querySelector('h2'),memberSubmit=$('member-form').querySelector('button[type="submit"]');
  document.querySelector('.task-panel .panel-title h2').textContent='问题定位';
  const addMemberButton=$('add-member'),groupTools=document.createElement('div');groupTools.className='group-tools';
  const deleteGroupButton=button('删除群组',deleteCurrentGroup,'group-delete');groupTools.append(addMemberButton,deleteGroupButton);document.querySelector('.group-top')?.append(groupTools);

  function switchMode(next){
    mode=next;document.body.classList.toggle('group-mode',next==='groups');
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
    const result=await api('groups');$('groups').replaceChildren();
    for(const group of result.groups){
      const row=button('',()=>select(group.id));row.className='group-row';row.classList.toggle('selected',group.id===groupId);
      const name=text('strong',group.name),meta=text('small',`${group.memberCount} 位成员 · ${group.openRequirementCount||0} 个进行中 · ${label(group.status)}`);row.append(name,meta);$('groups').append(row);
    }
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
    }finally{loading=false;if(refreshAgain){refreshAgain=false;setTimeout(()=>refresh().catch(e=>error(e.message)),150);}}
  }

  async function select(id){groupId=id;requirementId=null;sessionStorage.setItem('omega-group',id);sessionStorage.removeItem('omega-requirement');closeDrawer();await refresh();}

  function renderEmpty(){
    $('title').textContent='创建你的第一个协作群组';$('group-state').textContent='尚无群组';$('group-description').textContent='把已有会话组织成设计、开发、测试等角色。';
    $('group-cwd').textContent='';queue.hidden=true;$('group-members').replaceChildren();$('group-tasks').replaceChildren();$('group-timeline').replaceChildren(text('p','创建群组后，在这里提出需求并确认执行计划。','group-empty'));
    $('group-actions').replaceChildren();$('requirement-form').hidden=true;$('add-member').disabled=true;deleteGroupButton.disabled=true;
  }

  function render(){
    const group=current,req=group.requirement;$('title').textContent=group.name;$('group-state').textContent=label(group.status);$('group-state').dataset.status=group.status;
    $('group-description').textContent=group.description||'群组会话';$('group-cwd').textContent=group.runningTasks?`${group.runningTasks} 位成员正在回复`:`${group.members.length} 位成员可用`;$('member-count').textContent=`${group.members.length} 位`;$('add-member').disabled=false;deleteGroupButton.disabled=false;renderQueue(group);
    $('group-members').replaceChildren(...group.members.map(member=>{
      const card=document.createElement('article');card.className='member-card';
      const head=document.createElement('div'),info=document.createElement('div');info.append(text('strong',member.name),text('span',member.role));
      const actions=document.createElement('div');actions.className='member-actions';const edit=button('编辑',()=>openMemberEdit(member),'member-edit'),open=button('打开会话',()=>openThread(member.threadId));open.className='link-button';actions.append(edit,open);head.append(info,actions);card.append(head);
      head.prepend(avatarNode(member.avatar,member.name));
      const busy=group.requirements?.flatMap(r=>r.tasks||[]).some(t=>t.memberId===member.id&&t.status==='running');card.append(text('small',`${busy?'处理中':'空闲'} · ${member.projectName||'未命名项目'} · ${member.cwd}`,'member-workspace'));
      if(member.responsibilities)card.append(text('p',member.responsibilities));
      if(!req||['completed','accepted','cancelled'].includes(req.status)){const remove=button('移出群组',()=>act({action:'removeMember',memberId:member.id},'移出成员'));remove.className='member-remove';card.append(remove);}
      return card;
    }));
    $('group-summary').textContent=req?.plan?.summary||group.summary||'协调者会持续整理目标、约束和进度。';
    room.render(group);$('group-actions').replaceChildren();
    $('requirement-form').hidden=false;$('group-prompt').disabled=false;$('group-acceptance').disabled=false;$('submit-requirement').disabled=!group.members.length;
    $('submit-requirement').disabled=sending||!group.members.length;$('submit-requirement').textContent=sending?'发送中…':'发送 ↗';
  }

  function renderQueue(group){queue.hidden=false;queueLabel.hidden=true;queueMeta.textContent='';concurrencySelect.value=String(group.limits.maxConcurrency);concurrencySelect.onchange=()=>act({action:'setConcurrency',maxConcurrency:Number(concurrencySelect.value),requirementId},'调整并发数');}

  function renderTimeline(messages){
    const area=$('group-timeline');area.replaceChildren();
    if(!messages.length){area.append(text('p','向群组提出需求，协调者会先生成计划供你确认。','group-empty'));return;}
    for(const message of messages){
      const item=document.createElement('article');item.className='group-message '+message.kind;
      const meta=document.createElement('div');meta.append(text('strong',message.author),text('time',new Date(message.createdAt).toLocaleString()));item.append(meta);
      const body=['coordinator','member'].includes(message.kind)?markdownBody(message.content):text('div',message.content,'group-message-text');item.append(body);
      if(message.reference?.threadId){const link=button('查看原会话 ↗',()=>openThread(message.reference.threadId));link.className='reference-link';item.append(link);}
      area.append(item);
    }
    area.scrollTop=area.scrollHeight;
  }

  function renderTasks(req,members){
    const area=$('group-tasks');area.replaceChildren();const tasks=req?.tasks||[],done=tasks.filter(task=>task.status==='completed').length;$('task-progress').textContent=tasks.length?`${done}/${tasks.length}`:'暂无';
    for(const task of tasks){
      const card=document.createElement('article');card.className='task-card';card.dataset.status=task.status;
      const top=document.createElement('div');top.append(text('span',String(task.position+1),'task-index'),text('strong',task.title),text('span',label(task.status),'task-status'));card.append(top);
      card.append(text('p',task.objective),text('small',`${members.find(member=>member.id===task.memberId)?.name||'未分配'} · ${task.accessMode==='read'?'只读':'写入'} · ${task.cwd||'未设置目录'}`));
      if(task.acceptance){const detail=document.createElement('details');detail.append(text('summary','验收要求'),text('p',task.acceptance));card.append(detail);}
      if(task.error)card.append(text('p',task.error,'task-error'));
      if(req.status==='awaiting_confirmation')card.append(button('调整任务',()=>openTask(task),'task-edit'));
      if(task.turnId){const member=members.find(item=>item.id===task.memberId);if(member)card.append(button('查看执行会话 ↗',()=>openThread(member.threadId),'reference-link'));}
      area.append(card);
    }
  }

  function renderActions(req){
    const area=$('group-actions');area.replaceChildren();if(!req)return;
    if(req.error)area.append(text('p',req.error,'group-error'));
    if(req.status==='awaiting_confirmation')area.append(button('确认并开始执行',()=>act({action:'confirm',requirementId:req.id},'确认计划'),'primary-action'),button('终止需求',()=>act({action:'cancel',requirementId:req.id},'终止需求'),'secondary-action'));
    if(req.status==='paused')area.append(button('核对后继续',()=>act({action:'retry',requirementId:req.id},'继续流程'),'primary-action'),button('终止需求',()=>act({action:'cancel',requirementId:req.id},'终止需求'),'secondary-action'));
    if(req.status==='awaiting_acceptance')area.append(button('验收通过',()=>act({action:'accept',requirementId:req.id},'验收'),'primary-action'),button('要求修改',()=>{$('feedback-dialog').showModal();$('feedback-text').focus();},'secondary-action'));
    if(['plan_drafting','running','finalizing'].includes(req.status)){
      area.append(text('p','服务端正在持续推进，关闭页面不会中断。','running-note'));
      if(req.status==='running'||req.status==='finalizing')area.append(button('停止当前任务',()=>{if(confirm('停止当前执行？已完成的结果会保留，流程将进入暂停。'))act({action:'stop',requirementId:req.id},'停止任务');},'secondary-action'));
      if(req.status==='plan_drafting')area.append(button('终止需求',()=>act({action:'cancel',requirementId:req.id},'终止需求'),'secondary-action'));
    }
  }

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
    editingMemberId=null;memberTitle.textContent='添加会话成员';memberSubmit.textContent='添加成员';$('member-thread').disabled=false;
    if(!current)return;const result=await rpc('thread/list',{limit:100,sourceKinds:[]}),bound=new Set(current.members.map(m=>m.threadId));
    const available=result.data.filter(t=>t.id!==current.coordinatorThreadId&&!bound.has(t.id));$('member-thread').replaceChildren(...available.map(thread=>{const option=document.createElement('option');option.value=thread.id;option.textContent=`${thread.name||thread.preview||'新会话'} · ${thread.cwd||'未知目录'}`;option.dataset.project=(thread.cwd||'').split('/').filter(Boolean).at(-1)||'';option.dataset.cwd=thread.cwd||'';return option;}));
    if(!available.length)return error('没有可添加的会话；请先新建会话，或该会话已属于其他群组。');
    const updateProject=()=>{const option=$('member-thread').selectedOptions[0];$('member-project').value=option?.dataset.project||'';$('member-cwd').value=option?.dataset.cwd||'';};$('member-thread').onchange=updateProject;
    $('member-name').value=available[0].name||available[0].preview?.slice(0,80)||'';$('member-role').value='';$('member-responsibilities').value='';$('member-operations').value='';$('member-skills').value='';setAvatar('preset:developer');updateProject();$('member-dialog').showModal();
  }

  async function openMemberEdit(member){editingMemberId=member.id;memberTitle.textContent='编辑成员';memberSubmit.textContent='保存修改';const select=$('member-thread'),currentOption=document.createElement('option');currentOption.value=member.threadId;currentOption.textContent=`正在检查当前会话 · ${member.cwd}`;currentOption.dataset.project=member.projectName||'';currentOption.dataset.cwd=member.cwd||'';select.replaceChildren(currentOption);select.disabled=true;$('member-name').value=member.name;$('member-role').value=member.role;$('member-project').value=member.projectName||'';$('member-cwd').value=member.cwd||'';$('member-responsibilities').value=member.responsibilities||'';$('member-operations').value=member.operations||'';$('member-skills').value=member.skills||'';setAvatar(member.avatar||'');$('member-dialog').showModal();try{const result=await rpc('thread/list',{limit:100,sourceKinds:[]});if(editingMemberId!==member.id)return;const live=result.data.find(thread=>thread.id===member.threadId),bound=new Set(current.members.filter(item=>item.id!==member.id).map(item=>item.threadId)),available=result.data.filter(thread=>thread.id!==current.coordinatorThreadId&&!bound.has(thread.id));const options=available.map(thread=>{const option=document.createElement('option');option.value=thread.id;option.textContent=`${thread.name||thread.preview||'新会话'} · ${thread.cwd||'未知目录'}`;option.dataset.project=(thread.cwd||'').split('/').filter(Boolean).at(-1)||'';option.dataset.cwd=thread.cwd||'';option.selected=thread.id===member.threadId;return option;});if(!live){currentOption.textContent=`当前会话不可用 · ${member.threadId}`;currentOption.dataset.project=member.projectName||'';currentOption.dataset.cwd=member.cwd||'';currentOption.selected=true;options.unshift(currentOption);}select.replaceChildren(...options);select.disabled=false;select.onchange=()=>{if(select.value!==member.threadId){const option=select.selectedOptions[0];$('member-project').value=option?.dataset.project||'';$('member-cwd').value=option?.dataset.cwd||'';}};}catch(e){error(`读取可用会话失败：${e.message}`);select.disabled=false;currentOption.textContent=`当前关联 · ${member.cwd}`;}}

  function openTask(task){
    $('task-id').value=task.id;$('task-title-input').value=task.title;$('task-objective').value=task.objective;$('task-acceptance').value=task.acceptance||'';
    $('task-access-mode').value=task.accessMode==='read'?'read':'write';
    $('task-member').replaceChildren(...current.members.map(member=>{const option=document.createElement('option');option.value=member.id;option.textContent=`${member.name} · ${member.role}`;option.selected=member.id===task.memberId;return option;}));$('task-dialog').showModal();
  }

  $('show-chats').onclick=()=>switchMode('chats');$('show-groups').onclick=()=>switchMode('groups');
  $('new-group').onclick=()=>{$('group-workdir').value=getWorkspace();createRoot.textContent='群组可以添加不同项目、不同工作目录中的会话。';createError.textContent='';$('create-group-dialog').showModal();};
  $('add-member').onclick=openMember;
  $('create-group-cancel').onclick=()=>$('create-group-dialog').close();$('member-cancel').onclick=()=>{editingMemberId=null;$('member-thread').disabled=false;$('member-dialog').close();};$('feedback-cancel').onclick=()=>$('feedback-dialog').close();$('task-cancel').onclick=()=>$('task-dialog').close();
  $('create-group-form').onsubmit=async event=>{event.preventDefault();if(acting)return;acting=true;createError.textContent='';try{const response=await api('groups',{action:'create',name:$('group-name').value,description:$('group-project').value,cwd:$('group-workdir').value,constraints:$('group-constraints').value});current=response.group;groupId=current.id;sessionStorage.setItem('omega-group',groupId);$('create-group-dialog').close();event.target.reset();render();await list();}catch(e){createError.textContent=e.message;error('');}finally{acting=false;}};
  $('member-form').onsubmit=async event=>{event.preventDefault();const memberId=editingMemberId,action=memberId?'updateMember':'addMember',threadId=$('member-thread').value;const ok=await act({action,memberId,requirementId:current?.requirement?.id,threadId,name:$('member-name').value,role:$('member-role').value,avatar:memberAvatar,projectName:$('member-project').value,cwd:$('member-cwd').value,responsibilities:$('member-responsibilities').value,operations:$('member-operations').value,skills:$('member-skills').value},memberId?'修改成员':'添加成员');if(ok){editingMemberId=null;$('member-thread').disabled=false;$('member-dialog').close();event.target.reset();setAvatar('preset:developer');}};
  $('requirement-form').onsubmit=async event=>{event.preventDefault();if(sending||!groupId)return;const content=$('group-prompt').value.trim();if(!content)return;const targetGroup=groupId,targetReply=replyTo;sending=true;$('submit-requirement').disabled=true;try{const result=await api('groups',{action:'submit',groupId:targetGroup,content,replyTaskId:targetReply?.taskId});if(groupId===targetGroup){current=result.group;if($('group-prompt').value.trim()===content)$('group-prompt').value='';mentionMenu.hidden=true;if(replyTo===targetReply){replyTo=null;replyBar.hidden=true;}render();resizeGroupPrompt();closeGroupEditor();}}catch(e){error(`发送失败：${e.message}`);}finally{sending=false;$('submit-requirement').disabled=!current?.members.length;$('submit-requirement').textContent='发送 ↗';}};
  $('feedback-form').onsubmit=async event=>{event.preventDefault();await act({action:'requestChanges',requirementId:current.requirement.id,feedback:$('feedback-text').value},'提交返工');if(current?.requirement.status==='running'){$('feedback-dialog').close();event.target.reset();}};
  $('task-form').onsubmit=async event=>{event.preventDefault();await act({action:'updateTask',requirementId:current.requirement.id,taskId:$('task-id').value,memberId:$('task-member').value,accessMode:$('task-access-mode').value,title:$('task-title-input').value,objective:$('task-objective').value,acceptance:$('task-acceptance').value},'调整任务');if(current?.requirement.status==='awaiting_confirmation')$('task-dialog').close();};

  return {switchMode,refresh,onGroupUpdated:id=>{if(mode==='groups'&&(!groupId||id===groupId)&&!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=null;refresh().catch(e=>error(e.message));},200);},onGroupDeleted:id=>{if(id===groupId){groupId=null;requirementId=null;current=null;sessionStorage.removeItem('omega-group');sessionStorage.removeItem('omega-requirement');}if(mode==='groups')setTimeout(()=>refresh().catch(e=>error(e.message)),loading?120:0);},isGroupMode:()=>mode==='groups',newAction:()=>mode==='groups'?$('new-group').click():$('new').click()};
}
