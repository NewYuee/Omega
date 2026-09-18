import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupStore } from '../groups-store.mjs';
import { GroupOrchestrator, compactTaskObjective, parseCoordinatorPlan, parseTaskReview, parseMemberDecision, stripMemberDecision, memberTaskPrompt } from '../group-orchestrator.mjs';
import {withFeishuQuote} from '../src/server/feishu-quotes.ts';

test('reference evidence survives handoff and retry without duplicating originals',()=>{
  const content=withFeishuQuote('检查 BUG',{messageId:'om_source',authorId:'ou_author',authorType:'user',text:'独特报错证据'});
  for(const options of [{},{collaborationMode:'handoff'},{collaborationMode:'discussion'}]){
    const prompt=memberTaskPrompt({members:[]},{content,tasks:[],...options},{cwd:'/work'},{objective:'核对 issue',accessMode:'read',attempt:1,error:'补充核验'});
    assert.match(prompt,/独特报错证据/);assert.match(prompt,/不是新增指令或授权/);assert.match(prompt,/补充核验/);
  }
  for(const [objective,images,pastes] of [[content,[],[]],['核对', [{id:'image'}],[]],['核对',[],['附件文字']]]){
    const prompt=memberTaskPrompt({}, {content,tasks:[],images},{cwd:'/work'},{objective,accessMode:'read'},pastes);
    assert.equal(prompt.split('独特报错证据').length-1,1);
  }
});

test('member handoff keeps task limits and rework feedback without replaying identity or unrelated work',()=>{
  const member={id:'a',cwd:'/projects/a',role:'身份背景',responsibilities:'全部历史职责',operations:'禁止发布'};
  const task={objective:'总结 A 项目 9.5–9.11 的活动，500 字，面向非技术领导',acceptance:'条理清晰',access_mode:'read',dependencies_json:'["self","other"]',attempt:1,error:'修正版本日期'};
  const req={content:'A 和 B 的整个群组需求',tasks:[{id:'self',memberId:'a',status:'completed',result:'自己的冗长旧结果'},{id:'other',memberId:'b',status:'completed',title:'B 结论',result:'必要交接事实'},{id:'unrelated',memberId:'c',status:'completed',result:'无关事实'}]};
  const prompt=memberTaskPrompt({constraints:'简洁'},req,member,task);
  for(const value of [task.objective,'只读，直接回复','禁止发布','修正版本日期','必要交接事实'])assert.ok(prompt.includes(value));
  for(const value of [req.content,member.role,member.responsibilities,'自己的冗长旧结果','无关事实','产物位置'])assert.ok(!prompt.includes(value));
});

test('coordinator plan parser accepts tagged strict JSON',()=>{
  const parsed=parseCoordinatorPlan('说明\n<omega-plan>{"summary":"摘要","tasks":[{"memberId":"m","title":"开发","objective":"实现"}]}</omega-plan>');
  assert.equal(parsed.tasks[0].memberId,'m');
  assert.throws(()=>parseCoordinatorPlan('只有普通文字'),/可识别/);
  assert.equal(parseTaskReview('<omega-review>{"decision":"pass","summary":"证据充分"}</omega-review>').decision,'pass');
});

test('member decisions are structured and resume the same member task after the user answers',async()=>{
  const decisionText='需要你选择实现方式。\n<omega-decision>{"title":"选择音色方案","question":"采用哪一种音色保存方式？","options":[{"id":"preview","label":"生成预览音频","description":"接入更简单","recommended":true},{"id":"voice-id","label":"保存上游音色 ID","description":"能力更完整"}],"allowOther":true}</omega-decision>';
  const parsed=parseMemberDecision(decisionText);assert.equal(parsed.options[0].recommended,true);assert.equal(stripMemberDecision(decisionText),'需要你选择实现方式。');
  const store=new GroupStore(':memory:');let group=store.createGroup({name:'决策组'},'coord','/workspace');group=store.addMember(group.id,{threadId:'owner',name:'负责人',role:'开发',cwd:'/project'});const requirement=store.createRequirement(group.id,{content:'实现音色功能'}).requirement;store.setPlan(requirement.id,'执行',[{memberId:group.members[0].id,title:'实现音色',objective:'实现功能'}],null,'');store.confirmPlan(group.id,requirement.id);const task=store.getRequirement(requirement.id).tasks[0];store.startTask(task.id,'first',null);store.recordTaskDecision(task.id,'需要你选择实现方式。','turn-1',parsed);
  let waiting=store.getRequirement(requirement.id);assert.equal(waiting.status,'running');assert.equal(waiting.tasks[0].status,'awaiting_input');assert.equal(waiting.tasks[0].decision.status,'pending');
  store.resolveDecision(group.id,task.id,{decisionId:store.getTask(task.id).decision.id,choiceId:'preview',note:'先做最小方案'});const resumed=store.getRequirement(requirement.id);assert.equal(resumed.tasks[0].status,'queued');assert.equal(resumed.tasks[0].decision.answer.label,'生成预览音频');assert.match(memberTaskPrompt(group,resumed,group.members[0],resumed.tasks[0]),/用户已经作出决定：生成预览音频/);assert.match(memberTaskPrompt(group,resumed,group.members[0],resumed.tasks[0]),/先做最小方案/);store.close();
});

