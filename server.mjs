import http from 'node:http';
import { readFile, mkdir, writeFile, realpath, stat, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Bridge } from './bridge.mjs';
import { historyPage } from './history.mjs';
import { ImageStore, imageInfo, MAX_IMAGE_BYTES } from './images.mjs';
import { TurnMetrics } from './metrics.mjs';
import { ModelSettings } from './model-settings.mjs';
import { GroupStore } from './groups-store.mjs';
import { GroupOrchestrator } from './group-orchestrator.mjs';
import { groupProgress } from './group-progress.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const state = process.env.OMEGA_STATE_DIR || path.join(root, '.omega');
await mkdir(state, { recursive: true, mode: 0o700 });
const metrics = new TurnMetrics(path.join(state,'turn-metrics'));
await metrics.initialize();
let metricsQueue = Promise.resolve();
const images = new ImageStore(path.join(state,'images'));
await images.initialize();
const groups = new GroupStore(path.join(state,'omega.sqlite'));
async function cleanImages() {
  try { const removed = await images.cleanup(); if (removed) console.log('Expired Omega image files removed:',removed); }
  catch (e) { console.error('Image cleanup failed:',e.message); }
}
await cleanImages();
const imageCleanupTimer = setInterval(cleanImages,60*60*1000);
imageCleanupTimer.unref();
let uploadsInFlight = 0;
const tokenPath = path.join(state, 'access-token');
let rotatingToken = false;
let token = process.env.OMEGA_ACCESS_TOKEN;
if (!token) {
  try { token = (await readFile(tokenPath, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('hex'); await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' }); }
}
if (token.length < 8) throw new Error('OMEGA_ACCESS_TOKEN must be at least 8 characters.');
const workspace = await realpath(process.env.OMEGA_WORKSPACE || path.join(root, '..'));
const modelSettings=new ModelSettings(path.join(state,'model-settings'),(method,params)=>bridge.request(method,params));
await modelSettings.initialize();
const bridge = new Bridge();
const nativeSettings=new Map(), turnSettings=new Map();
function rememberNative(result){
  if(!result.thread?.id)return;
  const current={model:result.model||result.thread.model||null,effort:result.reasoningEffort??result.thread.reasoningEffort??null};
  if(current.model){nativeSettings.delete(result.thread.id);nativeSettings.set(result.thread.id,current);}
  if(nativeSettings.size>256)nativeSettings.delete(nativeSettings.keys().next().value);
}
async function settingsFor(id,result){
  if(result)rememberNative(result);
  return {...await modelSettings.read(id),current:nativeSettings.get(id)||null};
}
const clients = new Set();
const submissions = new Map();
const ledgerPath = path.join(state, 'submissions.json');
let ledger = Object.create(null);
try { Object.assign(ledger, JSON.parse(await readFile(ledgerPath, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const turnImages = new Map();
const pendingImages = new Map();
for (const entry of Object.values(ledger)) {
  if(entry.threadId&&entry.result?.turn?.id&&entry.modelSettings)turnSettings.set(entry.threadId+':'+entry.result.turn.id,entry.modelSettings);
  if (entry.threadId && entry.result?.turn?.id && entry.imageIds?.length) turnImages.set(entry.threadId+':'+entry.result.turn.id,entry.imageIds);
}
function attachments(item,threadId,turnId) {
  const local = images.fromContent(item.content);
  if (local.length) return local;
  const ids = ledger[item.id]?.imageIds || turnImages.get(threadId+':'+turnId) || pendingImages.get(threadId) || [];
  return ids.flatMap(id => { try { return [imageInfo(id)]; } catch { return []; } });
}
function publicItem(item,threadId,turnId) {
  if (item.type !== 'userMessage') return item;
  return {...item,images:attachments(item,threadId,turnId),content:(item.content || []).map(x =>
    ['image','localImage'].includes(x.type) ? {type:'image'} : x)};
}
let ledgerWrite = Promise.resolve();
function saveLedger() {
  const snapshot = JSON.stringify(ledger);
  ledgerWrite = ledgerWrite.then(async () => { await writeFile(ledgerPath + '.tmp', snapshot, { mode: 0o600 }); await rename(ledgerPath + '.tmp', ledgerPath); });
  return ledgerWrite;
}
const active = new Map();
const activeCwds = new Map();
const pathsOverlap=(a,b)=>{const left=path.resolve(a),right=path.resolve(b);return left===right||left.startsWith(right+path.sep)||right.startsWith(left+path.sep);};
const modesConflict=(left,right)=>left!=='read'||right!=='read';
async function resolveMemberWorkspace(sessionCwd,requestedCwd){
  let rootDir,workDir;
  try{rootDir=await realpath(String(sessionCwd||'').trim());workDir=await realpath(String(requestedCwd||rootDir).trim());}
  catch{throw new Error('成员实际工作目录不存在或不可访问');}
  if(!(await stat(rootDir)).isDirectory()||!(await stat(workDir)).isDirectory())throw new Error('成员实际工作目录必须是文件夹');
  if(workDir!==rootDir&&!workDir.startsWith(rootDir+path.sep))throw new Error('成员实际工作目录必须位于该会话的 Codex 工作目录内');
  return workDir;
}
function reserveWorkspace(threadId,cwd,groupId=null,accessMode='write'){
  if(!cwd)return null;
  for(const [otherId,entry] of activeCwds)if(otherId!==threadId&&modesConflict(accessMode,entry.accessMode)&&pathsOverlap(cwd,entry.cwd))return {message:`工作目录正被${entry.groupId?'另一个群组任务':'会话任务'}占用`,...entry};
  const persisted=groups.runningConflict(cwd,groupId,accessMode);
  if(persisted)return {message:`工作目录正由群组“${persisted.groupName}”执行`,...persisted};
  activeCwds.set(threadId,{cwd,groupId,accessMode});return null;
}
const pendingModels=new Map();
const freshThreads = new Map();
let deletingThread = false;
let eventId = 0;
const broadcast = event => {
  const data = `id: ${++eventId}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    if (event.method?.startsWith('item/') && event.id === undefined && event.params?.threadId !== client.threadId) continue;
    if (!client.write(data)) { client.end(); clients.delete(client); }
  }
};
const observeGroupProgress=groupProgress(groups,broadcast);
bridge.on('event', event => {
  observeGroupProgress(event);
  if (event.method === 'thread/deleted') {
    freshThreads.delete(event.params.threadId);
    active.delete(event.params.threadId);
    pendingImages.delete(event.params.threadId);
    activeCwds.delete(event.params.threadId);
    const binding=groups.markThreadUnavailable(event.params.threadId);
    if(binding)broadcast({method:'omega/group-updated',params:{groupId:binding.groupId}});
  }
  const metricEvent = event;
  if (['turn/started','turn/completed','thread/tokenUsage/updated'].includes(event.method)) {
    metricsQueue = metricsQueue.then(async () => {
      const update = await metrics.observe(metricEvent);
      if (update) broadcast({method:'omega/turn-metrics',params:update});
    }).catch(e => console.error('Turn metrics unavailable:',e.message));
  }
  if (event.method === 'turn/started') { active.set(event.params.threadId, event.params.turn.id); freshThreads.delete(event.params.threadId); }
  if(event.method==='turn/started'){
    const model=pendingModels.get(event.params.threadId);
    if(model){turnSettings.set(event.params.threadId+':'+event.params.turn.id,model);event={...event,params:{...event.params,turn:{...event.params.turn,modelSettings:model}}};}
  }
  if (event.params?.item) event = {...event,params:{...event.params,item:publicItem(event.params.item,event.params.threadId,event.params.turnId)}};
  if (event.params?.turn?.items) event = {...event,params:{...event.params,turn:{...event.params.turn,
    items:event.params.turn.items.map(item => publicItem(item,event.params.threadId,event.params.turn.id))}}};
  if (event.method === 'turn/completed') {
    active.delete(event.params.threadId); activeCwds.delete(event.params.threadId); pendingImages.delete(event.params.threadId); pendingModels.delete(event.params.threadId);
    const binding=groups.threadBinding(event.params.threadId);if(binding)queueMicrotask(()=>orchestrator.schedule(binding.groupId));
  }
  broadcast(event);
});
const ready = bridge.initialize();
ready.catch(error => console.error('App Server initialization failed:', error.message));

async function startManagedTurn(threadId, text, submissionId,execution={}) {
  if (active.has(threadId)) throw Object.assign(new Error('该会话正在处理其他任务'), { status: 409 });
  if (ledger[submissionId]?.result) return ledger[submissionId].result;
  if (ledger[submissionId]) throw Object.assign(new Error('该派发在服务重启前结果未知，请先核对会话'), { status: 409 });
  const savedSettings=await modelSettings.read(threadId);
  const overrides=await modelSettings.resolve(savedSettings,false);
  const requestedSettings=overrides.model?overrides:nativeSettings.get(threadId)||null;
  const thread=freshThreads.get(threadId)||await bridge.request('thread/resume',{threadId});
  const binding=groups.threadBinding(threadId),taskCwd=execution.cwd||thread.thread?.cwd,taskMode=execution.accessMode==='read'?'read':'write',conflict=binding?.type==='coordinator'?null:reserveWorkspace(threadId,taskCwd,binding?.groupId||null,taskMode);
  if(conflict)throw Object.assign(new Error(conflict.message),{status:409});
  active.set(threadId,'starting'); if(requestedSettings)pendingModels.set(threadId,requestedSettings);
  ledger[submissionId]={fingerprint:JSON.stringify({threadId,text}),createdAt:Date.now(),threadId,modelSettings:requestedSettings,managed:true};
  try {
    await saveLedger();
    const result=await bridge.request('turn/start',{threadId,input:[{type:'text',text}],clientUserMessageId:submissionId,...overrides});
    ledger[submissionId].result=result;
    if(result.turn?.id&&active.get(threadId)==='starting')active.set(threadId,result.turn.id);
    if(requestedSettings&&result.turn?.id){nativeSettings.set(threadId,requestedSettings);turnSettings.set(threadId+':'+result.turn.id,requestedSettings);}
    await saveLedger(); return result;
  } finally {
    if(active.get(threadId)==='starting'){active.delete(threadId);activeCwds.delete(threadId);pendingModels.delete(threadId);}
  }
}

async function readTurn(threadId, turnId) {
  const result=await bridge.request('thread/read',{threadId,includeTurns:true});
  return result.thread?.turns?.find(turn=>turn.id===turnId)||null;
}

async function waitTurn(threadId, turnId, timeoutMs) {
  const settled=turn=>turn&&turn.status!=='inProgress'&&!(turn.status==='interrupted'&&active.get(threadId)===turnId);
  const existing=await readTurn(threadId,turnId);
  if(settled(existing))return existing;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{bridge.off('event',onEvent);reject(new Error('任务等待超时，执行结果需要人工核对'));},timeoutMs);
    const onEvent=event=>{
      if(event.method!=='turn/completed'||event.params?.threadId!==threadId||event.params?.turn?.id!==turnId)return;
      clearTimeout(timer);bridge.off('event',onEvent);resolve(event.params.turn);
    };
    bridge.on('event',onEvent);
    readTurn(threadId,turnId).then(turn=>{
      if(settled(turn)){clearTimeout(timer);bridge.off('event',onEvent);resolve(turn);}
    }).catch(()=>{});
  });
}

async function readTurnText(threadId,turnId){
  const turn=await readTurn(threadId,turnId);
  if(!turn)throw new Error('找不到对应执行轮次');
  const messages=(turn.items||[]).filter(item=>item.type==='agentMessage').map(item=>item.text||'').filter(Boolean);
  return messages.at(-1)||'';
}

const orchestrator=new GroupOrchestrator({store:groups,startTurn:startManagedTurn,waitTurn,readTurnText,
  isThreadActive:id=>active.has(id),isWorkspaceBusy:(cwd,groupId,accessMode='write')=>{
    if(groups.runningConflict(cwd,null,accessMode))return true;
    for(const entry of activeCwds.values())if(modesConflict(accessMode,entry.accessMode)&&pathsOverlap(cwd,entry.cwd))return true;
    return false;
  },notify:broadcast});
ready.then(()=>orchestrator.resume()).catch(()=>{});
const allowed = new Set(['thread/delete', 'thread/name/set', 'thread/list', 'thread/read', 'thread/resume', 'thread/turns/list', 'thread/items/list', 'thread/start', 'turn/start', 'turn/interrupt', 'account/read', 'model/list']);
function authorized(req) {
  const value = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  return value.length === expected.length && timingSafeEqual(value, expected);
}
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req)) return json(res, 401, { error: 'Enter your Omega access key.' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Origin rejected' });
      if (url.pathname.startsWith('/api/images/') && req.method === 'GET') {
        const id = url.pathname.slice('/api/images/'.length);
        const file = await images.resolve(id,url.searchParams.get('size') === 'thumb');
        const contents = await readFile(file);
        res.writeHead(200,{'content-type':'image/jpeg','cache-control':'no-store','content-length':contents.length});
        return res.end(contents);
      }
      if (url.pathname === '/api/images' && req.method === 'POST') {
        if (uploadsInFlight >= 2) return json(res,429,{error:'正在处理图片，请稍后再试'});
        uploadsInFlight++;
        try {
          if (Number(req.headers['content-length']) > MAX_IMAGE_BYTES) return json(res,413,{error:'每张图片不得超过 8 MB'});
          let size = 0; const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_IMAGE_BYTES) return json(res,413,{error:'每张图片不得超过 8 MB'});
            chunks.push(chunk);
          }
          if (!authorized(req)) return json(res,401,{error:'访问密钥已变更，请重新连接'});
          return json(res,201,await images.upload(Buffer.concat(chunks),req.headers['content-type']));
        } finally { uploadsInFlight--; }
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
        res.write(`data: ${JSON.stringify({ method: 'omega/snapshot', params: { ready: bridge.ready, approvals: [...bridge.approvals.values()], active: Object.fromEntries(active) } })}\n\n`);
        clients.add(res); const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.threadId = url.searchParams.get('threadId');
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); return;
      }
      if (url.pathname === '/api/status') return json(res, 200, { ready: bridge.ready, canChangeKey: !process.env.OMEGA_ACCESS_TOKEN, workspace, devices: clients.size, active: Object.fromEntries(active), approvals: [...bridge.approvals.values()] });
      if (url.pathname === '/api/groups' && req.method === 'GET') return json(res,200,{groups:groups.listGroups()});
      if (url.pathname.startsWith('/api/groups/') && req.method === 'GET') {
        const id=decodeURIComponent(url.pathname.slice('/api/groups/'.length));
        if(url.searchParams.has('after')||url.searchParams.has('question')){groups.getGroup(id);return json(res,200,{messages:groups.roomWindow(id,{after:url.searchParams.get('after'),question:url.searchParams.get('question')})});}
        if(url.searchParams.has('before')){groups.getGroup(id);return json(res,200,{messages:groups.roomMessages(id,url.searchParams.get('before'))});}
        const group=groups.getGroup(id,url.searchParams.get('requirementId'));
        const known=new Set((url.searchParams.get('known')||'').split(','));
        const messageKeys=group.messages.map(message=>createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0,24));
        const messageIds=group.messages.map(message=>message.id);
        group.messages=group.messages.filter((message,index)=>!known.has(messageKeys[index]));
        return json(res,200,{group,messageKeys,messageIds});
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
      if (url.pathname === '/api/access-key') {
        const input = await body(req);
        if (!authorized(req)) return json(res,401,{error:'访问密钥已变更，请重新连接。'});
        if (process.env.OMEGA_ACCESS_TOKEN) return json(res,409,{error:'当前密钥由服务器环境变量管理，无法在页面修改。'});
        if (rotatingToken) return json(res,409,{error:'正在保存，请稍后重试。'});
        const next = input.accessKey;
        if (typeof next !== 'string' || next.length < 8 || next.length > 256 || next !== next.trim() || /[\r\n]/.test(next)) return json(res,400,{error:'密钥需要 8–256 个字符，首尾不能有空格。'});
        rotatingToken = true;
        try {
          await writeFile(tokenPath + '.tmp',next,{mode:0o600});
          await rename(tokenPath + '.tmp',tokenPath);
          token = next;
          for (const client of clients) client.end();
          clients.clear();
          return json(res,200,{ok:true});
        } finally { rotatingToken = false; }
      }
      await ready;
      if (!bridge.ready) throw new Error('App Server disconnected; restart Omega.');
      const input = await body(req);
      if(url.pathname==='/api/groups'){
        let result;
        if(input.action==='create'){
          groups.validateGroupInput(input);
          const started=await bridge.request('thread/start',{cwd:workspace,approvalPolicy:'on-request',sandbox:'workspace-write',ephemeral:false});
          const coordinatorThreadId=started.thread?.id;
          if(!coordinatorThreadId)throw new Error('无法创建群组协调者会话');
          freshThreads.set(coordinatorThreadId,started);metrics.seed(coordinatorThreadId);
          const name=`[协调者] ${String(input.name||'新群组').trim().slice(0,60)}`;
          try{await bridge.request('thread/name/set',{threadId:coordinatorThreadId,name});started.thread.name=name;}catch{}
          result=groups.createGroup(input,coordinatorThreadId,workspace);
        }else if(input.action==='deleteGroup'){
          const group=groups.getGroup(input.groupId),threadIds=new Set([group.coordinatorThreadId,...group.members.map(member=>member.threadId)]);
          if(active.has(group.coordinatorThreadId)||group.runningTasks)throw Object.assign(new Error('群组仍有协调或成员任务正在执行，请先停止'),{status:409});
          if([...bridge.approvals.values()].some(request=>threadIds.has(request.params?.threadId)))throw Object.assign(new Error('群组仍有待处理审批，请先处理或停止对应任务'),{status:409});
          orchestrator.suspend(group.id);deletingThread=true;
          let coordinatorDeleted=true;
          try{
            try{await bridge.request('thread/delete',{threadId:group.coordinatorThreadId});}
            catch(error){if(!/missing source rollout|invalid paginated history lineage|not found|does not exist/i.test(error.message))throw error;coordinatorDeleted=false;}
            const deleted=groups.deleteGroup(group.id);orchestrator.forget(group.id);freshThreads.delete(group.coordinatorThreadId);
            broadcast({method:'omega/thread-deleted',params:{threadId:group.coordinatorThreadId}});
            broadcast({method:'omega/group-deleted',params:{groupId:group.id}});
            return json(res,200,{deleted:true,groupId:deleted.id,coordinatorDeleted});
          }catch(error){orchestrator.unsuspend(group.id);throw error;}
          finally{deletingThread=false;}
        }else if(input.action==='addMember'){
          if(active.has(input.threadId))return json(res,409,{error:'该会话正在执行任务，请稍后添加'});
          const check=freshThreads.get(input.threadId)||await bridge.request('thread/read',{threadId:input.threadId,includeTurns:false});
          if(!check.thread?.id)throw new Error('会话不存在或无法恢复');
          const group=groups.getGroup(input.groupId);
          if(input.threadId===group.coordinatorThreadId)throw new Error('协调者会话不能同时作为执行成员');
          const memberCwd=await resolveMemberWorkspace(check.thread.cwd,input.cwd);
          result=groups.addMember(input.groupId,{...input,cwd:memberCwd,projectName:input.projectName||path.basename(memberCwd)});
        }else if(input.action==='removeMember')result=groups.removeMember(input.groupId,input.memberId);
        else if(input.action==='updateMember'){
          const group=groups.getGroup(input.groupId,input.requirementId),member=group.members.find(item=>item.id===input.memberId);
          if(!member)throw Object.assign(new Error('成员不存在'),{status:404});
          const selectedThreadId=input.threadId||member.threadId;
          if(selectedThreadId!==member.threadId&&active.has(selectedThreadId))throw Object.assign(new Error('新会话正在执行任务，请稍后再试'),{status:409});
          if(selectedThreadId===group.coordinatorThreadId)throw new Error('协调者会话不能同时作为执行成员');
          const check=freshThreads.get(selectedThreadId)||await bridge.request('thread/read',{threadId:selectedThreadId,includeTurns:false});
          if(!check.thread?.id)throw new Error('成员会话不存在或无法恢复');
          const memberCwd=await resolveMemberWorkspace(check.thread.cwd,input.cwd||member.cwd),update={...input,threadId:selectedThreadId,cwd:memberCwd};
          result=groups.updateMember(input.groupId,input.memberId,update,input.requirementId);
        }
        else if(input.action==='setConcurrency'){result=groups.setConcurrency(input.groupId,input.maxConcurrency,input.requirementId);orchestrator.schedule(input.groupId);}
        else if(input.action==='submit')result=orchestrator.submit(input.groupId,input);
        else if(input.action==='updateTask')result=groups.updateDraftTask(input.groupId,input.requirementId,input);
        else if(input.action==='confirm')result=orchestrator.confirm(input.groupId,input.requirementId);
        else if(input.action==='retry')result=orchestrator.retry(input.groupId,input.requirementId);
        else if(input.action==='requestChanges')result=orchestrator.requestChanges(input.groupId,input.requirementId,input);
        else if(input.action==='stop'){
          const group=groups.getGroup(input.groupId,input.requirementId),task=group.requirement?.tasks?.find(item=>item.status==='running'||item.status==='reviewing');
          const member=task&&group.members.find(item=>item.id===task.memberId);
          const target=group.requirement?.status==='finalizing'||task?.status==='reviewing'?group.coordinatorThreadId:member?.threadId;
          const turnId=target&&active.get(target);
          if((!task&&group.requirement?.status!=='finalizing')||!target||!turnId||turnId==='starting')throw Object.assign(new Error('当前没有可中断的群组执行轮次'),{status:409});
          await bridge.request('turn/interrupt',{threadId:target,turnId});result=groups.getGroup(input.groupId,input.requirementId);
        }
        else if(input.action==='accept')result=groups.accept(input.groupId,input.requirementId);
        else if(input.action==='cancel')result=groups.cancel(input.groupId,input.requirementId);
        else throw new Error('不支持的群组操作');
        broadcast({method:'omega/group-updated',params:{groupId:result.id}});
        return json(res,200,{group:result});
      }
      if(url.pathname==='/api/models')return json(res,200,{models:await modelSettings.models(true)});
      if(url.pathname==='/api/thread-settings'){
        modelSettings.file(input.threadId);
        const check=async()=>{
          if(deletingThread)throw Object.assign(Error('正在删除会话，请稍后再试'),{status:409});
          return freshThreads.get(input.threadId)||await bridge.request('thread/read',{threadId:input.threadId,includeTurns:false});
        };
        const result=await check();
        if(input.settings!==undefined){
          await modelSettings.save(input.threadId,input.settings,input.expectedRevision,check);
          const settings=await settingsFor(input.threadId,result);
          broadcast({method:'omega/model-settings',params:{threadId:input.threadId,settings}});
          return json(res,200,{settings});
        }
        return json(res,200,{settings:await settingsFor(input.threadId,result)});
      }
      if (url.pathname === '/api/history') {
        const result = freshThreads.get(input.threadId) || await bridge.request('thread/read', {threadId:input.threadId,includeTurns:true});
        const page = historyPage(result.thread,input,(item,turn) => attachments(item,input.threadId,turn.id));
        page.settings=await settingsFor(input.threadId,result);
        if(page.turn)page.turn.modelSettings=turnSettings.get(input.threadId+':'+page.turn.id)||null;
        if(page.turn) {
          await metricsQueue;
          const turn=result.thread.turns.find(t=>t.id===page.turn.id);
          try { page.turn.metrics=await metrics.view(input.threadId,turn); }
          catch(e) { console.error('Turn metrics read failed:',e.message); }
        }
        return json(res,200,page);
      }
      if (url.pathname === '/api/answer') {
        const request = bridge.approvals.get(String(input.id));
        if (!request) return json(res, 409, { error: 'Request already resolved' });
        if (/item\/(commandExecution|fileChange)\/requestApproval/.test(request.method)) {
          if (!['accept', 'decline', 'cancel'].includes(input.result?.decision)) throw new Error('Invalid approval decision');
        } else if (request.method !== 'item/tool/requestUserInput') throw new Error('Unsupported request; stop the turn to cancel it.');
        bridge.answer(input.id, input.result); return json(res, 200, { ok: true });
      }
      if (url.pathname !== '/api/rpc' || !allowed.has(input.method)) return json(res, 400, { error: 'Unsupported method' });
      const params = input.params || {};
      if (deletingThread && ['thread/delete','thread/start','thread/resume','turn/start'].includes(input.method)) return json(res,409,{error:'正在删除会话，请稍后再试'});
      if (input.method === 'thread/delete') {
        if (typeof params.threadId !== 'string' || !/^[a-f0-9-]{36}$/i.test(params.threadId)) throw new Error('无效的会话 ID');
        const binding=groups.threadBinding(params.threadId);
        if(binding)return json(res,409,{error:`该会话是群组“${binding.groupName}”的${binding.type==='coordinator'?'协调者':'成员'}，请先从群组解除绑定`});
        if (input.confirmDelete !== true) throw new Error('请先确认删除会话及其子会话');
        // Native deletion includes descendants. Do not race any Omega turn start.
        if (active.size || bridge.approvals.size) return json(res,409,{error:'仍有任务正在执行或等待审批，请完成或停止任务后再删除'});
        deletingThread = true;
        try {
          await bridge.request('thread/delete',{threadId:params.threadId});
          freshThreads.delete(params.threadId);
          broadcast({method:'omega/thread-deleted',params:{threadId:params.threadId}});
          return json(res,200,{threadId:params.threadId,deleted:true});
        } finally { deletingThread = false; }
      }
      if (input.method === 'thread/name/set') {
        if (typeof params.threadId !== 'string' || !params.threadId.trim()) throw new Error('请选择一个会话');
        if (typeof params.name !== 'string' || !params.name.trim() || params.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(params.name)) throw new Error('会话名称需为 1–80 个字符，不能包含换行');
        const name = params.name.trim();
        await bridge.request('thread/name/set',{threadId:params.threadId,name});
        const fresh = freshThreads.get(params.threadId);
        if (fresh) fresh.thread.name = name;
        broadcast({method:'omega/thread-renamed',params:{threadId:params.threadId,name}});
        return json(res,200,{threadId:params.threadId,name});
      }
      // This CLI cannot hydrate a legacy thread until its first turn is stored.
      // All devices share this same live connection, already subscribed at creation.
      if (['thread/read','thread/resume'].includes(input.method) && freshThreads.has(params.threadId)) return json(res,200,freshThreads.get(params.threadId));
      if (input.method === 'thread/start') {
        const cwd = await realpath(params.cwd || workspace);
        const rel = path.relative(workspace, cwd);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !(await stat(cwd)).isDirectory()) throw new Error('Choose a folder within the server workspace.');
        Object.assign(params, { cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write', ephemeral: false });
      }
      if (input.method === 'turn/start') {
        const id = input.submissionId;
        if (typeof id !== 'string' || id.length > 100) throw new Error('submissionId required');
        const fingerprint = JSON.stringify({threadId:params.threadId,input:params.input,...(input.imageIds?.length ? {imageIds:input.imageIds} : {}),...(input.settingsRevision!==undefined?{settingsRevision:input.settingsRevision}:{})});
        if (ledger[id] && ledger[id].fingerprint !== fingerprint) return json(res,409,{error:'Submission ID was already used for different input'});
        if (submissions.has(id)) return json(res, 200, await submissions.get(id));
        if (ledger[id]) {
          if (ledger[id].result) return json(res,200,ledger[id].result);
          return json(res,409,{error:'Submission outcome is uncertain after restart; read conversation history before sending a new message.'});
        }
        if (active.has(params.threadId)) return json(res, 409, { error: 'This conversation is already working. Wait or stop the current turn.' });
        let requestCwd=null;
        try {
          const thread=freshThreads.get(params.threadId)||await bridge.request('thread/resume',{threadId:params.threadId});
          requestCwd=thread.thread?.cwd||null;
          if(requestCwd){const conflict=groups.runningConflict(requestCwd);if(conflict)return json(res,409,{error:`工作目录正由群组“${conflict.groupName}”执行，请等待群组任务结束`});}
        } catch(error) { if(error.status)throw error; }
        if (submissions.size >= 2000) throw new Error('Submission cache full; restart Omega after active tasks finish.');
        const savedSettings=await modelSettings.read(params.threadId);
        if(input.settingsRevision!==undefined&&input.settingsRevision!==savedSettings.revision)return json(res,409,{error:'模型设置已在其他设备修改，请核对最新设置后发送'});
        const overrides=await modelSettings.resolve(savedSettings,!!input.imageIds?.length);
        const turnInput = await images.turnInput(params.input,input.imageIds);
        if((await modelSettings.read(params.threadId)).revision!==savedSettings.revision)return json(res,409,{error:'模型设置已更新，请核对后重新发送'});
        // Validation touches disk; recheck concurrency after that await.
        if (deletingThread) return json(res,409,{error:'正在删除会话，请稍后再试'});
        if (ledger[id] && ledger[id].fingerprint !== fingerprint) return json(res,409,{error:'Submission ID was already used for different input'});
        if (submissions.has(id)) return json(res,200,await submissions.get(id));
        if (active.has(params.threadId)) return json(res,409,{error:'This conversation is already working.'});
        const workspaceConflict=reserveWorkspace(params.threadId,requestCwd,null);
        if(workspaceConflict)return json(res,409,{error:workspaceConflict.message});
        active.set(params.threadId, 'starting');
        const imageIds = input.imageIds || [];
        pendingImages.set(params.threadId,imageIds);
        const requestedSettings=overrides.model?overrides:nativeSettings.get(params.threadId)||null;
        if(requestedSettings)pendingModels.set(params.threadId,requestedSettings);
        ledger[id] = {fingerprint,createdAt:Date.now(),threadId:params.threadId,imageIds,modelSettings:requestedSettings};
        const operation = saveLedger().then(()=>bridge.request(input.method, { threadId: params.threadId, input: turnInput, clientUserMessageId: id,...overrides })).then(async result=>{
          ledger[id].result=result;
          if(requestedSettings&&result.turn?.id){
            nativeSettings.set(params.threadId,requestedSettings);
            turnSettings.set(params.threadId+':'+result.turn.id,requestedSettings);
            broadcast({method:'omega/turn-model',params:{threadId:params.threadId,turnId:result.turn.id,settings:requestedSettings}});
          }
          if (imageIds.length && result.turn?.id) turnImages.set(params.threadId+':'+result.turn.id,imageIds);
          await saveLedger(); return result;
        }).finally(() => { if (active.get(params.threadId) === 'starting') { active.delete(params.threadId); activeCwds.delete(params.threadId); pendingImages.delete(params.threadId); pendingModels.delete(params.threadId); } });
        submissions.set(id, operation);
        return json(res, 200, await operation);
      }
      const result = await bridge.request(input.method, params);
      if(['thread/start','thread/resume'].includes(input.method))rememberNative(result);
      if (input.method === 'thread/resume' && input.summaryOnly) {
        return json(res,200,{thread:{id:result.thread.id}});
      }
      if (input.method === 'thread/start') { freshThreads.set(result.thread.id,result); metrics.seed(result.thread.id); }
      if (input.method === 'thread/list') result.data = [...[...freshThreads.values()].map(x=>x.thread).filter(t=>!result.data.some(x=>x.id===t.id)),...result.data];
      if (result.thread?.turns) for (const turn of result.thread.turns) if (turn.status === 'inProgress') active.set(result.thread.id,turn.id);
      return json(res, 200, result);
    }
    const files = { '/': 'index.html', '/app.js': 'app.js', '/groups.js':'groups.js', '/group-room.js':'group-room.js', '/avatars.js':'avatars.js', '/platform.js':'platform.js', '/model-settings.js':'model-settings.js', '/ui.js':'ui.js', '/attachments.js':'attachments.js', '/style.css': 'style.css', '/markdown.js': 'markdown.js', '/vendor/marked.js': '../node_modules/marked/lib/marked.esm.js', '/vendor/purify.js': '../node_modules/dompurify/dist/purify.es.mjs' };
    if (!files[url.pathname]) { res.writeHead(404); return res.end(); }
    const contents = await readFile(path.join(root, 'public', files[url.pathname]));
    res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html'); res.end(contents);
  } catch (error) { if (!res.headersSent) json(res, error.status || 400, { error: error.message }); else res.end(); }
});
server.listen(Number(process.env.PORT || 4310), process.env.OMEGA_HOST || '127.0.0.1', () => console.log(`Omega: http://${process.env.OMEGA_HOST || '127.0.0.1'}:${process.env.PORT || 4310}\nAccess key file: ${tokenPath}\nWorkspace: ${workspace}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(imageCleanupTimer); for (const client of clients) client.end(); server.close(); bridge.close(); groups.close(); });
