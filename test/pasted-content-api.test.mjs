import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('pasted text HTTP routes require auth and return the original text',async()=>{
  const state=await mkdtemp(join(tmpdir(),'omega-paste-api-')),port=14321;
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'',OMEGA_CODEX_BIN:'/usr/bin/false'},stdio:['ignore','pipe','ignore']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('startup timeout'));},10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Omega:')){clearTimeout(timer);resolve();}});child.on('error',reject);});
  try{
    const key=(await readFile(join(state,'access-token'),'utf8')).trim(),url=`http://127.0.0.1:${port}/api/pasted-text`,text='这里是一段需要作为文件保存的长文本。';
    assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'text/plain'},body:text})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'})).status,415);
    const uploaded=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'text/plain; charset=utf-8'},body:text});
    assert.equal(uploaded.status,201);
    const ref=await uploaded.json();
    assert.equal(ref.chars,[...text].length);
    const fetched=await fetch(url+'/'+ref.id,{headers:{authorization:'Bearer '+key}});
    assert.equal(fetched.status,200);assert.equal(await fetched.text(),text);assert.equal(fetched.headers.get('cache-control'),'no-store');
  }finally{child.kill();await once(child,'exit');}
});
