import {mkdir,writeFile,readFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

// Immutable, private copies let a receiving member read omitted details on demand.
export async function handoffFiles(directory:string,tasks:Record<string,any>[]) {
  if(!tasks.length)return{};
  await mkdir(directory,{recursive:true,mode:0o700});
  const files:Record<string,string>={};
  for(const task of tasks){const content=String(task.result||''),key=createHash('sha256').update(String(task.id)+'\n'+content).digest('hex');const file=path.resolve(directory,key+'.txt');
    const existing=await readFile(file,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return null});
    if(existing!==content){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error});}}
    files[task.id]=file;
  }
  return files;
}
