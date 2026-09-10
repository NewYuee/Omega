import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const key=(await readFile('.omega/access-token','utf8')).trim();
const rpc=async(method,params)=>{
  const r=await fetch('http://127.0.0.1:4310/api/rpc',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({method,params})});
  return {status:r.status,data:await r.json()};
};
const created=await rpc('thread/start',{cwd:'/Users/newyue/Lab/omega'});
assert.equal(created.status,200);const id=created.data.thread.id;
assert.equal((await rpc('thread/name/set',{threadId:id,name:'   '})).status,400);
assert.equal((await rpc('thread/name/set',{threadId:id,name:'x'.repeat(81)})).status,400);
assert.equal((await rpc('thread/name/set',{threadId:id,name:'a\nb'})).status,400);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const pages=[];
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:850}});
    await page.addInitScript(({key,id})=>{sessionStorage.setItem('omega-key',key);localStorage.setItem('omega-thread',id);},{key,id});
    await page.goto('http://127.0.0.1:4310');
    await page.waitForFunction(()=>document.getElementById('title').textContent!=='开始下一件事');
    if(width<701)await page.locator('#menu-toggle').click();
    await page.locator('[data-thread-id="'+id+'"] .thread-rename').waitFor();
    pages.push(page);
  }
  const [desktop,mobile]=pages;
  await desktop.locator('#prompt').fill('保留我的草稿');
  await mobile.locator('[data-thread-id="'+id+'"] .thread-rename').click();
  await mobile.locator('#rename-name').fill('取消的名称');await mobile.locator('#rename-cancel').click();
  assert.equal(await mobile.locator('#rename-dialog').isVisible(),false);
  await mobile.locator('[data-thread-id="'+id+'"] .thread-rename').click();
  const name='Omega · 重命名测试 '+Date.now();
  await mobile.locator('#rename-name').fill(' '+name+' ');
  await mobile.locator('#rename-save').click();
  await desktop.getByRole('heading',{name,exact:true}).waitFor();
  await mobile.locator('#title').filter({hasText:name}).waitFor({state:'attached'});
  assert.equal(await desktop.locator('#prompt').inputValue(),'保留我的草稿');
  await desktop.reload();await desktop.getByRole('heading',{name,exact:true}).waitFor();
  const read=await rpc('thread/read',{threadId:id,includeTurns:false});
  assert.equal(read.data.thread.name,name);
  await mobile.route('**/api/rpc',route=>route.request().postDataJSON()?.method==='thread/name/set'
    ? route.fulfill({status:400,json:{error:'模拟保存失败'}}) : route.continue());
  await mobile.locator('[data-thread-id="'+id+'"] .thread-rename').click();
  await mobile.locator('#rename-name').fill('不会保存的名称');await mobile.locator('#rename-save').click();
  await mobile.getByText('模拟保存失败',{exact:true}).waitFor();
  assert.equal(await mobile.locator('#rename-name').inputValue(),'不会保存的名称');
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log(JSON.stringify({pass:true,threadId:id,name,checks:'validation, cancel, mobile save, multi-window sync, draft preserved, reload, failed save'}));
} finally {await browser.close();}
