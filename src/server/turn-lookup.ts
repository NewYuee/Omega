interface Rpc{request(method:string,params:Record<string,unknown>):Promise<any>}
/** Keep only one page in memory. A broken cursor must not look like a missing turn. */
export async function findTurn(rpc:Rpc,threadId:string,turnId:string){
  const seen=new Set<string>();let cursor:string|null=null;
  for(let page=0;page<1000;page++){
    const result=await rpc.request('thread/turns/list',{threadId,cursor,limit:60,sortDirection:'desc',itemsView:'full'});
    const turn=result.data?.find((item:any)=>item.id===turnId);if(turn)return turn;
    const next=result.nextCursor;if(!next)return null;
    if(typeof next!=='string'||seen.has(next))throw new Error('执行轮次分页游标异常，请稍后重新核对');
    seen.add(next);cursor=next;
  }
  throw new Error('执行轮次查询超过安全分页上限，请继续人工核对，不能视为不存在');
}
