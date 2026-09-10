import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPage,PAGE_SIZE} from '../history.mjs';
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
