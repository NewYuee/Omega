import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {historyPage} from './history.mjs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.addInitScript(() => {
      sessionStorage.setItem('omega-key', 'mock-key');
      localStorage.setItem('omega-thread', 'demo');
      window.fetch = new Proxy(window.fetch, { apply(target, ctx, args) {
        if (String(args[0]).startsWith('/api/events')) return Promise.resolve(new Response(new ReadableStream({
          start(controller) { window.pushEvent = message => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(message) + '\n\n')); }
        })));
        return Reflect.apply(target, ctx, args);
      }});
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/status') return route.fulfill({ json: { ready: true, workspace: '/tmp', active: {}, approvals: [], devices: 1 } });
      const method = route.request().postDataJSON()?.method;
      const turns = Array.from({ length: 12 }, (_, i) => ({ id: 't'+i, status: 'completed', items: [
        { id: 'u'+i, type: 'userMessage', content: [{ type: 'text', text: '历史问题 '+i }] },
        { id: 'c'+i, type: 'commandExecution', command: 'echo test', aggregatedOutput: 'test', status: 'completed' },
        { id: 'a'+i, type: 'agentMessage', text: '## 答复 '+i+'\n\n这是对应问题的历史答复。\n\n'+ '说明内容。'.repeat(60) }
      ] }));
      if (path === '/api/history') return route.fulfill({json:historyPage({id:'demo',name:'测试会话',cwd:'/tmp',turns},route.request().postDataJSON())});
      return route.fulfill({ json: method === 'thread/list' ? { data: [{ id: 'demo', name: '测试会话' }] } : { thread: { id: 'demo', name: '测试会话', cwd: '/tmp', turns } } });
    });
    await page.goto('http://127.0.0.1:4310');
    await page.locator('.exchange').first().waitFor();
    assert.equal(await page.locator('#history-select option').count(), 12);
    await page.selectOption('#history-select', '0');
    await page.getByText('历史问题 0',{exact:true}).waitFor();
    assert.equal(await page.locator('.exchange').count(),1);
    const top = await page.locator('#messages').evaluate(el => el.scrollTop);
    await page.evaluate(() => window.pushEvent({ method: 'item/agentMessage/delta', params: { threadId: 'demo', itemId: 'a11', delta: '\n新回复'.repeat(20) } }));
    await page.waitForTimeout(250);
    assert.ok(Math.abs(await page.locator('#messages').evaluate(el => el.scrollTop) - top) < 5);
    await page.locator('.tool-disclosure summary').first().click();
    await page.evaluate(() => window.pushEvent({ method: 'item/agentMessage/delta', params: { threadId: 'demo', itemId: 'a11', delta: '继续' } }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.tool-disclosure').first().getAttribute('open'), '');
    await page.locator('#jump-latest').click();
    await page.getByText('历史问题 11',{exact:true}).waitFor();
    assert.ok(await page.locator('#messages').evaluate(el => el.scrollHeight-el.scrollTop-el.clientHeight < 5));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '.omega/chat-'+width+'.png' });
    await page.close();
    console.log('PASS chat history, streaming scroll, tool disclosure, viewport '+width);
  }
} finally { await browser.close(); }
