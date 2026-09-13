import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Bridge} from '../bridge.mjs';

test('bridge restarts and initializes Codex App Server after an unexpected exit',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-bridge-')),counter=path.join(dir,'starts');
  const bridge=new Bridge(process.execPath,[path.resolve('fixtures/restarting-app-server.mjs'),counter]);
  try{
    await assert.rejects(bridge.initialize());
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('reconnect timeout')),5000);
      const listener=event=>{if(event.method!=='omega/reconnected')return;clearTimeout(timer);bridge.off('event',listener);resolve()};
      bridge.on('event',listener);
    });
    assert.equal(bridge.ready,true);
    assert.deepEqual(await bridge.request('ping'),{ready:true});
  }finally{bridge.close()}
});
