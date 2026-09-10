import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ModelSettings} from '../model-settings.mjs';
const id='00000000-0000-4000-8000-000000000000';
const catalog=[{model:'a',displayName:'A',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],inputModalities:['text','image']},
  {model:'b',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}],inputModalities:['text']}];
test('model settings validate dynamic capabilities, persist and protect concurrent device edits',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-models-'));
  const store=new ModelSettings(dir,async()=>({data:catalog,nextCursor:null}));await store.initialize();
  assert.deepEqual(await store.read(id),{model:null,effort:null,revision:0});
  await assert.rejects(store.read('../bad'),/ID/);
  await assert.rejects(store.save(id,{model:'missing',effort:null},0),/可用列表/);
  await assert.rejects(store.save(id,{model:'a',effort:'high'},0),/推理等级/);
  await assert.rejects(store.save(id,{model:null,effort:'high'},0),/先选择模型/);
  const settings=await store.save(id,{model:'a',effort:null},0);
  assert.deepEqual(await store.resolve(settings),{model:'a',effort:'medium'});
  const restarted=new ModelSettings(dir,async()=>({data:catalog}));await restarted.initialize();
  assert.deepEqual(await restarted.read(id),settings);
  await assert.rejects(store.save(id,{model:'b',effort:null},0),e=>e.status===409);
  const writes=await Promise.allSettled([store.save(id,{model:'a',effort:'low'},1),store.save(id,{model:'b',effort:null},1)]);
  assert.equal(writes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await store.read(id)).revision,2);
  await assert.rejects(store.resolve({model:'b',effort:null},true),/不支持图片/);
  assert.deepEqual(await store.resolve({model:null,effort:null}),{});
});
test('model catalog follows pagination and recovers from failed fetches',async()=>{
  let fail=true,calls=0;
  const store=new ModelSettings('/unused',async(method,params)=>{
    calls++;if(fail)throw Error('offline');
    return params.cursor?{data:[catalog[1]],nextCursor:null}:{data:[catalog[0]],nextCursor:'next'};
  });
  await assert.rejects(store.models(),/offline/);fail=false;
  assert.equal((await store.models()).length,2);
  assert.equal((await store.models()).length,2);assert.equal(calls,3);
});
