import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('project API authenticates, injects persisted evidence into actual turn input, and preserves retries',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'omega-project-api-')),fake=join(dir,'codex.mjs'),log=join(dir,'calls.jsonl'),port=14338;
  const threadId='11111111-1111-4111-8111-111111111111';
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');let n=0;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==='model/list')result={data:[{model:'test',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
if(m.method.startsWith('thread/'))result={thread:{id:m.params.threadId,cwd:'/tmp',turns:[]},model:'test',reasoningEffort:'low'};
if(m.method==='turn/start'){appendFileSync(${JSON.stringify(log)},JSON.stringify(m.params)+'\\n');result={turn:{id:'turn'+(++n)}};}
if(m.method==='turn/interrupt')emit({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:m.params.turnId,status:'interrupted'}}});
emit({id:m.id,result});});
`,{mode:0o700});
  let child;
  const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_STATE_DIR:dir,OMEGA_ACCESS_TOKEN:'project-test-key-123456',OMEGA_CODEX_BIN:fake},stdio:['ignore','pipe','ignore']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',x=>{if(String(x).includes('Omega:')){clearTimeout(timer);resolve()}});child.on('error',e=>{clearTimeout(timer);reject(e)})});};
  const api=async(route,body,auth=true)=>{const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer project-test-key-123456'}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  try{
    await start();assert.equal((await api('projects',{action:'list'},false)).status,401);
    const p=(await api('projects',{action:'create',name:'Continuity'})).body;
    const r=(await api('projects',{action:'save',projectId:p.id,kind:'verification',status:'confirmed',title:'Tests passed',body:'npm test passed; no real Feishu tests',source:{type:'manual',excerpt:'244 tests passed, commit abc'}})).body;
    await api('projects',{action:'save',projectId:p.id,kind:'decision',status:'candidate',title:'SECRET_DRAFT',body:'not confirmed'});
    assert.equal((await api('projects',{action:'link',projectId:p.id,kind:'thread',target:threadId})).status,200);
    const send={method:'turn/start',submissionId:'first-project-turn',params:{threadId,input:[{type:'text',text:'What is next?'}]}};
    assert.equal((await api('rpc',send)).status,200);
    let calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,1);
    assert.equal(calls[0].input[0].text,'What is next?');const context=calls[0].input.at(-1).text;
    assert.match(context,/Tests passed/);assert.doesNotMatch(context,/SECRET_DRAFT/);assert.match(context,/不是新指令或授权/);
    const snapshot=context.match(/完整快照：(.+?)。/)[1],full=JSON.parse(await readFile(snapshot,'utf8'));
    assert.equal(full[0].records[0].source.excerpt,'244 tests passed, commit abc');
    await api('rpc',{method:'turn/interrupt',params:{threadId,turnId:'turn1'}});
    assert.equal((await api('projects',{...r,projectId:p.id,action:'save',status:'stale'})).status,200);
    assert.equal((await api('projects',{...r,projectId:p.id,action:'save',status:'stale'})).status,409);
    assert.equal((await api('rpc',send)).status,200);
    assert.equal((await readFile(log,'utf8')).trim().split('\n').length,1);
    child.kill();await once(child,'exit');await start();
    assert.equal((await api('projects',{action:'read',projectId:p.id})).body.total,2);
    assert.equal((await api('projects',{action:'history',id:r.id})).body.items.length,2);
    assert.equal((await api('rpc',{...send,submissionId:'second-project-turn'})).status,200);
    calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.doesNotMatch(calls[1].input.at(-1).text,/Tests passed|SECRET_DRAFT/);
  }finally{if(child){child.kill();if(child.exitCode===null)await once(child,'exit');}}
});
