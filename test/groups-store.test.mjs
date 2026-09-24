import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupStore } from '../groups-store.mjs';

function fixture(){
  const store=new GroupStore(':memory:');
  const group=store.createGroup({name:'Omega Team',cwd:'/workspace',limits:{maxTasks:5,maxReworks:1,maxRounds:6,taskTimeoutMinutes:5}},'coordinator','/workspace');
  const value=store.addMember(group.id,{threadId:'developer',name:'开发成员',role:'开发',responsibilities:'实现代码'});
  return {store,group:value,member:value.members[0]};
}

test('group records preserve plan, dispatch and delivery evidence',()=>{
  const {store,group,member}=fixture();
  const {requirement}=store.createRequirement(group.id,{content:'实现群组功能',acceptance:'测试通过'});
  store.setPlan(requirement.id,'目标与约束',[{memberId:member.id,title:'实现',objective:'编写功能',acceptance:'测试通过'}],'plan-turn','plan raw');
  let state=store.getGroup(group.id);
  assert.equal(state.requirement.status,'awaiting_confirmation');
  assert.equal(state.messages.at(-1).reference.turnId,'plan-turn');
  store.confirmPlan(group.id,requirement.id);
  const task=store.publicTask(store.nextTask(requirement.id));
  store.startTask(task.id,'dispatch-1','turn-1');
  store.completeTask(task.id,'文件已修改；测试 3 项通过。','turn-1');
  store.beginFinalize(requirement.id,'final-turn');
  store.completeDelivery(requirement.id,'交付报告','final-turn');
  state=store.getGroup(group.id);
  assert.equal(state.requirement.status,'completed');
  assert.equal(state.requirement.tasks[0].result,'文件已修改；测试 3 项通过。');
  assert.equal(state.messages.at(-1).reference.type,'delivery-report');
  assert.equal(store.getGroup(group.id).status,'idle');
  store.close();
});

test('group requirements retain compact pasted-file references without copying their bodies',()=>{
  const {store,group}=fixture(),paste={id:'1700000000000-12345678-1234-4123-8123-123456789abc',chars:11402,bytes:12000,createdAt:1700000000000,expiresAt:1700604800000};
  const {requirement}=store.createRequirement(group.id,{content:'参考 [Pasted Content 11402 chars] 完成开发',pasteRefs:[paste]});
  assert.deepEqual(requirement.pastedTexts,[paste]);
  const message=store.getGroup(group.id).messages.at(-1);
  assert.equal(message.content,'参考 [Pasted Content 11402 chars] 完成开发');
  assert.deepEqual(message.reference.pastedTexts,[paste]);
  store.close();
});

test('a session can belong to only one active group and running members cannot leave',()=>{
  const {store,group,member}=fixture();
  const second=store.createGroup({name:'Second',cwd:'/workspace'},'coordinator-2','/workspace');
  assert.throws(()=>store.addMember(second.id,{threadId:'developer',name:'开发',role:'开发'}),/已经加入/);
  const {requirement}=store.createRequirement(group.id,{content:'任务'});
  store.setPlan(requirement.id,'摘要',[{memberId:member.id,title:'任务',objective:'做事'}],'p','raw');store.confirmPlan(group.id,requirement.id);
  assert.throws(()=>store.removeMember(group.id,member.id),/仍有待执行/);
  store.cancel(group.id,requirement.id);
  store.removeMember(group.id,member.id);
  assert.equal(store.getGroup(group.id).members.length,0);
  assert.equal(store.addMember(second.id,{threadId:'developer',name:'开发',role:'开发'}).members.length,1);
  store.close();
});

test('overlapping project paths are detected while a task runs',()=>{
  const {store,group,member}=fixture();const {requirement}=store.createRequirement(group.id,{content:'任务'});
  store.setPlan(requirement.id,'摘要',[{memberId:member.id,title:'任务',objective:'做事'}],'p','raw');store.confirmPlan(group.id,requirement.id);
  const task=store.publicTask(store.nextTask(requirement.id));store.startTask(task.id,'d','t');
  assert.equal(store.runningConflict('/workspace/child').groupId,group.id);
  assert.equal(store.runningConflict('/other'),null);
  store.close();
});

