import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FeishuSettings,verifyFeishu} from '../src/server/feishu-settings.ts';
import {FeishuPairing} from '../src/server/feishu-pairing.ts';
import {FeishuManager} from '../src/server/feishu-manager.ts';
import {createBackup,validateBackup} from '../src/server/backup.ts';
const credentials={appId:'cli_1234567890abcdef',appSecret:'test-secret-never-return'};
const binding={chatId:'oc_group',chatType:'group',userIds:['ou_owner'],target:{kind:'group',id:'g'}};
test('different chats can share a target and removal persists without removing the other binding',async t=>{
  const f=await fixture(t);await f.act('connect',credentials);
  await f.act('save',{enabled:true,bindings:[binding],confirmAuthorization:true});
  const pair=await f.act('pair'),message=event(pair.pairing.code);message.message.chat_id='oc_second';
  f.runtimes.at(-1).receive(message);
  await f.act('confirmPair',{code:pair.pairing.code,target:binding.target,confirmAuthorization:true});
  assert.equal((await f.settings.read()).bindings.length,2);
  const remaining=(await f.settings.read()).bindings.filter(b=>b.chatId!=='oc_group');
  f.runtimes.at(-1).idle=false;
  await assert.rejects(f.act('save',{enabled:true,bindings:remaining,confirmAuthorization:true}),/待处理/);
  assert.equal((await f.settings.read()).bindings.length,2);
  f.runtimes.at(-1).idle=true;
  await f.act('save',{enabled:true,bindings:remaining,confirmAuthorization:true});
  const saved=await new FeishuSettings(f.dir,{}).read();
  assert.deepEqual(saved.bindings.map(b=>b.chatId),['oc_second']);assert.deepEqual(saved.bindings[0].target,binding.target);
});
const event=(code,user='ou_owner')=>({sender:{sender_type:'user',sender_id:{open_id:user}},message:{message_id:'om_pair',chat_id:'oc_group',chat_type:'group',message_type:'text',create_time:String(Date.now()),content:JSON.stringify({text:`@_user_1 /omega-pair ${code}`}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}]}});
test('group-wide access requires confirmation, persists and survives same-target pairing',async t=>{
  const f=await fixture(t);await f.act('connect',credentials);
  const input={enabled:true,bindings:[{...binding,allowAllMembers:true}]};
  await assert.rejects(f.act('save',input),/确认/);
  await f.act('save',{...input,confirmAuthorization:true});
  assert.equal((await new FeishuSettings(f.dir,{}).resolve()).bindings[0].allowAllMembers,true);
  const pair=await f.act('pair');f.runtimes.at(-1).receive(event(pair.pairing.code,'ou_new'));
  await f.act('confirmPair',{code:pair.pairing.code,target:binding.target,confirmAuthorization:true});
  assert.equal((await f.settings.read()).bindings[0].allowAllMembers,true);
  await f.act('save',{...input,bindings:[{...binding,allowAllMembers:false}],confirmAuthorization:true});
  assert.equal((await f.settings.resolve()).bindings[0].allowAllMembers,false);
  assert.deepEqual((await f.settings.read()).bindings[0].userIds,['ou_owner']);
});
async function fixture(t,env={},verify=async()=>({botOpenId:'ou_bot',name:'Bot'})){
  const dir=await mkdtemp(path.join(tmpdir(),'omega-feishu-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const settings=new FeishuSettings(dir,env),runtimes=[],targets=[];
  const manager=new FeishuManager(settings,async(config,receive)=>{const runtime={config,receive,idle:true,closed:false,service:{canReconfigure:()=>runtime.idle},start:async()=>{},close:()=>{runtime.closed=true},status:()=>({enabled:true,connection:'connected'})};runtimes.push(runtime);return runtime;},async target=>{if(!target||!['g','t'].includes(target.id))throw Error('invalid target');targets.push(target);},verify);
  t.after(()=>manager.close());await manager.start();
  const act=async(action,data={})=>manager.action({action,revision:(await manager.status()).revision,...data});
  return{dir,settings,manager,runtimes,targets,act};
}
test('UI credentials are encrypted, private, excluded from backups and never returned',async t=>{
  const f=await fixture(t);const s=await f.act('connect',credentials);
  assert.equal(s.settings.botOpenId,'ou_bot');assert.equal(s.hasSecret,true);assert.equal(s.enabled,true);assert.deepEqual(s.settings.bindings,[]);
  assert.ok(!JSON.stringify(s).includes(credentials.appSecret));assert.ok(!(await readFile(path.join(f.dir,'feishu-secret.json'),'utf8')).includes(credentials.appSecret));
  for(const file of ['feishu-secret.json','feishu-secret.key','feishu.json'])assert.equal((await stat(path.join(f.dir,file))).mode&0o777,0o600);
  assert.deepEqual(await new FeishuSettings(f.dir,{}).credentials(),credentials);
  assert.equal(validateBackup(createBackup(f.dir)).files.length,0);
  await writeFile(path.join(f.dir,'feishu-secret.key'),Buffer.alloc(32));await assert.rejects(f.settings.credentials(),/无法解密/);
});
test('deployment environment credentials cannot be overwritten or mixed with stored credentials',async t=>{
  const f=await fixture(t,{OMEGA_FEISHU_APP_ID:credentials.appId,OMEGA_FEISHU_APP_SECRET:credentials.appSecret});
  assert.equal((await f.manager.status()).environmentManaged,true);
  await assert.rejects(f.act('connect',{appSecret:'replacement'}),/部署环境/);
  await assert.rejects(f.settings.saveCredentials(credentials),/部署环境/);
  await f.act('connect');assert.equal(f.runtimes.length,1);
});
test('pairing requires mention, user identity, freshness, exact code and explicit Omega confirmation',async t=>{
  const f=await fixture(t);await f.act('connect',credentials);const state=await f.act('pair'),code=state.pairing.code;
  const wrong=event(code);wrong.message.mentions=[];assert.equal(f.runtimes[0].receive(wrong),false);
  assert.equal(f.runtimes[0].receive(event('wrong')),true);assert.equal((await f.manager.status()).pairing.candidate,undefined);
  const bot=event(code);bot.sender.sender_type='app';f.runtimes[0].receive(bot);assert.equal((await f.manager.status()).pairing.candidate,undefined);
  const stale=event(code);stale.message.create_time='1';f.runtimes[0].receive(stale);assert.equal((await f.manager.status()).pairing.candidate,undefined);
  f.runtimes[0].receive(event(code));f.runtimes[0].receive(event(code,'ou_intruder'));
  assert.equal((await f.manager.status()).pairing.candidate.userId,'ou_owner');assert.equal((await f.settings.read()).bindings.length,0);
  await assert.rejects(f.act('confirmPair',{code,target:{kind:'group',id:'g'}}),/确认授权/);
  const saved=await f.act('confirmPair',{code,target:{kind:'group',id:'g'},confirmAuthorization:true});assert.deepEqual(saved.settings.bindings,[binding]);assert.equal(saved.pairing,null);
  await assert.rejects(f.act('confirmPair',{code,target:{kind:'group',id:'g'},confirmAuthorization:true}),/失效/);
});
test('pair codes expire and regeneration invalidates previous codes',()=>{
  let now=Date.now();const pairing=new FeishuPairing(()=>now),old=pairing.create().code;const next=pairing.create().code;assert.notEqual(next,old);pairing.receive(event(old),'ou_bot');assert.equal(pairing.status().candidate,undefined);now+=300001;assert.equal(pairing.status(),null);assert.equal(pairing.receive(event(next),'ou_bot'),true);
});
test('active jobs and stale revisions prevent reconfiguration without closing the running connector',async t=>{
  const f=await fixture(t);const s=await f.act('connect',credentials);const runtime=f.runtimes[0];runtime.idle=false;
  await assert.rejects(f.act('disable'),/待处理/);assert.equal(runtime.closed,false);runtime.idle=true;await f.act('reconnect');assert.equal(runtime.closed,true);
  await assert.rejects(f.manager.action({action:'disable',revision:s.revision}),/配置已更新/);
  const disabled=await f.act('disable');assert.equal(disabled.enabled,false);assert.equal(disabled.settings.enabled,false);
});
test('failed credential verification preserves original settings and runtime; changing app clears bindings',async t=>{
  let fail=false;const f=await fixture(t,{},async()=>{if(fail)throw Error('校验失败');return{botOpenId:'ou_bot',name:'Bot'};});
  await f.act('connect',credentials);await f.act('save',{enabled:true,bindings:[binding],confirmAuthorization:true});const runtime=f.runtimes.at(-1);fail=true;
  await assert.rejects(f.act('connect',{...credentials,appSecret:'bad'}),/校验失败/);assert.equal(runtime.closed,false);assert.deepEqual(await f.settings.credentials(),credentials);
  fail=false;await assert.rejects(f.act('connect',{appId:'cli_abcdef1234567890',appSecret:'new'}),/清空/);
  const next=await f.act('connect',{appId:'cli_abcdef1234567890',appSecret:'new',confirmReset:true});assert.deepEqual(next.settings.bindings,[]);
});
test('binding edits validate targets, type, white lists and sensitive URLs even when disabled',async t=>{
  const f=await fixture(t);await f.act('connect',credentials);
  for(const bindings of [[{...binding,userIds:['*']}],[{...binding,target:{kind:'thread',id:'t'}}],[{...binding,target:{kind:'group',id:'missing'}}]])await assert.rejects(f.act('save',{enabled:false,bindings,confirmAuthorization:true}));
  await assert.rejects(f.act('save',{enabled:true,bindings:[binding],omegaUrl:'https://example.com/?key=secret',confirmAuthorization:true}),/无凭据/);
  await assert.rejects(f.act('save',{enabled:true,bindings:[binding]}),/授权范围/);
});
test('verify uses only fixed HTTPS endpoints and never exposes upstream secret-bearing errors',async()=>{
  const calls=[];const request=async(url,init)=>{calls.push([url,init]);return Response.json(calls.length===1?{code:0,tenant_access_token:'private-token'}:{code:0,bot:{open_id:'ou_bot',app_name:'Bot'}});};
  assert.deepEqual(await verifyFeishu(credentials,request),{botOpenId:'ou_bot',name:'Bot'});assert.equal(calls.length,2);assert.equal(calls[1][0],'https://open.feishu.cn/open-apis/bot/v3/info');assert.equal(calls[0][1].redirect,'error');
  await assert.rejects(verifyFeishu(credentials,async()=>Response.json({code:99991663,msg:credentials.appSecret})),e=>e.message.includes('99991663')&&!e.message.includes(credentials.appSecret));
  await assert.rejects(verifyFeishu(credentials,async()=>{throw Error(credentials.appSecret)}),e=>!e.message.includes(credentials.appSecret));
});
test('concurrent changes are rejected and partial credential persistence stays disabled',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve});let delayed=false;
  const f=await fixture(t,{},async()=>{if(delayed)await gate;return{botOpenId:'ou_bot',name:'Bot'};});
  await f.act('connect',credentials);const version=(await f.manager.status()).revision;delayed=true;
  const changing=f.manager.action({action:'connect',revision:version,...credentials});
  await assert.rejects(f.manager.action({action:'disable',revision:version}),/正在更新/);release();await changing;
  const save=f.settings.save.bind(f.settings);f.settings.save=async value=>{if(value.enabled)throw Error('simulated disk failure');await save(value);};
  await assert.rejects(f.act('connect',{...credentials,appSecret:'new-secret'}),/disk failure/);
  assert.equal((await f.settings.read()).enabled,false);assert.equal((await f.manager.status()).enabled,false);assert.equal(f.runtimes.at(-1).closed,true);
});
test('empty binding setup never dispatches an ordinary message and closed manager cannot restart',async t=>{
  const f=await fixture(t);await f.act('connect',credentials);assert.equal(f.runtimes[0].receive({...event('x'),message:{...event('x').message,content:JSON.stringify({text:'普通文本'})}}),false);
  assert.deepEqual(f.runtimes[0].config.bindings,[]);f.manager.close();await assert.rejects(f.act('reconnect'),/关闭/);
});
