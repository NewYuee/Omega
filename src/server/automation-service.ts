import {randomUUID} from 'node:crypto';
import {AutomationStore,type AutomationRecord} from './automation-store.ts';

type TurnResult={turn?:{id?:string}};
type StartTurn=(threadId:string,text:string,submissionId:string,execution?:Record<string,unknown>)=>Promise<TurnResult>;
export class AutomationService{
  private timer:NodeJS.Timeout|null=null;
  private ticking=false;
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
  async run(automation:AutomationRecord,manual=false){if(this.isThreadActive(automation.threadId))throw Object.assign(new Error('目标会话正在执行其他任务'),{status:409});const submissionId=`automation:${automation.id}:${randomUUID()}`;this.store.begin(automation.id,null);this.publish(automation.id);try{const result=await this.startTurn(automation.threadId,automation.prompt,submissionId,{automationId:automation.id});const turnId=result.turn?.id;if(!turnId)throw new Error('Codex 没有返回执行轮次');this.store.setTurn(automation.id,turnId);this.publish(automation.id);return{automation:this.store.get(automation.id),turnId,manual};}catch(error){this.store.fail(automation.id,error);this.publish(automation.id);throw error;}}
  async tick(){if(this.ticking)return;this.ticking=true;try{for(const item of this.store.due())try{await this.run(item);}catch{}}finally{this.ticking=false;}}
  complete(turnId:string,success:boolean,error?:string){const result=this.store.finishByTurn(turnId,success,error);if(result)this.publish(result.id);}
  private publish(id:string){this.notify({method:'omega/automation-updated',params:{automation:this.store.get(id)}});}
  close(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}
