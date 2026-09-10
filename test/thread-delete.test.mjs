import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('delete requires confirmation, rejects active work and serializes destructive operations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'omega-delete-'));
  const fake=join(dir,'codex.mjs');
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  if(m.method==='thread/delete'){
    setTimeout(()=>emit(m.params.threadId.endsWith('1')?{id:m.id,error:{message:'delete failed'}}:{id:m.id,result:{}}),250);return;
  }
  if(m.method==='turn/start')emit({method:'turn/started',params:{threadId:m.params.threadId,turn:{id:'turn',status:'inProgress'}}});
  if(m.method==='turn/interrupt')emit({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'turn',status:'interrupted'}}});
  emit({id:m.id,result:m.method==='turn/start'?{turn:{id:'turn'}}:{}});
});
`,{mode:0o700});
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14321',OMEGA_STATE_DIR:dir,OMEGA_ACCESS_TOKEN:'test-key-for-deletion-123456789',OMEGA_CODEX_BIN:fake},stdio:['ignore','pipe','ignore']});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('startup timeout')),10000);
      child.stdout.on('data',x=>{if(String(x).includes('Omega:')){clearTimeout(timer);resolve();}});
      child.on('error',reject);
    });
    const endpoint='http://127.0.0.1:14321/api/';
    const request=(method,params={},extra={})=>fetch(endpoint+'rpc',{method:'POST',headers:{authorization:'Bearer test-key-for-deletion-123456789','content-type':'application/json'},body:JSON.stringify({method,params,...extra})});
    const id='00000000-0000-4000-8000-000000000000';
    assert.equal((await request('thread/delete',{threadId:id})).status,400);
    assert.equal((await request('thread/delete',{threadId:'../bad'},{confirmDelete:true})).status,400);
    assert.equal((await request('turn/start',{threadId:id,input:[{type:'text',text:'test'}]},{submissionId:'test-start'})).status,200);
    assert.equal((await request('thread/delete',{threadId:id},{confirmDelete:true})).status,409);
    await request('turn/interrupt',{threadId:id,turnId:'turn'});
    const first=request('thread/delete',{threadId:id},{confirmDelete:true});
    // HTTP requests on one event loop; allow the first request to acquire its lock.
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await request('thread/delete',{threadId:id},{confirmDelete:true})).status,409);
    assert.equal((await request('turn/start',{threadId:id,input:[{type:'text',text:'test'}]},{submissionId:'blocked-start'})).status,409);
    assert.equal((await request('thread/resume',{threadId:id})).status,409);
    assert.equal((await first).status,200);
    assert.equal((await request('thread/delete',{threadId:id.slice(0,-1)+'1'},{confirmDelete:true})).status,400);
    assert.equal((await request('thread/delete',{threadId:id},{confirmDelete:true})).status,200);
  }finally{
    child.kill();if(child.exitCode===null)await once(child,'exit');
  }
});
