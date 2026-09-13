import {contextBridge,ipcRenderer} from 'electron';
type Profile={serverUrl:string;accessKey:string;allowHttp:boolean};
type CommandMessage={command:string;value?:unknown};
const profile=ipcRenderer.sendSync('omega:connection-sync') as Profile|null;
if(location.protocol!=='file:'&&profile?.accessKey)sessionStorage.setItem('omega-key',profile.accessKey);
ipcRenderer.on('omega:desktop-command',(_event,message:CommandMessage)=>window.dispatchEvent(new CustomEvent('omega:desktop-command',{detail:message})));
contextBridge.exposeInMainWorld('omegaDesktop',{connect:(value:unknown)=>ipcRenderer.invoke('omega:connect',value),showSetup:()=>ipcRenderer.invoke('omega:show-setup'),notify:(value:unknown)=>ipcRenderer.invoke('omega:notify',value),profile:profile&&{serverUrl:profile.serverUrl,allowHttp:profile.allowHttp}});
