import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('web and mobile policies allow bounded inline member avatars',async()=>{
  const [server,tauri]=await Promise.all([
    readFile(new URL('../server.ts',import.meta.url),'utf8'),
    readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'),
  ]);
  assert.match(server,/img-src 'self' blob: data:/);
  assert.match(JSON.parse(tauri).app.security.csp,/img-src 'self' blob: data:/);
  assert.match(server,/script-src 'self'/);
});
