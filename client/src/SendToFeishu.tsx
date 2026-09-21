import {useState} from 'react';

export function SendToFeishu({read,title,source}:{read:()=>string|Promise<string>;title?:string;source?:string}){
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="reference-link message-feishu-share" type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const text=await read(),dialog=window.omegaFeishuNotify;if(!dialog)throw Error('飞书通知界面尚未就绪');await dialog.open(text,{format:'card',title:title||'Omega 消息通知',source});}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}}>{busy?'正在准备…':'发送到飞书'}</button>{error&&<small role="alert">{error}</small>}</>;
}
