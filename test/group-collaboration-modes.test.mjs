import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../groups-store.mjs';
import {GroupOrchestrator} from '../src/server/group-orchestrator.ts';
function fixture(){const store=new GroupStore(':memory:');let group=store.createGroup({name:'协作'},'coord','/work');for(const name of ['开发','测试'])group=store.addMember(group.id,{threadId:name,name,role:name,cwd:'/work/'+name});const o=new GroupOrchestrator({store,isThreadActive:()=>false,startTurn:async()=>({turn:{id:'turn'}}),waitTurn:async()=>({status:'completed'}),readTurnText:async()=>''});o.suspend(group.id);return{store,group,o};}
function finish(store,o,id,text){store.startTask(id,'dispatch-'+id,'turn-'+id);o.finishMemberTurn(id,text,'turn-'+id);}
test('rounds allow 100, reject invalid values, and handoffs continue beyond 30 tasks',()=>{
 const {store,group,o}=fixture();try{
   const defaultReq=o.submit(group.id,{content:'@开发 实现功能',collaborationMode:'handoff'}).requirement;assert.equal(defaultReq.maxRounds,10);
   assert.equal(o.submit(group.id,{content:'分析方案',collaborationMode:'discussion'}).requirement.maxRounds,3);
   for(const maxRounds of [0,101,1.5])assert.throws(()=>o.submit(group.id,{content:'@开发 实现功能',collaborationMode:'handoff',maxRounds}),/1–100/);
   const req=o.submit(group.id,{content:'@开发 实现功能',collaborationMode:'handoff',maxRounds:100}).requirement;assert.equal(req.maxRounds,100);
   assert.throws(()=>store.configureCollaboration(req.id,'handoff',101),/1–100/);
   let task=req.tasks[0];for(let n=0;n<31;n++){const recipient=group.members.find(m=>m.id!==task.memberId);finish(store,o,task.id,`完成本步 ${n}<omega-handoff>${JSON.stringify({tasks:[{memberId:recipient.id,objective:'继续完成后续工作'}]})}</omega-handoff>`);task=store.getRequirement(req.id).tasks.at(-1);}
   assert.equal(store.getRequirement(req.id).tasks.length,32);assert.equal(task.round,32);assert.equal(task.status,'queued');
 }finally{store.close();}
});
test('direct mode ignores handoff requests while handoff mode persists bounded dependent work',()=>{
 const {store,group,o}=fixture();try{const text=`已完成<omega-handoff>${JSON.stringify({tasks:[{memberId:group.members[1].id,objective:'检查实现结果'}]})}</omega-handoff>`;const direct=o.submit(group.id,{content:'@开发 实现功能'}).requirement;finish(store,o,direct.tasks[0].id,text);assert.equal(store.getRequirement(direct.id).tasks.length,1);const req=o.submit(group.id,{content:'@开发 实现功能',collaborationMode:'handoff',maxRounds:2}).requirement;finish(store,o,req.tasks[0].id,text);const tasks=store.getRequirement(req.id).tasks;assert.equal(tasks.length,2);assert.equal(tasks[1].round,2);assert.deepEqual(tasks[1].dependencies,[tasks[0].id]);const back=`复核完成<omega-handoff>${JSON.stringify({tasks:[{memberId:group.members[0].id,objective:'修正测试问题'}]})}</omega-handoff>`;finish(store,o,tasks[1].id,back);assert.equal(store.getRequirement(req.id).tasks.length,3);assert.equal(store.getRequirement(req.id).status,'paused');o.finishMemberTurn(tasks[0].id,text,'turn');assert.equal(store.getRequirement(req.id).tasks.length,3);}finally{store.close();}
});
test('discussion waits for a round, stays read only and stops when all pass',()=>{
 const {store,group,o}=fixture();try{const req=o.submit(group.id,{content:'分析方案',collaborationMode:'discussion',maxRounds:3}).requirement;assert.equal(req.tasks.length,2);assert.ok(req.tasks.every(t=>t.accessMode==='read'));finish(store,o,req.tasks[0].id,'建议方案一');assert.equal(store.getRequirement(req.id).tasks.length,2);finish(store,o,req.tasks[1].id,'建议方案二');const next=store.getRequirement(req.id).tasks.slice(2);assert.equal(next.length,2);assert.ok(next.every(t=>t.round===2&&t.accessMode==='read'));for(const task of next)finish(store,o,task.id,'(pass)');assert.equal(store.getRequirement(req.id).tasks.length,4);assert.ok(!store.getGroup(group.id).messages.some(m=>m.content==='(pass)'));}finally{store.close();}
});
test('cancellation prevents collaboration fanout and invalid recipients fail before completion',()=>{
 const {store,group,o}=fixture();try{const req=o.submit(group.id,{content:'@开发 实现功能',collaborationMode:'handoff'}).requirement,task=req.tasks[0];store.startTask(task.id,'d','t');assert.throws(()=>o.finishMemberTurn(task.id,'完成<omega-handoff>{"tasks":[{"memberId":"outside","objective":"运行"}]}</omega-handoff>','t'),/有效成员/);assert.equal(store.getTask(task.id).status,'running');store.cancel(group.id,req.id);o.finishMemberTurn(task.id,'完成','t');assert.equal(store.getTask(task.id).status,'cancelled');assert.equal(store.getRequirement(req.id).tasks.length,1);}finally{store.close();}
});
