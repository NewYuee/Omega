import { createAttachments } from './attachments.js';
import { initUI } from './ui.js';
import { createModelSettings, effortLabel } from './model-settings.js';
import { native, apiFetch, initialKey, rememberKey, forgetSessionKey, savedThread, rememberThread, clientDeviceId } from './platform.js';
import { initGroups } from './groups.js';
import { createOmegaTransport } from './transport.js';
const $ = id => document.getElementById(id);
const ui = initUI();
const deviceId=clientDeviceId();
const reactForm=config=>globalThis.omegaReactForms?globalThis.omegaReactForms.open(config):new Promise(resolve=>window.addEventListener('omega:react-forms-ready',()=>globalThis.omegaReactForms.open(config).then(resolve),{once:true}));
let key = initialKey(), threadId = savedThread(), active = {}, approvals = [], items = new Map(), streamController, refreshTimer, loading = false;
let serverWorkspace='',composerWorkspace='';
let authenticated = false, canChangeKey = true;
let lastEventId=0;
const unreadThreads=new Set();
const unreadThreadCounts=new Map();
const unreadThreadPositions=new Map();
let selectionVersion = 0;
const expandedTools = new Set();
const threadNames = new Map();
let listedThreads=[];
const threadSidebarActions={open:id=>selectAt(id,unreadThreadPositions.get(id)||null).catch(e=>error(e.message)),rename:openRename,remove:openDelete};
function renderThreadSidebar(){globalThis.omegaReactWorkspace?.renderThreads(listedThreads.map(thread=>({...thread,unread:unreadThreads.has(thread.id),unreadCount:unreadThreadCounts.get(thread.id)||0})),threadId,threadSidebarActions);}
let nameRevision = 0;
const deletedThreads = new Set();
let deleting = false;
function removeThread(id) {
  deletedThreads.add(id);
  listedThreads=listedThreads.filter(thread=>thread.id!==id);renderThreadSidebar();
  threadNames.delete(id); nameRevision++;
  if (threadId !== id) return;
  selectionVersion++; threadId=null; selectedTurn=null; outline=[]; historyMode=false; historyCursor=null;olderHistoryCursor=null;newerHistoryCursors=[];loading=false;
  preferences.reset();
  rememberThread(null); items.clear(); expandedTools.clear(); recentMetrics.clear(); setMetrics(null);
  $('title').textContent='选择或新建会话';
  composerWorkspace=serverWorkspace;
  // Preserve unsent text and attachments, including on another device.
  pendingSubmission=null; render(); renderApprovals(); controls();
  streamController?.abort(); streamController=new AbortController(); stream(streamController.signal);
  error('会话已删除。未发送的文字仍保留，请选择或新建会话。');
}
async function openDelete(thread) {if(deleting)return;const id=thread.id,name=threadNames.get(id)||thread.name||thread.preview||'新会话';await reactForm({id:'delete-dialog',title:'删除会话？',description:`将删除“${name}”及其子会话的聊天记录。项目文件不会删除，操作无法在 Omega 中恢复。`,danger:true,submitLabel:'确认删除',onSubmit:async()=>{if(sending)throw Error('消息正在提交，请稍后再删除');deleting=true;try{await rpc('thread/delete',{threadId:id},{confirmDelete:true});removeThread(id)}finally{deleting=false}}});}
function applyThreadName(id,name) {
  nameRevision++; threadNames.set(id,name);
  listedThreads=listedThreads.map(thread=>thread.id===id?{...thread,name}:thread);renderThreadSidebar();
  if (threadId === id) $('title').textContent = name;
}
function openRename(thread) {
  const id=thread.id,name=threadNames.get(id)||thread.name||thread.preview?.slice(0,80)||'';
  reactForm({id:'rename-dialog',title:'重命名会话',description:'名称会同步到其他设备，不影响聊天内容。',fields:[{name:'name',id:'rename-name',label:'会话名称',value:name,required:true,maxLength:80}],submitLabel:'保存',onSubmit:async values=>{const next=values.name.trim();if(!next)throw Error('请输入 1–80 个字符的会话名称');const result=await rpc('thread/name/set',{threadId:id,name:next});applyThreadName(result.threadId,result.name);}});
}
let outline = [], selectedTurn = null, historyMode = false, renderTimer, sending = false;
let historyCursor = null, olderHistoryCursor = null, newerHistoryCursors = [];
let turnMetrics = null, metricsReceivedAt = 0, metricsRevision = 0;
let turnModel=null;
const recentMetrics = new Map();
const metricsPanel = document.createElement('div'); metricsPanel.className = 'turn-metrics'; metricsPanel.id = 'turn-metrics';
metricsPanel.setAttribute('aria-label','本轮统计');
metricsPanel.title = '整轮耗时包含思考、工具执行和等待；平均速度为输出 token / 整轮耗时，不是纯模型生成速度。缓存和思考是用量细分，不重复相加。';
function setMetrics(value, receivedAt=Date.now()) { turnMetrics=value; metricsReceivedAt=receivedAt; renderMetrics();if(globalThis.omegaReactChat)scheduleRender(); }
function renderMetrics() {
  metricsPanel.hidden = !selectedTurn;
  if (!selectedTurn) return;
  const m=turnMetrics, usage=m?.usage;
  const elapsed=m?.elapsedMs == null ? null : m.elapsedMs + (m.running ? Math.max(0,Date.now()-metricsReceivedAt) : 0);
  const count=value=>typeof value==='number' ? value.toLocaleString() : '暂无';
  const time=elapsed===null ? '暂无' : (elapsed/1000).toFixed(1)+' 秒';
  const speed=!m?.running && elapsed>0 && typeof usage?.outputTokens==='number' ? (usage.outputTokens/(elapsed/1000)).toFixed(1)+' tokens/s' : '暂无';
  const parts=[(m?.running?'进行中 · ':'')+'耗时 '+(m?.observedTime && elapsed!==null?'约 ':'')+time,
    '输入 '+count(usage?.inputTokens),'输出 '+count(usage?.outputTokens)+' tokens','整轮平均 '+speed];
  if(turnModel?.model)parts.unshift('本轮请求 '+turnModel.model+' · 推理 '+effortLabel(turnModel.effort));
  if (usage) {
    parts.push('总量 '+count(usage.totalTokens));
    if(usage.cachedInputTokens!==null && usage.cachedInputTokens!==undefined)parts.push('缓存命中 '+count(usage.cachedInputTokens));
    if(usage.reasoningOutputTokens!==null && usage.reasoningOutputTokens!==undefined)parts.push('思考 '+count(usage.reasoningOutputTokens));
  }
  metricsPanel.textContent=parts.join(' · ');
}
setInterval(()=>{if(turnMetrics?.running && !document.hidden){renderMetrics();if(globalThis.omegaReactChat)scheduleRender();}},1000);
let pendingSubmission = null;
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

