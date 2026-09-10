// tauri-plugin-http 2.6 injects the local WebView's Origin by default.
// With its unsafe-headers feature, an explicitly empty Origin is removed by
// the Rust plugin. Keep server-side browser Origin checks unchanged.
export function requestNative(fetch, url, options = {}) {
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  headers.origin = '';
  return fetch(url, {...options, headers, maxRedirections:0, connectTimeout:15000});
}
