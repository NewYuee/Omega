import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    let historyReads=0;
    const completed={running:false,durationMs:6000,elapsedMs:6000,usage:{inputTokens:2400,outputTokens:600,totalTokens:3000,cachedInputTokens:1200,reasoningOutputTokens:100}};
    await page.addInitScript(()=>{
      sessionStorage.setItem('omega-key','mock');localStorage.setItem('omega-thread','thread');
      const original=fetch;window.fetch=(...args)=>String(args[0]).startsWith('/api/events')?Promise.resolve(new Response(new ReadableStream({
        start(controller){window.pushEvent=e=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(e)+'\n\n'));}
      }))):original(...args);
    });
    await page.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const input=route.request().method()==='POST'?route.request().postDataJSON():{};
      if(path==='/api/status')return route.fulfill({json:{ready:true,active:{},approvals:[],workspace:'/tmp',devices:2}});
      if(path==='/api/history') {
        historyReads++;const id=input.turnId || 'latest';
        return route.fulfill({json:{thread:{id:'thread',name:'统计测试',cwd:'/tmp'},outline:[{id:'old',label:'旧记录'},{id:'latest',label:'最新记录'}],
          turn:{id,status:'completed',metrics:id==='latest'?completed:null,items:[{id:'a'+id,type:'agentMessage',pageText:'统计不应重建这段正文'}]}}});
      }
      return route.fulfill({json:input.method==='thread/list'?{data:[{id:'thread',name:'统计测试'}]}:{thread:{id:'thread'}}});
    });
    await page.goto('http://127.0.0.1:4310');
    await page.getByText(/整轮平均 100.0 tokens\/s/).waitFor();
    assert.match(await page.locator('#turn-metrics').textContent(),/输入 2,400/);
    await page.evaluate(()=>window.originalMessage=document.querySelector('.message'));
    const before=historyReads;
    await page.evaluate(()=>window.pushEvent({method:'omega/turn-metrics',params:{threadId:'thread',turnId:'latest',metrics:{running:true,elapsedMs:2000,durationMs:null,usage:null}}}));
    await page.getByText(/进行中 · 耗时/).waitFor();
    assert.equal(await page.evaluate(()=>window.originalMessage===document.querySelector('.message')),true);
    assert.equal(historyReads,before);
    await page.selectOption('#history-select','0');
    await page.getByText(/耗时 暂无/).waitFor();
    assert.ok(!(await page.locator('#turn-metrics').textContent()).includes('2,400'));
    await page.reload();await page.getByText(/整轮平均 100.0 tokens\/s/).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.close();console.log('PASS metrics, missing data, history switch, live update without re-render, viewport '+width);
  }
} finally {await browser.close();}
