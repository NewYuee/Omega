// Browser builds have no native imports; tests can still intercept window.fetch.
export const native = globalThis.__OMEGA_NATIVE__ || null;
export const apiFetch = (route, options) => native ? native.fetch(route, options) : globalThis.fetch(route, options);
export const initialKey = () => native ? native.profile?.key || '' : sessionStorage.getItem('omega-key') || '';
export async function rememberKey(key) {
  if (native) await native.rememberKey(key);
  else sessionStorage.setItem('omega-key', key);
}
export function forgetSessionKey() { if (!native) sessionStorage.removeItem('omega-key'); }
const threadKey = () => native ? 'omega-thread:' + (native.profile?.serverUrl || '') : 'omega-thread';
export const savedThread = () => localStorage.getItem(threadKey());
export const rememberThread = id => id ? localStorage.setItem(threadKey(),id) : localStorage.removeItem(threadKey());
export function clientDeviceId(){
  const storageKey='omega-device-id';
  try{const saved=localStorage.getItem(storageKey);if(saved)return saved;}catch{}
  let value;
  if(typeof crypto.randomUUID==='function')value=crypto.randomUUID();
  else{const bytes=crypto.getRandomValues(new Uint8Array(16));value=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  try{localStorage.setItem(storageKey,value);}catch{}
  return value;
}
