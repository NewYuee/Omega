import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const requests=[];
let finish;
const result=new Promise(resolve=>{finish=resolve;});
const server=createServer(async(req,res)=>{
  requests.push({path:req.url,origin:req.headers.origin,authorized:req.headers.authorization==='Bearer transport-fixture-only'});
  if(req.headers.authorization!=='Bearer transport-fixture-only'){res.writeHead(401);return res.end('{}');}
  if(req.headers.origin){res.writeHead(403);return res.end('{"error":"Origin rejected"}');}
  if(req.url==='/api/events') {
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');
    const timer=setTimeout(()=>res.write('data: second\n\n'),100);
    req.on('close',()=>clearTimeout(timer));return;
  }
  if(req.url==='/api/result'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    finish(JSON.parse(Buffer.concat(chunks).toString()));res.end('{}');return;
  }
  res.setHeader('content-type','application/json');res.end('{"ready":true}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir('.toolchains/native-smoke-ui',{recursive:true});
await writeFile('.toolchains/native-smoke-ui/index.html','<!doctype html><html><body><script type="module" src="/app.js"></script></body></html>');
await build({entryPoints:['native/transport-smoke-entry.js'],bundle:true,format:'esm',outfile:'.toolchains/native-smoke-ui/app.js',define:{SMOKE_URL:JSON.stringify('http://127.0.0.1:'+server.address().port)}});
const env={...process.env,CARGO_HOME:path.resolve('.toolchains/cargo'),RUSTUP_HOME:path.resolve('.toolchains/rustup')};
env.PATH=path.join(env.CARGO_HOME,'bin')+path.delimiter+env.PATH;
const child=spawn(path.join(env.CARGO_HOME,'bin','cargo'),['run','--manifest-path','src-tauri/Cargo.toml','--release','--features','tauri/custom-protocol','--example','transport_smoke'],{env,stdio:'inherit'});
const timer=setTimeout(()=>finish({ok:false,error:'Native transport timeout'}),240000);
child.on('exit',code=>finish({ok:false,error:'Native harness exited '+code+'; requests='+JSON.stringify(requests)}));
try {
  const value=await result;assert.equal(value.ok,true,value.error);
  assert.equal(requests[0].origin,'tauri://localhost');
  assert.ok(requests.slice(1).every(r=>r.authorized && r.origin===undefined));
  assert.ok(requests.some(r=>r.path==='/api/events'));
  console.log('PASS real macOS WebView + Rust HTTP: reproduce 403, remove Origin, retain auth, stream SSE and abort');
} finally {
  clearTimeout(timer);
  // Only the child we created, never the user's Omega App.
  child.kill('SIGTERM');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
