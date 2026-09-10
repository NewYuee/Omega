import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

export function markdownBody(text) {
  const body = document.createElement('div');
  body.className = 'markdown-body';
  body.append(DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p','br','hr','h1','h2','h3','h4','h5','h6','strong','em','del','blockquote','ul','ol','li','pre','code','a','table','thead','tbody','tr','th','td','input'],
    ALLOWED_ATTR: ['href','title','class','start','align','type','checked','disabled'],
  }));
  for (const link of body.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) link.removeAttribute('href');
    else if (!href.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
  for (const input of body.querySelectorAll('input')) { input.type = 'checkbox'; input.disabled = true; }
  for (const table of body.querySelectorAll('table')) {
    const wrapper = document.createElement('div'); wrapper.className = 'table-scroll'; table.replaceWith(wrapper); wrapper.append(table);
  }
  for (const pre of body.querySelectorAll('pre')) {
    const code = pre.querySelector('code'); if (!code) continue;
    const wrapper = document.createElement('div'); wrapper.className = 'code-block';
    const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
    const language = document.createElement('span'); language.textContent = [...code.classList].find(x=>x.startsWith('language-'))?.slice(9) || 'text';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.setAttribute('aria-label','复制代码');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(code.textContent); copy.textContent = '已复制'; } catch { copy.textContent = '请选中代码复制'; } };
    toolbar.append(language,copy); pre.replaceWith(wrapper); wrapper.append(toolbar,pre);
  }
  return body;
}
