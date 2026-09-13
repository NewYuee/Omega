import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AutomationStore,nextRun} from '../src/server/automation-store.ts';
import {AutomationService} from '../src/server/automation-service.ts';

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
