import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDiscussionReport,discussionReportText} from '../src/server/discussion-report.ts';
const base=()=>({claims:[{statement:'素材按账号归属',evidence:[{taskId:'a',quote:'建议素材按账号归属'}]}],issues:[],recommendation:'推荐先验证临时中转',nextSteps:['建议开发核查接口'],closingReason:'可行性已回答，尚未实施'});
const sources=[{taskId:'a',member:'开发',text:'建议素材按账号归属。'}, {taskId:'b',member:'助手',text:'(pass)'}];
const parse=value=>parseDiscussionReport(`<omega-discussion>${JSON.stringify(value)}</omega-discussion>`,sources);
test('member attribution shows actual source and never promotes silence to agreement',()=>{
  const report=parse(base()),text=discussionReportText(report,'final',1);
  assert.match(text,/开发：“建议素材按账号归属”/);assert.doesNotMatch(text,/助手：“/);assert.match(text,/尚未派发或执行/);assert.match(text,/不是成员投票结果/);
  for(const change of [v=>v.claims[0].evidence[0].taskId='unknown',v=>v.claims[0].evidence[0].quote='不存在的原文',v=>v.claims[0].evidence=[{taskId:'b',quote:'pass'}],v=>v.claims[0].statement='四位成员一致指出素材按账号归属',v=>v.claims[0].evidence=[]]){const value=base();change(value);assert.throws(()=>parse(value));}
});
test('open design choices override a premature model stop, unlike pending measurements',()=>{
  const value=base();value.issues=[{kind:'discussion',question:'CE 签发还是网关续签？',reason:'现有接口取舍仍可比较',nextStep:'请两侧负责人比较兼容性'}];value.continueDiscussion=false;
  const report=parse(value);assert.equal(report.continueDiscussion,true);assert.match(report.focus,/两侧负责人/);assert.match(discussionReportText(report,'round',1),/下一轮只围绕/);
  value.issues[0]={kind:'verification',question:'实际最长排队多久？',reason:'缺少运行数据',nextStep:'采样排队时长'};value.continueDiscussion=true;
  const stopped=parse(value);assert.equal(stopped.continueDiscussion,false);assert.match(discussionReportText(stopped,'final',1),/待验证项和用户决策仍未完成/);
});
test('technical consistency does not masquerade as collective member agreement',()=>{
  const value=base();value.claims[0].statement='接口行为应与现有协议保持一致';value.claims[0].evidence[0].quote='接口行为应与现有协议保持一致';
  assert.doesNotThrow(()=>parseDiscussionReport(`<omega-discussion>${JSON.stringify(value)}</omega-discussion>`,[{taskId:'a',member:'开发',text:'接口行为应与现有协议保持一致'}]));
});
test('pass exhaustion and budget stop retain unresolved choices without claiming consensus',()=>{
  const value=base();value.issues=[{kind:'discussion',question:'签发位置',reason:'两个方案仍需比较',nextStep:'补充接口约束'}];const report=parse(value);
  assert.match(discussionReportText(report,'final',2),/不代表已达成共识/);assert.match(discussionReportText(report,'paused',2),/预算已暂停/);
  value.issues[0].kind='user-decision';assert.equal(parse(value).continueDiscussion,false);
  value.issues[0].kind='unknown';assert.throws(()=>parse(value));
});
