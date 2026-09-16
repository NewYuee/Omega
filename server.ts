import {submissionLayout} from './src/server/submission-layout.ts';
import {groupAttention} from './src/server/attention.ts';
import {repositoryView} from './src/server/repository-view.ts';
import {inlineImageContent} from './src/shared/inline-images.ts';
import http from 'node:http';
import { readFile, mkdir, writeFile, realpath, stat, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Bridge } from './src/server/bridge.ts';
import { historyPage, paginatedHistoryPage } from './src/server/history.ts';
import { ImageStore, imageInfo, MAX_IMAGE_BYTES } from './src/server/images.ts';
import {PastedTextStore,MAX_PASTED_TEXT_BYTES} from './src/server/pasted-content.ts';
import {importDocument,MAX_DOCUMENT_BYTES} from './src/server/document-import.ts';
import { TurnMetrics } from './src/server/metrics.ts';
import { ModelSettings } from './src/server/model-settings.ts';
import {groupRoomView} from './src/server/group-room-view.ts';
import { GroupStore } from './src/server/groups-store.ts';
import {handoffFiles} from './src/server/handoff-files.ts';
import { GroupOrchestrator } from './src/server/group-orchestrator.ts';
import {findTurn} from './src/server/turn-lookup.ts';
import { groupProgress } from './src/server/group-progress.ts';
import { AutomationStore } from './src/server/automation-store.ts';
import { AutomationService } from './src/server/automation-service.ts';
import { ReadStateStore } from './src/server/read-state.ts';
import { SearchStore } from './src/server/search-store.ts';
import { applyPendingRestore,createBackup,stageRestore } from './src/server/backup.ts';
import { activeWriterThreadId,THREAD_WRITER_BUSY,threadWriterBusyMessage } from './src/shared/thread-errors.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const state = process.env.OMEGA_STATE_DIR || path.join(root, '.omega');
await mkdir(state, { recursive: true, mode: 0o700 });
const restored=applyPendingRestore(state);if(restored)console.log(`Omega restored ${restored.files} files from backup ${restored.createdAt}`);
const startedAt=new Date();
const metrics = new TurnMetrics(path.join(state,'turn-metrics'));
await metrics.initialize();
let metricsQueue = Promise.resolve();
const images = new ImageStore(path.join(state,'images'));
await images.initialize();
const pastedTexts=new PastedTextStore(path.join(state,'pasted-text'));
await pastedTexts.initialize();
const groups = new GroupStore(path.join(state,'omega.sqlite'));
const automationStore = new AutomationStore(path.join(state,'automations.sqlite'));
const readState = new ReadStateStore(path.join(state,'read-state.sqlite'));
const searchStore = new SearchStore(path.join(state,'search.sqlite'));
async function cleanImages() {
  try { const [removedImages,removedPastes] = await Promise.all([images.cleanup(),pastedTexts.cleanup()]); if (removedImages) console.log('Expired Omega image files removed:',removedImages);if(removedPastes)console.log('Expired Omega pasted text files removed:',removedPastes); }
  catch (e:any) { console.error('Image cleanup failed:',e.message); }
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
  catch (error:any) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('hex'); await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' }); }
}
if (token.length < 8) throw new Error('OMEGA_ACCESS_TOKEN must be at least 8 characters.');
const workspace = await realpath(process.env.OMEGA_WORKSPACE || path.join(root, '..'));
type Row=Record<string,any>;
type EventClient=http.ServerResponse&{threadId?:string;deviceId?:string};
const modelSettings=new ModelSettings(path.join(state,'model-settings'),(method,params)=>bridge.request(method,params));
await modelSettings.initialize();
const bridge:any=new Bridge();
const nativeSettings=new Map<string,any>(),turnSettings=new Map<string,any>();
function rememberNative(result:Row){
  if(!result.thread?.id)return;
  const current={model:result.model||result.thread.model||null,effort:result.reasoningEffort??result.thread.reasoningEffort??null};
  if(current.model){nativeSettings.delete(result.thread.id);nativeSettings.set(result.thread.id,current);}
  if(nativeSettings.size>256){const oldest=nativeSettings.keys().next().value;if(oldest)nativeSettings.delete(oldest);}
}
async function settingsFor(id:string,result?:Row){
  if(result)rememberNative(result);
  return{...await modelSettings.read(id),current:nativeSettings.get(id)||null};
}
const clients=new Set<EventClient>();
const submissions=new Map<string,Promise<any>>();
const ledgerPath = path.join(state, 'submissions.json');
let ledger:Record<string,any>=Object.create(null);
try { Object.assign(ledger, JSON.parse(await readFile(ledgerPath, 'utf8'))); } catch (e:any) { if (e.code !== 'ENOENT') throw e; }
const turnImages=new Map<string,string[]>();
const pendingImages=new Map<string,string[]>();
const turnPastes=new Map<string,Row[]>();
const pendingPastes=new Map<string,Row[]>();
for (const entry of Object.values(ledger)) {
  if(entry.threadId&&entry.result?.turn?.id&&entry.modelSettings)turnSettings.set(entry.threadId+':'+entry.result.turn.id,entry.modelSettings);
  if (entry.threadId && entry.result?.turn?.id && entry.imageIds?.length) turnImages.set(entry.threadId+':'+entry.result.turn.id,entry.imageIds);
  if (entry.threadId && entry.result?.turn?.id && entry.pasteRefs?.length) turnPastes.set(entry.threadId+':'+entry.result.turn.id,entry.pasteRefs);
}
function attachments(item:Row,threadId:string,turnId:string) {
  const local = images.fromContent(item.content);
  if (local.length) return local;
  const ids:string[]=ledger[item.id]?.imageIds||turnImages.get(threadId+':'+turnId)||pendingImages.get(threadId)||[];
  return ids.flatMap(id => { try { return [imageInfo(id)]; } catch { return []; } });
}
function publicItem(item:Row,threadId:string,turnId:string) {
  if (item.type !== 'userMessage') return item;
  const pasteRefs:Row[]=ledger[item.id]?.pasteRefs||turnPastes.get(threadId+':'+turnId)||pendingPastes.get(threadId)||[];
  const layout=submissionLayout(item,threadId,turnId,ledger);
  return {...item,images:attachments(item,threadId,turnId),pastedTexts:pasteRefs,content:(layout!==undefined?[{type:'text',text:layout}]:inlineImageContent((item.content||[]) as Row[],attachments(item,threadId,turnId).map(ref=>ref.id))).flatMap(x =>
    ['image','localImage'].includes(x.type||'') ? [{type:'image'}] : x.type==='text'&&String(x.text||'').startsWith('\n\n<omega_pasted_files>')?[]:[x])};
}
function indexSearchItem(item:Row,threadId:string,turnId:string,title=threadId){if(!item||!['userMessage','agentMessage'].includes(item.type))return;const content=item.type==='agentMessage'?item.text:(item.content||[]).map((part:Row)=>part.text||'').join('\n');if(content?.trim())searchStore.index({scope:'thread',id:threadId,anchor:turnId,title,content});}
let ledgerWrite = Promise.resolve();
function saveLedger() {
  const snapshot = JSON.stringify(ledger);
  ledgerWrite = ledgerWrite.then(async () => { await writeFile(ledgerPath + '.tmp', snapshot, { mode: 0o600 }); await rename(ledgerPath + '.tmp', ledgerPath); });
  return ledgerWrite;
}
const active=new Map<string,string>();
const activeCwds=new Map<string,{cwd:string;groupId:string|null;accessMode:string}>();
const pathsOverlap=(a:string,b:string)=>{const left=path.resolve(a),right=path.resolve(b);return left===right||left.startsWith(right+path.sep)||right.startsWith(left+path.sep);};
const modesConflict=(left:string,right:string)=>left!=='read'||right!=='read';
async function resolveMemberWorkspace(sessionCwd:unknown,requestedCwd:unknown){
  let rootDir,workDir;
  try{rootDir=await realpath(String(sessionCwd||'').trim());workDir=await realpath(String(requestedCwd||rootDir).trim());}
  catch{throw new Error('成员实际工作目录不存在或不可访问');}
  if(!(await stat(rootDir)).isDirectory()||!(await stat(workDir)).isDirectory())throw new Error('成员实际工作目录必须是文件夹');
  if(workDir!==rootDir&&!workDir.startsWith(rootDir+path.sep))throw new Error('成员实际工作目录必须位于该会话的 Codex 工作目录内');
  return workDir;
}
function reserveWorkspace(threadId:string,cwd:string|null,groupId:string|null=null,accessMode='write'){
  if(!cwd)return null;
  for(const [otherId,entry] of activeCwds)if(otherId!==threadId&&modesConflict(accessMode,entry.accessMode)&&pathsOverlap(cwd,entry.cwd))return {message:`工作目录正被${entry.groupId?'另一个群组任务':'会话任务'}占用`,...entry};
  const persisted=groups.runningConflict(cwd,groupId,accessMode);
  if(persisted)return {message:`工作目录正由群组“${persisted.groupName}”执行`,...persisted};
  activeCwds.set(threadId,{cwd,groupId,accessMode});return null;
}
const pendingModels=new Map<string,any>();
const freshThreads=new Map<string,any>();
let deletingThread = false;
let eventId = 0;
const eventLog:{id:number;event:Row;data:string}[]=[];
const eventVisible=(client:EventClient,event:Row)=>!(event.method?.startsWith('item/')&&event.id===undefined&&event.params?.threadId!==client.threadId);
const broadcast=(input:unknown)=>{const event=input as Row;
  let unreadNotice:Row|null=null;
  if(event.method==='turn/completed'&&event.params?.threadId){const id=event.params.threadId,position=event.params.turn?.id||null;unreadNotice={scope:'thread',id,count:readState.markUnread('thread',id,position),position};}
  if(event.method==='item/completed'&&event.params?.item?.type==='agentMessage'&&event.params?.threadId){const binding=groups.threadBinding(event.params.threadId);if(binding){const position=groups.unreadAnchor(event.params.threadId);unreadNotice={scope:'group',id:binding.groupId,count:readState.markUnread('group',binding.groupId,position),position};}}
  const id=++eventId,data = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
  eventLog.push({id,event,data});if(eventLog.length>512)eventLog.shift();
  for (const client of clients) {
    if (!eventVisible(client,event)) continue;
    if (!client.write(data)) { client.end(); clients.delete(client); }
  }
  if(unreadNotice)queueMicrotask(()=>broadcast({method:'omega/unread',params:unreadNotice}));
};
const observeGroupProgress=groupProgress(groups,broadcast);
let automationService:AutomationService;
let orchestrator:GroupOrchestrator;
bridge.on('event',(event:Row)=>{
  if(event.method==='omega/disconnected'){
    active.clear();activeCwds.clear();pendingImages.clear();pendingModels.clear();
  }
  if(event.method==='omega/reconnected')queueMicrotask(()=>orchestrator?.resume());
  observeGroupProgress(event as any);
  if (event.method === 'thread/deleted') {
    freshThreads.delete(event.params.threadId);
    readState.remove('thread',event.params.threadId);
    searchStore.removeThread(event.params.threadId);
    active.delete(event.params.threadId);
    pendingImages.delete(event.params.threadId);
    activeCwds.delete(event.params.threadId);
    const binding=groups.markThreadUnavailable(event.params.threadId);
    if(binding)broadcast({method:'omega/group-updated',params:{groupId:binding.groupId}});
  }
  const metricEvent = event;
  if (['turn/started','turn/completed','thread/tokenUsage/updated'].includes(event.method)) {
    metricsQueue = metricsQueue.then(async () => {
      const update=await metrics.observe(metricEvent as any);
      if (update) {groups.observeUsage(update.threadId,update.turnId,update.metrics.usage?.totalTokens);broadcast({method:'omega/turn-metrics',params:update});}
    }).catch(e => console.error('Turn metrics unavailable:',e.message));
  }
  if (event.method === 'turn/started') { active.set(event.params.threadId, event.params.turn.id); freshThreads.delete(event.params.threadId); }
  if(event.method==='turn/started'){
    const model=pendingModels.get(event.params.threadId);
    if(model){turnSettings.set(event.params.threadId+':'+event.params.turn.id,model);event={...event,params:{...event.params,turn:{...event.params.turn,modelSettings:model}}};}
  }
  if (event.params?.item) event = {...event,params:{...event.params,item:publicItem(event.params.item,event.params.threadId,event.params.turnId)}};
  if (event.params?.turn?.items) event = {...event,params:{...event.params,turn:{...event.params.turn,
    items:event.params.turn.items.map((item:Row)=>publicItem(item,event.params.threadId,event.params.turn.id))}}};
  if (event.method === 'turn/completed') {
    active.delete(event.params.threadId); activeCwds.delete(event.params.threadId); pendingImages.delete(event.params.threadId); pendingModels.delete(event.params.threadId);
    if(event.params.turn?.id)automationService?.complete(event.params.turn.id,event.params.turn.status==='completed',event.params.turn.error?.message,event.params.turn.status==='interrupted');
    const binding=groups.threadBinding(event.params.threadId);if(binding)queueMicrotask(()=>orchestrator.schedule(binding.groupId));
  }
  if(event.method==='item/completed')indexSearchItem(event.params?.item,event.params?.threadId,event.params?.turnId);
  broadcast(event);
});
const ready = bridge.initialize();
  ready.catch((error:Error)=>console.error('App Server initialization failed:',error.message));

