import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('compatibility controllers delegate product views exclusively to React',async()=>{
  const [app,groups,room]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/groups.js',import.meta.url),'utf8'),
    readFile(new URL('../public/group-room.js',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(app,/from ['"]\.\/markdown\.js['"]/);
  assert.doesNotMatch(app,/createElement\(['"](?:article|section|details)['"]\)/);
  assert.doesNotMatch(app,/\$\(['"]messages['"]\)/);
  assert.doesNotMatch(app,/history-select|prev-exchange|next-exchange|floating-latest/);
  assert.doesNotMatch(groups,/from ['"]\.\/(?:markdown|avatars)\.js['"]/);
  assert.doesNotMatch(groups,/createElement\(['"]article['"]\)/);
  assert.doesNotMatch(room,/from ['"]\.\/(?:markdown|avatars)\.js['"]/);
  assert.doesNotMatch(room,/createElement\(['"]article['"]\)/);
  assert.doesNotMatch(room,/getElementById\(['"]group-timeline['"]\)|scrollTop|scrollHeight|querySelector/);
});
