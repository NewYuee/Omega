import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../groups-store.mjs';
import {GroupOrchestrator,directAssignments} from '../src/server/group-orchestrator.ts';

test('mentions share adjacent bodies, split separate questions and respect name boundaries',()=>{
  const members=[{id:'a',name:'开发'},{id:'b',name:'测试'},{id:'c',name:'dev'}];
  assert.deepEqual(directAssignments('@开发 @测试 检查接口',members).map(t=>[t.memberId,t.objective]),[['a','检查接口'],['b','检查接口']]);
  assert.deepEqual(directAssignments('@开发 修复接口 @测试 检查结果',members).map(t=>t.objective),['修复接口','检查结果']);
  assert.equal(directAssignments('mail@dev.com @developer',members).length,0);
  assert.equal(directAssignments('@all 查看版本',members).length,3);
  assert.equal(directAssignments('@开发 查看 A @开发 查看 B',members).length,1);
});

function fixture(){const store=new GroupStore(':memory:');let group=store.createGroup({name:'测试'},'coord','/workspace');group=store.addMember(group.id,{threadId:'a',name:'开发',role:'开发',cwd:'/a'});group=store.addMember(group.id,{threadId:'b',name:'测试',role:'测试',cwd:'/b'});const o=new GroupOrchestrator({store,isThreadActive:()=>true,startTurn:async()=>{throw Error('must not plan');},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>''});o.suspend(group.id);return{store,group,o};}

test('reply routing bypasses a busy coordinator and inherits read access',()=>{
  const {store,group,o}=fixture();try{const first=o.submit(group.id,{content:'@开发 查询版本'}).requirement;const next=o.submit(group.id,{content:'查看发布时间',replyTaskId:first.tasks[0].id}).requirement;assert.equal(next.status,'running');assert.equal(next.tasks[0].memberId,group.members[0].id);assert.equal(next.tasks[0].accessMode,'read');}finally{store.close();}
});

test('topic cursors isolate unrelated questions and preserve incremental delivery',()=>{
  const {store,group,o}=fixture();try{const first=o.submit(group.id,{content:'@开发 查询版本'}).requirement;store.addMessage(group.id,first.id,'member','测试','版本 2 已验证');const unrelated=o.submit(group.id,{content:'@测试 查询工资'}).requirement;store.addMessage(group.id,unrelated.id,'member','测试','不相关的信息');const next=o.submit(group.id,{content:'查看发布时间',replyTaskId:first.tasks[0].id}).requirement;const context=store.topicContext(next.tasks[0].id);assert.match(context.text,/版本 2 已验证/);assert.doesNotMatch(context.text,/工资|不相关/);store.ackTopicContext(next.tasks[0].id,context.cursor);assert.equal(store.topicContext(next.tasks[0].id).text,'');store.addMessage(group.id,first.id,'user','你','补充：只看正式版');assert.match(store.topicContext(next.tasks[0].id).text,/只看正式版/);}finally{store.close();}
});

test('recovered turns preserve decisions and cancelled turns never publish late results',async()=>{
  const {store,group,o}=fixture();try{const req=o.submit(group.id,{content:'@开发 实现功能'}).requirement,task=req.tasks[0];store.startTask(task.id,'d','turn');o.readTurnText=async()=>'请选择\n<omega-decision>{"question":"选哪个？","options":[{"id":"a","label":"方案1"},{"id":"b","label":"方案2"}]}</omega-decision>';await o.recoverTask({...task,threadId:'a',turnId:'turn'});assert.equal(store.getTask(task.id).status,'awaiting_input');store.cancel(group.id,req.id);o.finishMemberTurn(task.id,'迟到的结果','turn');assert.equal(store.getTask(task.id).status,'cancelled');assert.ok(!store.getGroup(group.id).messages.some(m=>m.content==='迟到的结果'));}finally{store.close();}
});

test('queue reasons explain member and dependency waits',()=>{
 const {store,group,o}=fixture();try{const first=o.submit(group.id,{content:'@开发 修改 A'}).requirement;store.startTask(first.tasks[0].id,'busy','t');const second=o.submit(group.id,{content:'@开发 查看 A'}).requirement;assert.equal(store.getTask(second.tasks[0].id).queueReason,'等待成员空闲');}finally{store.close();}
});

test('a cancelled question cannot be revived by a late coordinator plan',async()=>{
 const {store,group,o}=fixture();try{const req=store.createRequirement(group.id,{content:'查询版本'}).requirement;let release;const pending=new Promise(resolve=>{release=resolve});o.startTurn=async()=>({turn:{id:'plan'}});o.waitTurn=async()=>pending;o.readTurnText=async()=>`<omega-plan>${JSON.stringify({summary:'计划',tasks:[{memberId:group.members[0].id,title:'查询',objective:'查询版本'}]})}</omega-plan>`;const work=o.draftPlan(group.id,req.id);store.cancel(group.id,req.id);release({status:'completed'});await work;assert.equal(store.getRequirement(req.id).status,'cancelled');assert.equal(store.getRequirement(req.id).tasks.length,0);}finally{store.close();}
});
