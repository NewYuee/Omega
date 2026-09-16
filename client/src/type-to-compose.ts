/** Route typing on the chat canvas to its composer, without synthesizing text. */
export function installTypeToCompose(){
  const visible=(node:HTMLElement)=>!node.closest('details:not([open]),[hidden]')&&!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const editable='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
  const blocked='dialog[open],[aria-modal="true"],[role="menu"],.omega-palette-backdrop,.thread-more-menu,.group-more-menu,.group-budget-menu[open],.group-mode-menu[open]';
  const keydown=(event:KeyboardEvent)=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
    // Space remains page scrolling / button activation. IME initiation is commonly Process/229.
    if(!((event.key.length===1&&event.key!==' ')||event.key==='Process'||event.keyCode===229))return;
    if(matchMedia('(pointer:coarse)').matches)return;
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest(editable)||document.activeElement?.closest(editable))return;
    if(window.getSelection()?.toString())return;
    if([...document.querySelectorAll<HTMLElement>(blocked)].some(visible))return;
    const editor=document.getElementById(document.body.classList.contains('group-mode')?'group-prompt':'prompt');
    if(!editor||!editor.isContentEditable||!visible(editor))return;
    editor.focus({preventScroll:true});
    const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
    // Keep the native default action: the first character and IME composition land in the editor.
  };
  window.addEventListener('keydown',keydown);
  return()=>window.removeEventListener('keydown',keydown);
}
