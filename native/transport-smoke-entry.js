import {fetch} from '@tauri-apps/plugin-http';
import {requestNative} from './transport.js';
const headers={authorization:'Bearer transport-fixture-only'};
try {
  const control=await fetch(SMOKE_URL+'/api/status',{headers,maxRedirections:0});
  if(control.status!==403)throw new Error('Control must reproduce Origin rejection');
  await control.body.cancel();
  const status=await requestNative(fetch,SMOKE_URL+'/api/status',{headers});
  if(status.status!==200 || !(await status.json()).ready)throw new Error('Suppressed Origin failed');
  const controller=new AbortController();
  const stream=await requestNative(fetch,SMOKE_URL+'/api/events',{headers,signal:controller.signal});
  const reader=stream.body.getReader();
  let text='';
  while(!text.includes('second')) {const part=await reader.read();if(part.done)throw new Error('SSE ended early');text+=new TextDecoder().decode(part.value);}
  controller.abort();
  await requestNative(fetch,SMOKE_URL+'/api/result',{headers,method:'POST',body:JSON.stringify({ok:true})});
} catch(e) {
  await requestNative(fetch,SMOKE_URL+'/api/result',{headers,method:'POST',body:JSON.stringify({ok:false,error:String(e.message||e)})});
}
