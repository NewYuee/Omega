import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pastedTextError} from './pasted-content.ts';

export const MAX_DOCUMENT_BYTES=10*1024*1024;
let running=0;
export function documentType(name:string){
  const extension=name.split('.').at(-1)?.toLowerCase();
  if(!extension||!['pdf','docx','xlsx','pptx'].includes(extension))throw pastedTextError('仅支持 PDF、DOCX、XLSX、PPTX；旧版 DOC/XLS/PPT 请先另存为新版格式',415);
  return extension;
}
export async function importDocument(name:string,read:()=>Promise<Buffer>):Promise<string>{
  const type=documentType(name);
  if(running>=2)throw pastedTextError('文档解析繁忙，请稍后重试',429);
  running++;
  try{
    const data=await read();
    if(!data.length||data.length>MAX_DOCUMENT_BYTES)throw pastedTextError('文档不能为空，且每个不得超过 10 MB',413);
    if(type==='pdf'?!data.subarray(0,5).equals(Buffer.from('%PDF-')):data.length<4||data.readUInt32LE(0)!==0x04034b50)throw pastedTextError('文件内容与扩展名不匹配',415);
    const text=await new Promise<string>((resolve,reject)=>{
      const child=fork(fileURLToPath(new URL('./document-worker.mjs',import.meta.url)),[],{execArgv:['--max-old-space-size=192'],stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});
      let settled=false;
      const finish=(error:Error|null,text='')=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');error?reject(error):resolve(text);};
      const timer=setTimeout(()=>finish(pastedTextError('文档解析超时，请拆分文档后重试',422)),20000);
      child.on('error',()=>finish(pastedTextError('无法启动文档解析进程',503)));
      child.on('exit',()=>finish(pastedTextError('文档解析失败或超出资源限制，请另存或拆分后重试',422)));
      child.on('message',(message:any)=>{
        if(message?.error)return finish(pastedTextError(String(message.error),422));
        if(typeof message?.text!=='string'||!message.text.trim())return finish(pastedTextError('未提取到文字；扫描版 PDF 或纯图片文档请先进行 OCR',422));
        if(Buffer.byteLength(message.text)>500*1024)return finish(pastedTextError('提取文字超过 500 KB，请拆分文档后重试',413));
        finish(null,message.text);
      });
      child.send({data,type},error=>{if(error)finish(pastedTextError('文档解析进程通信失败',503));});
    });
    const safeName=name.replace(/[\u0000-\u001f]/g,' ').slice(0,200);
    return `附件文件名：${safeName}\n提取说明：仅提取可读取的文字及表格内容，不包含图片、OCR 或完整排版；公式不重新计算。\n\n${text}`;
  }finally{running--;}
}