test('read-only tasks may share a workspace while writes remain exclusive',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'共享目录组',limits:{maxConcurrency:4}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'reader-a',name:'查询 A',role:'分析',cwd:'/workspace/project'});
  group=store.addMember(group.id,{threadId:'reader-b',name:'查询 B',role:'审核',cwd:'/workspace/project'});
  group=store.addMember(group.id,{threadId:'writer',name:'开发',role:'开发',cwd:'/workspace/project'});
  const requirement=store.createRequirement(group.id,{content:'查询并修改'}).requirement;
  store.setPlan(requirement.id,'并行查询',[{memberId:group.members[0].id,title:'查询版本',objective:'只读取版本信息',accessMode:'read'},{memberId:group.members[1].id,title:'复核结论',objective:'只读核对资料',accessMode:'read'},{memberId:group.members[2].id,title:'修改代码',objective:'实现修复',accessMode:'write'}],'plan','raw');
  store.confirmPlan(group.id,requirement.id);
  let runnable=store.runnableTasks(group.id);assert.equal(runnable.length,3);
  store.startTask(runnable[0].id,'read-a',null);
  runnable=store.runnableTasks(group.id);
  assert.deepEqual(runnable.map(task=>task.title),['复核结论']);
  assert.equal(store.runningConflict('/workspace/project/child',null,'read'),null);
  assert.equal(store.runningConflict('/workspace/project/child',null,'write').groupId,group.id);
  store.close();
});

test('different named projects may write concurrently from the same parent workspace',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'同父目录多仓',limits:{maxConcurrency:3}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'dramaclaw',name:'Dramaclaw',role:'开发',cwd:'/workspace',projectName:'dramaclaw'});
  group=store.addMember(group.id,{threadId:'relayclaw',name:'RelayClaw',role:'开发',cwd:'/workspace',projectName:'relayclaw'});
  const requirement=store.createRequirement(group.id,{content:'同时修改两个仓库'}).requirement;
  store.setPlan(requirement.id,'并行开发',[
    {memberId:group.members[0].id,title:'修改 Dramaclaw',objective:'实现功能',accessMode:'write'},
    {memberId:group.members[1].id,title:'修改 RelayClaw',objective:'实现网关',accessMode:'write'}
  ],'plan','raw');
  store.confirmPlan(group.id,requirement.id);
  const first=store.runnableTasks(group.id)[0];store.startTask(first.id,'d','t');
  assert.equal(store.runnableTasks(group.id).length,1);
  assert.equal(store.runningConflict('/workspace',null,'write','relayclaw'),null);
  assert.equal(store.runningConflict('/workspace',null,'write','dramaclaw').groupId,group.id);
  store.close();
});

test('task plans infer safe access modes and allow explicit correction',()=>{
  const {store,group,member}=fixture();const requirement=store.createRequirement(group.id,{content:'检查后修复'}).requirement;
  store.setPlan(requirement.id,'计划',[{memberId:member.id,title:'查询版本',objective:'统计当前版本'},{memberId:member.id,title:'统计三个仓最近更新时间',objective:'确认默认分支最近更新'},{memberId:member.id,title:'实现修复',objective:'修改代码'}],'plan','raw');
  let tasks=store.getRequirement(requirement.id).tasks;
  assert.deepEqual(tasks.map(task=>task.accessMode),['read','read','write']);
  store.updateDraftTask(group.id,requirement.id,{taskId:tasks[2].id,accessMode:'read'});
  tasks=store.getRequirement(requirement.id).tasks;assert.equal(tasks[2].accessMode,'read');
  store.close();
});

test('multiple requirements queue and only dependency-ready idle non-conflicting work is runnable',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'跨项目组',limits:{maxConcurrency:3}},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'a-dev',name:'A 开发',role:'开发',cwd:'/projects/a',projectName:'A'});
  group=store.addMember(group.id,{threadId:'b-dev',name:'B 开发',role:'开发',cwd:'/projects/b',projectName:'B'});
  group=store.addMember(group.id,{threadId:'a-test',name:'A 测试',role:'测试',cwd:'/projects/a/test',projectName:'A'});
  const [a,b,tester]=group.members;
  const first=store.createRequirement(group.id,{content:'同时修改 A 和 B'}).requirement;
  store.setPlan(first.id,'并行计划',[
    {memberId:a.id,title:'A 实现',objective:'实现 A',dependsOn:[]},
    {memberId:b.id,title:'B 实现',objective:'实现 B',dependsOn:[]},
    {memberId:tester.id,title:'A 验证',objective:'验证 A',dependsOn:[0]}
  ],'plan-1','raw');
  store.confirmPlan(group.id,first.id);
  const second=store.createRequirement(group.id,{content:'B 的另一项需求'}).requirement;
  store.setPlan(second.id,'第二张计划',[{memberId:b.id,title:'B 后续',objective:'继续 B',dependsOn:[]}],'plan-2','raw');
  store.confirmPlan(group.id,second.id);
  assert.equal(store.getGroup(group.id).requirements.length,2);
  let runnable=store.runnableTasks(group.id);
  assert.deepEqual(new Set(runnable.map(task=>task.title)),new Set(['A 实现','B 实现','B 后续']));
  const aTask=runnable.find(task=>task.title==='A 实现');store.startTask(aTask.id,'dispatch-a',null);
  runnable=store.runnableTasks(group.id);
  assert(!runnable.some(task=>task.title==='A 验证'),'依赖未完成且目录与运行任务重叠');
  const bTitles=runnable.filter(task=>task.cwd==='/projects/b').map(task=>task.title);
  assert.equal(bTitles.length,2,'同一成员的两张需求都在队列，但调度器只会选其中一张后重新计算');
  const bTask=runnable.find(task=>task.title==='B 实现');store.startTask(bTask.id,'dispatch-b',null);
  assert.equal(store.runnableTasks(group.id).length,0,'成员忙碌和目录冲突会阻止其余任务');
  store.close();
});

