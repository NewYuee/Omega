import {existsSync} from 'node:fs';
import {mkdir,readdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const isWindows=process.platform==='win32';
const executable=name=>isWindows?`${name}.exe`:name;
const run=(command,args,{env=process.env}={})=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(new Error(`${path.basename(command)} exited with code ${code??'unknown'}`)));
});

const targetIndex=process.argv.indexOf('--target');
const target=targetIndex>=0&&process.argv[targetIndex+1]?process.argv[targetIndex+1]:'aarch64';
const npmCommand=isWindows?'npm.cmd':'npm';
await run(npmCommand,['run','mobile:android:build','--','--target',target]);

const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(root,'.toolchains','android-sdk');
const buildToolsRoot=path.join(sdk,'build-tools');
const versions=(await readdir(buildToolsRoot,{withFileTypes:true}))
  .filter(entry=>entry.isDirectory())
  .map(entry=>entry.name)
  .sort((left,right)=>right.localeCompare(left,undefined,{numeric:true}));
if(!versions.length)throw new Error(`Android Build Tools not found in ${buildToolsRoot}`);
const tools=path.join(buildToolsRoot,versions[0]);
const zipalign=path.join(tools,executable('zipalign'));
const apksigner=path.join(tools,executable('apksigner'));

const releaseRoot=path.join(root,'src-tauri','gen','android','app','build','outputs','apk');
const findUnsigned=async directory=>{
  const found=[];
  const visit=async current=>{
    for(const entry of await readdir(current,{withFileTypes:true})){
      const item=path.join(current,entry.name);
      if(entry.isDirectory())await visit(item);
      else if(entry.name.endsWith('-release-unsigned.apk'))found.push({item,mtime:(await stat(item)).mtimeMs});
    }
  };
  await visit(directory);
  return found.sort((left,right)=>right.mtime-left.mtime)[0]?.item;
};
const unsigned=await findUnsigned(releaseRoot);
if(!unsigned)throw new Error(`Unsigned release APK not found in ${releaseRoot}`);
const outputDir=path.dirname(unsigned);
const aligned=path.join(outputDir,`Omega-${target}-release-local-aligned.apk`);
const signed=path.join(outputDir,`Omega-${target}-release-local-signed.apk`);

const keystore=process.env.OMEGA_ANDROID_KEYSTORE||path.join(homedir(),'.android','debug.keystore');
const alias=process.env.OMEGA_ANDROID_KEY_ALIAS||'androiddebugkey';
const storePassword=process.env.OMEGA_ANDROID_STORE_PASSWORD||'android';
const keyPassword=process.env.OMEGA_ANDROID_KEY_PASSWORD||storePassword;
if(!existsSync(keystore)){
  if(process.env.OMEGA_ANDROID_KEYSTORE)throw new Error(`Configured Android keystore not found: ${keystore}`);
  await mkdir(path.dirname(keystore),{recursive:true});
  const keytool=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',executable('keytool')):executable('keytool');
  await run(keytool,['-genkeypair','-v','-keystore',keystore,'-storepass',storePassword,'-keypass',keyPassword,'-alias',alias,'-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Android Debug,O=Android,C=US']);
}

await run(zipalign,['-f','-p','4',unsigned,aligned]);
const signingEnv={...process.env,OMEGA_APK_STORE_PASSWORD:storePassword,OMEGA_APK_KEY_PASSWORD:keyPassword};
await run(apksigner,['sign','--ks',keystore,'--ks-key-alias',alias,'--ks-pass','env:OMEGA_APK_STORE_PASSWORD','--key-pass','env:OMEGA_APK_KEY_PASSWORD','--out',signed,aligned],{env:signingEnv});
await run(apksigner,['verify','--verbose','--print-certs',signed]);
console.log(`Signed release APK: ${signed}`);
