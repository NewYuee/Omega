import {useEffect,useMemo,useRef,useState} from 'react';
import {useAppState} from './AppState.js';
import {PaletteTrigger} from './PaletteTrigger.js';

type Command={id:string;label:string;hint:string;run:()=>void};
type SearchResult={scope:'thread'|'group';id:string;anchor?:string|null;title:string;snippet:string};
const click=(selector:string)=>(document.querySelector<HTMLElement>(selector)?.click());

export function CommandPalette(){
  const app=useAppState(),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[remote,setRemote]=useState<SearchResult[]>([]),[searching,setSearching]=useState(false);const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setOpen(value=>!value);}if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{if(open)requestAnimationFrame(()=>input.current?.focus());else setQuery('');},[open]);
  useEffect(()=>{const value=query.trim();if(!open||value.length<2||!window.omegaProductApi){setRemote([]);setSearching(false);return;}let cancelled=false;setSearching(true);const timer=setTimeout(()=>{window.omegaProductApi?.<{results:SearchResult[]}>(`search?q=${encodeURIComponent(value)}`).then(result=>{if(!cancelled)setRemote(result.results||[])}).catch(()=>{if(!cancelled)setRemote([])}).finally(()=>{if(!cancelled)setSearching(false)});},220);return()=>{cancelled=true;clearTimeout(timer)}},[open,query]);
  const commands=useMemo<Command[]>(()=>{
    const fixed:Command[]=[
      {id:'new-chat',label:'新建会话',hint:'操作',run:()=>click('#new')},
      {id:'new-group',label:'新建群组',hint:'操作',run:()=>{click('#show-groups');setTimeout(()=>click('#new-group'),0);}},
      {id:'chats',label:'打开会话列表',hint:'导航',run:()=>click('#show-chats')},
      {id:'groups',label:'打开群组列表',hint:'导航',run:()=>click('#show-groups')},
      {id:'settings',label:'连接与访问密钥设置',hint:'设置',run:()=>click('#settings')},
      {id:'control-center',label:'工作控制中心',hint:'自动化 · 插件 · 电脑',run:()=>window.dispatchEvent(new Event('omega:open-control-center'))},
      {id:'sidebar',label:'展开或收起侧栏',hint:'界面',run:()=>click('#menu-toggle')},
      {id:'latest',label:'回到最新消息',hint:'会话',run:()=>click('#jump-latest')}
    ];
    if(window.omegaDesktop)fixed.push({id:'desktop-server',label:'切换桌面端服务器',hint:'桌面',run:()=>{void window.omegaDesktop?.showSetup();}});
    const rows=[...app.threads.map(item=>({id:`thread:${item.id}`,label:String(item.name||item.preview||'新会话'),hint:item.unreadCount?`会话 · ${item.unreadCount} 条未读`:'会话',run:()=>app.threadActions?.open(item.id)})),...app.groups.map(item=>({id:`group:${item.id}`,label:String(item.name||'群组'),hint:item.unreadCount?`群组 · ${item.unreadCount} 条未读`:'群组',run:()=>app.groupActions?.open(item.id)}))];
    return [...fixed,...rows];
  },[app]);
  const remoteCommands:Command[]=remote.map((result,index)=>({id:`search:${result.scope}:${result.id}:${result.anchor||index}`,label:result.title,hint:`${result.scope==='thread'?'会话内容':'群组消息'} · ${result.snippet}`,run:()=>result.scope==='thread'?void window.omegaNavigation?.openThread(result.id,result.anchor):void app.groupActions?.open(result.id)}));
  const shown=[...commands.filter(command=>(command.label+' '+command.hint).toLowerCase().includes(query.trim().toLowerCase())),...remoteCommands].filter((command,index,array)=>array.findIndex(item=>item.id===command.id)===index).slice(0,40);
  if(!open)return <PaletteTrigger onOpen={()=>setOpen(true)}/>;
  const choose=(command:Command)=>{setOpen(false);command.run();};
  return <div className="omega-palette-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}><section className="omega-palette" role="dialog" aria-modal="true" aria-label="搜索与命令"><div className="omega-palette-search"><span>⌕</span><input ref={input} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索会话、群组、消息或命令" onKeyDown={event=>{if(event.key==='Enter'&&shown[0])choose(shown[0]);}}/><kbd>Esc</kbd></div><div className="omega-palette-results">{shown.map(command=><button key={command.id} type="button" onClick={()=>choose(command)}><span>{command.label}</span><small>{command.hint}</small></button>)}{searching&&<p>正在搜索消息…</p>}{!shown.length&&!searching&&<p>没有匹配结果</p>}</div></section></div>;
}
