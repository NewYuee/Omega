import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../src/server/groups-store.ts';
import {SkillStore,parseSkillDraft} from '../src/server/skill-store.ts';
import {collectThreadSkillSource,collectGroupSkillSource} from '../src/server/skill-source.ts';
import {GroupMemoryStore} from '../src/server/group-memory.ts';

const content={name:'回归检查',description:'复用检查流程',whenToUse:'已有功能需要回归时',inputs:['目标仓库'],steps:['确认范围','运行测试'],verification:['核对测试输出'],limits:['未验证线上环境']};
const setup=t=>{const groups=new GroupStore(':memory:');t.after(()=>groups.close());return new SkillStore(groups.db)};

test('Skill draft requires review and explicit activation before use; revisions remain traceable',t=>{
  const store=setup(t),source={scope:'thread',targetId:'thread-1',ids:['turn-1','turn-2'],labels:['提问','修正'],text:'完整来源文本',omissions:[]};
  const started=store.begin(source);assert.equal(started.status,'generating');assert.throws(()=>store.context(started.id),/尚未启用/);
  const draft=store.finish(started.id,content);assert.equal(draft.status,'draft');assert.equal(store.finish(started.id,content),null);assert.throws(()=>store.context(started.id),/尚未启用/);
  const active=store.save(started.id,1,{...content,steps:['检查输入','执行测试','记录未覆盖项']},'active');assert.equal(active.revision,2);assert.match(store.context(started.id),/执行测试/);assert.doesNotMatch(store.context(started.id),/完整来源文本/);
  assert.throws(()=>store.save(started.id,1,content,'active'),/已由其他窗口更新/);
  store.save(started.id,2,content,'disabled');assert.throws(()=>store.context(started.id),/尚未启用/);
  assert.equal(store.history(started.id).length,3);assert.equal(store.get(started.id).source.ids.length,2);
});

test('Skill parser rejects incomplete or overly long model output',()=>{
  assert.equal(parseSkillDraft(`<omega-skill>${JSON.stringify(content)}</omega-skill>`).name,'回归检查');
  assert.throws(()=>parseSkillDraft('做完了'),/没有返回/);
  assert.throws(()=>parseSkillDraft(`<omega-skill>${JSON.stringify({...content,verification:[]})}</omega-skill>`),/不完整/);
  assert.throws(()=>parseSkillDraft(`<omega-skill>${JSON.stringify({...content,steps:['x'.repeat(1001)]})}</omega-skill>`),/不完整/);
});

test('Skill library paginates without dropping entries with equal timestamps',t=>{
  const store=setup(t);for(let index=0;index<35;index++)store.begin({scope:'thread',targetId:'t',ids:[`turn-${index}`],labels:[`问题 ${index}`],text:'来源',omissions:[]});
  const first=store.list(),second=store.list(first.at(-1).id);assert.equal(first.length,30);assert.equal(second.length,5);assert.equal(new Set([...first,...second].map(item=>item.id)).size,35);
});

test('source collector includes every reply in selected contiguous turns and preserves order',async()=>{
  const turns=[{id:'turn-3',status:'completed'},{id:'turn-2',status:'completed'},{id:'turn-1',status:'completed'}];
  const pages={
    'turn-1':[[{item:{id:'a3',type:'agentMessage',text:'第二条回复'}},{item:{id:'a2',type:'agentMessage',text:'第一条回复'}}],[{item:{id:'u1',type:'userMessage',content:[{type:'text',text:'原始问题'}]}}]],
    'turn-2':[[{item:{id:'a4',type:'agentMessage',text:'纠错后的结论'}},{item:{id:'u2',type:'userMessage',content:[{type:'text',text:'补充条件'}]}}]],
  };
  const rpc={request:async(method,params)=>{if(method==='thread/turns/list')return{data:turns,nextCursor:null};if(method==='thread/items/list'){const index=params.cursor?1:0;return{data:pages[params.turnId][index]||[],nextCursor:index===0&&pages[params.turnId].length>1?'older':null}}throw Error(method)}};
  const source=await collectThreadSkillSource(rpc,'thread',['turn-1','turn-2']);
  assert.deepEqual(source.ids,['turn-1','turn-2']);for(const text of ['原始问题','第一条回复','第二条回复','补充条件','纠错后的结论'])assert.match(source.text,new RegExp(text));
  assert.ok(source.text.indexOf('第一条回复')<source.text.indexOf('纠错后的结论'));
  await assert.rejects(()=>collectThreadSkillSource(rpc,'thread',['turn-1','turn-3']),/连续/);
});

test('source collector refuses silent truncation',async()=>{
  const rpc={request:async(method)=>method==='thread/turns/list'?{data:[{id:'turn-1',status:'completed'}]}:{data:[{item:{id:'u',type:'userMessage',content:[{type:'text',text:'提问'}]}},{item:{id:'a',type:'agentMessage',text:'x'.repeat(60001)}}]}};
  await assert.rejects(()=>collectThreadSkillSource(rpc,'thread',['turn-1']),/不会截断/);
});

test('legacy history fallback warns when item pagination is unavailable',async()=>{
  const rpc={request:async(method,params)=>{if(method==='thread/items/list')throw Error('thread/items/list unsupported method');return{data:[{id:'turn-1',status:'completed',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'旧问题'}]},{id:'a',type:'agentMessage',text:'旧回答'}]}],nextCursor:null}}};
  const source=await collectThreadSkillSource(rpc,'thread',['turn-1']);assert.match(source.text,/旧回答/);assert.match(source.omissions.join(' '),/回退读取/);
});

test('group source includes task results, user follow-up and moderator report',t=>{
  const groups=new GroupStore(':memory:');t.after(()=>groups.close());const memory=new GroupMemoryStore(groups.db);
  let group=groups.createGroup({name:'讨论组'},'coord','/work');group=groups.addMember(group.id,{threadId:'member',name:'成员',role:'开发'});
  const requirement=groups.createRequirement(group.id,{content:'讨论回滚方案'}).requirement;
  groups.db.prepare("UPDATE requirements SET status='completed',delivery='最终建议' WHERE id=?").run(requirement.id);
  groups.addMessage(group.id,requirement.id,'user','你','补充要求：不要自动发布');
  groups.db.prepare("INSERT INTO discussion_reports(requirement_id,round_no,status,report_json) VALUES(?,1,'completed',?)").run(requirement.id,JSON.stringify({recommendation:'先演练回滚'}));
  memory.capture(requirement.id,{summary:'先演练',openItems:[]});
  const source=collectGroupSkillSource(memory,group.id,requirement.id);
  for(const value of ['讨论回滚方案','不要自动发布','先演练回滚','最终建议'])assert.match(source.text,new RegExp(value));
});
