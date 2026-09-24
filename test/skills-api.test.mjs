import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('Skill API previews all replies, generates a draft and injects only an activated Skill',async()=>{
  const state=await mkdtemp(join(tmpdir(),'omega-skills-api-')),fake=join(state,'codex.mjs'),workspace=join(state,'workspace'),port=14491,sourceThread='11111111-1111-4111-8111-111111111111';
  await mkdir(workspace);
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {randomUUID} from 'node:crypto';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const initial=[{id:'turn-1',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:'请设计回归流程'}]},{id:'a1',type:'agentMessage',text:'先确定范围'},{id:'a2',type:'agentMessage',text:'再执行测试'}]},{id:'turn-2',status:'completed',items:[{id:'u2',type:'userMessage',content:[{type:'text',text:'补充：记录未覆盖项'}]},{id:'a3',type:'agentMessage',text:'最终流程：范围、测试、未覆盖项'}]}];
const threads=new Map([[${JSON.stringify(sourceThread)},{id:${JSON.stringify(sourceThread)},cwd:${JSON.stringify(workspace)},turns:initial}]]);let counter=0;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==='initialize')result={};
else if(m.method==='model/list')result={data:[{model:'test',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
else if(m.method==='thread/start'){const id=randomUUID(),thread={id,cwd:m.params.cwd,turns:[]};threads.set(id,thread);result={thread,model:'test',reasoningEffort:'low'};}
else if(m.method==='thread/read'||m.method==='thread/resume')result={thread:threads.get(m.params.threadId),model:'test',reasoningEffort:'low'};
else if(m.method==='thread/list')result={data:[...threads.values()]};
else if(m.method==='thread/turns/list'){const thread=threads.get(m.params.threadId);result={data:[...(thread?.turns||[])].reverse().slice(0,m.params.limit||60),nextCursor:null};}
else if(m.method==='thread/items/list'){const turn=threads.get(m.params.threadId)?.turns.find(item=>item.id===m.params.turnId);result={data:[...(turn?.items||[])].reverse().map(item=>({item})),nextCursor:null};}
else if(m.method==='turn/start'){const thread=threads.get(m.params.threadId),id='generated-'+(++counter),text=m.params.input.map(item=>item.text||'').join(''),skill=text.includes('[Omega Skill');let answer;
if(text.includes('仅返回 <omega-skill>'))answer='<omega-skill>'+JSON.stringify({name:'回归检查',description:'执行重复检查',whenToUse:'需要回归时',inputs:['仓库'],steps:['确认范围','执行测试'],verification:['核对输出'],limits:['线上未验证']})+'</omega-skill>';
else answer=skill?'skill-applied':'no-skill';
const turn={id,status:'inProgress',items:[{id:'u-'+id,type:'userMessage',content:[{type:'text',text}]},{id:'a-'+id,type:'agentMessage',text:answer}]};thread.turns.push(turn);emit({method:'turn/started',params:{threadId:thread.id,turn:{id,status:'inProgress'}}});result={turn:{id}};setTimeout(()=>{turn.status='completed';emit({method:'turn/completed',params:{threadId:thread.id,turn:{...turn}}});},15);}
emit({id:m.id,result});});`,{mode:0o700});
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'skills-api-test-key',OMEGA_CODEX_BIN:fake,OMEGA_WORKSPACE:workspace},stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',data=>{if(String(data).includes('Omega:')){clearTimeout(timer);resolve()}});child.on('error',reject)});
    const call=async(data,path='skills')=>{const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:data?'POST':'GET',headers:{authorization:'Bearer skills-api-test-key','content-type':'application/json'},body:data?JSON.stringify(data):undefined});const value=await response.json();assert.ok(response.ok,value.error);return value};
    const selection={scope:'thread',targetId:sourceThread,ids:['turn-1','turn-2']};
    const preview=await call({action:'preview',...selection});assert.match(preview.text,/先确定范围/);assert.match(preview.text,/再执行测试/);assert.match(preview.text,/最终流程/);
    const created=await call({action:'draft',...selection});let entry=created.entry;
    for(let index=0;index<40&&entry.status==='generating';index++){await new Promise(resolve=>setTimeout(resolve,25));entry=(await call(null,'skills?id='+entry.id)).entry;}
    assert.equal(entry.status,'draft',entry.error);assert.equal(entry.content.name,'回归检查');
    const activated=(await call({action:'save',id:entry.id,revision:entry.revision,content:entry.content,status:'active'})).entry;
    assert.equal(activated.status,'active');
    await call({method:'turn/start',params:{threadId:sourceThread,input:[{type:'text',text:'请按流程执行'}]},submissionId:'skill-use-1',skillId:entry.id},'rpc');
    await new Promise(resolve=>setTimeout(resolve,50));const history=await call({threadId:sourceThread},'history');assert.equal(history.turn.items.at(-1).pageText,'skill-applied');
  }finally{child.kill();if(child.exitCode===null)await once(child,'exit')}
});