async function startManagedTurn(threadId:string,text:string,submissionId:string,execution:Row={}) {
  if (active.has(threadId)) throw Object.assign(new Error('该会话正在处理其他任务'), { status: 409 });
  if (ledger[submissionId]?.result) return ledger[submissionId].result;
  if (ledger[submissionId]) throw Object.assign(new Error('该派发在服务重启前结果未知，请先核对会话'), { status: 409 });
  const managedInput=await images.turnInput([{type:'text',text}],execution.imageIds||[]);
  const savedSettings=await modelSettings.read(threadId);
  const overrides:Row=await modelSettings.resolve(savedSettings,false);
  const requestedSettings=overrides.model?overrides:nativeSettings.get(threadId)||null;
  const thread=freshThreads.get(threadId)||await bridge.request('thread/resume',{threadId});
  const binding=groups.threadBinding(threadId),taskCwd=execution.cwd||thread.thread?.cwd,taskMode=execution.accessMode==='read'?'read':'write',conflict=binding?.type==='coordinator'?null:reserveWorkspace(threadId,taskCwd,binding?.groupId||null,taskMode);
  if(conflict)throw Object.assign(new Error(conflict.message),{status:409});
  active.set(threadId,'starting'); if(requestedSettings)pendingModels.set(threadId,requestedSettings);
  ledger[submissionId]={fingerprint:JSON.stringify({threadId,text}),createdAt:Date.now(),threadId,imageIds:images.fromContent(managedInput).map(image=>image.id),modelSettings:requestedSettings,managed:true};
  try {
    await saveLedger();
    const result:Row=await bridge.request('turn/start',{threadId,input:managedInput,clientUserMessageId:submissionId,...overrides,...(execution.cwd?{cwd:execution.cwd}:{})});
    ledger[submissionId].result=result;
    if(result.turn?.id&&execution.imageIds?.length)turnImages.set(threadId+':'+result.turn.id,images.fromContent(managedInput).map(image=>image.id));
    if(result.turn?.id&&active.get(threadId)==='starting')active.set(threadId,result.turn.id);
    if(requestedSettings&&result.turn?.id){nativeSettings.set(threadId,requestedSettings);turnSettings.set(threadId+':'+result.turn.id,requestedSettings);}
    await saveLedger(); return result;
  } finally {
    if(active.get(threadId)==='starting'){active.delete(threadId);activeCwds.delete(threadId);pendingModels.delete(threadId);}
  }
}

