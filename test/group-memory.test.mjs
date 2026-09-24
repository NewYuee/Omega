import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../src/server/groups-store.ts';
import {GroupMemoryStore,parseGroupMemory} from '../src/server/group-memory.ts';
import {GroupOrchestrator} from '../src/server/group-orchestrator.ts';

const setup=t=>{const groups=new GroupStore(':memory:');t.after(()=>groups.close());const memory=new GroupMemoryStore(groups.db);let group=groups.createGroup({name:'研发组'},'coordinator','/work');group=groups.addMember(group.id,{threadId:'member',name:'负责人',role:'开发'});return {groups,memory,group};};
const completed=(groups,group,content,result='完整成员原话')=>{const requirement=groups.createRequirement(group.id,{content}).requirement;groups.db.prepare("UPDATE requirements SET status='completed',delivery=? WHERE id=?").run(result,requirement.id);return requirement.id;};

test('group archive preserves full source, revisions and isolated bounded context',t=>{
  const {groups,memory,group}=setup(t),other=groups.createGroup({name:'其它组'},'coordinator-2','/other');
  const id=completed(groups,group,'检索重要事项 甲', '完整交付内容');
  groups.addMessage(group.id,id,'member','负责人','测试通过仅为成员自述',{type:'member-result'});
  memory.capture(id,{summary:'甲：成员报告单测通过，真实环境尚未验证。',openItems:['核对线上结果']});
  assert.equal(memory.capture(id,{summary:'不会覆盖',openItems:[]}),null);
  const entry=memory.get(group.id,id);assert.equal(entry.detail.question,'检索重要事项 甲');assert.match(entry.detail.delivery,/完整交付/);assert.match(JSON.stringify(entry.detail.messages),/测试通过仅为成员自述/);
  assert.match(memory.context(group.id,'重要事项 甲'),/尚未验证/);assert.equal(memory.context(other.id,'重要事项 甲'),'');
  const changed=memory.update(group.id,id,{revision:1,summary:'纠正：尚无测试证据',openItems:['补充测试'],status:'active'});
  assert.equal(changed.revision,2);assert.equal(memory.history(group.id,id)[1].snapshot.summary,entry.summary);
  assert.throws(()=>memory.update(group.id,id,{revision:1,summary:'旧版',openItems:[],status:'active'}),/已更新/);
  memory.update(group.id,id,{revision:2,summary:'已过时',openItems:[],status:'stale'});
  assert.equal(memory.context(group.id,'重要事项 甲'),'');
});

test('old related archive is retrieved without loading full history or leaking unrelated records',t=>{
  const {groups,memory,group}=setup(t),target=completed(groups,group,'音频归档结论');
  memory.capture(target,{summary:'音频归档需使用原始文件；该建议尚未经测试。',openItems:['补做集成测试']});
  for(let index=0;index<35;index++)memory.capture(completed(groups,group,`普通问题 ${index}`),{summary:'无关摘要 '.repeat(100),openItems:[]});
  const context=memory.context(group.id,'音频归档结论');assert.match(context,/音频归档需使用原始文件/);assert.ok(context.length<4200);assert.doesNotMatch(context,/完整成员原话/);
  const first=memory.list(group.id);assert.equal(first.length,30);const second=memory.list(group.id,first.at(-1).id);assert.equal(second.length,6);
});

test('coordinator archive must use bounded structured output',()=>{
  assert.deepEqual(parseGroupMemory('<omega-group-memory>{"summary":"结论待核验","openItems":["补测"]}</omega-group-memory>'),{summary:'结论待核验',openItems:['补测']});
  assert.throws(()=>parseGroupMemory('已完成'),/没有返回/);
  assert.throws(()=>parseGroupMemory('<omega-group-memory>{"summary":"","openItems":[]}</omega-group-memory>'),/格式错误/);
});

test('discussion archive retains attribution and distinguishes advice from verified results',t=>{
  const {groups,memory,group}=setup(t),id=completed(groups,group,'讨论部署方案');
  const report={recommendation:'采用灰度方案',closingReason:'成员意见仍有分歧',agreed:['甲认为可回滚'],issues:[{kind:'verification',question:'真实环境能否回滚',nextStep:'验证回滚流程'}],nextSteps:['等待用户批准'],continueDiscussion:false};
  groups.db.prepare("INSERT INTO discussion_reports(requirement_id,round_no,status,report_json) VALUES(?,1,'completed',?)").run(id,JSON.stringify(report));
  groups.addMessage(group.id,id,'coordinator','讨论主持人','原始讨论结论',{type:'discussion-summary',kind:'final',round:1});
  memory.captureDiscussion(group.id);
  const entry=memory.get(group.id,id);assert.match(entry.summary,/未经用户确认或实施/);assert.match(entry.summary,/分歧/);assert.match(entry.openItems.join(' '),/验证回滚流程/);assert.equal(entry.detail.reports[0].report.agreed[0],'甲认为可回滚');
  memory.captureDiscussion(group.id);assert.equal(memory.history(group.id,id).length,1);
});

test('direct delivery invokes coordinator once and archives the full member result',async t=>{
  const {groups,memory,group}=setup(t),requirement=groups.createRequirement(group.id,{content:'实现检索功能'}).requirement;
  groups.setDirectPlan(requirement.id,'分配给负责人',[{memberId:group.members[0].id,title:'实现检索',objective:'实现并验证'}]);groups.confirmPlan(group.id,requirement.id,true);
  const task=groups.getRequirement(requirement.id).tasks[0],full='成员结果和验证范围：仅本地测试，线上未验证';
  groups.db.prepare("UPDATE tasks SET status='completed',result=? WHERE id=?").run(full,task.id);
  const calls=[];
  const orchestrator=new GroupOrchestrator({store:groups,isThreadActive:()=>false,archiveRequirement:(id,note)=>memory.capture(id,note),hasArchive:id=>memory.has(id),startTurn:async(threadId,prompt)=>{calls.push({threadId,prompt});return{turn:{id:'archive-turn'}}},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>'<omega-group-memory>{"summary":"成员报告本地测试通过；线上未验证","openItems":["线上复核"]}</omega-group-memory>'});
  await orchestrator.finalize(group.id,requirement.id);
  assert.equal(groups.getRequirement(requirement.id).status,'completed');assert.equal(calls.length,1);assert.match(calls[0].prompt,/只读/);
  assert.equal(memory.get(group.id,requirement.id).detail.tasks[0].result,full);
  await orchestrator.finalize(group.id,requirement.id);assert.equal(calls.length,1);
});
