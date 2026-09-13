import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';

const bundle=await build({entryPoints:['native/entry.js'],bundle:true,format:'esm',write:false,target:'chrome105',
  plugins:[{name:'test-native-boundary',setup(b) {
    const mocks={
      '@tauri-apps/api/core':'export const invoke=(...args)=>window.mockInvoke(...args)',
      '@tauri-apps/plugin-http':'export const fetch=(...args)=>window.mockFetch(...args)',
      '@tauri-apps/plugin-opener':'export const openUrl=(url)=>window.mockOpen(url)'
    };
    b.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));
    b.onResolve({filter:/^\/vendor\//},args=>({path:path.resolve(args.path.includes('marked')?'node_modules/marked/lib/marked.esm.js':'node_modules/dompurify/dist/purify.es.mjs')}));
  }}]});
const nativeHtml=(await readFile('public/index.html','utf8')).replace('</head>','<link rel="stylesheet" href="/omega-product.css"></head>');
const assets={'/':nativeHtml,'/style.css':await readFile('public/style.css'),'/omega-product.css':await readFile('client/src/product.css'),'/app.js':bundle.outputFiles[0].contents};
const server=createServer((req,res)=>{res.writeHead(assets[req.url]?200:404,{'content-type':req.url==='/app.js'?'text/javascript':req.url?.endsWith('.css')?'text/css':'text/html'});res.end(assets[req.url]||'');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:780}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.calls=[];window.submissions=[];window.opened=[];
      window.mockInvoke=async(cmd,args)=>{
        if(cmd.endsWith('|load'))return sessionStorage.getItem('test-vault');
        if(cmd.endsWith('|save')){sessionStorage.setItem('test-vault',args.value);return;}
        if(cmd.endsWith('|clear'))sessionStorage.removeItem('test-vault');
      };
      window.mockOpen=async url=>window.opened.push(url);
      window.mockFetch=async(url,options)=>{
        const p=new URL(url); window.calls.push({url,maxRedirections:options.maxRedirections,origin:options.headers.origin});
        if(options.headers.origin!=='')return new Response('{"error":"Origin rejected"}',{status:403});
        if(options.headers.authorization==='Bearer wrong')return new Response('{}',{status:401});
        if(p.pathname==='/api/events')return new Response(new ReadableStream({start(c){options.signal?.addEventListener('abort',()=>c.close(),{once:true});}}));
        const input=options.body?JSON.parse(options.body):{};
        if(input.method==='turn/start')window.submissions.push(input);
        const json=p.pathname==='/api/status'?{ready:true,workspace:'/tmp',active:{},approvals:[],devices:1}
          :p.pathname==='/api/history'?{thread:{id:'demo',name:'原生测试会话',cwd:'/tmp'},outline:[{id:'t',label:'测试'}],turn:{id:'t',items:[{id:'u',type:'userMessage',pageText:'测试问题'},{id:'a',type:'agentMessage',pageText:'## 原生答复 ✅\n\n[外部链接](https://example.com/)'}]}}
          :input.method==='thread/list'?{data:[{id:'demo',name:'原生测试会话'}]}
          :{thread:{id:'demo'},turn:{id:'next'}};
        return new Response(JSON.stringify(json),{headers:{'content-type':'application/json'}});
      };
    });
    await page.goto(base);
    await page.locator('#server-url').fill('http://omega.example.com');
    await page.locator('#token').fill('test-only-key');
    await page.locator('#connect-form > button').first().click();
    await page.getByText('HTTP 会明文传输密钥和聊天内容，请先确认风险或使用 HTTPS',{exact:true}).waitFor();
    assert.equal((await page.evaluate(()=>window.calls)).length,0);
    await page.locator('#allow-http').check();
    await page.locator('#token').fill('wrong');
    await page.locator('#connect-form > button').first().click();
    await page.getByText('密钥不正确，请重新填写',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('test-vault')),null);
    await page.locator('#token').fill('test-only-key');
    await page.locator('#connect-form > button').first().click();
    await page.waitForFunction(()=>!document.getElementById('setup').open);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('omega-key')),null);
    if(width<701)await page.locator('#menu-toggle').click();
    await page.locator('.thread-open').first().click();
    await page.locator('.message.assistant').waitFor();
    await page.locator('.message.assistant a').click();
    assert.deepEqual(await page.evaluate(()=>window.opened),['https://example.com/']);
    await page.locator('#prompt').fill('保留草稿');
    await page.locator('#expand-editor').click();
    assert.equal(await page.evaluate(()=>window.omegaBack()),true);
    await page.locator('#editor-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#prompt').inputValue(),'保留草稿');
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#prompt').inputValue(),'保留草稿');
    assert.equal(await page.evaluate(()=>window.submissions.length),0);
    await page.locator('#send').click();
    await page.waitForFunction(()=>window.submissions.length===1&&document.getElementById('prompt').value==='');
    assert.ok((await page.evaluate(()=>window.calls)).every(x=>x.url.startsWith('http://omega.example.com/api/')&&x.maxRedirections===0&&x.origin===''));
    await page.reload();
    await page.locator('.message.assistant').waitFor();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('omega-key')),null);
    if(width<701)await page.locator('#menu-toggle').click();
    await page.locator('#settings').click();await page.locator('#switch-server').click();
    await page.locator('#server-url').fill('https://other.example.com');await page.locator('#token').fill('other-test-key');
    await page.locator('#connect-form > button').first().click();
    await page.waitForFunction(()=>!document.getElementById('setup').open);
    assert.equal(await page.locator('.message').count(),0);
    assert.ok((await page.evaluate(()=>window.calls)).every(x=>x.url.startsWith('https://other.example.com/api/')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    await page.close();
    console.log('PASS native connection, HTTP consent, vault boundary, server isolation, history, resume, back, send '+width);
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
