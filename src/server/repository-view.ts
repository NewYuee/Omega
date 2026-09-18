import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath,lstat,opendir} from 'node:fs/promises';
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
  catch(error){
    const e=error as {code?:unknown;killed?:boolean;stderr?:string};
    if(e.code==='ENOENT')throw failure('服务端未找到 Git，请检查 Git 安装及服务的 PATH。');
    if(e.killed)throw failure('读取 Git 超过 10 秒，已停止，请稍后重试。');
    if(e.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')throw failure('Git 输出超过预览大小限制，请在本地查看。');
    if(e.stderr?.includes('not a git repository'))throw failure('所选目录不是可用的 Git 工作仓库，请重新选择。');
    throw failure('无法读取所选仓库，请检查目录权限及 Git 配置。');
  }
}
type ViewInput={scope?:string;file?:string;offset?:number;repository?:string};
const within=(base:string,target:string)=>{const rel=path.relative(base,target);return rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
async function hasGit(directory:string){return lstat(path.join(directory,'.git')).then(s=>s.isDirectory()||s.isFile(),()=>false);}
async function discoverRepositories(directory:string){
  const repositories:Array<{id:string;name:string}>=[];
  if(await hasGit(directory))repositories.push({id:'.',name:path.basename(directory)});
  let count=0,truncated=false;
  const entries=await opendir(directory);
  for await(const entry of entries){
    if(++count>200){truncated=true;break;}
    if(!entry.isDirectory()||entry.name.startsWith('.')||['node_modules','vendor'].includes(entry.name))continue;
    const candidate=await realpath(path.join(directory,entry.name)).catch(()=>null);
    if(candidate&&within(directory,candidate)&&await hasGit(candidate))repositories.push({id:entry.name,name:entry.name});
  }
  repositories.sort((a,b)=>a.id==='.'?-1:b.id==='.'?1:a.name.localeCompare(b.name));
  return{repositories,truncated};
}
let readers=0;
export async function repositoryView(cwd:string,input:ViewInput){
  if(readers>=2)throw failure('仓库读取繁忙，请稍后重试。',429);
  readers++;try{return await readRepository(cwd,input)}finally{readers--;}
}
async function readRepository(cwd:string,input:ViewInput){
  const directory=await realpath(cwd),discovery=await discoverRepositories(directory);
  const selection=input.repository??(discovery.repositories[0]?.id==='.'?'.':discovery.repositories.length===1?discovery.repositories[0].id:'');
  const base={directory,...discovery};
  if(!selection){
    if(input.file!==undefined)throw failure('请先选择仓库');
    return{...base,root:null,files:[],total:0,nextOffset:null,message:discovery.repositories.length?'此会话目录下有多个仓库，请选择要查看的项目。':'当前目录及直属子目录未找到 Git 仓库，请选择仓库对应的会话。'};
  }
  if(typeof selection!=='string'||!discovery.repositories.some(r=>r.id===selection))throw failure('所选仓库不在会话工作目录的可选范围内，请刷新后重新选择。',403);
  const selected=await realpath(path.join(directory,selection));
  if(!within(directory,selected))throw failure('不能访问会话工作目录之外的仓库。',403);
  const root=await realpath((await git(selected,['rev-parse','--show-toplevel'])).trim());
  if(root!==selected)throw failure('仓库根目录不在所选目录，请从仓库根目录会话查看。',403);
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
  return{...base,repository:selection,root,branch,scope,total:files.length,files:files.slice(offset,offset+50),nextOffset:offset+50<files.length?offset+50:null};
}
