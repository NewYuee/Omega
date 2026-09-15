interface RoomOptions{loadImage(ref:{id:string;expiresAt:number},thumb:boolean,signal:AbortSignal):Promise<Blob>;api(route:string,data?:unknown):Promise<any>;act?:(input:Record<string,unknown>,label:string)=>Promise<unknown>;openThread(id:string):void;error(message:string):void;onReply(target:any):void;onDecision(target:any):void;onBudget?(target:any):void;onCancel(target:any):Promise<void>;onSelect(id:string):void}
export function createGroupRoom({loadImage,api,act,openThread,error,onReply,onDecision,onBudget,onCancel,onSelect}:RoomOptions){
  let group:any=null,cleared=false;
  const actions={loadImage,loadWindow:async(query:string)=>{if(!group)return[];const result=await api(`groups/${encodeURIComponent(group.id)}?${query}`);return result.messages||[]},select:onSelect,openThread,reply:onReply,decide:onDecision,cancel:onCancel,report:error};
  function render(value:any){group=value;cleared=false;const requirements:any[]=group.requirements||[],messages=(group.messages||[]).slice(-120).filter((message:any)=>!['delivery-report','plan-confirmation'].includes(message.reference?.type));window.omegaReactGroup?.render({group,messages,requirements,active:requirements.filter((requirement:any)=>['plan_drafting','running','finalizing'].includes(requirement.status))},actions);window.omegaReactGroupPanels?.renderQuestions({requirements,messages},{focus,budget:onBudget,decide:onDecision,retry:(requirementId:string)=>act?.({action:'retry',requirementId},'核对或恢复任务'),reassign:(taskId:string,memberId:string)=>act?.({action:'reassign',taskId,memberId},'改派任务')})}
  async function focus(id:string){onSelect(id);return window.omegaReactGroup?.focus(id)??false}
  function clear(){group=null;cleared=true;window.omegaReactGroup?.clear();window.omegaReactGroupPanels?.renderQuestions({requirements:[],messages:[]},{focus,budget:onBudget,decide:onDecision,retry:(requirementId:string)=>act?.({action:'retry',requirementId},'核对或恢复任务'),reassign:(taskId:string,memberId:string)=>act?.({action:'reassign',taskId,memberId},'改派任务')})}
  function returnToLatest(){window.omegaReactGroup?.returnToLatest()}
  window.addEventListener('omega:react-group-ready',()=>{if(group)render(group);else if(cleared)clear()});
  window.addEventListener('omega:react-group-panels-ready',()=>{if(group)render(group);else if(cleared)clear()});
  return{render,focus,clear,returnToLatest};
}