async function readTurn(threadId:string,turnId:string):Promise<Row|null> {
  return findTurn(bridge,threadId,turnId);
}

async function waitTurn(threadId:string,turnId:string,timeoutMs:number):Promise<Row> {
  const settled=(turn:Row|null)=>turn&&turn.status!=='inProgress'&&!(turn.status==='interrupted'&&active.get(threadId)===turnId);
  const existing=await readTurn(threadId,turnId);
  if(settled(existing))return existing!;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{bridge.off('event',onEvent);reject(new Error('任务等待超时，执行结果需要人工核对'));},timeoutMs);
    const onEvent=(event:Row)=>{
      if(event.method==='omega/disconnected'){
        clearTimeout(timer);bridge.off('event',onEvent);reject(new Error('Codex App Server 连接中断，执行结果需要核对'));return;
      }
      if(event.method!=='turn/completed'||event.params?.threadId!==threadId||event.params?.turn?.id!==turnId)return;
      clearTimeout(timer);bridge.off('event',onEvent);resolve(event.params.turn);
    };
    bridge.on('event',onEvent);
    readTurn(threadId,turnId).then(turn=>{
      if(settled(turn)){clearTimeout(timer);bridge.off('event',onEvent);resolve(turn!);}
    }).catch(()=>{});
  });
}

async function readTurnText(threadId:string,turnId:string){
  const turn=await readTurn(threadId,turnId);
  if(!turn)throw new Error('找不到对应执行轮次');
  const messages=(turn.items||[]).filter((item:Row)=>item.type==='agentMessage').map((item:Row)=>item.text||'').filter(Boolean);
  return messages.at(-1)||'';
}

