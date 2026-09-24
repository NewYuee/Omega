import {TEXT_FILE_ACCEPT,DOCUMENT_ACCEPT} from './text-files.js';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {RichPasteEditor,type RichPasteEditorHandle,type RichPastePayload} from './RichPasteEditor.js';
import type {PastedTextTransport} from './pasted-content.js';
import {SlashCommandMenu,slashQuery,type SlashCommand} from './SlashCommandMenu.js';
import {useAppState} from './AppState.js';

interface Attachment{key:string;id?:string;index:number;name:string;status:string;url:string;ready:boolean}
interface Model{scope?:string;sending:boolean;enabled:boolean;active:boolean;attachmentsReady:boolean;attachments:Attachment[];workspace:string}
interface Actions extends PastedTextTransport{submit(value:RichPastePayload):Promise<boolean>;stop():Promise<void>|void;addFiles(files:File[]):string[];removeImage(key:string):void;removeAttachment(index:number):void;openModelSettings():void;openFeishuNotify(text?:string):Promise<boolean>;report(message:string):void}

import {ComposerIcon as Icon} from './ComposerIcon.js';
function Composer({model,actions}:{model:Model;actions:Actions}){
  const selectedSkill=useAppState().selectedSkill;
  const [draft,setDraft]=useState('');
  const [uploadingPaste,setUploadingPaste]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [activeCommand,setActiveCommand]=useState(0),[dismissedCommand,setDismissedCommand]=useState('');
  const prompt=useRef<RichPasteEditorHandle>(null),filePicker=useRef<HTMLInputElement>(null);
  const locked=model.sending||model.active;
  useEffect(()=>{document.body.classList.toggle('composer-expanded',expanded);return()=>document.body.classList.remove('composer-expanded')},[expanded]);
  useEffect(()=>{const collapse=()=>setExpanded(false);window.addEventListener('omega:composer-collapse',collapse);return()=>window.removeEventListener('omega:composer-collapse',collapse)},[]);
  useEffect(()=>{if(!expanded)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[expanded]);
  useEffect(()=>{const form=document.getElementById('composer');if(!form)return;const over=(event:DragEvent)=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();setDragging(true)}};const leave=(event:DragEvent)=>{if(!form.contains(event.relatedTarget as Node))setDragging(false)};const drop=(event:DragEvent)=>{event.preventDefault();setDragging(false);ingest(Array.from(event.dataTransfer?.files||[]))};form.addEventListener('dragover',over);form.addEventListener('dragleave',leave);form.addEventListener('drop',drop);return()=>{form.removeEventListener('dragover',over);form.removeEventListener('dragleave',leave);form.removeEventListener('drop',drop)}},[locked]);
  const clearDraft=(recalled:any)=>{if(recalled)prompt.current?.rememberDraft(recalled);prompt.current?.clear();setDraft('');setExpanded(false)};
  const notify=async(text:string)=>{const value=prompt.current?.payload();if(model.attachments.length||value?.pasteIds.length)return actions.report('飞书主动通知第一版仅支持文字，请先移除附件');const recalled=prompt.current?.getDraft();if(await actions.openFeishuNotify(text))clearDraft(recalled)};
  const submit=async()=>{const recalled=prompt.current?.getDraft();const value=prompt.current?.payload()||{text:'',pasteIds:[]};if(locked||uploadingPaste||!model.enabled||!model.attachmentsReady||(!value.text&&!model.attachments.length))return;const command=value.text.match(/^\/飞书通知(?:\s+([\s\S]*))?$/);try{if(command){if(value.pasteIds.length||model.attachments.length){actions.report('飞书主动通知第一版仅支持文字，请先移除附件');return}if(await actions.openFeishuNotify(command[1]||''))clearDraft(recalled);return}if(await actions.submit(value))clearDraft(recalled)}catch(error){actions.report(error instanceof Error?error.message:String(error))}};
  const ingest=(files:File[])=>{if(files.length&&!locked){const imageFiles=files.filter(file=>file.type.startsWith('image/'));if(imageFiles.length)prompt.current?.insertImages(actions.addFiles(imageFiles));prompt.current?.insertFiles(files.filter(file=>!file.type.startsWith('image/')))}};
  const commandQuery=slashQuery(draft),commands=useMemo<SlashCommand[]>(()=>[
    {name:'飞书通知',description:'选择飞书群和成员，发送文字或结论卡片',run:()=>prompt.current?.insertCommand(draft.length,'/飞书通知','飞书通知')},
    {name:'模型设置',description:'打开当前会话的模型与推理强度设置',run:()=>{prompt.current?.clear();actions.openModelSettings()}},
  ],[actions,draft]);
  const shownCommands=commandQuery===null?[]:commands.filter(command=>command.name.toLowerCase().includes(commandQuery));
  useEffect(()=>{setActiveCommand(0);if(commandQuery===null)setDismissedCommand('')},[commandQuery]);
  const chooseCommand=(command:SlashCommand)=>{setDismissedCommand('/'+command.name);command.run();requestAnimationFrame(()=>prompt.current?.focus())};
  return <>
    <div className="editor-heading"><h2>专注编辑</h2><button id="editor-close" type="button" className="secondary" onClick={()=>setExpanded(false)}>收起编辑</button></div>
    <input ref={filePicker} aria-label="选择附件" type="file" accept={'image/png,image/jpeg,image/webp,'+TEXT_FILE_ACCEPT+','+DOCUMENT_ACCEPT} multiple hidden onChange={event=>{ingest(Array.from(event.target.files||[]));event.target.value=''}}/>
    {selectedSkill&&selectedSkill.threadId===model.scope&&<div className="composer-skill-chip">本次使用 Skill：{selectedSkill.name}<button type="button" aria-label="移除选中的 Skill" onClick={()=>window.omegaAppState?.patch({selectedSkill:null})}>×</button></div>}
    {!!shownCommands.length&&dismissedCommand!==draft&&<SlashCommandMenu commands={shownCommands} active={activeCommand} choose={chooseCommand}/>}
    <RichPasteEditor scope={model.scope} ref={prompt} id="prompt" label="消息" placeholder="今天想推进什么？输入 / 查看操作" disabled={locked} transport={actions} report={actions.report} images={model.attachments} onRemoveImage={actions.removeImage} onFiles={ingest} onShortcut={event=>{if(!shownCommands.length||dismissedCommand===draft)return false;if(event.key==='Escape'){event.preventDefault();setDismissedCommand(draft);return true}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActiveCommand(value=>(value+(event.key==='ArrowDown'?1:-1)+shownCommands.length)%shownCommands.length);return true}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chooseCommand(shownCommands[activeCommand%shownCommands.length]);return true}return false}} onEnter={()=>void submit()} onChange={state=>{setDraft(state.text);setUploadingPaste(state.uploading)}}/>
    <div className="compose-footer">
      <button type="button" className="icon-button" aria-label="添加附件" title="添加图片或文件 · 图片最多 20 张，每张 8 MB · 文本/代码 500 KB，PDF/Office 10 MB，与长粘贴合计最多 20 个 · 保留 7 天" disabled={locked||!model.enabled} onMouseDown={event=>{event.preventDefault();prompt.current?.saveSelection()}} onClick={()=>filePicker.current?.click()}><Icon kind="attachment"/></button>
      <button type="button" id="expand-editor" className="icon-button" aria-label="全屏编辑" title="全屏编辑" onClick={()=>{setExpanded(true);requestAnimationFrame(()=>prompt.current?.focus())}}><Icon kind="expand"/></button>
      <button type="button" id="model-settings" className="icon-button" title="模型设置" aria-label="模型设置" disabled={!model.enabled||model.sending} onClick={actions.openModelSettings}><Icon kind="sliders"/></button>
      <button type="button" className="icon-button" title="发送飞书通知" aria-label="发送飞书通知" disabled={!model.enabled||locked} onClick={()=>void notify(draft)}><Icon kind="notify"/></button>
      <span id="workspace">{model.workspace||'连接你的工作空间'}</span>
      <div>{model.active&&<button type="button" id="stop" onClick={()=>void actions.stop()}>停止</button>}<button type="button" id="send" disabled={locked||uploadingPaste||!model.enabled||!model.attachmentsReady||(!draft.trim()&&!model.attachments.length)} onClick={()=>void submit()}><Icon kind="send"/>{uploadingPaste?'保存粘贴…':model.sending?'提交中…':'发送'}</button></div>
    </div>
    {dragging&&<div className="composer-drop">松开即可添加图片或文件</div>}
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
