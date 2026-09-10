import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('settings reach turn/start, remain fixed on retry, and changes apply to the next turn',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'omega-model-api-')),fake=join(dir,'codex.mjs'),log=join(dir,'calls.jsonl');
  const id='00000000-0000-4000-8000-000000000000';
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');let turn=0;
const thread={id:'${id}',cwd:'/tmp',turns:[]};
createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(m.id===undefined)return;
let result={};
if(m.method==='model/list')result={data:[{model:'a',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'b',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}],inputModalities:['text']}]};
if(m.method.startsWith('thread/'))result={thread,model:'a',reasoningEffort:'low'};
if(m.method==='turn/start'){appendFileSync(${JSON.stringify(log)},JSON.stringify(m.params)+'\\n');turn++;result={turn:{id:'t'+turn}};emit({method:'turn/started',params:{threadId:thread.id,turn:{id:'t'+turn,status:'inProgress'}}});}
if(m.method==='turn/interrupt')emit({method:'turn/completed',params:{threadId:thread.id,turn:{id:'t'+turn,status:'interrupted'}}});
emit({id:m.id,result});
});
`,{mode:0o700});
  let child;
  async function start(){
    child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'14322',OMEGA_STATE_DIR:dir,OMEGA_ACCESS_TOKEN:'test-key-for-models-123456789',OMEGA_CODEX_BIN:fake},stdio:['ignore','pipe','ignore']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',x=>{if(String(x).includes('Omega:')){clearTimeout(timer);resolve();}});child.on('error',reject);});
  }
  const api=async(route,body)=>{
    const r=await fetch('http://127.0.0.1:14322/api/'+route,{method:'POST',headers:{authorization:'Bearer test-key-for-models-123456789','content-type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  const save=(revision,model,effort)=>api('thread-settings',{threadId:id,expectedRevision:revision,settings:{model,effort}});
  const send=(submissionId,settingsRevision)=>api('rpc',{method:'turn/start',params:{threadId:id,input:[{type:'text',text:'test'}]},submissionId,settingsRevision});
  try{
    await start();
    assert.equal((await save(0,'a','high')).status,400);
    assert.equal((await save(0,'a','low')).status,200);
    assert.equal((await send('first',1)).status,200);
    assert.equal((await save(1,'b',null)).status,200);
    await api('rpc',{method:'turn/interrupt',params:{threadId:id,turnId:'t1'}});
    assert.equal((await send('first',1)).status,200);
    assert.equal((await send('stale',1)).status,409);
    assert.equal((await send('second',2)).status,200);
    const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length,2);
    assert.equal(calls[0].model,'a');assert.equal(calls[0].effort,'low');
    assert.equal(calls[1].model,'b');assert.equal(calls[1].effort,'high');
    await api('rpc',{method:'turn/interrupt',params:{threadId:id,turnId:'t2'}});
    const noImage=await api('rpc',{method:'turn/start',params:{threadId:id,input:[]},submissionId:'image',settingsRevision:2,imageIds:['invalid']});
    assert.equal(noImage.status,400);assert.match(noImage.body.error,/不支持图片/);
    child.kill();await once(child,'exit');await start();
    assert.deepEqual((await api('thread-settings',{threadId:id})).body.settings,{model:'b',effort:null,revision:2,current:{model:'a',effort:'low'}});
    assert.equal((await send('first',1)).status,200);
    assert.equal((await readFile(log,'utf8')).trim().split('\n').length,2);
  }finally{child.kill();if(child.exitCode===null)await once(child,'exit');}
});