function jumpExchange(index) {
  if (!outline[index]) return;
  historyMode = historyCursor !== null || index !== outline.length - 1;
  selectedTurn = outline[index].id; items.clear(); expandedTools.clear();
  turnModel=null;setMetrics(null);
  selectionVersion++;render();
  hydrate().catch(e => error(e.message));
}
function jumpLatest() {
  if (historyMode) { historyMode = false; selectedTurn = null; turnModel=null; historyCursor=null; olderHistoryCursor=null; newerHistoryCursors=[]; selectionVersion++; items.clear(); hydrate().catch(e => error(e.message)); }
  globalThis.omegaReactChat?.followLatest();render();
}
async function previousExchange(){const index=outline.findIndex(turn=>turn.id===selectedTurn);if(index>0)return jumpExchange(index-1);if(olderHistoryCursor)await switchHistoryPage('older')}
async function nextExchange(){const index=outline.findIndex(turn=>turn.id===selectedTurn);if(index>=0&&index<outline.length-1)return jumpExchange(index+1);if(newerHistoryCursors.length)await switchHistoryPage('newer')}
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
const transport=createOmegaTransport({fetchImpl:apiFetch,getKey:()=>key,deviceId,onUnauthorized:()=>{
  if(authenticated){
    authenticated = false; streamController?.abort(); clearInterval(refreshTimer); forgetSessionKey();
    globalThis.omegaAppState?.patch({authenticated:false,connected:false});
    $('connection').textContent = '○ 请重新连接'; $('token').value = ''; $('setup').showModal();
  }
}});
const api=transport.request,rpc=transport.rpc;
globalThis.omegaProductApi=api;
globalThis.omegaProductContext=()=>({threadId,active:{...active},authenticated});
globalThis.omegaSystem={backup:async()=>{const response=await transport.fetch('backup');if(!response.ok)throw new Error((await response.json()).error||'备份失败');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`omega-${new Date().toISOString().slice(0,10)}.omega-backup.gz`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},restore:async file=>{const response=await transport.fetch('restore',{method:'POST',headers:{'content-type':'application/gzip'},body:file});let result;try{result=await response.json()}catch{throw new Error('恢复接口响应异常')}if(!response.ok)throw new Error(result.error||'恢复失败');return result;}};
const preferences=createModelSettings({api,getThreadId:()=>threadId,isSending:()=>sending});
const groupUI=initGroups({api,rpc,error,closeDrawer:()=>ui.closeDrawer(),getWorkspace:()=>serverWorkspace||$('workspace').textContent,reactForm,
  openThread:id=>{groupUI.switchMode('chats');return select(id);},onModeChange:()=>renderApprovals(),markRead:(scope,id)=>api('read-state',{scope,id})});
