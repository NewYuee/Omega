import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),mobilePlatform=args[0];
if(!['android','ios'].includes(mobilePlatform)){
  console.error('Omega 的 Tauri 工程仅用于移动端。Windows 和 macOS 请使用 npm run desktop:dev 或 npm run desktop:package。');
  process.exit(2);
}
const env = {...process.env};
const androidSdk=path.join(root,'.toolchains','android-sdk');
if(existsSync(androidSdk)) {
  env.ANDROID_HOME ||= androidSdk;
  const ndk=path.join(env.ANDROID_HOME,'ndk','28.2.13676358');
  if(existsSync(ndk))env.NDK_HOME ||= ndk;
  env.GRADLE_USER_HOME ||= path.join(root,'.toolchains','gradle');
}
const localJava='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
if(process.platform==='darwin' && existsSync(localJava))env.JAVA_HOME ||= localJava;
const cargo = path.join(root,'.toolchains','cargo');
if (existsSync(path.join(cargo,'bin',process.platform==='win32'?'cargo.exe':'cargo'))) {
  env.CARGO_HOME=cargo; env.RUSTUP_HOME=path.join(root,'.toolchains','rustup');
  env.PATH=path.join(cargo,'bin')+path.delimiter+env.PATH;
}
const cli = path.join(root,'node_modules','@tauri-apps','cli','tauri.js');
const child=spawn(process.execPath,[cli,...args],{cwd:root,env,stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',async code=>{
  process.exitCode=code??1;
  if(code===0 && mobilePlatform==='android' && args[1]==='init') {
    try {await import('./android-prepare.mjs');}
    catch(e){console.error(e.message);process.exitCode=1;}
  }
});
