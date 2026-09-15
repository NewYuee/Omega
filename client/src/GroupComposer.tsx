import {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {RichPasteEditor,type RichPasteDraft,type RichPasteEditorHandle,type RichPastePayload} from './RichPasteEditor.js';
import type {PastedTextTransport} from './pasted-content.js';

interface Member{name:string;role:string}
interface Reply{taskId:string;name:string}
interface Model{members:Member[];sending:boolean;enabled:boolean;replyTo:Reply|null}
interface Actions extends PastedTextTransport{submit(content:RichPastePayload):Promise<boolean>;cancelReply():void;report(message:string):void}

function SendIcon(){return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 3 18 9-18 9 3-9-3-9ZM6 12h15"/></svg>}

function GroupComposer({model,actions}:{model:Model;actions:Actions}){
  const [draft,setDraft]=useState(''),[expanded,setExpanded]=useState(false),[uploading,setUploading]=useState(false),[beforeCaret,setBeforeCaret]=useState('');
  const prompt=useRef<RichPasteEditorHandle>(null);
  const [collaborationMode,setCollaborationMode]=useState<'direct'|'handoff'|'discussion'>('direct'),[maxRounds,setMaxRounds]=useState(3),[maxMinutes,setMaxMinutes]=useState(0),[maxTokens,setMaxTokens]=useState(0);
  const mention=useMemo(()=>{const at=beforeCaret.lastIndexOf('@');if(at<0||/\n/.test(beforeCaret.slice(at)))return null;const query=beforeCaret.slice(at+1).trim().toLowerCase();return{query,matches:model.members.filter(member=>!query||member.name.toLowerCase().includes(query)).slice(0,8)}},[beforeCaret,model.members]);
  useEffect(()=>{document.body.classList.toggle('group-composer-expanded',expanded);return()=>document.body.classList.remove('group-composer-expanded')},[expanded]);
  useEffect(()=>{const collapse=()=>setExpanded(false);window.addEventListener('omega:group-composer-collapse',collapse);return()=>window.removeEventListener('omega:group-composer-collapse',collapse)},[]);
  useEffect(()=>{const refill=(event:Event)=>{const value=(event as CustomEvent<RichPasteDraft>).detail;prompt.current?.setDraft(value);setDraft(value.text);setExpanded(false)};window.addEventListener('omega:group-composer-refill',refill);return()=>window.removeEventListener('omega:group-composer-refill',refill)},[]);
  useEffect(()=>{if(!expanded)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[expanded]);
  const send=async()=>{const content=prompt.current?.payload();if(!content?.text||uploading||model.sending||!model.enabled)return;if(!Number.isInteger(maxMinutes)||maxMinutes<0||maxMinutes>10080||!Number.isInteger(maxTokens)||maxTokens<0||maxTokens>100000000){actions.report('请输入有效的时间（0–10080 分钟）和 Token（0–100000000）预算');return;}if(collaborationMode!=='direct'&&(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>100)){actions.report('协作轮次请输入 1–100 的整数');return;}try{if(await actions.submit({...content,collaborationMode,maxMinutes,maxTokens,maxRounds:collaborationMode==='direct'?3:maxRounds})){prompt.current?.clear();setDraft('');setExpanded(false);setCollaborationMode('direct')}}catch(error){actions.report(error instanceof Error?error.message:String(error))}};
  const choose=(member:Member)=>{if(!mention)return;for(let index=0;index<mention.query.length+1;index++)document.execCommand('delete',false);prompt.current?.insertText(`@${member.name} `);prompt.current?.focus()};
  return <>
    <div className="group-editor-heading"><h2>编辑群组消息</h2><button type="button" className="secondary" onClick={()=>setExpanded(false)}>收起</button></div>
    {model.replyTo&&<div className="room-reply"><span>回复 {model.replyTo.name}</span><button type="button" onClick={actions.cancelReply}>取消</button></div>}
    <div className="collaboration-options"><label>本次提问 <select aria-label="协作模式" disabled={model.sending} value={collaborationMode} onChange={event=>{const mode=event.target.value as typeof collaborationMode;setCollaborationMode(mode);setMaxRounds(mode==='handoff'?10:3)}}><option value="direct">直接处理</option><option value="handoff">允许交接</option><option value="discussion">讨论（只读）</option></select></label>{collaborationMode!=='direct'&&<label>最多 <input type="number" min={1} max={100} step={1} aria-label="最大协作轮次" disabled={model.sending} value={Number.isNaN(maxRounds)?'':maxRounds} onChange={event=>setMaxRounds(event.target.valueAsNumber)}/> 轮</label>}</div>
    <details className="collaboration-options"><summary>协作预算（可选）</summary><label>总分钟 <input aria-label="总时间预算" type="number" min={0} max={10080} value={Number.isNaN(maxMinutes)?'':maxMinutes} onChange={e=>setMaxMinutes(e.target.valueAsNumber)}/></label><label>总 Token <input aria-label="Token 预算" type="number" min={0} max={100000000} value={Number.isNaN(maxTokens)?'':maxTokens} onChange={e=>setMaxTokens(e.target.valueAsNumber)}/></label><small>0 不限；到限后不再派发下一步，不中断当前执行。Token 依赖实际用量数据。</small></details>
    {mention&&mention.matches.length>0&&<div className="mention-menu">{mention.matches.map(member=><button type="button" className="mention-option" key={member.name} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(member)}>@{member.name} · {member.role}</button>)}</div>}
    <RichPasteEditor ref={prompt} id="group-prompt" label="群组消息" placeholder="在群里提问，输入 @ 可指定成员…" disabled={!model.enabled||model.sending} transport={actions} report={actions.report} onEnter={()=>void send()} onChange={state=>{setDraft(state.text);setUploading(state.uploading);setBeforeCaret(state.textBeforeCaret)}}/>
    <div><button type="button" className="group-expand" onClick={()=>{setExpanded(true);requestAnimationFrame(()=>prompt.current?.focus())}}>全屏编辑</button><span>@成员可直接发送 · Shift+Enter 换行</span><button type="button" id="submit-requirement" disabled={!model.enabled||model.sending||uploading||!draft.trim()} onClick={()=>void send()}><SendIcon/>{uploading?'保存粘贴…':model.sending?'发送中…':'发送'}</button></div>
  </>;
}

export function installGroupComposer(){
  const host=document.getElementById('requirement-form');if(!host)return;
  host.dataset.reactOwned='true';
  const root:Root=createRoot(host);
  window.omegaReactGroupComposer={render:(model,actions)=>root.render(<GroupComposer model={model} actions={actions}/>),focus:()=>requestAnimationFrame(()=>document.getElementById('group-prompt')?.focus()),refill:value=>window.dispatchEvent(new CustomEvent('omega:group-composer-refill',{detail:value})),collapse:()=>{const expanded=document.body.classList.contains('group-composer-expanded');window.dispatchEvent(new Event('omega:group-composer-collapse'));return expanded}};
  window.dispatchEvent(new Event('omega:react-group-composer-ready'));
}
