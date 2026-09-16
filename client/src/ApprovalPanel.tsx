import {useEffect,useMemo,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';

type Question={id:string;question:string;options?:Array<{label:string}>};
type ApprovalRequest={id:string|number;method:string;params?:Record<string,any>};
interface Actions{resolve(id:string|number,result:unknown):Promise<void>;report(message:string):void}

function detail(request:ApprovalRequest){
  const params=request.params||{};
  return String(params.command||params.reason||JSON.stringify(params,null,2));
}

export function ApprovalCard({request,actions}:{request:ApprovalRequest;actions:Actions}){
  const questions=(request.params?.questions||[]) as Question[];
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const approval=/item\/(commandExecution|fileChange)\/requestApproval/.test(request.method);
  const userInput=request.method==='item/tool/requestUserInput';
  useEffect(()=>{setAnswers({});setBusy(false);setFailure('');},[request.id]);
  const answer=async(result:unknown)=>{
    if(busy)return;
    setBusy(true);setFailure('');
    try{await actions.resolve(request.id,result)}catch(error){
      const message=error instanceof Error?error.message:String(error);
      setFailure(message);actions.report(message);setBusy(false);
    }
  };
  const complete=useMemo(()=>questions.every(question=>(answers[question.id]||'').trim()),[answers,questions]);
  return <article className="approval" data-request-id={String(request.id)}>
    <header><strong>需要你的决定</strong><span>{approval?'执行审批':userInput?'补充信息':'待处理请求'}</span></header>
    <pre>{detail(request)}</pre>
    {approval&&<div className="approval-actions"><button disabled={busy} onClick={()=>void answer({decision:'accept'})}>允许本次</button><button className="secondary" disabled={busy} onClick={()=>void answer({decision:'decline'})}>拒绝</button></div>}
    {userInput&&<form onSubmit={event=>{event.preventDefault();void answer({answers:Object.fromEntries(questions.map(question=>[question.id,{answers:[answers[question.id]?.trim()||'']}]))})}}>
      {questions.map(question=><label key={question.id}>{question.question}<input value={answers[question.id]||''} disabled={busy} placeholder={(question.options||[]).map(option=>option.label).join(' / ')} onChange={event=>setAnswers(value=>({...value,[question.id]:event.target.value}))}/></label>)}
      <button disabled={busy||!complete}>{busy?'提交中…':'提交回答'}</button>
    </form>}
    {!approval&&!userInput&&<p>此请求类型暂不支持，请停止当前任务。</p>}
    {failure&&<p className="approval-error" role="alert">{failure}</p>}
  </article>;
}

function Panel({requests,actions}:{requests:ApprovalRequest[];actions:Actions}){
  return <>{requests.map(request=><ApprovalCard key={String(request.id)} request={request} actions={actions}/>)}</>;
}

export function installApprovalPanel(){
  const host=document.getElementById('approvals');if(!host)return;
  host.dataset.reactOwned='true';
  const root:Root=createRoot(host);
  window.omegaReactApprovals={render:(requests,actions)=>root.render(<Panel requests={requests} actions={actions}/>)};
  window.dispatchEvent(new Event('omega:react-approvals-ready'));
}
