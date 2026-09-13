import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const state=await mkdtemp(join(tmpdir(),'omega-group-ui-')),port=14328;
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),OMEGA_STATE_DIR:state,OMEGA_ACCESS_TOKEN:'mock-group-key',OMEGA_CODEX_BIN:'/usr/bin/false',OMEGA_WORKSPACE:'/tmp'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',data=>{if(String(data).includes('Omega:')){clearTimeout(timer);resolve();}});server.on('error',reject);});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:760}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{sessionStorage.setItem('omega-key','mock-group-key');const original=window.fetch;window.fetch=(url,options)=>String(url).startsWith('/api/events')?Promise.resolve(new Response(new ReadableStream({start(c){window.roomEvent=e=>c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(e)+'\n\n'));}}))):original(url,options);});
    let status='running',sent=[];
    const member={id:'m1',threadId:'thread-1',name:'开发成员',role:'开发',avatar:'preset:designer',projectName:'Omega',cwd:'/tmp/omega',responsibilities:'负责实现和自测'};
    const makeGroup=()=>{const stamp=new Date(Date.now()-65000).toISOString(),tasks=[{id:'t1',position:0,memberId:'m1',title:'实现第一版',objective:'完成群组工作台',status:'running'}],requirements=[{id:'r1',content:'实现群组协作',status,tasks,createdAt:stamp,updatedAt:new Date().toISOString()},...sent.map((input,i)=>({id:'r'+(i+2),content:input.content,status:'plan_drafting',tasks:[],createdAt:stamp,updatedAt:new Date().toISOString()}))];return{id:'g1',name:'Omega 研发组',description:'持续交付 Omega',cwd:'/tmp',status,coordinatorThreadId:'coord',members:[member],limits:{maxConcurrency:3},requirementCount:requirements.length,openRequirementCount:requirements.length,runningTasks:1,requirements,messages:[{id:'msg1',requirementId:'r1',kind:'user',author:'你',content:'实现群组协作',createdAt:new Date().toISOString()},{id:'msg2',requirementId:'r1',kind:'member',author:'开发成员',content:'## 当前进度\n\n正在实现功能。',createdAt:new Date().toISOString(),reference:{threadId:'thread-1',taskId:'t1',type:'progress'}},...sent.map((input,i)=>({id:'sent'+i,requirementId:'r'+(i+2),kind:'user',author:'你',content:input.content,createdAt:new Date().toISOString()}))],requirement:requirements[0]};};
    await page.route('**/api/**',route=>{
      const url=new URL(route.request().url()),path=url.pathname,input=route.request().postDataJSON?.();let json;
      if(path==='/api/status')json={ready:true,workspace:'/tmp',active:{},approvals:[],devices:1};
      else if(path==='/api/groups'&&route.request().method()==='GET')json={groups:[{id:'g1',name:'Omega 研发组',memberCount:1,status}]};
      else if(path==='/api/groups/g1')json={group:makeGroup()};
      else if(path==='/api/groups'&&input?.action){if(input.action==='submit')sent.push(input);json={group:makeGroup()};}
      else if(input?.method==='thread/list')json={data:[{id:'thread-1',name:'开发会话'},{id:'thread-2',name:'测试会话'}]};
      else if(path==='/api/history')json={thread:{id:'thread-1',cwd:'/tmp'},outline:[],turn:null};
      else json={thread:{id:input?.params?.threadId||'thread-1'}};
      route.fulfill({json});
    });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator('.omega-palette-trigger').waitFor({state:'attached'});await page.waitForFunction(()=>typeof document.getElementById('menu-toggle')?.onclick==='function');assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('omega-product')),true);await page.keyboard.press('Control+K');assert.equal(await page.locator('.omega-palette').isVisible(),true);await page.keyboard.press('Escape');
    await page.waitForTimeout(50);assert.deepEqual(errors,[]);
    if(width<701){await page.locator('#menu-toggle').click();const drawerState=await page.evaluate(()=>({open:document.getElementById('conversation-drawer').open,handler:typeof document.getElementById('menu-toggle').onclick,sidebarParent:document.getElementById('sidebar').parentElement?.id}));assert.equal(drawerState.open,true,JSON.stringify(drawerState));assert.equal(await page.locator('#show-groups').isVisible(),true);await page.locator('#show-groups').click();await page.locator('#groups .group-row').click();}
    else {await page.locator('#show-groups').click();}
    await page.locator('.room-active').waitFor();assert.equal(await page.locator('#groups').getAttribute('data-react-owned'),'true');assert.equal(await page.locator('#group-members').getAttribute('data-react-owned'),'true');assert.equal(await page.locator('#group-tasks').getAttribute('data-react-owned'),'true');
    const groupPadding=parseFloat(await page.locator('#groups .group-row').first().evaluate(el=>getComputedStyle(el).paddingLeft));assert.ok(groupPadding>=45,String(groupPadding));
    assert.equal(await page.locator('#group-view').isVisible(),true);assert.equal(await page.locator('#composer').isVisible(),false);assert.equal(await page.locator('#group-concurrency').inputValue(),'3');assert.equal(await page.locator('.group-delete').isVisible(),true);
    assert.equal(await page.locator('.task-panel .panel-title h2').textContent(),'问题定位');assert.ok((await page.locator('#group-concurrency').boundingBox()).width>=58);
    if(width>800){const columns=await page.locator('.group-columns').boundingBox(),view=await page.locator('#group-view').boundingBox();assert.ok(Math.abs(columns.x-view.x)<2);assert.ok(Math.abs(columns.width-view.width)<2);}
    assert.ok((await page.locator('.requirement-queue').boundingBox()).height<=48);assert.ok((await page.locator('#requirement-form').boundingBox()).height<=125);
    const centerWidth=(await page.locator('.group-center').boundingBox()).width;if(width<=800){await page.locator('.member-panel-toggle').click();assert.equal(await page.locator('.group-panel').first().isVisible(),true);await page.locator('.group-panel').first().locator('.mobile-panel-close').click();await page.locator('.task-panel-toggle').click();assert.equal(await page.locator('.task-panel').isVisible(),true);await page.locator('.task-panel .mobile-panel-close').click();}else{await page.locator('.member-panel-toggle').click();assert.equal(await page.locator('.group-panel').first().isVisible(),false);assert.ok((await page.locator('.group-center').boundingBox()).width>centerWidth);await page.locator('.task-panel-toggle').click();assert.equal(await page.locator('.task-panel').isVisible(),false);const center=await page.locator('.group-center').boundingBox(),message=await page.locator('.group-message.member').boundingBox(),composer=await page.locator('#requirement-form').boundingBox();assert.ok(message.width/center.width>.85);assert.ok(composer.width/center.width>.9);await page.locator('.member-panel-toggle').click();await page.locator('.task-panel-toggle').click();assert.equal(await page.locator('.group-panel').first().isVisible(),true);assert.equal(await page.locator('.task-panel').isVisible(),true);}
    if(width<=800)await page.locator('.member-panel-toggle').click();await page.locator('.member-edit').click();await page.locator('#member-dialog').waitFor();assert.equal(await page.locator('#member-name').inputValue(),'开发成员');await page.locator('#member-cancel').click();
    assert.equal(await page.locator('.group-message.member .markdown-body h2').textContent(),'当前进度');
    assert.equal(await page.locator('.group-message.member').getAttribute('data-avatar'),'开');
    assert.equal(await page.locator('.group-message.member .chat-avatar').textContent(),'🎨');
    assert.equal(await page.locator('.member-card .member-avatar').textContent(),'🎨');
    await page.locator('.member-edit').click();assert.equal(await page.locator('#member-avatar').inputValue(),'preset:designer');await page.locator('#member-avatar-file').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});await page.locator('#member-avatar-preview').waitFor();assert.match(await page.locator('#member-avatar-preview').getAttribute('src'),/^data:image\/(webp|jpeg);base64,/);await page.locator('#member-cancel').click();if(width<=800)await page.locator('.group-panel').first().locator('.mobile-panel-close').click();
    await page.getByText('回复 / 追问',{exact:true}).click();await page.locator('#group-prompt').fill('补充一下测试结果');await page.locator('#submit-requirement').click();await page.locator('[data-message-id=sent0]').waitFor();assert.equal(sent[0].replyTaskId,'t1');
    await page.locator('#group-prompt').fill('另外查询版本');await page.locator('#group-prompt').press('Enter');await page.locator('[data-message-id=sent1]').waitFor();assert.equal(sent[1].replyTaskId,undefined);assert.equal(await page.locator('#group-tasks .question-card').count(),3);assert.equal(await page.locator('#requirement-select').isVisible(),false);assert.match(await page.locator('.question-duration').first().textContent(),/秒|分|小时/);
    await page.locator('#group-prompt').fill('第一行');await page.locator('#group-prompt').press('Shift+Enter');assert.equal(await page.locator('#group-prompt').inputValue(),'第一行\n');
    await page.locator('#group-prompt').fill('@开');await page.locator('.mention-option').click();assert.match(await page.locator('#group-prompt').inputValue(),/^@开发成员 /);
    await page.locator('.group-expand').click();assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('group-composer-expanded')),true);assert.ok((await page.locator('#group-prompt').boundingBox()).height>300);await page.getByRole('button',{name:'收起',exact:true}).click();assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('group-composer-expanded')),false);await page.locator('#group-prompt').fill('');
    assert.equal(await page.locator('.room-reply').isVisible(),false);
    sent.push({content:'较长的历史说明。'.repeat(180)});await page.evaluate(()=>window.roomEvent({method:'omega/group-updated',params:{groupId:'g1'}}));await page.locator('[data-message-id=sent2]').waitFor();
    await page.locator('#group-timeline').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(100);
    sent.push({content:'另一位成员的新消息'});await page.evaluate(()=>window.roomEvent({method:'omega/group-updated',params:{groupId:'g1'}}));await page.locator('[data-message-id=sent3]').waitFor();
    assert.ok(await page.locator('#group-timeline').evaluate(el=>el.scrollTop<10));assert.equal(await page.locator('.room-latest').isVisible(),true);await page.locator('.room-latest').click();assert.ok(await page.locator('#group-timeline').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<5));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    await page.screenshot({path:join(state,`group-${width}.png`),fullPage:true});await context.close();
  }
  console.log('PASS: group workspace desktop/mobile layout, public progress, continuous questions and reply routing');
}finally{await browser.close();server.kill();if(server.exitCode===null)await once(server,'exit');}
