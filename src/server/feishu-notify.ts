import {randomUUID} from 'node:crypto';
import type {FeishuConfig} from './feishu-config.ts';

type Row=Record<string,any>;
type Client=any;
type Contact={openId:string;name:string};
const openId=(value:unknown):value is string=>typeof value==='string'&&/^ou_[\w-]+$/.test(value);
const chatId=(value:unknown):value is string=>typeof value==='string'&&/^oc_[\w-]+$/.test(value);
const escapeText=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const upstreamCode=(value:unknown)=>{const row=value as Row;return Number(row?.response?.data?.code||row?.code)||0};
const upstreamError=(prefix:string,value:unknown)=>{const code=upstreamCode(value);return Error(`${prefix}${code?`（飞书错误码 ${code}）`:''}`)};

export function feishuNotificationCard(input:{text:string;title?:string;source?:string;memberOpenIds:string[]}){
  const title=(input.title||'Omega 消息通知').trim().slice(0,80)||'Omega 消息通知';
  const source=(input.source||'来自 Omega').trim().slice(0,160)||'来自 Omega';
  const mentions=input.memberOpenIds.map(id=>`<at id=${id}></at>`).join(' ');
  return{schema:'2.0',config:{update_multi:true,width_mode:'default',enable_forward:true,summary:{content:title},style:{text_size:{body:{default:'normal',pc:'normal',mobile:'normal'},caption:{default:'notation',pc:'notation',mobile:'notation'}}}},header:{title:{tag:'plain_text',content:title},subtitle:{tag:'plain_text',content:source},template:'blue',icon:{tag:'standard_icon',token:'bell_outlined',color:'blue'}},body:{direction:'vertical',padding:'12px 12px 20px 12px',vertical_spacing:'12px',elements:[{tag:'markdown',content:mentions?`${mentions}\n\n${escapeText(input.text)}`:escapeText(input.text),text_size:'body'},{tag:'div',icon:{tag:'standard_icon',token:'info_outlined',color:'grey'},fields:[{is_short:false,text:{tag:'plain_text',content:source,text_size:'caption',text_color:'grey',lines:2}}]}]}};
}

