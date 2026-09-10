// Run after the official Tauri Android generator. Only amend generated manifest
// settings; never touch a user's SDK, signing key or shell configuration.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml',import.meta.url));
let xml=await readFile(file,'utf8');
if(!xml.includes('<application'))throw new Error('Android manifest missing application');
for(const [name,value] of [['allowBackup','false'],['usesCleartextTraffic','true']]) {
  const attr=new RegExp('android:'+name+'="[^"]*"');
  xml=attr.test(xml)?xml.replace(attr,'android:'+name+'="'+value+'"'):xml.replace('<application','<application android:'+name+'="'+value+'"');
}
// Do not restore encrypted preferences on another device without its Keystore key.
// HTTP permission is only transport compatibility; the UI still requires consent.
await writeFile(file,xml);
console.log('Android manifest prepared: backups off, explicit HTTP compatibility.');
