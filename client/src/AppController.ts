// The orchestration controller is now part of the TypeScript client bundle.
// Product orchestration now runs inside the strictly checked client bundle.
import { createAttachments } from './attachments.js';
import { initUI } from './ui.js';
import { createModelSettings } from './model-settings.js';
import { native, apiFetch, initialKey, rememberKey, forgetSessionKey, savedThread, rememberThread, clientDeviceId } from './platform.js';
import { initGroups } from './groups.js';
import { createOmegaTransport } from './transport.js';
import { isThreadWriterConflict,threadWriterBusyMessage } from '../../src/shared/thread-errors.js';
type JsonRecord = Record<string, any>;
type ControllerError = Error & {status?:number;code?:string;threadId?:string};
type PendingSubmission = {fingerprint:string;id:string;settingsRevision:number};
const errorValue=(cause:unknown):ControllerError=>cause instanceof Error?cause as ControllerError:Object.assign(new Error(String(cause)),{status:undefined});
const $=<T extends HTMLElement=HTMLElement>(id:string):T=>{
  const element=document.getElementById(id);
  if(!element)throw new Error(`Omega 页面缺少 #${id}`);
  return element as T;
};
const patchState=(value:Record<string,unknown>)=>{if(window.omegaAppState)window.omegaAppState.patch(value);else window.addEventListener('omega:app-state-ready',()=>window.omegaAppState?.patch(value),{once:true});};
initUI();
const runtime=window.omegaRuntime;
if(!runtime)throw new Error('Omega React runtime 未加载');
const session=runtime.session;
const conversations=runtime.conversations;
const timeline=runtime.timeline;
session.selectThread(savedThread());
const deviceId=clientDeviceId();
const openDialog=(name:string,props:JsonRecord):Promise<any>=>window.omegaDialogs?window.omegaDialogs.open(name,props):new Promise(resolve=>window.addEventListener('omega:dialogs-ready',()=>window.omegaDialogs!.open(name,props).then(resolve),{once:true}));
let key = initialKey(), lifecycle:any;
let chatTitle='开始下一件事';
const setChatTitle=(title:string)=>{chatTitle=title||'选择或新建会话';patchState({chatTitle});};
const threadSidebarActions={open:(id:string)=>selectAt(id,conversations.position(id)).catch(cause=>error(errorValue(cause).message)),rename:openRename,remove:openDelete};
function renderThreadSidebar(){window.omegaReactWorkspace?.renderThreads(conversations.sidebarItems(),session.snapshot.threadId,threadSidebarActions);}
let deleting = false;
function removeThread(id:string) {
  conversations.remove(id);renderThreadSidebar();
  if (session.snapshot.threadId !== id) return;
  session.selectThread(null);timeline.resetDeleted();
  preferences.reset();
  rememberThread(null);
  setChatTitle('选择或新建会话');
  session.setComposerWorkspace(session.snapshot.serverWorkspace);
  // Preserve unsent text and attachments, including on another device.
  pendingSubmission=null; render(); renderApprovals(); controls();
  lifecycle?.restartStream();
  error('会话已删除。未发送的文字仍保留，请选择或新建会话。');
}
async function openDelete(thread:JsonRecord) {if(deleting)return;const id=thread.id,name=conversations.displayName(thread);await openDialog('deleteThread',{name,onSubmit:async()=>{if(sending)throw Error('消息正在提交，请稍后再删除');deleting=true;try{await rpc('thread/delete',{threadId:id},{confirmDelete:true});removeThread(id)}finally{deleting=false}}});}
function applyThreadName(id:string,name:string) {
  conversations.rename(id,name);renderThreadSidebar();
  if (session.snapshot.threadId === id) setChatTitle(name);
}
function openRename(thread:JsonRecord) {
  const id=thread.id,name=conversations.displayName(thread);
  openDialog('renameThread',{name,onSubmit:async (values:JsonRecord)=>{const result=await rpc<JsonRecord>('thread/name/set',{threadId:id,name:values.name});applyThreadName(result.threadId,result.name);}});
}
let renderTimer:ReturnType<typeof setTimeout>|null=null, sending = false;
setInterval(()=>{if(timeline.metricsRunning&&!document.hidden)scheduleRender()},1000);
let pendingSubmission:PendingSubmission|null = null;
function submissionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // getRandomValues is available on HTTP too; keep UUID v4 entropy and format.
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('浏览器不支持安全随机数，请更新浏览器或使用 HTTPS');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const attachments = createAttachments({getKey:()=>key,isLocked:()=>sending,onChange:controls,onError:error});
function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 150); }

