import {useEffect,useRef,useState} from 'react';
import {useAppState} from './AppState.js';

type Row=Record<string,any>;
const api=(data:Row)=>window.omegaProductApi!<any>('projects',data);
const kinds:Record<string,string>={overview:'项目现状',decision:'决策与依据',task:'待办与阻塞',verification:'验证与证据'};
const statuses:Record<string,string>={candidate:'候选 · 尚未确认',confirmed:'已确认',stale:'已失效',superseded:'已被替代'};
const blank=()=>({kind:'overview',status:'candidate',title:'',body:'',source:{type:'manual',target:'',messageId:'',excerpt:''}} as Row);

export function CaptureProject({read,messageId,scope}:{read:()=>string|Promise<string>;messageId:string;scope:'thread'|'group'}){
  const app=useAppState(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const target=scope==='thread'?app.threadId:app.groupId;
  return <><button className="reference-link project-capture-link" title="自动提取未覆盖时，可手动整理到项目" type="button" disabled={busy||!target} onClick={async()=>{setBusy(true);setError('');try{const content=await read();window.dispatchEvent(new CustomEvent('omega:project-capture',{detail:{...blank(),title:content.split('\n').find(Boolean)?.slice(0,160)||'消息记录',body:content.slice(0,16000),source:{type:scope,target,messageId,excerpt:content.slice(0,16000)}}}));}catch{setError('读取原消息失败，请重试');}finally{setBusy(false);}}}>手动记录</button>{error&&<small role="alert">{error}</small>}</>;
}

export function ProjectEntry({open,onOpen,onClose}:{open:boolean;onOpen():void;onClose():void}){
  const app=useAppState(),[draft,setDraft]=useState<Row|null>(null),dialog=useRef<HTMLDialogElement>(null),close=()=>{setDraft(null);onClose()};
  useEffect(()=>{const capture=(event:Event)=>{setDraft((event as CustomEvent).detail);onOpen();};window.addEventListener('omega:project-capture',capture);return()=>window.removeEventListener('omega:project-capture',capture)},[onOpen]);
  useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus()}},[open]);
  return <><button className="work-entry" disabled={!app.authenticated} onClick={onOpen}>项目</button>{open&&<dialog className="work-dialog project-dialog" ref={dialog} aria-label="项目状态" onCancel={e=>{e.preventDefault();close()}}><header><h2>项目状态</h2><button aria-label="关闭项目状态" onClick={close}>×</button></header><ProjectPanel initial={draft} close={close}/></dialog>}</>;
}

