type Effort=string|null;
interface ModelChoice{model:string|null;effort:Effort}
interface Settings extends ModelChoice{revision:number;current?:ModelChoice}
interface ModelOption{supportedReasoningEfforts?:Array<{reasoningEffort:string}>}
interface ModelSettingsOptions{api(route:string,data?:unknown):Promise<any>;getThreadId():string|null;isSending():boolean}

export const effortLabel=(value:Effort|undefined)=>({none:'无',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'超高'} as Record<string,string>)[value||'']||value||'默认';
const openDialog=(name:string,props:Record<string,unknown>)=>window.omegaDialogs?window.omegaDialogs.open(name,props):new Promise(resolve=>window.addEventListener('omega:dialogs-ready',()=>window.omegaDialogs!.open(name,props).then(resolve),{once:true}));

export function createModelSettings({api,getThreadId,isSending}:ModelSettingsOptions){
  let saved:Settings={model:null,effort:null,revision:0},version=0;
  function render(){
    const button=document.getElementById('model-settings') as HTMLButtonElement|null;if(!button)return;
    const name=saved.model||saved.current?.model,label=name?name+' · '+effortLabel(saved.model?saved.effort:saved.current?.effort):'模型设置';
    button.title='下一轮：'+label;button.setAttribute('aria-label','模型设置，'+label);button.disabled=!getThreadId()||isSending();
  }
  function apply(value:Settings|undefined){if(!value||value.revision<saved.revision)return;saved=value;render()}
  async function refresh(){const id=getThreadId();if(!id)return;const result=await api('thread-settings',{threadId:id});if(id===getThreadId())apply(result.settings)}
  const open=async()=>{
    const id=getThreadId();if(!id||isSending())return;const currentVersion=++version;
    try{
      const[catalog,result]=await Promise.all([api('models',{}),api('thread-settings',{threadId:id})]);
      if(currentVersion!==version||id!==getThreadId())return;apply(result.settings);
      const expectedRevision=saved.revision,models:ModelOption[]=catalog.models||[];
      const efforts=[...new Set(models.flatMap(model=>(model.supportedReasoningEfforts||[]).map(option=>option.reasoningEffort)))];
      await openDialog('modelSettings',{description:(saved.current?.model?`当前会话：${saved.current.model} · ${effortLabel(saved.current.effort)}。`:'')+'仅影响下一轮，并同步到其他设备。',model:saved.model,effort:saved.effort,models,efforts:efforts.map(value=>({value,label:`${effortLabel(value)} · ${value}`})),onSubmit:async(values:any)=>{const response=await api('thread-settings',{threadId:id,expectedRevision,settings:{model:values.model||null,effort:values.effort||null}});if(id===getThreadId())apply(response.settings)}});
    }catch(error){console.error(error)}
  };
  const initialButton=document.getElementById('model-settings');if(initialButton)initialButton.onclick=()=>void open();
  render();return{apply,refresh,open,controls:render,get revision(){return saved.revision},reset(){version++;saved={model:null,effort:null,revision:0};render()}};
}
