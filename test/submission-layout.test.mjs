import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionLayout} from '../src/server/submission-layout.ts';
import {historyPage} from '../src/server/history.ts';
import {PastedTextStore} from '../src/server/pasted-content.ts';
import {memberTaskPrompt} from '../src/server/group-orchestrator.ts';

test('merged history restores image positions from matching persisted submission',()=>{
  const text='第一行[OmegaImage:a][OmegaImage:b]\n第二行';
  const ledger={request:{threadId:'thread',result:{turn:{id:'turn'}},fingerprint:JSON.stringify({input:[{type:'text',text}]})}};
  const item={id:'server-item',type:'userMessage',content:[{type:'text',text:'第一行\n第二行'},{type:'localImage'},{type:'localImage'}]};
  const restore=(item,turn)=>submissionLayout(item,'thread',turn.id,ledger);
  const page=historyPage({id:'thread',turns:[{id:'turn',items:[item]}]}, {},()=>[{id:'a'},{id:'b'}],restore);
  assert.equal(page.turn.items[0].pageText,text);
  assert.equal(submissionLayout(item,'different-thread','turn',ledger),undefined);
  assert.equal(submissionLayout(item,'thread','different-turn',ledger),undefined);
  assert.equal(submissionLayout({...item,content:[{text:'另一条消息'}]},'thread','turn',ledger),undefined);
  assert.equal(submissionLayout(item,'thread','turn',JSON.parse(JSON.stringify(ledger))),text);
});

test('equal-length text files carry unique IDs matching their inline references',async()=>{
  const store=new PastedTextStore('/tmp/unused-layout-tests');
  store.resolve=async id=>({id,text:id==='a'?'甲甲':'乙乙',chars:2,bytes:6});
  const input='之前[Pasted Content 2 chars id=b]中间[Pasted Content 2 chars id=a]之后';
  const result=await store.turnInput([{type:'text',text:input}],['a','b']);
  assert.equal(result[0].text,input);
  assert.match(result[1].text,/id=a\][\s\S]*甲甲/);
  assert.match(result[1].text,/id=b\][\s\S]*乙乙/);
  const prompt=memberTaskPrompt({}, {content:input,pastedTexts:[{id:'a',chars:2},{id:'b',chars:2}],tasks:[]}, {cwd:'/work'}, {objective:'分析文件',dependencies:[]},['甲甲','乙乙']);
  assert.ok(prompt.includes(input));
  assert.match(prompt,/<pasted-file id="a"[^>]*>\n甲甲/);
  assert.match(prompt,/<pasted-file id="b"[^>]*>\n乙乙/);
});
