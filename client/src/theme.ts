export const THEME_KEY='omega-appearance-v1';
export type Appearance={mode:'system'|'light'|'dark';accent:'green'|'blue'|'purple'|'amber'};
export function parseAppearance(value:unknown):Appearance{
  const saved=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return {mode:typeof saved.mode==='string'&&['system','light','dark'].includes(saved.mode)?saved.mode as Appearance['mode']:'system',accent:typeof saved.accent==='string'&&['green','blue','purple','amber'].includes(saved.accent)?saved.accent as Appearance['accent']:'green'};
}
export function readAppearance():Appearance{try{return parseAppearance(JSON.parse(localStorage.getItem(THEME_KEY)||'null'));}catch{return parseAppearance(null);}}
export function applyAppearance(value:Appearance){
  const root=document.documentElement;
  root.dataset.theme=value.mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):value.mode;
  root.dataset.accent=value.accent;
  window.dispatchEvent(new Event('omega:appearance-changed'));
}
export function saveAppearance(value:Appearance){
  const safe=parseAppearance(value);localStorage.setItem(THEME_KEY,JSON.stringify(safe));applyAppearance(safe);
}
export function installAppearance(){
  const refresh=()=>applyAppearance(readAppearance());refresh();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',refresh);
  window.addEventListener('storage',event=>{if(event.key===THEME_KEY||event.key===null)refresh();});
}
