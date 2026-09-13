import { markdownBody } from './markdown.js';
import { createAttachments } from './attachments.js';
import { initUI, iconButton } from './ui.js';
import { createModelSettings, effortLabel } from './model-settings.js';
import { native, apiFetch, initialKey, rememberKey, forgetSessionKey, savedThread, rememberThread } from './platform.js';
import { initGroups } from './groups.js';
const $ = id => document.getElementById(id);
const ui = initUI();
let key = initialKey(), threadId = savedThread(), active = {}, approvals = [], items = new Map(), streamController, refreshTimer, loading = false;
let authenticated = false, canChangeKey = true;
let followLatest = true, exchanges = [], selectionVersion = 0;
const expandedTools = new Set();
const messageNodes = new Map();
const typingIndicator = document.createElement('div');
typingIndicator.className = 'omega-typing';
typingIndicator.setAttribute('role','status');
typingIndicator.setAttribute('aria-label','Omega 正在处理');
const typingAvatar = document.createElement('span'); typingAvatar.className = 'typing-avatar'; typingAvatar.textContent = 'Ω';
const typingBubble = document.createElement('span'); typingBubble.className = 'typing-bubble';
const typingLabel = document.createElement('span'); typingLabel.className = 'typing-label'; typingLabel.textContent = 'OMEGA 正在处理';
const typingDots = document.createElement('span'); typingDots.className = 'typing-dots';
for(let i=0;i<3;i++)typingDots.append(document.createElement('i'));
typingBubble.append(typingLabel,typingDots); typingIndicator.append(typingAvatar,typingBubble);
const threadNames = new Map();
let renameTarget = null, renaming = false, nameRevision = 0;
const deletedThreads = new Set();
let deleteTarget = null, deleting = false;
function removeThread(id) {
  deletedThreads.add(id);
  threadNames.delete(id); nameRevision++;
  for (const row of [...$('threads').children]) if(row.dataset.threadId===id)row.remove();
  if (threadId !== id) return;
  selectionVersion++; threadId=null; selectedTurn=null; outline=[]; historyMode=false; loading=false;
  preferences.reset();
  rememberThread(null); items.clear(); expandedTools.clear(); recentMetrics.clear(); setMetrics(null);
  $('history-select').replaceChildren(); $('title').textContent='选择或新建会话';
  // Preserve unsent text and attachments, including on another device.
  pendingSubmission=null; render(); renderApprovals(); controls();
  streamController?.abort(); streamController=new AbortController(); stream(streamController.signal);
  error('会话已删除。未发送的文字仍保留，请选择或新建会话。');
}
function openDelete(thread) {
  deleteTarget=thread.id;
  $('delete-name').textContent=threadNames.get(thread.id)||thread.name||thread.preview||'新会话';
  $('delete-error').textContent='';
  $('delete-dialog').showModal(); $('delete-cancel').focus();
}
$('delete-cancel').onclick=()=>{if(!deleting)$('delete-dialog').close();};
$('delete-dialog').addEventListener('cancel',e=>{if(deleting)e.preventDefault();});
$('delete-form').onsubmit=async e=>{
  e.preventDefault(); if(deleting)return;
  const id=deleteTarget;
  if(sending){$('delete-error').textContent='消息正在提交，请稍后再删除';return;}
  deleting=true; $('delete-confirm').disabled=true; $('delete-cancel').disabled=true; $('delete-error').textContent='';
  try {
    await rpc('thread/delete',{threadId:id},{confirmDelete:true});
    removeThread(id); $('delete-dialog').close();
  } catch(e){$('delete-error').textContent=e.message;}
  finally{deleting=false;$('delete-confirm').disabled=false;$('delete-cancel').disabled=false;}
};
function applyThreadName(id,name) {
  nameRevision++; threadNames.set(id,name);
  for (const row of $('threads').children) {
    if (row.dataset.threadId !== id) continue;
    const button = row.querySelector('.thread-open');
    button.textContent = name; button.title = name;
    row.querySelector('.thread-rename').setAttribute('aria-label','重命名 '+name);
    row.querySelector('.thread-delete')?.setAttribute('aria-label','删除 '+name);
  }
  if (threadId === id) $('title').textContent = name;
}
function openRename(thread) {
  renameTarget = thread.id;
  $('rename-name').value = threadNames.get(thread.id) || thread.name || thread.preview?.slice(0,80) || '';
  $('rename-error').textContent = '';
  $('rename-dialog').showModal(); $('rename-name').focus(); $('rename-name').select();
}
$('rename-cancel').onclick = () => { if (!renaming) $('rename-dialog').close(); };
$('rename-dialog').addEventListener('cancel',e => { if (renaming) e.preventDefault(); });
$('rename-form').onsubmit = async e => {
  e.preventDefault(); if (renaming) return;
  const name = $('rename-name').value.trim(), id = renameTarget;
  if (!name || name.length > 80) { $('rename-error').textContent = '请输入 1–80 个字符的会话名称'; return; }
  renaming = true; $('rename-save').disabled = true; $('rename-cancel').disabled = true; $('rename-name').disabled = true;
  $('rename-error').textContent = '';
  try {
    const result = await rpc('thread/name/set',{threadId:id,name});
    applyThreadName(result.threadId,result.name); $('rename-dialog').close();
  } catch(e) { $('rename-error').textContent = e.message; }
  finally { renaming = false; $('rename-save').disabled = false; $('rename-cancel').disabled = false; $('rename-name').disabled = false; }
};
let outline = [], selectedTurn = null, historyMode = false, renderTimer, sending = false;
let turnMetrics = null, metricsReceivedAt = 0, metricsRevision = 0;
let turnModel=null;
const recentMetrics = new Map();
const metricsPanel = document.createElement('div'); metricsPanel.className = 'turn-metrics'; metricsPanel.id = 'turn-metrics';
metricsPanel.setAttribute('aria-label','本轮统计');
metricsPanel.title = '整轮耗时包含思考、工具执行和等待；平均速度为输出 token / 整轮耗时，不是纯模型生成速度。缓存和思考是用量细分，不重复相加。';
function setMetrics(value, receivedAt=Date.now()) { turnMetrics=value; metricsReceivedAt=receivedAt; renderMetrics(); }
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
setInterval(()=>{if(turnMetrics?.running && !document.hidden)renderMetrics();},1000);
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

