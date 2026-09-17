import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('key rotation requires authentication, persists, and revokes old access', async () => {
  const state = await mkdtemp(join(tmpdir(),'omega-key-test-'));
  const port = 14319;
  const start = async () => {
    const child = spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'',OMEGA_CODEX_BIN:'/usr/bin/false'},stdio:['ignore','pipe','ignore']});
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('startup timeout'));},10000);child.stdout.on('data',()=>{clearTimeout(timeout);resolve();});child.on('error',reject);});return child;
  };
  let child = await start();
  const request = (key,route='status',body) => fetch(`http://127.0.0.1:${port}/api/${route}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  try {
    const old = (await readFile(join(state,'access-token'),'utf8')).trim();
    const next = 'TestKey8';
    assert.equal((await request('wrong','feishu')).status,401);
    assert.equal((await request('wrong','feishu',{action:'connect',appId:'cli_1234567890abcdef',appSecret:'test'})).status,401);
    const feishu=await (await request(old,'feishu')).json();
    assert.equal(feishu.enabled,false);assert.equal(feishu.hasSecret,false);assert.ok(feishu.revision);
    assert.equal((await request(old,'feishu',{action:'disable',revision:'stale'})).status,409);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/feishu`,{method:'POST',headers:{authorization:`Bearer ${old}`,'content-type':'application/json',origin:'https://untrusted.example'},body:JSON.stringify({action:'disable',revision:feishu.revision})})).status,403);
    assert.equal((await request('wrong','access-key',{accessKey:next})).status,401);
    assert.equal((await request(old,'access-key',{accessKey:'short'})).status,400);
    for (const accessKey of ['1234567',' TestKey8','TestKey8 ','Test\nKey8','x'.repeat(257)]) {
      assert.equal((await request(old,'access-key',{accessKey})).status,400);
    }
    assert.equal((await request(old,'access-key',{accessKey:next})).status,200);
    assert.equal((await request(old)).status,401);
    assert.equal((await request(next)).status,200);
    assert.equal(await readFile(join(state,'access-token'),'utf8'),next);
    child.kill();await once(child,'exit'); child = await start();
    assert.equal((await request(next)).status,200);
    assert.equal((await request(old)).status,401);
  } finally {child.kill();await once(child,'exit');}
});
