import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../groups-store.mjs';
import {GroupOrchestrator,memberTaskPrompt} from '../src/server/group-orchestrator.ts';
import {parseDiscussionReport} from '../src/server/discussion-flow.ts';
const report=(continuing=false,responderTaskIds=[])=>`<omega-discussion>${JSON.stringify({claims:[],issues:[{kind:continuing?'discussion':'verification',question:'只讨论 URL 续签的责任边界',reason:continuing?'两侧的签发方案仍值得比较':'需实际测量排队时间才能确定',nextStep:'核对 URL 协议与排队时长',...(continuing?{responderTaskIds}:{})}],recommendation:'先做临时素材中转，避免扩大为全部项目存储。',nextSteps:['请开发与测试核对 URL 协议后，再由用户决定是否实施。'],closingReason:continuing?'接口定案需要先比较续签方案':'总体可行性已回答，具体有效期需实测'})}</omega-discussion>`;
function fixture(overrides={}){
  const store=new GroupStore(':memory:');let group=store.createGroup({name:'讨论'},'coord','/work');
  for(const name of ['开发','测试'])group=store.addMember(group.id,{threadId:name,name,role:name,responsibilities:`${name}负责协议`,skills:'协议分析',cwd:'/work/'+name});
  const calls=[];let answer=report();
  const o=new GroupOrchestrator({store,isThreadActive:()=>false,startTurn:async(...args)=>{calls.push(args);return{turn:{id:'summary-turn'}}},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>answer,...overrides});o.suspend(group.id);
  const submit=(maxRounds=3)=>o.submit(group.id,{content:'比较方案，不要实施',collaborationMode:'discussion',maxRounds}).requirement;
  const finish=(req,round=1,text='建议临时素材中转')=>{for(const t of store.getRequirement(req.id).tasks.filter(t=>t.round===round)){store.startTask(t.id,'dispatch-'+t.id,'turn-'+t.id);o.finishMemberTurn(t.id,text,'turn-'+t.id)}};
  return{store,group,o,calls,submit,finish,answer:value=>answer=value};
}
test('discussion waits for visible synthesis, then can conclude without spending all rounds',async()=>{
  const f=fixture();try{const req=f.submit();f.finish(req);assert.equal(f.store.runnableTasks(f.group.id).length,0);assert.equal(f.o.discussion.next(f.group.id).round,1);
    await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'completed');assert.equal(f.calls.length,1);assert.equal(f.calls[0][3].accessMode,'read');
    const messages=f.store.getGroup(f.group.id,req.id).messages.filter(m=>m.reference?.type==='discussion-summary');assert.equal(messages.length,1);assert.equal(messages[0].reference.kind,'final');assert.match(messages[0].content,/下一步/);assert.match(messages[0].content,/不作为赞成票/);assert.equal(f.o.discussion.next(f.group.id),undefined);
    await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.calls.length,1);
  }finally{f.store.close()}
});
test('round synthesis unlocks only selected responders and shared focus is added to role-aware member prompt',async()=>{
  const f=fixture();try{const req=f.submit();f.answer(report(true,[req.tasks[0].id]));f.finish(req);await f.o.discussion.run(f.group.id,req.id,1);const tasks=f.store.runnableTasks(f.group.id);assert.equal(tasks.length,1);assert.equal(tasks[0].member_id,req.tasks[0].memberId);assert.match(tasks[0].objective,/只讨论 URL 续签的责任边界/);assert.doesNotMatch(tasks[0].objective,/围绕用户问题继续讨论/);
    const current=f.store.getRequirement(req.id);current.discussionFocus=f.store.db.prepare('SELECT report_json FROM discussion_reports WHERE requirement_id=?').get(req.id).report_json;
    const prompt=memberTaskPrompt(f.group,current,f.group.members[0],current.tasks.find(t=>t.round===2&&t.memberId===f.group.members[0].id));assert.match(prompt,/开发负责协议/);assert.match(prompt,/只讨论 URL 续签/);assert.match(prompt,/成员 测试/);assert.match(prompt,/pass 不表示赞同/);
    f.answer(report());f.finish(req,2,'(pass)');await f.o.discussion.run(f.group.id,req.id,2);assert.equal(f.store.getRequirement(req.id).status,'completed');assert.equal(f.store.getGroup(f.group.id,req.id).messages.filter(m=>m.reference?.type==='discussion-summary').length,2);
  }finally{f.store.close()}
});
test('last discussion round produces a final delivery with unresolved choices instead of queued work',async()=>{
  const f=fixture();try{const req=f.submit(1);f.answer(report(true,[req.tasks[0].id]));f.finish(req);assert.equal(f.store.getRequirement(req.id).status,'running');await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'completed');assert.equal(f.store.getGroup(f.group.id,req.id).messages.find(m=>m.reference?.type==='discussion-summary').reference.kind,'final');assert.equal(f.store.getRequirement(req.id).tasks.length,2);assert.match(f.store.getRequirement(req.id).delivery,/轮次上限/);
  }finally{f.store.close()}
});
test('three-round discussion re-engages a previous member and never queues a fourth round',async()=>{
  const f=fixture();try{
    const req=f.submit(3);f.answer(report(true,[req.tasks[0].id]));f.finish(req,1);await f.o.discussion.run(f.group.id,req.id,1);
    f.answer(report(true,[req.tasks[1].id]));f.finish(req,2,'新的事实');await f.o.discussion.run(f.group.id,req.id,2);
    const third=f.store.getRequirement(req.id).tasks.filter(task=>task.round===3);assert.equal(third.length,1);assert.equal(third[0].memberId,req.tasks[1].memberId);
    f.answer(report(true,[third[0].id]));f.finish(req,3,'对新的事实的回应');await f.o.discussion.run(f.group.id,req.id,3);
    const finished=f.store.getRequirement(req.id);assert.equal(finished.status,'completed');assert.equal(finished.tasks.some(task=>task.round===4),false);assert.match(finished.delivery,/轮次上限/);
  }finally{f.store.close()}
});
test('unconfirmed summary submission never replays; retry attaches to its recorded turn',async()=>{
  let known=null;const f=fixture({startTurn:async()=>{throw Error('timeout')},lookupDispatch:()=>known});try{const req=f.submit();f.finish(req);await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.db.prepare('SELECT status FROM discussion_reports').get().status,'unknown');assert.equal(f.o.discussion.next(f.group.id),undefined);assert.throws(()=>f.o.discussion.prepareRetry(req.id),/不能重复/);known='original';assert.equal(f.o.discussion.prepareRetry(req.id),true);await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'completed');
  }finally{f.store.close()}
});
test('malformed summary does not silently complete the discussion',async()=>{
  const f=fixture();try{const req=f.submit();f.finish(req);f.answer('just pass');await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'paused');assert.equal(f.store.db.prepare('SELECT status FROM discussion_reports').get().status,'failed');f.answer(report());f.o.discussion.prepareRetry(req.id);await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'completed');}finally{f.store.close()}
});
test('direct mode retains no-summary behavior and report validation rejects missing next steps',async()=>{
  const f=fixture();try{const req=f.o.submit(f.group.id,{content:'@开发 查询状态'}).requirement;f.finish(req);await f.o.finalize(f.group.id,req.id);assert.equal(f.calls.length,0);assert.equal(f.store.getRequirement(req.id).status,'completed');assert.throws(()=>parseDiscussionReport(report().replace(/"nextSteps":\[[^\]]*\]/,'"nextSteps":[]')),/下一步/);}finally{f.store.close()}
});

