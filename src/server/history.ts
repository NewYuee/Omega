import {inlineImageContent,imageSafeSlice} from '../shared/inline-images.ts';
export const PAGE_SIZE=12000;
export const TURN_PAGE_SIZE=60;
export const ITEM_PAGE_SIZE=200;
export const COMPAT_TURN_PAGE_SIZE=10;
interface ContentPart{text?:string}
export interface HistoryItem{id?:string;type?:string;status?:string;text?:string;command?:string;aggregatedOutput?:string;content?:ContentPart[]}
interface Turn{id:string;status?:string;items?:HistoryItem[];itemsView?:string;startedAt?:number|null;completedAt?:number|null;durationMs?:number|null}
interface Thread{id:string;name?:string;preview?:string;cwd?:string;turns?:Turn[]}
interface PageInput{turnId?:string;itemId?:string;offset?:number;cursor?:string;selectionOnly?:boolean;outlineOnly?:boolean}
interface Attachment{id:string;expiresAt:number}
interface RpcClient{request(method:string,params:Record<string,unknown>):Promise<any>}
const itemPagination=new WeakMap<RpcClient,Map<string,boolean>>();
const itemCapability=(rpc:RpcClient,threadId:string)=>itemPagination.get(rpc)?.get(threadId);
const rememberItemCapability=(rpc:RpcClient,threadId:string,value:boolean)=>{let values=itemPagination.get(rpc);if(!values){values=new Map();itemPagination.set(rpc,values)}values.set(threadId,value)};
const unsupportedItems=(error:unknown)=>/thread\/items\/list.*(?:not supported|unsupported)|(?:not supported|unsupported method|method not found|not implemented).*thread\/items\/list/i.test(error instanceof Error?error.message:String(error));
export function textOf(item:HistoryItem){if(item.type==='userMessage')return(item.content||[]).map(value=>value.text||'[附件]').join(item.content?.some(value=>value.text?.includes('[OmegaImage:'))?'':'\n');if(item.type==='agentMessage')return item.text||'';if(item.type==='commandExecution')return'$ '+(item.command||'')+'\n'+(item.aggregatedOutput||'');return JSON.stringify(item,null,2);}
export function historyPage(thread:Thread,input:PageInput={},attachments:(item:HistoryItem,turn:Turn)=>Attachment[]=()=>[]){const turns=thread.turns||[],index=input.turnId?turns.findIndex(turn=>turn.id===input.turnId):turns.length-1,turn=turns[index],offset=Math.max(0,Math.floor(Number(input.offset)||0));const mapped=(turn?.items||[]).map(item=>{const refs=item.type==='userMessage'?attachments(item,turn):[],ordered=item.type==='userMessage'?{...item,content:inlineImageContent(item.content||[],refs.map(ref=>ref.id))}:item,chat=['userMessage','agentMessage'].includes(item.type||''),full=textOf(ordered),start=input.itemId===item.id?offset:0;return{id:item.id,type:item.type,status:item.status,inlineImages:item.type==='userMessage'&&full.includes('[OmegaImage:'),images:item.type==='userMessage'?attachments(item,turn):[],pageText:chat||input.itemId===item.id?imageSafeSlice(full,start,PAGE_SIZE):'',totalLength:full.length,offset:start,deferred:!chat&&input.itemId!==item.id};});return{thread:{id:thread.id,name:thread.name,preview:thread.preview?.slice(0,100),cwd:thread.cwd},outline:turns.map((entry,index)=>({id:entry.id,label:textOf((entry.items||[]).find(item=>item.type==='userMessage')||{}).slice(0,70)||'会话记录',index})),turn:turn?{id:turn.id,status:turn.status,startedAt:turn.startedAt,completedAt:turn.completedAt,durationMs:turn.durationMs,items:input.itemId?mapped.filter(item=>item.id===input.itemId):mapped}:null};}

