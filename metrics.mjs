import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

const FIELDS = ['totalTokens','inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens'];
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
const totals = value => value && FIELDS.every(k => number(value[k]) !== null || !['inputTokens','outputTokens','totalTokens'].includes(k))
  ? Object.fromEntries(FIELDS.map(k=>[k,number(value[k])])) : null;
const milliseconds = x => number(x) === null ? null : x*1000;
export class TurnMetrics {
  constructor(directory,now=Date.now) { this.directory=directory; this.now=now; this.cache=new Map(); this.latest=new Map(); }
  async initialize() { await mkdir(this.directory,{recursive:true,mode:0o700}); }
  file(threadId,turnId) {
    if (![threadId,turnId].every(x=>typeof x==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x))) throw Error('Invalid metric identifier');
    return path.join(this.directory,threadId+'__'+turnId+'.json');
  }
  remember(map,key,value) { map.delete(key); map.set(key,value); if(map.size>256)map.delete(map.keys().next().value); }
  seed(threadId) { this.remember(this.latest,threadId,Object.fromEntries(FIELDS.map(k=>[k,0]))); }
  async read(threadId,turnId) {
    const file=this.file(threadId,turnId);
    if (this.cache.has(file)) { const record=this.cache.get(file);this.remember(this.cache,file,record);return record; }
    try { const record=JSON.parse(await readFile(file,'utf8'));this.remember(this.cache,file,record);return record; }
    catch(e) { if(e.code==='ENOENT')return null;throw e; }
  }
  async observe(event) {
    const {method,params:p={}}=event;
    if(!['turn/started','turn/completed','thread/tokenUsage/updated'].includes(method))return null;
    const turnId=p.turn?.id || p.turnId, threadId=p.threadId;
    if(!threadId || !turnId)return null;
    let record=await this.read(threadId,turnId);
    const previous=record ? JSON.stringify(record) : null;
    if(method==='turn/started') {
      if(!record)record={threadId,turnId,status:'inProgress',startedAt:milliseconds(p.turn.startedAt) ?? this.now(),
        observedTime:milliseconds(p.turn.startedAt) === null,base:this.latest.get(threadId) || null,usage:null};
    } else if(method==='thread/tokenUsage/updated') {
      const total=totals(p.tokenUsage?.total); if(!total)return null;
      // Resume replays are snapshots, not another model call. Never sum "last".
      // Missing baseline (e.g. attaching mid-turn) is deliberately unavailable.
      if(record?.base) {
        const floor=record.lastTotal || record.base;
        const reset=FIELDS.some(k=>total[k]!==null && floor[k]!==null && total[k]<floor[k]);
        if(reset) {record.base=null;record.usage=null;}
        else record.usage=Object.fromEntries(FIELDS.map(k=>[k,total[k]!==null && record.base[k]!==null ? total[k]-record.base[k] : null]));
      }
      if(record)record.lastTotal=total;
      this.remember(this.latest,threadId,total);
      if(!record)return null;
    } else {
      record ||= {threadId,turnId,startedAt:milliseconds(p.turn.startedAt),base:null,usage:null};
      record.status=p.turn.status;
      record.completedAt=milliseconds(p.turn.completedAt) ?? this.now();
      record.durationMs=number(p.turn.durationMs) ?? (record.startedAt !== null ? Math.max(0,record.completedAt-record.startedAt) : null);
    }
    if(previous!==JSON.stringify(record)) {
      const file=this.file(threadId,turnId);
      await writeFile(file+'.tmp',JSON.stringify(record),{mode:0o600});
      await rename(file+'.tmp',file);this.remember(this.cache,file,record);
    }
    return {threadId,turnId,metrics:this.present(record)};
  }
  present(record,turn={}) {
    const running=(turn.status || record?.status)==='inProgress';
    const started=milliseconds(turn.startedAt) ?? record?.startedAt ?? null;
    const completed=milliseconds(turn.completedAt) ?? record?.completedAt ?? null;
    const durationMs=number(turn.durationMs) ?? record?.durationMs ?? (!running && started!==null && completed!==null ? Math.max(0,completed-started) : null);
    const elapsedMs=running && started!==null ? Math.max(0,this.now()-started) : durationMs;
    return {running,elapsedMs:elapsedMs ?? null,durationMs:durationMs ?? null,
      observedTime:!!record?.observedTime,usage:record?.usage || null};
  }
  async view(threadId,turn) { return this.present(await this.read(threadId,turn.id),turn); }
}
