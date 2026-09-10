import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const key=(await readFile('.omega/access-token','utf8')).trim();
async function rpc(method,params,extra={}){
  const r=await fetch('http://127.0.0.1:4310/api/rpc',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({method,params,...extra})});
  return {status:r.status,data:await r.json()};
}
const created=await rpc('thread/start',{cwd:process.cwd()});
assert.equal(created.status,200);
const id=created.data.thread.id;
await rpc('thread/name/set',{threadId:id,name:'Omega 删除功能测试'});
assert.equal((await rpc('thread/delete',{threadId:id})).status,400);
assert.equal((await rpc('thread/delete',{threadId:'../invalid'},{confirmDelete:true})).status,400);
assert.equal((await rpc('thread/read',{threadId:id,includeTurns:false})).status,200);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const pages=[];
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:740}});
    await page.addInitScript(({key,id})=>{if(!sessionStorage.getItem('omega-key'))localStorage.setItem('omega-thread',id);sessionStorage.setItem('omega-key',key);},{key,id});
    await page.goto('http://127.0.0.1:4310');await page.getByRole('heading',{name:'Omega 删除功能测试',exact:true}).waitFor();
    await page.locator('#prompt').fill('删除后保留的本地草稿');pages.push(page);
  }
  const [desktop,mobile]=pages;
  await desktop.locator('[data-thread-id="'+id+'"] .thread-delete').click();
  await desktop.locator('#delete-cancel').click();
  assert.equal((await rpc('thread/read',{threadId:id,includeTurns:false})).status,200);
  await desktop.locator('[data-thread-id="'+id+'"] .thread-delete').click();
  await desktop.locator('#delete-confirm').click();
  for(const page of pages){
    await page.getByRole('heading',{name:'选择或新建会话',exact:true}).waitFor();
    assert.equal(await page.locator('#prompt').inputValue(),'删除后保留的本地草稿');
    assert.equal(await page.locator('[data-thread-id="'+id+'"]').count(),0);
    assert.equal(await page.locator('#send').isDisabled(),true);
  }
  assert.notEqual((await rpc('thread/read',{threadId:id,includeTurns:false})).status,200);
  await mobile.reload();await mobile.locator('#menu-toggle').click();
  await mobile.locator('#threads .thread-row').first().waitFor();
  assert.equal(await mobile.locator('[data-thread-id="'+id+'"]').count(),0);
  console.log('PASS real native delete, explicit confirmation, cancel, two-device sync, draft preservation, reload; deleted only test thread '+id);
}finally{await browser.close();}
