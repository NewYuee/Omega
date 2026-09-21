import {chromium} from '@playwright/test';
import {access,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.OMEGA_TEST_CHROME||await access(chrome).then(()=>chrome,()=>undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(10000);
  const errors=[],records=[],links=[];let project=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{sessionStorage.setItem('omega-key','test');const original=fetch;window.fetch=(url,options)=>String(url).includes('/api/events')?Promise.resolve(new Response(new ReadableStream({start(){}}))):original(url,options)});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url()),body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(url.pathname.startsWith('/api/')){
      let json={data:[],active:{},approvals:[]};
      if(url.pathname==='/api/status')json={ready:true,workspace:'/repo',devices:1,active:{},approvals:[]};
      if(url.pathname==='/api/groups')json={groups:[]};
      if(url.pathname==='/api/rpc')json={data:[{id:'t',name:'Project',cwd:'/repo'}]};
      if(url.pathname==='/api/projects'){
        if(body.action==='list')json={projects:project?[project]:[]};
        if(body.action==='create')json=project={id:'p',name:body.name};
        if(body.action==='read')json={project,links,items:records,total:records.length};
        if(body.action==='save'){const r={...body,id:body.id||'r',revision:(body.revision||0)+1,updated_at:'2026-09-18'};if(records.length)records[0]=r;else records.push(r);json=r;}
        if(body.action==='link'){if(body.remove)links.splice(0);else links.push({kind:body.kind,target:body.target});json={links};}
        if(body.action==='history')json={items:[{revision:records[0].revision,actor:'Omega 已认证操作者',created_at:'2026-09-18',snapshot:records[0]}]};
      }
      return route.fulfill({json});
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    try{return route.fulfill({body:await readFile(new URL('../web-dist/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'})}catch{return route.fulfill({status:404,body:''})}
  });
  await page.goto('http://omega.test');await page.waitForFunction(()=>window.omegaAppState?.getSnapshot().authenticated);
  await page.getByRole('button',{name:'项目',exact:true}).click();const panel=page.getByRole('dialog',{name:'项目状态'});
  await panel.getByLabel('新项目名称').fill('Omega');await panel.getByRole('button',{name:'创建项目',exact:true}).click();
  await panel.getByRole('button',{name:'新增记录'}).click();await panel.getByLabel('标题',{exact:true}).fill('项目现状');await panel.getByLabel('内容',{exact:true}).fill('版本 v0.2.3；下一步验证全新会话');
  await panel.getByRole('button',{name:'保存记录'}).click();await panel.locator('article').getByText('项目现状',{exact:true}).waitFor();assert.equal(records[0].status,'candidate');
  await panel.getByRole('button',{name:'纠正 / 更新状态'}).click();await panel.getByLabel('记录状态',{exact:true}).selectOption('confirmed');await panel.getByRole('button',{name:'确认并保存'}).click();await panel.getByText('项目现状 · 已确认 · v2').waitFor();
  await panel.getByRole('button',{name:'修改历史',exact:true}).click();await panel.getByText(/v2 · Omega 已认证操作者/).waitFor();
  await panel.locator('summary').filter({hasText:'关联仓库'}).click();await panel.getByLabel('仓库路径或地址').fill('/workspace/omega');await panel.getByRole('button',{name:'添加仓库'}).click();await panel.getByText('repository · /workspace/omega').waitFor();
  assert.ok((await panel.boundingBox()).width<=width);assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await panel.getByRole('button',{name:'关闭项目状态'}).click();
  await page.evaluate(()=>{window.omegaAppState.patch({threadId:'t',mode:'chats'});window.omegaReactChat.render({items:[{id:'m',type:'agentMessage',text:'采用 SQLite\n维护来源和修订历史'}],active:false,metrics:'',historyMode:false,history:{outline:[],selectedTurn:null,hasOlder:false,hasNewer:false}},{itemText:item=>item.text,fullText:async item=>item.text,toggle(){},page(){},selectTurn(){},previous(){},next(){},latest(){}})});
  await page.getByRole('button',{name:'手动记录',exact:true}).click();
  await panel.getByLabel('选择项目').selectOption('p');assert.equal(await panel.getByLabel('标题',{exact:true}).inputValue(),'采用 SQLite');await panel.getByRole('button',{name:'保存记录'}).click();assert.equal(records[0].source.messageId,'m');
  await panel.getByRole('button',{name:'关闭项目状态'}).click();
  await page.evaluate(()=>{window.omegaReactChat.render({items:[{id:'code',type:'agentMessage',text:'```js\nconsole.log("single-code");\n```'}],active:false,metrics:'',historyMode:false,history:{outline:[],selectedTurn:null,hasOlder:false,hasNewer:false}},{itemText:item=>item.text,fullText:async item=>item.text,toggle(){},page(){},selectTurn(){},previous(){},next(){},latest(){}});Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});document.execCommand=command=>{if(command!=='copy')return false;window.copiedFallbackText=window.getSelection()?.toString();return true;};});
  const singleCode=page.locator('[data-item-id="code"] .react-code-copy');await singleCode.click();assert.equal(await page.evaluate(()=>window.copiedFallbackText),'console.log("single-code");\n');await singleCode.getByText('已复制').waitFor();
  await page.evaluate(()=>{let cursor=0;window.historyCalls=[];const turns=[{turnId:'older-2',items:[{id:'old-message-2',turnId:'older-2',type:'agentMessage',pageText:'历史回答 2',totalLength:6}],hasMore:true},{turnId:'older-1',items:[{id:'old-message-1',turnId:'older-1',type:'agentMessage',pageText:'历史回答 1',totalLength:6}],hasMore:false}];window.omegaReactChat.render({threadId:'t',items:[{id:'recent',type:'agentMessage',pageText:'最新回答。'.repeat(1000),totalLength:5000}],active:false,metrics:'',historyMode:false,history:{outline:[],selectedTurn:'recent-turn',hasOlder:true,hasNewer:false}},{itemText:item=>item.pageText||item.text||'',fullText:async item=>{window.historyCalls.push(item.turnId||'recent');return item.pageText},toggle(){},page(){},selectTurn(){},previous(){},next(){},latest(){},loadOlder:async()=>turns[cursor++]||null,olderItem:async item=>item});});
  const area=page.locator('#messages');await area.evaluate(node=>{node.scrollTop=150});const before=await area.evaluate(node=>({top:node.scrollTop,height:node.scrollHeight}));
  await page.locator('.chat-history-loading button').evaluate(node=>node.click());await page.locator('[data-history-turn="older-2"]').waitFor();
  const after=await area.evaluate(node=>({top:node.scrollTop,height:node.scrollHeight}));assert.ok(Math.abs(after.top-before.top-(after.height-before.height))<3,'prepending older messages preserves scroll anchor');
  await page.locator('[data-history-turn="older-2"] .copy-message').click();assert.equal(await page.evaluate(()=>window.historyCalls.at(-1)),'older-2');
  await area.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'))});await page.locator('[data-history-turn="older-1"]').waitFor();await page.getByRole('button',{name:'已到最早记录'}).waitFor();
  const rememberedTop=await area.evaluate(node=>{node.scrollTop=Math.min(180,node.scrollHeight-node.clientHeight);return node.scrollTop});
  await page.evaluate(()=>window.omegaReactChat.render({threadId:'other',items:[{id:'other-message',type:'agentMessage',pageText:'另一个会话'}],active:false,metrics:'',historyMode:false,history:{outline:[],selectedTurn:'other-turn',hasOlder:false,hasNewer:false}},{itemText:item=>item.pageText||'',fullText:async item=>item.pageText,toggle(){},page(){},selectTurn(){},previous(){},next(){},latest(){},loadOlder:async()=>null,olderItem:async item=>item}));
  await page.locator('[data-item-id="other-message"]').waitFor();
  await page.evaluate(()=>window.omegaReactChat.render({threadId:'t',items:[{id:'recent',type:'agentMessage',pageText:'最新回答。'.repeat(1000),totalLength:5000}],active:false,metrics:'',historyMode:false,history:{outline:[],selectedTurn:'recent-turn',hasOlder:true,hasNewer:false}},{itemText:item=>item.pageText||item.text||'',fullText:async item=>item.pageText,toggle(){},page(){},selectTurn(){},previous(){},next(){},latest(){},loadOlder:async()=>null,olderItem:async item=>item}));
  await page.locator('[data-history-turn="older-1"]').waitFor();assert.ok(Math.abs(await area.evaluate(node=>node.scrollTop)-rememberedTop)<3,'switching back restores loaded history and scroll position');
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px projects: create, candidate, confirm, history, links, capture, layout`);
}}finally{await browser.close()}