test('group concurrency can be changed between one and ten',()=>{
  const store=new GroupStore(':memory:'),group=store.createGroup({name:'可调度组'},'coord','/workspace');
  assert.equal(group.limits.maxConcurrency,3);
  assert.equal(store.setConcurrency(group.id,6).limits.maxConcurrency,6);
  assert.throws(()=>store.setConcurrency(group.id,0),/1–10/);
  assert.throws(()=>store.setConcurrency(group.id,11),/1–10/);
  assert.throws(()=>store.setConcurrency(group.id,2.5),/1–10/);
  store.close();
});

test('deleting a group releases members and returns only coordinator deletion target',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'临时群组'},'coordinator-thread','/workspace');
  group=store.addMember(group.id,{threadId:'member-thread',name:'成员',role:'开发',cwd:'/projects/member'});
  const deleted=store.deleteGroup(group.id);
  assert.equal(deleted.coordinatorThreadId,'coordinator-thread');
  assert.deepEqual(deleted.memberThreadIds,['member-thread']);
  assert.equal(store.threadBinding('member-thread'),null);
  assert.throws(()=>store.getGroup(group.id),/群组不存在/);
  store.close();
});

test('member profile can be edited without changing its session or workspace',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'成员编辑组'},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'member-thread',name:'旧名称',role:'开发',avatar:'preset:developer',cwd:'/projects/original',projectName:'旧项目'});
  const member=group.members[0];
  group=store.updateMember(group.id,member.id,{name:'新名称',role:'测试',avatar:'preset:tester',projectName:'新项目',responsibilities:'负责验收',operations:'只运行测试',skills:'自动化测试'});
  const updated=group.members[0];
  assert.deepEqual({name:updated.name,role:updated.role,avatar:updated.avatar,projectName:updated.projectName,responsibilities:updated.responsibilities,operations:updated.operations,skills:updated.skills},{name:'新名称',role:'测试',avatar:'preset:tester',projectName:'新项目',responsibilities:'负责验收',operations:'只运行测试',skills:'自动化测试'});
  assert.equal(updated.threadId,'member-thread');assert.equal(updated.cwd,'/projects/original');
  assert.throws(()=>store.updateMember(group.id,member.id,{...updated,avatar:'javascript:alert(1)'}),/头像格式/);
  store.close();
});

test('member can be rebound and unfinished tasks follow the replacement workspace',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'会话恢复组'},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'missing-thread',name:'开发',role:'开发',cwd:'/projects/old'});
  const member=group.members[0],requirement=store.createRequirement(group.id,{content:'继续任务'}).requirement;
  store.setPlan(requirement.id,'继续执行',[{memberId:member.id,title:'恢复任务',objective:'完成工作'}],'plan','raw');
  group=store.updateMember(group.id,member.id,{threadId:'replacement-thread',cwd:'/projects/new',name:'开发',role:'开发',projectName:'新项目'},requirement.id);
  assert.equal(group.members[0].threadId,'replacement-thread');
  assert.equal(group.members[0].cwd,'/projects/new');
  assert.equal(group.requirement.tasks[0].cwd,'/projects/new');
  assert.equal(store.threadBinding('missing-thread'),null);
  assert.equal(store.threadBinding('replacement-thread').memberId,member.id);
  store.close();
});

test('retry after a coordinator failure preserves member results awaiting review',()=>{
  const store=new GroupStore(':memory:');
  let group=store.createGroup({name:'审核恢复组'},'coord','/workspace');
  group=store.addMember(group.id,{threadId:'member-thread',name:'开发',role:'开发',cwd:'/projects/a'});
  const requirement=store.createRequirement(group.id,{content:'完成并审核'}).requirement;
  store.setPlan(requirement.id,'执行',[{memberId:group.members[0].id,title:'任务',objective:'完成'}],'plan','raw');
  store.confirmPlan(group.id,requirement.id);
  const task=store.getRequirement(requirement.id).tasks[0];
  store.recordTaskResult(task.id,'已有成员交付','member-turn');
  store.failPhase(requirement.id,'thread not found: coord');
  const retried=store.retry(group.id,requirement.id).group;
  assert.equal(retried.requirement.status,'running');
  assert.equal(retried.requirement.tasks[0].status,'reviewing');
  assert.equal(retried.requirement.tasks[0].result,'已有成员交付');
  store.close();
});
