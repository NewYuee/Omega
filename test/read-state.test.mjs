import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadStateStore} from '../src/server/read-state.ts';

test('read state persists unread scopes and clears them globally',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'omega-read-state-')),file=join(dir,'read-state.sqlite');
  let store=new ReadStateStore(file);
  store.markUnread('thread','t1','turn-1');store.markUnread('thread','t1','turn-2');store.markUnread('group','g1','requirement-1');store.close();
  store=new ReadStateStore(file);
  assert.deepEqual(store.snapshot(),{unread:{threads:['t1'],groups:['g1']},counts:{threads:{t1:2},groups:{g1:1}},positions:{threads:{t1:'turn-1'},groups:{g1:'requirement-1'}}});
  assert.equal(store.markRead('thread','t1'),true);assert.equal(store.markRead('thread','t1'),false);
  assert.deepEqual(store.snapshot(),{unread:{threads:[],groups:['g1']},counts:{threads:{},groups:{g1:1}},positions:{threads:{},groups:{g1:'requirement-1'}}});store.close();
});
