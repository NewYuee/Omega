import {chromium} from '@playwright/test';
import {access,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.OMEGA_TEST_CHROME||await access(chrome).then(()=>chrome,()=>undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(10000);
  const errors=[],posts=[];let resolved=false,approved=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{sessionStorage.setItem('omega-key','test');const original=fetch;window.fetch=(url,options)=>String(url).includes('/api/events')?Promise.resolve(new Response(new ReadableStream({start(){}}))):original(url,options)});
  await page.route('**/*',async route=>{const url=new URL(route.request().url()),body=route.request().method()==='POST'?route.request().postDataJSON():null;if(url.pathname.startsWith('/api/')){
    let json={data:[],active:{},approvals:[]};
    if(url.pathname==='/api/status')json={ready:true,workspace:'/repo',devices:1,active:{},approvals:[]};
    if(url.pathname==='/api/groups'&&!body)json={groups:[]};
    if(url.pathname==='/api/rpc')json={data:[{id:'t',name:'Project',cwd:'/repo'}]};
    if(url.pathname==='/api/attention'){const items=[...(!approved?[{id:'approval:a',kind:'approval',request:{id:'a',method:'item/commandExecution/requestApproval',params:{threadId:'t',command:'npm test'}}}]:[]),...(!resolved?[{id:'decision:d',kind:'decision',groupId:'g',taskId:'task',requirementId:'q',memberName:'Developer',groupName:'Team',decision:{id:'d',status:'pending',title:'选择实现方案',question:'采用哪一个？',options:[{id:'one',label:'方案一'},{id:'two',label:'方案二'}]}}]:[])];json={items,total:items.length};}
    if(url.pathname==='/api/groups'&&body){posts.push(body);resolved=true;json={group:{id:'g'}};}
    if(url.pathname==='/api/answer'){posts.push(body);approved=true;json={ok:true};}
    if(url.pathname==='/api/repository'){posts.push(body);json=body.file?{diff:'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',previewable:true}:{directory:'/workspace',repositories:[{id:'omega',name:'omega'},{id:'other',name:'other'}],repository:body.repository,root:body.repository?'/workspace/'+body.repository:null,message:body.repository?null:'请选择项目仓库',branch:'main',total:body.repository?2:0,nextOffset:null,files:body.repository?[{path:'a.ts',status:'M'},{path:'runtime/tokenhub-asset-monitor-very-long-file-name-without-truncation.ts',status:'?'}]:[]};}
    if(url.pathname==='/api/automations')json={automations:[{id:'auto',name:'Daily',threadId:'t',lastStatus:'completed',enabled:true,schedule:{kind:'interval',minutes:60}}]};
    if(url.pathname==='/api/automation-runs')json={items:[{id:'run',thread_id:'t',turn_id:'turn',status:'completed',manual:1,scheduled_at:'2026-09-16T00:00:00Z',started_at:'2026-09-16T00:00:01Z',finished_at:'2026-09-16T00:00:03Z'}],nextCursor:null};
    return route.fulfill({json});
  }const name=url.pathname==='/'?'index.html':url.pathname.slice(1);try{return route.fulfill({body:await readFile(new URL('../web-dist/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'})}catch{return route.fulfill({status:404,body:''})}});
  await page.goto('http://omega.test');await page.waitForFunction(()=>window.omegaDialogs&&window.omegaAppState?.getSnapshot().authenticated);
  const openWorkPanel=async(name)=>{if(width<700){const more=page.locator('#thread-more');await more.locator('summary').click();await more.getByRole('button',{name,exact:typeof name==='string'}).click();}else await page.getByRole('button',{name,exact:typeof name==='string'}).click();};
  await openWorkPanel(/^待处理/);const panel=page.getByRole('dialog',{name:'需要你处理'});await panel.getByText('选择实现方案').waitFor();
  assert.ok((await panel.boundingBox()).width<=width);
  await panel.getByRole('button',{name:'选择方案'}).click();const decision=page.locator('#decision-dialog');await decision.getByText('方案二',{exact:true}).click();await decision.getByRole('button',{name:'确认并回复'}).click();
  await page.waitForFunction(()=>!document.querySelector('#decision-dialog'));assert.equal(posts[0].decisionId,'d');assert.equal(posts[0].choiceId,'two');
  await panel.getByRole('button',{name:'允许本次'}).click();assert.equal(posts[1].result.decision,'accept');
  await panel.getByRole('button',{name:'关闭工作面板'}).click();
  await openWorkPanel('变更');const repo=page.getByRole('dialog',{name:'仓库变更'});await repo.getByLabel('变更所属会话').selectOption('t');await repo.getByLabel('项目仓库').selectOption('omega');await repo.getByRole('button',{name:'修改 a.ts',exact:true}).click();await repo.locator('.is-added .repository-line-code').filter({hasText:'new'}).waitFor();assert.equal(await repo.locator('.is-added .repository-line-code').innerText(),'new\n');assert.equal(await repo.locator('.is-removed .repository-line-code').innerText(),'old\n');assert.doesNotMatch(await repo.locator('pre').innerText(),/diff --git|\+new|-old/);
  const longFile=repo.locator('.repository-file').filter({hasText:'tokenhub-asset-monitor'});assert.equal(await longFile.evaluate(el=>{const label=el.querySelector('.repository-file-path'),a=el.getBoundingClientRect(),b=label.getBoundingClientRect();return b.bottom<=a.bottom&&b.right<=a.right&&el.scrollHeight<=el.clientHeight;}),true);
  assert.equal(await repo.locator('.repository-layout').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(posts.at(-1).repository,'omega');await repo.getByLabel('项目仓库').selectOption('other');await repo.getByText('/workspace/other',{exact:false}).waitFor();assert.equal(await repo.locator('pre').count(),0);assert.ok((await repo.boundingBox()).width<=width);
  await repo.getByRole('button',{name:'关闭工作面板'}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('omega:open-control-center')));const center=page.getByRole('dialog',{name:'工作控制中心'});await center.getByRole('button',{name:'运行历史',exact:true}).click();await center.getByText('成功 · 手动运行').waitFor();assert.equal(await center.locator('.automation-history').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  await center.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px attention decisions/approvals, repository preview, automation history`);
}}finally{await browser.close()}
