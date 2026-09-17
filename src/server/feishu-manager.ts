import {randomUUID} from 'node:crypto';
import {FeishuSettings,verifyFeishu,type Settings,type Credentials} from './feishu-settings.ts';
import {FeishuPairing} from './feishu-pairing.ts';
import {parseFeishuConfig,type FeishuConfig} from './feishu-config.ts';
import type {FeishuConnector} from './feishu-connector.ts';

type Runtime=Pick<FeishuConnector,'start'|'close'|'status'> & {service:{canReconfigure():boolean}};
type Target={kind:'group'|'thread';id:string};
export class FeishuManager{
  private runtime:Runtime|undefined;private error=false;private busy=false;private closed=false;
  private revision=randomUUID();readonly pairing=new FeishuPairing();
  readonly settings:FeishuSettings;
  private create:(config:FeishuConfig,receive:(data:Record<string,any>)=>boolean)=>Promise<Runtime>;
  private validateTarget:(target:Target)=>Promise<void>;private verify:typeof verifyFeishu;
  constructor(settings:FeishuSettings,create:(config:FeishuConfig,receive:(data:Record<string,any>)=>boolean)=>Promise<Runtime>,validateTarget:(target:Target)=>Promise<void>,verify=verifyFeishu){this.settings=settings;this.create=create;this.validateTarget=validateTarget;this.verify=verify;}
  async start(){try{await this.reload()}catch{this.error=true;}}
  private async reload(){
    if(this.closed)return;const config=await this.settings.resolve();if(this.closed||!config.enabled)return;
    const runtime=await this.create(config,data=>{if(this.closed||this.busy)throw Error('飞书配置切换中，请重试投递');return this.pairing.receive(data,config.botOpenId);});
    if(this.closed){runtime.close();return;}this.runtime=runtime;
    try{await runtime.start();this.error=false;}catch{runtime.close();this.runtime=undefined;this.error=true;}
  }
  async status(){const value=await this.settings.read(),c=await this.settings.credentials();return{...(this.runtime?.status()||{enabled:false}),configurationError:this.error,revision:this.revision,settings:value,appId:c.appId,hasSecret:!!c.appSecret,environmentManaged:this.settings.environmentManaged(),pairing:this.pairing.status()};}
  private idle(){if(this.runtime&&!this.runtime.service.canReconfigure())throw Object.assign(Error('飞书仍有待处理任务或回传，请结束任务并等待回传后再修改连接'),{status:409});}
  private stop(){this.runtime?.close();this.runtime=undefined;this.pairing.clear();this.error=false;}
  async action(input:Record<string,any>){
    if(this.closed)throw Error('服务正在关闭');if(this.busy)throw Object.assign(Error('飞书配置正在更新，请稍后重试'),{status:409});
    if(input.revision!==this.revision)throw Object.assign(Error('配置已更新，请刷新后重试'),{status:409});
    this.busy=true;
    try{
      const current=await this.settings.read(),credentials=await this.settings.credentials();
      if(input.action==='pair'){
        if(!this.runtime||this.runtime.status().connection!=='connected')throw Error('请先连接机器人，并在飞书后台开启长连接');
        this.pairing.create();return await this.status();
      }
      if(input.action==='cancelPair'){this.pairing.clear();return await this.status();}
      if(input.action==='connect'){
        this.idle();const managed=this.settings.environmentManaged();
        if(managed&&(input.appSecret||input.appId&&input.appId!==credentials.appId))throw Error('凭据由部署环境管理，不能在界面覆盖');
        const next:Credentials=managed?credentials:{appId:typeof input.appId==='string'?input.appId.trim():credentials.appId,appSecret:typeof input.appSecret==='string'&&input.appSecret?input.appSecret:credentials.appSecret};
        if(next.appId!==credentials.appId&&!input.appSecret&&!managed)throw Error('更换应用时必须输入新的 App Secret');
        const bot=await this.verify(next);this.idle();if(this.closed)throw Error('服务正在关闭');
        if(next.appId!==credentials.appId&&current.bindings.length&&!input.confirmReset)throw Error('更换应用会清空旧应用绑定，请确认后重试');
        const value:Settings={...current,enabled:false,botOpenId:bot.botOpenId,bindings:next.appId===credentials.appId?current.bindings:[]};
        this.stop();this.revision=randomUUID();
        // First disable old settings: partial credential writes must never authorize old bindings for a new app.
        await this.settings.save(value);if(!managed)await this.settings.saveCredentials(next);
        await this.settings.save({...value,enabled:true});await this.reload();return await this.status();
      }
      this.idle();let next:Settings;
      if(input.action==='confirmPair'){
        const pair=this.pairing.status();if(!pair?.candidate||input.code!==pair.code||input.confirmAuthorization!==true)throw Error('配对已失效或尚未确认授权');
        const c=pair.candidate;await this.validateTarget(input.target);
        if(pair!==this.pairing.status())throw Error('配对已过期，请重新生成');
        if(c.chatType==='group'&&input.target.kind!=='group'||c.chatType==='p2p'&&input.target.kind!=='thread')throw Error('飞书群需绑定 Omega 群组，私聊需绑定独立会话');
        const existing=current.bindings.find(b=>b.chatId===c.chatId);
        const users=existing&&existing.target.kind===input.target.kind&&existing.target.id===input.target.id?[...new Set([...existing.userIds,c.userId])]:[c.userId];
        const allowAllMembers=c.chatType==='group'&&existing?.chatType==='group'&&existing.target.kind===input.target.kind&&existing.target.id===input.target.id&&existing.allowAllMembers===true;
        next={...current,bindings:[...current.bindings.filter(b=>b.chatId!==c.chatId),{chatId:c.chatId,chatType:c.chatType,userIds:users,...(allowAllMembers?{allowAllMembers:true}:{}),target:input.target}]};
      }else if(input.action==='save'){
        if(input.confirmAuthorization!==true)throw Error('请确认绑定与白名单授权范围');
        next={enabled:input.enabled===true,botOpenId:current.botOpenId,bindings:input.bindings,omegaUrl:input.omegaUrl||undefined};
        // Always validate even when disabled; disabled configurations must not store malformed allowlists.
        const valid=parseFeishuConfig({...next,enabled:true},{OMEGA_FEISHU_APP_ID:credentials.appId,OMEGA_FEISHU_APP_SECRET:credentials.appSecret});
        next={...next,bindings:valid.bindings,omegaUrl:valid.omegaUrl};
        for(const b of next.bindings){if(b.chatType==='group'&&b.target.kind!=='group'||b.chatType==='p2p'&&b.target.kind!=='thread')throw Error('飞书群绑定群组，私聊绑定独立会话');await this.validateTarget(b.target);}
      }else if(input.action==='disable'){next={...current,enabled:false};}
      else if(input.action==='reconnect'){next=current;}
      else throw Error('不支持的飞书配置操作');
      if(this.closed)throw Error('服务正在关闭');this.idle();
      if(input.action!=='disable')parseFeishuConfig({...next,enabled:true},{OMEGA_FEISHU_APP_ID:credentials.appId,OMEGA_FEISHU_APP_SECRET:credentials.appSecret});
      this.stop();this.revision=randomUUID();await this.settings.save(next);await this.reload();return await this.status();
    }finally{this.busy=false;}
  }
  close(){this.closed=true;this.stop();}
}
