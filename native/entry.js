import { invoke } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { normalizeServer, apiUrl, parseProfile } from './connection.js';
import { requestNative } from './transport.js';

let profile = null, startupError = '';
try { profile = parseProfile(await invoke('plugin:omega-vault|load')); }
catch { startupError = '无法读取本机安全存储。请解锁系统钥匙串后重试，或忘记本机连接后重新填写。'; }
const setup = document.getElementById('setup');
const form = document.getElementById('connect-form');
setup.querySelector('p').textContent = '填写同一个 Omega 服务端，各设备共享会话。密钥保存在本机系统安全存储中。';
const fields = document.createElement('div');
fields.innerHTML = '<label>服务器地址<input id="server-url" type="url" placeholder="https://omega.example.com" required autocomplete="url" spellcheck="false" autocapitalize="off"></label><label class="native-http-option"><input id="allow-http" type="checkbox">允许 HTTP 明文连接</label><p class="native-http-warning" hidden>HTTP 会明文传输访问密钥、消息和图片，公网建议使用 HTTPS。此选项不会关闭 HTTPS 证书校验。</p>';
form.insertBefore(fields, form.querySelector('label'));
const serverField = document.getElementById('server-url');
const httpField = document.getElementById('allow-http');
serverField.value = profile?.serverUrl || '';
httpField.checked = profile?.allowHttp || false;
const warning = fields.querySelector('.native-http-warning');
const updateWarning = () => warning.hidden = !httpField.checked && !serverField.value.startsWith('http:');
serverField.addEventListener('input', updateWarning);
httpField.addEventListener('change', updateWarning); updateWarning();
const status = document.createElement('p'); status.id='native-connection-error'; status.setAttribute('role','alert'); status.textContent=startupError;
form.append(status);
const forget = document.createElement('button'); forget.type='button'; forget.className='secondary'; forget.textContent='忘记本机连接';
form.append(forget);
forget.onclick = async () => {
  try { await invoke('plugin:omega-vault|clear'); location.reload(); }
  catch { status.textContent='无法移除保存的连接，请解锁系统安全存储后重试。'; }
};
let preparing = false;
const adapter = {
  get profile() { return profile; },
  fetch(route, options = {}) {
    if (!profile) return Promise.reject(new Error('请先连接 Omega 服务端'));
    return requestNative(nativeFetch, apiUrl(profile.serverUrl, route), options);
  },
  async rememberKey(key) {
    const next = {...profile, key};
    await invoke('plugin:omega-vault|save', {value:JSON.stringify(next)});
    profile = next;
  },
  async prepareConnection(key) {
    if (preparing) return;
    preparing = true;
    const submit = form.querySelector('button'); submit.disabled = true; status.textContent = '正在验证连接…';
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
    try {
      const next = {serverUrl:normalizeServer(serverField.value,httpField.checked),key,allowHttp:httpField.checked};
      if (!key || key.length > 256) throw new Error('请输入有效的访问密钥');
      const response = await requestNative(nativeFetch, apiUrl(next.serverUrl,'/api/status'), {
        headers:{authorization:'Bearer '+key}, signal:controller.signal, maxRedirections:0, connectTimeout:15000
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(response.status===401 ? '密钥不正确，请重新填写' : '连接失败（HTTP '+response.status+'），请检查 FRP 转发和服务器地址'); }
      const result = await response.json();
      if (!result.ready || !result.active || !Array.isArray(result.approvals)) throw new Error('Omega 服务端尚未就绪或地址不是 Omega 服务端');
      await invoke('plugin:omega-vault|save', {value:JSON.stringify(next)});
      // A full local reload prevents responses/drafts/images leaking between servers.
      // It reloads packaged assets, never the configured remote page.
      location.reload();
    } catch(e) {
      status.textContent = controller.signal.aborted ? '连接超过 15 秒，请检查服务端、地址和网络后重试。' : String(e.message || e);
    } finally { clearTimeout(timer); preparing=false; submit.disabled=false; }
  }
};
globalThis.__OMEGA_NATIVE__ = adapter;
sessionStorage.removeItem('omega-key'); // Never leave credentials in WebView storage.
const switchButton = document.createElement('button'); switchButton.id='switch-server'; switchButton.type='button'; switchButton.className='secondary'; switchButton.textContent='切换服务器 / 重新连接';
document.querySelector('#key-summary .dialog-actions').prepend(switchButton);
switchButton.onclick = () => {
  document.getElementById('key-settings').close();
  document.getElementById('token').value='';
  status.textContent='切换会重新载入客户端；当前未发送草稿不会保留，服务端任务不受影响。';
  setup.showModal();
};
const cancel = document.createElement('button'); cancel.type='button'; cancel.className='secondary'; cancel.textContent='返回';
cancel.onclick = () => setup.close(); form.append(cancel); cancel.hidden=!profile;
document.addEventListener('click',e => {
  const a=e.target.closest?.('a');
  if (!a) return;
  e.preventDefault();
  if (/^https?:\/\//.test(a.getAttribute('href') || '')) openUrl(a.href).catch(()=>{});
});
// Android host can consume Back without throwing away a draft or closing the App.
globalThis.omegaBack = () => {
  if(globalThis.omegaReactGroupComposer?.collapse())return true;
  if(globalThis.omegaReactComposer?.collapse())return true;
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (!dialog) return false;
  const event = new Event('cancel',{cancelable:true});
  if (dialog.dispatchEvent(event)) dialog.close();
  return true;
};
await import('../client/src/main.tsx');
