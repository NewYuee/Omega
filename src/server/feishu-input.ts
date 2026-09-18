import {imageMarker} from '../shared/inline-images.ts';
import {parseFeishuRichQuote} from './feishu-rich-quotes.ts';
import type {FeishuQuote} from './feishu-quotes.ts';

export function parseFeishuPostInput(content:unknown,messageId:string,botId:string,botKeys:string[]):FeishuQuote{
  if(typeof content!=='string'||Buffer.byteLength(content)>512*1024)throw Error('图文消息超过 512 KB 或结构无效');
  let body;try{body=JSON.parse(content);}catch{throw Error('图文消息内容无法解析');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('图文消息结构无效');
  const rich=parseFeishuRichQuote(body,'post',messageId,[botId,...botKeys]);
  for(const part of rich.parts)if('text' in part)for(const key of botKeys)part.text=part.text.replaceAll(key,'');
  // Summary/mode detection excludes image placeholders; the model gets ordered parts.
  const text=rich.parts.map(p=>'text' in p?p.text:'').join('').trim();
  if(!text&&!rich.resources.length)throw Error('请在 @机器人后补充问题或图片');
  return{...rich,text:text||'请查看图片',messageId,authorId:'当前提问者',authorType:'user'};
}

export function renderFeishuPostInput(input:FeishuQuote,mode:string){
  let commandRemoved=false;
  return(input.parts||[]).map(part=>{
    if('text' in part){
      let text=part.text;
      if(!commandRemoved&&text.trim()){
        commandRemoved=true;
        if(mode!=='direct')text=text.replace(/^\s*\/(讨论|交接)\s+/,'');
      }
      return text;
    }
    const image=input.attachments?.[part.resourceIndex];
    if(!image||image.kind!=='image')throw Error('图文消息图片缓存不完整，请重新发送');
    return imageMarker(image.id);
  }).join('').trim();
}
