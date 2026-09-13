import {randomUUID} from 'node:crypto';
import {DatabaseSync,type StatementSync} from 'node:sqlite';
import {z} from 'zod';

const scheduleSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('interval'),minutes:z.number().int().min(5).max(43_200)}),
  z.object({kind:z.literal('daily'),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.string().min(1).max(80).default('Asia/Shanghai')})
]);
const automationInputSchema=z.object({name:z.string().trim().min(1).max(100),threadId:z.string().trim().min(1).max(120),prompt:z.string().trim().min(1).max(12_000),schedule:scheduleSchema,enabled:z.boolean().default(true)});
export type AutomationSchedule=z.infer<typeof scheduleSchema>;
export type AutomationInput=z.infer<typeof automationInputSchema>;
export type AutomationState='idle'|'running'|'completed'|'failed';
export interface AutomationRecord extends AutomationInput{id:string;nextRunAt:string|null;lastRunAt:string|null;lastTurnId:string|null;lastStatus:AutomationState;lastError:string|null;createdAt:string;updatedAt:string}
type Row={id:string;name:string;thread_id:string;prompt:string;schedule_json:string;enabled:number;next_run_at:string|null;last_run_at:string|null;last_turn_id:string|null;last_status:AutomationState;last_error:string|null;created_at:string;updated_at:string};
const iso=()=>new Date().toISOString();

function nextDaily(time:string,timezone:string,from:Date){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const wanted=time.split(':').map(Number),probe=new Date(from.getTime()+60_000);
  for(let index=0;index<1_500;index++,probe.setMinutes(probe.getMinutes()+1)){
    const parts=Object.fromEntries(formatter.formatToParts(probe).map(part=>[part.type,part.value]));
    if(Number(parts.hour)===wanted[0]&&Number(parts.minute)===wanted[1])return probe.toISOString();
  }
  throw new Error('无法计算下一次执行时间');
}
export function nextRun(schedule:AutomationSchedule,from=new Date()){
  if(schedule.kind==='interval')return new Date(from.getTime()+schedule.minutes*60_000).toISOString();
  return nextDaily(schedule.time,schedule.timezone,from);
}
export class AutomationStore{
  private readonly db:DatabaseSync;
  private readonly getStatement:StatementSync;
  constructor(file:string){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY,name TEXT NOT NULL,thread_id TEXT NOT NULL,prompt TEXT NOT NULL,schedule_json TEXT NOT NULL,enabled INTEGER NOT NULL,next_run_at TEXT,last_run_at TEXT,last_turn_id TEXT,last_status TEXT NOT NULL DEFAULT 'idle',last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS automations_due_idx ON automations(enabled,next_run_at);`);this.getStatement=this.db.prepare('SELECT * FROM automations WHERE id=?');this.db.prepare("UPDATE automations SET last_status='failed',last_error='Omega 重启中断了状态跟踪，请核对目标会话',updated_at=? WHERE last_status='running'").run(iso());}
  private public(row:Row):AutomationRecord{return{id:row.id,name:row.name,threadId:row.thread_id,prompt:row.prompt,schedule:scheduleSchema.parse(JSON.parse(row.schedule_json)),enabled:!!row.enabled,nextRunAt:row.next_run_at,lastRunAt:row.last_run_at,lastTurnId:row.last_turn_id,lastStatus:row.last_status,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at};}
  list(){return(this.db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all() as unknown as Row[]).map(row=>this.public(row));}
  get(id:string){const row=this.getStatement.get(id) as unknown as Row|undefined;if(!row)throw Object.assign(new Error('自动化不存在'),{status:404});return this.public(row);}
  create(raw:unknown){const input=automationInputSchema.parse(raw),id=randomUUID(),stamp=iso(),next=input.enabled?nextRun(input.schedule):null;this.db.prepare('INSERT INTO automations(id,name,thread_id,prompt,schedule_json,enabled,next_run_at,last_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.name,input.threadId,input.prompt,JSON.stringify(input.schedule),input.enabled?1:0,next,'idle',stamp,stamp);return this.get(id);}
  update(id:string,raw:unknown){const current=this.get(id),input=automationInputSchema.parse({...current,...(raw as object)}),stamp=iso(),next=input.enabled?nextRun(input.schedule):null;this.db.prepare('UPDATE automations SET name=?,thread_id=?,prompt=?,schedule_json=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?').run(input.name,input.threadId,input.prompt,JSON.stringify(input.schedule),input.enabled?1:0,next,stamp,id);return this.get(id);}
  remove(id:string){const current=this.get(id);if(current.lastStatus==='running')throw Object.assign(new Error('自动化正在执行，暂不能删除'),{status:409});this.db.prepare('DELETE FROM automations WHERE id=?').run(id);return{id};}
  due(at=new Date()){return(this.db.prepare("SELECT * FROM automations WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=? AND last_status!='running' ORDER BY next_run_at LIMIT 10").all(at.toISOString()) as unknown as Row[]).map(row=>this.public(row));}
  begin(id:string,turnId:string|null,at=new Date()){const automation=this.get(id),next=nextRun(automation.schedule,at);this.db.prepare("UPDATE automations SET last_status='running',last_error=NULL,last_run_at=?,last_turn_id=?,next_run_at=?,updated_at=? WHERE id=?").run(at.toISOString(),turnId,next,iso(),id);return this.get(id);}
  setTurn(id:string,turnId:string){this.db.prepare('UPDATE automations SET last_turn_id=?,updated_at=? WHERE id=?').run(turnId,iso(),id);return this.get(id);}
  finishByTurn(turnId:string,success:boolean,error?:string){const row=this.db.prepare("SELECT id FROM automations WHERE last_turn_id=? AND last_status='running'").get(turnId) as {id:string}|undefined;if(!row)return null;this.db.prepare('UPDATE automations SET last_status=?,last_error=?,updated_at=? WHERE id=?').run(success?'completed':'failed',success?null:String(error||'执行失败').slice(0,2000),iso(),row.id);return this.get(row.id);}
  fail(id:string,error:unknown){this.db.prepare("UPDATE automations SET last_status='failed',last_error=?,updated_at=? WHERE id=?").run(String(error instanceof Error?error.message:error).slice(0,2000),iso(),id);return this.get(id);}
  close(){this.db.close();}
}
