import type {FeishuResource} from './feishu-resources.ts';

export type FeishuQuotePart={text:string}|{resourceIndex:number};

// Walk display fields only: callback values, template variables and actions are
// not message text. Never follow URLs or resolve a card through another API.
export function parseFeishuRichQuote(body:Record<string,any>,kind:'post'|'interactive',messageId:string,omitMentions:readonly string[]=[]){
  const parts:FeishuQuotePart[]=[],resources:FeishuResource[]=[];
  let nodes=0,chars=0;
  const add=(text:unknown)=>{
    if(typeof text!=='string')throw Error('引用正文结构无效，请复制原文重新提问');
    chars+=text.length;if(chars>10000)throw Error('引用文本超过 10000 字符，请缩短后重新提问');
    if(text){const last=parts.at(-1);if(last&&'text' in last)last.text+=text;else parts.push({text});}
  };
  const image=(key:unknown)=>{
    if(typeof key!=='string'||!/^img_[\w-]{1,200}$/.test(key))throw Error('引用图片标识无效或不可读取');
    if(resources.length>=20)throw Error('引用附件超过 20 个');
    parts.push({resourceIndex:resources.length});resources.push({messageId,key,kind:'image',name:'引用图片'});
  };
  const walk=(node:any,depth=0):void=>{
    if(++nodes>2000||depth>32)throw Error('引用消息结构过于复杂，请拆分后重新提问');
    if(typeof node==='string'){add(node);return;}
    if(Array.isArray(node)){for(const item of node){walk(item,depth+1);if(Array.isArray(item))add('\n');}return;}
    if(!node||typeof node!=='object')throw Error('引用正文结构无效，请复制原文重新提问');
    const child=(value:any)=>walk(value,depth+1);
    switch(node.tag){
      case 'text':add(node.text);return;
      case 'plain_text':case 'lark_md':case 'markdown':case 'md':add(node.content??node.text);return;
      case 'a':
        if(typeof node.href!=='string'||(node.text!==undefined&&typeof node.text!=='string'))throw Error('引用链接结构无效');
        add(`${node.text||node.href} (${node.href})`);return;
      case 'at':if(!omitMentions.includes(node.user_id))add(`@${node.user_name||node.user_id||'成员'}`);return;
      case 'img':image(node.image_key??node.img_key);return;
      case 'emotion':add(`[表情：${typeof node.emoji_type==='string'?node.emoji_type:'未知'}]`);return;
      case 'code_block':add(node.text??node.content);return;
      case 'hr':add('\n---\n');return;
      case 'br':add('\n');return;
      case 'button':
        add('[按钮：');child(node.text);add(']');
        if(typeof node.url==='string')add(` (${node.url})`);
        return;
      case 'div':case 'note':case 'column_set':case 'column':case 'action':case 'form':case 'collapsible_panel':
        if(node.header?.title){child(node.header.title);add('\n');}
        if(node.text)child(node.text);
        if(node.fields){if(!Array.isArray(node.fields))throw Error('引用卡片字段无效');for(const field of node.fields){child(field.text);add('\n');}}
        for(const key of ['elements','columns','actions'])if(node[key])child(node[key]);
        if(node.extra)child(node.extra);
        add('\n');return;
      default:throw Error('引用包含暂不支持或不完整的富文本／卡片组件，请复制正文或发送截图后重新引用');
    }
  };
  if(kind==='post'){
    const post=Array.isArray(body.content)?body:body.zh_cn??body.en_us??Object.values(body).find(v=>v&&typeof v==='object'&&Array.isArray(v.content));
    if(!post||!Array.isArray(post.content))throw Error('引用富文本正文不可读取，请复制原文重新提问');
    if(post.title){add(post.title);add('\n');}walk(post.content);
  }else{
    const title=body.header?.title??body.title;
    if(title){if(typeof title==='string')add(title);else walk(title);add('\n');}
    const elements=body.body?.elements??body.elements;
    if(!Array.isArray(elements)||!elements.length)throw Error('引用卡片未返回可读取的正文（可能仅有模板或卡片标识），请复制正文或发送截图');
    const start=parts.map(part=>'text' in part?part.text:'[图片]').join('').length;
    // Message-get can return flattened rows, unlike the original card JSON.
    for(const element of elements){walk(element);add('\n');}
    if(!parts.map(part=>'text' in part?part.text:'[图片]').join('').slice(start).trim())throw Error('引用卡片未返回可读取的正文，请复制正文或发送截图');
  }
  const text=parts.map(part=>'text' in part?part.text:'[被引用的图片]').join('');
  if(!text.trim())throw Error('引用消息没有可读取的正文');
  if(text.length>10000)throw Error('引用文本超过 10000 字符，请缩短后重新提问');
  return{text,parts,resources};
}
