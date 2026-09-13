const $ = id => document.getElementById(id);
const paths = {
  sliders:'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
  menu:'M3 6h18M3 12h18M3 18h18', close:'m6 6 12 12M6 18 18 6',
  plus:'M12 5v14M5 12h14', edit:'m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  expand:'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7',
  image:'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M7 7h.01',
  send:'m3 3 18 9-18 9 3-9-3-9ZM6 12h15',
  left:'m15 5-7 7 7 7', right:'m9 5 7 7-7 7', down:'M12 3v18m-7-7 7 7 7-7',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'ui-icon'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[name]); svg.append(path); return svg;
}
export function iconButton(button,name,label='') { button.replaceChildren(icon(name)); if(label)button.append(document.createTextNode(label)); }
export function initUI() {
  const status=document.createElement('span');status.className='mobile-only connection-light';status.setAttribute('role','status');
  $('mobile-new').before(status);
  const updateStatus=()=>{
    const label=$('connection').textContent.replace(/^[●○]\s*/,'');
    status.title=label;status.setAttribute('aria-label',label);
    status.classList.toggle('connected',/已连接|密钥已保存/.test(label));
  };
  new MutationObserver(updateStatus).observe($('connection'),{childList:true,characterData:true,subtree:true});updateStatus();
  for (const [id,name,label] of [['menu-toggle','menu'],['drawer-close','close'],['mobile-new','plus'],['expand-editor','expand'],['new','plus','新建会话'],['add-image','image','图片'],['send','send','发送'],['prev-exchange','left'],['next-exchange','right'],['floating-latest','down','回到最新'],['create-close','close']]) iconButton($(id),name,label);
  const sidebar=$('sidebar'), drawer=$('conversation-drawer');
  const sidebarAnchor=document.createComment('sidebar');
  sidebar.before(sidebarAnchor);
  const mobile=matchMedia('(max-width:700px)');
  const sidebarPreference='omega-sidebar-collapsed';
  const menuToggle=$('menu-toggle');
  const savedSidebarState=()=>{try{return localStorage.getItem(sidebarPreference)==='1';}catch{return false;}};
  const saveSidebarState=collapsed=>{try{localStorage.setItem(sidebarPreference,collapsed?'1':'0');}catch{}};
  function updateMenuToggle(){
    if(mobile.matches){
      menuToggle.setAttribute('aria-controls','conversation-drawer');
      menuToggle.setAttribute('aria-expanded',String(drawer.open));
      menuToggle.setAttribute('aria-label',drawer.open?'关闭列表':'打开列表');
      menuToggle.title=drawer.open?'关闭列表':'打开列表';
      return;
    }
    const collapsed=document.body.classList.contains('sidebar-collapsed');
    menuToggle.setAttribute('aria-controls','sidebar');
    menuToggle.setAttribute('aria-expanded',String(!collapsed));
    menuToggle.setAttribute('aria-label',collapsed?'展开侧栏':'收起侧栏');
    menuToggle.title=collapsed?'展开侧栏':'收起侧栏';
  }
  function applySidebarMode(){
    document.body.classList.toggle('sidebar-collapsed',!mobile.matches&&savedSidebarState());
    updateMenuToggle();
  }
  const closeDrawer=()=>{ if(drawer.open)drawer.close(); restoreSidebar(); };
  function restoreSidebar(){sidebarAnchor.after(sidebar);updateMenuToggle();}
  drawer.addEventListener('close',()=>{if(!drawer.open)restoreSidebar();});
  drawer.addEventListener('cancel',e=>{e.preventDefault();closeDrawer();});
  menuToggle.onclick=()=>{
    if(mobile.matches){drawer.append(sidebar);drawer.showModal();updateMenuToggle();$('drawer-close').focus();return;}
    const collapsed=document.body.classList.toggle('sidebar-collapsed');
    saveSidebarState(collapsed);updateMenuToggle();
  };
  $('drawer-close').onclick=closeDrawer;
  drawer.addEventListener('click',e=>{if(e.target===drawer)closeDrawer();});
  mobile.addEventListener('change',()=>{if(!mobile.matches){closeDrawer();restoreSidebar();}applySidebarMode();});
  applySidebarMode();
  $('mobile-new').onclick=()=>$('new').click();
  const viewport=()=>{
    document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height||innerHeight)+'px');
    document.documentElement.style.setProperty('--viewport-top',(window.visualViewport?.offsetTop||0)+'px');
  };
  window.visualViewport?.addEventListener('resize',viewport);
  window.addEventListener('resize',viewport);
  viewport();
  return {closeDrawer};
}
