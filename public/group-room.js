export function createGroupRoom({api,openThread,error,onReply,onSelect}){
  let group=null,cleared=false;
  const actions={loadWindow:async query=>{if(!group)return[];const result=await api(`groups/${encodeURIComponent(group.id)}?${query}`);return result.messages||[]},select:onSelect,openThread,reply:onReply,report:error};
  function render(value){group=value;cleared=false;const requirements=group.requirements||[],messages=(group.messages||[]).slice(-120).filter(message=>!['delivery-report','plan-confirmation'].includes(message.reference?.type));globalThis.omegaReactGroup?.render({group,messages,requirements,active:requirements.filter(requirement=>['plan_drafting','running','finalizing'].includes(requirement.status))},actions);globalThis.omegaReactGroupPanels?.renderQuestions({requirements,messages},{focus});document.getElementById('task-progress').textContent=''}
  async function focus(id){onSelect(id);return globalThis.omegaReactGroup?.focus(id)??false}
  function clear(){group=null;cleared=true;globalThis.omegaReactGroup?.clear();globalThis.omegaReactGroupPanels?.renderQuestions({requirements:[],messages:[]},{focus})}
  function returnToLatest(){globalThis.omegaReactGroup?.returnToLatest()}
  window.addEventListener('omega:react-group-ready',()=>{if(group)render(group);else if(cleared)clear()});
  window.addEventListener('omega:react-group-panels-ready',()=>{if(group)render(group);else if(cleared)clear()});
  return{render,focus,clear,returnToLatest};
}
