import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('group API creates coordinator, binds existing session and completes confirmed workflow',async()=>{
  const state=await mkdtemp(join(tmpdir(),'omega-groups-api-')),fake=join(state,'codex.mjs'),port=14327;
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {randomUUID} from 'node:crypto';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const member='11111111-1111-4111-8111-111111111111',threads=new Map([[member,{id:member,name:'开发会话',cwd:'/tmp',turns:[]}]]);let starts=0;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
 if(m.method==='initialize')result={};
 else if(m.method==='model/list')result={data:[{model:'test',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
 else if(m.method==='thread/start'){const id=randomUUID(),thread={id,cwd:m.params.cwd,turns:[]};threads.set(id,thread);result={thread,model:'test',reasoningEffort:'low'};}
 else if(m.method==='thread/name/set'){const t=threads.get(m.params.threadId);if(t)t.name=m.params.name;result={};}
 else if(m.method==='thread/delete'){threads.delete(m.params.threadId);result={};}
 else if(m.method==='thread/list')result={data:[...threads.values()]};
 else if(m.method==='thread/turns/list'){const turns=threads.get(m.params.threadId)?.turns||[];result={data:[...turns].reverse().slice(0,m.params.limit||60),nextCursor:null,backwardsCursor:null};}
 else if(m.method==='thread/items/list'){const turns=threads.get(m.params.threadId)?.turns||[],turn=turns.find(turn=>turn.id===m.params.turnId);result={data:[...(turn?.items||[])].reverse().map(item=>({turnId:turn.id,item})),nextCursor:null,backwardsCursor:null};}
 else if(m.method==='thread/read'||m.method==='thread/resume')result={thread:threads.get(m.params.threadId),model:'test',reasoningEffort:'low'};
 else if(m.method==='turn/start'){
   const thread=threads.get(m.params.threadId),id='turn-'+(++starts),input=m.params.input?.[0]?.text||'';
   let answer=input.includes('任务计划')?'':input.includes('审核成员')?'<omega-review>{"decision":"pass","summary":"验证证据充分"}</omega-review>':input.includes('最终交付报告')?'# 交付报告\\n功能已完成并测试。':'完成内容：实现成功。\\n验证：测试通过。';
   if(input.includes('任务计划')){const match=input.match(/"id": "([^"]+)"/);answer='<omega-plan>'+JSON.stringify({summary:'实现并验证需求',tasks:[{memberId:match[1],title:'开发与测试',objective:'实现需求并执行测试',acceptance:'测试通过'}]})+'</omega-plan>';}
   const turn={id,status:'interrupted',items:[{id:'a-'+id,type:'agentMessage',text:answer}]};thread.turns.push(turn);emit({method:'turn/started',params:{threadId:thread.id,turn:{id,status:'inProgress'}}});result={turn:{id}};
   setTimeout(()=>{turn.status='completed';emit({method:'turn/completed',params:{threadId:thread.id,turn:{...turn}}});},20);
 }
 emit({id:m.id,result});
});`,{mode:0o700});
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'group-api-test-key',OMEGA_CODEX_BIN:fake,OMEGA_WORKSPACE:'/tmp'},stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',data=>{if(String(data).includes('Omega:')){clearTimeout(timer);resolve();}});child.on('error',reject);});
    const call=async(data,path='groups')=>{const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:data?'POST':'GET',headers:{authorization:'Bearer group-api-test-key','content-type':'application/json'},body:data?JSON.stringify(data):undefined});const value=await response.json();assert.equal(response.status,200,value.error);return value;};
    let group=(await call({action:'create',name:'研发组',cwd:'/tmp',description:'测试群组'})).group;
    assert.match(group.coordinatorThreadId,/^[a-f0-9-]{36}$/);
    const coordinatorThreadId=group.coordinatorThreadId;
    group=(await call({action:'setConcurrency',groupId:group.id,maxConcurrency:4})).group;
    assert.equal(group.limits.maxConcurrency,4);
    group=(await call({action:'addMember',groupId:group.id,threadId:'11111111-1111-4111-8111-111111111111',name:'开发',role:'开发'})).group;
    const memberCwd=group.members[0].cwd;
    group=(await call({action:'updateMember',groupId:group.id,memberId:group.members[0].id,name:'主开发',role:'开发负责人',projectName:'Omega',responsibilities:'实现并自测',operations:'工作区内修改',skills:'Node.js'})).group;
    assert.equal(group.members[0].name,'主开发');assert.equal(group.members[0].threadId,'11111111-1111-4111-8111-111111111111');assert.equal(group.members[0].cwd,memberCwd);
    group=(await call({action:'submit',groupId:group.id,content:'实现一个功能',acceptance:'测试通过'})).group;
    for(let i=0;i<50&&group.requirement.status==='plan_drafting';i++){await new Promise(r=>setTimeout(r,20));group=(await call(null,'groups/'+group.id)).group;}
    assert.notEqual(group.requirement.status,'awaiting_confirmation');assert.equal(group.requirement.tasks.length,1);
    for(let i=0;i<80&&group.requirement.status!=='completed';i++){await new Promise(r=>setTimeout(r,20));group=(await call(null,'groups/'+group.id)).group;}
    assert.equal(group.requirement.status,'completed');assert.equal(group.requirement.tasks[0].status,'completed');assert.equal(group.requirement.delivery,group.requirement.tasks[0].result);
    const deleted=await call({action:'deleteGroup',groupId:group.id});assert.equal(deleted.deleted,true);
    const threads=(await call({method:'thread/list',params:{limit:100,sourceKinds:[]}},'rpc')).data;
    assert(threads.some(thread=>thread.id==='11111111-1111-4111-8111-111111111111'));
    assert(!threads.some(thread=>thread.id===coordinatorThreadId));
    assert.equal((await call(null)).groups.length,0);
  }finally{child.kill();if(child.exitCode===null)await once(child,'exit');}
});
