import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('compatibility controllers delegate product views exclusively to React',async()=>{
  const [app,groups,room,styles,chat]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/groups.js',import.meta.url),'utf8'),
    readFile(new URL('../public/group-room.js',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8'),
    readFile(new URL('../client/src/ChatTimeline.tsx',import.meta.url),'utf8'),
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
  assert.match(groups,/groupHeaderMeta\.append\(\$\('group-state'\),\$\('group-description'\),\$\('group-cwd'\)\)/);
  assert.match(groups,/groupMoreMenu\.append\(memberPanelToggle,taskPanelToggle,concurrencyLabel,addMemberButton,deleteGroupButton\)/);
  assert.doesNotMatch(groups,/toggle-glyph/);
  assert.doesNotMatch(groups,/querySelector\(['"]\.group-center['"]\)\?\.prepend/);
  assert.match(styles,/\.group-top,\.requirement-queue\{display:none!important\}/);
  assert.match(chat,/threadMore\.append\(summary,menu\)/);
  assert.match(chat,/menu\.append\(history\)/);
  assert.match(chat,/上一组问答.*下一组问答/);
});
