type Turn={id:string};
type Scope={threadId:string;selectedTurn:string;outline:Turn[];olderCursor:string|null;pageCursor:string|null};
type Request={threadId:string;turnId?:string;cursor?:string;outlineOnly?:boolean;selectionOnly?:boolean};
type Result={outline?:Turn[];nextCursor?:string|null;turn?:{items?:Record<string,unknown>[]}};
type Page=Scope & {index:number;cursor:string|null;done:boolean};

// The current turn remains managed by SessionRuntime; this pager walks older turns
// without changing its selection or fetching an unbounded thread history.
export function createChatHistoryPager(read:(request:Request)=>Promise<Result>){
  let page:Page|null=null;
  return {
    reset(){page=null},
    async load(scope:Scope,isCurrent:()=>boolean){
      if(!page||page.threadId!==scope.threadId||page.selectedTurn!==scope.selectedTurn){
        const index=scope.outline.findIndex(turn=>turn.id===scope.selectedTurn);
        page={...scope,index:index<0?scope.outline.length:index,cursor:scope.olderCursor,done:false};
      }
      const current=page;
      if(current.done)return null;
      if(current.index===0){
        if(!current.cursor){current.done=true;return null;}
        const cursor=current.cursor,result=await read({threadId:scope.threadId,cursor,outlineOnly:true});
        if(!isCurrent())return null;
        const outline=result.outline||[];
        if(!outline.length){current.done=true;return null;}
        current.outline=outline;current.index=outline.length;current.pageCursor=cursor;current.cursor=result.nextCursor||null;
      }
      const next=current.outline[current.index-1];
      if(!next){current.done=true;return null;}
      const result=await read({threadId:scope.threadId,turnId:next.id,cursor:current.pageCursor||undefined,selectionOnly:true});
      if(!isCurrent())return null;
      current.index--;
      return {turnId:next.id,items:(result.turn?.items||[]).map(item=>({...item,turnId:next.id,historyCursor:current.pageCursor})),hasMore:current.index>0||!!current.cursor};
    }
  };
}
