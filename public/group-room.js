import {markdownBody} from './markdown.js';
import {avatarNode} from './avatars.js';
const node=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;n.className=cls;return n;};
const button=(label,run)=>{const n=node('button',label,'reference-link');n.type='button';n.onclick=run;return n;};
const names={plan_drafting:'未回复',awaiting_confirmation:'未回复',running:'回复中',finalizing:'回复中',awaiting_acceptance:'已回复',accepted:'已回复',cancelled:'已取消',paused:'需处理',queued:'未回复',completed:'已回复',failed:'需处理',unknown:'需核对',reviewing:'回复中'};
const elapsedLabel=milliseconds=>{const seconds=Math.max(0,Math.floor(milliseconds/1000));if(seconds<60)return`${seconds} 秒`;const minutes=Math.floor(seconds/60);if(minutes<60)return`${minutes} 分 ${seconds%60} 秒`;return`${Math.floor(minutes/60)} 小时 ${minutes%60} 分`;};

export function createGroupRoom({api,act,openThread,error,onReply,onSelect}){
  const timeline=document.getElementById('group-timeline'),tasks=document.getElementById('group-tasks');
  let currentId=null,group=null,loading=false,atBottom=true,more=true,older=[],historical=false,requestVersion=0,questionSignature='';
  const refreshDurations=()=>{for(const time of tasks.querySelectorAll('[data-start]')){const start=Date.parse(time.dataset.start),end=time.dataset.end?Date.parse(time.dataset.end):Date.now();time.textContent=Number.isFinite(start)?elapsedLabel(end-start):'—';}};
  setInterval(()=>{if(!document.hidden)refreshDurations();},1000);
  const latest=button('↓ 回到最新',()=>{requestVersion++;older=[];historical=false;more=true;atBottom=true;render(group);timeline.scrollTop=timeline.scrollHeight;latest.hidden=true;});latest.className='room-latest';latest.hidden=true;timeline.after(latest);
  timeline.addEventListener('scroll',()=>{atBottom=!historical&&timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<70;if(atBottom)latest.hidden=true;});
  async function loadWindow(query){const version=++requestVersion,id=currentId;const result=await api(`groups/${encodeURIComponent(id)}?${query}`);if(version!==requestVersion||id!==currentId)return false;if(!result.messages.length){error('没有更多消息');return false;}older=result.messages;historical=true;more=true;atBottom=false;render(group);return true;}
  const newer=button('加载后续消息',async()=>{if(loading)return;loading=true;try{if(await loadWindow(`after=${encodeURIComponent(older.at(-1)?.id||'')}`))timeline.scrollTop=0;}catch(e){error(e.message);}finally{loading=false;}});newer.className='room-history';
  const history=button('加载更早消息',async()=>{
    if(loading)return;loading=true;const first=timeline.querySelector('[data-message-id]')?.dataset.messageId,oldHeight=timeline.scrollHeight,top=timeline.scrollTop;
    try{if(await loadWindow(`before=${encodeURIComponent(first||'')}`)){more=older.length===120;render(group);timeline.scrollTop=timeline.scrollHeight;}}catch(e){error(e.message);}finally{loading=false;}
  });history.className='room-history';
  async function focus(id){let target=[...timeline.querySelectorAll('[data-message-id]')].find(n=>n.dataset.requirementId===id);try{if(!target){if(!await loadWindow(`question=${encodeURIComponent(id)}`))return;target=[...timeline.querySelectorAll('[data-message-id]')].find(n=>n.dataset.requirementId===id);}if(target){target.scrollIntoView({block:'center'});target.classList.add('room-highlight');setTimeout(()=>target.classList.remove('room-highlight'),1500);}else error('未找到该问题的消息');onSelect(id);}catch(e){error(e.message);}}
  function render(value){
    group=value;if(currentId!==group.id){requestVersion++;currentId=group.id;older=[];historical=false;more=true;atBottom=true;timeline.replaceChildren();latest.hidden=true;}
    const bottom=atBottom,top=timeline.scrollTop,requirements=group.requirements||[],byReq=new Map(requirements.map(r=>[r.id,r]));
    const allTasks=requirements.flatMap(r=>r.tasks||[]),byTask=new Map(allTasks.map(t=>[t.id,t]));
    const messages=(historical?older:group.messages).slice(-120).filter(m=>!['delivery-report','plan-confirmation'].includes(m.reference?.type));
    const existing=new Map([...timeline.querySelectorAll('[data-message-id]')].map(n=>[n.dataset.messageId,n]));let changed=false;
    if(more&&(older.length||group.messages.length===120)){timeline.prepend(history);}else history.remove();
    const wanted=new Set(messages.map(m=>m.id));for(const [id,n] of existing)if(!wanted.has(id)){n.remove();changed=true;}
    for(const m of messages){
      const task=byTask.get(m.reference?.taskId),req=byReq.get(m.requirementId),messageMember=m.kind==='member'?group.members.find(member=>member.id===(m.reference?.memberId||task?.memberId))||group.members.find(member=>member.name===m.author):null,signature=JSON.stringify([m.author,m.content,m.createdAt,m.reference,task?.status,messageMember?.avatar]);let item=existing.get(m.id);
      if(item?.dataset.signature===signature)continue;
      const replacement=node('article','','group-message '+m.kind);replacement.dataset.messageId=m.id;replacement.dataset.requirementId=m.requirementId||'';replacement.dataset.signature=signature;
      replacement.dataset.avatar=Array.from(m.author||'成员')[0]?.toUpperCase()||'成';
      if(m.kind==='member'||m.kind==='coordinator')replacement.append(avatarNode(m.kind==='coordinator'?'preset:coordinator':messageMember?.avatar,m.author,'chat-avatar'));
      const meta=node('div');meta.append(node('strong',m.author),node('time',new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));replacement.append(meta);
      if(m.kind!=='user'&&req)replacement.append(button(`回复：${req.content.slice(0,60)}`,()=>focus(req.id)));
      if(m.reference?.type==='progress')replacement.append(node('small',task?.status==='running'?'正在处理…':'处理进度','room-progress'));
      const rich=['member','coordinator'].includes(m.kind),content=node('div');let offset=0;const appendPart=()=>{const part=m.content.slice(offset,offset+6000);offset+=6000;content.append(rich?markdownBody(part):node('div',part,'group-message-text'));};appendPart();replacement.append(content);if(m.content.length>6000){const expand=button('展开后续内容',()=>{appendPart();if(offset>=m.content.length)expand.remove();});replacement.append(expand);}
      if(m.reference?.threadId)replacement.append(button('打开会话 ↗',()=>openThread(m.reference.threadId)));
      if(m.kind==='member'&&m.reference?.taskId)replacement.append(button('回复 / 追问',()=>onReply({taskId:m.reference.taskId,name:m.author})));
      if(item)item.replaceWith(replacement);else timeline.append(replacement);existing.set(m.id,replacement);changed=true;
    }
    let previous=history.parentNode===timeline?history:null;
    for(const message of messages){const item=existing.get(message.id);const next=previous?previous.nextSibling:timeline.firstChild;if(item!==next)timeline.insertBefore(item,next);previous=item;}
    if(historical){timeline.append(newer);latest.hidden=false;}else newer.remove();
    timeline.querySelectorAll('.room-active').forEach(n=>n.remove());
    for(const req of requirements.filter(r=>['plan_drafting','running','finalizing'].includes(r.status))){
      const row=node('div','','room-active');row.dataset.requirementId=req.id;
      const status=req.status==='plan_drafting'?'正在分配':(req.tasks||[]).filter(t=>['running','queued'].includes(t.status)).map(t=>`${group.members.find(m=>m.id===t.memberId)?.name||'成员'} · ${names[t.status]}`).join('，')||'正在收尾';
      row.append(node('span',`${req.content.slice(0,42)} — ${status}`));timeline.append(row);
    }
    if(bottom){timeline.scrollTop=timeline.scrollHeight;latest.hidden=true;}else{timeline.scrollTop=top;if(changed)latest.hidden=false;}
    const nextQuestionSignature=JSON.stringify([group.id,requirements,messages.map(m=>[m.requirementId,m.author,m.kind])]);
    if(nextQuestionSignature===questionSignature){refreshDurations();return;}questionSignature=nextQuestionSignature;
    tasks.replaceChildren();document.getElementById('task-progress').textContent='';
    for(const [index,req] of requirements.entries()){
      const card=node('article','','task-card question-card');card.dataset.status=req.status;
      const link=button(req.content.slice(0,120),()=>focus(req.id));link.className='question-link';link.prepend(node('span',String(requirements.length-index),'question-number'));card.append(link);
      const meta=node('div','','question-meta'),state=node('span',names[req.status]||'未回复','question-state'),duration=node('time','','question-duration');duration.dataset.start=req.createdAt||'';if(['completed','accepted','awaiting_acceptance','cancelled'].includes(req.status))duration.dataset.end=req.updatedAt||'';
      meta.append(state,node('span','·'),duration);card.append(meta);
      const responders=[...new Set(messages.filter(message=>message.requirementId===req.id&&['member','coordinator'].includes(message.kind)).map(message=>message.author))];if(responders.length)card.append(node('small',responders.join('、'),'question-responders'));
      tasks.append(card);
    }
    refreshDurations();
  }
  return {render};
}
