import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {appStore,useAppState} from './AppState.js';

type Thread={id:string;name?:string;preview?:string;unread?:boolean;unreadCount?:number};
type Group={id:string;name:string;memberCount:number;openRequirementCount?:number;status?:string;unread?:boolean;unreadCount?:number};
interface ThreadActions{open(id:string):void;rename(thread:Thread):void;remove(thread:Thread):void}
interface GroupActions{open(id:string):void;status(value?:string):string}
function Icon({kind}:{kind:'edit'|'trash'|'close'}){const path=kind==='edit'?'m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5':kind==='trash'?'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7':'m6 6 12 12M6 18 18 6';return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={path}/></svg>}

function Threads(){const state=useAppState(),items=state.threads as Thread[],selected=state.threadId,actions=state.threadActions as unknown as ThreadActions;if(!actions)return null;
  return <>{items.map(thread=>{const name=thread.name||thread.preview||'新会话';return <div className={`thread-row${thread.id===selected?' selected':''}`} data-thread-id={thread.id} key={thread.id}>
    <button className="thread-open" title={name} onClick={()=>actions.open(thread.id)}><span className="sidebar-label">{name}</span>{thread.unread&&<span className="unread-dot" aria-label={`${thread.unreadCount||1} 条未读回复`}>{Math.min(thread.unreadCount||1,99)}{(thread.unreadCount||1)>99?'＋':''}</span>}</button>
    <button type="button" className="thread-rename" title="重命名" aria-label={`重命名 ${name}`} onClick={()=>actions.rename(thread)}><Icon kind="edit"/></button>
    <button type="button" className="thread-delete" title="删除会话" aria-label={`删除 ${name}`} onClick={()=>actions.remove(thread)}><Icon kind="trash"/></button>
  </div>;})}</>;
}

function Groups(){const state=useAppState(),items=state.groups as Group[],selected=state.groupId,actions=state.groupActions as unknown as GroupActions;if(!actions)return null;
  return <>{items.map(group=><button type="button" className={`group-row${group.id===selected?' selected':''}`} onClick={()=>actions.open(group.id)} key={group.id}>
    <strong><span className="sidebar-label">{group.name}</span>{group.unread&&<span className="unread-dot" aria-label={`${group.unreadCount||1} 条未读回复`}>{Math.min(group.unreadCount||1,99)}{(group.unreadCount||1)>99?'＋':''}</span>}</strong><small>{group.memberCount} 位成员 · {group.openRequirementCount||0} 个进行中 · {actions.status(group.status)}</small>
  </button>)}</>;
}

export function installWorkspaceSidebar(){
  const host=document.getElementById('sidebar');if(!host)return;
  const anchor=document.createComment('react-sidebar');host.before(anchor);
  host.dataset.reactOwned='true';createRoot(host).render(<WorkspaceSidebar/>);
  window.omegaReactWorkspace={
    renderThreads:(items,selected,actions)=>appStore.patch({threads:items,threadId:selected,threadActions:actions}),
    renderGroups:(items,selected,actions)=>appStore.patch({groups:items,groupId:selected,groupActions:actions}),
    closeSidebar:()=>window.dispatchEvent(new Event('omega:close-sidebar')),
  };
  window.omegaSidebarMount={host,anchor};
  window.dispatchEvent(new Event('omega:react-workspace-ready'));
}

function savedCollapsed(){try{return localStorage.getItem('omega-sidebar-collapsed')==='1'}catch{return false}}
function WorkspaceSidebar(){const state=useAppState(),group=state.mode==='groups',actions=state.shellActions,[mobile,setMobile]=useState(()=>matchMedia('(max-width:700px)').matches),[drawerOpen,setDrawerOpen]=useState(false),[collapsed,setCollapsed]=useState(savedCollapsed);
  useEffect(()=>{document.body.classList.toggle('group-mode',group);const view=document.getElementById('group-view');if(view)view.hidden=!group},[group]);
  useEffect(()=>{const query=matchMedia('(max-width:700px)'),change=()=>{setMobile(query.matches);setDrawerOpen(false)};query.addEventListener('change',change);const close=()=>setDrawerOpen(false);window.addEventListener('omega:close-sidebar',close);return()=>{query.removeEventListener('change',change);window.removeEventListener('omega:close-sidebar',close)}},[]);
  useEffect(()=>{const mount=window.omegaSidebarMount,drawer=document.getElementById('conversation-drawer') as HTMLDialogElement|null,menu=document.getElementById('menu-toggle');if(!mount||!drawer||!menu)return;const restore=()=>{mount.anchor.after(mount.host)};const toggle=()=>{if(mobile)setDrawerOpen(value=>!value);else setCollapsed(value=>{const next=!value;try{localStorage.setItem('omega-sidebar-collapsed',next?'1':'0')}catch{}return next})};const cancel=(event:Event)=>{event.preventDefault();setDrawerOpen(false)},backdrop=(event:MouseEvent)=>{if(event.target===drawer)setDrawerOpen(false)};menu.addEventListener('click',toggle);drawer.addEventListener('cancel',cancel);drawer.addEventListener('click',backdrop);document.body.classList.toggle('sidebar-collapsed',!mobile&&collapsed);if(mobile&&drawerOpen){drawer.append(mount.host);if(!drawer.open)drawer.showModal()}else{if(drawer.open)drawer.close();restore()}menu.setAttribute('aria-controls',mobile?'conversation-drawer':'sidebar');menu.setAttribute('aria-expanded',String(mobile?drawerOpen:!collapsed));const label=mobile?(drawerOpen?'关闭列表':'打开列表'):(collapsed?'展开侧栏':'收起侧栏');menu.setAttribute('aria-label',label);menu.title=label;return()=>{menu.removeEventListener('click',toggle);drawer.removeEventListener('cancel',cancel);drawer.removeEventListener('click',backdrop)}},[mobile,drawerOpen,collapsed]);
  return <>
  <button id="drawer-close" type="button" className="mobile-only icon-button" aria-label="关闭列表" onClick={()=>setDrawerOpen(false)}><Icon kind="close"/></button>
  <a className="brand" href="/">Ω <span>OMEGA<small>PERSONAL WORKSPACE</small></span></a>
  <div className="side-tabs" role="tablist" aria-label="工作区类型">
    <button id="show-chats" className={!group?'selected':''} type="button" role="tab" aria-selected={!group} onClick={()=>actions?.switchMode('chats')}>会话</button>
    <button id="show-groups" className={group?'selected':''} type="button" role="tab" aria-selected={group} onClick={()=>actions?.switchMode('groups')}>群组</button>
  </div>
  <button id={group?'new-group':'new'} type="button" onClick={()=>actions?.newAction()}>＋ {group?'新建群组':'新建会话'}</button>
  <div className="caption">{group?'协作空间':'你的工作'}</div>
  <nav id={group?'groups':'threads'} data-react-owned="true" aria-label={group?'群组列表':'会话列表'}>{group?<Groups/>:<Threads/>}</nav>
  <footer><span id="connection" className={state.connected?'connected':''}><i className="connection-light" aria-hidden/>{state.connectionLabel}</span><button id="settings" type="button" onClick={()=>actions?.openSettings()}>连接设置</button></footer>
  </>}
