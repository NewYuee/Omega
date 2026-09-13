import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl=process.env.OMEGA_TEST_URL||'http://127.0.0.1:4310';
const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--enable-precise-memory-info']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),session=await page.context().newCDPSession(page);
  await page.route('**/api/**',async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch{}
    if(route.request().url().includes('/api/rpc')&&body.method==='thread/list')return route.fulfill({json:{data:[]}});
    return route.fulfill({json:{ready:true,workspace:'/tmp',active:{},approvals:[],devices:1,canChangeKey:true,data:[],groups:[],unread:{threads:[],groups:[]},counts:{threads:{},groups:{}},positions:{threads:{},groups:{}}}});
  });
  await page.addInitScript(()=>sessionStorage.setItem('omega-key','performance-test'));
  await page.goto(baseUrl);
  await page.evaluate(async()=>{
    const {createGroupRoom}=await import('/group-room.js');
    const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const message=(window,index)=>({id:`${window}-${index}`,kind:index%7?'member':'user',author:index%7?'member':'你',content:`窗口 ${window} 消息 ${index}\n`+'长内容 '.repeat(350),createdAt:new Date().toISOString(),requirementId:`q-${window}`});
    let current=0;
    const api=async path=>{const query=new URL(path,'http://local/').searchParams;current=query.has('question')?Number(query.get('question').slice(2)):current+1;return{messages:Array.from({length:120},(_,index)=>message(current,index))}};
    const room=createGroupRoom({api,error:value=>{throw Error(value)},onSelect:()=>{},onReply:()=>{},openThread:()=>{}});
    const group={id:'performance-group',members:[],requirements:Array.from({length:60},(_,index)=>({id:`q-${index}`,content:`问题 ${index}`,status:'completed',createdAt:new Date().toISOString()})),messages:Array.from({length:120},(_,index)=>message(0,index))};
    room.render(group);await waitFrame();await waitFrame();
    globalThis.__omegaPerformance={room,waitFrame};
  });
  await session.send('HeapProfiler.collectGarbage');
  const before=await session.send('Runtime.getHeapUsage');
  const result=await page.evaluate(async()=>{
    const {room,waitFrame}=globalThis.__omegaPerformance;
    const started=performance.now();let maxNodes=0,maxMessages=0;
    for(let index=0;index<60;index++){await room.focus(`q-${index}`);await waitFrame();maxNodes=Math.max(maxNodes,document.querySelectorAll('*').length);maxMessages=Math.max(maxMessages,document.querySelectorAll('[data-message-id]').length);}
    return{maxNodes,maxMessages,averageRenderMs:(performance.now()-started)/60};
  });
  await session.send('HeapProfiler.collectGarbage');
  const after=await session.send('Runtime.getHeapUsage'),heapGrowth=after.usedSize-before.usedSize;
  assert.ok(result.maxMessages<=120,`群聊窗口包含 ${result.maxMessages} 条消息`);
  assert.ok(result.maxNodes<2000,`页面包含 ${result.maxNodes} 个 DOM 节点`);
  assert.ok(heapGrowth<16*1024*1024,`JS heap 增长 ${(heapGrowth/1024/1024).toFixed(1)} MiB`);
  assert.ok(result.averageRenderMs<50,`平均窗口切换 ${result.averageRenderMs.toFixed(1)} ms`);
  console.log(`PASS: ${result.maxMessages} messages, ${result.maxNodes} DOM nodes, ${(heapGrowth/1024/1024).toFixed(1)} MiB heap growth, ${result.averageRenderMs.toFixed(1)} ms/window`);
}finally{await browser.close();}
