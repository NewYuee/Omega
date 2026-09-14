import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

test('Tauri is exposed only as the mobile container while desktop uses Electron',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['native:dev'],undefined);
  assert.equal(pkg.scripts['native:build'],undefined);
  assert.match(pkg.scripts['desktop:dev'],/electron/);
  assert.match(pkg.scripts['desktop:package'],/electron-builder/);
  // The generated Android Gradle task invokes `npm run -- tauri ...`.
  assert.equal(pkg.scripts.tauri,'node native/tauri.mjs');
  assert.match(pkg.scripts['mobile:android:init'],/tauri\.mjs android init/);
  assert.match(pkg.scripts['mobile:android:build'],/tauri\.mjs android build/);
  const blocked=spawnSync(process.execPath,['native/tauri.mjs','build'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(blocked.status,2);
  assert.match(blocked.stderr,/Tauri 工程仅用于移动端/);
});
