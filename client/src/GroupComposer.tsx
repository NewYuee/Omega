import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';

interface Member{name:string;role:string}
interface Reply{taskId:string;name:string}
interface Model{members:Member[];sending:boolean;enabled:boolean;replyTo:Reply|null}
interface Actions{submit(content:string):Promise<boolean>;cancelReply():void;report(message:string):void}

function SendIcon(){return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 3 18 9-18 9 3-9-3-9ZM6 12h15"/></svg>}

function GroupComposer({model,actions}:{model:Model;actions:Actions}){
  const [draft,setDraft]=useState(''),[expanded,setExpanded]=useState(false);
  const [caret,setCaret]=useState(0);
  const prompt=useRef<HTMLTextAreaElement>(null);
  const mention=useMemo(()=>{const position=Math.min(caret,draft.length),before=draft.slice(0,position),at=before.lastIndexOf('@');if(at<0||/\n/.test(before.slice(at)))return null;const query=before.slice(at+1).trim().toLowerCase();return{at,caret:position,matches:model.members.filter(member=>!query||member.name.toLowerCase().includes(query)).slice(0,8)}},[caret,draft,model.members]);
  useLayoutEffect(()=>{const field=prompt.current;if(!field)return;if(expanded){field.style.height='';field.style.overflowY='auto';return}field.style.height='0px';field.style.height=Math.max(38,Math.min(field.scrollHeight,120))+'px';field.style.overflowY=field.scrollHeight>120?'auto':'hidden'},[draft,expanded]);
  useEffect(()=>{document.body.classList.toggle('group-composer-expanded',expanded);return()=>document.body.classList.remove('group-composer-expanded')},[expanded]);
  useEffect(()=>{const collapse=()=>setExpanded(false);window.addEventListener('omega:group-composer-collapse',collapse);return()=>window.removeEventListener('omega:group-composer-collapse',collapse)},[]);
  useEffect(()=>{if(!expanded)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[expanded]);
  const send=async()=>{const content=draft.trim();if(!content||model.sending||!model.enabled)return;try{if(await actions.submit(content)){setDraft('');setExpanded(false)}}catch(error){actions.report(error instanceof Error?error.message:String(error))}};
  const choose=(member:Member)=>{const field=prompt.current;if(!field||!mention)return;const value=draft.slice(0,mention.at)+`@${member.name} `+draft.slice(mention.caret);const caret=mention.at+member.name.length+2;setDraft(value);requestAnimationFrame(()=>{field.focus();field.setSelectionRange(caret,caret)})};
  return <>
    <div className="group-editor-heading"><h2>编辑群组消息</h2><button type="button" className="secondary" onClick={()=>setExpanded(false)}>收起</button></div>
    {model.replyTo&&<div className="room-reply"><span>回复 {model.replyTo.name}</span><button type="button" onClick={actions.cancelReply}>取消</button></div>}
    {mention&&mention.matches.length>0&&<div className="mention-menu">{mention.matches.map(member=><button type="button" className="mention-option" key={member.name} onClick={()=>choose(member)}>@{member.name} · {member.role}</button>)}</div>}
    <textarea ref={prompt} id="group-prompt" rows={2} maxLength={12000} placeholder="在群里提问，输入 @ 可指定成员…" required value={draft} disabled={!model.enabled||model.sending} onChange={event=>{setDraft(event.target.value);setCaret(event.target.selectionStart)}} onSelect={event=>setCaret(event.currentTarget.selectionStart)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send()}}}/>
    <div><button type="button" className="group-expand" onClick={()=>{setExpanded(true);requestAnimationFrame(()=>prompt.current?.focus())}}>全屏编辑</button><span>@成员可直接发送 · Shift+Enter 换行</span><button type="button" id="submit-requirement" disabled={!model.enabled||model.sending||!draft.trim()} onClick={()=>void send()}><SendIcon/>{model.sending?'发送中…':'发送'}</button></div>
  </>;
}

export function installGroupComposer(){
  const host=document.getElementById('requirement-form');if(!host)return;
  host.dataset.reactOwned='true';
  const root:Root=createRoot(host);
  window.omegaReactGroupComposer={render:(model,actions)=>root.render(<GroupComposer model={model} actions={actions}/>),focus:()=>requestAnimationFrame(()=>document.getElementById('group-prompt')?.focus()),collapse:()=>{const expanded=document.body.classList.contains('group-composer-expanded');window.dispatchEvent(new Event('omega:group-composer-collapse'));return expanded}};
  window.dispatchEvent(new Event('omega:react-group-composer-ready'));
}
