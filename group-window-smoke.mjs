import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:850}});
  await page.route('**/api/**',route=>route.fulfill({json:{ready:true,data:[],groups:[],active:{},approvals:[]}}));
  await page.addInitScript(()=>sessionStorage.setItem('omega-key','mock'));
  await page.goto('http://127.0.0.1:4310');
  const result=await page.evaluate(async()=>{
    const {createGroupRoom}=await import('/group-room.js');
    document.body.replaceChildren();
    for(const id of ['group-timeline','group-tasks','task-progress']){const el=document.createElement('div');el.id=id;document.body.append(el);}
    const message=i=>({id:String(i),kind:'member',author:'member',content:'reply '+i,createdAt:new Date().toISOString(),requirementId:'q'+i});
    let calls=[];
    const room=createGroupRoom({api:async path=>{calls.push(path);const query=new URL(path,'http://local/').searchParams;const start=query.has('question')?5:query.has('before')?100:220;return{messages:Array.from({length:120},(_,i)=>message(start+i))};},error:message=>{throw Error(message)},onSelect:()=>{},onReply:()=>{},openThread:()=>{}});
    const group={id:'g',members:[],requirements:[{id:'q5',content:'old question',status:'completed',createdAt:new Date().toISOString()}],messages:Array.from({length:120},(_,i)=>message(300+i))};
    room.render(group);
    await document.querySelector('.room-history').onclick();
    const count=document.querySelectorAll('[data-message-id]').length;
    room.render({...group,messages:[...group.messages.slice(1),message(420)]});
    const retained=document.querySelector('[data-message-id]').dataset.messageId;
    await document.querySelector('.question-link').onclick();
    const located=!!document.querySelector('[data-message-id="5"]');
    document.querySelector('.room-latest').click();
    return{count,retained,located,latest:!!document.querySelector('[data-message-id="420"]'),calls};
  });
  assert.equal(result.count,120);assert.equal(result.retained,'100');assert.equal(result.located,true);assert.equal(result.latest,true);assert.ok(result.calls.some(path=>path.includes('question=q5')));
  console.log('PASS bounded historical window, live update isolation, direct question lookup and return to latest');
}finally{await browser.close();}
