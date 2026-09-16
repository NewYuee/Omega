// App Server history may merge text parts and move all images to the end.
// Restore only a matching, successfully recorded user submission; never guess positions.
export function submissionLayout(item:any,threadId:string,turnId:string,ledger:Record<string,any>):string|undefined{
  if(item.type!=='userMessage')return;
  const normalize=(text:string)=>text.replace(/\[OmegaImage:[a-zA-Z0-9-]+\]/g,'').replace(/\s/g,'');
  const actual=(item.content||[]).map((part:any)=>part.text||'').join('').split('\n\n<omega_pasted_files>')[0];
  for(const entry of Object.values(ledger)){
    if(entry.threadId!==threadId||!entry.result?.turn?.id||entry.result.turn.id!==turnId)continue;
    try{
      const saved=JSON.parse(entry.fingerprint),input=saved.input||(entry.managed&&typeof saved.text==='string'?[{type:'text',text:saved.text}]:undefined);
      if(!Array.isArray(input)||input.some(part=>part.type!=='text'||typeof part.text!=='string'))continue;
      const text=input.map(part=>part.text).join('\n');
      if(normalize(text)===normalize(actual))return text;
    }catch{/* Old/incomplete ledger entries have no recoverable layout. */}
  }
}
