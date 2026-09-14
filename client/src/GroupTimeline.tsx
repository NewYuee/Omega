import {forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {renderMarkdown} from './ChatTimeline.js';

type DecisionOption={id:string;label:string;description?:string;recommended?:boolean};
type Decision={id:string;title:string;question:string;options:DecisionOption[];allowOther?:boolean;status:'pending'|'resolved';requestedAt?:string;respondedAt?:string;answer?:{choiceId:string;label:string;note?:string}};
type Message={id:string;kind:string;author:string;content:string;createdAt:string;requirementId?:string;reference?:Record<string,any>};
type Member={id:string;name:string;avatar?:string};
type Task={id:string;memberId:string;status:string;decision?:Decision};
type Requirement={id:string;content:string;status:string;pastedTexts?:any[];tasks?:Task[]};
interface Model{group:{id?:string;members:Member[]};messages:Message[];requirements:Requirement[];active:Requirement[]}
interface Actions{loadWindow(query:string):Promise<Message[]>;select(id:string):void;openThread(id:string):void;reply(value:{taskId:string;name:string}):void;decide(value:{taskId:string;requirementId:string;memberName:string;decision:Decision}):void;cancel(value:Requirement):Promise<void>;report(message:string):void}
interface RoomHandle{focus(id:string):Promise<boolean>;clear():void;returnToLatest():void}
type WindowState={groupId:string;messages:Message[];historical:boolean;more:boolean};

const preset:Record<string,string>={developer:'💻',designer:'🎨',tester:'🧪',analyst:'📊',operator:'🛠',coordinator:'🧭'};
function Avatar({value,name}:{value?:string;name:string}){if(value?.startsWith('data:image/'))return <img className="chat-avatar" aria-hidden src={value}/>;const icon=value?.startsWith('preset:')?preset[value.slice(7)]:undefined;return <span className="chat-avatar" aria-hidden>{icon||Array.from(name)[0]?.toUpperCase()||'Ω'}</span>}
function Content({message}:{message:Message}){const[limit,setLimit]=useState(6000),rich=['member','coordinator'].includes(message.kind),body=message.content.slice(0,limit),html=useMemo(()=>rich?renderMarkdown(body):'',[body,rich]);return <>{rich?<div className="markdown-body" dangerouslySetInnerHTML={{__html:html}}/>:<div className="group-message-text">{body}</div>}{limit<message.content.length&&<button className="reference-link" onClick={()=>setLimit(value=>value+6000)}>展开后续内容</button>}</>}
function DecisionRequest({task,requirementId,memberName,actions}:{task:Task;requirementId:string;memberName:string;actions:Actions}){const decision=task.decision;if(!decision)return null;if(decision.status==='resolved')return <div className="decision-request resolved"><span>已决策</span><strong>{decision.answer?.label||'已回复'}</strong>{decision.answer?.note&&<small>{decision.answer.note}</small>}</div>;return <div className="decision-request pending"><div><span>需要你的决定</span><strong>{decision.title}</strong><small>{decision.question}</small></div><button type="button" onClick={()=>actions.decide({taskId:task.id,requirementId,memberName,decision})}>去决策</button></div>}

const Timeline=forwardRef<RoomHandle,{model:Model;actions:Actions;area:HTMLElement}>(({model,actions,area},ref)=>{
  const[windowState,setWindowState]=useState<WindowState|null>(null),[followLatest,setFollowLatest]=useState(true),[focusRevision,setFocusRevision]=useState(0),[cancelling,setCancelling]=useState<string|null>(null),focusId=useRef<string|null>(null),focusDone=useRef<((value:boolean)=>void)|null>(null),scrollTarget=useRef<'top'|'bottom'|null>('bottom'),highlightTimer=useRef<ReturnType<typeof setTimeout>|null>(null),highlighted=useRef<HTMLElement|null>(null);
  const groupId=model.group.id||'',state=windowState?.groupId===groupId?windowState:null,messages=(state?.historical?state.messages:model.messages).slice(-120),historical=state?.historical||false,more=state?.more??true;
  useEffect(()=>{const onScroll=()=>setFollowLatest(!historical&&area.scrollHeight-area.scrollTop-area.clientHeight<70);area.addEventListener('scroll',onScroll,{passive:true});return()=>area.removeEventListener('scroll',onScroll)},[area,historical]);
  useEffect(()=>()=>{if(highlightTimer.current)clearTimeout(highlightTimer.current);highlighted.current?.classList.remove('room-highlight')},[]);
  useLayoutEffect(()=>{if(focusId.current){const target=[...area.querySelectorAll<HTMLElement>('[data-message-id]')].find(node=>node.dataset.requirementId===focusId.current);if(target){target.scrollIntoView({block:'center'});if(highlightTimer.current)clearTimeout(highlightTimer.current);highlighted.current?.classList.remove('room-highlight');highlighted.current=target;target.classList.add('room-highlight');highlightTimer.current=setTimeout(()=>{target.classList.remove('room-highlight');if(highlighted.current===target)highlighted.current=null;highlightTimer.current=null},1500);focusId.current=null;focusDone.current?.(true);focusDone.current=null;return}}if(scrollTarget.current==='top')area.scrollTop=0;else if(scrollTarget.current==='bottom'||(!historical&&followLatest))area.scrollTop=area.scrollHeight;scrollTarget.current=null},[area,messages,historical,followLatest,focusRevision]);
  const load=async(query:string,target:'top'|'bottom')=>{try{const next=await actions.loadWindow(query);if(!next.length){actions.report('没有更多消息');return false}scrollTarget.current=target;setWindowState({groupId,messages:next,historical:true,more:next.length===120});setFollowLatest(false);return true}catch(value){actions.report(value instanceof Error?value.message:String(value));return false}};
  const returnToLatest=()=>{scrollTarget.current='bottom';setWindowState(null);setFollowLatest(true)};
  const focusVisible=(id:string)=>{actions.select(id);focusId.current=id;scrollTarget.current=null;setFocusRevision(value=>value+1)};
  useImperativeHandle(ref,()=>({
    async focus(id){actions.select(id);if(messages.some(message=>message.requirementId===id)){focusVisible(id);return true}focusId.current=id;const promise=new Promise<boolean>(resolve=>{focusDone.current=resolve});if(!await load(`question=${encodeURIComponent(id)}`,'top')){focusId.current=null;focusDone.current?.(false);focusDone.current=null;return false}return promise},
    clear(){focusId.current=null;focusDone.current?.(false);focusDone.current=null;setWindowState(null);setFollowLatest(true)},
    returnToLatest,
  }),[messages,groupId]);
  const tasks=new Map(model.requirements.flatMap(item=>item.tasks||[]).map(item=>[item.id,item])),requirements=new Map(model.requirements.map(item=>[item.id,item]));
  return <>
    {more&&messages.length===120&&<button className="room-history" onClick={()=>void load(`before=${encodeURIComponent(messages[0]?.id||'')}`,'bottom')}>加载更早消息</button>}
    {!messages.length&&<p className="group-empty">向群组提出问题，成员会在这里回复。</p>}
    {messages.map(message=>{const task=tasks.get(message.reference?.taskId||''),requirement=requirements.get(message.requirementId||''),member=message.kind==='member'?model.group.members.find(item=>item.id===(message.reference?.memberId||task?.memberId))||model.group.members.find(item=>item.name===message.author):undefined,cancelable=message.kind==='user'&&!message.reference?.type&&requirement&&!['completed','accepted','cancelled'].includes(requirement.status);return <article key={message.id} data-message-id={message.id} data-requirement-id={message.requirementId||''} data-avatar={Array.from(message.author||'成员')[0]?.toUpperCase()||'成'} className={`group-message ${message.kind}`}>
      {['member','coordinator'].includes(message.kind)&&<Avatar value={message.kind==='coordinator'?'preset:coordinator':member?.avatar} name={message.author}/>}<div><strong>{message.author}</strong><time>{new Date(message.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>
      {message.kind!=='user'&&requirement&&<button className="reference-link" onClick={()=>focusVisible(requirement.id)}>回复：{requirement.content.slice(0,60)}</button>}
      {message.reference?.type==='progress'&&<small className="room-progress">{task?.status==='running'?'正在处理…':'处理进度'}</small>}<Content message={message}/>
      {message.reference?.type==='decision-request'&&task?.decision&&message.requirementId&&<DecisionRequest task={task} requirementId={message.requirementId} memberName={message.author} actions={actions}/>}
      {message.reference?.threadId&&<button className="reference-link" onClick={()=>actions.openThread(message.reference!.threadId)}>打开会话 ↗</button>}{message.kind==='member'&&message.reference?.taskId&&<button className="reference-link" onClick={()=>actions.reply({taskId:message.reference!.taskId,name:message.author})}>回复 / 追问</button>}
      {cancelable&&<button className="cancel-requirement" disabled={cancelling===requirement.id} onClick={async()=>{setCancelling(requirement.id);try{await actions.cancel(requirement)}finally{setCancelling(null)}}}>{cancelling===requirement.id?'正在取消…':'取消发送'}</button>}
    </article>})}
    {historical&&<button className="room-history" onClick={()=>void load(`after=${encodeURIComponent(messages.at(-1)?.id||'')}`,'top')}>加载后续消息</button>}
    {model.active.map(requirement=>{const decision=requirement.tasks?.find(task=>task.status==='awaiting_input'&&task.decision?.status==='pending')?.decision;return <div className={`room-active ${decision?'awaiting-decision':''}`} data-requirement-id={requirement.id} key={`active:${requirement.id}`}><span>{decision?`${decision.title} — 等待你的决定`:`${requirement.content.slice(0,42)} — 正在处理`}</span></div>})}
    {!followLatest&&<button className="room-latest" onClick={returnToLatest}>↓ 回到最新</button>}
  </>;
});

export function installGroupTimeline(){const area=document.getElementById('group-timeline');if(!area)return;const root:Root=createRoot(area),handle={current:null as RoomHandle|null},render=(model:Model,actions:Actions)=>root.render(<Timeline ref={value=>{handle.current=value}} model={model} actions={actions} area={area}/>);window.omegaReactGroup={render,focus:async id=>handle.current?.focus(id)??false,clear:()=>handle.current?.clear(),returnToLatest:()=>handle.current?.returnToLatest()};window.dispatchEvent(new Event('omega:react-group-ready'))}
