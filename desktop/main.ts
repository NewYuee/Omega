import {app,BrowserWindow,ipcMain,Menu,nativeImage,net,Notification,safeStorage,shell,Tray} from 'electron';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {connectionProfileSchema,type ConnectionProfile} from '../src/shared/contracts.js';

type StoredProfile={serverUrl:string;allowHttp:boolean;encryptedKey:string};
type DesktopCommand='new-chat'|'new-group'|'control-center'|'toggle-sidebar'|'open-thread';
const profilePath=()=>path.join(app.getPath('userData'),'connection.json');
async function readStored():Promise<ConnectionProfile|null>{try{const value=JSON.parse(await readFile(profilePath(),'utf8')) as StoredProfile;if(!safeStorage.isEncryptionAvailable())return null;return connectionProfileSchema.parse({serverUrl:value.serverUrl,allowHttp:value.allowHttp,accessKey:safeStorage.decryptString(Buffer.from(value.encryptedKey,'base64'))});}catch{return null;}}
async function saveStored(profile:ConnectionProfile){if(!safeStorage.isEncryptionAvailable())return false;await writeFile(profilePath(),JSON.stringify({serverUrl:profile.serverUrl,allowHttp:profile.allowHttp,encryptedKey:safeStorage.encryptString(profile.accessKey).toString('base64')}),{mode:0o600});return true;}

let current:ConnectionProfile|null=null,mainWindow:BrowserWindow|null=null,tray:Tray|null=null;
const setupFile=()=>path.join(app.getAppPath(),'desktop-dist','setup.html');
const send=(command:DesktopCommand,value?:unknown)=>mainWindow?.webContents.send('omega:desktop-command',{command,value});
async function openWorkspace(){if(!mainWindow||!current)return;await mainWindow.loadURL(current.serverUrl);}
async function openSetup(){await mainWindow?.loadFile(setupFile());}
function showWindow(){if(!mainWindow)return;mainWindow.show();if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}
function createMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'Omega',submenu:[{role:'about'},{type:'separator'},{label:'连接设置…',accelerator:'CmdOrCtrl+,',click:()=>void openSetup()},{type:'separator'},{role:'quit'}]},
  {label:'文件',submenu:[{label:'新建会话',accelerator:'CmdOrCtrl+N',click:()=>send('new-chat')},{label:'新建群组',accelerator:'CmdOrCtrl+Shift+N',click:()=>send('new-group')},{type:'separator'},{label:'控制中心',accelerator:'CmdOrCtrl+Shift+K',click:()=>send('control-center')},{role:'close'}]},
  {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'显示',submenu:[{label:'切换侧栏',accelerator:'CmdOrCtrl+\\',click:()=>send('toggle-sidebar')},{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{role:'toggleDevTools'}]},
  {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}
]));}
function createTray(){const icon=nativeImage.createFromPath(path.join(app.getAppPath(),'desktop-dist','icon.svg')).resize({width:18,height:18});icon.setTemplateImage(true);tray=new Tray(icon);tray.setToolTip('Omega');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Omega',click:showWindow},{label:'新建会话',click:()=>{showWindow();send('new-chat');}},{label:'控制中心',click:()=>{showWindow();send('control-center');}},{type:'separator'},{label:'退出',click:()=>app.quit()}]));tray.on('double-click',showWindow);}
function createWindow(){
  mainWindow=new BrowserWindow({title:'Omega',width:1240,height:840,minWidth:720,minHeight:520,backgroundColor:'#171a17',show:false,webPreferences:{preload:path.join(app.getAppPath(),'desktop-dist','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.once('ready-to-show',()=>mainWindow?.show());
  mainWindow.on('closed',()=>{mainWindow=null;});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))void shell.openExternal(url);return{action:'deny'};});
  return current?openWorkspace():openSetup();
}

app.whenReady().then(async()=>{
  current=await readStored();
  ipcMain.on('omega:connection-sync',event=>{event.returnValue=current;});
  ipcMain.handle('omega:connect',async(_event,input:unknown)=>{const profile=connectionProfileSchema.parse(input);const response=await net.fetch(new URL('/api/status',profile.serverUrl).href,{headers:{authorization:`Bearer ${profile.accessKey}`}});if(!response.ok)throw new Error(response.status===401?'访问密钥不正确':`连接失败（HTTP ${response.status}）`);const status=await response.json() as {ready?:boolean};if(!status.ready)throw new Error('Omega 服务端尚未就绪');const persisted=await saveStored(profile);current=profile;await openWorkspace();return{persisted};});
  ipcMain.handle('omega:show-setup',openSetup);
  ipcMain.handle('omega:notify',(_event,input:unknown)=>{if(!Notification.isSupported()||!input||typeof input!=='object')return false;const value=input as {title?:unknown;body?:unknown;threadId?:unknown};const notification=new Notification({title:String(value.title||'Omega').slice(0,100),body:String(value.body||'').slice(0,500),silent:false});notification.on('click',()=>{showWindow();if(typeof value.threadId==='string')send('open-thread',value.threadId);});notification.show();return true;});
  createMenu();createTray();await createWindow();
  app.on('activate',()=>{if(!mainWindow)void createWindow();else showWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
