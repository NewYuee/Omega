import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AutomationStore,nextRun} from '../src/server/automation-store.ts';
import {AutomationService} from '../src/server/automation-service.ts';
import {DatabaseSync} from 'node:sqlite';

test('automation schedule persists and a completed turn updates status',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-automation-')),store=new AutomationStore(path.join(dir,'automation.sqlite')),events=[];
  try{
    const automation=store.create({name:'状态检查',threadId:'thread-1',prompt:'检查项目状态',schedule:{kind:'interval',minutes:5},enabled:true});
    assert.equal(automation.lastStatus,'idle');assert.ok(Date.parse(automation.nextRunAt)>Date.now());
    const service=new AutomationService(store,async()=>({turn:{id:'turn-1'}}),()=>false,event=>events.push(event));
    const started=await service.run(automation,true);assert.equal(started.turnId,'turn-1');assert.equal(store.get(automation.id).lastStatus,'running');
    service.complete('turn-1',true);assert.equal(store.get(automation.id).lastStatus,'completed');assert.ok(events.length>=2);service.close();
  }finally{store.close();}
});

test('daily schedule produces a future occurrence in the requested timezone',()=>{
  const value=nextRun({kind:'daily',time:'09:30',timezone:'Asia/Shanghai'},new Date('2026-09-13T03:00:00Z'));
  assert.equal(value,'2026-09-14T01:30:00.000Z');
});

const create=store=>store.create({name:'巡检',threadId:'thread',prompt:'检查',schedule:{kind:'interval',minutes:5},enabled:true});
test('busy automation queues once, then records start and cancelled completion',async()=>{
  const store=new AutomationStore(':memory:');let busy=true,calls=0;const service=new AutomationService(store,async()=>{calls++;return{turn:{id:'turn'}}},()=>busy,()=>{});
  try{const item=create(store);await service.run(item,true);await service.run(store.get(item.id));assert.equal(store.runs(item.id).items.length,1);assert.equal(calls,0);assert.equal(store.get(item.id).lastStatus,'waiting');busy=false;await service.tick();assert.equal(calls,1);service.complete('turn',false,undefined,true);const run=store.runs(item.id).items[0];assert.equal(run.status,'cancelled');assert.ok(run.started_at&&run.finished_at);assert.equal(run.manual,1);}finally{service.close();store.close()}
});
test('unknown start never automatically replays; definite pre-dispatch failure is separate',async()=>{
  const store=new AutomationStore(':memory:');const item=create(store);let calls=0;const service=new AutomationService(store,async()=>{calls++;throw Error('timeout')},()=>false,()=>{});
  try{await assert.rejects(service.run(item));assert.equal(store.get(item.id).lastStatus,'unknown');assert.equal(store.runs(item.id).items[0].finished_at,null);await assert.rejects(service.run(item),/不能再次/);assert.equal(calls,1);await service.tick();assert.equal(calls,1);assert.throws(()=>store.remove(item.id),/待核对/);
    const other=create(store),safe=new AutomationService(store,async()=>{throw Object.assign(Error('conflict'),{definiteNotStarted:true})},()=>false,()=>{});await assert.rejects(safe.run(other));assert.equal(store.get(other.id).lastStatus,'failed');safe.close();
  }finally{service.close();store.close()}
});
test('early completion before start response is retained',async()=>{
  const store=new AutomationStore(':memory:');const item=create(store);let service;
  service=new AutomationService(store,async()=>{service.complete('fast',true);return{turn:{id:'fast'}}},()=>false,()=>{});
  try{await service.run(item);assert.equal(store.get(item.id).lastStatus,'completed');assert.equal(store.runs(item.id).items[0].status,'completed');}finally{service.close();store.close()}
});
test('automation history survives restart, paginates, and old running state becomes unknown',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-run-history-')),file=path.join(dir,'runs.sqlite');let store=new AutomationStore(file);const item=create(store);
  for(let i=0;i<32;i++){store.begin(item.id,`t${i}`);store.finishByTurn(`t${i}`,true)}
  const first=store.runs(item.id);assert.equal(first.items.length,30);assert.equal(store.runs(item.id,Number(first.nextCursor)).items.length,2);
  store.begin(item.id,'pending');store.close();store=new AutomationStore(file);
  try{assert.equal(store.get(item.id).lastStatus,'unknown');assert.equal(store.runs(item.id).items[0].status,'unknown');assert.equal(store.due(new Date('2099-01-01')).length,0);store.finishByTurn('pending',true);assert.equal(store.get(item.id).lastStatus,'completed');assert.equal(store.runs(item.id).items[0].status,'completed');}finally{store.close()}
});
test('pausing a waiting automation cancels only its queued run',()=>{
  const store=new AutomationStore(':memory:');try{const item=create(store);store.wait(item.id);store.update(item.id,{enabled:false});assert.equal(store.runs(item.id).items[0].status,'cancelled');assert.equal(store.due().length,0);}finally{store.close()}
});
test('cancelling a due queued run skips this occurrence instead of immediately requeuing',()=>{
  const store=new AutomationStore(':memory:');try{const item=create(store);store.wait(item.id);store.cancelWaiting(item.id);assert.equal(store.due().length,0);assert.equal(store.get(item.id).lastStatus,'cancelled');assert.ok(Date.parse(store.get(item.id).nextRunAt)>Date.now());}finally{store.close()}
});
test('run insertion and automation state roll back together on write failure',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-atomic-')),file=path.join(dir,'runs.sqlite'),store=new AutomationStore(file),item=create(store),db=new DatabaseSync(file);
  try{db.exec("CREATE TRIGGER deny_wait BEFORE UPDATE OF last_status ON automations WHEN NEW.last_status='waiting' BEGIN SELECT RAISE(ABORT,'test failure'); END");assert.throws(()=>store.wait(item.id),/test failure/);assert.equal(store.runs(item.id).items.length,0);assert.equal(store.get(item.id).lastStatus,'idle');}finally{db.close();store.close()}
});
