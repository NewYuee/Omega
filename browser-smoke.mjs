import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const key=(await readFile(new URL('.omega/access-token',import.meta.url),'utf8')).trim();
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4310');
  await page.locator('#token').fill(key);await page.locator('#connect-form button').click();
  await page.locator('#setup').waitFor({state:'hidden'});
  await page.locator('#threads button').first().waitFor();
  await page.screenshot({path:'.omega/desktop.png',fullPage:true});
  await page.locator('#new').click();await page.locator('#cwd').fill('/Users/newyue/Lab/omega');await page.locator('#create-form button[type="submit"]').click();
  await page.locator('#create').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.getElementById('send').disabled);
  await page.waitForTimeout(500);assert.equal(await page.locator('#error').isVisible(),false,await page.locator('#error').textContent());
  const id=await page.evaluate(()=>localStorage.getItem('omega-thread'));assert.ok(id);
  const other=await browser.newContext({viewport:{width:390,height:844}}); const phone=await other.newPage();
  await phone.addInitScript(({key,id})=>{sessionStorage.setItem('omega-key',key);localStorage.setItem('omega-thread',id);},{key,id});
  await phone.goto('http://127.0.0.1:4310');await phone.waitForFunction(()=>!document.getElementById('send').disabled);
  await phone.waitForTimeout(500);assert.equal(await phone.locator('#error').isVisible(),false,await phone.locator('#error').textContent());
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  await phone.screenshot({path:'.omega/mobile.png',fullPage:true});
  await page.reload();await page.waitForFunction(()=>!document.getElementById('send').disabled);
  assert.equal(await page.evaluate(()=>localStorage.getItem('omega-thread')),id);
  assert.deepEqual(errors,[]);console.log('PASS: browser auth, new thread, second device, reload recovery, mobile overflow, no JS errors');
} finally {await browser.close();}
