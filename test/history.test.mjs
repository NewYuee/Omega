import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPage,paginatedHistoryPage,PAGE_SIZE,TURN_PAGE_SIZE,ITEM_PAGE_SIZE} from '../history.mjs';
test('large history returns outline and only selected text page; tool bodies deferred', () => {
  const thread={id:'demo',turns:Array.from({length:1000},(_,i)=>({id:'t'+i,items:[
    {id:'u'+i,type:'userMessage',content:[{text:'Question '+i}]},
    {id:'a'+i,type:'agentMessage',text:'x'.repeat(50000)},
    {id:'c'+i,type:'commandExecution',aggregatedOutput:'z'.repeat(50000)}
  ]}))};
  const page=historyPage(thread);
  assert.equal(page.outline.length,1000);
  assert.equal(page.turn.id,'t999');
  assert.equal(page.turn.items[1].pageText.length,PAGE_SIZE);
  assert.equal(page.turn.items[2].pageText,'');
  assert.ok(JSON.stringify(page).length<100000);
  const older=historyPage(thread,{turnId:'t3',itemId:'a3',offset:12000});
  assert.equal(older.turn.items.length,1);
  assert.equal(older.turn.items[0].offset,12000);
  assert.equal(older.turn.items[0].pageText.length,PAGE_SIZE);
});

test('App Server history stays bounded and loads only the selected turn in full',async()=>{
  const calls=[];
  const summaries=Array.from({length:TURN_PAGE_SIZE},(_,index)=>({id:'t'+index,status:'completed',items:[{id:'u'+index,type:'userMessage',content:[{text:'Question '+index}]}]}));
  const rpc={request:async(method,params)=>{calls.push({method,params});
    if(method==='thread/turns/list')return{data:[...summaries].reverse(),nextCursor:'older-page'};
    if(method==='thread/items/list')return{data:[
      {turnId:params.turnId,item:{id:'answer',type:'agentMessage',text:'final answer'}},
      {turnId:params.turnId,item:{id:'tool',type:'commandExecution',aggregatedOutput:'x'.repeat(PAGE_SIZE*2)}},
    ].reverse(),nextCursor:'older-items'};
    throw Error('unexpected '+method);
  }};
  const page=await paginatedHistoryPage(rpc,{id:'thread',name:'Long thread',cwd:'/tmp'});
  assert.equal(page.outline.length,TURN_PAGE_SIZE);
  assert.equal(page.outline[0].id,'t0');
  assert.equal(page.turn.id,'t'+(TURN_PAGE_SIZE-1));
  assert.equal(page.turn.items.find(item=>item.id==='answer').pageText,'final answer');
  assert.equal(page.turn.items.find(item=>item.id==='tool').pageText,'');
  assert.equal(page.nextCursor,'older-page');
  assert.equal(page.itemsTruncated,true);
  assert.deepEqual(calls.map(call=>call.method),['thread/turns/list','thread/items/list']);
  assert.equal(calls[0].params.limit,TURN_PAGE_SIZE);
  assert.equal(calls[0].params.itemsView,'summary');
  assert.equal(calls[1].params.limit,ITEM_PAGE_SIZE);
});

test('turn selection skips outline hydration and older outline skips item hydration',async()=>{
  const calls=[];
  const rpc={request:async(method,params)=>{calls.push({method,params});return method==='thread/items/list'
    ?{data:[{turnId:'chosen',item:{id:'answer',type:'agentMessage',text:'chosen'}}],nextCursor:null}
    :{data:[{id:'old',status:'completed',items:[{id:'u',type:'userMessage',content:[{text:'old'}]}]}],nextCursor:null};}};
  const selected=await paginatedHistoryPage(rpc,{id:'thread'},{turnId:'chosen',selectionOnly:true});
  assert.equal(selected.outline,null);assert.equal(selected.turn.id,'chosen');
  assert.deepEqual(calls.map(call=>call.method),['thread/items/list']);
  calls.length=0;
  const older=await paginatedHistoryPage(rpc,{id:'thread'},{cursor:'opaque',outlineOnly:true});
  assert.equal(older.turn,null);assert.equal(older.outline[0].id,'old');
  assert.deepEqual(calls.map(call=>call.method),['thread/turns/list']);
});
