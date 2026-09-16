import {MAX_MESSAGE_IMAGES} from '../shared/attachment-limits.ts';
import {splitImageText} from '../shared/inline-images.ts';
import {mkdir,readdir,lstat,writeFile,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
export const IMAGE_TTL=7*24*60*60*1000,MAX_IMAGE_BYTES=8*1024*1024,MAX_IMAGES=MAX_MESSAGE_IMAGES;
const ID=/^([0-9]{13})-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/,OWN_FILE=/^([0-9]{13}-[a-f0-9-]{36})(\.thumb)?\.jpg$/;
type ImagePart={type:string;path?:string;text?:string};
export const imageError=(message:string,status=400)=>Object.assign(new Error(message),{status});
export function imageInfo(id:string){const match=typeof id==='string'&&ID.exec(id);if(!match)throw imageError('图片标识无效');const createdAt=Number(match[1]);return{id,createdAt,expiresAt:createdAt+IMAGE_TTL};}
export class ImageStore{
  directory:string;now:()=>number;busy=false;
  constructor(directory:string,now=Date.now){this.directory=path.resolve(directory);this.now=now;}
  async initialize(){await mkdir(this.directory,{recursive:true,mode:0o700});if((await lstat(this.directory)).isSymbolicLink())throw new Error('Image directory must not be a symlink');this.directory=await realpath(this.directory);}
  file(id:string,thumb=false){imageInfo(id);return path.join(this.directory,id+(thumb?'.thumb':'')+'.jpg');}
  fromContent(content:ImagePart[]=[]){return content.flatMap(part=>{if(part.type!=='localImage'||typeof part.path!=='string'||path.dirname(part.path)!==this.directory)return[];try{return[imageInfo(path.basename(part.path,'.jpg'))];}catch{return[];}}).slice(0,MAX_IMAGES);}
  async resolve(id:string,thumb=false){const info=imageInfo(id);if(this.now()>=info.expiresAt)throw imageError('图片已超过 7 天，已过期',410);const file=this.file(id,thumb);try{if(!(await lstat(file)).isFile())throw imageError('图片不存在',404);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw imageError('图片已清理或不存在',410);throw error;}return file;}
  async upload(data:Buffer,mime:string){if(!['image/png','image/jpeg','image/webp'].includes(mime))throw imageError('仅支持 PNG、JPEG、WebP 图片',415);if(!data.length||data.length>MAX_IMAGE_BYTES)throw imageError('每张图片不得超过 8 MB',413);if(this.busy)throw imageError('正在处理另一张图片，请稍后重试',429);this.busy=true;let id:string|undefined;try{const options={limitInputPixels:24_000_000,failOn:'warning' as const},metadata=await sharp(data,options).metadata();if(!['png','jpeg','webp'].includes(metadata.format||'')||(metadata.pages||1)>1)throw imageError('不支持此图片格式或动画图片',415);const original=await sharp(data,options).rotate().resize({width:2560,height:2560,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer(),thumb=await sharp(original).resize({width:320,height:240,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();id=this.now()+'-'+randomUUID();await writeFile(this.file(id),original,{flag:'wx',mode:0o600});await writeFile(this.file(id,true),thumb,{flag:'wx',mode:0o600});return{...imageInfo(id),bytes:original.length};}catch(error){if(id)await Promise.all([false,true].map(value=>unlink(this.file(id!,value)).catch(()=>{})));if(typeof(error as {status?:unknown}).status==='number')throw error;throw imageError('图片无法解码，或超过 2400 万像素限制');}finally{this.busy=false;}}
  async cleanup(){let removed=0;for(const entry of await readdir(this.directory,{withFileTypes:true})){if(!entry.isFile())continue;const match=OWN_FILE.exec(entry.name);if(!match)continue;let info;try{info=imageInfo(match[1]);}catch{continue;}if(this.now()<info.expiresAt)continue;const file=path.join(this.directory,entry.name);try{if((await lstat(file)).isFile()){await unlink(file);removed++;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}return removed;}
  async turnInput(input:ImagePart[],ids:string[]=[]){
    if(!Array.isArray(ids)||ids.length>MAX_IMAGES||new Set(ids).size!==ids.length)throw imageError('每条消息最多 20 张不同图片');
    if(!Array.isArray(input)||input.some(value=>value?.type!=='text'||typeof value.text!=='string'))throw imageError('消息仅支持文字及已上传的图片');
    if(!input.some(value=>value.text!.trim())&&!ids.length)throw imageError('请填写消息或添加图片');
    const output:ImagePart[]=[],used=new Set<string>();let count=0;
    for(const value of input)for(const part of splitImageText(value.text!,ids)){if(part.type==='text')output.push(part);else{if(++count>MAX_IMAGES)throw imageError('每条消息最多 20 个图片块');used.add(part.id);output.push({type:'localImage',path:await this.resolve(part.id)});}}
    for(const id of ids)if(!used.has(id)){if(++count>MAX_IMAGES)throw imageError('每条消息最多 20 个图片块');output.push({type:'localImage',path:await this.resolve(id)});}
    return output;
  }
}
