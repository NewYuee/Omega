import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
const failure=(message:string,status=400)=>Object.assign(new Error(message),{status});
async function git(cwd:string,args:string[],maxBuffer=2*1024*1024){
  const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'};
  for(const key of Object.keys(env))if(key.startsWith('GIT_')&&!['GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT'].includes(key))delete (env as Record<string,unknown>)[key];
  const base=['--literal-pathspecs','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath=/dev/null'];
  const options={cwd,env,timeout:10000,maxBuffer,encoding:'utf8' as const};
  try{
    // Built-in diff can run clean filters too, not only external diff/textconv.
    let filterKeys='';try{filterKeys=(await exec('git',[...base,'config','--includes','--null','--name-only','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$'],options)).stdout;}catch(e){if((e as {code?:unknown}).code!==1)throw e;}
    const overrides=filterKeys.split('\0').filter(Boolean).flatMap(key=>['-c',`${key}=${key.endsWith('.required')?'false':''}`]);
    return(await exec('git',[...base,...overrides,...args],options)).stdout;
  }
  catch{throw failure('无法读取 Git 状态：请确认仓库可用；超大输出或超过 10 秒的操作不会继续加载。');}
}
type ViewInput={scope?:string;file?:string;offset?:number};
let readers=0;
export async function repositoryView(cwd:string,input:ViewInput){
  if(readers>=2)throw failure('仓库读取繁忙，请稍后重试。',429);
  readers++;try{return await readRepository(cwd,input)}finally{readers--;}
}
async function readRepository(cwd:string,input:ViewInput){
  const directory=await realpath(cwd),root=await realpath((await git(directory,['rev-parse','--show-toplevel'])).trim());
  const relative=path.relative(directory,root);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw failure('仓库根目录在会话工作目录之外，请从仓库根目录会话查看。',403);
  const scope=input.scope||'unstaged';if(!['staged','unstaged'].includes(scope))throw failure('无效的变更范围');
  const args=['diff','--no-ext-diff','--no-textconv','--no-renames',...(scope==='staged'?['--cached']:[])];
  const names=(await git(root,[...args,'--name-status','-z','--'])).split('\0');
  const files:Array<{path:string;status:string}>=[];
  for(let i=0;i+1<names.length;i+=2)if(names[i+1])files.push({status:names[i],path:names[i+1]});
  if(scope==='unstaged')for(const file of (await git(root,['ls-files','--others','--exclude-standard','-z'])).split('\0'))if(file)files.push({path:file,status:'?'});
  if(input.file!==undefined){
    const entry=files.find(file=>file.path===input.file);if(!entry)throw failure('文件已变化，请刷新列表后重试。',409);
    if(entry.status==='?')return{file:entry.path,diff:'未跟踪文件：此版仅列出文件名，不读取文件内容。',previewable:false};
    const diff=await git(root,[...args,'--no-color','--unified=3','--',entry.path],512*1024);
    return{file:entry.path,diff,previewable:true};
  }
  const offset=Math.max(0,Math.floor(input.offset||0)),branch=(await git(root,['symbolic-ref','--short','-q','HEAD']).catch(()=> 'detached HEAD')).trim();
  return{root,branch,scope,total:files.length,files:files.slice(offset,offset+50),nextOffset:offset+50<files.length?offset+50:null};
}
