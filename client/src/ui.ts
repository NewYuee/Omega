const $ = (id:string) => document.getElementById(id);
function menuIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'ui-icon'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d','M3 6h18M3 12h18M3 18h18'); svg.append(path); return svg;
}
export function initUI() {
  $('menu-toggle')?.replaceChildren(menuIcon());
  const viewport=()=>{
    document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height||innerHeight)+'px');
    document.documentElement.style.setProperty('--viewport-top',(window.visualViewport?.offsetTop||0)+'px');
  };
  window.visualViewport?.addEventListener('resize',viewport);
  window.addEventListener('resize',viewport);
  viewport();
}
