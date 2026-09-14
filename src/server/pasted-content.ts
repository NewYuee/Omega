import {mkdir,readdir,lstat,readFile,realpath,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const PASTED_TEXT_TTL=7*24*60*60*1000;
export const MAX_PASTED_TEXT_BYTES=512*1024;
export const MAX_PASTED_TEXTS=4;
const ID=/^([0-9]{13})-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const OWN_FILE=/^([0-9]{13}-[a-f0-9-]{36})\.txt$/;

export type PastedTextRef={id:string;chars:number;bytes:number;createdAt:number;expiresAt:number};
export const pastedTextError=(message:string,status=400)=>Object.assign(new Error(message),{status});
export function pastedTextInfo(id:string):Pick<PastedTextRef,'id'|'createdAt'|'expiresAt'>{const match=typeof id==='string'&&ID.exec(id);if(!match)throw pastedTextError('粘贴文本标识无效');const createdAt=Number(match[1]);return{id,createdAt,expiresAt:createdAt+PASTED_TEXT_TTL};}

export class PastedTextStore{
  directory:string;now:()=>number;
  constructor(directory:string,now=Date.now){this.directory=path.resolve(directory);this.now=now;}
  async initialize(){await mkdir(this.directory,{recursive:true,mode:0o700});if((await lstat(this.directory)).isSymbolicLink())throw new Error('Pasted text directory must not be a symlink');this.directory=await realpath(this.directory);}
  file(id:string){pastedTextInfo(id);return path.join(this.directory,id+'.txt');}
  async upload(data:Buffer){if(!data.length||data.length>MAX_PASTED_TEXT_BYTES)throw pastedTextError('单段粘贴文本不得超过 512 KB',413);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw pastedTextError('粘贴内容必须是 UTF-8 文本',415);}if(!text.trim())throw pastedTextError('粘贴内容不能为空');const id=this.now()+'-'+randomUUID(),bytes=Buffer.byteLength(text),chars=[...text].length;await writeFile(this.file(id),text,{flag:'wx',mode:0o600});return{...pastedTextInfo(id),bytes,chars};}
  async resolve(id:string){const info=pastedTextInfo(id);if(this.now()>=info.expiresAt)throw pastedTextError('粘贴文本已超过 7 天，已过期',410);try{const text=await readFile(this.file(id),'utf8');return{...info,text,bytes:Buffer.byteLength(text),chars:[...text].length};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw pastedTextError('粘贴文本已清理或不存在',410);throw error;}}
  async refs(ids:string[]=[]){if(!Array.isArray(ids)||ids.length>MAX_PASTED_TEXTS||new Set(ids).size!==ids.length)throw pastedTextError('每条消息最多包含 4 段不同的粘贴文本');return Promise.all(ids.map(async id=>{const {text,...ref}=await this.resolve(id);return ref;}));}
  async contents(refs:Array<{id?:unknown}>=[]){return Promise.all(refs.map(async ref=>(await this.resolve(typeof ref.id==='string'?ref.id:'')).text));}
  async turnInput(input:Array<{type:string;text?:string}>,ids:string[]=[]){const references=await this.refs(ids);if(!Array.isArray(input)||input.some(value=>value?.type!=='text'||typeof value.text!=='string'))throw pastedTextError('消息仅支持文字、粘贴文本及已上传的图片');const result=input.map(value=>({type:'text',text:value.text!}));if(references.length){const contents=await this.contents(references);result.push({type:'text',text:'\n\n<omega_pasted_files>\n'+contents.map((text,index)=>`文件：Pasted Content ${references[index].chars} chars.txt\n---\n${text}`).join('\n\n========\n\n')+'\n</omega_pasted_files>'});}return result;}
  async cleanup(){let removed=0;for(const entry of await readdir(this.directory,{withFileTypes:true})){if(!entry.isFile())continue;const match=OWN_FILE.exec(entry.name);if(!match)continue;let info;try{info=pastedTextInfo(match[1]);}catch{continue;}if(this.now()<info.expiresAt)continue;try{await unlink(path.join(this.directory,entry.name));removed++;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}return removed;}
}
