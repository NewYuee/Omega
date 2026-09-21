import {createHash,randomBytes} from 'node:crypto';
import type {FeishuConfig} from './feishu-config.ts';
import {feishuUserAllowed} from './feishu-config.ts';
import {FeishuStore,type FeishuJob} from './feishu-store.ts';
import {feishuCard,feishuAnswerCard,feishuAnswerPages} from './feishu-cards.ts';
import {withFeishuQuoteChain,quoteSnapshot,quoteAttachmentIds,resolveFeishuQuoteChain,importFeishuQuoteResources,type FeishuQuoteReader,type FeishuQuoteChain,type FeishuQuote} from './feishu-quotes.ts';
import {parseFeishuPostInput,renderFeishuPostInput} from './feishu-input.ts';
import type {FeishuResourceImporter} from './feishu-resources.ts';
type Row=Record<string,any>;
export interface FeishuHost{
  submitGroup(id:string,input:Row):Row;
  getRequirement(id:string):Row|null;
  startThread(id:string,text:string,dispatch:string,attachments?:{imageIds:string[];pasteIds:string[]}):Promise<Row>;
  resolveAttachments?(ids:{imageIds:string[];pasteIds:string[]}):Promise<{imageRefs:Row[];pasteRefs:Row[]}>;
  inspectThread(id:string,turn:string):Promise<Row|null>;
  readThread(id:string,turn:string):Promise<string>;
  lookupDispatch(id:string):string|null;
  decide(group:string,task:string,input:Row):unknown;
  cancelGroup(group:string,requirement:string):Promise<unknown>;
  cancelThread(thread:string,turn:string):Promise<unknown>;
  approvals(thread:string):boolean;
}
export type FeishuSender=(messageId:string,payload:Row,uuid:string,inThread:boolean)=>Promise<string>;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,32);
export class FeishuService{
  readonly config:FeishuConfig;readonly store:FeishuStore;readonly host:FeishuHost;readonly send:FeishuSender;
  private busy=false;private closed=false;private timer:NodeJS.Timeout|null=null;
  private readQuote:FeishuQuoteReader;
  private importResource?:FeishuResourceImporter;
  constructor(config:FeishuConfig,store:FeishuStore,host:FeishuHost,send:FeishuSender,readQuote:FeishuQuoteReader=async()=>{throw Error('未配置引用读取')},importResource?:FeishuResourceImporter){this.config=config;this.store=store;this.host=host;this.send=send;this.readQuote=readQuote;this.importResource=importResource;}
  allowed(job:FeishuJob){return job.id.startsWith(this.config.appId+':')&&this.config.bindings.some(b=>b.chatId===job.chat_id&&b.chatType===job.chat_type&&feishuUserAllowed(b,job.user_id)&&b.target.kind===job.target_kind&&b.target.id===job.target_id);}
  // Persist first, acknowledge immediately; no model or network call in the event handler.
  receive(event:Row){
    if(this.closed||!this.config.enabled)return;
    const m=event.message,s=event.sender,user=s?.sender_id?.open_id;
    if(s?.sender_type!=='user'||!m||typeof m.message_id!=='string'||!/^om_[\w-]+$/.test(m.message_id))return;
    const binding=this.config.bindings.find(b=>b.chatId===m.chat_id&&b.chatType===m.chat_type&&feishuUserAllowed(b,user));if(!binding)return;
    if(m.chat_type==='group'&&!m.mentions?.some((v:Row)=>v.id?.open_id===this.config.botOpenId))return;
    const created=Number(m.create_time);if(!Number.isFinite(created)||Date.now()-created>10*60_000||created>Date.now()+60_000)return;
    const id=this.config.appId+':'+m.message_id;if(this.store.get(id))return;
    const botKeys=(m.mentions||[]).filter((v:Row)=>v.id?.open_id===this.config.botOpenId&&typeof v.key==='string'&&v.key).map((v:Row)=>v.key);
    let text='',post:FeishuQuote|undefined,inputError='';
    try{
      if(m.message_type==='post'){post=parseFeishuPostInput(m.content,m.message_id,this.config.botOpenId,botKeys);text=post.text;}
      else if(m.message_type==='text')text=JSON.parse(m.content).text;
      else inputError='暂不支持直接发送此类型，请使用纯文本或图片＋文字消息；也可以引用图片、文件或卡片后发送文字问题';
    }catch{inputError='图文或文本消息无法解析、包含不支持的组件或超过限制，请拆分后重发';}
    if(inputError)text='[未支持或无法解析的消息]';
    if(typeof text!=='string')return;
    for(const mention of m.mentions||[])if(mention.id?.open_id===this.config.botOpenId&&typeof mention.key==='string')text=text.replaceAll(mention.key,'');
    text=text.trim();
    const hasValidParent=typeof m.parent_id==='string'&&/^om_[\w-]{1,100}$/.test(m.parent_id);
    if(!text&&hasValidParent)text='请处理引用消息';
    if(!text||text.length>12000)return;
    const pending=Number(this.store.db.prepare("SELECT COUNT(*) n FROM feishu_jobs WHERE status IN ('queued','dispatching','running','cancel-requested')").get()?.n);
    if(pending>=100)return;
    this.store.db.exec('SAVEPOINT feishu_receive');try{
      this.store.db.prepare("INSERT OR IGNORE INTO feishu_jobs(id,chat_id,chat_type,user_id,target_kind,target_id,text,status,created_at) VALUES(?,?,?,?,?,?,?,'queued',?)").run(id,m.chat_id,m.chat_type,user,binding.target.kind,binding.target.id,text,Date.now());
      if(post)this.store.db.prepare('INSERT INTO feishu_inputs(job_id,snapshot) VALUES(?,?)').run(id,JSON.stringify({version:2,messages:[post]}));
      if(inputError){this.store.update(id,'failed');this.notify(this.store.get(id)!,'input-error',`本次提问未交给模型：${inputError}。`);}
      // Only the immediate parent is a quote; root_id/thread_id alone must not pull in unrelated history.
      if(m.parent_id)this.store.db.prepare('INSERT OR IGNORE INTO feishu_quotes(job_id,message_id) VALUES(?,?)').run(id,typeof m.parent_id==='string'&&/^om_[\w-]{1,100}$/.test(m.parent_id)?m.parent_id:'invalid');
      this.store.db.exec('RELEASE feishu_receive');
    }catch(error){this.store.db.exec('ROLLBACK TO feishu_receive; RELEASE feishu_receive');throw error;}
  }
  action(event:Row){
    const toast=(content:string,type='info')=>({toast:{type,content}});
    if(this.closed||!this.config.enabled)return toast('连接器未启用','error');
    const id=event.action?.value?.actionId||event.action?.name;
    if(typeof id!=='string')return toast('无效操作','error');
    const action=this.store.db.prepare('SELECT * FROM feishu_actions WHERE id=?').get(id),job=action&&this.store.get(String(action.job_id));
    const origin=event.context?.open_message_id,chat=event.context?.open_chat_id,user=event.operator?.open_id;
    if(!action||!job||!this.allowed(job)||chat!==job.chat_id||user!==job.user_id||typeof origin!=='string'||!this.store.db.prepare('SELECT 1 FROM feishu_outbox WHERE job_id=? AND message_id=?').get(job.id,origin))return toast('仅原提问者可操作原会话中的任务','error');
    if(action.used||['done','failed','cancelled','blocked'].includes(job.status))return toast('操作已处理或任务已结束');
    try{
      if(action.kind==='decision'){
        const req=this.host.getRequirement(job.requirement_id!),task=req?.tasks?.find((t:Row)=>t.id===action.task_id);
        if(!req||req.groupId!==job.target_id||['completed','cancelled','accepted'].includes(req.status)||task?.decision?.id!==action.decision_id||task?.status!=='awaiting_input')return toast('决策已失效，请查看 Omega 最新状态','error');
        const values=event.action?.form_value||{},choice=values.choice,note=values.note||'';
        if(typeof choice!=='string'||typeof note!=='string'||note.length>1000)return toast('表单内容无效','error');
        this.host.decide(job.target_id,String(action.task_id),{decisionId:action.decision_id,choiceId:choice,note,custom:choice==='other'?note:''});
        this.store.db.prepare('UPDATE feishu_actions SET used=1 WHERE id=?').run(id);
        this.notify(job,'decision-answered:'+id,'已收到你的决定，Omega 将继续原任务。');
        return toast('决定已提交','success');
      }
      if(!job.requirement_id&&!job.turn_id)return toast('派发结果未知，请先到 Omega 核对原执行','error');
      this.store.db.exec('SAVEPOINT feishu_cancel');try{
        this.store.db.prepare('UPDATE feishu_actions SET used=1 WHERE id=?').run(id);
        this.store.update(job.id,'cancel-requested');this.store.db.exec('RELEASE feishu_cancel');
      }catch(error){this.store.db.exec('ROLLBACK TO feishu_cancel; RELEASE feishu_cancel');throw error;}
      return toast('已请求停止；已发生的操作不会自动回滚');
    }catch{return toast('未能提交，请检查选择或到 Omega 查看最新状态','error');}
  }
  private notify(job:FeishuJob,key:string,text:string){
    if(key==='final'||key==='cancelled'){
      const title=job.status==='failed'?'Omega · 执行失败':job.status==='cancelled'||key==='cancelled'?'Omega · 已取消':'Omega · 已完成';
      const chars=Array.from(text||'任务已结束，没有文本结果。');
      const pages=feishuAnswerPages(chars.slice(0,80000).join('')+(chars.length>80000?'\n[结果过长，完整内容请在 Omega 查看]':''));
      const started=this.store.db.prepare("SELECT message_id FROM feishu_outbox WHERE id=? AND status='sent'").get(digest(job.id+':started'));
      for(const [index,page] of pages.entries())this.store.enqueue(`${job.id}:${key}:${index}`,job.id,{
        msg_type:'interactive',content:JSON.stringify(feishuAnswerCard(title+(pages.length>1?` · ${index+1}/${pages.length}`:''),page,job.text,this.config.omegaUrl)),
        ...(index===0&&started?.message_id?{update_message_id:String(started.message_id)}:{})
      });
      return;
    }
    const chunks=Array.from(text||'任务已结束，没有文本结果。');
    const capped=chunks.slice(0,80000);if(chunks.length>capped.length)capped.push('\n[结果过长，完整内容请在 Omega 查看]');
    for(let i=0;i<capped.length;i+=4000)this.store.enqueue(`${job.id}:${key}:${i}`,job.id,{msg_type:'text',content:JSON.stringify({text:capped.slice(i,i+4000).join('')})});
  }
  private card(job:FeishuJob,key:string,task?:Row){
    const id=digest(job.id+':'+key);
    const actionId='a'+randomBytes(12).toString('hex');
    // Deterministic outbox identity prevents repeat notifications on polling/restarts.
    if(this.store.db.prepare('SELECT 1 FROM feishu_outbox WHERE id=?').get(id))return;
    const decision=task?.decision,text=decision?`${decision.question}\n\n${decision.options.map((o:Row)=>`${o.label}：${o.description||''}`).join('\n')}`:'任务已交给 Omega。可在这里停止任务；需要审批的操作仍需到 Omega 处理。';
    if(decision&&(text.length>6000||decision.options.some((o:Row)=>o.label.length>100))){this.notify(job,key+':too-long','决策内容较长，为避免省略关键取舍，请到 Omega 查看完整选项并提交决定。');return;}
    this.store.db.exec('SAVEPOINT feishu_card');try{
      this.store.db.prepare('INSERT INTO feishu_actions(id,job_id,task_id,decision_id,kind) VALUES(?,?,?,?,?)').run(actionId,job.id,task?.id||null,decision?.id||null,decision?'decision':'cancel');
      this.store.enqueue(id,job.id,{msg_type:'interactive',content:JSON.stringify(feishuCard(decision?'Omega · 需要你的决定':'Omega · 正在处理',text,actionId,decision,this.config.omegaUrl))});
      this.store.db.exec('RELEASE feishu_card');
    }catch(error){this.store.db.exec('ROLLBACK TO feishu_card; RELEASE feishu_card');throw error;}
  }
  private async dispatch(job:FeishuJob){
    const mode=job.target_kind==='group'?(job.text.startsWith('/讨论 ')?'discussion':job.text.startsWith('/交接 ')?'handoff':'direct'):'direct';
    let content=mode==='direct'?job.text:job.text.slice(4).trim();
    let attachmentIds={imageIds:[] as string[],pasteIds:[] as string[]},attachmentRefs:{imageRefs:Row[];pasteRefs:Row[]}={imageRefs:[],pasteRefs:[]};
    const reference=this.store.db.prepare('SELECT message_id,snapshot FROM feishu_quotes WHERE job_id=?').get(job.id);
    const input=this.store.db.prepare('SELECT snapshot FROM feishu_inputs WHERE job_id=?').get(job.id);
    if(reference||input){
      try{
        const deadline=Date.now()+120000,assertLive=()=>{if(this.closed)throw Error('连接器已关闭');};
        const post=input?quoteSnapshot(String(input.snapshot)).messages[0]:undefined;
        let chain:FeishuQuoteChain|undefined;
        if(reference){
          const id=String(reference.message_id);if(!/^om_[\w-]+$/.test(id)||id===job.id.slice(this.config.appId.length+1))throw Error('引用消息标识无效');
          if(reference.snapshot)chain=quoteSnapshot(String(reference.snapshot));
          else{
            chain=await resolveFeishuQuoteChain(id,job.chat_id,job.id.slice(this.config.appId.length+1),this.readQuote,this.importResource,assertLive,true);
            if(this.closed)return;
          }
        }
        const messages=[...(post?[post]:[]),...(chain?.messages||[])];
        await importFeishuQuoteResources(messages,this.importResource,assertLive,deadline);if(this.closed)return;
        if(post){content=renderFeishuPostInput(post,mode);this.store.db.prepare('UPDATE feishu_inputs SET snapshot=? WHERE job_id=?').run(JSON.stringify({version:2,messages:[post]}),job.id);}
        if(chain){content=withFeishuQuoteChain(content,chain);this.store.db.prepare('UPDATE feishu_quotes SET snapshot=? WHERE job_id=?').run(JSON.stringify(chain),job.id);}
        if(content.length>12000)throw Error('提问与引用合计超过 12000 字符，请拆分后重发');
        attachmentIds=quoteAttachmentIds({version:2,messages});
        if(attachmentIds.imageIds.length||attachmentIds.pasteIds.length){
          if(!this.host.resolveAttachments)throw Error('附件传递尚未配置');
          attachmentRefs=await this.host.resolveAttachments(attachmentIds);if(this.closed)return;
        }
      }catch(error){
        if(this.closed)return;
        this.store.db.exec('SAVEPOINT feishu_quote_failed');try{this.store.update(job.id,'failed');this.notify(job,'quote-error',`本次提问未交给模型：${error instanceof Error?error.message:'引用消息读取失败'}。`);this.store.db.exec('RELEASE feishu_quote_failed');}catch(e){this.store.db.exec('ROLLBACK TO feishu_quote_failed; RELEASE feishu_quote_failed');throw e;}return;
      }
    }
    if(this.closed)return;
    if(!this.allowed(job)){this.store.update(job.id,'blocked');return;}
    this.store.update(job.id,'dispatching');
    try{
      if(job.target_kind==='group'){
        const group=this.host.submitGroup(job.target_id,{content,collaborationMode:mode,...attachmentRefs});
        this.store.update(job.id,'running',group.requirement.id);
      }else{
        const result=await this.host.startThread(job.target_id,content,job.id,attachmentIds);if(this.closed)return;
        if(!result.turn?.id)throw Error('missing turn');this.store.update(job.id,'running',null,result.turn.id);
      }
      this.card(this.store.get(job.id)!,'started');
    }catch(error){if(this.closed)return;this.store.update(job.id,(error as {definiteNotStarted?:boolean}).definiteNotStarted?'failed':'unknown');this.notify(job,'dispatch-error','Omega 派发未能确认；请到 Omega 核对原会话，系统不会自动重新提交。');}
  }
  async tick(){
    if(this.closed||this.busy||!this.config.enabled)return;this.busy=true;
    try{
      const jobs=this.store.db.prepare("SELECT * FROM feishu_jobs WHERE status IN ('queued','running','unknown','cancel-requested') ORDER BY CASE status WHEN 'unknown' THEN 1 ELSE 0 END,created_at LIMIT 100").all() as unknown as FeishuJob[];
      for(const job of jobs){
        if(this.closed)return;
        if(!this.allowed(job)){this.store.update(job.id,'blocked');continue;}
        if(job.status==='queued'){await this.dispatch(job);continue;}
        if(job.status==='unknown'){
          const turn=this.host.lookupDispatch(job.id);if(job.target_kind==='thread'&&turn)this.store.update(job.id,'running',null,turn);
          else this.notify(job,'unknown','派发结果待核对，不自动重发。请打开 Omega 检查原会话。');continue;
        }
        try{
          if(job.status==='cancel-requested'){
            if(job.target_kind==='group'&&job.requirement_id)await this.host.cancelGroup(job.target_id,job.requirement_id);
            else if(job.turn_id)await this.host.cancelThread(job.target_id,job.turn_id);
            if(this.closed)return;this.store.update(job.id,'cancelled');this.notify(job,'cancelled','已请求终止原任务；不会回滚已经发生的操作。');continue;
          }
          if(job.target_kind==='group'){
            const req=this.host.getRequirement(job.requirement_id!);if(!req){this.store.update(job.id,'failed');this.notify(job,'missing','原问题已不存在，请打开 Omega 核对。');continue;}
            if(this.host.approvals(job.target_id))this.notify(job,'approval','群组会话正在等待执行审批，请打开 Omega 处理；飞书连接器不会自动批准。');
            for(const task of req.tasks||[])if(task.status==='awaiting_input'&&task.decision?.status==='pending')this.card(job,'decision:'+task.decision.id,task);
            if(req.status==='paused')this.notify(job,'paused:'+digest(req.error||''),'任务已暂停：'+(req.error||'请到 Omega 查看原因、调整预算或核对执行。'));
            if(['completed','accepted','cancelled'].includes(req.status)){this.notify({...job,status:req.status==='cancelled'?'cancelled':'done'},'final',req.status==='cancelled'?'任务已取消。':req.delivery||'任务已完成，请在 Omega 查看结果。');this.store.update(job.id,req.status==='cancelled'?'cancelled':'done');}
          }else{
            if(this.host.approvals(job.target_id))this.notify(job,'approval','原会话正在等待审批或输入，请打开 Omega 处理；飞书连接器不会自动批准。');
            const turn=await this.host.inspectThread(job.target_id,job.turn_id!);if(this.closed)return;
            if(turn&&['completed','failed','interrupted'].includes(turn.status)){
              const text=turn.status==='completed'?await this.host.readThread(job.target_id,job.turn_id!):'任务未正常完成，请在 Omega 核对。';if(this.closed)return;
              const status=turn.status==='completed'?'done':turn.status==='interrupted'?'cancelled':'failed';
              this.notify({...job,status},'final',text);this.store.update(job.id,status);
            }
          }
        }catch{if(this.closed)return;this.notify(job,'inspect-error','暂时无法同步任务状态，请打开 Omega 核对。');if(job.status==='cancel-requested')this.store.update(job.id,'running');}
      }
      const messages=this.store.db.prepare("SELECT * FROM feishu_outbox WHERE status='pending' ORDER BY rowid LIMIT 30").all();
      for(const entry of messages){
        if(this.closed)return;
        const job=this.store.get(String(entry.job_id));if(!job||!this.allowed(job)){this.store.db.prepare("UPDATE feishu_outbox SET status='blocked' WHERE id=?").run(entry.id);continue;}
        this.store.db.prepare("UPDATE feishu_outbox SET status='sending' WHERE id=?").run(entry.id);
        try{const message=await this.send(job.id.slice(this.config.appId.length+1),JSON.parse(String(entry.payload)),digest(String(entry.id)),false);if(this.closed)return;
          this.store.db.prepare("UPDATE feishu_outbox SET status='sent',message_id=? WHERE id=?").run(message,entry.id);
        }catch{if(this.closed)return;this.store.db.prepare("UPDATE feishu_outbox SET status='unknown' WHERE id=?").run(entry.id);}
      }
    }finally{this.busy=false;}
  }
  start(){if(this.timer)return;this.timer=setInterval(()=>void this.tick().catch(()=>{}),2000);this.timer.unref();void this.tick().catch(()=>{});}
  canReconfigure(){return !this.busy&&!this.store.db.prepare("SELECT 1 FROM feishu_jobs WHERE status IN ('queued','dispatching','running','cancel-requested') LIMIT 1").get()&&!this.store.db.prepare("SELECT 1 FROM feishu_outbox WHERE status IN ('pending','sending') LIMIT 1").get();}
  close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=null;}
}
