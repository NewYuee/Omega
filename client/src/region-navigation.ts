/** Opt-in region navigation: never move focus merely because a list changes. */
export function installRegionNavigation(){
  const visible=(node:HTMLElement)=>!node.closest('[hidden],details:not([open])')&&!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const editable='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
  const blocked=()=>[...document.querySelectorAll<HTMLElement>('dialog[open],[aria-modal="true"],[role="menu"],.omega-palette-backdrop,.thread-more-menu,.group-more-menu,.group-budget-menu[open],.group-mode-menu[open]')].some(visible);
  type Region={node:HTMLElement;items:string;label:string};
  let active:HTMLElement|null=null;
  let editingSelect:HTMLSelectElement|null=null;
  const stopEditing=()=>{if(editingSelect){editingSelect.removeAttribute('data-keyboard-editing');editingSelect.title='按 Enter 调整排序；↑ / ↓ 继续侧栏导航';}editingSelect=null;};
  const clear=()=>{stopEditing();document.querySelectorAll('.keyboard-region,.keyboard-region-item').forEach(node=>node.classList.remove('keyboard-region','keyboard-region-item'));active=null;};
  const regions=():Region[]=>{
    const group=document.body.classList.contains('group-mode');
    const sidebarItems='#show-chats,#show-groups,#new,#new-group,.thread-sort select,#threads .thread-open,#groups .group-row,#open-control-center,#settings';
    const specs=group?[
      ['#sidebar',sidebarItems,'工作区侧栏'],
      ['.group-panel:not(.task-panel)','.member-card .link-button','成员'],
      ['#group-timeline','','聊天内容'],
      ['.task-panel','.question-link','问题定位'],
    ]:[['#sidebar',sidebarItems,'工作区侧栏'],['#messages','','聊天内容']];
    return specs.flatMap(([selector,items,label])=>{const node=document.querySelector<HTMLElement>(selector);return node&&visible(node)?[{node,items,label}]:[];});
  };
  const items=(region:Region)=>region.items?[...region.node.querySelectorAll<HTMLElement>(region.items)].filter(node=>visible(node)&&!node.matches(':disabled')):[];
  const select=(region:Region,item?:HTMLElement)=>{
    clear();active=region.node;active.classList.add('keyboard-region');
    active.title=`${region.label} · Alt + ← / → 切换区域，↑ / ↓ 选择，Home / End 到首尾，Enter 打开；排序框按 Enter 调整，Esc 退出调整；Esc 回到输入框`;
    const target=item||active;if(!item){active.tabIndex=-1;active.setAttribute('aria-label',region.label);}
    else item.classList.add('keyboard-region-item');
    target.focus({preventScroll:true});if(item)item.scrollIntoView({block:'nearest',inline:'nearest'});
  };
  const keydown=(event:KeyboardEvent)=>{
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.shiftKey||blocked())return;
    const list=regions();if(!list.length)return;
    if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
      event.preventDefault();const index=list.findIndex(region=>region.node.contains(document.activeElement));
      const next=index<0?(event.key==='ArrowRight'?0:list.length-1):(index+(event.key==='ArrowRight'?1:-1)+list.length)%list.length;
      const region=list[next],options=items(region);
      select(region,options.find(node=>node.matches('.selected')||node.closest('.selected'))||options[0]);return;
    }
    if(event.altKey||!active||!active.contains(document.activeElement))return;
    const sort=document.activeElement instanceof HTMLSelectElement&&document.activeElement.matches('.thread-sort select')?document.activeElement:null;
    if(sort){
      if(event.key==='Enter'){event.preventDefault();if(editingSelect===sort)stopEditing();else{editingSelect=sort;sort.dataset.keyboardEditing='true';sort.title='调整排序：↑ / ↓，Enter 或 Esc 返回侧栏导航';}return;}
      if(editingSelect===sort){
        if(event.key==='Escape'){event.preventDefault();stopEditing();return;}
        if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){
          event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?sort.options.length-1:Math.max(0,Math.min(sort.options.length-1,sort.selectedIndex+(event.key==='ArrowDown'?1:-1)));
          sort.selectedIndex=index;sort.dispatchEvent(new Event('change',{bubbles:true}));return;
        }
        return;
      }
    }else if(document.activeElement?.closest(editable))return;
    if(event.key==='Escape'){
      const editor=document.getElementById(document.body.classList.contains('group-mode')?'group-prompt':'prompt');
      if(!editor||!visible(editor)||!editor.isContentEditable)return;
      event.preventDefault();clear();editor.focus({preventScroll:true});return;
    }
    if(document.activeElement?.matches('#show-chats,#show-groups')&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
      const region=list.find(region=>region.node===active),target=document.getElementById(event.key==='ArrowLeft'?'show-chats':'show-groups');
      if(region&&target){event.preventDefault();select(region,target);}return;
    }
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const region=list.find(region=>region.node===active);if(!region)return;
    event.preventDefault();const options=items(region),direction=event.key==='ArrowDown'?1:-1;
    if(!region.items){if(event.key==='Home'||event.key==='End')region.node.scrollTo({top:event.key==='Home'?0:region.node.scrollHeight,behavior:'auto'});else region.node.scrollBy({top:direction*100,behavior:'auto'});return;}
    if(!options.length)return;
    if(event.key==='Home'||event.key==='End'){select(region,options[event.key==='Home'?0:options.length-1]);return;}
    const index=options.indexOf(document.activeElement as HTMLElement);
    select(region,options[index<0?(direction>0?0:options.length-1):Math.max(0,Math.min(options.length-1,index+direction))]);
    // Enter uses the focused button's native activation; it must never trigger edit/delete actions.
  };
  const focusin=()=>{
    if(editingSelect&&document.activeElement!==editingSelect)stopEditing();
    if(!active)return;
    if(!active.contains(document.activeElement)){clear();return;}
    // Tab and pointer focus changes must not leave the old navigation item highlighted.
    active.querySelectorAll('.keyboard-region-item').forEach(node=>node.classList.remove('keyboard-region-item'));
    const region=regions().find(region=>region.node===active);
    if(region&&items(region).includes(document.activeElement as HTMLElement))document.activeElement?.classList.add('keyboard-region-item');
  };
  window.addEventListener('keydown',keydown);document.addEventListener('focusin',focusin);
  return()=>{clear();window.removeEventListener('keydown',keydown);document.removeEventListener('focusin',focusin);};
}
