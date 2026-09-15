import {useEffect,useRef,useState} from 'react';
export async function copyText(text:string){
  try{if(navigator.clipboard){await navigator.clipboard.writeText(text);return}}catch{}
  const focused=document.activeElement as HTMLElement|null,node=document.createElement('textarea');node.value=text;node.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(node);node.select();try{if(!document.execCommand('copy'))throw Error('复制失败，请重试')}finally{node.remove();focused?.focus()}
}
export function CopyMessage({read}:{read():Promise<string>|string}){
  const[state,setState]=useState('idle'),timer=useRef<ReturnType<typeof setTimeout>|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current)}},[]);
  const label=state==='success'?'已复制':state==='busy'?'复制中…':state==='error'?'复制失败，点击重试':'复制完整回复';
  return <button type="button" className="copy-message" data-state={state} disabled={state==='busy'} aria-label={label} title={label} onClick={async()=>{if(timer.current)clearTimeout(timer.current);setState('busy');try{await copyText(await read());if(alive.current){setState('success');timer.current=setTimeout(()=>setState('idle'),2000)}}catch{if(alive.current)setState('error')}}}>
    <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={state==='success'?'m5 12 4 4L19 6':state==='error'?'M12 7v6m0 4h.01M3 3h18v18H3Z':'M9 9h11v12H9ZM5 15H3V3h12v2'}/></svg>
    <span className="copy-status" role="status">{state==='idle'?'':label}</span>
  </button>;
}
