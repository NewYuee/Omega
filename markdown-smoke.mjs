import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4310');
  const result = await page.evaluate(async () => {
    document.getElementById('setup').close();
    const { markdownBody } = await import('/markdown.js');
    const sample = '# 本地工作空间\n\n支持 **Markdown** 与 `行内代码`。\n\n## 执行命令\n\n```bash\nsudo softwareupdate --schedule off\n' + 'a'.repeat(200) + '\n```\n\n- 查看状态\n- 继续工作\n\n> 这是引用，不是命令。\n\n| 项目 | 状态 |\n| --- | --- |\n| Omega | 已连接 |\n\n[安全链接](https://example.com)\n\n[恶意链接](javascript:alert(1))<img src=x onerror="window.compromised=true"><script>window.compromised=true</script>';
    const body = markdownBody(sample); document.getElementById('messages').replaceChildren(body);
    const partial = markdownBody('```js\nconst value = 1;');
    return { heading:body.querySelector('h1')?.textContent, code:body.querySelector('pre code')?.textContent, rows:body.querySelectorAll('tbody tr').length, list:body.querySelectorAll('li').length, unsafe:body.querySelectorAll('script,img,[onerror],a[href^="javascript:"]').length, partial:partial.querySelector('pre code')?.textContent, compromised:!!window.compromised };
  });
  assert.equal(result.heading,'本地工作空间'); assert.equal(result.rows,1); assert.equal(result.list,2); assert.equal(result.unsafe,0); assert.equal(result.compromised,false); assert.ok(result.partial.includes('const value'));
  await page.screenshot({path:'.omega/markdown-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.omega/markdown-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: headings, fenced code, lists, tables, partial stream, unsafe HTML/URL filtering, mobile overflow');
} finally {await browser.close();}