test('a partially completed round cannot trigger synthesis while peers are queued',()=>{
  const f=fixture();try{const req=f.submit(),task=req.tasks[0];f.store.startTask(task.id,'dispatch','turn');f.o.finishMemberTurn(task.id,'建议核实协议','turn');assert.equal(f.o.discussion.next(f.group.id),undefined);}finally{f.store.close()}
});
test('cancel during summary submission interrupts returned turn and never publishes',async()=>{
  let f,req;const interrupted=[];
  f=fixture({startTurn:async()=>{f.store.cancel(f.group.id,req.id);return{turn:{id:'cancelled-summary'}}},interruptTurn:async(...args)=>interrupted.push(args)});
  try{req=f.submit();f.finish(req);await f.o.discussion.run(f.group.id,req.id,1);assert.deepEqual(interrupted,[['coord','cancelled-summary']]);assert.equal(f.store.getGroup(f.group.id,req.id).messages.some(m=>m.reference?.type==='discussion-summary'),false);}finally{f.store.close()}
});
test('budget extension keeps failed synthesis paused until explicit retry',async()=>{
  const f=fixture();try{const req=f.submit(1);f.finish(req);f.answer('invalid');await f.o.discussion.run(f.group.id,req.id,1);f.store.extendBudget(f.group.id,req.id,{maxRounds:3});assert.equal(f.store.getRequirement(req.id).pauseKind,'execution');await assert.rejects(f.o.retry('wrong-group',req.id));f.answer(report());await f.o.retry(f.group.id,req.id);await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.store.getRequirement(req.id).status,'completed');}finally{f.store.close()}
});
test('scheduler automatically summarizes after member turns without another user message',async()=>{
  const f=fixture({readTurnText:async thread=>thread==='coord'?report():'建议先验证接口'});
  try{const req=f.submit();f.o.unsuspend(f.group.id);for(let i=0;i<100&&f.store.getRequirement(req.id).status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.store.getRequirement(req.id).status,'completed');assert.equal(f.calls.filter(call=>call[0]==='coord').length,1);}finally{f.o.suspend(f.group.id);f.store.close()}
});
test('persisted running summary attaches to its original turn after orchestrator recovery',async()=>{
  const f=fixture();try{const req=f.submit();f.finish(req);f.store.db.prepare("INSERT INTO discussion_reports(requirement_id,round_no,status,dispatch_id,turn_id) VALUES(?,1,'running','original-dispatch','original-turn')").run(req.id);await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.calls.length,0);assert.equal(f.store.getRequirement(req.id).status,'completed');}finally{f.store.close()}
});
test('missing full member evidence pauses before model dispatch rather than silently truncating',async()=>{
  const f=fixture();try{const req=f.submit();f.finish(req,1,'证据'.repeat(3000));await f.o.discussion.run(f.group.id,req.id,1);assert.equal(f.calls.length,0);assert.equal(f.store.getRequirement(req.id).status,'paused');assert.match(f.store.getRequirement(req.id).error,/原文不可用/);}finally{f.store.close()}
});
test('explicit summary retry includes the previous validation failure in its prompt',async()=>{
  const f=fixture();try{const req=f.submit();f.finish(req);f.answer('invalid');await f.o.discussion.run(f.group.id,req.id,1);await f.o.retry(f.group.id,req.id);f.answer(report());await f.o.discussion.run(f.group.id,req.id,1);assert.match(f.calls[1][1],/上次小结校验错误.*缺少结构化结果/);assert.equal(f.store.getRequirement(req.id).status,'completed');}finally{f.store.close()}
});
