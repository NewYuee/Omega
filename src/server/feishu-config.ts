import {readFile} from 'node:fs/promises';
export type FeishuBinding={chatId:string;chatType:'group'|'p2p';userIds:string[];allowAllMembers?:boolean;target:{kind:'group'|'thread';id:string}};
export function feishuUserAllowed(binding:FeishuBinding,user:unknown){return typeof user==='string'&&/^ou_[\w-]+$/.test(user)&&((binding.chatType==='group'&&binding.allowAllMembers===true)||binding.userIds.includes(user));}
export type FeishuConfig={enabled:boolean;appId:string;appSecret:string;botOpenId:string;bindings:FeishuBinding[];omegaUrl?:string};
export function parseFeishuConfig(value:any,env:NodeJS.ProcessEnv=process.env):FeishuConfig{
  if(value?.enabled!==true)return{enabled:false,appId:'',appSecret:'',botOpenId:'',bindings:[]};
  const appId=env.OMEGA_FEISHU_APP_ID||'',appSecret=env.OMEGA_FEISHU_APP_SECRET||'';
  if(!/^cli_[a-f\d]{16}$/i.test(appId)||!appSecret)throw Error('飞书连接器需要有效的 OMEGA_FEISHU_APP_ID / OMEGA_FEISHU_APP_SECRET');
  if(!/^ou_[\w-]+$/.test(value.botOpenId||''))throw Error('飞书配置缺少 botOpenId');
  // An empty allowlist permits setup/pairing only; it never dispatches tasks.
  if(!Array.isArray(value.bindings)||value.bindings.length>50)throw Error('飞书最多支持 50 个显式会话绑定');
  const seen=new Set<string>();
  const bindings=value.bindings.map((b:any):FeishuBinding=>{
    if(!/^oc_[\w-]+$/.test(b.chatId)||seen.has(b.chatId)||!['group','p2p'].includes(b.chatType))throw Error('飞书会话绑定无效或重复');seen.add(b.chatId);
    if(!Array.isArray(b.userIds)||!b.userIds.length||b.userIds.length>100||b.userIds.some((id:any)=>typeof id!=='string'||!/^ou_[\w-]+$/.test(id)))throw Error('每个飞书绑定必须配置明确的用户 open_id 白名单');
    if(!['group','thread'].includes(b.target?.kind)||typeof b.target?.id!=='string'||!b.target.id||b.target.id.length>100)throw Error('Omega 绑定目标无效');
    if(b.allowAllMembers!==undefined&&typeof b.allowAllMembers!=='boolean'||b.allowAllMembers===true&&b.chatType!=='group')throw Error('允许所有成员仅适用于指定群聊，且必须为布尔值');
    return{chatId:b.chatId,chatType:b.chatType,userIds:[...new Set<string>(b.userIds)],...(b.allowAllMembers!==undefined?{allowAllMembers:b.allowAllMembers}:{}),target:{kind:b.target.kind,id:b.target.id}};
  });
  let omegaUrl:string|undefined;if(value.omegaUrl){const u=new URL(value.omegaUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Omega 链接只能是无凭据的 HTTP(S) 地址');omegaUrl=u.href;}
  return{enabled:true,appId,appSecret,botOpenId:value.botOpenId,bindings,omegaUrl};
}
export async function loadFeishuConfig(file:string){try{return parseFeishuConfig(JSON.parse(await readFile(file,'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return parseFeishuConfig(null);throw error;}}
