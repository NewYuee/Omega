import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatHistoryPager} from '../client/src/chat-history-pager.ts';

test('scroll pager prepends older turns across cursor pages without changing selection',async()=>{
  const calls=[];
  const pager=createChatHistoryPager(async request=>{
    calls.push(request);
    if(request.outlineOnly)return{outline:[{id:'old1'},{id:'old2'}],nextCursor:null};
    return{turn:{items:[{id:'message-'+request.turnId,pageText:request.turnId}]}};
  });
  const scope={threadId:'thread',selectedTurn:'new2',outline:[{id:'new1'},{id:'new2'}],olderCursor:'cursor-old',pageCursor:null};
  const first=await pager.load(scope,()=>true),second=await pager.load(scope,()=>true),third=await pager.load(scope,()=>true);
  assert.deepEqual([first.turnId,second.turnId,third.turnId],['new1','old2','old1']);
  assert.deepEqual([first.hasMore,second.hasMore,third.hasMore],[true,true,false]);
  assert.equal(second.items[0].historyCursor,'cursor-old');
  assert.deepEqual(calls,[
    {threadId:'thread',turnId:'new1',cursor:undefined,selectionOnly:true},
    {threadId:'thread',cursor:'cursor-old',outlineOnly:true},
    {threadId:'thread',turnId:'old2',cursor:'cursor-old',selectionOnly:true},
    {threadId:'thread',turnId:'old1',cursor:'cursor-old',selectionOnly:true}
  ]);
  assert.equal(await pager.load(scope,()=>true),null);
  pager.reset();assert.equal((await pager.load(scope,()=>true)).turnId,'new1');
});

test('outdated pages do not enter the next conversation',async()=>{
  let release;
  const pending=new Promise(resolve=>release=resolve);
  const pager=createChatHistoryPager(async()=>pending);
  const stale=pager.load({threadId:'a',selectedTurn:'a1',outline:[{id:'a0'},{id:'a1'}],olderCursor:null,pageCursor:null},()=>false);
  pager.reset();release({turn:{items:[{id:'leak'}]}});
  assert.equal(await stale,null);
  const next=await pager.load({threadId:'b',selectedTurn:'b1',outline:[{id:'b0'},{id:'b1'}],olderCursor:null,pageCursor:null},()=>true);
  assert.equal(next.turnId,'b0');
  assert.equal(next.items[0].turnId,'b0');
});
