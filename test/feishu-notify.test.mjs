import test from 'node:test';
import assert from 'node:assert/strict';
import {FeishuNotifier,feishuNotificationCard} from '../src/server/feishu-notify.ts';

const config={enabled:true,appId:'cli_1234567890abcdef',appSecret:'secret',botOpenId:'ou_bot',bindings:[
  {chatId:'oc_one',chatType:'group',userIds:['ou_owner'],target:{kind:'group',id:'g'}},
  {chatId:'oc_two',chatType:'group',userIds:['ou_owner'],target:{kind:'group',id:'g'}},
  {chatId:'oc_dm',chatType:'p2p',userIds:['ou_owner'],target:{kind:'thread',id:'t'}}
]};

function fixture(){
  const sent=[];
  const client={im:{
    chat:{get:async({path})=>({code:0,data:{name:path.chat_id==='oc_one'?'研发群':'发布群'}})},
    chatMembers:{get:async({path})=>({code:0,data:{items:path.chat_id==='oc_one'?[{member_id:'ou_same',name:'张三'},{member_id:'ou_one',name:'李四'}]:[{member_id:'ou_same',name:'张三'},{member_id:'ou_two',name:'王五'}],has_more:false}})},
    message:{create:async input=>{sent.push(input);return{code:0,data:{message_id:'om_sent'}}}}
  }};
  return{notifier:new FeishuNotifier(config,client),sent};
}

test('notification targets are scoped by bound chat even when a person belongs to both groups',async()=>{
  const{notifier,sent}=fixture();
  assert.deepEqual((await notifier.groups()).map(item=>[item.chatId,item.name]),[['oc_one','研发群'],['oc_two','发布群']]);
  assert.deepEqual((await notifier.members('oc_two')).members.map(item=>item.openId),['ou_same','ou_two']);
  await notifier.send({chatId:'oc_two',memberOpenIds:['ou_same'],text:'请处理',submissionId:'12345678-1234-1234-1234-123456789abc'});
  assert.equal(sent[0].data.receive_id,'oc_two');
  assert.match(JSON.parse(sent[0].data.content).text,/user_id="ou_same"/);
});

test('notifications reject unbound chats and members outside the selected group',async()=>{
  const{notifier,sent}=fixture();
  await assert.rejects(notifier.members('oc_other'),/已经绑定/);
  await assert.rejects(notifier.send({chatId:'oc_one',memberOpenIds:['ou_two'],text:'错误目标'}),/不在目标群/);
  assert.equal(sent.length,0);
});

test('untrusted notification text cannot inject another Feishu mention',async()=>{
  const{notifier,sent}=fixture();
  await notifier.send({chatId:'oc_one',memberOpenIds:['ou_one'],text:'<at user_id="all"></at> & hello'});
  const text=JSON.parse(sent[0].data.content).text;
  assert.match(text,/^<at user_id="ou_one"><\/at>/);
  assert.doesNotMatch(text,/<at user_id="all">/);
  assert.match(text,/&lt;at user_id="all"&gt;&lt;\/at&gt; &amp; hello/);
});

test('card notifications preserve trusted mentions and escape mention-like content',async()=>{
  const{notifier,sent}=fixture();
  await notifier.send({chatId:'oc_one',memberOpenIds:['ou_one'],format:'card',title:'讨论结论',source:'Omega 群组',text:'**结论**\n<at id=all></at>'});
  assert.equal(sent[0].data.msg_type,'interactive');
  const card=JSON.parse(sent[0].data.content);
  assert.equal(card.schema,'2.0');
  assert.equal(card.header.title.content,'讨论结论');
  assert.match(card.body.elements[0].content,/^<at id=ou_one><\/at>/);
  assert.doesNotMatch(card.body.elements[0].content,/<at id=all>/);
  assert.match(card.body.elements[0].content,/&lt;at id=all&gt;&lt;\/at&gt;/);
});

test('card builder limits dynamic header metadata',()=>{
  const card=feishuNotificationCard({text:'完成',title:'x'.repeat(100),source:'y'.repeat(200),memberOpenIds:['ou_one']});
  assert.equal(card.header.title.content.length,80);
  assert.equal(card.header.subtitle.content.length,160);
  assert.equal(card.body.elements[1].fields[0].text.lines,2);
});
