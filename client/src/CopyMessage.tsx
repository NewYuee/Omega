import {useState} from 'react';
export async function copyText(text:string){
  try{if(navigator.clipboard){await navigator.clipboard.writeText(text);return}}catch{}
  const focused=document.activeElement as HTMLElement|null,node=document.createElement('textarea');node.value=text;node.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(node);node.select();try{if(!document.execCommand('copy'))throw Error('复制失败，请重试')}finally{node.remove();focused?.focus()}
}
export function CopyMessage({read}:{read():Promise<string>|string}){const[state,setState]=useState('复制全部');return <button type="button" className="copy-message reference-link" disabled={state==='复制中…'} aria-label="复制全部回复" onClick={async()=>{setState('复制中…');try{await copyText(await read());setState('已复制')}catch{setState('复制失败，重试')}}}>{state}</button>}
