import {appStore} from './AppState.js';
import {imageSafeSlice} from '../../src/shared/inline-images.js';

export interface SessionSnapshot{
  threadId:string|null;active:Record<string,string>;approvals:any[];
  authenticated:boolean;canChangeKey:boolean;lastEventId:number;
  serverWorkspace:string;composerWorkspace:string;onlineDevices:number|null;
}

type Status={active?:Record<string,string>;approvals?:any[];workspace?:string;devices?:number;canChangeKey?:boolean};
type EventEffect={kind:'none'|'snapshot'|'approval'|'approval-resolved'|'turn-started'|'turn-completed';params:any};
const initial:SessionSnapshot={threadId:null,active:{},approvals:[],authenticated:false,canChangeKey:true,lastEventId:0,serverWorkspace:'',composerWorkspace:'',onlineDevices:null};

function createSession(){
  let state={...initial};
  const publish=(next:Partial<SessionSnapshot>)=>{
    state={...state,...next};
    const shell:Record<string,unknown>={};
    if('threadId'in next)shell.threadId=state.threadId;
    if('authenticated'in next)shell.authenticated=state.authenticated;
    if('onlineDevices'in next)shell.onlineDevices=state.onlineDevices;
    if(Object.keys(shell).length)appStore.patch(shell);
  };
  return{
    get snapshot(){return state},
    patch:publish,
    selectThread(threadId:string|null){publish({threadId})},
    setConnection(authenticated:boolean,connected:boolean,label:string){publish({authenticated});appStore.patch({connected,connectionLabel:label})},
    applyStatus(status:Status,{initialize=false}:{initialize?:boolean}={}){
      const next:Partial<SessionSnapshot>={active:status.active||{},approvals:status.approvals||[],onlineDevices:status.devices??state.onlineDevices};
      if(initialize){next.serverWorkspace=status.workspace||'';next.composerWorkspace=status.workspace||'';next.canChangeKey=status.canChangeKey!==false;next.authenticated=true;}
      publish(next);
    },
    setComposerWorkspace(composerWorkspace:string){publish({composerWorkspace})},
    setEventCursor(value:unknown){if(Number.isSafeInteger(value)&&Number(value)>=0)publish({lastEventId:Math.max(state.lastEventId,Number(value))})},
    reduce(message:any):EventEffect{
      const params=message?.params||{};
      if(message?.method==='omega/snapshot'){
        publish({active:params.active||{},approvals:params.approvals||[]});
        this.setEventCursor(params.eventCursor);
        return{kind:'snapshot',params};
      }
      if(message?.id!==undefined){publish({approvals:[...state.approvals,message]});return{kind:'approval',params};}
      if(message?.method==='serverRequest/resolved'){
        publish({approvals:state.approvals.filter(value=>String(value.id)!==String(params.requestId))});
        return{kind:'approval-resolved',params};
      }
      if(message?.method==='turn/started'){
        publish({active:{...state.active,[params.threadId]:params.turn.id}});
        return{kind:'turn-started',params};
      }
      if(message?.method==='turn/completed'){
        const active={...state.active};delete active[params.threadId];publish({active});
        return{kind:'turn-completed',params};
      }
      return{kind:'none',params};
    },
    context(){return{threadId:state.threadId,active:{...state.active},authenticated:state.authenticated}},
  };
}

function createConversationDirectory(){
  let items:any[]=[],revision=0;
  const names=new Map<string,string>(),deleted=new Set<string>(),unread=new Map<string,{count:number;position:string|null}>();
  return{
    get revision(){return revision},get items(){return items},
    isDeleted(id:string|undefined){return !!id&&deleted.has(id)},
    position(id:string){return unread.get(id)?.position||null},
    displayName(thread:any){return names.get(thread.id)||thread.name||thread.preview||'新会话'},
    replace(next:any[],expectedRevision:number){items=next.filter(thread=>!deleted.has(thread.id));if(expectedRevision===revision)for(const thread of items)if(thread.name)names.set(thread.id,thread.name);},
    rename(id:string,name:string){revision++;names.set(id,name);items=items.map(thread=>thread.id===id?{...thread,name}:thread)},
    remove(id:string){deleted.add(id);items=items.filter(thread=>thread.id!==id);names.delete(id);unread.delete(id);revision++},
    applyReadState(value:any){
      unread.clear();
      for(const id of value?.unread?.threads||[])unread.set(id,{count:value?.counts?.threads?.[id]||1,position:value?.positions?.threads?.[id]||null});
    },
    markRead(id:string){unread.delete(id)},
    markUnread(id:string,count:number,position?:string|null){const current=unread.get(id);unread.set(id,{count:count||1,position:current?.position||position||null})},
    sidebarItems(){return items.map(thread=>{const state=unread.get(thread.id),name=names.get(thread.id);return{...thread,...(name?{name}:{}),unread:!!state,unreadCount:state?.count||0}})},
  };
}

