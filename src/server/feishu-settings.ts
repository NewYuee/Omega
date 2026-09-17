import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import path from 'node:path';
import {parseFeishuConfig,type FeishuConfig} from './feishu-config.ts';

export type Credentials={appId:string;appSecret:string};
export type Settings={enabled:boolean;botOpenId:string;omegaUrl?:string;bindings:FeishuConfig['bindings']};
export const emptySettings=():Settings=>({enabled:false,botOpenId:'',bindings:[]});
export class FeishuSettings{
  private state:string;private env:NodeJS.ProcessEnv;
  constructor(state:string,env:NodeJS.ProcessEnv=process.env){this.state=state;this.env=env;}
  environmentManaged(){return !!(this.env.OMEGA_FEISHU_APP_ID||this.env.OMEGA_FEISHU_APP_SECRET);}
  async read():Promise<Settings>{try{const value=JSON.parse(await readFile(path.join(this.state,'feishu.json'),'utf8'));if(!value)throw Error();const bindings=value.bindings??(value.enabled!==true?[]:null);if(!Array.isArray(bindings))throw Error();return{enabled:value.enabled===true,botOpenId:typeof value.botOpenId==='string'?value.botOpenId:'',omegaUrl:typeof value.omegaUrl==='string'?value.omegaUrl:undefined,bindings:bindings.map((b:any)=>({chatId:b.chatId,chatType:b.chatType,userIds:b.userIds,...(b.allowAllMembers!==undefined?{allowAllMembers:b.allowAllMembers}:{}),target:{kind:b.target.kind,id:b.target.id}}))};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return emptySettings();throw Error('飞书配置文件无法读取，请核对 feishu.json');}}
  private async key(create=false){
    const file=path.join(this.state,'feishu-secret.key');
    try{const key=await readFile(file);if(key.length!==32)throw Error();return key;}catch(e){
      if(!create||(e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('飞书凭据加密密钥不可用');
      const key=randomBytes(32);await writeFile(file,key,{mode:0o600,flag:'wx'});return key;
    }
  }
  async credentials():Promise<Credentials>{
    if(this.environmentManaged())return{appId:this.env.OMEGA_FEISHU_APP_ID||'',appSecret:this.env.OMEGA_FEISHU_APP_SECRET||''};
    let encrypted:any;try{encrypted=JSON.parse(await readFile(path.join(this.state,'feishu-secret.json'),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{appId:'',appSecret:''};throw Error('飞书凭据文件不可用');}
    try{const decipher=createDecipheriv('aes-256-gcm',await this.key(),Buffer.from(encrypted.iv,'base64'));decipher.setAuthTag(Buffer.from(encrypted.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data,'base64')),decipher.final()]).toString());}catch{throw Error('飞书凭据无法解密，请检查本机加密密钥');}
  }
  async atomic(name:string,value:unknown){const temp=path.join(this.state,`${name}.${randomBytes(8).toString('hex')}.tmp`);try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path.join(this.state,name));}finally{await unlink(temp).catch(()=>{});}}
  async saveCredentials(value:Credentials){if(this.environmentManaged())throw Error('凭据由部署环境管理，不能在界面覆盖');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await this.key(true),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);await this.atomic('feishu-secret.json',{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
  async save(value:Settings){await this.atomic('feishu.json',value);}
  async resolve(value?:Settings):Promise<FeishuConfig>{const c=await this.credentials();return parseFeishuConfig(value||await this.read(),{OMEGA_FEISHU_APP_ID:c.appId,OMEGA_FEISHU_APP_SECRET:c.appSecret});}
}

// Fixed origin, bounded requests, no redirect following and no raw upstream errors/headers.
export async function verifyFeishu(c:Credentials,request:typeof fetch=fetch){
  if(!/^cli_[a-f\d]{16}$/i.test(c.appId)||!c.appSecret||c.appSecret.length>512)throw Error('请填写有效的 App ID 和 App Secret');
  const call=async(route:string,init:RequestInit)=>{let r:Response;try{r=await request('https://open.feishu.cn/open-apis/'+route,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw Error('无法连接飞书，请检查服务器网络后重试');}if(!r.ok)throw Error(`飞书接口请求失败（HTTP ${r.status}）`);let value:any;try{value=await r.json()}catch{throw Error('飞书返回了无效响应');}if(value.code)throw Error(`飞书校验失败（错误码 ${Number(value.code)||'未知'}），请核对凭据、机器人能力和应用发布状态`);return value;};
  const token=await call('auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:c.appId,app_secret:c.appSecret})});
  if(typeof token.tenant_access_token!=='string')throw Error('飞书未返回应用令牌');
  const result=await call('bot/v3/info',{headers:{Authorization:`Bearer ${token.tenant_access_token}`}});
  const bot=result.bot||result.data?.bot;if(!/^ou_[\w-]+$/.test(bot?.open_id))throw Error('无法获取机器人身份，请启用机器人能力并发布应用');
  return{botOpenId:bot.open_id as string,name:typeof bot.app_name==='string'?bot.app_name.slice(0,100):'飞书机器人'};
}
