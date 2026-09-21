import type {MouseEvent} from 'react';
import {copyText} from './CopyMessage.js';

// Markdown is rendered as sanitized HTML, so React delegates clicks from its host.
export async function copyCodeBlock(event:MouseEvent<HTMLDivElement>){
  const button=(event.target as Element).closest<HTMLButtonElement>('.react-code-copy');
  if(!button||!event.currentTarget.contains(button)||button.disabled)return;
  const code=button.closest('.code-block')?.querySelector('code');
  if(!code)return;
  button.disabled=true;
  try{
    await copyText(code.textContent||'');
    button.textContent='已复制';
    button.setAttribute('aria-label','代码已复制');
  }catch{
    button.textContent='复制失败，请选中代码复制';
    button.setAttribute('aria-label','复制失败，请选中代码复制');
  }finally{button.disabled=false;}
}
