import {iconButton} from './ui.js';
export const effortLabel=value=>({none:'无',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'超高'})[value]||value||'默认';
export function createModelSettings({api,getThreadId,isSending}){
  const $=id=>document.getElementById(id);
  let saved={model:null,effort:null,revision:0}, models=[], target=null, version=0, busy=false, formRevision=0;
  function render(){
    const name=saved.model||saved.current?.model;
    const label=name?name+' · '+effortLabel(saved.model?saved.effort:saved.current?.effort):'模型设置';
    iconButton($('model-settings'),'sliders');
    $('model-settings').title='下一轮：'+label;
    $('model-settings').setAttribute('aria-label','模型设置，'+label);
    $('model-settings').disabled=!getThreadId()||isSending();
  }
  function apply(value){
    if(!value||value.revision<saved.revision)return;
    if(target&&$('model-dialog').open&&value.revision!==formRevision)$('model-error').textContent='设置已在其他设备修改；请取消并重新打开，避免覆盖。';
    saved=value;render();
  }
  function efforts(value=''){
    const selected=models.find(m=>m.model===$('model-select').value);
    $('effort-select').replaceChildren(new Option(selected?'模型默认'+(selected.defaultReasoningEffort?'（'+effortLabel(selected.defaultReasoningEffort)+'）':''):'跟随当前会话',''));
    for(const option of selected?.supportedReasoningEfforts||[])$('effort-select').add(new Option(effortLabel(option.reasoningEffort)+' · '+option.reasoningEffort,option.reasoningEffort));
    $('effort-select').disabled=busy||!selected;
    $('effort-select').value=[...$('effort-select').options].some(x=>x.value===value)?value:'';
    $('model-description').textContent=selected?.description||'不覆盖 Codex 当前会话配置；这不是重置为服务器全局默认。';
  }
  function lock(value){busy=value;for(const id of ['model-save','model-select','effort-select'])$(id).disabled=value; if(!value)efforts($('effort-select').value);}
  async function refresh(){
    const id=getThreadId();if(!id)return;
    const result=await api('thread-settings',{threadId:id});
    if(id===getThreadId())apply(result.settings);
  }
  $('model-settings').onclick=async()=>{
    target=getThreadId();if(!target||isSending())return;
    const id=target,v=++version;
    $('model-error').textContent='';$('model-status').textContent='正在读取模型与会话设置…';
    $('model-dialog').showModal();lock(true);
    try{
      const [catalog,result]=await Promise.all([api('models',{}),api('thread-settings',{threadId:id})]);
      if(v!==version||id!==getThreadId())return;
      models=catalog.models;formRevision=result.settings.revision;apply(result.settings);formRevision=saved.revision;$('model-error').textContent='';
      $('model-select').replaceChildren(new Option('跟随当前会话配置',''));
      for(const model of models)$('model-select').add(new Option(model.displayName,model.model));
      if(saved.model&&!models.some(m=>m.model===saved.model)){
        $('model-select').add(new Option(saved.model+'（当前不可用）',saved.model));
        $('model-error').textContent='已保存模型不在最新列表中，请重新选择。';
      }
      $('model-select').value=saved.model||'';efforts(saved.effort||'');lock(false);
      $('model-status').textContent=(saved.current?.model?'当前会话配置：'+saved.current.model+' · '+effortLabel(saved.current.effort)+'。':'')+'仅影响下一轮。按会话保存并同步到其他设备，不修改正在执行的回复。';
    }catch(e){if(v===version){$('model-status').textContent='读取失败，请取消后重试';$('model-error').textContent=e.message;}}
  };
  $('model-select').onchange=()=>efforts();
  $('model-cancel').onclick=()=>{if(!$('model-cancel').disabled)$('model-dialog').close();};
  $('model-dialog').addEventListener('cancel',e=>{if($('model-cancel').disabled)e.preventDefault();});
  $('model-dialog').addEventListener('close',()=>{version++;target=null;});
  $('model-form').onsubmit=async e=>{
    e.preventDefault();if(busy||!target)return;
    const id=target,v=version;lock(true);$('model-cancel').disabled=true;$('model-error').textContent='';
    try{
      const result=await api('thread-settings',{threadId:id,expectedRevision:formRevision,settings:{model:$('model-select').value||null,effort:$('effort-select').value||null}});
      if(v!==version||id!==getThreadId())return;
      formRevision=result.settings.revision;apply(result.settings);$('model-dialog').close();
    }catch(e){if(v===version)$('model-error').textContent=e.message;}
    finally{$('model-cancel').disabled=false;if(v===version)lock(false);}
  };
  render();
  return {apply,refresh,controls:render,get revision(){return saved.revision;},
    reset(){version++;target=null;saved={model:null,effort:null,revision:0};if($('model-dialog').open)$('model-dialog').close();render();}};
}
