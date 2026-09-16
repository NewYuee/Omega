import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repositoryView} from '../src/server/repository-view.ts';
import {GroupStore} from '../src/server/groups-store.ts';
import {groupAttention} from '../src/server/attention.ts';

test('repository view is read-only, literal, paginated and confined to thread project',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'omega-repository-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}});
  git('init');await writeFile(path.join(root,'a.txt'),'before\n');git('add','.');git('commit','-m','base');
  await writeFile(path.join(root,'a.txt'),'after\n');await writeFile(path.join(root,':(glob)*'),'untracked');
  const state=git('status','--porcelain');
  const page=await repositoryView(root,{});assert.equal(page.total,2);assert.ok(page.files.find(f=>f.status==='?'));
  assert.match((await repositoryView(root,{file:'a.txt'})).diff,/\+after/);
  await assert.rejects(repositoryView(root,{file:'../outside'}),/文件已变化/);
  assert.equal((await repositoryView(root,{file:':(glob)*'})).previewable,false);
  await mkdir(path.join(root,'nested'));await assert.rejects(repositoryView(path.join(root,'nested'),{}),/根目录在会话/);
  assert.equal(git('status','--porcelain'),state,'reading must not modify index or files');
  git('add','a.txt');assert.equal((await repositoryView(root,{scope:'staged'})).total,1);
  assert.match((await repositoryView(root,{scope:'staged',file:'a.txt'})).diff,/\+after/);
  await assert.rejects(repositoryView(root,{scope:'invalid'}),/无效/);
  for(let i=0;i<55;i++)await writeFile(path.join(root,`f${i}`),'x');
  assert.equal((await repositoryView(root,{})).files.length,50);assert.equal((await repositoryView(root,{offset:50})).files.length,6);
  await writeFile(path.join(root,'.gitattributes'),'a.txt filter=untrusted\n');git('config','filter.untrusted.clean','touch FILTER_EXECUTED; cat');
  await writeFile(path.join(root,'a.txt'),'third\n');await repositoryView(root,{file:'a.txt'});await assert.rejects(access(path.join(root,'FILTER_EXECUTED')));
});

test('repository view supports a newly initialized repository without commits',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'omega-unborn-'));execFileSync('git',['init'],{cwd:root});
  await writeFile(path.join(root,'new.txt'),'new');const page=await repositoryView(root,{});assert.equal(page.total,1);assert.ok(page.branch);
});

test('attention counts facts without messages and de-duplicates a paused decision requirement',()=>{
  const store=new GroupStore(':memory:');try{
    const db=store.db,stamp=new Date().toISOString();
    db.prepare('INSERT INTO groups(id,name,cwd,coordinator_thread_id,limits_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('g','Group','/tmp','coordinator','{}',stamp,stamp);
    db.prepare('INSERT INTO group_members(id,group_id,thread_id,name,role,created_at) VALUES(?,?,?,?,?,?)').run('m','g','thread','Member','dev',stamp);
    for(let i=0;i<35;i++)db.prepare('INSERT INTO requirements(id,group_id,content,status,created_at,updated_at,pause_kind) VALUES(?,?,?,?,?,?,?)').run(`q${i}`,'g','Question','paused',stamp,stamp,'execution');
    db.prepare('INSERT INTO tasks(id,requirement_id,group_id,position,member_id,title,objective,status,decision_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('t','q0','g',1,'m','Choose','Work','awaiting_input',JSON.stringify({id:'decision',status:'pending',title:'Choose',options:[]}),stamp,stamp);
    const page=groupAttention(store);assert.equal(page.total,35);assert.equal(page.items.length,30);assert.equal(groupAttention(store,30).items.length,5);
    const all=groupAttention(store,0,100).items;assert.equal(all.filter(item=>item.requirementId==='q0').length,1);assert.equal(all.find(item=>item.requirementId==='q0').kind,'decision');
    db.prepare("UPDATE requirements SET status='cancelled' WHERE id='q0'").run();assert.equal(groupAttention(store).total,34);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM group_messages').get().n,0);
  }finally{store.close()}
});
