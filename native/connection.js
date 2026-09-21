export function normalizeServer(value, allowHttp = false) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整地址，例如 https://omega.example.com'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('地址只填写 http(s)://域名:端口，不要包含密钥、路径或查询参数');
  }
  if (url.protocol === 'http:' && !allowHttp) throw new Error('HTTP 会明文传输密钥和聊天内容，请先确认风险或使用 HTTPS');
  return url.origin;
}
export function apiUrl(serverUrl, route) {
  if (typeof route !== 'string' || !/^\/api\/[a-z-]+(?:\/[a-zA-Z0-9_-]+)*(?:\?[^#]*)?$/.test(route)) throw new Error('不允许的 API 地址');
  const target = new URL(route, serverUrl);
  if (target.origin !== serverUrl) throw new Error('不允许跨服务器请求');
  return target.href;
}
export function parseProfile(value) {
  if (!value) return null;
  const p = JSON.parse(value);
  if (typeof p.key !== 'string' || !p.key.trim() || p.key.length > 256) throw new Error('保存的密钥格式异常');
  return {serverUrl:normalizeServer(p.serverUrl, p.allowHttp === true), key:p.key, allowHttp:p.allowHttp === true};
}
