import type {GroupStore} from './groups-store.ts';
export type FeishuDb=GroupStore['db'];
export type FeishuJob={id:string;chat_id:string;chat_type:string;user_id:string;target_kind:string;target_id:string;text:string;status:string;requirement_id:string|null;turn_id:string|null;created_at:number};
export class FeishuStore{
  db:FeishuDb;
  constructor(db:FeishuDb){this.db=db;db.exec(`
    CREATE TABLE IF NOT EXISTS feishu_jobs(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,chat_type TEXT NOT NULL,user_id TEXT NOT NULL,target_kind TEXT NOT NULL,target_id TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,requirement_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS feishu_jobs_status ON feishu_jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS feishu_outbox(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES feishu_jobs(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',message_id TEXT);
    CREATE TABLE IF NOT EXISTS feishu_actions(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES feishu_jobs(id),task_id TEXT,decision_id TEXT,kind TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS feishu_quotes(job_id TEXT PRIMARY KEY REFERENCES feishu_jobs(id),message_id TEXT NOT NULL,snapshot TEXT);
    CREATE TABLE IF NOT EXISTS feishu_inputs(job_id TEXT PRIMARY KEY REFERENCES feishu_jobs(id),snapshot TEXT NOT NULL);
  `);db.exec("UPDATE feishu_jobs SET status='unknown' WHERE status='dispatching'; UPDATE feishu_outbox SET status='unknown' WHERE status='sending'");}
  get(id:string){return this.db.prepare('SELECT * FROM feishu_jobs WHERE id=?').get(id) as FeishuJob|undefined;}
  update(id:string,status:string,requirementId:string|null=null,turnId:string|null=null){this.db.prepare('UPDATE feishu_jobs SET status=?,requirement_id=COALESCE(?,requirement_id),turn_id=COALESCE(?,turn_id) WHERE id=?').run(status,requirementId,turnId,id);}
  enqueue(id:string,jobId:string,payload:unknown){this.db.prepare('INSERT OR IGNORE INTO feishu_outbox(id,job_id,payload) VALUES(?,?,?)').run(id,jobId,JSON.stringify(payload));}
  stats(){return{jobs:this.db.prepare('SELECT status,COUNT(*) count FROM feishu_jobs GROUP BY status').all(),outbox:this.db.prepare('SELECT status,COUNT(*) count FROM feishu_outbox GROUP BY status').all()};}
}
