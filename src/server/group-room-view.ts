type Row=Record<string,any>;
export function groupRoomView(group:Row){
  const priority:Record<string,number>={awaiting_input:0,running:1,unknown:2,failed:3,queued:4};
  const project=(req:Row)=>{const tasks:Row[]=req.tasks||[],live=tasks.filter(t=>!['completed','cancelled'].includes(t.status)).sort((a,b)=>(priority[a.status]??5)-(priority[b.status]??5)),recent=tasks.filter(t=>['completed','cancelled'].includes(t.status)).slice(-80),selected=[...live.slice(0,120),...recent];
    const{delivery,plan,...rest}=req;
    return{...rest,plan:plan?{summary:plan.summary}:null,taskCount:tasks.length,tasksTruncated:tasks.length>selected.length,tasks:selected.map(({result,objective,acceptance,dispatchId,...task})=>task)};
  };
  const requirements=(group.requirements||[]).map(project);
  return{...group,requirements,requirement:group.requirement?project(group.requirement):null};
}