function ProjectPanel({initial,close}:{initial:Row|null;close:()=>void}){
  const app=useAppState(),[projects,setProjects]=useState<Row[]>([]),[id,setId]=useState(''),[name,setName]=useState(''),[data,setData]=useState<Row|null>(null),[draft,setDraft]=useState<Row|null>(initial),[history,setHistory]=useState<Row[]>([]),[historyId,setHistoryId]=useState(''),[historyOffset,setHistoryOffset]=useState(0),[skip,setSkip]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[repository,setRepository]=useState('');
  useEffect(()=>{let alive=true;void api({action:'list'}).then(r=>{if(alive)setProjects(r.projects)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[revision]);
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener('omega:project-updated',refresh);return()=>window.removeEventListener('omega:project-updated',refresh)},[]);
  useEffect(()=>setData(null),[id]);
  useEffect(()=>{let alive=true;if(id)void api({action:'read',projectId:id,offset:skip}).then(r=>{if(alive)setData(r)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[id,skip,revision]);
  useEffect(()=>{let alive=true;setHistory([]);if(historyId)void api({action:'history',id:historyId,offset:historyOffset}).then(r=>{if(alive)setHistory(r.items)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[historyId,historyOffset,revision]);
  const run=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();setRevision(v=>v+1)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  const link=(kind:string,target:string,remove=false)=>run(async()=>{await api({action:'link',projectId:id,kind,target,remove});setRepository('')});
  const sourceTarget=(source:Row)=>source.type==='thread'?'原会话':source.type==='group'?'原群组':'人工填写';
  const sourceName=(source:Row)=>source.automatic?`自动提取 · ${sourceTarget(source)}`:sourceTarget(source);
  return <div className="work-body project-body"><p>关联会话的最终回复、关联群组的主持人最终总结会自动形成待确认记录。自动候选会作为明确标注的工作记忆限量提供，确认后才成为稳定项目状态；已确认也不代表已自动测试。</p>
    <div className="work-actions"><select aria-label="选择项目" disabled={busy} value={id} onChange={e=>{setId(e.target.value);setSkip(0);setDraft(initial);setHistoryId('')}}><option value="">选择项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label="新项目名称" maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="新项目名称"/><button disabled={busy||!name.trim()} onClick={()=>void run(async()=>{const p=await api({action:'create',name});setId(p.id);setName('');setSkip(0)})}>创建项目</button></div>
    <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>刷新记录</button>
    {error&&<p role="alert">{error}</p>}
    {data&&<><details><summary>关联仓库、会话与群组（{data.links.length}）</summary><p>关联群组后，新成员在下一次调度时自动收到项目状态。仓库路径只是元数据，不授予读写权限。</p><div className="work-actions"><button disabled={busy||!app.threadId||app.mode!=='chats'} onClick={()=>void link('thread',app.threadId!)}>关联当前会话</button><button disabled={busy||!app.groupId||app.mode!=='groups'} onClick={()=>void link('group',app.groupId!)}>关联当前群组</button><input aria-label="仓库路径或地址" maxLength={1000} value={repository} onChange={e=>setRepository(e.target.value)} placeholder="仓库路径或地址"/><button disabled={busy||!repository.trim()} onClick={()=>void link('repository',repository)}>添加仓库</button></div>{data.links.map((l:Row)=><div className="project-link" key={l.kind+l.target}><span>{l.kind} · {app.threads.find(t=>t.id===l.target)?.name||app.groups.find(g=>g.id===l.target)?.name||l.target}</span><button disabled={busy} onClick={()=>void link(l.kind,l.target,true)}>解除关联</button></div>)}</details>
      <button disabled={busy} onClick={()=>{setDraft(blank());setHistoryId('')}}>新增记录</button>
      {draft&&<form className="project-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api({...draft,action:'save',projectId:id});setDraft(null)})}}><h3>{draft.id?'纠正记录':'整理候选记录'}</h3><p>请整理成明确的现状、依据、下一步或测试范围；消息只作为来源摘录，不自动认定为事实。</p><label>类别<select aria-label="类别" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value})}>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>标题<input required maxLength={160} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>内容<textarea required maxLength={16000} rows={6} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} placeholder="当前版本/现状；决策及依据；未完成事项、阻塞原因和下一步；验证命令、结果与未覆盖范围"/></label><label>状态<select aria-label="记录状态" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>{sourceName(draft.source)} · 证据摘录<textarea rows={4} maxLength={16000} value={draft.source.excerpt} onChange={e=>setDraft({...draft,source:{...draft.source,excerpt:e.target.value}})}/></label><small>来源摘录是操作者保存的副本，不是系统认证的测试结果。版本历史保留每次改动。</small><div className="work-actions"><button disabled={busy}>{draft.status==='confirmed'?'确认并保存':'保存记录'}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>取消编辑</button></div></form>}
      <div className="project-records">{data.items.map((r:Row)=><article className="work-card" key={r.id}><small>{kinds[r.kind]} · {statuses[r.status]} · v{r.revision}</small><h3>{r.title}</h3><p className="project-text">{r.body}</p><small>{r.updated_at}</small><div className="work-actions"><button disabled={busy} onClick={()=>{setDraft(r);setHistoryId('')}}>纠正 / 更新状态</button><button onClick={()=>{setHistoryId(r.id);setHistoryOffset(0)}}>修改历史</button>{r.source.type!=='manual'&&<button onClick={()=>void run(async()=>{if(r.source.type==='thread')await window.omegaNavigation?.openThread(r.source.target);else await app.groupActions?.open(r.source.target);close()})}>打开{sourceTarget(r.source)}</button>}</div><details><summary>来源与证据</summary><small>{sourceName(r.source)} · {r.source.target} {r.source.messageId}</small><pre>{r.source.excerpt||'人工记录，无外部证据'}</pre></details></article>)}</div>
      {!data.items.length&&<p>还没有项目记录。关联会话或群组后，符合条件的最终回复会自动生成候选；也可以手动新增。</p>}
      <div className="work-actions"><button disabled={skip===0} onClick={()=>setSkip(Math.max(0,skip-30))}>上一页</button><span>共 {data.total} 条</span><button disabled={skip+30>=data.total} onClick={()=>setSkip(skip+30)}>下一页</button></div>
      {historyId&&<section aria-label="记录修改历史"><h3>修改历史</h3>{history.map(r=><details key={r.revision}><summary>v{r.revision} · {r.actor} · {r.created_at}</summary><p>{statuses[r.snapshot.status]} · {r.snapshot.title}</p><pre>{r.snapshot.body}</pre><pre>{r.snapshot.source.excerpt}</pre></details>)}<button disabled={!historyOffset} onClick={()=>setHistoryOffset(Math.max(0,historyOffset-30))}>较新版本</button><button disabled={history.length<30} onClick={()=>setHistoryOffset(historyOffset+30)}>更早版本</button></section>}
    </>}
    {!id&&draft&&<p>已保留消息草稿，请先选择或创建项目。</p>}
  </div>;
}
