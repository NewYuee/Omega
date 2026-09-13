import {useEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';

type Member={id:string;threadId:string;name:string;role:string;avatar?:string;projectName?:string;cwd:string;responsibilities?:string};
type Task={id:string;memberId:string;status:string};
type Requirement={id:string;content:string;status:string;createdAt?:string;updatedAt?:string;tasks?:Task[]};
type Message={requirementId?:string;kind:string;author:string};
const preset:Record<string,string>={developer:'💻',designer:'🎨',tester:'🧪',analyst:'📊',operator:'🛠',coordinator:'🧭'};
const states:Record<string,string>={plan_drafting:'未回复',awaiting_confirmation:'未回复',running:'回复中',finalizing:'回复中',awaiting_acceptance:'已回复',accepted:'已回复',cancelled:'已取消',paused:'需处理',queued:'未回复',completed:'已回复',failed:'需处理',unknown:'需核对',reviewing:'回复中'};
function Avatar({member}:{member:Member}){if(member.avatar?.startsWith('data:image/'))return <img className="member-avatar" src={member.avatar} aria-hidden/>;return <span className="member-avatar" aria-hidden>{member.avatar?.startsWith('preset:')?preset[member.avatar.slice(7)]:(Array.from(member.name)[0]||'成')}</span>}
function Members({members,busy,removable,actions}:{members:Member[];busy:Set<string>;removable:boolean;actions:any}){return <>{members.map(member=><article className="member-card" key={member.id}>
  <div><Avatar member={member}/><div><strong>{member.name}</strong><span>{member.role}</span></div><div className="member-actions"><button type="button" className="member-edit" onClick={()=>actions.edit(member)}>编辑</button><button type="button" className="link-button" onClick={()=>actions.open(member.threadId)}>打开会话</button></div></div>
  <small className="member-workspace">{busy.has(member.id)?'处理中':'空闲'} · {member.projectName||'未命名项目'} · {member.cwd}</small>
  {member.responsibilities&&<p>{member.responsibilities}</p>}{removable&&<button type="button" className="member-remove" onClick={()=>actions.remove(member.id)}>移出群组</button>}
  </article>)}</>}
function elapsed(start?:string,end?:string){const value=Date.parse(end||new Date().toISOString())-Date.parse(start||'');if(!Number.isFinite(value))return'—';const seconds=Math.max(0,Math.floor(value/1000));if(seconds<60)return`${seconds} 秒`;const minutes=Math.floor(seconds/60);return minutes<60?`${minutes} 分 ${seconds%60} 秒`:`${Math.floor(minutes/60)} 小时 ${minutes%60} 分`;}
function Questions({requirements,messages,actions}:{requirements:Requirement[];messages:Message[];actions:any}){const[,tick]=useState(0);useEffect(()=>{const id=setInterval(()=>tick(v=>v+1),1000);return()=>clearInterval(id)},[]);return <>{requirements.map((req,index)=>{const done=['completed','accepted','awaiting_acceptance','cancelled'].includes(req.status),responders=[...new Set(messages.filter(message=>message.requirementId===req.id&&['member','coordinator'].includes(message.kind)).map(message=>message.author))];return <article className="task-card question-card" data-status={req.status} key={req.id}>
  <button type="button" className="question-link" onClick={()=>actions.focus(req.id)}><span className="question-number">{requirements.length-index}</span>{req.content.slice(0,120)}</button>
  <div className="question-meta"><span className="question-state">{states[req.status]||'未回复'}</span><span>·</span><time className="question-duration">{elapsed(req.createdAt,done?req.updatedAt:undefined)}</time></div>
  {!!responders.length&&<small className="question-responders">{responders.join('、')}</small>}
  </article>})}</>}
export function installGroupPanels(){const members=document.getElementById('group-members'),questions=document.getElementById('group-tasks');if(!members||!questions)return;members.dataset.reactOwned='true';questions.dataset.reactOwned='true';const memberRoot:Root=createRoot(members),questionRoot:Root=createRoot(questions);window.omegaReactGroupPanels={
  renderMembers:(model,actions)=>memberRoot.render(<Members {...model} actions={actions}/>),
  renderQuestions:(model,actions)=>questionRoot.render(<Questions {...model} actions={actions}/>),
};window.dispatchEvent(new Event('omega:react-group-panels-ready'));}
