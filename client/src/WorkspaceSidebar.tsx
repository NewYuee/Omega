import {createRoot,type Root} from 'react-dom/client';
import {appStore,useAppState} from './AppState.js';

type Thread={id:string;name?:string;preview?:string;unread?:boolean;unreadCount?:number};
type Group={id:string;name:string;memberCount:number;openRequirementCount?:number;status?:string;unread?:boolean;unreadCount?:number};
interface ThreadActions{open(id:string):void;rename(thread:Thread):void;remove(thread:Thread):void}
interface GroupActions{open(id:string):void;status(value?:string):string}
function Icon({kind}:{kind:'edit'|'trash'}){const path=kind==='edit'?'m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5':'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7';return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={path}/></svg>}

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
  const threadHost=document.getElementById('threads'),groupHost=document.getElementById('groups');if(!threadHost||!groupHost)return;
  threadHost.dataset.reactOwned='true';groupHost.dataset.reactOwned='true';
  const threadRoot:Root=createRoot(threadHost),groupRoot:Root=createRoot(groupHost);threadRoot.render(<Threads/>);groupRoot.render(<Groups/>);
  window.omegaReactWorkspace={
    renderThreads:(items,selected,actions)=>appStore.patch({threads:items,threadId:selected,threadActions:actions}),
    renderGroups:(items,selected,actions)=>appStore.patch({groups:items,groupId:selected,groupActions:actions}),
  };
  window.dispatchEvent(new Event('omega:react-workspace-ready'));
}
