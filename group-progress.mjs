// Batch public member messages; never forward private reasoning or tool output.
export function groupProgress(store,notify){
  const pending=new Map(),texts=new Map();let timer=null;
  function flush(threadId=null){
    const changed=new Set();
    for(const [key,item] of pending){if(threadId&&item.threadId!==threadId)continue;pending.delete(key);const groupId=store.taskProgress(item.threadId,item.turnId,item.itemId,item.text);if(groupId)changed.add(groupId);}
    for(const groupId of changed)notify({method:'omega/group-updated',params:{groupId}});
  }
  return event=>{
    const p=event.params||{};
    if(event.method==='turn/completed'){flush(p.threadId);for(const key of texts.keys())if(key.startsWith(`${p.threadId}:`))texts.delete(key);return;}
    const delta=event.method==='item/agentMessage/delta',complete=event.method==='item/completed'&&p.item?.type==='agentMessage';
    if(!delta&&!complete)return;
    if(store.threadBinding(p.threadId)?.type!=='member')return;
    const itemId=p.itemId||p.item?.id,key=`${p.threadId}:${p.turnId}:${itemId}`;
    if(complete){pending.set(key,{threadId:p.threadId,turnId:p.turnId,itemId,text:p.item.text||''});flush(p.threadId);texts.delete(key);return;}
    // Keep a bounded tail; a complete item replaces it with the final public text.
    const text=((texts.get(key)||'')+(p.delta||'')).slice(-12000);texts.set(key,text);pending.set(key,{threadId:p.threadId,turnId:p.turnId,itemId,text});
    if(!timer){timer=setTimeout(()=>{timer=null;flush();},700);timer.unref();}
  };
}
