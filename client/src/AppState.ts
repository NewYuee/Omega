import {useSyncExternalStore} from 'react';

export interface NavItem{id:string;name?:string;preview?:string;unread?:boolean;unreadCount?:number;[key:string]:unknown}
interface Actions{open(id:string):void;[key:string]:unknown}
export interface HeaderTurn{id:string;label:string}
export interface ChatHeaderState{
  outline:HeaderTurn[];selectedTurn:string|null;historyMode:boolean;hasOlder:boolean;hasNewer:boolean;
  actions:{selectTurn(index:number):void;previous():void;next():void;latest():void};
}
export interface GroupHeaderState{
  status:string;statusLabel:string;description:string;availability:string;maxConcurrency:number;
  membersOpen:boolean;questionsOpen:boolean;mobile:boolean;disabled:boolean;
  actions:{toggleMembers():void;toggleQuestions():void;setConcurrency(value:number):void;addMember():void;deleteGroup():void};
}
export interface ShellActions{
  switchMode(mode:'chats'|'groups'):void;
  newAction():void;
  openSettings():void;
}
export interface AppSnapshot{
  mode:'chats'|'groups';threadId:string|null;groupId:string|null;
  chatTitle:string;groupTitle:string;onlineDevices:number|null;
  threads:NavItem[];groups:NavItem[];threadActions:Actions|null;groupActions:Actions|null;
  chatHeader:ChatHeaderState|null;groupHeader:GroupHeaderState|null;
  groupWorkspace:any|null;
  authenticated:boolean;connected:boolean;connectionLabel:string;notice:string;shellActions:ShellActions|null;
}
let state:AppSnapshot={mode:'chats',threadId:null,groupId:null,chatTitle:'开始下一件事',groupTitle:'创建你的第一个协作群组',onlineDevices:null,threads:[],groups:[],threadActions:null,groupActions:null,chatHeader:null,groupHeader:null,groupWorkspace:null,authenticated:false,connected:false,connectionLabel:'尚未连接',notice:'',shellActions:null};
const listeners=new Set<()=>void>();
export const appStore={
  getSnapshot:()=>state,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)},
  patch:(next:Partial<AppSnapshot>)=>{state={...state,...next};for(const listener of listeners)listener()},
};
export const useAppState=()=>useSyncExternalStore(appStore.subscribe,appStore.getSnapshot,appStore.getSnapshot);
export function installAppState(){window.omegaAppState={patch:appStore.patch,getSnapshot:appStore.getSnapshot};window.dispatchEvent(new Event('omega:app-state-ready'));}
