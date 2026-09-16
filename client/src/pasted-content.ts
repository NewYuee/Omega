export interface PastedTextRef{name?:string;id:string;chars:number;bytes:number;createdAt:number;expiresAt:number}
export interface PastedTextTransport{uploadDocument?(file:File):Promise<PastedTextRef>;upload(text:string):Promise<PastedTextRef>;read(id:string):Promise<string>}

export function createPastedTextTransport(fetcher:(route:string,options?:RequestInit)=>Promise<Response>):PastedTextTransport{
  return{
    async uploadDocument(file:File){const response=await fetcher('documents?name='+encodeURIComponent(file.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'文档解析失败');return result;},
    async upload(text:string){const response=await fetcher('pasted-text',{method:'POST',headers:{'content-type':'text/plain; charset=utf-8'},body:text});const result=await response.json();if(!response.ok)throw new Error(result.error||'粘贴文本保存失败');return result;},
    async read(id:string){const response=await fetcher('pasted-text/'+encodeURIComponent(id));if(!response.ok){let message='粘贴文本读取失败';try{message=(await response.json()).error||message}catch{}throw new Error(message);}return response.text();}
  };
}
