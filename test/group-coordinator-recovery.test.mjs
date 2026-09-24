import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {GroupStore} from '../groups-store.mjs';

test('only an empty coordinator can be rebound',()=>{
  const store=new GroupStore(':memory:');
  try{
    const first=store.createGroup({name:'空群组'},'old','/tmp');
    const replaced=store.replaceEmptyCoordinator(first.id,'old','new');
    assert.equal(replaced.coordinatorThreadId,'new');
    assert.equal(replaced.messages[0].reference.threadId,'new');
    assert.throws(()=>store.replaceEmptyCoordinator(first.id,'old','again'),/已变化/);
    const second=store.createGroup({name:'已有记录'},'used','/tmp');
    const member=store.addMember(second.id,{threadId:'member',name:'开发',role:'开发'}).members[0];
    const {requirement}=store.createRequirement(second.id,{content:'测试'});
    store.db.prepare('UPDATE requirements SET coordinator_turn_id=? WHERE id=?').run('turn-1',requirement.id);
    assert.throws(()=>store.replaceEmptyCoordinator(second.id,'used','replacement'),/已有执行记录/);
    assert.equal(store.getGroup(second.id).coordinatorThreadId,'used');
    assert.throws(()=>store.setCoordinator(first.id,'new','member','成员会话'),/已绑定/);
    assert.equal(store.replaceEmptyMember(member.id,'member','member-new').members[0].threadId,'member-new');
    assert.throws(()=>store.setCoordinator(first.id,'new','member-new','成员会话'),/已绑定/);
    assert.throws(()=>store.setCoordinator(first.id,'stale','other','其他会话'),/已变化/);
    const manual=store.setCoordinator(first.id,'new','existing','已有会话');
    assert.equal(manual.coordinatorThreadId,'existing');
    assert.equal(manual.coordinatorThreadName,'已有会话');
    assert.equal(manual.coordinatorOwned,false);
    assert.equal(store.deleteGroup(first.id).coordinatorOwned,false);
  }finally{store.close();}
});

