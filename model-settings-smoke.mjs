import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const key=(await readFile('.omega/access-token','utf8')).trim();
const headers={authorization:'Bearer '+key,'content-type':'application/json'};
async function api(route,body){
  const r=await fetch('http://127.0.0.1:4310/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
const created=await api('rpc',{method:'thread/start',params:{cwd:process.cwd()}});
assert.equal(created.status,200);const id=created.data.thread.id;
const catalog=(await api('models',{})).data.models;
const model=catalog.find(m=>m.supportedReasoningEfforts.length>1);
assert.ok(model);const effort=model.supportedReasoningEfforts[0].reasoningEffort;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const pages=[];
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:740}});
    await page.addInitScript(({key,id})=>{sessionStorage.setItem('omega-key',key);localStorage.setItem('omega-thread',id);},{key,id});
    await page.goto('http://127.0.0.1:4310');await page.waitForFunction(()=>document.getElementById('title').textContent!=='开始下一件事');
    await page.locator('#prompt').fill('保留草稿');pages.push(page);
  }
  const [desktop,mobile]=pages;
  await mobile.locator('#model-settings').click();
  await mobile.locator('#model-select').selectOption(model.model);
  assert.equal(await mobile.locator('#effort-select option').count(),model.supportedReasoningEfforts.length+1);
  await mobile.locator('#effort-select').selectOption(effort);
  await mobile.locator('#model-cancel').click();
  assert.equal((await api('thread-settings',{threadId:id})).data.settings.revision,0);
  await mobile.locator('#expand-editor').click();
  await mobile.locator('#model-settings').click();await mobile.locator('#model-select').selectOption(model.model);
  await mobile.locator('#effort-select').selectOption(effort);await mobile.locator('#model-save').click();
  await mobile.locator('#model-dialog').waitFor({state:'hidden'});
  await desktop.waitForFunction(model=>document.getElementById('model-settings').title.includes(model),model.model);
  assert.equal(await desktop.locator('#prompt').inputValue(),'保留草稿');
  assert.equal(await mobile.locator('#prompt').inputValue(),'保留草稿');
  await mobile.locator('#editor-close').click();
  await mobile.reload();await mobile.locator('#model-settings').click();
  await mobile.locator('#model-select').waitFor();assert.equal(await mobile.locator('#model-select').inputValue(),model.model);
  assert.equal(await mobile.locator('#effort-select').inputValue(),effort);
  await mobile.screenshot({path:'.omega/model-settings-mobile.png'});
  // Another device saves while this dialog is open; stale save cannot overwrite it.
  await api('thread-settings',{threadId:id,expectedRevision:1,settings:{model:model.model,effort:null}});
  await mobile.locator('#model-save').click();
  await mobile.locator('#model-error').waitFor();assert.match(await mobile.locator('#model-error').textContent(),/其他设备/);
  assert.equal((await api('thread-settings',{threadId:id})).data.settings.effort,null);
  await mobile.locator('#model-cancel').click();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS real model catalog, dynamic effort choices, cancel/save, full-screen editor, two-device sync, reload, conflict protection; no inference calls');
}finally{
  await browser.close();
  const r=await api('rpc',{method:'thread/delete',params:{threadId:id},confirmDelete:true});
  console.log('Empty model-settings test thread cleanup HTTP '+r.status);
}
