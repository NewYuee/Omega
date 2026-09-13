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
    let turnStarts=0,maxHistoryBytes=0,historyInputs=[];await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/status') return route.fulfill({ json: { ready: true, workspace: '/tmp', active: {}, approvals: [], devices: 1 } });
      if(path==='/api/search')return route.fulfill({json:{results:[{scope:'thread',id:'demo',anchor:'t119',title:'测试会话',snippet:'跨端搜索命中历史答复'}]}});
      const method = route.request().postDataJSON()?.method;
      const turns = Array.from({ length: 120 }, (_, i) => ({ id: 't'+i, status: 'completed', items: [
        { id: 'u'+i, type: 'userMessage', content: [{ type: 'text', text: '历史问题 '+i }] },
        { id: 'c'+i, type: 'commandExecution', command: 'echo test', aggregatedOutput: 'test', status: 'completed' },
        { id: 'a'+i, type: 'agentMessage', text: '## 答复 '+i+'\n\n这是对应问题的历史答复。\n\n'+ '说明内容。'.repeat(60) }
      ] }));
      if (path === '/api/history') {
        const input=route.request().postDataJSON();historyInputs.push(input);let result;
        if(input.selectionOnly){result=historyPage({id:'demo',name:'测试会话',cwd:'/tmp',turns:turns.filter(turn=>turn.id===input.turnId)},input);result.outline=null;}
        else {const window=input.cursor==='older'?turns.slice(0,60):turns.slice(60);result=historyPage({id:'demo',name:'测试会话',cwd:'/tmp',turns:window},input);result.nextCursor=input.cursor==='older'?null:'older';if(input.outlineOnly)result.turn=null;}
        maxHistoryBytes=Math.max(maxHistoryBytes,JSON.stringify(result).length);return route.fulfill({json:result});
      }
      if(method==='turn/start')turnStarts++;
      return route.fulfill({ json: method === 'thread/list' ? { data: [{ id: 'demo', name: '测试会话' },{id:'other',name:'其他会话'}] } : { thread: { id: 'demo', name: '测试会话', cwd: '/tmp', turns } } });
    });
    await page.goto('http://127.0.0.1:4310');
    await page.locator('.exchange').first().waitFor();
    await page.keyboard.press('Control+K');await page.locator('.omega-palette-search input').fill('跨端');await page.getByText('跨端搜索命中历史答复',{exact:false}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#threads').getAttribute('data-react-owned'),'true');assert.equal(await page.locator('#omega-form-layer').getAttribute('data-react-owned'),'true');
    await page.evaluate(()=>{window.pushEvent({method:'turn/completed',params:{threadId:'other',turn:{id:'other-turn',status:'completed'}}});window.pushEvent({method:'omega/unread',params:{scope:'thread',id:'other',count:3,position:'other-turn'}})});if(width<=700)await page.locator('#menu-toggle').click();await page.locator('[data-thread-id="other"] .unread-dot').waitFor();assert.equal(await page.locator('[data-thread-id="other"] .unread-dot').textContent(),'3');
    await page.evaluate(()=>window.pushEvent({method:'omega/read-state',params:{scope:'thread',id:'other'}}));await page.locator('[data-thread-id="other"] .unread-dot').waitFor({state:'detached'});
    if(width<=700)await page.keyboard.press('Escape');
    if(width>700){
      const main=await page.locator('main').boundingBox(),composer=await page.locator('#composer').boundingBox(),reply=await page.locator('.message.assistant').last().boundingBox();assert.ok(composer.width/main.width>.9);assert.ok(reply.width/main.width>.85);
      assert.equal(await page.locator('#menu-toggle').isVisible(),true);await page.locator('#menu-toggle').click();await page.waitForTimeout(220);
      const expandedMain=await page.locator('main').boundingBox();assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('sidebar-collapsed')),true);assert.ok(expandedMain.width>main.width+200);assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>localStorage.getItem('omega-sidebar-collapsed')),'1');
      await page.locator('#menu-toggle').click();await page.waitForTimeout(220);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('sidebar-collapsed')),false);assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'true');
    }
    assert.equal(await page.locator('#history-select option').count(), 60);
    await page.locator(width>700?'#new':'#mobile-new').click();await page.locator('#create').waitFor();assert.equal(await page.locator('#create-form').count(),1);await page.locator('#create-cancel').click();
    await page.locator('#model-settings').click();await page.locator('#model-dialog').waitFor();await page.locator('#model-cancel').click();
    await page.selectOption('#history-select', '0');
    await page.getByText('历史问题 60',{exact:true}).waitFor();
    assert.equal(await page.locator('.exchange').count(),1);
    assert.equal(await page.locator('#prev-exchange').isDisabled(),false,JSON.stringify(historyInputs));
    await page.locator('#prev-exchange').click();await page.getByText('历史问题 59',{exact:true}).waitFor();
    assert.equal(await page.locator('#history-select option').count(),60);
    await page.locator('#next-exchange').click();await page.getByText('历史问题 60',{exact:true}).waitFor();
    assert.ok(await page.locator('body *').count()<700);
    assert.ok(maxHistoryBytes<100000);
    const top = await page.locator('#messages').evaluate(el => el.scrollTop);
    await page.evaluate(() => window.pushEvent({ method: 'item/agentMessage/delta', params: { threadId: 'demo', itemId: 'a11', delta: '\n新回复'.repeat(20) } }));
    await page.waitForTimeout(250);
    assert.ok(Math.abs(await page.locator('#messages').evaluate(el => el.scrollTop) - top) < 5);
    await page.locator('.tool-disclosure summary').first().click();
    await page.evaluate(() => window.pushEvent({ method: 'item/agentMessage/delta', params: { threadId: 'demo', itemId: 'a11', delta: '继续' } }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.tool-disclosure').first().getAttribute('open'), '');
    await page.locator('#jump-latest').click();
    await page.getByText('历史问题 119',{exact:true}).waitFor();
    assert.ok(await page.locator('#messages').evaluate(el => el.scrollHeight-el.scrollTop-el.clientHeight < 5));
    assert.equal(await page.locator('.message.user .role').last().isVisible(),false);
    assert.equal(await page.locator('.message.assistant').last().evaluate(el=>getComputedStyle(el,'::before').content),'"Ω"');
    await page.locator('#prompt').fill('第一行');await page.locator('#prompt').press('Shift+Enter');assert.equal(await page.locator('#prompt').inputValue(),'第一行\n');assert.equal(turnStarts,0);await page.locator('#prompt').fill('回车发送');await page.locator('#prompt').press('Enter');await page.waitForFunction(()=>document.getElementById('prompt').value==='');assert.equal(turnStarts,1);
    await page.screenshot({ path: '.omega/chat-'+width+'.png' });
    await page.evaluate(() => window.pushEvent({ method: 'turn/started', params: { threadId: 'demo', turn: { id: 'live-turn' } } }));
    await page.locator('.omega-typing').waitFor();
    assert.equal(await page.locator('.typing-dots i').count(),3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.close();
    console.log('PASS chat history, streaming scroll, tool disclosure, viewport '+width);
  }
} finally { await browser.close(); }
