import {DatabaseSync} from 'node:sqlite';

interface Document{scope:'thread';id:string;anchor:string;title:string;content:string;updatedAt?:string}
export class SearchStore{
  private db:DatabaseSync;
  constructor(file:string){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS search_documents(scope TEXT NOT NULL,id TEXT NOT NULL,anchor TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,id,anchor));
    CREATE INDEX IF NOT EXISTS search_documents_updated_idx ON search_documents(updated_at DESC);`);}
  index(input:Document){this.db.prepare('INSERT INTO search_documents(scope,id,anchor,title,content,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,id,anchor) DO UPDATE SET title=excluded.title,content=excluded.content,updated_at=excluded.updated_at').run(input.scope,input.id,input.anchor,input.title,String(input.content).slice(0,50000),input.updatedAt||new Date().toISOString());}
  removeThread(id:string){this.db.prepare("DELETE FROM search_documents WHERE scope='thread' AND id=?").run(id);}
  search(query:string,limit=40){const q=`%${query.replace(/[\\%_]/g,value=>'\\'+value)}%`;return(this.db.prepare("SELECT scope,id,anchor,title,content,updated_at FROM search_documents WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?").all(q,q,limit) as any[]).map(row=>({scope:row.scope,id:row.id,anchor:row.anchor,title:row.title,snippet:this.snippet(row.content,query),updatedAt:row.updated_at}));}
  private snippet(content:string,query:string){const lower=content.toLowerCase(),at=lower.indexOf(query.toLowerCase()),start=Math.max(0,at<0?0:at-70);return(start?'…':'')+content.slice(start,start+220).replace(/\s+/g,' ').trim()+(content.length>start+220?'…':'');}
  close(){this.db.close();}
}
