import {spawn} from 'node:child_process';
import process from 'node:process';

let child=null,stopping=false,delay=500;
function start(){
  child=spawn(process.execPath,['server.ts'],{cwd:new URL('../',import.meta.url),env:{...process.env,OMEGA_SUPERVISED:'1'},stdio:'inherit'});
  child.on('exit',(code,signal)=>{child=null;if(stopping)return process.exit(code||0);const wait=code===75?150:delay;delay=code===75?500:Math.min(delay*2,15000);console.error(`Omega exited (${signal||code}); restarting in ${wait}ms`);setTimeout(start,wait);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;if(child)child.kill(signal);else process.exit(0)});
start();
