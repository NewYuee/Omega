import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';

interface RpcError{message:string}
interface RpcReply{id:number;result?:unknown;error?:RpcError}
interface RpcRequest{id?:number|string;method:string;params?:Record<string,unknown>}
interface Pending{resolve(value:unknown):void;reject(reason:Error):void;timer:NodeJS.Timeout}

export class Bridge extends EventEmitter{
  pending=new Map<number,Pending>();
  approvals=new Map<string,RpcRequest>();
  sequence=0;
  ready=false;
  child:ChildProcessWithoutNullStreams|null=null;
  info:unknown;
  readonly command:string;
  readonly args:string[];
  private restartTimer:NodeJS.Timeout|null=null;
  private restartDelay=500;
  private initializationRequested=false;
  private closing=false;

  constructor(command=process.env.OMEGA_CODEX_BIN||'codex',args=['app-server','--listen','stdio://']){
    super();this.command=command;this.args=args;this.spawnChild();
  }

  private spawnChild(){
    if(this.closing)return;
    const child=spawn(this.command,this.args,{stdio:['pipe','pipe','pipe']});
    this.child=child;
    child.stderr.on('data',(data:Buffer)=>process.stderr.write(data));
    createInterface({input:child.stdout}).on('line',(line:string)=>{
      if(child!==this.child)return;
      try{this.receive(JSON.parse(line) as RpcReply|RpcRequest)}catch(error){this.emit('diagnostic',error instanceof Error?error.message:String(error))}
    });
    const fail=(reason:Error|number|null)=>this.disconnected(child,reason);
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  }

  private disconnected(child:ChildProcessWithoutNullStreams,reason:Error|number|null){
    if(child!==this.child)return;
    this.child=null;this.ready=false;
    const error=reason instanceof Error?reason:new Error(`Codex App Server 已退出（${reason??'未知'}），Omega 正在自动重连。`);
    for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error)}
    this.pending.clear();this.approvals.clear();
    this.emit('event',{method:'omega/disconnected',params:{message:error.message,retrying:!this.closing}});
    if(this.initializationRequested&&!this.closing)this.scheduleRestart();
  }

  private scheduleRestart(){
    if(this.restartTimer||this.closing)return;
    const delay=this.restartDelay;this.restartDelay=Math.min(this.restartDelay*2,15_000);
    this.restartTimer=setTimeout(()=>{this.restartTimer=null;this.spawnChild();void this.initializeCurrent(true).catch(()=>{})},delay);
    this.restartTimer.unref();
  }

  private async initializeCurrent(reconnected:boolean){
    try{
      this.info=await this.request('initialize',{clientInfo:{name:'omega',title:'Omega',version:'0.2.1'},capabilities:{experimentalApi:true}});
      this.write({method:'initialized'});this.ready=true;this.restartDelay=500;
      if(reconnected)this.emit('event',{method:'omega/reconnected',params:{message:'Codex App Server 已恢复连接'}});
      return this.info;
    }catch(error){
      if(this.child)this.disconnected(this.child,error instanceof Error?error:new Error(String(error)));
      throw error;
    }
  }

  receive(message:RpcReply|RpcRequest){
    if('method'in message){if(message.id!==undefined)this.approvals.set(String(message.id),message);if(message.method==='serverRequest/resolved')this.approvals.delete(String(message.params?.requestId));this.emit('event',message);return}
    const entry=this.pending.get(message.id);if(!entry)return;this.pending.delete(message.id);clearTimeout(entry.timer);if(message.error)entry.reject(new Error(message.error.message));else entry.resolve(message.result);
  }

  write(message:unknown){
    if(!this.child||this.child.stdin.destroyed)throw new Error('Codex App Server 尚未连接，Omega 正在自动重连');
    this.child.stdin.write(JSON.stringify(message)+'\n');
  }

  request<T=unknown>(method:string,params:Record<string,unknown>={}):Promise<T>{
    if(!this.child||this.child.stdin.destroyed)return Promise.reject(new Error('Codex App Server 尚未连接，Omega 正在自动重连'));
    const id=++this.sequence;
    return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Request timed out. Refresh state before retrying.'))},60000);this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});try{this.write({id,method,params})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}});
  }

  initialize(){this.initializationRequested=true;return this.initializeCurrent(false)}

  restart(){this.initializationRequested=true;this.restartDelay=500;if(this.child)this.child.kill('SIGTERM');else this.scheduleRestart();}
  diagnostics(){return{ready:this.ready,pid:this.child?.pid||null,pendingRequests:this.pending.size,pendingApprovals:this.approvals.size,restartDelayMs:this.restartDelay};}

  answer(id:string|number,result:unknown){
    const request=this.approvals.get(String(id));if(!request)throw new Error('This request has already been resolved on another device.');this.approvals.delete(String(id));this.write({id:request.id,result});this.emit('event',{method:'serverRequest/resolved',params:{requestId:request.id,threadId:request.params?.threadId}});
  }

  close(){
    this.closing=true;if(this.restartTimer)clearTimeout(this.restartTimer);this.restartTimer=null;
    const child=this.child;this.child=null;child?.kill('SIGTERM');
    for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Omega 正在关闭'))}this.pending.clear();
  }
}