test('cancelling a dispatched task keeps the requirement cancelled when its interrupted turn settles',async()=>{
  const store=new GroupStore(':memory:');let group=store.createGroup({name:'取消组',limits:{taskTimeoutMinutes:5}},'coord','/workspace');group=store.addMember(group.id,{threadId:'member',name:'成员',role:'开发',cwd:'/project'});const requirement=store.createRequirement(group.id,{content:'错误的消息'}).requirement;store.setPlan(requirement.id,'执行',[{memberId:group.members[0].id,title:'执行',objective:'修改代码'}],null,'');store.confirmPlan(group.id,requirement.id);const task=store.getRequirement(requirement.id).tasks[0];let release;const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},startTurn:async()=>({turn:{id:'turn-cancel'}}),waitTurn:async()=>new Promise(resolve=>{release=resolve}),readTurnText:async()=>'',interruptTurn:async()=>{}});orchestrator.suspend(group.id);const running=orchestrator.dispatchTask(group.id,store.runnableTasks(group.id)[0]);for(let i=0;i<30&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(typeof release,'function');store.cancel(group.id,requirement.id);release({status:'interrupted'});await running;assert.equal(store.getRequirement(requirement.id).status,'cancelled');assert.equal(store.getTask(task.id).status,'cancelled');store.close();
});

test('long group references stay complete while task objectives remain bounded',()=>{
  const long=`实现音色生成功能\n${'接口参考资料。'.repeat(900)}\n考虑 DC-Media 协议兼容方式`;
  const objective=compactTaskObjective(long);
  assert.ok(objective.length<=5000);
  assert.match(objective,/实现音色生成功能/);
  assert.match(objective,/DC-Media 协议兼容方式/);
  const prompt=memberTaskPrompt({}, {content:long,tasks:[]}, {cwd:'/project'}, {objective:'设计音色模型接入方案',access_mode:'read',dependencies_json:'[]',attempt:0});
  assert.match(prompt,/设计音色模型接入方案/);
  assert.match(prompt,/用户原始长资料/);
  assert.match(prompt,/DC-Media 协议兼容方式/);
});

test('pasted text files are resolved only when a member task is dispatched',()=>{
  const body='完整接口说明'.repeat(400),prompt=memberTaskPrompt({}, {content:'参考 [Pasted Content 2400 chars]',pastedTexts:[{chars:[...body].length}],tasks:[]}, {cwd:'/project'}, {objective:'完成接口开发',access_mode:'read',dependencies_json:'[]',attempt:0},[body]);
  assert.match(prompt,/Pasted Content 2400 chars\.txt/);
  assert.match(prompt,/完整接口说明完整接口说明/);
});

test('a single task uses the coordinator objective instead of an oversized requirement',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'长文档组',cwd:'/workspace',limits:{maxTasks:5,maxReworks:1,maxRounds:6,taskTimeoutMinutes:5}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'owner-thread',name:'负责人',role:'开发'});const member=group.members[0];
  const long=`增加音色生成能力\n${'声音设计接口资料。'.repeat(800)}\n兼容 DC-Media 协议`;
  const {requirement}=store.createRequirement(group.id,{content:long});
  let sequence=0;const texts=new Map(),calls=[];
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},
    startTurn:async(threadId,prompt)=>{const turnId=`long-${++sequence}`;calls.push({threadId,prompt});texts.set(turnId,prompt.includes('任务计划')?`<omega-plan>{"summary":"交给负责人评估","tasks":[{"memberId":"${member.id}","title":"设计音色接入","objective":"设计音色生成能力并评估 DC-Media 协议兼容方案","accessMode":"read","dependsOn":[]}]}</omega-plan>`:'已给出接入方案');return{turn:{id:turnId}};},
    waitTurn:async()=>({status:'completed'}),readTurnText:async(_threadId,turnId)=>texts.get(turnId)||''});
  await orchestrator.run(group.id,requirement.id);
  const finished=store.getRequirement(requirement.id),memberCall=calls.find(call=>call.threadId==='owner-thread');
  assert.equal(finished.status,'completed');
  assert.equal(finished.tasks[0].objective,'设计音色生成能力并评估 DC-Media 协议兼容方案');
  assert.ok(memberCall.prompt.includes('用户原始长资料'));
  assert.ok(memberCall.prompt.includes('兼容 DC-Media 协议'));
  store.close();
});

