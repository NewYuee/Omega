import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TurnMetrics} from '../metrics.mjs';
const usage=(input,output)=>({inputTokens:input,outputTokens:output,totalTokens:input+output,cachedInputTokens:Math.floor(input/2),reasoningOutputTokens:Math.floor(output/2)});
const token=(turnId,input,output)=>({method:'thread/tokenUsage/updated',params:{threadId:'thread',turnId,tokenUsage:{total:usage(input,output),last:usage(99,9)}}});
async function fixture() {
  let now=10000;
  const dir=await mkdtemp(path.join(tmpdir(),'omega-metrics-'));
  const store=new TurnMetrics(dir,()=>now);await store.initialize();
  return {store,dir,tick:n=>{now+=n;}};
}
test('multiple calls use cumulative delta; duplicate and replay snapshots do not add tokens',async()=>{
  const {store,dir,tick}=await fixture();
  await store.observe(token('older',1000,100));
  await store.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'turn',startedAt:10}}});
  await store.observe(token('turn',1100,120));
  await store.observe(token('turn',1500,200));
  await store.observe(token('turn',1500,200));
  tick(5000);
  const final=await store.observe({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',durationMs:5000}}});
  assert.equal(final.metrics.usage.inputTokens,500);
  assert.equal(final.metrics.usage.outputTokens,100);
  assert.equal(final.metrics.durationMs,5000);
  const restored=new TurnMetrics(dir);await restored.initialize();
  const read=await restored.view('thread',{id:'turn',status:'completed'});
  assert.deepEqual(read,final.metrics);
  await restored.observe(token('turn',1500,200));
  assert.equal((await restored.view('thread',{id:'turn'})).usage.outputTokens,100);
});
test('new threads start at zero; missing baseline and resetting counters remain unavailable',async()=>{
  const {store}=await fixture();store.seed('thread');
  await store.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'a'}}});
  assert.equal((await store.observe(token('a',100,20))).metrics.usage.outputTokens,20);
  await store.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'b'}}});
  assert.equal((await store.observe(token('b',1,1))).metrics.usage,null);
  const other=(await fixture()).store;
  await other.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'a'}}});
  assert.equal((await other.observe(token('a',100,20))).metrics.usage,null);
  const reset=(await fixture()).store;reset.seed('thread');
  await reset.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'a'}}});
  await reset.observe(token('a',100,20));
  assert.equal((await reset.observe(token('a',50,10))).metrics.usage,null);
});
test('old timing comes from history, not fabricated token estimates; interrupted turns keep duration',async()=>{
  const {store,tick}=await fixture();
  const old=await store.view('thread',{id:'old',status:'completed',startedAt:1,completedAt:3});
  assert.equal(old.durationMs,2000);assert.equal(old.usage,null);
  const absent=await store.view('thread',{id:'missing',status:'completed'});
  assert.equal(absent.elapsedMs,null);
  await store.observe({method:'turn/started',params:{threadId:'thread',turn:{id:'stopped'}}});
  tick(1000);
  const stopped=await store.observe({method:'turn/completed',params:{threadId:'thread',turn:{id:'stopped',status:'interrupted'}}});
  assert.equal(stopped.metrics.elapsedMs,1000);assert.equal(stopped.metrics.running,false);
});
