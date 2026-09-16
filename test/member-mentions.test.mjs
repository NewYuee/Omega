import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMentions} from '../src/server/member-mentions.ts';
import {directAssignments,GroupOrchestrator} from '../src/server/group-orchestrator.ts';
import {GroupStore} from '../src/server/groups-store.ts';

test('structured mentions route by member ID even after rename and retain task boundaries',()=>{
  const members=[{id:'a',name:'新名字'},{id:'b',name:'测试'}],content='@旧名字 检查代码 @测试 运行测试';
  const refs=validateMentions([{id:'a',name:'旧名字',start:0,end:4}],content,members);
  const tasks=directAssignments(content,members,refs);
  assert.deepEqual(tasks.map(t=>t.memberId),['a','b']);assert.equal(tasks[0].objective,'检查代码');assert.equal(tasks[1].objective,'运行测试');
});
test('invalid or removed mentions cannot silently fall back to coordinator',()=>{
  for(const refs of [[{id:'missing',name:'开发',start:0,end:3}],[{id:'a',name:'测试',start:0,end:3}],[{id:'a',name:'开发',start:-1,end:2}]])assert.throws(()=>validateMentions(refs,'@开发 提问',[{id:'a',name:'开发'}]));
});
test('mention identities persist for cancelled requirement draft restoration',()=>{
  const store=new GroupStore(':memory:');try{
    let group=store.createGroup({name:'mentions'},'coord','/work');group=store.addMember(group.id,{name:'开发',role:'owner',threadId:'thread',cwd:'/work'});
    const refs=[{id:group.members[0].id,name:'开发',start:0,end:3}];
    const o=new GroupOrchestrator({store,isThreadActive:()=>true,startTurn:async()=>{throw Error('unexpected')},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>''});o.suspend(group.id);
    const result=o.submit(group.id,{content:'@开发 检查',mentions:refs});
    assert.equal(result.requirement.mentions[0].id,refs[0].id);assert.equal(result.requirement.tasks[0].memberId,refs[0].id);
    assert.equal(store.getRequirement(result.requirement.id).mentions[0].start,0);
  }finally{store.db.close();}
});