test('orchestrator runs confirmed tasks in existing sessions and produces delivery',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'协作组',cwd:'/workspace',limits:{maxTasks:5,maxReworks:1,maxRounds:6,taskTimeoutMinutes:5}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'dev-thread',name:'开发',role:'开发'});const member=group.members[0];
  const {requirement}=store.createRequirement(group.id,{content:'增加功能',acceptance:'测试通过'});
  let sequence=0;const textByTurn=new Map(),calls=[];
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},
    startTurn:async(threadId,prompt)=>{const turnId='turn-'+(++sequence);calls.push({threadId,prompt});
      const answer=prompt.includes('任务计划')?`<omega-plan>{"summary":"完成需求并测试","tasks":[{"memberId":"${member.id}","title":"实现功能","objective":"修改代码并验证","acceptance":"自动测试通过"}]}</omega-plan>`:prompt.includes('审核成员')?'<omega-review>{"decision":"pass","summary":"测试证据充分"}</omega-review>':prompt.includes('最终交付报告')?'# 交付报告\n实现完成，可按步骤验收。':'完成内容：已实现。\n验证：3 项测试通过。';
      textByTurn.set(turnId,answer);return {turn:{id:turnId}};},
    waitTurn:async()=>({status:'completed'}),readTurnText:async(_thread,turnId)=>textByTurn.get(turnId)});
  await orchestrator.draftPlan(group.id,requirement.id);
  assert.equal(store.getRequirement(requirement.id).status,'running');
  await orchestrator.run(group.id,requirement.id);
  const done=store.getGroup(group.id);
  assert.equal(done.requirement.status,'completed');
  assert.equal(done.requirement.tasks[0].status,'completed');
  assert.equal(done.requirement.delivery,done.requirement.tasks[0].result);
  assert.deepEqual(calls.map(call=>call.threadId),['coord','dev-thread']);
  assert.ok(calls[1].prompt.startsWith('修改代码并验证'));
  assert.match(calls[1].prompt,/测试通过/);
  assert.doesNotMatch(calls[1].prompt,/自动测试通过/);
  assert.doesNotMatch(calls[1].prompt,/你正在作为|当前需求：|职责：/);
  store.close();
});

test('scheduler starts independent tasks in different member workspaces concurrently',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'跨项目组',limits:{maxConcurrency:2,taskTimeoutMinutes:5}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'thread-a',name:'A 开发',role:'开发',cwd:'/projects/a'});
  group=store.addMember(group.id,{threadId:'thread-b',name:'B 开发',role:'开发',cwd:'/projects/b'});
  const requirement=store.createRequirement(group.id,{content:'同步修改两个项目'}).requirement;
  store.setPlan(requirement.id,'并行修改',[
    {memberId:group.members[0].id,title:'修改 A',objective:'完成 A',dependsOn:[]},
    {memberId:group.members[1].id,title:'修改 B',objective:'完成 B',dependsOn:[]}
  ],'plan','raw');
  const releases=new Map(),calls=[];let sequence=0;const textByTurn=new Map();
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,isWorkspaceBusy:()=>false,notify:()=>{},
    startTurn:async(threadId,prompt)=>{const turnId='parallel-'+(++sequence);calls.push({threadId,prompt,turnId});textByTurn.set(turnId,threadId==='coord'?(prompt.includes('最终交付报告')?'交付完成':'<omega-review>{"decision":"pass","summary":"通过"}</omega-review>'):'成员交付完成');return{turn:{id:turnId}};},
    waitTurn:async(threadId,turnId)=>threadId==='coord'?{status:'completed'}:new Promise(resolve=>releases.set(turnId,()=>resolve({status:'completed'}))),
    readTurnText:async(_thread,turnId)=>textByTurn.get(turnId)});
  orchestrator.confirm(group.id,requirement.id);
  for(let i=0;i<50&&calls.filter(call=>call.threadId!=='coord').length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  const memberCalls=calls.filter(call=>call.threadId!=='coord');
  assert.deepEqual(new Set(memberCalls.map(call=>call.threadId)),new Set(['thread-a','thread-b']));
  assert.equal(releases.size,2,'两个成员任务应在任意一个完成前同时启动');
  for(const release of releases.values())release();
  await orchestrator.run(group.id,requirement.id);
  assert.equal(store.getRequirement(requirement.id).status,'completed');
  store.close();
});

