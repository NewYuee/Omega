import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for (const mode of ['success','no-rng','network-error','timeout','body-timeout']) {
    const page=await browser.newPage({viewport:{width:390,height:850}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // A non-localhost HTTP origin gives a real insecure browser context.
    await page.route('http://omega-http.test/**', async route => {
      const url=new URL(route.request().url());
      const response=await route.fetch({url:'http://127.0.0.1:4310'+url.pathname+url.search});
      await route.fulfill({response});
    });
    await page.addInitScript(mode=>{
      sessionStorage.setItem('omega-key','mock-key');localStorage.setItem('omega-thread','test');
      window.submissions=[];
      const timer=window.setTimeout;
      window.setTimeout=(fn,ms,...args)=>timer(fn,ms===70000 ? 300 : ms,...args);
      if (mode==='no-rng') Object.defineProperty(crypto,'getRandomValues',{value:undefined});
      const original=window.fetch;
      window.fetch=(url,options)=>{
        if (String(url).startsWith('/api/events')) return Promise.resolve(new Response(new ReadableStream({start(){}})));
        if (String(url)==='/api/rpc' && JSON.parse(options.body).method==='turn/start') {
          window.submissions.push(JSON.parse(options.body));
          if (mode==='network-error') return Promise.reject(new TypeError('Network request failed'));
          if (mode==='timeout') return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
          if (mode==='body-timeout') return Promise.resolve(new Response(new ReadableStream({start(controller){
            controller.enqueue(new TextEncoder().encode('{'));
            options.signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});
          }})));
        }
        return original(url,options);
      };
    },mode);
    await page.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const method=route.request().postDataJSON()?.method;
      const json=path==='/api/status'?{ready:true,workspace:'/tmp',active:{},approvals:[],devices:1}
        :path==='/api/history'?{thread:{id:'test',name:'HTTP 测试',cwd:'/tmp'},outline:[],turn:null}
        :method==='thread/list'?{data:[{id:'test',name:'HTTP 测试'}]}:{turn:{id:'turn'},thread:{id:'test'}};
      return route.fulfill({json});
    });
    await page.goto('http://omega-http.test/');
    await page.getByRole('heading',{name:'HTTP 测试',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>isSecureContext),false);
    assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'undefined');
    await page.locator('#prompt').fill('手机 HTTP 发送测试');
    await page.locator('#send').click();
    await page.waitForFunction(()=>document.getElementById('send').textContent==='发送'&&!document.getElementById('send').disabled);
    const requests=await page.evaluate(()=>window.submissions);
    if(mode==='success') {
      assert.equal(requests.length,1);
      assert.match(requests[0].submissionId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.equal(await page.locator('#prompt').inputValue(),'');
    } else {
      assert.equal(await page.locator('#prompt').inputValue(),'手机 HTTP 发送测试');
      assert.equal(requests.length,mode==='no-rng'?0:1);
      assert.equal(await page.locator('#error').isVisible(),true);
      if(mode.includes('timeout')) assert.match(await page.locator('#error').textContent(),/70 秒/);
      if(mode!=='no-rng') {
        await page.locator('#send').click();
        await page.waitForFunction(()=>window.submissions.length===2 && !document.getElementById('send').disabled);
        assert.equal(await page.evaluate(()=>window.submissions[1].submissionId),requests[0].submissionId);
      }
    }
    assert.deepEqual(errors,[]);
    await page.close();console.log('PASS actual HTTP mobile context: '+mode);
  }
} finally {await browser.close();}