function updateHistoryPosition() {
  const area = $('messages');
  followLatest = area.scrollHeight - area.scrollTop - area.clientHeight < 60;
  $('floating-latest').hidden = followLatest || !items.size;
  const index = outline.findIndex(t => t.id === selectedTurn);
  $('history-select').value = String(index);
  $('prev-exchange').disabled = index <= 0;
  $('next-exchange').disabled = index < 0 || index >= outline.length - 1;
  $('floating-latest').hidden = !historyMode && followLatest;
}
function jumpExchange(index) {
  if (!outline[index]) return;
  historyMode = index !== outline.length - 1;
  selectedTurn = outline[index].id; items.clear(); expandedTools.clear();
  turnModel=null;setMetrics(null);
  selectionVersion++; followLatest = false;
  hydrate().catch(e => error(e.message));
}
function jumpLatest() {
  if (historyMode) { historyMode = false; selectedTurn = null; turnModel=null; selectionVersion++; items.clear(); hydrate().catch(e => error(e.message)); }
  followLatest = true; $('messages').scrollTop = $('messages').scrollHeight; updateHistoryPosition();
}
$('messages').addEventListener('scroll', updateHistoryPosition);
$('history-select').onchange = e => jumpExchange(Number(e.target.value));
$('prev-exchange').onclick = () => jumpExchange(Number($('history-select').value) - 1);
$('next-exchange').onclick = () => jumpExchange(Number($('history-select').value) + 1);
$('jump-latest').onclick = jumpLatest;
$('floating-latest').onclick = jumpLatest;
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
async function api(route, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),70000);
  try {
  const response = await apiFetch('/api/' + route, { signal:controller.signal, method: data ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(data ? { 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  if (response.status === 401 && authenticated) {
    authenticated = false; streamController?.abort(); clearInterval(refreshTimer); forgetSessionKey();
    $('connection').textContent = '○ 请重新连接'; $('token').value = ''; $('setup').showModal();
  }
  let result;
  try { result = await response.json(); }
  catch(e) { if (controller.signal.aborted) throw e; throw new Error('服务器响应格式异常（HTTP '+response.status+'），请检查网络或 FRP 转发'); }
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status}); return result;
  } catch(e) {
    if (controller.signal.aborted) throw new Error('请求等待超过 70 秒，结果尚未确认');
    throw e;
  } finally { clearTimeout(timer); }
}
const rpc = (method, params = {}, extra = {}) => api('rpc', { method, params, ...extra });
const preferences=createModelSettings({api,getThreadId:()=>threadId,isSending:()=>sending});
const groupUI=initGroups({api,rpc,error,closeDrawer:()=>ui.closeDrawer(),getWorkspace:()=>$('cwd').value||$('workspace').textContent,
  openThread:id=>{groupUI.switchMode('chats');return select(id);},onModeChange:()=>renderApprovals()});
$('mobile-new').onclick=()=>groupUI.newAction();
function controls() { $('stop').hidden = !active[threadId]; $('send').disabled = sending || !attachments.ready || !!active[threadId] || !threadId; preferences.controls(); }
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
  const area = $('messages'), oldTop = area.scrollTop, stick = followLatest;
  const anchor = [...area.querySelectorAll('[data-item-id]')].find(el => el.getBoundingClientRect().bottom > area.getBoundingClientRect().top);
  const anchorId = anchor?.dataset.itemId, anchorTop = anchor?.getBoundingClientRect().top;
  for (const detail of area.querySelectorAll('details[data-item-id]')) {
    detail.open ? expandedTools.add(detail.dataset.itemId) : expandedTools.delete(detail.dataset.itemId);
  }
  area.replaceChildren();
  exchanges = [];
  let group;
  for (const item of items.values()) {
    if (!group || item.type === 'userMessage') {
      group = document.createElement('section'); group.className = 'exchange';
      exchanges.push(group); area.append(group);
    }
    const signature = JSON.stringify(item);
    const cached = messageNodes.get(item.id);
    if (cached?.signature === signature) { group.append(cached.node); continue; }
    const chat = ['userMessage','agentMessage'].includes(item.type);
    const el = document.createElement(chat ? 'article' : 'details');
    el.dataset.itemId = item.id;
    el.className = chat ? 'message ' + (item.type === 'userMessage' ? 'user' : 'assistant') : 'tool-disclosure';
    if (chat) {
      const label = document.createElement('span'); label.className = 'role'; label.textContent = item.type === 'userMessage' ? '你' : 'Ω OMEGA';
      const body = item.type === 'agentMessage' ? markdownBody(itemText(item)) : document.createElement('div');
      if (item.type === 'userMessage') body.textContent = itemText(item);
      body.classList.add('bubble'); el.append(label, body);
      if (item.images?.length) el.append(attachments.historyImages(item.images));
      if (item.totalLength > 12000) {
        const pager = document.createElement('div');
        for (const [label, offset] of [['上一段',(item.offset || 0)-12000],['下一段',(item.offset || 0)+12000]]) {
          const button = document.createElement('button'); button.textContent = label;
          button.disabled = offset < 0 || offset >= item.totalLength;
          button.onclick = () => loadItem(item,offset).catch(e => error(e.message)); pager.append(button);
        }
        el.append(pager);
      }
    } else {
      const summary = document.createElement('summary');
      summary.textContent = ({commandExecution:'命令执行',fileChange:'文件修改',reasoning:'思考过程'})[item.type] || '执行详情';
      if (item.status) summary.textContent += ' · ' + item.status;
      const detail = document.createElement('pre'); detail.textContent = item.deferred ? '点击展开加载内容' : itemText(item);
      el.open = expandedTools.has(item.id);
      el.ontoggle = () => { if (!el.isConnected) return; el.open ? expandedTools.add(item.id) : expandedTools.delete(item.id); if (el.open && item.deferred) loadItem(item,0).catch(e => error(e.message)); };
      el.append(summary, detail);
      if (!item.deferred && item.totalLength > 12000) {
        for (const [label, offset] of [['上一段',(item.offset || 0)-12000],['下一段',(item.offset || 0)+12000]]) {
          const button = document.createElement('button'); button.textContent = label;
          button.disabled = offset < 0 || offset >= item.totalLength;
          button.onclick = () => loadItem(item,offset).catch(e => error(e.message)); el.append(button);
        }
      }
    }
    messageNodes.set(item.id,{signature,node:el});
    group.append(el);
  }
  for (const id of messageNodes.keys()) if (!items.has(id)) messageNodes.delete(id);
  attachments.prune();
  renderMetrics(); area.append(metricsPanel);
  if (active[threadId] && !historyMode) area.append(typingIndicator);
  if (!items.size) { const p = document.createElement('p'); p.className = 'chat-empty'; p.textContent = '在下方发送消息，开始新的工作。'; area.append(p); }
  $('history-select').disabled = !exchanges.length;
  if (stick) area.scrollTop = area.scrollHeight;
  else {
    area.scrollTop = oldTop;
    const restored = [...area.querySelectorAll('[data-item-id]')].find(el => el.dataset.itemId === anchorId);
    if (restored) area.scrollTop += restored.getBoundingClientRect().top - anchorTop;
  }
  updateHistoryPosition();
}
async function list() {
  const revision = nameRevision;
  const result = await rpc('thread/list', { limit: 60, sourceKinds: [] }); $('threads').replaceChildren();
  for (const thread of result.data) {
    if(deletedThreads.has(thread.id))continue;
    if (revision === nameRevision && thread.name) threadNames.set(thread.id,thread.name);
    const name = threadNames.get(thread.id) || thread.name || thread.preview || '新会话';
    const row = document.createElement('div'); row.className = 'thread-row'; row.dataset.threadId = thread.id; row.classList.toggle('selected',thread.id === threadId);
    const button = document.createElement('button'); button.className = 'thread-open'; button.textContent = name; button.title = name;
    button.onclick = () => select(thread.id).catch(e => error(e.message));
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'thread-rename'; iconButton(edit,'edit'); edit.title = '重命名';
    edit.setAttribute('aria-label','重命名 '+name); edit.onclick = () => openRename(thread);
    const remove=document.createElement('button');remove.type='button';remove.className='thread-delete';iconButton(remove,'trash');remove.title='删除会话';remove.setAttribute('aria-label','删除 '+name);remove.onclick=()=>openDelete(thread);
    row.append(button,edit,remove); $('threads').append(row);
  }
}
async function loadItem(item, offset) {
  const version = selectionVersion;
  const result = await api('history',{threadId,turnId:selectedTurn,itemId:item.id,offset});
  if (version !== selectionVersion) return;
  for (const entry of result.turn?.items || []) items.set(entry.id,entry);
  render();
}
async function hydrate() {
  const version = selectionVersion, selected = threadId;
  const revision = metricsRevision;
  if (!selected || loading === version + 1) return;
  loading = version + 1;
  try {
    const result = await api('history',{threadId:selected,turnId:historyMode ? selectedTurn : undefined});
    if (version !== selectionVersion || selected !== threadId) return;
    outline = result.outline; selectedTurn = result.turn?.id;
    preferences.apply(result.settings);
    turnModel=result.turn?.modelSettings||null;
    const newer = recentMetrics.get(selectedTurn);
    if (newer && newer.revision > revision) setMetrics(newer.metrics,newer.receivedAt);
    else setMetrics(result.turn?.metrics || null);
    items = new Map((result.turn?.items || []).map(item => [item.id,item]));
    $('history-select').replaceChildren(...outline.map((turn,index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = (index+1)+'. '+turn.label; return option;
    }));
    $('title').textContent = threadNames.get(selected) || result.thread.name || result.thread.preview || '新会话';
    $('workspace').textContent = result.thread.cwd;
    render(); controls();
  } finally { if (version === selectionVersion) loading = false; }
}
async function select(id, closeMenu=true) {
  if(deletedThreads.has(id))return;
  if(closeMenu)ui.closeDrawer();
  const version = ++selectionVersion;
  turnModel=null;if(closeMenu)preferences.reset();
  historyMode = false; selectedTurn = null; outline = [];
  recentMetrics.clear();
  setMetrics(null);
  attachments.clear();
  threadId = id; rememberThread(id); items.clear(); expandedTools.clear();
  streamController?.abort(); streamController = new AbortController(); stream(streamController.signal);
  followLatest = true; render(); renderApprovals(); controls();
  await rpc('thread/resume', { threadId: id }, {summaryOnly:true});
  if (version !== selectionVersion) return;
  await hydrate(); await list(); controls();
}
function renderApprovals() {
  $('approvals').replaceChildren();
  for (const request of approvals.filter(x => groupUI.isGroupMode() || !x.params?.threadId || x.params.threadId === threadId)) {
    const box = document.createElement('div'); box.className = 'approval'; const title = document.createElement('strong'); title.textContent = '需要你的决定'; const detail = document.createElement('pre'); detail.textContent = request.params.command || request.params.reason || JSON.stringify(request.params, null, 2); box.append(title, detail);
    const send = async result => { try { await api('answer', { id: request.id, result }); } catch (e) { error(e.message); } };
    if (/item\/(commandExecution|fileChange)\/requestApproval/.test(request.method)) {
      for (const [label, decision] of [['允许本次','accept'],['拒绝','decline']]) { const button = document.createElement('button'); button.textContent = label; button.onclick = () => send({ decision }); box.append(button); }
    } else if (request.method === 'item/tool/requestUserInput') {
      const inputs = []; for (const q of request.params.questions || []) { const label = document.createElement('label'); label.textContent = q.question; const input = document.createElement('input'); input.placeholder = (q.options || []).map(o => o.label).join(' / '); label.append(input); box.append(label); inputs.push([q.id,input]); }
      const button = document.createElement('button'); button.textContent = '提交回答'; button.onclick = () => send({ answers: Object.fromEntries(inputs.map(([id,input]) => [id,{answers:[input.value]}])) }); box.append(button);
    } else { const p = document.createElement('p'); p.textContent = '此请求类型暂不支持，请停止当前任务。'; box.append(p); }
    $('approvals').append(box);
  }
}
function event(message) {
  const { method, params: p = {} } = message;
  if (['thread/deleted','omega/thread-deleted'].includes(method)) { removeThread(p.threadId); return; }
  if(method==='omega/group-updated'){groupUI.onGroupUpdated(p.groupId);return;}
  if(method==='omega/group-deleted'){groupUI.onGroupDeleted(p.groupId);return;}
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
  if (method === 'omega/snapshot') { active = p.active; approvals = p.approvals; renderApprovals(); controls(); hydrate().catch(e => error(e.message)); return; }
  if (method === 'omega/disconnected') { error(p.message); return; }
  if (message.id !== undefined) { approvals.push(message); renderApprovals(); return; }
  if (method === 'serverRequest/resolved') { approvals = approvals.filter(x => String(x.id) !== String(p.requestId)); renderApprovals(); }
  if (method === 'turn/started') active[p.threadId] = p.turn.id;
  if (method === 'turn/completed') { delete active[p.threadId]; if (p.turn.error) error(p.turn.error.message); list().catch(()=>{}); }
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
      const response = await apiFetch('/api/events?threadId=' + encodeURIComponent(threadId || ''), { headers: { authorization:`Bearer ${key}` }, signal });
      if (!response.ok) throw new Error('连接被拒绝，请检查访问密钥'); $('connection').textContent = '● 已连接';
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
      while (true) { const {value,done} = await reader.read(); if (done) break; buffer += value; let boundary; while ((boundary = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2); const line = block.split('\n').find(x => x.startsWith('data: ')); if (line) event(JSON.parse(line.slice(6))); } }
    } catch (e) { if (signal.aborted) return; $('connection').textContent = '○ 正在重连'; }
    await new Promise(resolve => setTimeout(resolve,2000));
  }
}
async function connect() {
  error(''); const status = await api('status'); if (!status.ready) throw new Error('Codex App Server 尚未就绪');
  if (!native) await rememberKey(key);
  $('cwd').value = status.workspace; $('workspace').textContent = status.workspace; active = status.active; approvals = status.approvals;
  authenticated = true; canChangeKey = status.canChangeKey !== false;
  streamController?.abort(); streamController = new AbortController(); stream(streamController.signal);
  await list(); if (threadId) await select(threadId,false); renderApprovals(); controls();
  clearInterval(refreshTimer); refreshTimer = setInterval(async () => { try { const s = await api('status'); active=s.active; approvals=s.approvals; $('devices').textContent = `${s.devices} 个在线窗口`; controls(); if(groupUI.isGroupMode())groupUI.refresh().catch(()=>{}); } catch {} },15000);
}
function showKeySummary(saved = false) {
  $('key-summary').hidden = false;
  $('key-form').hidden = true;
  $('key-title').textContent = '连接设置';
  $('key-status').textContent = !canChangeKey ? '当前密钥由服务器环境变量管理。' : saved ? '密钥已保存，刷新页面无需重新设置。其他设备请用新密钥连接。' : '无需重复设置；只有更换密钥时才需要修改。';
  $('edit-key').disabled = !canChangeKey;
  $('key-error').textContent = '';
  $('new-key').value = '';
  $('new-key').type = 'password';
  $('show-key').checked = false;
}
$('settings').onclick = () => {
  if (!authenticated) return $('setup').showModal();
  showKeySummary();
  $('key-settings').showModal();
};
$('edit-key').onclick = () => {
  $('key-summary').hidden = true;
  $('key-form').hidden = false;
  $('key-title').textContent = '修改访问密钥';
  $('save-key').disabled = !canChangeKey;
  $('new-key').focus();
};
$('key-close').onclick = () => $('key-settings').close();
$('key-cancel').onclick = () => showKeySummary();
$('generate-key').onclick = () => { $('new-key').value = [...crypto.getRandomValues(new Uint8Array(8))].map(x=>x.toString(16).padStart(2,'0')).join(''); };
$('show-key').onchange = () => { $('new-key').type = $('show-key').checked ? 'text' : 'password'; };
$('key-form').onsubmit = async e => {
  e.preventDefault(); const next = $('new-key').value; $('save-key').disabled = true; $('key-error').textContent = '';
  try {
    await api('access-key',{accessKey:next});
    key = next;
    streamController?.abort(); streamController = new AbortController(); stream(streamController.signal);
    showKeySummary(true); error('');
    $('connection').textContent = '● 密钥已保存';
    try { await rememberKey(key); }
    catch { $('key-status').textContent='服务端密钥已更改，但本机安全保存失败。请记住新密钥，下次启动需要重新填写。'; }
  } catch(e) { $('key-error').textContent = e.message; }
  finally { $('save-key').disabled = !canChangeKey; }
};
$('connect-form').onsubmit = async e => {
  e.preventDefault();
  if (native) return native.prepareConnection($('token').value.trim());
  key=$('token').value.trim();
  try { await connect(); $('setup').close(); } catch(e) { error(e.message); $('setup').close(); }
};
$('new').onclick = () => $('create').showModal();
$('create-cancel').onclick = () => $('create').close();
$('create-close').onclick = () => $('create').close();
$('create-form').onsubmit = async e => { e.preventDefault(); try { const result=await rpc('thread/start',{cwd:$('cwd').value}); $('create').close(); await select(result.thread.id); } catch(e) { $('create').close(); error(e.message); } };
$('composer').onsubmit = async e => {
  e.preventDefault();
  const text=$('prompt').value.trim(), imageIds=attachments.ids, target=threadId;
  if ((!text && !imageIds.length) || !target || sending || !attachments.ready || active[target]) return;
  sending = true;
  let requested = false;
  try {
    attachments.refresh(); $('send').textContent = '提交中…'; jumpLatest(); error(''); controls();
    const fingerprint = JSON.stringify({target,text,imageIds});
    if (pendingSubmission?.fingerprint !== fingerprint) pendingSubmission = {fingerprint,id:submissionId(),settingsRevision:preferences.revision};
    const id = pendingSubmission.id;
    requested = true;
    await rpc('turn/start',{threadId:target,input:text ? [{type:'text',text}] : []},{submissionId:id,imageIds,settingsRevision:pendingSubmission.settingsRevision});
    pendingSubmission = null;
    if (target === threadId) { $('prompt').value=''; attachments.clear(); ui.closeEditor(); ui.resizePrompt(); }
  } catch(e) {
    if(e.status===409&&/模型设置/.test(e.message)){pendingSubmission=null;try{await preferences.refresh();}catch{} error(e.message+'；本次未发送。');}
    else error(e.message + (requested ? '；请求可能已到达服务端，请先核对会话，勿立即重复发送。' : '；消息未发送，请修正后重试。'));
  }
  finally { sending = false; attachments.refresh(); iconButton($('send'),'send','发送'); controls(); }
};
$('stop').onclick = async () => { try { await rpc('turn/interrupt',{threadId,turnId:active[threadId]}); } catch(e) {error(e.message);} };
$('prompt').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } };
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
controls(); if (key) connect().catch(e=>{error(e.message);$('setup').showModal();}); else $('setup').showModal();