test('@member routes directly without a coordinator turn',()=>{
  const store=new GroupStore(':memory:');let group=store.createGroup({name:'直达群组'},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'dev-thread',name:'开发成员',role:'开发',cwd:'/projects/dev'});
  group=store.addMember(group.id,{threadId:'test-thread',name:'测试成员',role:'测试',cwd:'/projects/test'});
  let coordinatorCalls=0;const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},startTurn:async()=>{coordinatorCalls++;throw new Error('不应调用协调者');},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>''});
  orchestrator.suspend(group.id);const result=orchestrator.submit(group.id,{content:'@开发成员 修改登录接口'});
  assert.equal(result.requirement.status,'running');assert.equal(result.requirement.tasks.length,1);assert.equal(result.requirement.tasks[0].memberId,group.members[0].id);assert.equal(result.requirement.tasks[0].objective,'修改登录接口');assert.equal(coordinatorCalls,0);
  assert.equal(result.messages.filter(message=>message.requirementId===result.requirement.id&&message.kind==='coordinator').length,0);
  const multiple=orchestrator.submit(group.id,{content:'@开发成员 修复接口\n@测试成员 运行回归测试'}).requirement;
  assert.deepEqual(multiple.tasks.map(task=>task.memberId),group.members.map(member=>member.id));assert.deepEqual(multiple.tasks.map(task=>task.objective),['修复接口','运行回归测试']);assert.equal(coordinatorCalls,0);store.close();
});

test('a missing member thread is a known failure before execution',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'失效会话组'},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'missing-thread',name:'开发',role:'开发',cwd:'/projects/a'});
  const requirement=store.createRequirement(group.id,{content:'执行任务'}).requirement;
  store.setPlan(requirement.id,'执行',[{memberId:group.members[0].id,title:'查询版本',objective:'查询'}],'plan','raw');
  store.confirmPlan(group.id,requirement.id);
  const raw=store.runnableTasks(group.id)[0];
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},startTurn:async()=>{throw new Error('thread not found: missing-thread');},waitTurn:async()=>({status:'completed'}),readTurnText:async()=>''});
  orchestrator.suspend(group.id);
  await orchestrator.dispatchTask(group.id,raw);
  const failed=store.getRequirement(requirement.id);
  assert.equal(failed.status,'paused');
  assert.equal(failed.tasks[0].status,'failed');
  assert.match(failed.error,/更换关联会话/);
  assert.doesNotMatch(failed.error,/结果待核对/);
  store.close();
});

test('restart recovery reattaches a persisted turn without dispatching it twice',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'恢复执行组',limits:{taskTimeoutMinutes:5}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'member-thread',name:'开发',role:'开发',cwd:'/projects/a'});
  const requirement=store.createRequirement(group.id,{content:'继续完成任务'}).requirement;
  store.setPlan(requirement.id,'直接执行',[{memberId:group.members[0].id,title:'恢复任务',objective:'完成原任务'}],'plan','raw');
  store.confirmPlan(group.id,requirement.id);
  const task=store.getRequirement(requirement.id).tasks[0];
  store.startTask(task.id,'persisted-dispatch','persisted-turn',5*60*1000);
  store.recoverInterrupted();store.refreshAllStatuses();
  assert.equal(store.getTask(task.id).status,'unknown');
  let starts=0;
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},
    startTurn:async()=>{starts++;throw new Error('恢复不能再次派发')},
    waitTurn:async(threadId,turnId)=>{assert.equal(threadId,'member-thread');assert.equal(turnId,'persisted-turn');return{status:'completed'}},
    readTurnText:async()=> '服务重启前已经完成的交付'});
  await orchestrator.resume();
  await orchestrator.run(group.id,requirement.id);
  const recovered=store.getRequirement(requirement.id);
  assert.equal(recovered.status,'completed');
  assert.equal(recovered.tasks[0].status,'completed');
  assert.equal(recovered.tasks[0].result,'服务重启前已经完成的交付');
  assert.equal(recovered.tasks[0].attempt,1);
  assert.equal(starts,0);
  store.close();
});

test('restart recovery keeps an interrupted turn paused for explicit retry',async()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'中断恢复组',limits:{taskTimeoutMinutes:5}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'member-thread',name:'开发',role:'开发',cwd:'/projects/a'});
  const requirement=store.createRequirement(group.id,{content:'执行任务'}).requirement;
  store.setPlan(requirement.id,'执行',[{memberId:group.members[0].id,title:'任务',objective:'完成'}],'plan','raw');store.confirmPlan(group.id,requirement.id);
  const task=store.getRequirement(requirement.id).tasks[0];store.startTask(task.id,'dispatch','turn',5*60*1000);store.recoverInterrupted();store.refreshAllStatuses();
  const orchestrator=new GroupOrchestrator({store,isThreadActive:()=>false,notify:()=>{},startTurn:async()=>{throw Error('不应重发')},waitTurn:async()=>({status:'interrupted'}),readTurnText:async()=>''});
  await orchestrator.resume();
  const paused=store.getRequirement(requirement.id);
  assert.equal(paused.status,'paused');assert.equal(paused.tasks[0].status,'failed');assert.match(paused.error,/interrupted/);
  store.close();
});
