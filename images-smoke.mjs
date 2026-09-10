import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
const key=(await readFile('.omega/access-token','utf8')).trim();
const png=await sharp({create:{width:120,height:80,channels:3,background:'#235e4d'}}).png().toBuffer();
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for (const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let submitted, sentImages=[], requests=0;
    await page.addInitScript(key=>{
      sessionStorage.setItem('omega-key',key);localStorage.setItem('omega-thread','image-demo');
      const original=window.fetch;
      window.fetch=(...args)=>String(args[0]).startsWith('/api/events')
        ? Promise.resolve(new Response(new ReadableStream({start(){}}))) : original(...args);
    },key);
    await page.route('**/api/rpc',route=>{
      const input=route.request().postDataJSON();
      if (input.method==='turn/start') {submitted=input;requests++;return route.fulfill({json:{turn:{id:'turn'}}});}
      return route.fulfill({json:input.method==='thread/list'?{data:[{id:'image-demo',name:'图片测试'}]}:{thread:{id:'image-demo'}}});
    });
    await page.route('**/api/history',route=>route.fulfill({json:{
      thread:{id:'image-demo',name:'图片测试',cwd:'/tmp'},
      outline:sentImages.length ? [{id:'turn',label:'[图片]',index:0}] : [],
      turn:sentImages.length ? {id:'turn',status:'completed',items:[{id:'user',type:'userMessage',pageText:'[图片]',images:sentImages}]} : null
    }}));
    await page.goto('http://127.0.0.1:4310');
    await page.getByRole('heading',{name:'图片测试'}).waitFor();
    await page.locator('#image-files').setInputFiles({name:'selected.png',mimeType:'image/png',buffer:png});
    await page.getByText('已就绪',{exact:true}).waitFor();
    await page.getByRole('button',{name:'移除图片 selected.png'}).click();
    assert.equal(await page.locator('.image-pending').count(),0);
    // Simulated paste exercises the same ClipboardEvent path as browser screenshots.
    await page.evaluate(base64=>{
      const file=new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'});
      const data=new DataTransfer();data.items.add(file);
      document.getElementById('prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    },png.toString('base64'));
    await page.getByText('已就绪',{exact:true}).waitFor();
    await page.locator('#send').click();
    await page.waitForFunction(()=>document.getElementById('image-tray').hidden);
    assert.equal(requests,1);
    assert.deepEqual(submitted.params.input,[]);
    assert.equal(submitted.imageIds.length,1);
    sentImages=submitted.imageIds.map(id=>({id,expiresAt:Number(id.slice(0,13))+7*86400000}));
    // New page history recovers the attachment without image bytes in history JSON.
    await page.reload();await page.getByRole('button',{name:'查看图片 1',exact:true}).click();
    await page.locator('.history-image img').waitFor();
    await page.locator('.history-image').click();
    await page.locator('#image-view').waitFor({state:'visible'});
    await page.locator('#image-view-close').click();
    await page.waitForFunction(()=>!document.getElementById('image-view').hasAttribute('src'));
    assert.equal(await page.locator('#image-view').getAttribute('src'),null);
    // Drag/drop and text+image input.
    await page.evaluate(base64=>{
      const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'drop.png',{type:'image/png'}));
      document.getElementById('composer').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
    },png.toString('base64'));
    await page.getByText('已就绪',{exact:true}).waitFor();
    await page.locator('#prompt').fill('请描述这张图');
    const thumbnail=await page.locator('.image-pending img').getAttribute('src');
    await page.locator('#expand-editor').click();
    assert.equal(await page.locator('.image-pending img').getAttribute('src'),thumbnail);
    await page.locator('#editor-close').click();
    assert.equal(await page.locator('#prompt').inputValue(),'请描述这张图');
    assert.equal(await page.locator('.image-pending img').getAttribute('src'),thumbnail);
    await page.locator('#expand-editor').click();
    await page.locator('#send').click();await page.waitForFunction(()=>document.getElementById('image-tray').hidden);
    await page.locator('#editor-dialog').waitFor({state:'hidden'});
    assert.equal(requests,2);assert.equal(submitted.params.input[0].text,'请描述这张图');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'.omega/images-'+width+'.png'});
    await page.close();
    console.log('PASS real image upload/thumbnail, remove, paste, drop, fullscreen preserves image/draft and closes after send, image-only & mixed submit, lazy history, viewport '+width);
  }
} finally {await browser.close();}
