import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const token = (await readFile(new URL('.omega/access-token', import.meta.url), 'utf8')).trim();
const base = 'http://127.0.0.1:4310';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function rpc(method,params,extra={}) { const r=await fetch(base+'/api/rpc',{method:'POST',headers,body:JSON.stringify({method,params,...extra})}); const data=await r.json(); assert.equal(r.status,200,JSON.stringify(data)); return data; }
assert.equal((await fetch(base+'/api/status')).status,401);
const abort = new AbortController();
const streams = await Promise.all([0,1].map(async () => {const r=await fetch(base+'/api/events',{headers,signal:abort.signal});return r.body.pipeThrough(new TextDecoderStream()).getReader();}));
const events = [[],[]];
const pumps=streams.map(async(reader,i)=>{try{let buf='';while(true){const {value,done}=await reader.read();if(done)break;buf+=value;let at;while((at=buf.indexOf('\n\n'))>=0){const part=buf.slice(0,at);buf=buf.slice(at+2);const line=part.split('\n').find(x=>x.startsWith('data: '));if(line)events[i].push(JSON.parse(line.slice(6)));}}}catch{}});
try {
  const {thread}=await rpc('thread/start',{cwd:new URL('.',import.meta.url).pathname});
  console.log('Created Omega smoke thread:',thread.id);
  const submissionId=crypto.randomUUID();
  const params={threadId:thread.id,input:[{type:'text',text:'Reply with exactly OMEGA_OK. Do not call tools or change files.'}]};
  const first=await rpc('turn/start',params,{submissionId});
  const duplicate=await rpc('turn/start',params,{submissionId});
  assert.equal(first.turn.id,duplicate.turn.id);
  const until=Date.now()+90000;
  while(Date.now()<until && !events.every(list=>list.some(e=>e.method==='turn/completed' && e.params.threadId===thread.id))) await new Promise(r=>setTimeout(r,250));
  assert.ok(events.every(list=>list.some(e=>e.method==='turn/completed' && e.params.threadId===thread.id)),'both devices receive completion');
  const completed=events[0].find(e=>e.method==='turn/completed' && e.params.threadId===thread.id);
  assert.equal(completed.params.turn.status,'completed',JSON.stringify(completed.params.turn.error));
  const history=await rpc('thread/read',{threadId:thread.id,includeTurns:true});
  assert.ok(JSON.stringify(history).includes('OMEGA_OK'));
  await rpc('thread/resume',{threadId:thread.id});
  console.log('PASS: auth, real turn, duplicate prevention, two-device events, durable history and resume');
} finally {abort.abort();await Promise.all(pumps);}
