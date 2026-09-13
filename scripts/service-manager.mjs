import {mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const action=process.argv[2]||'status',root=path.resolve(new URL('../',import.meta.url).pathname),node=process.execPath;
const run=(command,args)=>{const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;return result.status||0;};
if(process.platform==='darwin'){
  const dir=path.join(homedir(),'Library','LaunchAgents'),file=path.join(dir,'com.omega.workspace.plist'),domain=`gui/${process.getuid()}`;
  if(action==='install'){mkdirSync(dir,{recursive:true});const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.omega.workspace</string><key>ProgramArguments</key><array><string>${esc(node)}</string><string>${esc(path.join(root,'scripts','omega-supervisor.mjs'))}</string></array><key>WorkingDirectory</key><string>${esc(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${esc(path.join(root,'.omega','omega.out.log'))}</string><key>StandardErrorPath</key><string>${esc(path.join(root,'.omega','omega.error.log'))}</string></dict></plist>`,{mode:0o600});run('launchctl',['bootout',domain,file]);const status=run('launchctl',['bootstrap',domain,file]);if(status)process.exit(status);console.log('Omega LaunchAgent installed and started.');}
  else if(action==='uninstall'){run('launchctl',['bootout',domain,file]);rmSync(file,{force:true});console.log('Omega LaunchAgent removed.');}
  else process.exit(run('launchctl',['print',`${domain}/com.omega.workspace`]));
}else if(process.platform==='linux'){
  const dir=path.join(homedir(),'.config','systemd','user'),file=path.join(dir,'omega.service'),quote=value=>value.replaceAll('%','%%');
  if(action==='install'){mkdirSync(dir,{recursive:true});writeFileSync(file,`[Unit]\nDescription=Omega personal workspace\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nExecStart=${quote(node)} ${quote(path.join(root,'scripts','omega-supervisor.mjs'))}\nRestart=always\nRestartSec=2\nEnvironment=OMEGA_SUPERVISED=1\n\n[Install]\nWantedBy=default.target\n`,{mode:0o600});run('systemctl',['--user','daemon-reload']);process.exit(run('systemctl',['--user','enable','--now','omega.service']));}
  else if(action==='uninstall'){run('systemctl',['--user','disable','--now','omega.service']);rmSync(file,{force:true});run('systemctl',['--user','daemon-reload']);console.log('Omega user service removed.');}
  else process.exit(run('systemctl',['--user','status','omega.service','--no-pager']));
}else{console.error('Automatic service installation currently supports macOS and Linux.');process.exit(2);}
