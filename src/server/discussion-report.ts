type EvidenceSource={taskId:string;member:string;text:string};
type Issue={kind:'discussion'|'verification'|'user-decision';question:string;reason:string;nextStep:string};
export type DiscussionReport={agreed:string[];issues:Issue[];recommendation:string;nextSteps:string[];continueDiscussion:boolean;focus:string;closingReason:string};

// Only raw member replies can establish attribution; previous summaries are not evidence.
export function parseDiscussionReport(text:string,sources:EvidenceSource[]=[]):DiscussionReport{
  const match=text.match(/<omega-discussion>\s*([\s\S]*?)\s*<\/omega-discussion>/i);
  if(!match)throw Error('讨论小结缺少结构化结果');
  const value=JSON.parse(match[1]);
  const string=(v:unknown,max=1200):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('讨论小结字段缺失或过长');return v.trim();};
  const array=(v:unknown,max=12):any[]=>{if(!Array.isArray(v)||v.length>max)throw Error('讨论小结列表格式错误');return v;};
  const agreed=array(value.claims).map(claim=>{
    const statement=string(claim.statement);
    // Collective assertions must not be smuggled into a claim with only one citation.
    if(/(?:全员|所有成员|四位成员|四人|大家).{0,12}(?:一致|认为|支持|指出|同意|赞成)|(?:一致|均)(?:认为|支持|指出|同意|赞成)/.test(statement))throw Error('请逐条归因，不使用全员共识措辞');
    const evidence=array(claim.evidence,30);if(!evidence.length)throw Error('成员观点缺少原文依据');
    const cited=evidence.map(item=>{
      const quote=string(item.quote,500),source=sources.find(s=>s.taskId===item.taskId);
      if(!source||!source.text.trim()||/^\(?pass\)?[。.!！]?$/i.test(source.text.trim())||!source.text.includes(quote))throw Error('成员观点引用无法在原始发言中核实');
      return `${source.member}：“${quote}”`;
    });
    return `${statement}\n  - 发言依据：${[...new Set(cited)].join('；')}`;
  });
  const issues:Issue[]=array(value.issues).map(item=>{
    if(!['discussion','verification','user-decision'].includes(item.kind))throw Error('必须区分方案分歧、事实验证与用户决策');
    return{kind:item.kind,question:string(item.question),reason:string(item.reason),nextStep:string(item.nextStep)};
  });
  const nextSteps=array(value.nextSteps).map(item=>string(item));if(!nextSteps.length)throw Error('讨论小结缺少下一步');
  const open=issues.filter(issue=>issue.kind==='discussion');
  // The presence of a discussable issue, not a model-supplied stop boolean, controls continuation.
  return{agreed,issues,recommendation:string(value.recommendation,3000),nextSteps,continueDiscussion:open.length>0,focus:open.map(issue=>`${issue.question}；本轮需要：${issue.nextStep}`).join('\n'),closingReason:string(value.closingReason,2000)};
}

export function discussionReportText(report:DiscussionReport,kind:string,round:number){
  const list=(items:string[],empty:string)=>items.length?items.map(s=>`- ${s}`).join('\n'):empty;
  const issues=(type:Issue['kind'])=>list(report.issues.filter(item=>item.kind===type).map(item=>`${item.question}\n  - 分类依据：${item.reason}\n  - 建议：${item.nextStep}`),'无明确记录。');
  const state=kind==='paused'?'预算已暂停；仍未解决的问题保留，可追加预算继续。':kind==='round'?`仍有值得讨论的方案取舍，下一轮只围绕：\n${report.focus}`:report.continueDiscussion?'仍有未解决的方案分歧，但没有可接续的成员任务，本轮停止；不代表已达成共识。':'没有待继续辩论的方案分歧，本轮讨论收尾；待验证项和用户决策仍未完成。';
  return `### ${kind==='paused'?'讨论阶段小结（预算暂停）':kind==='final'?'讨论结论':'讨论轮次小结'} · 第 ${round} 轮\n\n**成员观点与原文依据（不代表全员共识）**\n${list(report.agreed,'没有足够原文依据归纳成员共同观点。')}\n\n**仍需讨论的方案分歧**\n${issues('discussion')}\n\n**待验证事实**\n${issues('verification')}\n\n**需要用户决定**\n${issues('user-decision')}\n\n**主持人推荐方案与理由（不是成员投票结果）**\n${report.recommendation}\n\n**收尾判断**\n${state}\n主持人判断依据：${report.closingReason}\n\n**下一步建议（尚未派发或执行）**\n${list(report.nextSteps,'请补充目标。')}\n\n讨论不代表已执行或已获得实施授权。*pass 仅表示没有补充，不作为赞成票。*`;
}
