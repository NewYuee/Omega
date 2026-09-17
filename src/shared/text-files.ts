export const TEXT_FILE_LIMIT=500*1024;
export const DOCUMENT_ACCEPT='.pdf,.docx,.xlsx,.pptx';
export const isDocument=(file:Pick<File,'name'>)=>DOCUMENT_ACCEPT.split(',').includes('.'+file.name.split('.').at(-1)?.toLowerCase());
export const TEXT_FILE_ACCEPT='.txt,.md,.markdown,.json,.jsonl,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rs,.go,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.rb,.sh,.bash,.zsh,.sql,.html,.css,.scss,.xml,.yaml,.yml,.toml,.ini,.conf,.log,.vue,.svelte';
const extensions=new Set(TEXT_FILE_ACCEPT.split(','));
export function validateTextFile(file:Pick<File,'name'|'size'>){
  const ext='.'+file.name.split('.').at(-1)?.toLowerCase();
  if(!extensions.has(ext))throw Error('不支持此文件类型；支持文本、代码、PDF、DOCX、XLSX、PPTX，旧版 Office 请另存，压缩包暂不支持');
  if(!file.size||file.size>TEXT_FILE_LIMIT)throw Error('文本文件不能为空，且每个不得超过 500 KB');
}
export function validateAttachmentFile(file:Pick<File,'name'|'size'>){
  if(!isDocument(file))return validateTextFile(file);
  if(!file.size||file.size>10*1024*1024)throw Error('文档不能为空，且每个不得超过 10 MB');
}
export function decodeTextFile(name:string,data:Uint8Array){
  const file={name,size:data.byteLength};validateTextFile(file);
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw Error('文件必须是 UTF-8 文本，请转换编码后重试');}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('检测到二进制内容，无法作为文本文件发送');
  if(!text.trim())throw Error('文件内容不能为空');
  const safeName=file.name.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,200);
  return `附件文件名：${safeName}\n\n${text}`;
}
export async function readTextFile(file:File){validateTextFile(file);return decodeTextFile(file.name,new Uint8Array(await file.arrayBuffer()));}
