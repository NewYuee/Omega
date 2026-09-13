import {DatabaseSync} from 'node:sqlite';

type Scope='thread'|'group';
interface Db{exec(sql:string):void;prepare(sql:string):{all(...args:any[]):any[];get(...args:any[]):any;run(...args:any[]):{changes:number}};close():void}

export class ReadStateStore{
  private db:Db;
  constructor(file:string){
    this.db=new DatabaseSync(file) as unknown as Db;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS unread(scope TEXT NOT NULL,id TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 1,position TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(scope,id));`);
    try{this.db.exec('ALTER TABLE unread ADD COLUMN count INTEGER NOT NULL DEFAULT 1');}catch(error){if(!/duplicate column/i.test((error as Error).message))throw error;}
    try{this.db.exec('ALTER TABLE unread ADD COLUMN position TEXT');}catch(error){if(!/duplicate column/i.test((error as Error).message))throw error;}
  }
  markUnread(scope:Scope,id:string,position:string|null=null){if(!id)return 0;this.db.prepare('INSERT INTO unread(scope,id,count,position,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(scope,id) DO UPDATE SET count=unread.count+1,position=COALESCE(unread.position,excluded.position),updated_at=excluded.updated_at').run(scope,id,position,new Date().toISOString());return Number(this.db.prepare('SELECT count FROM unread WHERE scope=? AND id=?').get(scope,id)?.count||1);}
  markRead(scope:Scope,id:string){return this.db.prepare('DELETE FROM unread WHERE scope=? AND id=?').run(scope,id).changes>0;}
  remove(scope:Scope,id:string){this.markRead(scope,id);}
  snapshot(){const unread:{threads:string[];groups:string[]}={threads:[],groups:[]},counts:{threads:Record<string,number>;groups:Record<string,number>}={threads:{},groups:{}},positions:{threads:Record<string,string>;groups:Record<string,string>}={threads:{},groups:{}};for(const row of this.db.prepare('SELECT scope,id,count,position FROM unread ORDER BY updated_at').all()){const kind=row.scope==='group'?'groups':'threads';unread[kind].push(row.id);counts[kind][row.id]=Number(row.count||1);if(row.position)positions[kind][row.id]=row.position;}return{unread,counts,positions};}
  close(){this.db.close();}
}
