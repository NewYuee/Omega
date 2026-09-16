import {AutomationStore,type AutomationRecord} from './automation-store.ts';

type TurnResult={turn?:{id?:string}};
type StartTurn=(threadId:string,text:string,submissionId:string,execution?:Record<string,unknown>)=>Promise<TurnResult>;
export class AutomationService{
  private timer:NodeJS.Timeout|null=null;
  private ticking=false;
  private starting=0;
  private startingThreads=new Set<string>();
  private early=new Map<string,{success:boolean;error?:string;cancelled:boolean}>();
  private readonly store:AutomationStore;
  private readonly startTurn:StartTurn;
  private readonly isThreadActive:(id:string)=>boolean;
  private readonly notify:(event:unknown)=>void;
  constructor(store:AutomationStore,startTurn:StartTurn,isThreadActive:(id:string)=>boolean,notify:(event:unknown)=>void){
    this.store=store;
    this.startTurn=startTurn;
    this.isThreadActive=isThreadActive;
    this.notify=notify;
  }
  start(){if(this.timer)return;this.timer=setInterval(()=>void this.tick(),15_000);this.timer.unref();void this.tick();}
  async run(automation:AutomationRecord,manual=false){automation=this.store.get(automation.id);this.store.wait(automation.id,manual);if(this.isThreadActive(automation.threadId)||this.startingThreads.has(automation.threadId)){this.publish(automation.id);return{automation:this.store.get(automation.id),turnId:null,manual};}this.store.begin(automation.id,null);const submissionId=`automation:${automation.id}:${this.store.latestRun(automation.id)!.id}`;this.publish(automation.id);this.starting++;this.startingThreads.add(automation.threadId);try{const result=await this.startTurn(automation.threadId,automation.prompt,submissionId,{automationId:automation.id});const turnId=result.turn?.id;if(!turnId)throw new Error('Codex 没有返回执行轮次');this.store.setTurn(automation.id,turnId);const early=this.early.get(turnId);if(early){this.early.delete(turnId);this.store.finishByTurn(turnId,early.success,early.error,early.cancelled);}this.publish(automation.id);return{automation:this.store.get(automation.id),turnId,manual};}catch(error){this.store.fail(automation.id,error,!(error as {definiteNotStarted?:boolean})?.definiteNotStarted);this.publish(automation.id);throw error;}finally{this.startingThreads.delete(automation.threadId);this.starting--;if(!this.starting)this.early.clear();}}
  async tick(){if(this.ticking)return;this.ticking=true;try{for(const item of this.store.due())try{await this.run(item);}catch{}}finally{this.ticking=false;}}
  complete(turnId:string,success:boolean,error?:string,cancelled=false){const result=this.store.finishByTurn(turnId,success,error,cancelled);if(result)this.publish(result.id);else if(this.starting&&this.early.size<100)this.early.set(turnId,{success,error,cancelled});}
  private publish(id:string){this.notify({method:'omega/automation-updated',params:{automation:this.store.get(id)}});}
  close(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}
