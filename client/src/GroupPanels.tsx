import {useEffect,useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {appStore,useAppState} from './AppState.js';

type Member={id:string;threadId:string;name:string;role:string;avatar?:string;projectName?:string;cwd:string;responsibilities?:string};
type Decision={id:string;title:string;question:string;status:string;requestedAt?:string;answer?:{label:string}};
type Task={id:string;memberId:string;status:string;decision?:Decision};
type Requirement={id:string;content:string;status:string;createdAt?:string;updatedAt?:string;tasks?:Task[]};
type Message={requirementId?:string;kind:string;author:string};
type Layout={mobile:boolean;membersOpen:boolean;questionsOpen:boolean};
const preset:Record<string,string>={developer:'💻',designer:'🎨',tester:'🧪',analyst:'📊',operator:'🛠',coordinator:'🧭'};
const states:Record<string,string>={plan_drafting:'未回复',awaiting_confirmation:'未回复',running:'回复中',finalizing:'回复中',awaiting_acceptance:'已回复',accepted:'已回复',cancelled:'已取消',paused:'执行异常',queued:'未回复',completed:'已回复',failed:'执行异常',unknown:'需核对',reviewing:'回复中'};
const tickingRequirementStates=new Set(['plan_drafting','awaiting_confirmation','queued','running','reviewing','finalizing']);
let layout:Layout={mobile:matchMedia('(max-width:800px)').matches,membersOpen:false,questionsOpen:false};
const mergeWorkspace=(value:Record<string,unknown>)=>appStore.patch({groupWorkspace:{...(appStore.getSnapshot().groupWorkspace||{}),...value}});

function Avatar({member}:{member:Member}){if(member.avatar?.startsWith('data:image/'))return <img className="member-avatar" src={member.avatar} aria-hidden/>;return <span className="member-avatar" aria-hidden>{member.avatar?.startsWith('preset:')?preset[member.avatar.slice(7)]:(Array.from(member.name)[0]||'成')}</span>}
function Members({members=[],busy=new Set(),removable=false,actions}:{members?:Member[];busy?:Set<string>;removable?:boolean;actions:any}){return <>{members.map(member=><article className="member-card" key={member.id}>
  <div><Avatar member={member}/><div><strong>{member.name}</strong><span>{member.role}</span></div><div className="member-actions"><button type="button" className="member-edit" onClick={()=>actions.edit(member)}>编辑</button><button type="button" className="link-button" onClick={()=>actions.open(member.threadId)}>打开会话</button></div></div>
  <small className="member-workspace">{busy.has(member.id)?'处理中':'空闲'} · {member.projectName||'未命名项目'} · {member.cwd}</small>
  {member.responsibilities&&<p>{member.responsibilities}</p>}{removable&&<button type="button" className="member-remove" onClick={()=>actions.remove(member.id)}>移出群组</button>}
  </article>)}</>}
function elapsed(start?:string,end?:string){const value=Date.parse(end||new Date().toISOString())-Date.parse(start||'');if(!Number.isFinite(value))return'—';const seconds=Math.max(0,Math.floor(value/1000));if(seconds<60)return`${seconds} 秒`;const minutes=Math.floor(seconds/60);return minutes<60?`${minutes} 分 ${seconds%60} 秒`:`${Math.floor(minutes/60)} 小时 ${minutes%60} 分`;}
function Questions({requirements=[],messages=[],members=[],actions,onFocus}:{requirements?:Requirement[];messages?:Message[];members?:Member[];actions:any;onFocus():void}){const[,tick]=useState(0);useEffect(()=>{const id=setInterval(()=>tick(value=>value+1),1000);return()=>clearInterval(id)},[]);return <>{requirements.map((requirement,index)=>{const ticking=tickingRequirementStates.has(requirement.status),responders=[...new Set(messages.filter(message=>message.requirementId===requirement.id&&['member','coordinator'].includes(message.kind)).map(message=>message.author))],task=requirement.tasks?.find(item=>item.status==='awaiting_input'&&item.decision?.status==='pending'),decision=task?.decision,member=task&&members.find(item=>item.id===task.memberId);return <article className="task-card question-card" data-status={decision?'awaiting_input':requirement.status} key={requirement.id}>
  <button type="button" className="question-link" onClick={()=>{actions.focus(requirement.id);onFocus()}}><span className="question-number">{requirements.length-index}</span>{decision?.title||requirement.content.slice(0,120)}</button>
  <div className="question-meta"><span className="question-state">{decision?'待你决策':states[requirement.status]||'未回复'}</span><span>·</span><time className="question-duration">{decision?`等待 ${elapsed(decision.requestedAt)}`:elapsed(requirement.createdAt,ticking?undefined:(requirement.updatedAt||requirement.createdAt))}</time></div>
  {decision&&task&&<><small className="question-decision-source">来自 {member?.name||'成员'}</small><button type="button" className="question-decide" onClick={()=>{actions.decide({taskId:task.id,requirementId:requirement.id,memberName:member?.name||'成员',decision});onFocus()}}>去决策</button></>}
  {!!responders.length&&<small className="question-responders">{responders.join('、')}</small>}
  </article>})}</>}

function saved(side:'members'|'tasks'){try{return localStorage.getItem(`omega-group-${side}-collapsed`)!=='1'}catch{return true}}
function GroupWorkspace(){const workspace=useAppState().groupWorkspace||{},[mobile,setMobile]=useState(()=>matchMedia('(max-width:800px)').matches),[membersOpen,setMembersOpen]=useState(()=>!matchMedia('(max-width:800px)').matches&&saved('members')),[questionsOpen,setQuestionsOpen]=useState(()=>!matchMedia('(max-width:800px)').matches&&saved('tasks'));
  const closePanels=()=>{if(mobile){setMembersOpen(false);setQuestionsOpen(false)}};
  const toggle=(side:'members'|'tasks')=>{if(mobile){setMembersOpen(value=>side==='members'?!value:false);setQuestionsOpen(value=>side==='tasks'?!value:false);return}if(side==='members')setMembersOpen(value=>{try{localStorage.setItem('omega-group-members-collapsed',value?'1':'0')}catch{}return!value});else setQuestionsOpen(value=>{try{localStorage.setItem('omega-group-tasks-collapsed',value?'1':'0')}catch{}return!value})};
  useEffect(()=>{const query=matchMedia('(max-width:800px)'),change=()=>{setMobile(query.matches);setMembersOpen(query.matches?false:saved('members'));setQuestionsOpen(query.matches?false:saved('tasks'))};query.addEventListener('change',change);return()=>query.removeEventListener('change',change)},[]);
  useEffect(()=>{const handler=(event:Event)=>toggle((event as CustomEvent<'members'|'tasks'>).detail);window.addEventListener('omega:toggle-group-panel',handler);return()=>window.removeEventListener('omega:toggle-group-panel',handler)},[mobile]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&mobile&&(membersOpen||questionsOpen)){event.preventDefault();closePanels()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[mobile,membersOpen,questionsOpen]);
  useEffect(()=>{const host=document.getElementById('group-view');if(!host)return;host.classList.toggle('members-collapsed',!membersOpen);host.classList.toggle('tasks-collapsed',!questionsOpen);if(mobile&&(membersOpen||questionsOpen))host.dataset.mobilePanel=membersOpen?'members':'tasks';else delete host.dataset.mobilePanel;layout={mobile,membersOpen,questionsOpen};const header=appStore.getSnapshot().groupHeader;if(header&&(header.mobile!==mobile||header.membersOpen!==membersOpen||header.questionsOpen!==questionsOpen))appStore.patch({groupHeader:{...header,mobile,membersOpen,questionsOpen}})},[mobile,membersOpen,questionsOpen]);
  const members=workspace.membersModel?.members||[],questions=workspace.questionsModel?.requirements||[];
  return <div className="group-columns">
    <aside className="group-panel"><div className="panel-title"><h2>成员</h2><span>{members.length} 位</span><button type="button" className="mobile-panel-close" onClick={closePanels}>关闭</button></div><div id="group-members" data-react-owned="true"><Members {...workspace.membersModel} actions={workspace.memberActions||{}}/></div><div className="summary-card"><h3>群组摘要</h3><p>{workspace.summary||'协调者会持续整理目标、约束和进度。'}</p></div></aside>
    <button type="button" className="group-panel-backdrop" aria-label="关闭侧栏" onClick={closePanels}/>
    <section className="group-center"><div id="group-timeline" aria-live="polite"></div><form id="requirement-form" hidden={!workspace.active}></form></section>
    <aside className="group-panel task-panel"><div className="panel-title"><h2>问题定位</h2><span>{questions.length?`${questions.length} 个问题`:''}</span><button type="button" className="mobile-panel-close" onClick={closePanels}>关闭</button></div><div id="group-tasks" data-react-owned="true"><Questions {...workspace.questionsModel} members={members} actions={workspace.questionActions||{}} onFocus={closePanels}/></div></aside>
  </div>}

export function installGroupPanels(){const host=document.getElementById('group-view');if(!host)return;host.dataset.reactOwned='true';flushSync(()=>createRoot(host).render(<GroupWorkspace/>));window.omegaReactGroupPanels={
  renderMembers:(model,actions)=>mergeWorkspace({membersModel:model,memberActions:actions,summary:model.summary,active:model.active}),
  renderQuestions:(model,actions)=>mergeWorkspace({questionsModel:model,questionActions:actions}),
  toggle:(side)=>window.dispatchEvent(new CustomEvent('omega:toggle-group-panel',{detail:side})),
  getLayout:()=>layout,
};window.dispatchEvent(new Event('omega:react-group-panels-ready'))}
