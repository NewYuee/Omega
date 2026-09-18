import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseFeishuConfig} from '../src/server/feishu-config.ts';
import {FeishuStore} from '../src/server/feishu-store.ts';
import {FeishuService} from '../src/server/feishu-service.ts';
import {feishuAnswerPages,feishuAnswerCard} from '../src/server/feishu-cards.ts';
import {GroupStore} from '../src/server/groups-store.ts';
import {GroupOrchestrator} from '../src/server/group-orchestrator.ts';
const env={OMEGA_FEISHU_APP_ID:'cli_1234567890abcdef',OMEGA_FEISHU_APP_SECRET:'test-secret'};
const config=()=>parseFeishuConfig({enabled:true,botOpenId:'ou_bot',bindings:[{chatId:'oc_group',chatType:'group',userIds:['ou_owner'],target:{kind:'group',id:'g'}},{chatId:'oc_dm',chatType:'p2p',userIds:['ou_owner'],target:{kind:'thread',id:'thread'}}]},env);
const event=(id='om_1',other={})=>({sender:{sender_type:'user',sender_id:{open_id:'ou_owner'}},message:{message_id:id,chat_id:'oc_group',chat_type:'group',message_type:'text',create_time:String(Date.now()),content:JSON.stringify({text:'@_user_1 检查项目'}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}],...other}});
test('answer cards preserve markdown, bound bytes and neutralize card tags',()=>{
  const source='中文🙂<&>'.repeat(9000),pages=feishuAnswerPages(source);
  assert.equal(pages.join(''),source);assert.ok(pages.length>1);
  for(const page of pages)assert.ok(Buffer.byteLength(JSON.stringify(feishuAnswerCard('Omega · 已完成',page,'问题')))<22000);
  const card=feishuAnswerCard('Omega · 已完成','**重点**\n- 内容\n<at id=all></at>','问题');
  assert.match(card.body.elements[0].content,/\*\*重点\*\*/);assert.ok(!JSON.stringify(card).includes('<at'));
  const code=feishuAnswerPages('```ts\n'+'const a=1;\n'.repeat(4000)+'```');
  assert.ok(code.length>1);for(const page of code)assert.equal((page.match(/^```/gm)||[]).length,2);
});
test('long answers update only the first page and send ordered continuation cards',async()=>{
  const f=fixture();try{
    f.service.receive(event());await f.service.tick();f.req.status='completed';f.req.delivery='结果\n'.repeat(8000);
    await f.service.tick();const count=f.sent.length;assert.ok(count>2);
    assert.equal(f.sent[1][1].update_message_id,'om_reply1');
    for(const entry of f.sent.slice(2))assert.equal(entry[1].update_message_id,undefined);
    assert.ok(!JSON.stringify(JSON.parse(f.sent[1][1].content)).includes('停止任务'));
    await f.service.tick();assert.equal(f.sent.length,count);
  }finally{f.close()}
});
test('unknown card update is recorded without resending or redispatching',async()=>{
  const f=fixture();try{
    f.service.receive(event());await f.service.tick();f.req.status='completed';f.req.delivery='完成';
    f.service.send=async()=>{throw Error('timeout')};await f.service.tick();await f.service.tick();
    assert.equal(f.calls.length,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM feishu_outbox WHERE status='unknown'").get().n,1);
    new FeishuStore(f.db);await f.service.tick();assert.equal(f.calls.length,1);
  }finally{f.close()}
});
function fixture(overrides={}){
  const db=new DatabaseSync(':memory:'),store=new FeishuStore(db),calls=[],sent=[],req={id:'q',groupId:'g',status:'running',tasks:[]};
  const host={submitGroup:(...args)=>{calls.push(args);return{requirement:req}},getRequirement:()=>req,startThread:async(...args)=>{calls.push(args);return{turn:{id:'turn'}}},inspectThread:async()=>({status:'inProgress'}),readThread:async()=>'',lookupDispatch:()=>null,decide:()=>{},cancelGroup:async()=>{req.status='cancelled'},cancelThread:async(...args)=>calls.push(args),approvals:()=>false,...overrides};
  const service=new FeishuService(config(),store,host,async(...args)=>{sent.push(args);return'om_reply'+sent.length;});
  return{db,store,host,service,calls,sent,req,close(){service.close();db.close()}};
}
test('all-member access is explicit, group-only and rejects malformed switches',()=>{
  for(const value of ['true',1,null]){const c=config();c.bindings[0].allowAllMembers=value;assert.throws(()=>parseFeishuConfig(c,env));}
  const c=config();c.bindings[1].allowAllMembers=true;assert.throws(()=>parseFeishuConfig(c,env));
  assert.equal(config().bindings[0].allowAllMembers,undefined);
});
test('open group accepts new members but keeps chat, mention, sender and callback boundaries',async()=>{
  const f=fixture();try{
    f.service.config.bindings[0].allowAllMembers=true;
    const member=(id,changes={})=>{const e=event(id,changes);e.sender.sender_id.open_id='ou_new';return e;};
    f.service.receive(member('om_other',{chat_id:'oc_other'}));
    f.service.receive(member('om_silent',{mentions:[]}));
    f.service.receive(member('om_dm',{chat_id:'oc_dm',chat_type:'p2p',mentions:[]}));
    const bot=member('om_bot');bot.sender.sender_type='app';f.service.receive(bot);
    const missing=member('om_missing');delete missing.sender.sender_id.open_id;f.service.receive(missing);
    f.service.receive(member('om_new'));await f.service.tick();assert.equal(f.calls.length,1);
    const action=f.db.prepare("SELECT id FROM feishu_actions WHERE kind='cancel'").get();
    const callback={operator:{open_id:'ou_owner'},context:{open_chat_id:'oc_group',open_message_id:'om_reply1'},action:{value:{actionId:action.id}}};
    assert.equal(f.service.action(callback).toast.type,'error');
    assert.match(f.service.action({...callback,operator:{open_id:'ou_new'}}).toast.content,/已请求停止/);
    await f.service.tick();assert.equal(f.req.status,'cancelled');
    f.service.config.bindings[0].allowAllMembers=false;f.service.receive(member('om_after'));await f.service.tick();assert.equal(f.calls.length,1);
  }finally{f.close()}
});
test('disabled by default and enabled configuration fails closed without scoped allowlists',()=>{
  assert.equal(parseFeishuConfig(null).enabled,false);
  assert.equal(parseFeishuConfig({enabled:'false'},env).enabled,false);
  assert.throws(()=>parseFeishuConfig({enabled:true},{}));
  assert.deepEqual(parseFeishuConfig({enabled:true,botOpenId:'ou_bot',bindings:[]},env).bindings,[]);
});
test('untrusted senders, bot loops, wrong chats, stale messages and missing bot mention are ignored',async()=>{
  const f=fixture();try{
    const stranger=event();stranger.sender.sender_id.open_id='ou_stranger';f.service.receive(stranger);
    const bot=event();bot.sender.sender_type='app';f.service.receive(bot);
    for(const other of [{chat_id:'oc_else'},{mentions:[]},{create_time:'1'},{content:JSON.stringify({text:'a'.repeat(12001)})}])f.service.receive(event('om_x',other));
    await f.service.tick();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
  }finally{f.close()}
});
test('authorized unsupported or malformed messages receive a deduplicated explanation',async()=>{
  for(const other of [{message_type:'image'},{content:'invalid json'}]){
    const f=fixture();try{f.service.receive(event('om_bad',other));f.service.receive(event('om_bad',other));await f.service.tick();assert.equal(f.calls.length,0);assert.equal(f.sent.length,1);assert.match(JSON.stringify(f.sent),/未交给模型/);}finally{f.close();}
  }
});
test('text is durably deduplicated and only the mapped requirement result returns to original thread',async()=>{
  const f=fixture();try{f.service.receive(event());f.service.receive(event());await f.service.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].content,'检查项目');assert.equal(f.sent[0][0],'om_1');assert.equal(f.sent[0][3],false);
    f.req.status='completed';f.req.delivery='最终结论';await f.service.tick();await f.service.tick();assert.equal(f.sent.length,2);assert.equal(JSON.parse(f.sent[1][1].content).body.elements[0].content,'最终结论');assert.equal(f.sent[1][1].update_message_id,'om_reply1');
    f.service.receive(event());await f.service.tick();assert.equal(f.calls.length,1);
  }finally{f.close()}
});
test('discussion command preserves the existing collaboration mode',async()=>{
  const f=fixture();try{f.service.receive(event('om_d',{content:JSON.stringify({text:'@_user_1 /讨论 比较方案'})}));await f.service.tick();assert.equal(f.calls[0][1].collaborationMode,'discussion');assert.equal(f.calls[0][1].content,'比较方案');}finally{f.close()}
});
test('private thread uses persistent dispatch identity and replies only for its own turn',async()=>{
  const f=fixture({inspectThread:async()=>({status:'completed'}),readThread:async()=> '私聊结果'});try{f.service.receive(event('om_dm',{chat_id:'oc_dm',chat_type:'p2p',mentions:[],content:JSON.stringify({text:'查询状态'})}));await f.service.tick();await f.service.tick();assert.equal(f.calls[0][0],'thread');assert.equal(f.calls[0][2],env.OMEGA_FEISHU_APP_ID+':om_dm');assert.equal(f.sent[1][3],false);assert.equal(JSON.parse(f.sent[1][1].content).body.elements[0].content,'私聊结果');}finally{f.close()}
});
test('cancel callback verifies original sender, origin chat and message, and cannot repeat',async()=>{
  const f=fixture();try{f.service.receive(event());await f.service.tick();const action=f.db.prepare("SELECT id FROM feishu_actions WHERE kind='cancel'").get();const callback={operator:{open_id:'ou_owner'},context:{open_chat_id:'oc_group',open_message_id:'om_reply1'},action:{value:{actionId:action.id}}};
    assert.equal(f.service.action({...callback,operator:{open_id:'ou_stranger'}}).toast.type,'error');assert.equal(f.service.action({...callback,context:{...callback.context,open_chat_id:'oc_other'}}).toast.type,'error');assert.equal(f.service.action({...callback,context:{...callback.context,open_message_id:'om_fake'}}).toast.type,'error');
    f.service.action(callback);await f.service.tick();assert.equal(f.req.status,'cancelled');assert.match(f.service.action(callback).toast.content,/已处理/);
  }finally{f.close()}
});
test('decision form validates against live Omega decision and passes selected choice plus note',async()=>{
  let answer;const f=fixture({decide:(...args)=>{answer=args;f.req.tasks[0].status='queued'}});try{f.service.receive(event());await f.service.tick();f.req.tasks=[{id:'task',status:'awaiting_input',decision:{id:'d',status:'pending',question:'选哪个？',options:[{id:'one',label:'方案一',description:'影响'}],allowOther:true}}];await f.service.tick();const action=f.db.prepare("SELECT id FROM feishu_actions WHERE kind='decision'").get();
    const callback={operator:{open_id:'ou_owner'},context:{open_chat_id:'oc_group',open_message_id:'om_reply2'},action:{name:action.id,form_value:{choice:'one',note:'只做最小范围'}}};
    assert.equal(f.service.action(callback).toast.type,'success');assert.equal(answer[2].choiceId,'one');assert.equal(answer[2].note,'只做最小范围');f.service.action(callback);assert.equal(f.req.tasks[0].status,'queued');
    const card=JSON.parse(f.sent[1][1].content);assert.equal(card.schema,'2.0');assert.equal(card.body.elements[1].tag,'form');assert.equal(card.body.elements[1].elements.at(-1).name,action.id);
  }finally{f.close()}
});
test('unknown dispatch and outbound outcome do not automatically replay after restart',async()=>{
  const f=fixture({startThread:async()=>{throw Error('timeout')}});try{f.service.receive(event('om_dm',{chat_id:'oc_dm',chat_type:'p2p',mentions:[],content:JSON.stringify({text:'做任务'})}));await f.service.tick();assert.equal(f.store.get(env.OMEGA_FEISHU_APP_ID+':om_dm').status,'unknown');
    const job=f.store.get(env.OMEGA_FEISHU_APP_ID+':om_dm');f.store.enqueue('pending',job.id,{msg_type:'text',content:'{}'});f.db.prepare("UPDATE feishu_outbox SET status='sending' WHERE id='pending'").run();new FeishuStore(f.db);assert.equal(f.db.prepare("SELECT status FROM feishu_outbox WHERE id='pending'").get().status,'unknown');
  }finally{f.close()}
});
test('revoked binding blocks queued tasks and outbound messages',async()=>{
  const f=fixture();try{f.service.receive(event());f.service.config.bindings=[];await f.service.tick();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);assert.equal(f.store.get(env.OMEGA_FEISHU_APP_ID+':om_1').status,'blocked');}finally{f.close()}
});
test('connector dispatch works against the real group store and orchestrator',async()=>{
  const groups=new GroupStore(':memory:');let group=groups.createGroup({name:'飞书测试'},'coord','/work');group=groups.addMember(group.id,{name:'开发',role:'开发',threadId:'member',cwd:'/work'});
  const o=new GroupOrchestrator({store:groups,isThreadActive:()=>false,startTurn:async()=>({turn:{id:'t'}}),waitTurn:async()=>({status:'completed'}),readTurnText:async()=>'完成'});o.suspend(group.id);
  const f=fixture({submitGroup:(id,input)=>o.submit(id,input)});try{f.service.config.bindings[0].target.id=group.id;f.service.receive(event());await f.service.tick();const job=f.store.get(env.OMEGA_FEISHU_APP_ID+':om_1');assert.ok(groups.getRequirement(job.requirement_id));assert.equal(groups.getRequirement(job.requirement_id).content,'检查项目');}finally{f.close();groups.close()}
});
