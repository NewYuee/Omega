import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const width of [320,390,1280]){
    const page=await browser.newPage({viewport:{width,height:640}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let deletes=0, failDelete=true;
    await page.addInitScript(()=>{
      sessionStorage.setItem('omega-key','mock-key');localStorage.setItem('omega-thread','demo');
      const fetch=window.fetch;
      window.fetch=(url,options)=>String(url).startsWith('/api/events')?Promise.resolve(new Response(new ReadableStream({start(c){window.pushEvent=e=>c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(e)+'\n\n'));}}))):fetch(url,options);
    });
    await page.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const input=route.request().postDataJSON();
      if(input?.method==='thread/delete'){deletes++;assert.equal(input.confirmDelete,true);return route.fulfill({status:failDelete?409:200,json:failDelete?{error:'仍有任务正在执行'}:{threadId:'demo',deleted:true}});}
      const json=path==='/api/status'?{ready:true,workspace:'/tmp',active:{},approvals:[]}
        :path==='/api/history'?{thread:{id:'demo',name:'移动端布局与 Emoji 测试',cwd:'/tmp'},outline:[{id:'t',label:'测试问题'}],turn:{id:'t',items:[{id:'u',type:'userMessage',pageText:'能正常显示吗？ 😀 ✅ 🎉 👩‍💻'},{id:'a',type:'agentMessage',pageText:'## 可以 ✅\n\n这是一段用于测试的答复。'}]}}
        :input?.method==='thread/list'?{data:[{id:'demo',name:'移动端布局与 Emoji 测试'},{id:'other',name:'另一个会话'}]}:{thread:{id:'demo'}};
      return route.fulfill({json});
    });
    await page.goto('http://127.0.0.1:4310');
    await page.locator('.exchange').waitFor();
    if(width<701){
      assert.equal(await page.locator('body > aside').isVisible(),false);
      assert.ok((await page.locator('main > header').boundingBox()).height<=54);
      assert.ok((await page.locator('#messages').boundingBox()).height>380);
      await page.locator('#menu-toggle').click();
      await page.locator('#conversation-drawer').waitFor();
      if(width===390)await page.screenshot({path:'.omega/omega-drawer.png'});
      assert.ok((await page.locator('#threads').boundingBox()).height>200);
      await page.keyboard.press('Escape');
      await page.locator('#conversation-drawer').waitFor({state:'hidden'});
    }
    const initial=(await page.locator('#prompt').boundingBox()).height;
    const draft='需要保留的草稿 😀\n'.repeat(30);
    await page.locator('#prompt').fill(draft);
    const grown=(await page.locator('#prompt').boundingBox()).height;
    assert.ok(grown>initial && grown<=120);
    await page.locator('#expand-editor').click();
    assert.ok((await page.locator('#prompt').boundingBox()).height>300);
    if(width===390)await page.screenshot({path:'.omega/omega-editor.png'});
    assert.equal(await page.locator('#prompt').inputValue(),draft);
    await page.locator('#prompt').fill(draft+'全屏补充');
    await page.locator('#editor-close').click();
    await page.locator('#editor-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#prompt').inputValue(),draft+'全屏补充');
    assert.ok((await page.locator('#prompt').boundingBox()).height<=120);
    await page.locator('#expand-editor').click();await page.keyboard.press('Escape');
    await page.locator('#editor-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#prompt').inputValue(),draft+'全屏补充');
    await page.locator('#prompt').fill('简短草稿');
    assert.equal((await page.locator('#prompt').boundingBox()).height,initial);
    assert.equal(await page.locator('#send svg').count(),1);
    if(width===390)await page.screenshot({path:'.omega/omega-chat.png'});
    assert.ok(await page.locator('.message.user').textContent().then(x=>x.includes('👩‍💻')));
    if(width<701)await page.locator('#menu-toggle').click();
    await page.locator('[data-thread-id="demo"] .thread-delete').click();
    await page.locator('#delete-cancel').click();assert.equal(deletes,0);
    await page.locator('[data-thread-id="demo"] .thread-delete').click();
    await page.locator('#delete-confirm').click();
    await page.getByText('仍有任务正在执行',{exact:true}).waitFor();
    assert.equal(await page.locator('#delete-confirm').isEnabled(),true);
    failDelete=false;await page.locator('#delete-confirm').click();
    await page.locator('#delete-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('[data-thread-id="demo"]').count(),0);
    if(width<701)await page.locator('#drawer-close').click();
    assert.equal(await page.locator('#prompt').inputValue(),'简短草稿');
    assert.equal(await page.locator('#send').isDisabled(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('omega-thread')),null);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'.omega/mobile-ui-'+width+'.png'});
    await page.close();console.log('PASS compact layout, SVG/emoji, auto-grow, fullscreen draft, delete cancel/failure/success '+width);
  }
}finally{await browser.close();}