function jumpExchange(index:number) {
  if(!timeline.selectTurn(index))return;render();
  hydrate().catch(cause => error(errorValue(cause).message));
}
function jumpLatest() {
  if(timeline.latest())hydrate().catch(cause=>error(errorValue(cause).message));
  window.omegaReactChat?.followLatest();render();
}
async function previousExchange(){const target=timeline.previous();if(target?.turn!==undefined)return jumpExchange(target.turn);if(target?.page)await switchHistoryPage(target.page)}
async function nextExchange(){const target=timeline.next();if(target?.turn!==undefined)return jumpExchange(target.turn);if(target?.page)await switchHistoryPage(target.page)}
function error(message:string) { patchState({notice:message||''}); }
const transport=createOmegaTransport({fetchImpl:apiFetch,getKey:()=>key,deviceId,onUnauthorized:()=>{
  if(session.snapshot.authenticated){
    lifecycle?.stop();forgetSessionKey();
    session.setConnection(false,false,'请重新连接');
    openConnection().catch(cause=>error(errorValue(cause).message));
  }
}});
const api=transport.request,rpc=transport.rpc;
window.omegaProductApi=api;
window.omegaProductContext=()=>session.context();
window.omegaSystem={backup:async()=>{const response=await transport.fetch('backup');if(!response.ok)throw new Error(((await response.json()) as JsonRecord).error||'备份失败');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`omega-${new Date().toISOString().slice(0,10)}.omega-backup.gz`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},restore:async (file:File)=>{const response=await transport.fetch('restore',{method:'POST',headers:{'content-type':'application/gzip'},body:file});let result:JsonRecord;try{result=await response.json() as JsonRecord}catch{throw new Error('恢复接口响应异常')}if(!response.ok)throw new Error(result.error||'恢复失败');return result as {files:number;restartRequired:boolean};}};
const preferences=createModelSettings({api,getThreadId:()=>session.snapshot.threadId,isSending:()=>sending});
const groupUI=initGroups({api,rpc,error,closeDrawer:()=>window.omegaReactWorkspace?.closeSidebar(),getWorkspace:()=>session.snapshot.serverWorkspace,openDialog,
  openThread:(id:string)=>{groupUI.switchMode('chats');return select(id);},onModeChange:()=>renderApprovals(),markRead:(scope:string,id:string)=>api('read-state',{scope,id})});
