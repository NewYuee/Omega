import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupStore} from '../groups-store.mjs';

test('room windows are bounded and support forward navigation and direct question lookup',()=>{
  const store=new GroupStore(':memory:');
  try{
    const group=store.createGroup({name:'window'},'coord','/tmp');
    for(let i=0;i<400;i++)store.addMessage(group.id,null,'user','user',String(i));
    const latest=store.roomMessages(group.id);assert.equal(latest.length,120);assert.equal(latest.at(-1).content,'399');
    const older=store.roomMessages(group.id,latest[0].id);assert.equal(older.length,120);assert.equal(older.at(-1).content,'279');
    assert.deepEqual(store.roomWindow(group.id,{after:older.at(-1).id}),latest);
    assert.deepEqual(store.roomWindow(group.id,{after:'missing'}),[]);
    assert.deepEqual(store.roomWindow('another-group',{after:older.at(-1).id}),[]);
  }finally{store.close();}
});
