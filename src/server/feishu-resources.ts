import type {Readable} from 'node:stream';
import {ImageStore,MAX_IMAGE_BYTES} from './images.ts';
import {PastedTextStore} from './pasted-content.ts';
import {importDocument,MAX_DOCUMENT_BYTES} from './document-import.ts';
import {decodeTextFile,isDocument,validateAttachmentFile,TEXT_FILE_LIMIT} from '../shared/text-files.ts';

export type FeishuResource={messageId:string;key:string;kind:'image'|'file';name:string};
export type FeishuAttachment={kind:'image'|'file';id:string;name:string;chars?:number;textBytes:number;downloadBytes:number};
export type FeishuResourceImporter=(resource:FeishuResource,remainingBytes:number)=>Promise<FeishuAttachment>;
type ResourceResponse={getReadableStream:()=>Readable;headers?:Record<string,unknown>};

// Read only a bounded stream. Never use SDK writeFile with a remotely supplied filename.
export async function downloadFeishuResource(request:()=>Promise<ResourceResponse>,limit:number,timeoutMs=15000):Promise<Buffer>{
  let stream:Readable|undefined,expired=false;let timer:NodeJS.Timeout|undefined;
  const reading=(async()=>{
    let response:ResourceResponse;try{response=await request();stream=response.getReadableStream();}catch{throw Error('附件下载失败，请检查读取消息权限和附件是否可访问');}
    if(expired){stream.destroy();throw Error('附件下载超时');}
    try{
      const length=Number(response.headers?.['content-length']);
      if(Number.isFinite(length)&&length>limit)throw Error('附件大小超过当前下载限制');
      if(String(response.headers?.['content-type']||'').includes('application/json'))throw Error('飞书未返回附件数据，请核对权限');
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of stream){const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=data.length;if(size>limit)throw Error('附件大小超过当前下载限制');chunks.push(data);}
      if(!size||Number.isFinite(length)&&length>0&&size!==length)throw Error('附件为空或下载不完整');
      return Buffer.concat(chunks,size);
    }catch(error){if(error instanceof Error&&['附件大小超过当前下载限制','飞书未返回附件数据，请核对权限','附件为空或下载不完整'].includes(error.message))throw error;throw Error('附件下载中断，请重新提问');}
    finally{stream.destroy();}
  })();
  try{return await Promise.race([reading,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;stream?.destroy();reject(Error('附件下载超时，请重新提问'));},timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}

export function feishuResourceImporter(images:ImageStore,pastes:PastedTextStore,download:(resource:FeishuResource,limit:number)=>Promise<Buffer>):FeishuResourceImporter{
  return async(resource,remainingBytes)=>{
    if(!/^om_[\w-]{1,100}$/.test(resource.messageId)||!(resource.kind==='image'?/^img_[\w-]{1,200}$/:/^file_[\w-]{1,200}$/).test(resource.key))throw Error('飞书附件标识无效');
    const name=resource.name.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,200);
    if(resource.kind==='file')validateAttachmentFile({name,size:1});
    const max=resource.kind==='image'?MAX_IMAGE_BYTES:isDocument({name})?MAX_DOCUMENT_BYTES:TEXT_FILE_LIMIT;
    if(remainingBytes<=0)throw Error('引用附件合计超过 32 MB');
    const data=await download(resource,Math.min(max,remainingBytes));
    if(!data.length||data.length>max||data.length>remainingBytes)throw Error('附件大小超过限制');
    if(resource.kind==='image'){
      const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216?'image/jpeg':data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'?'image/webp':'';
      if(!mime)throw Error('引用图片仅支持 PNG、JPEG、WebP');
      const ref=await images.upload(data,mime);return{kind:'image',id:ref.id,name:name||'引用图片',textBytes:0,downloadBytes:data.length};
    }
    const text=isDocument({name})?await importDocument(name,async()=>data):decodeTextFile(name,data);
    const ref=await pastes.upload(Buffer.from(text));return{kind:'file',id:ref.id,name,chars:ref.chars,textBytes:ref.bytes,downloadBytes:data.length};
  };
}
