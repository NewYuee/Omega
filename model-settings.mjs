import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export class ModelSettings {
  constructor(directory,request){this.directory=directory;this.request=request;this.queue=Promise.resolve();this.catalog=null;this.inflight=null;}
  async initialize(){await mkdir(this.directory,{recursive:true,mode:0o700});}
  file(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw fail('无效的会话 ID');return path.join(this.directory,id+'.json');}
  async read(id){
    try{return JSON.parse(await readFile(this.file(id),'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;return {model:null,effort:null,revision:0};}
  }
  async models(force=false){
    if(!force&&this.catalog&&Date.now()-this.catalog.time<60000)return this.catalog.models;
    if(this.inflight)return this.inflight;
    this.inflight=(async()=>{
      const models=[],cursors=new Set();let cursor;
      do{
        const page=await this.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});
        if(!Array.isArray(page.data))throw fail('模型列表暂不可用，请稍后重试',503);
        for(const m of page.data){
          if(m.hidden||typeof m.model!=='string'||models.some(x=>x.model===m.model))continue;
          models.push({model:m.model,displayName:m.displayName||m.model,description:m.description||'',
            supportedReasoningEfforts:(m.supportedReasoningEfforts||[]).filter(x=>typeof x.reasoningEffort==='string'),
            defaultReasoningEffort:m.defaultReasoningEffort||null,inputModalities:m.inputModalities||['text','image']});
        }
        cursor=page.nextCursor;
        if(cursor&&cursors.has(cursor))throw fail('模型列表分页异常',503);
        cursors.add(cursor);if(cursors.size>20)throw fail('模型列表过大',503);
      }while(cursor);
      this.catalog={time:Date.now(),models};return models;
    })();
    try{return await this.inflight;}finally{this.inflight=null;}
  }
  async resolve(settings,hasImages=false){
    if(settings.model===null){if(settings.effort!==null)throw fail('请先选择模型，再设置推理等级');return {};}
    const model=(await this.models()).find(m=>m.model===settings.model);
    if(!model)throw fail('此模型已不在可用列表中，请重新选择');
    const effort=settings.effort??model.defaultReasoningEffort;
    if(effort!==null&&!model.supportedReasoningEfforts.some(x=>x.reasoningEffort===effort))throw fail('该模型不支持所选推理等级，请重新选择');
    if(hasImages&&!model.inputModalities.includes('image'))throw fail('所选模型不支持图片，请切换模型或移除图片');
    return {model:model.model,...(effort!==null?{effort}:{})};
  }
  save(id,settings,expectedRevision,check=()=>{}){
    const operation=this.queue.then(async()=>{
      this.file(id);
      if(!settings||!(settings.model===null||typeof settings.model==='string')||!(settings.effort===null||typeof settings.effort==='string'))throw fail('无效的模型设置');
      const current=await this.read(id);
      if(!Number.isSafeInteger(expectedRevision)||current.revision!==expectedRevision)throw fail('设置已在其他设备修改，请重新打开后再保存',409);
      await this.resolve(settings);await check();
      const next={model:settings.model,effort:settings.effort,revision:current.revision+1};
      await writeFile(this.file(id)+'.tmp',JSON.stringify(next),{mode:0o600});
      await rename(this.file(id)+'.tmp',this.file(id));return next;
    });
    this.queue=operation.catch(()=>{});return operation;
  }
}
