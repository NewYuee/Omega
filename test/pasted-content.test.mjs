import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_PASTED_TEXT_BYTES,PASTED_TEXT_TTL,PastedTextStore} from '../pasted-content.mjs';

test('pasted text is stored as a private file and expanded only for model input',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'omega-paste-')),store=new PastedTextStore(directory);
  await store.initialize();
  const uploaded=await store.upload(Buffer.from('第一行\n第二行','utf8'));
  assert.equal(uploaded.chars,7);
  assert.equal((await stat(store.file(uploaded.id))).mode&0o777,0o600);
  const input=await store.turnInput([{type:'text',text:`请参考 [Pasted Content ${uploaded.chars} chars]`}],[uploaded.id]);
  assert.equal(input[0].text,`请参考 [Pasted Content ${uploaded.chars} chars]`);
  assert.match(input[1].text,/Pasted Content 7 chars\.txt/);
  assert.match(input[1].text,/第一行\n第二行/);
});

test('pasted text validates limits and removes expired files',async()=>{
  const clock={now:Date.now()-PASTED_TEXT_TTL-1000},directory=await mkdtemp(join(tmpdir(),'omega-paste-expired-')),store=new PastedTextStore(directory,()=>clock.now);
  await store.initialize();
  await assert.rejects(store.upload(Buffer.alloc(MAX_PASTED_TEXT_BYTES+1)),/512 KB/);
  await assert.rejects(store.upload(Buffer.from([0xff])),/UTF-8/);
  const uploaded=await store.upload(Buffer.from('will expire'));
  clock.now=Date.now();
  assert.equal(await store.cleanup(),1);
  await assert.rejects(store.resolve(uploaded.id),/已过期|不存在/);
});