export class FeishuNotifier{
  private config:FeishuConfig;private client:Client;
  constructor(config:FeishuConfig,client:Client){this.config=config;this.client=client;}
  private binding(id:unknown){if(!chatId(id))throw Error('飞书群标识无效');const binding=this.config.bindings.find(item=>item.chatType==='group'&&item.chatId===id);if(!binding)throw Error('只能通知已经绑定到 Omega 的飞书群');return binding;}
  async groups(){
    const bindings=this.config.bindings.filter(item=>item.chatType==='group');
    return Promise.all(bindings.map(async binding=>{let name='';try{const response=await this.client.im.chat.get({path:{chat_id:binding.chatId},params:{user_id_type:'open_id'}});if(!response.code)name=String(response.data?.name||'').trim().slice(0,120);}catch{}return{chatId:binding.chatId,name:name||binding.chatId};}));
  }
  async members(id:unknown){
    const binding=this.binding(id),members:Row[]=[],seen=new Set<string>();let token:string|undefined;
    for(let page=0;page<20;page++){
      let response:Row;try{response=await this.client.im.chatMembers.get({path:{chat_id:binding.chatId},params:{member_id_type:'open_id',page_size:100,...(token?{page_token:token}:{})}});}catch(cause){throw upstreamError('无法读取目标飞书群成员，请确认机器人仍在群内，并为应用开通 im:chat.members:read',cause);}
      if(response.code)throw upstreamError('无法读取目标飞书群成员，请确认机器人仍在群内，并为应用开通 im:chat.members:read',response);
      if(response.data?.trigger_security_conf_limit&&!response.data?.items?.length)throw Error('目标群的成员信息安全设置阻止了成员列表读取，请在飞书群设置中允许机器人访问成员信息');
      for(const item of response.data?.items||[])if(openId(item.member_id)&&item.member_id!==this.config.botOpenId&&!seen.has(item.member_id)){seen.add(item.member_id);members.push({openId:item.member_id,name:String(item.name||item.member_id).trim().slice(0,120)});}
      if(!response.data?.has_more)break;token=response.data?.page_token;if(!token)throw Error('飞书群成员分页结果不完整，请刷新后重试');
    }
    return{chatId:binding.chatId,members};
  }
  private async contact(id:unknown){
    if(!openId(id))throw Error('飞书联系人标识无效');
    let response:Row;try{response=await this.client.directory.v1.employee.mget({data:{employee_ids:[id],required_fields:['base_info.name']},params:{is_admin_role:false,employee_id_type:'open_id',department_id_type:'open_department_id'}});}catch(cause){const code=upstreamCode(cause);if(code===99991672)throw Error('无法校验飞书联系人：请为应用开通 directory:employee:read 权限，并在发布新版本后重试');throw upstreamError('无法校验飞书联系人，请检查通讯录权限和应用可用范围',cause);}
    if(response.code){if(response.code===99991672)throw Error('无法校验飞书联系人：请为应用开通 directory:employee:read 权限，并在发布新版本后重试');throw upstreamError('联系人不在应用可见范围内或当前不可用',response);}
    const contact=this.employeeContact(response.data?.employees?.[0]);if(!contact)throw Error('联系人不在应用可见范围内或当前不可用');return contact;
  }
  private employeeContact(employee:Row):Contact|null{
    const id=employee?.base_info?.employee_id,name=employee?.base_info?.name?.name?.default_value;
    return openId(id)&&id!==this.config.botOpenId&&employee?.base_info?.is_resigned!==true?{openId:id,name:String(name||id).trim().slice(0,120)}:null;
  }
  async contacts(value:unknown){
    const query=typeof value==='string'?value.trim():'';if(!query||query.length>120)throw Error('请输入 1–120 个字符搜索联系人');if(/^ou_[\w-]+$/.test(query))return{contacts:[await this.contact(query)]};
    let response:Row;try{response=await this.client.directory.v1.employee.search({data:{query,page_request:{page_size:50},required_fields:['base_info.name']},params:{employee_id_type:'open_id',department_id_type:'open_department_id'}});}catch(cause){const code=upstreamCode(cause);if(code===99991672)throw Error('无法搜索飞书联系人：请为应用开通 directory:employee:search 权限，配置通讯录可用范围后发布新版本');throw upstreamError('无法搜索飞书联系人，请检查通讯录权限和应用可用范围',cause);}
    if(response.code){if(response.code===99991672)throw Error('无法搜索飞书联系人：请为应用开通 directory:employee:search 权限，配置通讯录可用范围后发布新版本');throw upstreamError('无法搜索飞书联系人，请检查通讯录权限和应用可用范围',response);}
    const employees=response.data?.employees||[];if(employees.some((employee:Row)=>openId(employee?.base_info?.employee_id)&&!employee?.base_info?.name?.name?.default_value))throw Error('搜索已命中联系人，但飞书未返回姓名：请为应用开通 directory:employee:read 权限，并在发布新版本后重试');const contacts=employees.map((employee:Row)=>this.employeeContact(employee)).filter((item:Contact|null):item is Contact=>item!==null);return{contacts};
  }
  async send(input:Row){
    const text=typeof input.text==='string'?input.text.trim():'',format=input.format==='card'?'card':'text',direct=input.targetType==='contact';
    if(!text||text.length>4000)throw Error('通知内容需要 1–4000 个字符');
    const uuid=typeof input.submissionId==='string'&&/^[a-f\d-]{36}$/i.test(input.submissionId)?input.submissionId:randomUUID();
    if(direct){const contact=await this.contact(input.contactOpenId),content=format==='card'?JSON.stringify(feishuNotificationCard({text,title:typeof input.title==='string'?input.title:undefined,source:typeof input.source==='string'?input.source:undefined,memberOpenIds:[]})):JSON.stringify({text:escapeText(text)});let response:Row;try{response=await this.client.im.message.create({params:{receive_id_type:'open_id'},data:{receive_id:contact.openId,msg_type:format==='card'?'interactive':'text',content,uuid}});}catch{throw Error('飞书私信发送结果未知，请先到目标联系人会话核对，不要立即重复发送');}if(response.code||!response.data?.message_id)throw Error('飞书拒绝发送私信，请检查机器人消息权限和应用可用范围');return{ok:true,targetType:'contact',contactOpenId:contact.openId,messageId:response.data.message_id};}
    const binding=this.binding(input.chatId);
    const ids=Array.isArray(input.memberOpenIds)?[...new Set<string>(input.memberOpenIds)]:[];
    if(!ids.length||ids.length>20||ids.some(id=>!openId(id)))throw Error('请选择 1–20 位有效的飞书群成员');
    const live=await this.members(binding.chatId),allowed=new Set(live.members.map(item=>item.openId));
    if(ids.some(id=>!allowed.has(id)))throw Error('所选成员已不在目标群或当前不可见，请刷新成员后重试');
    const mentions=ids.map(id=>`<at user_id="${id}"></at>`).join(' '),content=format==='card'?JSON.stringify(feishuNotificationCard({text,title:typeof input.title==='string'?input.title:undefined,source:typeof input.source==='string'?input.source:undefined,memberOpenIds:ids})):JSON.stringify({text:`${mentions}\n${escapeText(text)}`});
    let response:Row;try{response=await this.client.im.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:binding.chatId,msg_type:format==='card'?'interactive':'text',content,uuid}});}catch{throw Error('飞书通知发送结果未知，请先到目标群核对，不要立即重复发送');}
    if(response.code||!response.data?.message_id)throw Error('飞书拒绝发送通知，请检查机器人群成员身份和消息权限');
    return{ok:true,chatId:binding.chatId,messageId:response.data.message_id,memberOpenIds:ids};
  }
}