test('a group created before restart recovers its empty coordinator on first dispatch',async()=>{
  const state=await mkdtemp(join(tmpdir(),'omega-coordinator-recovery-'));
  const workspace=join(state,'workspace'),fake=join(state,'codex.mjs'),port=15423;
  await mkdir(workspace);
  await writeFile(fake,`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {randomUUID} from 'node:crypto';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const member='11111111-1111-4111-8111-111111111111',existing='22222222-2222-4222-8222-222222222222',threads=new Map([[member,{id:member,cwd:${JSON.stringify(workspace)},turns:[]}],[existing,{id:existing,name:'已有协调者会话',cwd:${JSON.stringify(workspace)},turns:[{id:'prior-turn',status:'completed',items:[]}]}]]);
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
 if(m.method==='initialize')result={};
 else if(m.method==='model/list')result={data:[{model:'test',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
 else if(m.method==='thread/start'){const id=randomUUID(),thread={id,cwd:m.params.cwd,turns:[]};threads.set(id,thread);result={thread,model:'test',reasoningEffort:'low'};}
 else if(m.method==='thread/name/set'){const thread=threads.get(m.params.threadId);if(thread)thread.name=m.params.name;}
 else if(m.method==='thread/resume'||m.method==='thread/read'){
   const thread=threads.get(m.params.threadId);if(!thread){emit({id:m.id,error:{message:'no rollout found for thread id '+m.params.threadId}});return;}result={thread,model:'test',reasoningEffort:'low'};
 }
 else if(m.method==='thread/list')result={data:[...threads.values()]};
 else if(m.method==='turn/start'){
   const thread=threads.get(m.params.threadId);if(!thread){emit({id:m.id,error:{message:'no rollout found for thread id '+m.params.threadId}});return;}
   const text=(m.params.input||[]).map(item=>item.text||'').join('');const id=randomUUID();
   const assigned=text.match(/"id": "([^"]+)"/)?.[1];
   const answer=text.includes('任务计划')?'<omega-plan>'+JSON.stringify({summary:'交给开发',tasks:[{memberId:assigned,title:'实现',objective:'实现需求',accessMode:'read',dependsOn:[]}]})+'</omega-plan>':text.includes('群组问题整理')?'<omega-group-memory>{"summary":"任务完成","openItems":[]}</omega-group-memory>':'任务完成';
   const turn={id,status:'completed',items:[{id:randomUUID(),type:'agentMessage',text:answer}]};thread.turns.push(turn);
   result={turn:{id}};setTimeout(()=>emit({method:'turn/completed',params:{threadId:thread.id,turn}}),10);
 }
 else if(m.method==='thread/turns/list')result={data:[...(threads.get(m.params.threadId)?.turns||[])].reverse(),nextCursor:null,backwardsCursor:null};
 else if(m.method==='thread/items/list'){const turn=threads.get(m.params.threadId)?.turns.find(t=>t.id===m.params.turnId);result={data:(turn?.items||[]).map(item=>({turnId:turn.id,item})),nextCursor:null,backwardsCursor:null};}
 emit({id:m.id,result});
});`,{mode:0o700});
  const start=async()=>{
    const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'recovery-test-key',OMEGA_CODEX_BIN:fake,OMEGA_WORKSPACE:workspace},stdio:['ignore','pipe','inherit']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',data=>{if(String(data).includes('Omega:')){clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',code=>reject(Error(`server exited ${code}`)));});
    return child;
  };
  const call=async(data,path='groups')=>{const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:data?'POST':'GET',headers:{authorization:'Bearer recovery-test-key','content-type':'application/json'},body:data?JSON.stringify(data):undefined});const value=await response.json();assert.equal(response.status,200,value.error);return value;};
  let child;
  try{
    child=await start();let group=(await call({action:'create',name:'恢复测试组'})).group;
    const oldId=group.coordinatorThreadId;
    const memberThread=(await call({method:'thread/start',params:{cwd:workspace}},'rpc')).thread;
    group=(await call({action:'addMember',groupId:group.id,threadId:memberThread.id,name:'开发',role:'开发'})).group;
    child.kill();await once(child,'exit');child=await start();
    group=(await call({action:'submit',groupId:group.id,content:'实现需求'})).group;
    for(let i=0;i<80&&group.requirement.status==='plan_drafting';i++){await new Promise(resolve=>setTimeout(resolve,25));group=(await call(null,`groups/${group.id}`)).group;}
    assert.notEqual(group.coordinatorThreadId,oldId);
    assert.notEqual(group.members[0].threadId,memberThread.id);
    assert.notEqual(group.requirement.status,'paused',group.requirement.error);
    assert.equal(group.requirement.tasks.length,1);
    for(let i=0;i<80&&group.requirement.status!=='completed';i++){await new Promise(resolve=>setTimeout(resolve,25));group=(await call(null,`groups/${group.id}`)).group;}
    assert.equal(group.requirement.status,'completed');
    let rebound;
    for(let i=0;i<80&&!rebound;i++)try{
      rebound=await call({action:'setCoordinator',groupId:group.id,expectedThreadId:group.coordinatorThreadId,threadId:'22222222-2222-4222-8222-222222222222'});
    }catch(error){if(!/正在执行/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,25));}
    assert.ok(rebound,'the coordinator should become idle after optional archiving');
    group=rebound.group;
    assert.equal(group.coordinatorOwned,false);
    assert.equal(group.coordinatorThreadName,'已有协调者会话');
    const deleted=await call({action:'deleteGroup',groupId:group.id});
    assert.equal(deleted.coordinatorDeleted,false);
    assert.equal((await call({method:'thread/read',params:{threadId:'22222222-2222-4222-8222-222222222222',includeTurns:false}},'rpc')).thread.id,'22222222-2222-4222-8222-222222222222');
  }finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}}
});
