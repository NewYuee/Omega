import {Client,WSClient,EventDispatcher} from '@larksuiteoapi/node-sdk';
import type {FeishuConfig} from './feishu-config.ts';
import {FeishuService,type FeishuHost} from './feishu-service.ts';
import {FeishuStore,type FeishuDb} from './feishu-store.ts';
import {downloadFeishuResource,feishuResourceImporter} from './feishu-resources.ts';
import type {ImageStore} from './images.ts';
import type {PastedTextStore} from './pasted-content.ts';
export class FeishuConnector{
  service:FeishuService;private ws:WSClient;private lastError=false;
  private receiveSetup:(data:Record<string,any>)=>boolean;
  constructor(config:FeishuConfig,db:FeishuDb,host:FeishuHost,receiveSetup:(data:Record<string,any>)=>boolean=()=>false,media?:{images:ImageStore;pastes:PastedTextStore}){
    this.receiveSetup=receiveSetup;
    // SDK errors can contain request headers/config: never log raw SDK payloads.
    const logger={trace:()=>{},debug:()=>{},info:()=>{},warn:()=>{this.lastError=true},error:()=>{this.lastError=true}};
    const client=new Client({appId:config.appId,appSecret:config.appSecret,logger});
    this.ws=new WSClient({appId:config.appId,appSecret:config.appSecret,logger});
    this.service=new FeishuService(config,new FeishuStore(db),host,async(messageId,payload,uuid,inThread)=>{
      if(payload.update_message_id){
        const response=await client.im.message.patch({path:{message_id:payload.update_message_id},data:{content:payload.content}});
        // Only an explicit rejection can fall back to a new reply. A transport
        // timeout has an unknown outcome and must not send a duplicate answer.
        if(!response.code)return payload.update_message_id;
      }
      const response=await client.im.message.reply({path:{message_id:messageId},data:{msg_type:payload.msg_type,content:payload.content,uuid,reply_in_thread:inThread}});
      if(response.code||!response.data?.message_id)throw Error('飞书回复失败');return response.data.message_id;
    },async messageId=>{
      const response=await client.im.message.get({path:{message_id:messageId},params:{user_id_type:'open_id'}});
      if(response.code)throw Error('飞书引用消息读取失败');
      return response.data?.items?.find(item=>item.message_id===messageId);
    },media?feishuResourceImporter(media.images,media.pastes,(resource,limit)=>downloadFeishuResource(()=>client.im.messageResource.get({path:{message_id:resource.messageId,file_key:resource.key},params:{type:resource.kind}}),limit)):undefined);
  }
  async start(){
    const dispatcher=new EventDispatcher({}).register({
      'im.message.receive_v1':data=>{try{if(!this.receiveSetup(data))this.service.receive(data)}catch{this.lastError=true;throw Error('Feishu inbox persistence failed')}},
      'card.action.trigger':(data:Record<string,any>)=>{try{return this.service.action(data)}catch{this.lastError=true;return{toast:{type:'error',content:'操作未能完成，请到 Omega 核对'}}}}
    });
    this.service.start();await this.ws.start({eventDispatcher:dispatcher});
  }
  status(){return{enabled:true,connection:this.ws.getConnectionStatus().state,hasError:this.lastError,...this.service.store.stats()};}
  close(){this.service.close();this.ws.close({force:true});}
}
