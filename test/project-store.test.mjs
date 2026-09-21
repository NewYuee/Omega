import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../src/server/groups-store.ts';
import {ProjectStore,projectMemoryCandidate} from '../src/server/project-store.ts';
const setup=t=>{const groups=new GroupStore(':memory:');t.after(()=>groups.db.close());const store=new ProjectStore(groups.db),project=store.create('Omega');return {groups,store,project};};
const record=(projectId,extra={})=>({projectId,kind:'overview',status:'candidate',title:'当前版本',body:'v0.2.3，下一步项目记录',source:{type:'manual',excerpt:''},...extra});

test('new member gets four confirmed kinds without old session history; unlinked targets isolated',t=>{
  const {store,project}=setup(t);store.link(project.id,'group','team');
  for(const kind of ['overview','decision','task','verification'])store.save(record(project.id,{kind,status:'confirmed',source:{type:'group',target:'team',messageId:'message-1',excerpt:'npm test：244 tests；仅覆盖测试仓库，未验证真实飞书'}}));
  store.save(record(project.id,{title:'SECRET_CANDIDATE'}));
  const context=store.context('brand-new-session','team');
  assert.equal(JSON.parse(context.full)[0].records.length,4);
  assert.match(context.summary,/verification/);assert.doesNotMatch(context.full,/SECRET_CANDIDATE/);
  assert.equal(store.context('unrelated'),null);
  store.link(project.id,'group','team',true);assert.equal(store.context('brand-new-session','team'),null);
});
test('revisions immutable; optimistic conflict; stale and superseded excluded',t=>{
  const {store,project}=setup(t);store.link(project.id,'thread','t');
  const r=store.save(record(project.id,{status:'confirmed'}));
  const changed=store.save({...record(project.id),id:r.id,revision:r.revision,status:'stale',body:'版本已过时'});
  assert.equal(changed.revision,2);assert.equal(JSON.parse(store.context('t').full)[0].records.length,0);
  assert.throws(()=>store.save({...record(project.id),id:r.id,revision:1}),/已被修改/);
  const history=store.history(r.id);assert.equal(history.length,2);assert.equal(history[1].snapshot.body,r.body);assert.equal(history[0].actor,'Omega 已认证操作者');
  store.save({...record(project.id),id:r.id,revision:2,status:'superseded'});
  assert.equal(JSON.parse(store.context('t').full)[0].records.length,0);
});
test('validation rejects unsupported states, unbounded content and evidence-free verification',t=>{
  const {store,project}=setup(t);
  assert.throws(()=>store.save(record(project.id,{status:'verified'})));
  assert.throws(()=>store.save(record(project.id,{body:'x'.repeat(16001)})));
  assert.throws(()=>store.save(record(project.id,{kind:'verification',status:'confirmed'})),/证据/);
  assert.throws(()=>store.save(record(project.id,{source:{type:'thread',target:'t',messageId:''}})),/稳定/);
  const p2=store.create('other'),r=store.save(record(project.id));
  assert.throws(()=>store.save({...record(p2.id),id:r.id,revision:r.revision}),/已被修改/);
  assert.equal(store.records(project.id).total,1);
});
test('pagination, context bounds and link idempotence survive store recreation',t=>{
  const {store,project,groups}=setup(t);store.link(project.id,'thread','t');store.link(project.id,'thread','t');assert.equal(store.links(project.id).length,1);
  for(let i=0;i<35;i++)store.save(record(project.id,{status:'confirmed',body:'x'.repeat(16000)}));
  assert.equal(store.records(project.id).items.length,30);assert.equal(store.records(project.id,30).items.length,5);
  const resumed=new ProjectStore(groups.db);assert.equal(resumed.records(project.id).total,35);
  const c=resumed.context('t');assert.ok(c.summary.length<12100);assert.equal(JSON.parse(c.full)[0].records.length,35);
  for(let i=0;i<2;i++)store.link(store.create('p'+i).id,'thread','t');
  assert.throws(()=>store.link(store.create('too-many').id,'thread','t'),/最多关联/);
});
test('automatic memory capture is linked, deduplicated, unconfirmed and bounded in context',t=>{
  const {store,project}=setup(t);store.link(project.id,'thread','thread-1');
  const text='结论：采用服务端自动提取。\n\n下一步运行针对性测试，尚未验证真实飞书环境。';
  const first=store.autoCapture('thread','thread-1','turn-1',text),again=store.autoCapture('thread','thread-1','turn-1',text);
  assert.equal(first.length,1);assert.equal(again.length,0);assert.equal(first[0].status,'candidate');assert.equal(first[0].source.automatic,true);
  assert.equal(store.autoCapture('thread','unlinked','turn-2',text).length,0);
  const snapshot=JSON.parse(store.context('thread-1').full)[0];
  assert.equal(snapshot.records.length,0);assert.equal(snapshot.candidates.length,1);assert.match(store.context('thread-1').summary,/尚未由用户确认/);
  assert.equal(store.history(first[0].id)[0].actor,'Omega 自动提取');
});
test('automatic memory candidate ignores trivial replies and infers evidence records',()=>{
  assert.equal(projectMemoryCandidate('好的'),null);
  const candidate=projectMemoryCandidate('验证结果：npm test 已通过，但真实飞书环境尚未覆盖。');
  assert.equal(candidate.kind,'verification');assert.match(candidate.title,/自动提取/);
});
