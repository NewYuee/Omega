import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['client/src/transport.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createOmegaTransport}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));

test('transport centralizes auth, device identity and RPC envelopes',async()=>{
  const calls=[];
  const transport=createOmegaTransport({fetchImpl:async(route,options)=>{calls.push({route,options});return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}})},getKey:()=> 'secret-key',deviceId:'device-1'});
  assert.deepEqual(await transport.rpc('thread/list',{limit:5}),{ok:true});
  assert.equal(calls[0].route,'/api/rpc');
  assert.equal(calls[0].options.headers.authorization,'Bearer secret-key');
  assert.equal(calls[0].options.headers['x-omega-device'],'device-1');
  assert.deepEqual(JSON.parse(calls[0].options.body),{method:'thread/list',params:{limit:5}});
});

test('transport reports unauthorized responses and malformed proxy replies',async()=>{
  let unauthorized=0;
  const denied=createOmegaTransport({fetchImpl:async()=>new Response(JSON.stringify({error:'denied'}),{status:401}),getKey:()=> 'bad',deviceId:'device',onUnauthorized:()=>unauthorized++});
  await assert.rejects(()=>denied.request('status'),error=>error.status===401&&error.message==='denied');assert.equal(unauthorized,1);
  const malformed=createOmegaTransport({fetchImpl:async()=>new Response('<html>proxy</html>',{status:502}),getKey:()=> 'key',deviceId:'device'});
  await assert.rejects(()=>malformed.request('status'),/服务器响应格式异常（HTTP 502）/);
});
