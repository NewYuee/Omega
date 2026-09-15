import {apiFetch} from './platform.js';

interface ImageRef{id:string;expiresAt:number}
interface UploadedImage{id:string;expiresAt?:number}
interface UploadRecord{key:string;name:string;status:string;controller:AbortController;file:File|null;image?:UploadedImage|null;url?:string}
interface AttachmentOptions{getKey():string;isLocked():boolean;onChange():void;onError(message:string):void}

// Upload state and authenticated image transport. React owns all image rendering.
export function createAttachments({getKey,isLocked,onChange,onError}:AttachmentOptions) {
  const records:UploadRecord[]=[];
  let queue=Promise.resolve(),sequence=0;
  async function imageBlob(id:string,thumb:boolean,signal:AbortSignal) {
    const response=await apiFetch('/api/images/'+encodeURIComponent(id)+(thumb?'?size=thumb':''),{headers:{authorization:'Bearer '+getKey()},signal});
    if(!response.ok){
      if(response.status===410||response.status===404)throw Error('图片已过期或被清理（保留 7 天）');
      throw Error('图片加载失败，请检查连接后重试');
    }
    return response.blob();
  }
  function removeRecord(record:UploadRecord){record.controller.abort();if(record.url)URL.revokeObjectURL(record.url);const index=records.indexOf(record);if(index>=0)records.splice(index,1);}
  const refresh=()=>onChange();
  function ingest(files:Iterable<File>){
    if(isLocked())return [];const added:string[]=[];
    for(const file of files){
      if(records.length>=4){onError('每条消息最多 4 张图片');break;}
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)){onError('仅支持 PNG、JPEG、WebP 图片；请先将其他格式转换后上传');continue;}
      if(!file.size||file.size>8*1024*1024){onError('每张图片不得超过 8 MB');continue;}
      const record:UploadRecord={key:`image-${++sequence}`,name:file.name||'粘贴的图片',status:'等待上传…',controller:new AbortController(),file};records.push(record);added.push(record.key);
      queue=queue.then(async()=>{
        if(record.controller.signal.aborted){record.file=null;return;}
        try{
          record.status='上传中…';refresh();
          const file=record.file;if(!file)return;
          const response=await apiFetch('/api/images',{method:'POST',headers:{authorization:'Bearer '+getKey(),'content-type':file.type},body:file,signal:record.controller.signal});
          const result=await response.json() as UploadedImage&{error?:string};if(!response.ok)throw Error(result.error||'上传失败');record.image=result;
          const blob=await imageBlob(result.id,true,record.controller.signal);if(record.controller.signal.aborted)return;
          record.url=URL.createObjectURL(blob);record.status='已就绪';
        }catch(error){if(!record.controller.signal.aborted){record.image=null;record.status='上传失败，请移除后重试';onError(error instanceof Error?error.message:String(error));}}
        finally{record.file=null;refresh();}
      });
    }
    refresh();return added;
  }
  return{
    get ready(){return records.every(record=>record.image&&record.url);},
    get ids(){return records.flatMap(record=>record.image?[record.image.id]:[]);},
    get records(){return records.map((record,index)=>({index,key:record.key,id:record.image?.id,name:record.name,status:record.status,url:record.url||'',ready:!!record.image&&!!record.url}));},
    ingest,
    removeKey(key:string){const record=records.find(item=>item.key===key);if(!record||isLocked())return;removeRecord(record);refresh();},
    loadImage:(ref:ImageRef,thumb:boolean,signal:AbortSignal)=>imageBlob(ref.id,thumb,signal),
    remove(index:number){const record=records[index];if(!record||isLocked())return;removeRecord(record);refresh();},
    refresh,
    clear(){for(const record of [...records])removeRecord(record);refresh();},
  };
}
