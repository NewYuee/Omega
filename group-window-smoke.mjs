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
    // Exercise the pagination controller through the production React renderer.
    const waitFor=async(test,label)=>{for(let i=0;i<100;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error(`render timeout: ${label}; calls=${calls.join(',')}; html=${document.querySelector('#group-timeline')?.innerHTML.slice(0,200)}`);};
    const message=i=>({id:String(i),kind:'member',author:'member',content:'reply '+i,createdAt:new Date().toISOString(),requirementId:'q'+i});
    let calls=[];
    const room=createGroupRoom({api:async path=>{calls.push(path);const query=new URL(path,'http://local/').searchParams;const start=query.has('question')?5:query.has('before')?100:220;return{messages:Array.from({length:120},(_,i)=>message(start+i))};},error:message=>{throw Error(message)},onSelect:()=>{},onReply:()=>{},openThread:()=>{}});
    const group={id:'g',members:[],requirements:[{id:'q5',content:'old question',status:'completed',createdAt:new Date().toISOString()}],messages:Array.from({length:120},(_,i)=>message(300+i))};
    room.render(group);
    await waitFor(()=>document.querySelector('#group-timeline .room-history'),'initial history');
    document.querySelector('#group-timeline .room-history').click();
    await waitFor(()=>document.querySelector('[data-message-id="100"]'),'older window');
    const count=document.querySelectorAll('[data-message-id]').length;
    room.render({...group,messages:[...group.messages.slice(1),message(420)]});
    const retained=document.querySelector('[data-message-id]').dataset.messageId;
    await room.focus('q5');
    const located=!!document.querySelector('[data-message-id="5"]');
    room.returnToLatest();
    await waitFor(()=>document.querySelector('[data-message-id="420"]'),'latest window');
    return{count,retained,located,latest:!!document.querySelector('[data-message-id="420"]'),calls};
  });
  assert.equal(result.count,120);assert.equal(result.retained,'100');assert.equal(result.located,true);assert.equal(result.latest,true);assert.ok(result.calls.some(path=>path.includes('question=q5')));
  console.log('PASS bounded historical window, live update isolation, direct question lookup and return to latest');
}finally{await browser.close();}
