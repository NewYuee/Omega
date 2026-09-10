import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import sharp from 'sharp';
import {ImageStore,IMAGE_TTL} from '../images.mjs';

test('image HTTP routes require auth, return thumbnail, survive restart and reject invalid types',async () => {
  const state=await mkdtemp(join(tmpdir(),'omega-images-api-'));
  const port=14320;
  async function start() {
    const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'',OMEGA_CODEX_BIN:'/usr/bin/false'},stdio:['ignore','pipe','ignore']});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(Error('startup timeout'));},10000);
      child.stdout.on('data',chunk=>{if (String(chunk).includes('Omega:')) {clearTimeout(timer);resolve();}});
      child.on('error',reject);
    });
    return child;
  }
  let child=await start();
  try {
    const key=(await readFile(join(state,'access-token'),'utf8')).trim();
    const png=await sharp({create:{width:500,height:400,channels:3,background:'#235e4d'}}).png().toBuffer();
    const request=(route,options={})=>fetch('http://127.0.0.1:'+port+'/api/'+route,{...options,headers:{authorization:'Bearer '+key,...options.headers}});
    assert.equal((await fetch('http://127.0.0.1:'+port+'/api/images',{method:'POST',body:png})).status,401);
    assert.equal((await request('images',{method:'POST',headers:{'content-type':'image/svg+xml'},body:'<svg/>'})).status,415);
    assert.equal((await request('images',{method:'POST',headers:{'content-type':'image/png',origin:'https://evil.example'},body:png})).status,403);
    const upload=await request('images',{method:'POST',headers:{'content-type':'image/png'},body:png});
    assert.equal(upload.status,201);
    const image=await upload.json();
    const response=await request('images/'+image.id+'?size=thumb');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.ok((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width<=320);
    assert.equal((await request('images/no-such-id')).status,400);
    assert.equal((await fetch('http://127.0.0.1:'+port+'/api/images/'+image.id)).status,401);
    child.kill();await once(child,'exit');
    const expiredStore=new ImageStore(join(state,'images'),()=>Date.now()-IMAGE_TTL-1000);
    await expiredStore.initialize();
    const expired=await expiredStore.upload(png,'image/png');
    child=await start();
    await assert.rejects(stat(expiredStore.file(expired.id)),e=>e.code==='ENOENT');
    await assert.rejects(stat(expiredStore.file(expired.id,true)),e=>e.code==='ENOENT');
    assert.equal((await request('images/'+expired.id)).status,410);
    assert.equal((await request('images/'+image.id)).status,200);
  } finally {child.kill();await once(child,'exit');}
});
