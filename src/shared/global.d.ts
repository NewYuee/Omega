declare module '*.css';

interface OmegaDesktopBridge {
  connect(value:unknown):Promise<{persisted:boolean}>;
  showSetup():Promise<void>;
  notify(value:{title:string;body:string;threadId?:string}):Promise<void>;
  profile:{serverUrl:string;allowHttp:boolean}|null;
}

interface Window {
  omegaAppState?:{patch(value:Record<string,unknown>):void;getSnapshot():unknown};
  omegaNavigation?:{openThread(id:string,turnId?:string|null):Promise<void>};
  omegaSystem?:{backup():Promise<void>;restore(file:File):Promise<{files:number;restartRequired:boolean}>};
  omegaDesktop?:OmegaDesktopBridge;
  omegaProductApi?: <T=unknown>(route:string,data?:unknown)=>Promise<T>;
  omegaProductContext?: ()=>{threadId:string|null;active:Record<string,string>;authenticated:boolean};
  omegaReactChat?: {render(model:any,actions:any):void;followLatest():void};
  omegaReactGroup?: {render(model:any,actions:any):void;focus(id:string):Promise<boolean>;clear():void;returnToLatest():void};
  omegaReactWorkspace?: {renderThreads(items:any[],selected:string|null,actions:any):void;renderGroups(items:any[],selected:string|null,actions:any):void};
  omegaReactGroupPanels?: {renderMembers(model:any,actions:any):void;renderQuestions(model:any,actions:any):void};
  omegaReactForms?: {open(config:any):Promise<any>};
  omegaReactApprovals?: {render(requests:any[],actions:{resolve(id:string|number,result:unknown):Promise<void>;report(message:string):void}):void};
  omegaReactComposer?: {render(model:any,actions:any):void;collapse():boolean};
  omegaReactGroupComposer?: {render(model:any,actions:any):void;focus():void;collapse():boolean};
}
