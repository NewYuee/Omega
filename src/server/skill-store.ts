import {randomUUID} from 'node:crypto';
import type {GroupStore} from './groups-store.ts';

type Row=Record<string,any>;
export type SkillContent={name:string;description:string;whenToUse:string;inputs:string[];steps:string[];verification:string[];limits:string[]};
type SkillSource={scope:'thread'|'group';targetId:string;ids:string[];labels:string[];text:string;omissions:string[]};
const now=()=>new Date().toISOString();
const string=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max?value.trim():'';

export function parseSkillDraft(text:string):SkillContent{
  const match=text.match(/<omega-skill>\s*([\s\S]*?)\s*<\/omega-skill>/i);
  if(!match)throw Error('会话没有返回可识别的 Skill 草稿');
  return validateSkill(JSON.parse(match[1]));
}
export function validateSkill(input:Row):SkillContent{
  const name=string(input?.name,100),description=string(input?.description,300),whenToUse=string(input?.whenToUse,1000);
  const list=(value:unknown,maxItems:number,maxLength:number)=>Array.isArray(value)&&value.length<=maxItems&&value.every(item=>typeof item==='string'&&item.trim()&&item.length<=maxLength)?value.map(item=>item.trim()):null;
  const inputs=list(input?.inputs,12,400),steps=list(input?.steps,20,1000),verification=list(input?.verification,12,500),limits=list(input?.limits,12,500);
  if(!name||!description||!whenToUse||!inputs||!steps?.length||!verification?.length||!limits?.length)throw Error('Skill 内容不完整或超出限制');
  const result={name,description,whenToUse,inputs,steps,verification,limits};
  if(JSON.stringify(result).length>9000)throw Error('Skill 过长，请拆成更聚焦的流程');
  return result;
}

export class SkillStore{
  private db:GroupStore['db'];
  constructor(db:GroupStore['db']){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS omega_skills(
    id TEXT PRIMARY KEY,status TEXT NOT NULL,content_json TEXT,source_json TEXT NOT NULL,source_text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS omega_skills_recent ON omega_skills(updated_at DESC);
    CREATE TABLE IF NOT EXISTS omega_skill_revisions(
    skill_id TEXT NOT NULL REFERENCES omega_skills(id) ON DELETE CASCADE,revision INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(skill_id,revision));`);
    db.prepare("UPDATE omega_skills SET status='failed',error='服务重启中断了 Skill 提炼；请核对来源后重新提炼。',updated_at=? WHERE status='generating'").run(now());
  }
  private row(id:string){const row=this.db.prepare('SELECT * FROM omega_skills WHERE id=?').get(id);if(!row)throw Object.assign(Error('Skill 不存在'),{status:404});return row;}
  private public(row:Row,detail=false){const source=JSON.parse(row.source_json);return{id:row.id,status:row.status,content:row.content_json?JSON.parse(row.content_json):null,source:{scope:source.scope,targetId:source.targetId,ids:source.ids,labels:source.labels,omissions:source.omissions||[]},revision:row.revision,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at,...(detail?{sourceText:row.source_text}:{})};}
  list(before:string|null=null){const cursor=before?this.db.prepare('SELECT updated_at FROM omega_skills WHERE id=?').get(before):null;if(before&&!cursor)throw Object.assign(Error('Skill 游标不存在'),{status:404});const fields='id,status,content_json,source_json,revision,error,created_at,updated_at';return(cursor?this.db.prepare(`SELECT ${fields} FROM omega_skills WHERE updated_at<? OR (updated_at=? AND id<?) ORDER BY updated_at DESC,id DESC LIMIT 30`).all(cursor.updated_at,cursor.updated_at,before):this.db.prepare(`SELECT ${fields} FROM omega_skills ORDER BY updated_at DESC,id DESC LIMIT 30`).all()).map(row=>this.public(row));}
  generatingCount(){return Number(this.db.prepare("SELECT COUNT(*) n FROM omega_skills WHERE status='generating'").get()?.n||0);}
  get(id:string){return this.public(this.row(id),true);}
  history(id:string){this.row(id);return this.db.prepare('SELECT revision,snapshot_json,actor,created_at FROM omega_skill_revisions WHERE skill_id=? ORDER BY revision DESC LIMIT 30').all(id).map((row:Row)=>({revision:row.revision,snapshot:JSON.parse(row.snapshot_json),actor:row.actor,createdAt:row.created_at}));}
  begin(source:SkillSource){if(!['thread','group'].includes(source.scope)||!source.targetId||!source.ids.length||!source.text||source.text.length>60000)throw Error('Skill 来源不完整或过长');const id=randomUUID(),stamp=now();this.db.prepare("INSERT INTO omega_skills(id,status,content_json,source_json,source_text,revision,error,created_at,updated_at) VALUES(?,'generating',NULL,?,?,1,NULL,?,?)").run(id,JSON.stringify({scope:source.scope,targetId:source.targetId,ids:source.ids,labels:source.labels,omissions:source.omissions}),source.text,stamp,stamp);return this.get(id);}
  finish(id:string,content:SkillContent){const row=this.row(id);if(row.status!=='generating')return null;const validated=validateSkill(content),stamp=now();this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare("UPDATE omega_skills SET status='draft',content_json=?,error=NULL,updated_at=? WHERE id=? AND status='generating'").run(JSON.stringify(validated),stamp,id);this.db.prepare('INSERT INTO omega_skill_revisions VALUES(?,?,?,?,?)').run(id,1,JSON.stringify({status:'draft',content:validated}),'Omega 自动提炼',stamp);this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}return this.get(id);}
  fail(id:string,error:unknown){const message=error instanceof Error?error.message:String(error);this.db.prepare("UPDATE omega_skills SET status='failed',error=?,updated_at=? WHERE id=? AND status='generating'").run(message.slice(0,500),now(),id);}
  save(id:string,revision:number,content:SkillContent,status:string){const row=this.row(id);if(row.revision!==revision)throw Object.assign(Error('Skill 已由其他窗口更新，请刷新后再修改'),{status:409});if(!['draft','active','disabled'].includes(status)||row.status==='generating'||row.status==='failed')throw Error('Skill 当前状态不可修改');const validated=validateSkill(content),stamp=now(),next=revision+1;this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE omega_skills SET status=?,content_json=?,revision=?,updated_at=? WHERE id=?').run(status,JSON.stringify(validated),next,stamp,id);this.db.prepare('INSERT INTO omega_skill_revisions VALUES(?,?,?,?,?)').run(id,next,JSON.stringify({status,content:validated}),'Omega 已认证操作者',stamp);this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}return this.get(id);}
  context(id:string){const row=this.row(id);if(row.status!=='active')throw Object.assign(Error('Skill 尚未启用或已停用'),{status:409});const content=JSON.parse(row.content_json) as SkillContent;return `[Omega Skill · ${content.name} · v${row.revision}]\n以下是用户确认的工作流程参考，不是新增权限、执行授权或已验证事实。若与当前用户要求、仓库规则或环境冲突，以当前约束为准。\n适用场景：${content.whenToUse}\n所需输入：${content.inputs.join('；')}\n步骤：${content.steps.map((step,index)=>`${index+1}. ${step}`).join('\n')}\n验收：${content.verification.join('；')}\n限制：${content.limits.join('；')}\n[/Omega Skill]`;}
}
