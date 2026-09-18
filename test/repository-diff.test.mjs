import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryDiffLines} from '../src/shared/repository-diff.ts';

test('diff display removes transport markers but preserves source operators and line numbers',()=>{
  const rows=repositoryDiffLines('diff --git a/a b/a\nindex 123..456 100644\n--- a/a\n+++ b/a\n@@ -2,2 +2,3 @@ function\n-old\n+++counter;\n shared\n+\n\\ No newline at end of file\n');
  assert.deepEqual(rows.slice(1,5),[{kind:'removed',text:'old',oldLine:2},{kind:'added',text:'++counter;',newLine:2},{kind:'context',text:'shared',oldLine:3,newLine:3},{kind:'added',text:'',newLine:4}]);
  assert.equal(rows[0].kind,'section');assert.equal(rows.at(-1).text,'文件末尾没有换行');assert.equal(rows.length,6);
});
test('diff display supports new/deleted files, multiple hunks and plain notices',()=>{
  const rows=repositoryDiffLines('@@ -0,0 +1 @@\n+new\n@@ -10 +11,0 @@\n-gone');
  assert.equal(rows[1].newLine,1);assert.equal(rows[3].oldLine,10);
  assert.equal(repositoryDiffLines('未跟踪文件：此版仅列出文件名。')[0].kind,'note');
  assert.match(repositoryDiffLines('Binary files a/x and b/x differ')[0].text,/Binary/);
});
