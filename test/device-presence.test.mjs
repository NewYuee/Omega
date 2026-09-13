import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';

async function availablePort(){
  const socket=net.createServer();
  socket.listen(0,'127.0.0.1');
  await once(socket,'listening');
  const address=socket.address();
  const port=typeof address==='object'&&address?address.port:0;
  socket.close();
  await once(socket,'close');
  return port;
}

async function openEvents(base,token,deviceId,lastEventId=0){
  const controller=new AbortController();
  const response=await fetch(`${base}/api/events`,{
    headers:{authorization:`Bearer ${token}`,'x-omega-device':deviceId,...(lastEventId?{'last-event-id':String(lastEventId)}:{})},
    signal:controller.signal,
  });
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  return {controller,reader};
}

async function nextEvent(reader,method){
  let text='';
  for(let index=0;index<10;index++){
    const {value,done}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);
    for(const block of text.split('\n\n')){
      const lines=block.split('\n'),data=lines.find(line=>line.startsWith('data: '));if(!data)continue;
      const event=JSON.parse(data.slice(6));if(event.method===method)return{id:Number(lines.find(line=>line.startsWith('id: '))?.slice(4)||0),event};
    }
  }
  throw Error(`event ${method} not received`);
}

test('online presence counts stable devices rather than SSE connections',async()=>{
  const state=await mkdtemp(join(tmpdir(),'omega-device-test-'));
  const port=await availablePort();
  const token='device-test-key';
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),
    env:{...process.env,PORT:String(port),OMEGA_HOST:'127.0.0.1',OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:token,OMEGA_CODEX_BIN:'/usr/bin/false'},
    stdio:['ignore','pipe','ignore'],
  });
  const streams=[];
  const status=async()=>{
    const response=await fetch(`${base}/api/status`,{headers:{authorization:`Bearer ${token}`}});
    assert.equal(response.status,200);
    return response.json();
  };
  try{
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('startup timeout')),10000);
      child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
      child.once('error',reject);
    });
    streams.push(await openEvents(base,token,'device-alpha'));
    streams.push(await openEvents(base,token,'device-alpha'));
    assert.equal((await status()).devices,1);
    streams.push(await openEvents(base,token,'device-beta'));
    assert.equal((await status()).devices,2);
    streams[2].controller.abort();
    await assert.rejects(streams[2].reader.read());
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal((await status()).devices,1);

    const markRead=id=>fetch(`${base}/api/read-state`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({scope:'thread',id})});
    assert.equal((await markRead('thread-one')).status,200);
    const first=await nextEvent(streams[0].reader,'omega/read-state');assert.ok(first.id>0);
    streams[0].controller.abort();await assert.rejects(streams[0].reader.read());
    assert.equal((await markRead('thread-two')).status,200);
    const resumed=await openEvents(base,token,'device-alpha',first.id);streams.push(resumed);
    const replay=await nextEvent(resumed.reader,'omega/read-state');assert.equal(replay.event.params.id,'thread-two');assert.ok(replay.id>first.id);
  }finally{
    for(const stream of streams)stream.controller.abort();
    child.kill();
    await once(child,'exit');
  }
});
