import {randomUUID} from 'node:crypto';
import type {GroupStore} from './groups-store.ts';

type Row=Record<string,any>;
const text=(value:unknown,max:number,required=false)=>{if(typeof value!=='string'||value.length>max||value.includes('\0')||(required&&!value.trim()))throw Error('项目字段为空、格式不正确或超出长度限制');return value.trim();};
const choice=(value:unknown,values:string[])=>{if(typeof value!=='string'||!values.includes(value))throw Error('项目字段选项无效');return value;};
const offset=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0;
const durableSignal=/现状|版本|已完成|完成了|结论|决定|决策|依据|取舍|下一步|待办|未完成|阻塞|风险|测试|验证|检查|通过|失败|未覆盖|发布|部署|修复|实现/;
const kindRules:[string,RegExp][]=[
  ['verification',/测试|验证|检查|通过|失败|覆盖|回归|构建|typecheck|lint/i],
  ['task',/下一步|待办|未完成|阻塞|风险|后续|需要继续|建议.*(?:处理|补充|修复)/i],
  ['decision',/结论|决定|决策|选择|取舍|采用|不采用|依据|共识|推荐/i],
];
export function projectMemoryCandidate(value:unknown){
  const body=String(value||'').replace(/\0/g,'').trim().slice(0,16000);
  if(!body||(!durableSignal.test(body)&&body.length<80))return null;
  const kind=kindRules.find(([,pattern])=>pattern.test(body))?.[0]||'overview';
  const first=body.split('\n').map(line=>line.replace(/^\s{0,3}#{1,6}\s+|^[-*+]\s+|^\*\*(.*?)\*\*:?$/g,'$1').trim()).find(Boolean)||'自动提取记录';
  const title=first.replace(/[`*_>#]/g,'').replace(/\s+/g,' ').slice(0,140)||'自动提取记录';
  return{kind,title:`自动提取 · ${title}`.slice(0,160),body};
}

export class ProjectStore {
  db:GroupStore['db'];
  constructor(db:GroupStore['db']) {
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_links(project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(project_id,kind,target));
      CREATE INDEX IF NOT EXISTS project_link_target ON project_links(kind,target);
      CREATE TABLE IF NOT EXISTS project_records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,status TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,source_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS project_record_list ON project_records(project_id,updated_at,id);
      CREATE TABLE IF NOT EXISTS project_revisions(record_id TEXT NOT NULL REFERENCES project_records(id),revision INTEGER NOT NULL,snapshot TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(record_id,revision));`);
  }
  project(id:string){const row=this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!row)throw Error('项目不存在');return row;}
  list(){return this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC,id LIMIT 100').all();}
  create(name:unknown){if(Number(this.db.prepare('SELECT count(*) n FROM projects').get()!.n)>=100)throw Error('最多创建 100 个项目');const row={id:randomUUID(),name:text(name,120,true),created_at:new Date().toISOString()};this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(row.id,row.name,row.created_at);return row;}
  links(id:string){this.project(id);return this.db.prepare('SELECT kind,target FROM project_links WHERE project_id=? ORDER BY kind,target').all(id);}
  link(id:string,kind:unknown,target:unknown,remove=false){
    this.project(id);const k=choice(kind,['thread','group','repository']),t=text(target,1000,true);
    if(remove)this.db.prepare('DELETE FROM project_links WHERE project_id=? AND kind=? AND target=?').run(id,k,t);
    else if(!this.db.prepare('SELECT 1 FROM project_links WHERE project_id=? AND kind=? AND target=?').get(id,k,t)){
      if(this.links(id).length>=100)throw Error('每个项目最多 100 个关联');
      if(Number(this.db.prepare('SELECT count(*) n FROM project_links WHERE kind=? AND target=?').get(k,t)!.n)>=3)throw Error('同一目标最多关联 3 个项目');
      this.db.prepare('INSERT INTO project_links VALUES(?,?,?)').run(id,k,t);
    }
    return this.links(id);
  }
  decode(row:Row):Row{return {...row,source:JSON.parse(row.source_json),source_json:undefined};}
  get(id:string){const row=this.db.prepare('SELECT * FROM project_records WHERE id=?').get(id);if(!row)throw Error('项目记录不存在');return this.decode(row);}
  records(id:string,skip:unknown=0){this.project(id);return {items:this.db.prepare('SELECT * FROM project_records WHERE project_id=? ORDER BY updated_at DESC,id LIMIT 30 OFFSET ?').all(id,offset(skip)).map(r=>this.decode(r)),total:this.db.prepare('SELECT count(*) n FROM project_records WHERE project_id=?').get(id)!.n};}
  save(input:Row,actor='Omega 已认证操作者'){
    this.project(input.projectId);
    const previous=input.id?this.get(text(input.id,100,true)):null;
    if(previous&&(previous.project_id!==input.projectId||input.revision!==previous.revision))throw Object.assign(Error('记录已被修改，请刷新后重新编辑'),{status:409});
    if(!previous&&Number(this.db.prepare('SELECT count(*) n FROM project_records WHERE project_id=?').get(input.projectId)!.n)>=100)throw Error('第一版每个项目最多 100 条记录');
    const kind=choice(input.kind,['overview','decision','task','verification']),status=choice(input.status,['candidate','confirmed','stale','superseded']);
    const source=input.source||{type:'manual',excerpt:''};
    const normalized={type:choice(source.type,['manual','thread','group']),target:text(source.target||'',1000),messageId:text(source.messageId||'',200),excerpt:text(source.excerpt||'',16000),automatic:source.automatic===true};
    if(normalized.type!=='manual'&&(!normalized.target||!normalized.messageId))throw Error('消息来源必须包含稳定会话和消息 ID');
    if(kind==='verification'&&status==='confirmed'&&!normalized.excerpt)throw Error('确认验证记录时必须填写证据、命令及验证范围');
    const row={id:previous?.id||randomUUID(),project_id:input.projectId,kind,status,title:text(input.title,160,true),body:text(input.body,16000,true),source:normalized,revision:(previous?.revision||0)+1,updated_at:new Date().toISOString()};
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO project_records VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,title=excluded.title,body=excluded.body,source_json=excluded.source_json,revision=excluded.revision,updated_at=excluded.updated_at').run(row.id,row.project_id,row.kind,row.status,row.title,row.body,JSON.stringify(row.source),row.revision,row.updated_at);
      this.db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?,?)').run(row.id,row.revision,JSON.stringify(row),actor,row.updated_at);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return row;
  }
  autoCapture(sourceType:'thread'|'group',target:string,messageId:string,value:unknown){
    const candidate=projectMemoryCandidate(value);if(!candidate)return[];
    const linked=this.db.prepare('SELECT project_id FROM project_links WHERE kind=? AND target=? ORDER BY project_id').all(sourceType,target),created:Row[]=[];
    for(const link of linked){
      const duplicate=this.db.prepare("SELECT id FROM project_records WHERE project_id=? AND json_extract(source_json,'$.type')=? AND json_extract(source_json,'$.target')=? AND json_extract(source_json,'$.messageId')=? AND json_extract(source_json,'$.automatic')=1").get(link.project_id,sourceType,target,messageId);
      if(duplicate)continue;
      if(Number(this.db.prepare('SELECT count(*) n FROM project_records WHERE project_id=?').get(link.project_id)!.n)>=100)continue;
      created.push(this.save({projectId:link.project_id,...candidate,status:'candidate',source:{type:sourceType,target,messageId,excerpt:candidate.body,automatic:true}},'Omega 自动提取'));
    }
    return created;
  }
  history(id:string,skip:unknown=0){this.get(id);return this.db.prepare('SELECT * FROM project_revisions WHERE record_id=? ORDER BY revision DESC LIMIT 30 OFFSET ?').all(id,offset(skip)).map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));}
  context(threadId:string,groupId?:string){
    const projects=this.db.prepare("SELECT DISTINCT p.* FROM projects p JOIN project_links l ON l.project_id=p.id WHERE (l.kind='thread' AND l.target=?) OR (l.kind='group' AND l.target=?) ORDER BY p.id").all(threadId,groupId||'');
    if(!projects.length)return null;
    const snapshots=projects.map(project=>({project,links:this.links(project.id),records:this.db.prepare("SELECT * FROM project_records WHERE project_id=? AND status='confirmed' ORDER BY kind,updated_at DESC,id").all(project.id).map(row=>this.decode(row)),candidates:this.db.prepare("SELECT * FROM project_records WHERE project_id=? AND status='candidate' AND json_extract(source_json,'$.automatic')=1 ORDER BY updated_at DESC,id LIMIT 6").all(project.id).map(row=>this.decode(row))}));
    const summary=snapshots.map(({project,records,candidates})=>({id:project.id,name:project.name,confirmedCount:records.length,records:['overview','decision','task','verification'].flatMap(kind=>records.filter(r=>r.kind===kind).slice(0,2)).map(r=>({id:r.id,revision:r.revision,kind:r.kind,title:r.title,body:r.body.slice(0,200)})),unconfirmedAutomatic:candidates.slice(0,3).map(r=>({id:r.id,kind:r.kind,title:r.title,body:r.body.slice(0,200),warning:'自动提取，尚未由用户确认'}))}));
    const compact=JSON.stringify(summary);
    return {summary:compact.length>12000?compact.slice(0,12000)+'\n[摘要已截断，请读取完整快照]':compact,full:JSON.stringify(snapshots,null,2)};
  }
}