const effortName=(value:unknown)=>({none:'无',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'超高'}[String(value)]||String(value||'默认'));
function timelineItemText(item:any){
  if(item.pageText!==undefined)return item.pageText;
  if(item.type==='userMessage')return(item.content||[]).map((value:any)=>value.text||(value.type==='image'?'[图片]':'')).join(item.content?.some((value:any)=>value.text?.includes('[OmegaImage:'))?'':'\n');
  if(item.type==='agentMessage')return item.text||'';
  if(item.type==='commandExecution')return`$ ${item.command||''}\n${item.aggregatedOutput||''}\n${item.status||''}`;
  if(item.type==='fileChange')return(item.changes||[]).map((value:any)=>`${value.path}\n${value.diff||''}`).join('\n');
  if(item.type==='reasoning')return[...(item.summary||[]),...(item.content||[])].join('\n');
  return JSON.stringify(item,null,2);
}

export function createTimeline(){
  let items=new Map<string,any>(),outline:any[]=[],selectedTurn:string|null=null,historyMode=false;
  let historyCursor:string|null=null,olderHistoryCursor:string|null=null,newerHistoryCursors:Array<string|null>=[],version=0,loadingVersion:number|null=null;
  let turnMetrics:any=null,metricsReceivedAt=0,metricsRevision=0,turnModel:any=null;
  const expandedTools=new Set<string>(),recentMetrics=new Map<string,{metrics:any;receivedAt:number;revision:number}>();
  const clearMetrics=()=>{turnMetrics=null;metricsReceivedAt=Date.now();turnModel=null};
  const clearItems=()=>{items.clear();expandedTools.clear()};
  const resetHistory=()=>{selectedTurn=null;outline=[];historyMode=false;historyCursor=null;olderHistoryCursor=null;newerHistoryCursors=[]};
  const metricsText=()=>{
    if(!selectedTurn)return'';const metrics=turnMetrics,usage=metrics?.usage;
    const elapsed=metrics?.elapsedMs==null?null:metrics.elapsedMs+(metrics.running?Math.max(0,Date.now()-metricsReceivedAt):0);
    const count=(value:unknown)=>typeof value==='number'?value.toLocaleString():'暂无',time=elapsed===null?'暂无':(elapsed/1000).toFixed(1)+' 秒';
    const speed=!metrics?.running&&elapsed>0&&typeof usage?.outputTokens==='number'?(usage.outputTokens/(elapsed/1000)).toFixed(1)+' tokens/s':'暂无';
    const parts=[(metrics?.running?'进行中 · ':'')+'耗时 '+(metrics?.observedTime&&elapsed!==null?'约 ':'')+time,'输入 '+count(usage?.inputTokens),'输出 '+count(usage?.outputTokens)+' tokens','整轮平均 '+speed];
    if(turnModel?.model)parts.unshift('本轮请求 '+turnModel.model+' · 推理 '+effortName(turnModel.effort));
    if(usage){parts.push('总量 '+count(usage.totalTokens));if(usage.cachedInputTokens!=null)parts.push('缓存命中 '+count(usage.cachedInputTokens));if(usage.reasoningOutputTokens!=null)parts.push('思考 '+count(usage.reasoningOutputTokens));}
    return parts.join(' · ');
  };
  return{
    itemText:timelineItemText,
    get version(){return version},get metricsRevision(){return metricsRevision},get metricsRunning(){return !!turnMetrics?.running},
    get selectedTurn(){return selectedTurn},get historyMode(){return historyMode},get historyCursor(){return historyCursor},
    get outline(){return outline},get olderHistoryCursor(){return olderHistoryCursor},get newerHistoryCursors(){return newerHistoryCursors},
    isCurrent(value:number){return value===version},
    view(active:boolean){return{items:[...items.values()].map(item=>({...item,open:expandedTools.has(item.id)})),active,metrics:metricsText(),historyMode,history:{outline,selectedTurn,hasOlder:!!olderHistoryCursor,hasNewer:!!newerHistoryCursors.length}}},
    resetDeleted(){version++;loadingVersion=null;resetHistory();clearItems();recentMetrics.clear();clearMetrics()},
    beginThread(){version++;resetHistory();clearItems();recentMetrics.clear();clearMetrics();return version},
    selectAt(turnId:string){historyMode=true;selectedTurn=turnId;clearItems();clearMetrics();version++;return version},
    selectTurn(index:number){if(!outline[index])return false;historyMode=historyCursor!==null||index!==outline.length-1;selectedTurn=outline[index].id;clearItems();clearMetrics();version++;return true},
    latest(){if(!historyMode)return false;historyMode=false;selectedTurn=null;historyCursor=null;olderHistoryCursor=null;newerHistoryCursors=[];clearItems();clearMetrics();version++;return true},
    previous(){const index=outline.findIndex(turn=>turn.id===selectedTurn);if(index>0)return{turn:index-1};return olderHistoryCursor?{page:'older' as const}:null},
    next(){const index=outline.findIndex(turn=>turn.id===selectedTurn);if(index>=0&&index<outline.length-1)return{turn:index+1};return newerHistoryCursors.length?{page:'newer' as const}:null},
    pageRequest(direction:'older'|'newer'){const cursor=direction==='older'?olderHistoryCursor:newerHistoryCursors.at(-1);return direction==='older'&&!cursor?null:{version:++version,cursor:cursor||null}},
    applyPage(direction:'older'|'newer',result:any,targetCursor:string|null){if(direction==='older')newerHistoryCursors.push(historyCursor);else newerHistoryCursors.pop();historyCursor=targetCursor;olderHistoryCursor=result.nextCursor||null;outline=result.outline||[];if(!outline.length)return false;selectedTurn=outline[direction==='older'?outline.length-1:0].id;historyMode=historyCursor!==null||selectedTurn!==outline.at(-1)?.id;clearItems();clearMetrics();version++;return true},
    hydrationRequest(){if(loadingVersion===version)return null;loadingVersion=version;return{version,metricsRevision,turnId:historyMode?selectedTurn:undefined,cursor:historyCursor||undefined,selectionOnly:historyMode||undefined}},
    finishHydration(requestVersion:number){if(requestVersion===version)loadingVersion=null},
    applyHydration(result:any,requestVersion:number,requestMetricsRevision:number){
      if(requestVersion!==version)return false;
      if(Array.isArray(result.outline)){outline=result.outline;historyCursor=null;olderHistoryCursor=result.nextCursor||null;newerHistoryCursors=[];}
      selectedTurn=result.turn?.id||null;turnModel=result.turn?.modelSettings||null;
      const newer=selectedTurn?recentMetrics.get(selectedTurn):null;
      const metric=newer&&newer.revision>requestMetricsRevision?newer:{metrics:result.turn?.metrics||null,receivedAt:Date.now()};
      turnMetrics=metric.metrics;metricsReceivedAt=metric.receivedAt;items=new Map((result.turn?.items||[]).map((item:any)=>[item.id,item]));return true;
    },
    applyItemPage(result:any,requestVersion:number){if(requestVersion!==version)return false;for(const item of result.turn?.items||[])items.set(item.id,item);return true},
    toggleTool(id:string,open:boolean){open?expandedTools.add(id):expandedTools.delete(id)},
    setTurnModel(settings:any){turnModel=settings},
    setMetrics(metrics:any,receivedAt=Date.now()){turnMetrics=metrics;metricsReceivedAt=receivedAt},
    receiveMetrics(turnId:string,metrics:any){metricsRevision++;recentMetrics.delete(turnId);recentMetrics.set(turnId,{metrics,receivedAt:Date.now(),revision:metricsRevision});if(recentMetrics.size>8)recentMetrics.delete(recentMetrics.keys().next().value!);if(turnId===selectedTurn)this.setMetrics(metrics)},
    startTurn(turn:any){version++;clearItems();selectedTurn=turn.id;turnModel=turn.modelSettings||null;this.setMetrics(null)},
    receiveItem(source:any){const text=timelineItemText(source),chat=['userMessage','agentMessage'].includes(source.type);items.set(source.id,{id:source.id,type:source.type,status:source.status,images:source.images||[],inlineImages:text.includes('[OmegaImage:'),pageText:chat?imageSafeSlice(text,0,12000):'',totalLength:text.length,offset:0,deferred:!chat})},
    receiveAgentDelta(itemId:string,delta:string){const item=items.get(itemId)||{id:itemId,type:'agentMessage',text:''};if(item.pageText!==undefined){item.text=item.pageText;delete item.pageText}item.text=((item.text||'')+delta).slice(-12000);items.set(item.id,item)},
    receiveCommandDelta(itemId:string,delta:string){const item=items.get(itemId);if(!item)return false;item.aggregatedOutput=((item.aggregatedOutput||'')+delta).slice(-12000);return true},
  };
}

