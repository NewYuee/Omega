import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

test('independent personal sessions can work in one directory while each session remains serial',async t=>{
  const state=await mkdtemp(join(tmpdir(),'omega-personal-concurrency-'));
  t.after(()=>rm(state,{recursive:true,force:true}));
  const fake=join(state,'codex.mjs');
  const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const threads=new Map(${JSON.stringify(ids)}.map(id=>[id,{id,cwd:'/tmp',turns:[]}]));
let sequence=0;
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);if(request.id===undefined)return;
  const {method,params={}}=request;let result={};
  if(method==='initialize')result={};
  else if(method==='model/list')result={data:[{model:'test',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
  else if(method==='thread/resume'||method==='thread/read')result={thread:threads.get(params.threadId),model:'test',reasoningEffort:'low'};
  else if(method==='turn/start'){
    const id='turn-'+(++sequence);result={turn:{id}};
    emit({method:'turn/started',params:{threadId:params.threadId,turn:{id,status:'inProgress'}}});
  }else if(method==='turn/interrupt')emit({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});
  emit({id:request.id,result});
});`,{mode:0o700});
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;listener.close();await once(listener,'close');
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'personal-concurrency-test-key',OMEGA_CODEX_BIN:fake,OMEGA_WORKSPACE:'/tmp'},stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Omega:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
    const send=async(threadId,submissionId)=>{
      const response=await fetch(`http://127.0.0.1:${port}/api/rpc`,{method:'POST',headers:{authorization:'Bearer personal-concurrency-test-key','content-type':'application/json'},body:JSON.stringify({method:'turn/start',params:{threadId,input:[{type:'text',text:'independent task'}]},submissionId})});
      return{status:response.status,body:await response.json()};
    };
    const first=await send(ids[0],'first');assert.equal(first.status,200,first.body.error);
    const second=await send(ids[1],'second');assert.equal(second.status,200,second.body.error);
    assert.equal((await send(ids[0],'third')).status,409);
  }finally{child.kill();if(child.exitCode===null)await once(child,'exit');}
});
