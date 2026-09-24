import {chromium} from '@playwright/test';
import {access,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.OMEGA_TEST_CHROME||await access(chrome).then(()=>chrome,()=>undefined);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{sessionStorage.setItem('omega-key','test');const original=fetch;window.fetch=(url,options)=>String(url).includes('/api/events')?Promise.resolve(new Response(new ReadableStream({start(){}}))):original(url,options)});
  const content={name:'回归检查',description:'重复检查流程',whenToUse:'新版本需要回归时',inputs:['仓库'],steps:['运行测试','记录失败'],verification:['核对测试输出'],limits:['不代表线上通过']};
  let entry=null,generated=false;const calls=[];
  await page.route('**/*',async route=>{const url=new URL(route.request().url()),body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(url.pathname.startsWith('/api/')){let json={data:[],active:{},approvals:[]};
      if(url.pathname==='/api/status')json={ready:true,workspace:'/repo',devices:1,active:{},approvals:[]};
      else if(url.pathname==='/api/groups')json={groups:[]};
      else if(url.pathname==='/api/rpc')json={data:[{id:'t',name:'测试会话',cwd:'/repo'}]};
      else if(url.pathname==='/api/skills'){
        if(!body)json=url.searchParams.has('id')?url.searchParams.has('history')?{items:[]}:{entry:{...entry,status:generated?'draft':entry.status,content:generated?content:null,sourceText:'原始问题和两轮回复'}}:{items:entry?[entry]:[]};
        else if(body.action==='sourceOptions')json={items:[{id:'turn-2',label:'补充条件',status:'completed'},{id:'turn-1',label:'原始问题',status:'completed'}],nextCursor:null};
        else if(body.action==='preview'){calls.push(body);json={source:{ids:body.ids,labels:['原始问题','补充条件'],chars:30,omissions:[]},text:'原始问题\n第一条回复\n补充条件\n修正回复'};}
        else if(body.action==='draft'){entry={id:'skill-1',status:'generating',content:null,source:{scope:'thread',targetId:'t',ids:body.ids,labels:['原始问题','补充条件'],omissions:[]},revision:1};json={entry};generated=true;}
        else if(body.action==='save'){entry={...entry,status:body.status,content:body.content,revision:entry.revision+1,sourceText:'原始问题和两轮回复'};json={entry};}
      }
      return route.fulfill({json});}
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);try{return route.fulfill({body:await readFile(new URL('../web-dist/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'})}catch{return route.fulfill({status:404,body:''})}
  });
  await page.goto('http://omega.test');await page.waitForFunction(()=>window.omegaAppState?.getSnapshot().authenticated);
  await page.evaluate(()=>window.omegaAppState.patch({threadId:'t',mode:'chats'}));
  if(width<700){await page.locator('#thread-more summary').click();await page.locator('.mobile-work-menu').getByRole('button',{name:'Skills'}).click();}else await page.getByRole('button',{name:'Skills',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Omega Skills'});
  await dialog.waitFor();
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.accent='purple'});
  assert.equal(await dialog.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)','Skills uses the shared themed dialog surface');
  assert.ok(await dialog.locator('.work-body .work-card').count()>=1,'Skills uses the same card layout as project status');
  await dialog.getByLabel('提炼起点').selectOption('turn-1');await dialog.getByLabel('提炼终点').selectOption('turn-2');
  await dialog.getByRole('button',{name:'预览实际来源'}).click();await dialog.getByText('共 2 轮／问题', {exact:false}).waitFor();
  assert.deepEqual(calls[0].ids,['turn-1','turn-2']);
  await dialog.getByRole('button',{name:'让会话整理草稿'}).click();await dialog.getByRole('button',{name:'确认并启用'}).waitFor();
  await dialog.getByRole('button',{name:'确认并启用'}).click();await dialog.getByRole('button',{name:'用于当前会话下一条消息'}).click();
  assert.equal(await page.evaluate(()=>window.omegaAppState.getSnapshot().selectedSkill?.id),'skill-1');
  assert.ok((await dialog.count())===0);assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px Skill source preview, draft review and explicit use`);
}}finally{await browser.close()}
