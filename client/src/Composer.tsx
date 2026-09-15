import {useEffect,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {RichPasteEditor,type RichPasteEditorHandle,type RichPastePayload} from './RichPasteEditor.js';
import type {PastedTextTransport} from './pasted-content.js';

interface Attachment{key:string;id?:string;index:number;name:string;status:string;url:string;ready:boolean}
interface Model{scope?:string;sending:boolean;enabled:boolean;active:boolean;attachmentsReady:boolean;attachments:Attachment[];workspace:string}
interface Actions extends PastedTextTransport{submit(value:RichPastePayload):Promise<boolean>;stop():Promise<void>|void;addFiles(files:File[]):string[];removeImage(key:string):void;removeAttachment(index:number):void;openModelSettings():void;report(message:string):void}

import {ComposerIcon as Icon} from './ComposerIcon.js';
function Composer({model,actions}:{model:Model;actions:Actions}){
  const [draft,setDraft]=useState('');
  const [uploadingPaste,setUploadingPaste]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [dragging,setDragging]=useState(false);
  const prompt=useRef<RichPasteEditorHandle>(null),picker=useRef<HTMLInputElement>(null);
  const locked=model.sending||model.active;
  useEffect(()=>{document.body.classList.toggle('composer-expanded',expanded);return()=>document.body.classList.remove('composer-expanded')},[expanded]);
  useEffect(()=>{const collapse=()=>setExpanded(false);window.addEventListener('omega:composer-collapse',collapse);return()=>window.removeEventListener('omega:composer-collapse',collapse)},[]);
  useEffect(()=>{if(!expanded)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[expanded]);
  useEffect(()=>{const form=document.getElementById('composer');if(!form)return;const over=(event:DragEvent)=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();setDragging(true)}};const leave=(event:DragEvent)=>{if(!form.contains(event.relatedTarget as Node))setDragging(false)};const drop=(event:DragEvent)=>{event.preventDefault();setDragging(false);ingest(Array.from(event.dataTransfer?.files||[]))};form.addEventListener('dragover',over);form.addEventListener('dragleave',leave);form.addEventListener('drop',drop);return()=>{form.removeEventListener('dragover',over);form.removeEventListener('dragleave',leave);form.removeEventListener('drop',drop)}},[locked]);
  const submit=async()=>{const recalled=prompt.current?.getDraft();const value=prompt.current?.payload()||{text:'',pasteIds:[]};if(locked||uploadingPaste||!model.enabled||!model.attachmentsReady||(!value.text&&!model.attachments.length))return;try{if(await actions.submit(value)){if(recalled)prompt.current?.rememberDraft(recalled);prompt.current?.clear();setDraft('');setExpanded(false)}}catch(error){actions.report(error instanceof Error?error.message:String(error))}};
  const ingest=(files:File[])=>{if(files.length&&!locked){const keys=actions.addFiles(files);prompt.current?.insertImages(keys)}};
  return <>
    <div className="editor-heading"><h2>专注编辑</h2><button id="editor-close" type="button" className="secondary" onClick={()=>setExpanded(false)}>收起编辑</button></div>
    <input ref={picker} id="image-files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>{ingest(Array.from(event.target.files||[]));event.target.value=''}}/>
    <RichPasteEditor scope={model.scope} ref={prompt} id="prompt" label="消息" placeholder="今天想推进什么？" disabled={locked} transport={actions} report={actions.report} images={model.attachments} onRemoveImage={actions.removeImage} onFiles={ingest} onEnter={()=>void submit()} onChange={state=>{setDraft(state.text);setUploadingPaste(state.uploading)}}/>
    <div className="compose-footer">
      <button type="button" id="add-image" disabled={locked||model.attachments.length>=4} title="选择、粘贴或拖拽图片 · 支持 PNG、JPEG、WebP · 最多 4 张，每张 8 MB · 上传后保留 7 天" onMouseDown={event=>{event.preventDefault();prompt.current?.saveSelection()}} onClick={()=>picker.current?.click()}><Icon kind="image"/>图片</button>
      <button type="button" id="expand-editor" className="icon-button" aria-label="全屏编辑" title="全屏编辑" onClick={()=>{setExpanded(true);requestAnimationFrame(()=>prompt.current?.focus())}}><Icon kind="expand"/></button>
      <button type="button" id="model-settings" className="icon-button" title="模型设置" aria-label="模型设置" disabled={!model.enabled||model.sending} onClick={actions.openModelSettings}><Icon kind="sliders"/></button>
      <span id="workspace">{model.workspace||'连接你的工作空间'}</span>
      <div>{model.active&&<button type="button" id="stop" onClick={()=>void actions.stop()}>停止</button>}<button type="button" id="send" disabled={locked||uploadingPaste||!model.enabled||!model.attachmentsReady||(!draft.trim()&&!model.attachments.length)} onClick={()=>void submit()}><Icon kind="send"/>{uploadingPaste?'保存粘贴…':model.sending?'提交中…':'发送'}</button></div>
    </div>
    {dragging&&<div className="composer-drop">松开即可添加图片</div>}
  </>;
}

export function installComposer(){
  const host=document.getElementById('composer');if(!host)return;
  host.dataset.reactOwned='true';
  const root:Root=createRoot(host);
  window.omegaReactComposer={
    render:(model,actions)=>root.render(<Composer model={model} actions={actions}/>),
    collapse:()=>{const expanded=document.body.classList.contains('composer-expanded');window.dispatchEvent(new Event('omega:composer-collapse'));return expanded},
  };
  window.dispatchEvent(new Event('omega:react-composer-ready'));
}