function applyReadState(state:JsonRecord){conversations.applyReadState(state);for(let index=sessionStorage.length-1;index>=0;index--){const name=sessionStorage.key(index);if(name?.startsWith('omega-group-unread:'))sessionStorage.removeItem(name);}for(const id of state?.unread?.groups||[])if(state?.positions?.groups?.[id])sessionStorage.setItem('omega-group-unread:'+id,state.positions.groups[id]);renderThreadSidebar();groupUI.applyReadState(state);}
async function syncReadState(){applyReadState(await api('read-state'));}
async function markThreadRead(id:string|null){if(!id)return;conversations.markRead(id);renderThreadSidebar();try{applyReadState(await api<JsonRecord>('read-state',{scope:'thread',id}));}catch{}}
function renderComposer(){
  const current=session.snapshot;window.omegaReactComposer?.render({sending,enabled:!!current.threadId,active:!!current.active[current.threadId!],attachmentsReady:attachments.ready,attachments:attachments.records,workspace:current.composerWorkspace||current.serverWorkspace},{submit:sendMessage,stop:stopMessage,addFiles:(files:File[])=>attachments.ingest(files),removeAttachment:(index:number)=>attachments.remove(index),openModelSettings:()=>preferences.open(),report:(message:string)=>error(message)});
}
function controls() { renderComposer();preferences.controls(); }
window.addEventListener('omega:react-composer-ready',controls);
function render() {
  if(!window.omegaReactChat)return;
  const current=session.snapshot,view=timeline.view(!!current.active[current.threadId!]);
  const actions={itemText:timeline.itemText,toggle:(item:JsonRecord,open:boolean)=>{timeline.toggleTool(item.id,open);if(open&&item.deferred)loadItem(item,0).catch(cause=>error(errorValue(cause).message));},page:(item:JsonRecord,offset:number)=>loadItem(item,offset).catch(cause=>error(errorValue(cause).message)),loadImage:attachments.loadImage,selectTurn:jumpExchange,previous:()=>previousExchange().catch(cause=>error(errorValue(cause).message)),next:()=>nextExchange().catch(cause=>error(errorValue(cause).message)),latest:jumpLatest};
  window.omegaAppState?.patch({chatTitle,chatHeader:{...view.history,historyMode:view.historyMode,actions:{selectTurn:jumpExchange,previous:()=>previousExchange().catch(cause=>error(errorValue(cause).message)),next:()=>nextExchange().catch(cause=>error(errorValue(cause).message)),latest:jumpLatest}}});
  window.omegaReactChat.render(view,actions);
}
window.addEventListener('omega:react-chat-ready',render);
async function list() {
  const revision = conversations.revision;
  const result = await rpc('thread/list', { limit: 60, sourceKinds: [] });
  conversations.replace(result.data,revision);
  renderThreadSidebar();
}
window.addEventListener('omega:react-workspace-ready',renderThreadSidebar);
async function loadItem(item:JsonRecord, offset:number) {
  const version=timeline.version;
  const result=await api('history',{threadId:session.snapshot.threadId,turnId:timeline.selectedTurn,itemId:item.id,offset,cursor:timeline.historyCursor||undefined,selectionOnly:true});
  if(timeline.applyItemPage(result,version))render();
}
async function switchHistoryPage(direction:'older'|'newer') {
  const selected=session.snapshot.threadId;if(!selected)return;
  const request=timeline.pageRequest(direction);if(!request)return;
  const result=await api('history',{threadId:selected,cursor:request.cursor||undefined,outlineOnly:true});
  if(!timeline.isCurrent(request.version)||selected!==session.snapshot.threadId)return;
  if(!timeline.applyPage(direction,result,request.cursor)){render();return;}render();await hydrate();
}
async function hydrate() {
  const selected=session.snapshot.threadId;if(!selected)return;const request=timeline.hydrationRequest();if(!request)return;
  try {
    const result=await api('history',{threadId:selected,turnId:request.turnId,cursor:request.cursor,selectionOnly:request.selectionOnly});
    if(selected!==session.snapshot.threadId||!timeline.applyHydration(result,request.version,request.metricsRevision))return;
    preferences.apply(result.settings);
    setChatTitle(conversations.displayName(result.thread));
    session.setComposerWorkspace(result.thread.cwd);
    render(); controls();
  } finally {timeline.finishHydration(request.version)}
}
async function select(id:string, closeMenu=true,notifyWriterConflict=closeMenu) {
  if(conversations.isDeleted(id))return;
  if(closeMenu){error('');window.omegaReactWorkspace?.closeSidebar();}
  const version=timeline.beginThread();if(closeMenu)preferences.reset();
  attachments.clear();
  session.selectThread(id);rememberThread(id);
  lifecycle.restartStream();
  window.omegaReactChat?.followLatest();render(); renderApprovals(); controls();
  let writerConflict=false;
  try{await rpc('thread/resume',{threadId:id},{summaryOnly:true});}
  catch(cause){if(!isThreadWriterConflict(cause))throw cause;writerConflict=true;}
  if(!timeline.isCurrent(version))return;
  await hydrate(); await list(); controls();
  await markThreadRead(id);
  if(writerConflict&&notifyWriterConflict)error(threadWriterBusyMessage());
}
async function selectAt(id:string,turnId:string|null=null){await select(id);if(!turnId||turnId===timeline.selectedTurn)return;timeline.selectAt(turnId);await hydrate();}
window.omegaNavigation={openThread:selectAt};
function renderApprovals() {
  const current=session.snapshot;const visible=current.approvals.filter((value:JsonRecord) => groupUI.isGroupMode() || !value.params?.threadId || value.params.threadId === current.threadId);
  window.omegaReactApprovals?.render(visible,{resolve:(id:string|number,result:unknown)=>api<void>('answer',{id,result}),report:(message:string)=>error(message)});
}
window.addEventListener('omega:react-approvals-ready',renderApprovals);
function event(message:JsonRecord) {
  const { method, params: p = {} } = message;
  if(method==='omega/reconnected'){session.setConnection(session.snapshot.authenticated,true,'已连接');error('');lifecycle.resume();return;}
  if (['thread/deleted','omega/thread-deleted'].includes(method)) { removeThread(p.threadId); return; }
  if(method==='omega/group-updated'){groupUI.onGroupUpdated(p.groupId);return;}
  if(method==='omega/group-deleted'){groupUI.onGroupDeleted(p.groupId);return;}
  if(method==='omega/read-state'){if(p.scope==='thread'){conversations.markRead(p.id);renderThreadSidebar();}else{sessionStorage.removeItem('omega-group-unread:'+p.id);groupUI.onReadState(p);}return;}
  if(method==='omega/unread'){if(p.scope==='thread'){conversations.markUnread(p.id,p.count,p.position);renderThreadSidebar();}else{if(p.position&&!sessionStorage.getItem('omega-group-unread:'+p.id))sessionStorage.setItem('omega-group-unread:'+p.id,p.position);groupUI.onUnread(p);}return;}
  if (conversations.isDeleted(p.threadId)) return;
  if(method==='omega/model-settings'){if(p.threadId===session.snapshot.threadId)preferences.apply(p.settings);return;}
  if(method==='omega/turn-model'){if(p.threadId===session.snapshot.threadId&&p.turnId===timeline.selectedTurn){timeline.setTurnModel(p.settings);scheduleRender();}return;}
  if (method === 'omega/turn-metrics') {
    if (p.threadId === session.snapshot.threadId) {
      timeline.receiveMetrics(p.turnId,p.metrics);scheduleRender();
    }
    return;
  }
  if (method === 'omega/thread-renamed') { applyThreadName(p.threadId,p.name); return; }
  if (method === 'omega/disconnected') { session.setConnection(session.snapshot.authenticated,false,'连接已断开');error(p.message); return; }
  const effect=session.reduce(message);
  if (effect.kind === 'snapshot') { applyReadState(p.readState); renderApprovals(); controls(); hydrate().catch(cause => error(errorValue(cause).message)); return; }
  if (effect.kind === 'approval') { renderApprovals(); return; }
  if (effect.kind === 'approval-resolved') renderApprovals();
  if (effect.kind === 'turn-completed') { if(p.threadId===session.snapshot.threadId&&!groupUI.isGroupMode()&&!document.hidden)markThreadRead(p.threadId); if (p.turn.error) error(p.turn.error.message); list().catch(()=>{}); if(window.omegaDesktop?.notify)window.omegaDesktop.notify({title:p.turn?.status==='completed'?'Omega 已完成':'Omega 需要处理',body:p.turn?.error?.message||'会话任务已经结束',threadId:p.threadId}); }
  controls();
  if (p.threadId !== session.snapshot.threadId) return;
  if (timeline.historyMode) return;
  if (effect.kind === 'turn-started') {timeline.startTurn(p.turn);scheduleRender();}

  if (method === 'item/started' || method === 'item/completed') {
    timeline.receiveItem(p.item);scheduleRender();
  }
  if (method === 'item/agentMessage/delta') {timeline.receiveAgentDelta(p.itemId,p.delta);scheduleRender();}
  if (method === 'item/commandExecution/outputDelta'&&timeline.receiveCommandDelta(p.itemId,p.delta))scheduleRender();
  if (effect.kind === 'turn-completed') hydrate().catch(cause => error(errorValue(cause).message));
}
lifecycle=runtime.createLifecycle({
  enabled:()=>session.snapshot.authenticated,visible:()=>!document.hidden,threadId:()=>session.snapshot.threadId,cursor:()=>session.snapshot.lastEventId,
  fetchEvents:(signal:AbortSignal,cursor:number,selected:string|null)=>transport.fetch('events?threadId='+encodeURIComponent(selected||''),{headers:cursor?{'last-event-id':String(cursor)}:{},signal}),
  receive:event,setCursor:(value:number)=>session.setEventCursor(value),connection:(connected:boolean,label:string)=>session.setConnection(session.snapshot.authenticated,connected,label),report:error,
  poll:async()=>{const status=await api('status');session.applyStatus(status);controls();if(groupUI.isGroupMode())await groupUI.refresh();},
  resync:async()=>{const status=await api('status');session.applyStatus(status);await list();if(session.snapshot.threadId)await hydrate();if(groupUI.isGroupMode())await groupUI.refresh();renderApprovals();controls();}
});
async function connect() {
  error(''); const status = await api('status'); if (!status.ready) throw new Error('Codex App Server 尚未就绪');
  if (!native) await rememberKey(key);
  session.applyStatus(status,{initialize:true});session.setConnection(true,true,'已连接');
  lifecycle.restartStream();
  await syncReadState();await list();
  if(session.snapshot.threadId)await select(session.snapshot.threadId,false,false).catch(cause=>error(`上次会话暂时无法加载：${errorValue(cause).message}`));
  renderApprovals(); controls();
  lifecycle.startPolling();
}
async function openConnection(){if(native){const setup=$<HTMLDialogElement>('setup');if(!setup.open)setup.showModal();return;}await openDialog('connection',{onSubmit:async (values:JsonRecord)=>{key=values.accessKey.trim();await connect();}}).catch(cause=>error(errorValue(cause).message));}
if(native){const nativeAdapter=native;$<HTMLFormElement>('connect-form').onsubmit=submitEvent=>{submitEvent.preventDefault();nativeAdapter.prepareConnection($<HTMLInputElement>('token').value.trim());};}
async function openSettings(){if(!session.snapshot.authenticated)return openConnection();if(native)return $<HTMLDialogElement>('key-settings').showModal();if(!session.snapshot.canChangeKey)return openDialog('connectionInfo',{});await openDialog('accessKey',{onSubmit:async (values:JsonRecord)=>{const next=values.accessKey;await api('access-key',{accessKey:next});key=next;lifecycle.restartStream();session.setConnection(true,true,'密钥已保存');await rememberKey(key);}});}
function openNewThread(){return openDialog('newThread',{cwd:session.snapshot.serverWorkspace,onSubmit:async (values:JsonRecord)=>{const result=await rpc<JsonRecord>('thread/start',{cwd:values.cwd});await select(result.thread.id);}}).catch(cause=>error(errorValue(cause).message));}
patchState({shellActions:{switchMode:(mode:'chats'|'groups')=>groupUI.switchMode(mode),newAction:()=>groupUI.isGroupMode()?groupUI.newGroup():openNewThread(),openSettings}});
async function sendMessage(value:string) {
  const text=value.trim(), imageIds=attachments.ids, target=session.snapshot.threadId;
  if ((!text && !imageIds.length) || !target || sending || !attachments.ready || session.snapshot.active[target]) return false;
  sending = true;
  let requested = false;
  try {
    attachments.refresh();jumpLatest();error('');controls();
    const fingerprint = JSON.stringify({target,text,imageIds});
    if (pendingSubmission?.fingerprint !== fingerprint) pendingSubmission = {fingerprint,id:submissionId(),settingsRevision:preferences.revision};
    const id = pendingSubmission.id;
    requested = true;
    await rpc('turn/start',{threadId:target,input:text ? [{type:'text',text}] : []},{submissionId:id,imageIds,settingsRevision:pendingSubmission.settingsRevision});
    pendingSubmission = null;
    if (target === session.snapshot.threadId) attachments.clear();
    return true;
  } catch(cause) {
    const caught=errorValue(cause);
    if(isThreadWriterConflict(caught)){pendingSubmission=null;error(threadWriterBusyMessage());}
    else if(caught.status===409&&/模型设置/.test(caught.message)){pendingSubmission=null;try{await preferences.refresh();}catch{} error(caught.message+'；本次未发送。');}
    else error(caught.message + (requested ? '；请求可能已到达服务端，请先核对会话，勿立即重复发送。' : '；消息未发送，请修正后重试。'));
    return false;
  }
  finally { sending = false; attachments.refresh();controls(); }
}
async function stopMessage(){const current=session.snapshot;try{await rpc('turn/interrupt',{threadId:current.threadId,turnId:current.threadId?current.active[current.threadId]:undefined})}catch(cause){error(errorValue(cause).message)}}
// Native foreground/network lifecycle is centralized in the TypeScript runtime.
if(native)lifecycle.bindNative();
controls(); if(key)connect().catch(cause=>{const caught=errorValue(cause);error(caught.message);if(!session.snapshot.authenticated||caught.status===401)openConnection();});else openConnection();
