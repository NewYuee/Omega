import {useSyncExternalStore} from 'react';

export interface NavItem{id:string;name?:string;preview?:string;unread?:boolean;unreadCount?:number;[key:string]:unknown}
interface Actions{open(id:string):void;[key:string]:unknown}
export interface AppSnapshot{
  mode:'chats'|'groups';threadId:string|null;groupId:string|null;
  threads:NavItem[];groups:NavItem[];threadActions:Actions|null;groupActions:Actions|null;
  authenticated:boolean;connected:boolean;
}
let state:AppSnapshot={mode:'chats',threadId:null,groupId:null,threads:[],groups:[],threadActions:null,groupActions:null,authenticated:false,connected:false};
const listeners=new Set<()=>void>();
export const appStore={
  getSnapshot:()=>state,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)},
  patch:(next:Partial<AppSnapshot>)=>{state={...state,...next};for(const listener of listeners)listener()},
};
export const useAppState=()=>useSyncExternalStore(appStore.subscribe,appStore.getSnapshot,appStore.getSnapshot);
export function installAppState(){window.omegaAppState={patch:appStore.patch,getSnapshot:appStore.getSnapshot};window.dispatchEvent(new Event('omega:app-state-ready'));}