function applyReadState(state){unreadThreads.clear();unreadThreadCounts.clear();unreadThreadPositions.clear();for(const id of state?.unread?.threads||[]){unreadThreads.add(id);unreadThreadCounts.set(id,state?.counts?.threads?.[id]||1);if(state?.positions?.threads?.[id])unreadThreadPositions.set(id,state.positions.threads[id]);}for(let index=sessionStorage.length-1;index>=0;index--){const name=sessionStorage.key(index);if(name?.startsWith('omega-group-unread:'))sessionStorage.removeItem(name);}for(const id of state?.unread?.groups||[])if(state?.positions?.groups?.[id])sessionStorage.setItem('omega-group-unread:'+id,state.positions.groups[id]);renderThreadSidebar();groupUI.applyReadState(state);}
async function syncReadState(){applyReadState(await api('read-state'));}
async function markThreadRead(id){if(!id)return;unreadThreads.delete(id);unreadThreadCounts.delete(id);unreadThreadPositions.delete(id);renderThreadSidebar();try{applyReadState(await api('read-state',{scope:'thread',id}));}catch{}}
$('mobile-new').onclick=()=>groupUI.newAction();
function renderComposer(){
  globalThis.omegaReactComposer?.render({sending,enabled:!!threadId,active:!!active[threadId],attachmentsReady:attachments.ready,attachments:attachments.records,workspace:composerWorkspace||serverWorkspace},{submit:sendMessage,stop:stopMessage,addFiles:files=>attachments.ingest(files),removeAttachment:index=>attachments.remove(index),openModelSettings:()=>preferences.open(),report:message=>error(message)});
}
function controls() { renderComposer();preferences.controls(); }
window.addEventListener('omega:react-composer-ready',controls);
function itemText(item) {
  if (item.pageText !== undefined) return item.pageText;
  if (item.type === 'userMessage') return (item.content || []).map(x => x.text || (x.type === 'image' ? '[图片]' : '')).join('\n');
  if (item.type === 'agentMessage') return item.text || '';
  if (item.type === 'commandExecution') return `$ ${item.command || ''}\n${item.aggregatedOutput || ''}\n${item.status || ''}`;
  if (item.type === 'fileChange') return (item.changes || []).map(x => `${x.path}\n${x.diff || ''}`).join('\n');
  if (item.type === 'reasoning') return [...(item.summary || []), ...(item.content || [])].join('\n');
  return JSON.stringify(item, null, 2);
}
function render() {
  if(!globalThis.omegaReactChat)return;
  renderMetrics();
  const values=[...items.values()].map(item=>({...item,open:expandedTools.has(item.id)}));
  attachments.prune();
  const actions={itemText,toggle:(item,open)=>{open?expandedTools.add(item.id):expandedTools.delete(item.id);if(open&&item.deferred)loadItem(item,0).catch(e=>error(e.message));},page:(item,offset)=>loadItem(item,offset).catch(e=>error(e.message)),attachImages:(item,slot)=>{slot.replaceChildren(attachments.historyImages(item.images));},selectTurn:jumpExchange,previous:()=>previousExchange().catch(e=>error(e.message)),next:()=>nextExchange().catch(e=>error(e.message)),latest:jumpLatest};
  globalThis.omegaReactChat.render({items:values,active:!!active[threadId],metrics:metricsPanel.hidden?'':metricsPanel.textContent,historyMode,history:{outline,selectedTurn,hasOlder:!!olderHistoryCursor,hasNewer:!!newerHistoryCursors.length}},actions);
}
window.addEventListener('omega:react-chat-ready',render);
async function list() {
  const revision = nameRevision;
  const result = await rpc('thread/list', { limit: 60, sourceKinds: [] });
  listedThreads=result.data.filter(thread=>!deletedThreads.has(thread.id));
  for (const thread of listedThreads) {
    if (revision === nameRevision && thread.name) threadNames.set(thread.id,thread.name);
  }
  renderThreadSidebar();
}
window.addEventListener('omega:react-workspace-ready',renderThreadSidebar);
async function loadItem(item, offset) {
  const version = selectionVersion;
  const result = await api('history',{threadId,turnId:selectedTurn,itemId:item.id,offset,selectionOnly:true});
  if (version !== selectionVersion) return;
  for (const entry of result.turn?.items || []) items.set(entry.id,entry);
  render();
}
async function switchHistoryPage(direction) {
  const selected=threadId;if(!selected)return;
  const targetCursor=direction==='older'?olderHistoryCursor:newerHistoryCursors.at(-1);
  if(direction==='older'&&!targetCursor)return;
  const version=++selectionVersion;
  const result=await api('history',{threadId:selected,cursor:targetCursor||undefined,outlineOnly:true});
  if(version!==selectionVersion||selected!==threadId)return;
  if(direction==='older')newerHistoryCursors.push(historyCursor);
  else newerHistoryCursors.pop();
  historyCursor=targetCursor||null;olderHistoryCursor=result.nextCursor||null;outline=result.outline||[];
  if(!outline.length){render();return;}
  selectedTurn=outline[direction==='older'?outline.length-1:0].id;
  historyMode=historyCursor!==null||selectedTurn!==outline.at(-1)?.id;
  items.clear();expandedTools.clear();turnModel=null;setMetrics(null);render();
  selectionVersion++;await hydrate();
}
async function hydrate() {
  const version = selectionVersion, selected = threadId;
  const revision = metricsRevision;
  if (!selected || loading === version + 1) return;
  loading = version + 1;
  try {
    const result = await api('history',{threadId:selected,turnId:historyMode ? selectedTurn : undefined,selectionOnly:historyMode||undefined});
    if (version !== selectionVersion || selected !== threadId) return;
    if(Array.isArray(result.outline)){outline=result.outline;historyCursor=null;olderHistoryCursor=result.nextCursor||null;newerHistoryCursors=[];}
    selectedTurn = result.turn?.id;
    preferences.apply(result.settings);
    turnModel=result.turn?.modelSettings||null;
    const newer = recentMetrics.get(selectedTurn);
    if (newer && newer.revision > revision) setMetrics(newer.metrics,newer.receivedAt);
    else setMetrics(result.turn?.metrics || null);
    items = new Map((result.turn?.items || []).map(item => [item.id,item]));
    $('title').textContent = threadNames.get(selected) || result.thread.name || result.thread.preview || '新会话';
    composerWorkspace=result.thread.cwd;$('workspace').textContent=result.thread.cwd;
    render(); controls();
  } finally { if (version === selectionVersion) loading = false; }
}
async function select(id, closeMenu=true) {
  if(deletedThreads.has(id))return;
  if(closeMenu)ui.closeDrawer();
  const version = ++selectionVersion;
  turnModel=null;if(closeMenu)preferences.reset();
  historyMode = false; selectedTurn = null; outline = [];historyCursor=null;olderHistoryCursor=null;newerHistoryCursors=[];
  recentMetrics.clear();
  setMetrics(null);
  attachments.clear();
  threadId = id; rememberThread(id); items.clear(); expandedTools.clear();
  streamController?.abort(); streamController = new AbortController(); stream(streamController.signal);
  globalThis.omegaReactChat?.followLatest();render(); renderApprovals(); controls();
  await rpc('thread/resume', { threadId: id }, {summaryOnly:true});
  if (version !== selectionVersion) return;
  await hydrate(); await list(); controls();
  await markThreadRead(id);
}
async function selectAt(id,turnId=null){await select(id);if(!turnId||turnId===selectedTurn)return;historyMode=true;selectedTurn=turnId;items.clear();expandedTools.clear();turnModel=null;setMetrics(null);selectionVersion++;await hydrate();}
globalThis.omegaNavigation={openThread:selectAt};
function renderApprovals() {
  const visible=approvals.filter(x => groupUI.isGroupMode() || !x.params?.threadId || x.params.threadId === threadId);
  globalThis.omegaReactApprovals?.render(visible,{resolve:(id,result)=>api('answer',{id,result}),report:message=>error(message)});
}
window.addEventListener('omega:react-approvals-ready',renderApprovals);
function event(message) {
  const { method, params: p = {} } = message;
  if(method==='omega/reconnected'){$('connection').textContent='● 已连接';globalThis.omegaAppState?.patch({connected:true});error('');resumeConnection();return;}
  if (['thread/deleted','omega/thread-deleted'].includes(method)) { removeThread(p.threadId); return; }
  if(method==='omega/group-updated'){groupUI.onGroupUpdated(p.groupId);return;}
  if(method==='omega/group-deleted'){groupUI.onGroupDeleted(p.groupId);return;}
  if(method==='omega/read-state'){if(p.scope==='thread'){unreadThreads.delete(p.id);unreadThreadCounts.delete(p.id);unreadThreadPositions.delete(p.id);renderThreadSidebar();}else{sessionStorage.removeItem('omega-group-unread:'+p.id);groupUI.onReadState(p);}return;}
  if(method==='omega/unread'){if(p.scope==='thread'){unreadThreads.add(p.id);unreadThreadCounts.set(p.id,p.count||1);if(p.position&&!unreadThreadPositions.has(p.id))unreadThreadPositions.set(p.id,p.position);renderThreadSidebar();}else{if(p.position&&!sessionStorage.getItem('omega-group-unread:'+p.id))sessionStorage.setItem('omega-group-unread:'+p.id,p.position);groupUI.onUnread(p);}return;}
  if (deletedThreads.has(p.threadId)) return;
  if(method==='omega/model-settings'){if(p.threadId===threadId)preferences.apply(p.settings);return;}
  if(method==='omega/turn-model'){if(p.threadId===threadId&&p.turnId===selectedTurn){turnModel=p.settings;renderMetrics();}return;}
  if (method === 'omega/turn-metrics') {
    if (p.threadId === threadId) {
      metricsRevision++;
      recentMetrics.delete(p.turnId); recentMetrics.set(p.turnId,{metrics:p.metrics,receivedAt:Date.now(),revision:metricsRevision});
      if (recentMetrics.size>8) recentMetrics.delete(recentMetrics.keys().next().value);
      if(p.turnId === selectedTurn) setMetrics(p.metrics);
    }
    return;
  }
  if (method === 'omega/thread-renamed') { applyThreadName(p.threadId,p.name); return; }
  if (method === 'omega/snapshot') { active = p.active; approvals = p.approvals;if(Number.isSafeInteger(p.eventCursor)&&p.eventCursor>=0)lastEventId=p.eventCursor;applyReadState(p.readState); renderApprovals(); controls(); hydrate().catch(e => error(e.message)); return; }
  if (method === 'omega/disconnected') { globalThis.omegaAppState?.patch({connected:false});error(p.message); return; }
  if (message.id !== undefined) { approvals.push(message); renderApprovals(); return; }
  if (method === 'serverRequest/resolved') { approvals = approvals.filter(x => String(x.id) !== String(p.requestId)); renderApprovals(); }
  if (method === 'turn/started') active[p.threadId] = p.turn.id;
  if (method === 'turn/completed') { delete active[p.threadId]; if(p.threadId===threadId&&!groupUI.isGroupMode()&&!document.hidden)markThreadRead(p.threadId); if (p.turn.error) error(p.turn.error.message); list().catch(()=>{}); if(globalThis.omegaDesktop?.notify)globalThis.omegaDesktop.notify({title:p.turn?.status==='completed'?'Omega 已完成':'Omega 需要处理',body:p.turn?.error?.message||'会话任务已经结束',threadId:p.threadId}); }
  controls();
  if (p.threadId !== threadId) return;
  if (historyMode) return;
  if (method === 'turn/started') { selectionVersion++; items.clear(); expandedTools.clear(); selectedTurn = p.turn.id; turnModel=p.turn.modelSettings||null; setMetrics(null); scheduleRender(); }

  if (method === 'item/started' || method === 'item/completed') {
    const source = p.item, text = itemText(source);
    const chat = ['userMessage','agentMessage'].includes(source.type);
    const item = {id:source.id,type:source.type,status:source.status,images:source.images || [],pageText:chat ? text.slice(0,12000) : '',
      totalLength:text.length,offset:0,deferred:!chat};
    items.set(item.id,item); scheduleRender();
  }
  if (method === 'item/agentMessage/delta') { const item = items.get(p.itemId) || { id:p.itemId,type:'agentMessage',text:'' }; if (item.pageText !== undefined) { item.text = item.pageText; delete item.pageText; } item.text = ((item.text || '') + p.delta).slice(-12000); items.set(item.id,item); scheduleRender(); }
  if (method === 'item/commandExecution/outputDelta') { const item = items.get(p.itemId); if (item) { item.aggregatedOutput = ((item.aggregatedOutput || '') + p.delta).slice(-12000); scheduleRender(); } }
  if (method === 'turn/completed') hydrate().catch(e => error(e.message));
}
async function stream(signal) {
  while (!signal.aborted) {
    try {
      const response = await transport.fetch('events?threadId=' + encodeURIComponent(threadId || ''), { headers: lastEventId?{'last-event-id':String(lastEventId)}:{}, signal });
      if (!response.ok) throw new Error('连接被拒绝，请检查访问密钥'); $('connection').textContent = '● 已连接';globalThis.omegaAppState?.patch({connected:true});
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
      while (true) { const {value,done} = await reader.read(); if (done) break; buffer += value; let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2); const lines=block.split('\n'),idLine=lines.find(x=>x.startsWith('id: ')),line = lines.find(x => x.startsWith('data: ')); if(idLine){const next=Number(idLine.slice(4));if(Number.isSafeInteger(next)&&next>0)lastEventId=Math.max(lastEventId,next);} if (line) event(JSON.parse(line.slice(6))); } }
    } catch (e) { if (signal.aborted) return; $('connection').textContent = '○ 正在重连';globalThis.omegaAppState?.patch({connected:false}); }
    await new Promise(resolve => setTimeout(resolve,2000));
  }
}
async function connect() {
  error(''); const status = await api('status'); if (!status.ready) throw new Error('Codex App Server 尚未就绪');
  if (!native) await rememberKey(key);
  serverWorkspace=status.workspace;composerWorkspace=status.workspace;$('workspace').textContent = status.workspace; active = status.active; approvals = status.approvals;
  authenticated = true; canChangeKey = status.canChangeKey !== false;
  globalThis.omegaAppState?.patch({authenticated:true,connected:true});
  streamController?.abort(); streamController = new AbortController(); stream(streamController.signal);
  await syncReadState();await list(); if (threadId) await select(threadId,false); renderApprovals(); controls();
  clearInterval(refreshTimer); refreshTimer = setInterval(async () => { try { const s = await api('status'); active=s.active; approvals=s.approvals; $('devices').textContent = `${s.devices} 台在线设备`; controls(); if(groupUI.isGroupMode())groupUI.refresh().catch(()=>{}); } catch {} },15000);
}
async function openConnection(){if(native){const setup=$('setup');if(!setup.open)setup.showModal();return;}await reactForm({id:'setup',title:'欢迎来到 Omega',description:'输入服务器的个人访问密钥。它只会保存在当前设备的安全存储中。',fields:[{name:'accessKey',id:'token',label:'访问密钥',type:'password',required:true}],submitLabel:'连接 →',onSubmit:async values=>{key=values.accessKey.trim();await connect();}}).catch(e=>error(e.message));}
if(native)$('connect-form').onsubmit=event=>{event.preventDefault();native.prepareConnection($('token').value.trim());};
$('settings').onclick=async()=>{if(!authenticated)return openConnection();if(native)return $('key-settings').showModal();if(!canChangeKey)return reactForm({id:'key-settings',title:'连接设置',description:'当前密钥由服务器环境变量管理，不能在页面中修改。',readOnly:true,submitLabel:'关闭'});await reactForm({id:'key-settings',title:'修改访问密钥',description:'保存后立即生效，其他设备需要使用新密钥重新连接。',fields:[{name:'accessKey',id:'new-key',label:'新密钥',type:'password',required:true,value:'',help:'至少 8 位'}],submitLabel:'保存密钥',onSubmit:async values=>{const next=values.accessKey;await api('access-key',{accessKey:next});key=next;streamController?.abort();streamController=new AbortController();stream(streamController.signal);$('connection').textContent='● 密钥已保存';await rememberKey(key);}});};
$('new').onclick=()=>reactForm({id:'create',title:'新建会话',description:'文件与执行结果保存在此服务器目录。',fields:[{name:'cwd',id:'cwd',label:'服务器工作目录',value:serverWorkspace,required:true}],submitLabel:'开始工作 →',onSubmit:async values=>{const result=await rpc('thread/start',{cwd:values.cwd});await select(result.thread.id);}}).catch(e=>error(e.message));
async function sendMessage(value) {
  const text=value.trim(), imageIds=attachments.ids, target=threadId;
  if ((!text && !imageIds.length) || !target || sending || !attachments.ready || active[target]) return false;
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
    if (target === threadId) attachments.clear();
    return true;
  } catch(e) {
    if(e.status===409&&/模型设置/.test(e.message)){pendingSubmission=null;try{await preferences.refresh();}catch{} error(e.message+'；本次未发送。');}
    else error(e.message + (requested ? '；请求可能已到达服务端，请先核对会话，勿立即重复发送。' : '；消息未发送，请修正后重试。'));
    return false;
  }
  finally { sending = false; attachments.refresh();controls(); }
}
async function stopMessage(){try{await rpc('turn/interrupt',{threadId,turnId:active[threadId]})}catch(e){error(e.message)}}
// Resuming only resyncs server state; never re-submits a message or clears the composer.
let resumeTimer, resuming = false;
function resumeConnection() {
  clearTimeout(resumeTimer);
  if (!authenticated || document.hidden) return;
  resumeTimer=setTimeout(async()=>{
    if(resuming || !authenticated || document.hidden)return;
    resuming=true;
    try {
      streamController?.abort(); streamController=new AbortController(); stream(streamController.signal);
      const status=await api('status'); active=status.active; approvals=status.approvals;
      await list(); if(threadId)await hydrate(); if(groupUI.isGroupMode())await groupUI.refresh(); renderApprovals(); controls();
    } catch(e) { error(e.message); }
    finally { resuming=false; }
  },250);
}
if(native) {
  document.addEventListener('visibilitychange',()=>{if(document.hidden)streamController?.abort();else resumeConnection();});
  window.addEventListener('online',resumeConnection);
  window.addEventListener('focus',resumeConnection);
}
controls(); if (key) connect().catch(e=>{error(e.message);openConnection();}); else openConnection();