orchestrator=new GroupOrchestrator({store:groups,startTurn:startManagedTurn,waitTurn,readTurnText,
  inspectTurn:readTurn,
  lookupDispatch:id=>ledger[id]?.result?.turn?.id||null,
  handoffFiles:tasks=>handoffFiles(path.join(state,'group-handoffs'),tasks),
  readPastes:refs=>pastedTexts.contents(refs),
  interruptTurn:(threadId,turnId)=>bridge.request('turn/interrupt',{threadId,turnId}),
  isThreadActive:id=>active.has(id),isWorkspaceBusy:(cwd,groupId,accessMode='write')=>{
    if(groups.runningConflict(cwd,null,accessMode))return true;
    for(const entry of activeCwds.values())if(modesConflict(accessMode,entry.accessMode)&&pathsOverlap(cwd,entry.cwd))return true;
    return false;
  },notify:broadcast});
automationService=new AutomationService(automationStore,async(threadId,text,submissionId,execution)=>{try{return await startManagedTurn(threadId,text,submissionId,execution)}catch(error){if(!ledger[submissionId]&&error instanceof Error)Object.assign(error,{definiteNotStarted:true});throw error;}},id=>active.has(id),broadcast);
ready.then(()=>orchestrator.resume()).catch(()=>{});
ready.then(()=>automationService.start()).catch(()=>{});
const allowed = new Set(['thread/delete', 'thread/name/set', 'thread/list', 'thread/read', 'thread/resume', 'thread/turns/list', 'thread/items/list', 'thread/start', 'turn/start', 'turn/interrupt', 'account/read', 'model/list', 'app/list', 'app/installed', 'app/read', 'plugin/list', 'plugin/read', 'plugin/install', 'plugin/uninstall', 'mcpServerStatus/list', 'mcpServer/oauth/login', 'config/mcpServer/reload']);
function authorized(req:http.IncomingMessage) {
  const value = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected=Buffer.from(token!);
  return value.length === expected.length && timingSafeEqual(value, expected);
}
async function body(req:http.IncomingMessage):Promise<Row> {
  let size=0;const chunks:Buffer[]=[];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function rawBody(req:http.IncomingMessage,max=260*1024*1024){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('上传内容过大'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
function json(res:http.ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const url=new URL(req.url||'/','http://localhost');
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
      if(url.pathname.startsWith('/api/pasted-text/')&&req.method==='GET'){
        const value=await pastedTexts.resolve(url.pathname.slice('/api/pasted-text/'.length));
        res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-length':value.bytes});return res.end(value.text);
      }
      if(url.pathname==='/api/pasted-text'&&req.method==='POST'){
        if(!String(req.headers['content-type']||'').toLowerCase().startsWith('text/plain'))return json(res,415,{error:'仅支持纯文本粘贴内容'});
        if(Number(req.headers['content-length'])>MAX_PASTED_TEXT_BYTES)return json(res,413,{error:'单段粘贴文本不得超过 512 KB'});
        return json(res,201,await pastedTexts.upload(await rawBody(req,MAX_PASTED_TEXT_BYTES)));
      }
      if(url.pathname==='/api/documents'&&req.method==='POST'){
        if(Number(req.headers['content-length'])>MAX_DOCUMENT_BYTES)return json(res,413,{error:'文档不得超过 10 MB'});
        const text=await importDocument(url.searchParams.get('name')||'',()=>rawBody(req,MAX_DOCUMENT_BYTES));
        return json(res,201,await pastedTexts.upload(Buffer.from(text)));
      }
      if(url.pathname==='/api/backup'&&req.method==='GET'){if(active.size||bridge.approvals.size)throw Object.assign(new Error('仍有任务执行或等待审批，暂不能创建一致性备份'),{status:409});const archive=createBackup(state),name=`omega-${new Date().toISOString().slice(0,10)}.omega-backup.gz`;res.writeHead(200,{'content-type':'application/gzip','content-disposition':`attachment; filename="${name}"`,'content-length':archive.length,'cache-control':'no-store'});return res.end(archive);}
      if(url.pathname==='/api/restore'&&req.method==='POST'){if(active.size||bridge.approvals.size)throw Object.assign(new Error('仍有任务执行或等待审批，暂不能恢复备份'),{status:409});return json(res,200,stageRestore(state,await rawBody(req)));}
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
          return json(res,201,await images.upload(Buffer.concat(chunks),req.headers['content-type']||''));
        } finally { uploadsInFlight--; }
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
        res.write(`data: ${JSON.stringify({ method: 'omega/snapshot', params: { ready: bridge.ready, approvals: [...bridge.approvals.values()], active: Object.fromEntries(active),readState:readState.snapshot(),eventCursor:eventId } })}\n\n`);
        const client=res as EventClient;clients.add(client);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
        client.threadId=url.searchParams.get('threadId')||undefined;
        const claimed=String(req.headers['x-omega-device']||'');client.deviceId=/^[a-z0-9-]{8,80}$/i.test(claimed)?claimed:undefined;
        const cursor=Number(req.headers['last-event-id']||url.searchParams.get('lastEventId')||0);
        if(Number.isSafeInteger(cursor)&&cursor>0&&cursor<=eventId)for(const entry of eventLog)if(entry.id>cursor&&eventVisible(client,entry.event))res.write(entry.data);
        req.on('close',()=>{clearInterval(heartbeat);clients.delete(client);});return;
      }
      if (url.pathname === '/api/status') {const known=new Set<string>();let anonymous=0;for(const client of clients)client.deviceId?known.add(client.deviceId):anonymous++;return json(res, 200, { ready: bridge.ready, canChangeKey: !process.env.OMEGA_ACCESS_TOKEN, workspace, devices: known.size+anonymous, active: Object.fromEntries(active), approvals: [...bridge.approvals.values()] });}
      if(url.pathname==='/api/health'&&req.method==='GET'){const memory=process.memoryUsage();return json(res,200,{status:bridge.ready?'healthy':'degraded',version:'0.2.1',pid:process.pid,startedAt:startedAt.toISOString(),uptimeSeconds:Math.floor(process.uptime()),memory:{rss:memory.rss,heapUsed:memory.heapUsed,heapTotal:memory.heapTotal},bridge:bridge.diagnostics(),clients:clients.size,devices:new Set([...clients].map(client=>client.deviceId).filter(Boolean)).size,activeTurns:active.size,pendingRestore:await stat(path.join(state,'.restore-pending')).then(()=>true).catch(()=>false),supervised:process.env.OMEGA_SUPERVISED==='1'});}
      if(url.pathname==='/api/system'&&req.method==='POST'){const input=await body(req);if(input.action==='restartCodex'){bridge.restart();return json(res,202,{ok:true,message:'Codex App Server 正在重启'});}if(input.action==='restartOmega'){if(process.env.OMEGA_SUPERVISED!=='1')throw Object.assign(new Error('当前 Omega 未由守护进程管理，请在终端重启服务'),{status:409});json(res,202,{ok:true,message:'Omega 正在重启'});setTimeout(()=>process.exit(75),150).unref();return;}throw new Error('不支持的系统操作');}
      if(url.pathname==='/api/read-state'&&req.method==='GET')return json(res,200,readState.snapshot());
      if(url.pathname==='/api/read-state'&&req.method==='POST'){
        const input=await body(req),scope=input.scope;
        if(!['thread','group'].includes(scope)||typeof input.id!=='string'||!/^[a-z0-9:_-]{1,120}$/i.test(input.id))throw new Error('阅读位置无效');
        readState.markRead(scope,input.id);broadcast({method:'omega/read-state',params:{scope,id:input.id}});return json(res,200,readState.snapshot());
      }
      if(url.pathname==='/api/search'&&req.method==='GET'){
        const query=String(url.searchParams.get('q')||'').trim();if(query.length<2||query.length>200)throw new Error('搜索内容需要 2–200 个字符');
        await ready;const listed:Row=await bridge.request('thread/list',{limit:100,sourceKinds:[]}),needle=query.toLowerCase();
        const names=(listed.data||[]).filter((thread:Row)=>`${thread.name||''} ${thread.preview||''}`.toLowerCase().includes(needle)).slice(0,20).map((thread:Row)=>({scope:'thread',id:thread.id,anchor:null,title:thread.name||thread.preview||'新会话',snippet:thread.preview||thread.cwd||'',updatedAt:thread.updatedAt||null}));
        const indexed=searchStore.search(query,40),groupResults=groups.searchMessages(query,40),seen=new Set<string>(),results=[];for(const item of [...names,...indexed,...groupResults].sort((a:any,b:any)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))){const key=`${item.scope}:${item.id}:${item.anchor||''}`;if(seen.has(key))continue;seen.add(key);results.push(item);if(results.length>=60)break;}return json(res,200,{query,results});
      }
      if(url.pathname==='/api/attention'&&req.method==='GET'){
        const offset=Math.floor(Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0))),limit=url.searchParams.get('summary')==='1'?0:30;
        const approvals=[...bridge.approvals.values()].map(request=>({id:`approval:${request.id}`,kind:'approval',request}));
        const page=groupAttention(groups,Math.max(0,offset-approvals.length),Math.max(0,limit-Math.max(0,approvals.length-offset)));
        const visible=[...approvals.slice(offset,offset+limit),...page.items].slice(0,limit);
        const autos=automationStore.attention(Math.max(0,offset-approvals.length-page.total),limit-visible.length);
        return json(res,200,{total:approvals.length+page.total+autos.total,items:[...visible,...autos.items]});
      }
      if (url.pathname === '/api/automations' && req.method === 'GET') return json(res,200,{automations:automationStore.list()});
      if(url.pathname==='/api/automation-runs'&&req.method==='GET')return json(res,200,automationStore.runs(url.searchParams.get('id')||'',Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER));
      if (url.pathname === '/api/groups' && req.method === 'GET') return json(res,200,{groups:groups.listGroups()});
      if (url.pathname.startsWith('/api/groups/') && req.method === 'GET') {
        const id=decodeURIComponent(url.pathname.slice('/api/groups/'.length));
        if(url.searchParams.has('after')||url.searchParams.has('question')){groups.getGroup(id);return json(res,200,{messages:groups.roomWindow(id,{after:url.searchParams.get('after'),question:url.searchParams.get('question')})});}
        if(url.searchParams.has('before')){groups.getGroup(id);return json(res,200,{messages:groups.roomMessages(id,url.searchParams.get('before'))});}
        const group=groups.getGroup(id,url.searchParams.get('requirementId'));
        const known=new Set((url.searchParams.get('known')||'').split(','));
        const messageKeys=group.messages.map((message:Row)=>createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0,24));
        const messageIds=group.messages.map((message:Row)=>message.id);
        group.messages=group.messages.filter((_message:Row,index:number)=>!known.has(messageKeys[index]));
        return json(res,200,{group:url.searchParams.get('view')==='room'?groupRoomView(group):group,messageKeys,messageIds});
      }
      if(url.pathname==='/api/integrations'&&req.method==='GET'){
        await ready;
        const read=async(method:string,params:Row={})=>{try{return{ok:true,data:await bridge.request(method,params)};}catch(error){return{ok:false,error:(error as Error).message};}};
        const [apps,installed,mcp,plugins]=await Promise.all([read('app/list',{limit:100}),read('app/installed',{}),read('mcpServerStatus/list',{limit:100}),read('plugin/list',{cwds:[workspace]})]);
        return json(res,200,{apps,installed,mcp,plugins});
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
      if(url.pathname==='/api/repository'){
        if(typeof input.threadId!=='string'||!input.threadId)throw new Error('请选择会话');
        const result=freshThreads.get(input.threadId)||await bridge.request('thread/read',{threadId:input.threadId,includeTurns:false});
        if(!result.thread?.cwd)throw new Error('会话没有工作目录');
        return json(res,200,await repositoryView(result.thread.cwd,{scope:input.scope,file:input.file,offset:input.offset}));
      }
      if(url.pathname==='/api/automations'){
        let result;
        if(input.expectedRunId&&['reconcile','cancelWaiting'].includes(input.action)&&automationStore.latestRun(input.id)?.id!==input.expectedRunId)return json(res,409,{error:'运行记录已变化，请刷新后操作。'});
        if(input.action==='create'){await bridge.request('thread/read',{threadId:input.threadId,includeTurns:false});result=automationStore.create(input);}
        else if(input.action==='update'){if(input.threadId)await bridge.request('thread/read',{threadId:input.threadId,includeTurns:false});result=automationStore.update(input.id,input);}
        else if(input.action==='delete')result=automationStore.remove(input.id);
        else if(input.action==='run')result=await automationService.run(automationStore.get(input.id),true);
        else if(input.action==='reconcile'){
          let item=automationStore.get(input.id);const run=automationStore.latestRun(item.id),recorded=run&&ledger[`automation:${item.id}:${run.id}`]?.result?.turn?.id;
          if(item.lastStatus==='unknown'&&!item.lastTurnId&&recorded)item=automationStore.setTurn(item.id,recorded);
          if(item.lastStatus!=='unknown'||!item.lastTurnId)throw Object.assign(new Error('没有可核对的原轮次，请打开目标会话检查；不会自动重发。'),{status:409});
          const listed=await bridge.request('thread/turns/list',{threadId:item.threadId,limit:100,sortDirection:'desc',itemsView:'summary'});
          const turn=listed.data?.find((t:Row)=>t.id===item.lastTurnId);
          if(!turn||!['completed','failed','interrupted'].includes(turn.status))throw Object.assign(new Error('原轮次未找到或尚未结束，继续保持待核对，不重发。'),{status:409});
          automationService.complete(turn.id,turn.status==='completed',turn.error?.message,turn.status==='interrupted');result=automationStore.get(item.id);
        }
        else if(input.action==='cancelWaiting'){const item=automationStore.get(input.id);if(item.lastStatus!=='waiting')throw Object.assign(new Error('排队已结束，请刷新'),{status:409});automationStore.cancelWaiting(item.id);result=automationStore.get(item.id);}
        else throw new Error('不支持的自动化操作');
        return json(res,200,result);
      }
      if(url.pathname==='/api/integrations'){
        let result;
        if(input.action==='reloadMcp')result=await bridge.request('config/mcpServer/reload',{});
        else if(input.action==='oauthLogin')result=await bridge.request('mcpServer/oauth/login',{name:String(input.name||''),...(input.threadId?{threadId:input.threadId}:{})});
        else if(input.action==='setAppEnabled'){
          const id=String(input.id||'');if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(id))throw new Error('App 标识无效');
          result=await bridge.request('config/value/write',{keyPath:`apps.${id}.enabled`,value:input.enabled===true,mergeStrategy:'replace'});
        }else throw new Error('不支持的连接操作');
        broadcast({method:'omega/integrations-updated',params:{action:input.action}});return json(res,200,result);
      }
      if(url.pathname==='/api/groups'){
        if(input.expectedUpdatedAt&&['retry','setBudget'].includes(input.action)){
          const row=groups.db.prepare('SELECT status,updated_at FROM requirements WHERE id=? AND group_id=?').get(input.requirementId,input.groupId);
          if(!row||row.status!=='paused'||row.updated_at!==input.expectedUpdatedAt)return json(res,409,{error:'事项已变化或已在其他设备处理，请刷新。'});
        }
        let result;
        if(input.action==='create'){
          groups.validateGroupInput(input);
          const started:Row=await bridge.request('thread/start',{cwd:workspace,approvalPolicy:'on-request',sandbox:'workspace-write',ephemeral:false});
          const coordinatorThreadId=started.thread?.id;
          if(!coordinatorThreadId)throw new Error('无法创建群组协调者会话');
          freshThreads.set(coordinatorThreadId,started);metrics.seed(coordinatorThreadId);
          const name=`[协调者] ${String(input.name||'新群组').trim().slice(0,60)}`;
          try{await bridge.request('thread/name/set',{threadId:coordinatorThreadId,name});started.thread.name=name;}catch{}
          result=groups.createGroup(input,coordinatorThreadId,workspace);
        }else if(input.action==='deleteGroup'){
          const group=groups.getGroup(input.groupId),threadIds=new Set([group.coordinatorThreadId,...group.members.map((member:Row)=>member.threadId)]);
          if(active.has(group.coordinatorThreadId)||group.runningTasks)throw Object.assign(new Error('群组仍有协调或成员任务正在执行，请先停止'),{status:409});
          if([...bridge.approvals.values()].some(request=>threadIds.has(request.params?.threadId)))throw Object.assign(new Error('群组仍有待处理审批，请先处理或停止对应任务'),{status:409});
          orchestrator.suspend(group.id);deletingThread=true;
          let coordinatorDeleted=true;
          try{
            try{await bridge.request('thread/delete',{threadId:group.coordinatorThreadId});}
            catch(error){if(!/missing source rollout|invalid paginated history lineage|not found|does not exist/i.test((error as Error).message))throw error;coordinatorDeleted=false;}
            const deleted=groups.deleteGroup(group.id);orchestrator.forget(group.id);freshThreads.delete(group.coordinatorThreadId);
            readState.remove('group',group.id);
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
          const group=groups.getGroup(input.groupId,input.requirementId),member=group.members.find((item:Row)=>item.id===input.memberId);
          if(!member)throw Object.assign(new Error('成员不存在'),{status:404});
          const selectedThreadId=input.threadId||member.threadId;
          if(selectedThreadId!==member.threadId&&active.has(selectedThreadId))throw Object.assign(new Error('新会话正在执行任务，请稍后再试'),{status:409});
          if(selectedThreadId===group.coordinatorThreadId)throw new Error('协调者会话不能同时作为执行成员');
          const check=freshThreads.get(selectedThreadId)||await bridge.request('thread/read',{threadId:selectedThreadId,includeTurns:false});
          if(!check.thread?.id)throw new Error('成员会话不存在或无法恢复');
          const memberCwd=await resolveMemberWorkspace(check.thread.cwd,input.cwd||member.cwd),update={...input,threadId:selectedThreadId,cwd:memberCwd};
          result=groups.updateMember(input.groupId,input.memberId,update,input.requirementId);
        }
        else if(input.action==='setBudget'){result=groups.extendBudget(input.groupId,input.requirementId,input);orchestrator.changed(input.groupId);orchestrator.schedule(input.groupId);}
        else if(input.action==='setConcurrency'){result=groups.setConcurrency(input.groupId,input.maxConcurrency,input.requirementId);orchestrator.schedule(input.groupId);}
        else if(input.action==='submit'){await images.turnInput([{type:'text',text:input.content||''}],input.imageIds||[]);input.imageRefs=(input.imageIds||[]).map((id:string)=>imageInfo(id));input.pasteRefs=await pastedTexts.refs(input.pasteIds||[]);result=orchestrator.submit(input.groupId,input);}
        else if(input.action==='updateTask')result=groups.updateDraftTask(input.groupId,input.requirementId,input);
        else if(input.action==='confirm')result=orchestrator.confirm(input.groupId,input.requirementId);
        else if(input.action==='retry')result=await orchestrator.retry(input.groupId,input.requirementId);
        else if(input.action==='reassign'){result=groups.reassignTask(input.groupId,input.taskId,input.memberId);orchestrator.changed(input.groupId);orchestrator.schedule(input.groupId);}
        else if(input.action==='requestChanges')result=orchestrator.requestChanges(input.groupId,input.requirementId,input);
        else if(input.action==='resolveDecision')result=orchestrator.resolveDecision(input.groupId,input.taskId,input);
        else if(input.action==='stop'){
          const group=groups.getGroup(input.groupId,input.requirementId),task=group.requirement?.tasks?.find((item:Row)=>item.status==='running'||item.status==='reviewing');
          const member=task&&group.members.find((item:Row)=>item.id===task.memberId);
          const target=group.requirement?.status==='finalizing'||task?.status==='reviewing'?group.coordinatorThreadId:member?.threadId;
          const turnId=target&&active.get(target);
          if((!task&&group.requirement?.status!=='finalizing')||!target||!turnId||turnId==='starting')throw Object.assign(new Error('当前没有可中断的群组执行轮次'),{status:409});
          await bridge.request('turn/interrupt',{threadId:target,turnId});result=groups.getGroup(input.groupId,input.requirementId);
        }
        else if(input.action==='accept')result=groups.accept(input.groupId,input.requirementId);
        else if(input.action==='cancel'){
          const before=groups.getGroup(input.groupId,input.requirementId),targets=new Map<string,string>();
          const summary=groups.db.prepare("SELECT turn_id,dispatch_id FROM discussion_reports WHERE requirement_id=? AND status IN ('running','unknown') ORDER BY round_no DESC LIMIT 1").get(before.requirement?.id||'');
          const summaryTurn=summary&&(summary.turn_id||orchestrator.lookupDispatch(summary.dispatch_id));
          if(summaryTurn&&active.get(before.coordinatorThreadId)===summaryTurn)targets.set(before.coordinatorThreadId,summaryTurn);
          for(const task of before.requirement?.tasks||[]){const member=before.members.find((item:Row)=>item.id===task.memberId),turnId=member&&active.get(member.threadId);if(task.status==='running'&&member&&turnId&&turnId!=='starting')targets.set(member.threadId,turnId);}
          if(['plan_drafting','finalizing'].includes(before.requirement?.status)){const turnId=active.get(before.coordinatorThreadId);if(turnId&&turnId!=='starting')targets.set(before.coordinatorThreadId,turnId);}
          result=groups.cancel(input.groupId,input.requirementId);orchestrator.changed(input.groupId);
          await Promise.allSettled([...targets].map(([threadId,turnId])=>bridge.request('turn/interrupt',{threadId,turnId})));
        }
        else throw new Error('不支持的群组操作');
        broadcast({method:'omega/group-updated',params:{groupId:result.id}});
        return json(res,200,{group:input.view==='room'?groupRoomView(result):result});
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
        const fresh=freshThreads.get(input.threadId);
        const result = fresh || await bridge.request('thread/read', {threadId:input.threadId,includeTurns:false});
        const page:any=fresh
          ? historyPage(result.thread,input,(item,turn)=>attachments(item,input.threadId,turn.id),(item,turn)=>submissionLayout(item,input.threadId,turn.id,ledger))
          : await paginatedHistoryPage(bridge,result.thread,input,(item,turn)=>attachments(item,input.threadId,turn.id),(item,turn)=>submissionLayout(item,input.threadId,turn.id,ledger));
        page.settings=await settingsFor(input.threadId,result);
        if(page.turn)page.turn.modelSettings=turnSettings.get(input.threadId+':'+page.turn.id)||null;
        if(page.turn) {
          await metricsQueue;
          try { page.turn.metrics=await metrics.view(input.threadId,page.turn); }
          catch(e){console.error('Turn metrics read failed:',(e as Error).message);}
        }
        if(page.turn)for(const item of page.turn.items||[])indexSearchItem(item,input.threadId,page.turn.id,result.thread.name||result.thread.preview||input.threadId);
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
      if(input.method==='plugin/install'&&input.confirmInstall!==true)return json(res,400,{error:'安装插件前需要明确确认'});
      if(input.method==='plugin/uninstall'&&input.confirmUninstall!==true)return json(res,400,{error:'卸载插件前需要明确确认'});
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
          readState.remove('thread',params.threadId);
          searchStore.removeThread(params.threadId);
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
        const fingerprint = JSON.stringify({threadId:params.threadId,input:params.input,...(input.imageIds?.length ? {imageIds:input.imageIds} : {}),...(input.pasteIds?.length?{pasteIds:input.pasteIds}:{}),...(input.settingsRevision!==undefined?{settingsRevision:input.settingsRevision}:{})});
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
        }catch(error){if((error as {status?:number}).status)throw error;}
        if (submissions.size >= 2000) throw new Error('Submission cache full; restart Omega after active tasks finish.');
        const savedSettings=await modelSettings.read(params.threadId);
        if(input.settingsRevision!==undefined&&input.settingsRevision!==savedSettings.revision)return json(res,409,{error:'模型设置已在其他设备修改，请核对最新设置后发送'});
        const overrides:Row=await modelSettings.resolve(savedSettings,!!input.imageIds?.length);
        const pasteRefs=await pastedTexts.refs(input.pasteIds||[]);
        const turnInput = await images.turnInput(await pastedTexts.turnInput(params.input,input.pasteIds),input.imageIds);
        if((await modelSettings.read(params.threadId)).revision!==savedSettings.revision)return json(res,409,{error:'模型设置已更新，请核对后重新发送'});
        // Validation touches disk; recheck concurrency after that await.
        if (deletingThread) return json(res,409,{error:'正在删除会话，请稍后再试'});
        if (ledger[id] && ledger[id].fingerprint !== fingerprint) return json(res,409,{error:'Submission ID was already used for different input'});
        if (submissions.has(id)) return json(res,200,await submissions.get(id));
        if (active.has(params.threadId)) return json(res,409,{error:'This conversation is already working.'});
        const workspaceConflict=reserveWorkspace(params.threadId,requestCwd,null);
        if(workspaceConflict)return json(res,409,{error:workspaceConflict.message});
        active.set(params.threadId, 'starting');
        const imageIds = images.fromContent(turnInput).map(image=>image.id);
        pendingPastes.set(params.threadId,pasteRefs);
        pendingImages.set(params.threadId,imageIds);
        const requestedSettings=overrides.model?overrides:nativeSettings.get(params.threadId)||null;
        if(requestedSettings)pendingModels.set(params.threadId,requestedSettings);
        ledger[id] = {fingerprint,createdAt:Date.now(),threadId:params.threadId,imageIds,pasteRefs,modelSettings:requestedSettings};
        const operation=saveLedger().then(()=>bridge.request(input.method,{threadId:params.threadId,input:turnInput,clientUserMessageId:id,...overrides})).then(async(result:Row)=>{
          ledger[id].result=result;
          if(requestedSettings&&result.turn?.id){
            nativeSettings.set(params.threadId,requestedSettings);
            turnSettings.set(params.threadId+':'+result.turn.id,requestedSettings);
            broadcast({method:'omega/turn-model',params:{threadId:params.threadId,turnId:result.turn.id,settings:requestedSettings}});
          }
          if (imageIds.length && result.turn?.id) turnImages.set(params.threadId+':'+result.turn.id,imageIds);
          if(pasteRefs.length&&result.turn?.id)turnPastes.set(params.threadId+':'+result.turn.id,pasteRefs);
          await saveLedger(); return result;
        }).finally(() => {
          submissions.delete(id);
          if (active.get(params.threadId) === 'starting') { active.delete(params.threadId); activeCwds.delete(params.threadId); pendingImages.delete(params.threadId);pendingPastes.delete(params.threadId); pendingModels.delete(params.threadId); }
        });
        submissions.set(id, operation);
        return json(res, 200, await operation);
      }
      const result:Row=await bridge.request(input.method,params);
      if(['thread/start','thread/resume'].includes(input.method))rememberNative(result);
      if (input.method === 'thread/resume' && input.summaryOnly) {
        return json(res,200,{thread:{id:result.thread.id}});
      }
      if (input.method === 'thread/start') { freshThreads.set(result.thread.id,result); metrics.seed(result.thread.id); }
      if(input.method==='thread/list')result.data=[...[...freshThreads.values()].map(x=>x.thread).filter(t=>!result.data.some((x:Row)=>x.id===t.id)),...result.data];
      if (result.thread?.turns) for (const turn of result.thread.turns) if (turn.status === 'inProgress') active.set(result.thread.id,turn.id);
      return json(res, 200, result);
    }
    const vendors:Record<string,string>={'/vendor/marked.js':'node_modules/marked/lib/marked.esm.js','/vendor/purify.js':'node_modules/dompurify/dist/purify.es.mjs'};
    let file;if(vendors[url.pathname])file=path.join(root,vendors[url.pathname]);else{const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));if(relative.includes('..')||path.isAbsolute(relative)){res.writeHead(404);return res.end();}const built=path.join(root,'web-dist',relative),source=path.join(root,'public',relative);try{await stat(built);file=built;}catch{file=source;}}
    let contents;try{contents=await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){res.writeHead(404);return res.end();}throw error;}
    const ext=path.extname(file),types:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};res.setHeader('content-type',types[ext]||'application/octet-stream');res.end(contents);
  } catch (error:any) {
    const busyThreadId=activeWriterThreadId(error);
    if (!res.headersSent) json(res,busyThreadId?409:error.status||400,busyThreadId?{error:threadWriterBusyMessage(),code:THREAD_WRITER_BUSY,threadId:busyThreadId}:{error:error.message});
    else res.end();
  }
});
server.listen(Number(process.env.PORT || 4310), process.env.OMEGA_HOST || '127.0.0.1', () => console.log(`Omega: http://${process.env.OMEGA_HOST || '127.0.0.1'}:${process.env.PORT || 4310}\nAccess key file: ${tokenPath}\nWorkspace: ${workspace}`));
let shuttingDown=false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {if(shuttingDown)return;shuttingDown=true;clearInterval(imageCleanupTimer);automationService.close();for(const client of clients)client.end();server.close();bridge.close();groups.close();automationStore.close();readState.close();searchStore.close();});