interface LifecycleOptions{
  enabled():boolean;visible():boolean;threadId():string|null;cursor():number;
  fetchEvents(signal:AbortSignal,cursor:number,threadId:string|null):Promise<Response>;
  receive(message:any):void;setCursor(value:number):void;
  connection(connected:boolean,label:string):void;poll():Promise<void>;resync():Promise<void>;report(message:string):void;
}

function createLifecycle(options:LifecycleOptions){
  let streamController:AbortController|null=null,pollTimer:ReturnType<typeof setInterval>|null=null,resumeTimer:ReturnType<typeof setTimeout>|null=null,resuming=false,bound=false;
  const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function consume(signal:AbortSignal){
    while(!signal.aborted){
      try{
        const response=await options.fetchEvents(signal,options.cursor(),options.threadId());
        if(!response.ok)throw new Error('连接被拒绝，请检查访问密钥');
        options.connection(true,'已连接');
        const reader=response.body?.pipeThrough(new TextDecoderStream()).getReader();if(!reader)throw new Error('服务器没有返回事件流');
        let buffer='';
        while(!signal.aborted){
          const{value,done}=await reader.read();if(done)break;buffer+=value;
          let boundary;
          while((boundary=buffer.indexOf('\n\n'))>=0){
            const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const lines=block.split('\n'),idLine=lines.find(line=>line.startsWith('id: '));
            if(idLine){const next=Number(idLine.slice(4));if(Number.isSafeInteger(next)&&next>0){options.setCursor(next);}}
            const data=lines.filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
            if(data)options.receive(JSON.parse(data));
          }
        }
      }catch(error){if(signal.aborted)return;options.connection(false,'正在重连');}
      await delay(2000);
    }
  }
  const restartStream=()=>{streamController?.abort();streamController=new AbortController();void consume(streamController.signal)};
  const startPolling=()=>{if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{if(options.enabled())void options.poll().catch(()=>{})},15000)};
  const resume=()=>{
    if(resumeTimer)clearTimeout(resumeTimer);
    if(!options.enabled()||!options.visible())return;
    resumeTimer=setTimeout(async()=>{
      if(resuming||!options.enabled()||!options.visible())return;resuming=true;
      try{restartStream();await options.resync()}catch(error){options.report(error instanceof Error?error.message:String(error))}finally{resuming=false}
    },250);
  };
  const bindNative=()=>{
    if(bound)return;bound=true;
    document.addEventListener('visibilitychange',()=>{if(!options.visible())streamController?.abort();else resume()});
    window.addEventListener('online',resume);window.addEventListener('focus',resume);
  };
  return{restartStream,startPolling,resume,bindNative,stop(){streamController?.abort();streamController=null;if(pollTimer)clearInterval(pollTimer);pollTimer=null;if(resumeTimer)clearTimeout(resumeTimer);resumeTimer=null}};
}

export type SessionRuntime=ReturnType<typeof installSessionRuntime>;
export function installSessionRuntime(){
  const runtime={session:createSession(),conversations:createConversationDirectory(),timeline:createTimeline(),createLifecycle};
  window.omegaRuntime=runtime;
  window.dispatchEvent(new Event('omega:runtime-ready'));
  return runtime;
}
