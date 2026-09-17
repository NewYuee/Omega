import {randomBytes} from 'node:crypto';
export type Pairing={code:string;expiresAt:number;candidate?:{chatId:string;chatType:'group'|'p2p';userId:string}};
export class FeishuPairing{
  private current:Pairing|null=null;
  private now:()=>number;
  constructor(now=Date.now){this.now=now;}
  status(){if(this.current&&this.current.expiresAt<=this.now())this.current=null;return this.current;}
  create(){this.current={code:randomBytes(12).toString('hex'),expiresAt:this.now()+5*60_000};return this.current;}
  clear(){this.current=null;}
  receive(event:Record<string,any>,botOpenId:string){
    const m=event.message,s=event.sender;let text='';try{if(m?.message_type==='text')text=JSON.parse(m.content).text;}catch{return false;}
    if(typeof text!=='string'||text.length>1000)return false;
    for(const mention of m?.mentions||[])if(mention.id?.open_id===botOpenId&&typeof mention.key==='string')text=text.replaceAll(mention.key,'');
    text=text.trim();if(!text.startsWith('/omega-pair'))return false;
    // Setup commands never reach the model, including expired/invalid/replayed codes.
    const pair=this.status(),time=Number(m.create_time);
    if(!pair||pair.candidate||text!==`/omega-pair ${pair.code}`||s?.sender_type!=='user'||!/^ou_[\w-]+$/.test(s?.sender_id?.open_id)||!/^oc_[\w-]+$/.test(m.chat_id)||!/^om_[\w-]+$/.test(m.message_id)||!['group','p2p'].includes(m.chat_type)||!Number.isFinite(time)||time>this.now()+60_000||time<this.now()-5*60_000)return true;
    if(m.chat_type==='group'&&!m.mentions?.some((v:any)=>v.id?.open_id===botOpenId))return true;
    pair.candidate={chatId:m.chat_id,chatType:m.chat_type,userId:s.sender_id.open_id};return true;
  }
}
