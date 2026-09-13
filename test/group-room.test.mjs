import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../groups-store.mjs';
import {GroupOrchestrator} from '../group-orchestrator.mjs';
import {groupProgress} from '../group-progress.mjs';

test('room keeps multiple questions, public progress, final answers and reply ownership',async()=>{
  const store=new GroupStore(':memory:');let group=store.createGroup({name:'room'},'coord','/work');
  group=store.addMember(group.id,{threadId:'worker',name:'开发',role:'开发',cwd:'/work/a'});const member=group.members[0];
  const first=store.createRequirement(group.id,{content:'查询 A 版本'}).requirement;
  store.setPlan(first.id,'交给开发',[{memberId:member.id,title:'查询',objective:first.content,accessMode:'read'}],null,'');store.confirmPlan(group.id,first.id,true);
  const task=store.getRequirement(first.id).tasks[0];store.startTask(task.id,'d','turn');
  const notify=[],observe=groupProgress(store,e=>notify.push(e));
  observe({method:'item/completed',params:{threadId:'worker',turnId:'turn',item:{id:'r',type:'reasoning',text:'private'}}});
  observe({method:'item/agentMessage/delta',params:{threadId:'worker',turnId:'turn',itemId:'p',delta:'正在查询'}});
  observe({method:'item/completed',params:{threadId:'worker',turnId:'turn',item:{id:'p',type:'agentMessage',text:'正在查询版本'}}});
  assert.equal(store.roomMessages(group.id).filter(m=>m.reference?.type==='progress').length,1);
  const second=store.createRequirement(group.id,{content:'再查 B'}).requirement;
  const room=store.getGroup(group.id,second.id);assert.ok(room.messages.some(m=>m.content===first.content));assert.ok(room.messages.some(m=>m.content==='正在查询版本'));assert.ok(!room.messages.some(m=>m.content==='private'));assert.ok(notify.length);
  store.taskProgress('worker','turn','answer','版本 1');store.completeTask(task.id,'版本 1','turn');
  assert.equal(store.roomMessages(group.id).filter(m=>m.content==='版本 1').length,1);
  const reply=store.createRequirement(group.id,{content:'能升级吗',replyTaskId:task.id}).requirement;
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>true,startTurn:()=>{throw Error('reply must not ask coordinator')},waitTurn:()=>{},readTurnText:()=>{}});
  await orchestrator.draftPlan(group.id,reply.id);
  assert.equal(store.getRequirement(reply.id).tasks[0].memberId,member.id);assert.equal(store.getRequirement(reply.id).status,'running');
  store.close();
});