/** Read a bounded history window using the App Server pagination APIs. */
export async function paginatedHistoryPage(
  rpc:RpcClient,
  thread:Thread,
  input:PageInput={},
  attachments:(item:HistoryItem,turn:Turn)=>Attachment[]=()=>[],
){
  if(input.selectionOnly&&input.turnId){
    const detail=await readTurnDetail(rpc,thread.id,input.turnId,undefined,input.cursor);
    const page:any=historyPage({...thread,turns:[detail.turn]},input,attachments);
    page.outline=null;
    page.itemsTruncated=detail.truncated;
    return page;
  }
  const compatibility=itemCapability(rpc,thread.id)===false;
  const listed=await rpc.request('thread/turns/list',{threadId:thread.id,cursor:input.cursor||null,limit:compatibility?COMPAT_TURN_PAGE_SIZE:TURN_PAGE_SIZE,sortDirection:'desc',itemsView:'summary'});
  const turns:Turn[]=[...(listed.data||[])].reverse();
  if(input.outlineOnly){
    const page:any=historyPage({...thread,turns},input,attachments);
    page.turn=null;
    page.nextCursor=listed.nextCursor||null;
    return page;
  }
  const selectedId=input.turnId||turns.at(-1)?.id;
  if(selectedId){
    const summary=turns.find(turn=>turn.id===selectedId);
    const detail=await readTurnDetail(rpc,thread.id,selectedId,summary,input.cursor);
    if(detail.compatibility){
      const compatibilityPage=detail.compatibilityPage;
      const compatibleTurns:Turn[]=[...compatibilityPage.data].reverse(),selected=compatibleTurns.find(turn=>turn.id===selectedId)||compatibleTurns.at(-1);
      const page:any=historyPage({...thread,turns:compatibleTurns},{...input,turnId:selected?.id},attachments);
      page.itemsTruncated=false;page.nextCursor=compatibilityPage.nextCursor||null;page.compatibilityMode='turns';return page;
    }
    const index=turns.findIndex(turn=>turn.id===selectedId);
    if(index>=0)turns[index]=detail.turn;
    const page:any=historyPage({...thread,turns},{...input,turnId:selectedId},attachments);
    page.itemsTruncated=detail.truncated;
    page.nextCursor=listed.nextCursor||null;
    return page;
  }
  const page:any=historyPage({...thread,turns},input,attachments);
  page.nextCursor=listed.nextCursor||null;
  return page;
}

async function readTurnItems(rpc:RpcClient,threadId:string,turnId:string,summary?:Turn){
  const listed=await rpc.request('thread/items/list',{threadId,turnId,cursor:null,limit:ITEM_PAGE_SIZE,sortDirection:'desc'});rememberItemCapability(rpc,threadId,true);
  const recent:HistoryItem[]=(listed.data||[]).map((entry:any)=>entry.item).reverse();
  const firstUser=(summary?.items||[]).find(item=>item.type==='userMessage');
  if(firstUser&&!recent.some(item=>item.id===firstUser.id))recent.unshift(firstUser);
  return{turn:{id:turnId,status:summary?.status,startedAt:summary?.startedAt,completedAt:summary?.completedAt,durationMs:summary?.durationMs,items:recent,itemsView:'full'},truncated:Boolean(listed.nextCursor),compatibility:false as const};
}

async function readTurnDetail(rpc:RpcClient,threadId:string,turnId:string,summary?:Turn,cursor?:string){
  if(itemCapability(rpc,threadId)!==false)try{return await readTurnItems(rpc,threadId,turnId,summary)}catch(error){if(!unsupportedItems(error))throw error;rememberItemCapability(rpc,threadId,false);}
  const located=await findCompatibilityTurn(rpc,threadId,turnId,cursor);
  return{turn:located.turn,truncated:false,compatibility:true as const,compatibilityPage:located.listed};
}

const readCompatibilityWindow=(rpc:RpcClient,threadId:string,cursor?:string|null)=>rpc.request('thread/turns/list',{threadId,cursor:cursor||null,limit:COMPAT_TURN_PAGE_SIZE,sortDirection:'desc',itemsView:'full'});
async function findCompatibilityTurn(rpc:RpcClient,threadId:string,turnId:string,cursor?:string){
  let next=cursor||null;
  for(let page=0;page<200;page++){
    const listed=await readCompatibilityWindow(rpc,threadId,next),turn=(listed.data||[]).find((entry:Turn)=>entry.id===turnId);
    if(turn)return{turn,listed};
    if(!listed.nextCursor)break;
    next=listed.nextCursor;
  }
  throw new Error('找不到对应历史轮次');
}
