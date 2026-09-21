declare module '*.css';

interface OmegaDesktopBridge {
  connect(value:unknown):Promise<{persisted:boolean}>;
  showSetup():Promise<void>;
  notify(value:{title:string;body:string;threadId?:string}):Promise<void>;
  profile:{serverUrl:string;allowHttp:boolean}|null;
}

interface OmegaNativeAdapter{
  profile:{serverUrl:string;key?:string;allowHttp:boolean}|null;
  fetch(route:string,options?:RequestInit):Promise<Response>;
  rememberKey(key:string):Promise<void>;
  prepareConnection(key:string):Promise<void>;
}

interface Window {
  __OMEGA_NATIVE__?:OmegaNativeAdapter;
  omegaAppState?:{patch(value:Record<string,unknown>):void;getSnapshot():unknown};
  omegaRuntime?:any;
  omegaNavigation?:{openThread(id:string,turnId?:string|null):Promise<void>};
  omegaSystem?:{backup():Promise<void>;restore(file:File):Promise<{files:number;restartRequired:boolean}>};
  omegaDesktop?:OmegaDesktopBridge;
  omegaProductApi?: <T=unknown>(route:string,data?:unknown)=>Promise<T>;
  omegaProductContext?: ()=>{threadId:string|null;active:Record<string,string>;authenticated:boolean};
  omegaReactChat?: {render(model:any,actions:any):void;followLatest():void};
  omegaReactGroup?: {render(model:any,actions:any):void;focus(id:string):Promise<boolean>;clear():void;returnToLatest():void};
  omegaReactWorkspace?: {renderThreads(items:any[],selected:string|null,actions:any):void;renderGroups(items:any[],selected:string|null,actions:any):void;closeSidebar():void};
  omegaSidebarMount?: {host:HTMLElement;anchor:Comment};
  omegaReactGroupPanels?: {renderMembers(model:any,actions:any):void;renderQuestions(model:any,actions:any):void;toggle(side:'members'|'tasks'):void;getLayout():{mobile:boolean;membersOpen:boolean;questionsOpen:boolean}};
  omegaReactForms?: {open(config:any):Promise<any>};
  omegaDialogs?: {open(name:string,props:any):Promise<any>};
  omegaFeishuNotify?: {open(text?:string,options?:{format?:'text'|'card';title?:string;source?:string}):Promise<boolean>};
  omegaReactApprovals?: {render(requests:any[],actions:{resolve(id:string|number,result:unknown):Promise<void>;report(message:string):void}):void};
  omegaReactComposer?: {render(model:any,actions:any):void;collapse():boolean};
  omegaReactGroupComposer?: {render(model:any,actions:any):void;focus():void;refill(value:{text:string;pastedTexts?:any[];mentions?:import('../../client/src/RichPasteEditor.js').MemberMention[]}):void;collapse():boolean};
}
