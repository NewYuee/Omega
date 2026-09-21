import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';

type Group={chatId:string;name:string};
type Member={openId:string;name:string};
type Request={text:string;format:'text'|'card';title:string;source:string;resolve:(sent:boolean)=>void};
const submissionId=()=>{if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`};

function Dialog({request,close}:{request:Request;close:(sent:boolean)=>void}){
  const dialog=useRef<HTMLDialogElement>(null),submission=useRef(submissionId()),[groups,setGroups]=useState<Group[]>([]),[chatId,setChatId]=useState(''),[members,setMembers]=useState<Member[]>([]),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState(''),[text,setText]=useState(request.text),[format,setFormat]=useState(request.format),[title,setTitle]=useState(request.title),[busy,setBusy]=useState(false),[error,setError]=useState(''),[membersLoading,setMembersLoading]=useState(false);
  const api=window.omegaProductApi!;
  useEffect(()=>{dialog.current?.showModal();void api<{groups:Group[]}>('feishu/notify/groups').then(value=>{setGroups(value.groups);setChatId(value.groups[0]?.chatId||'');if(!value.groups.length)setError('没有可通知的已绑定飞书群');},cause=>setError(cause instanceof Error?cause.message:String(cause)));},[]);
  useEffect(()=>{setMembers([]);setSelected([]);setSearch('');setError('');if(!chatId)return;let active=true;setMembersLoading(true);void api<{members:Member[]}>(`feishu/notify/members?chatId=${encodeURIComponent(chatId)}`).then(value=>{if(active)setMembers(value.members)},cause=>{if(active)setError(cause instanceof Error?cause.message:String(cause))}).finally(()=>{if(active)setMembersLoading(false)});return()=>{active=false}},[chatId]);
  const send=async(event:React.FormEvent)=>{event.preventDefault();if(!chatId||!selected.length||!text.trim())return;setBusy(true);setError('');try{await api('feishu/notify',{chatId,memberOpenIds:selected,text:text.trim(),format,title:title.trim(),source:request.source,submissionId:submission.current});close(true);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));setBusy(false)}};
  const shown=members.filter(member=>!search||`${member.name} ${member.openId}`.toLowerCase().includes(search.toLowerCase()));
  return <dialog ref={dialog} className="react-form-dialog feishu-notify-dialog" aria-label="发送飞书通知" onCancel={event=>{event.preventDefault();if(!busy)close(false)}}><form onSubmit={send}>
    <h2>发送飞书通知</h2><p>目标与当前 Omega 会话无关。请明确选择飞书群和成员，机器人将主动发送并原生 @ 对方。</p>
    <label>发送形式<select value={format} disabled={busy} onChange={event=>setFormat(event.target.value as 'text'|'card')}><option value="card">卡片（适合结论与讨论结果）</option><option value="text">纯文本</option></select></label>
    {format==='card'&&<label>卡片标题<input maxLength={80} required disabled={busy} value={title} onChange={event=>setTitle(event.target.value)} placeholder="例如：讨论结论"/></label>}
    <label>目标飞书群<select value={chatId} required disabled={busy} onChange={event=>{setError('');setChatId(event.target.value)}}><option value="">请选择群</option>{groups.map(group=><option key={group.chatId} value={group.chatId}>{group.name} · {group.chatId.slice(-8)}</option>)}</select></label>
    {chatId&&<><label>搜索群成员<input type="search" value={search} disabled={busy||membersLoading} onChange={event=>setSearch(event.target.value)} placeholder="姓名或 open_id"/></label><fieldset className="feishu-notify-members"><legend>提醒成员（1–20 人）</legend>{shown.map(member=><label key={member.openId}><input type="checkbox" checked={selected.includes(member.openId)} disabled={busy||!selected.includes(member.openId)&&selected.length>=20} onChange={event=>setSelected(items=>event.target.checked?[...items,member.openId]:items.filter(id=>id!==member.openId))}/><span>{member.name}</span><small>{member.openId}</small></label>)}{!shown.length&&<p>{membersLoading?'正在读取成员…':members.length?'没有匹配成员':'没有可见成员'}</p>}</fieldset></>}
    <label>通知内容<textarea rows={6} maxLength={4000} required disabled={busy} value={text} onChange={event=>setText(event.target.value)} placeholder="输入需要机器人发送的内容…"/></label>
    {error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>close(false)}>取消</button><button type="submit" disabled={busy||!chatId||!selected.length||!text.trim()}>{busy?'正在发送…':`发送并 @ ${selected.length} 人`}</button></div>
  </form></dialog>;
}

function Layer(){
  const[request,setRequest]=useState<Request|null>(null);
  useEffect(()=>{window.omegaFeishuNotify={open:(text='',options={})=>new Promise(resolve=>setRequest({text,format:options.format||'card',title:options.title||'Omega 消息通知',source:options.source||'来自 Omega',resolve}))};window.dispatchEvent(new Event('omega:feishu-notify-ready'));return()=>{delete window.omegaFeishuNotify}},[]);
  const close=(sent:boolean)=>{request?.resolve(sent);setRequest(null)};
  return request?<Dialog key={String(request)} request={request} close={close}/>:null;
}
export function installFeishuNotifyDialog(){const host=document.createElement('div');host.id='omega-feishu-notify-layer';document.body.append(host);createRoot(host).render(<Layer/>)}
