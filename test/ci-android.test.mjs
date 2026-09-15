import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('installers run only for owner pushes creating version tags, after verification',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/build.yml',import.meta.url),'utf8');
  for(const job of ['android','desktop']){
    const block=workflow.split(`\n  ${job}:\n`)[1].split(/\n  \w+:\n/)[0];
    assert.ok(block.includes("if: github.actor == github.repository_owner && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && github.event.created == true"));
    assert.match(block,/needs: verify/);
  }
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/workflow_dispatch:/);
});

test('Android CI overrides unavailable legacy tools package and retains required SDK packages',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/build.yml',import.meta.url),'utf8');
  assert.match(workflow,/uses: android-actions\/setup-android@v3\s+with:\s+(?:#[^\n]*\n\s*)?packages: platform-tools\s/);
  for(const name of ['platforms;android-36','build-tools;36.0.0','ndk;28.2.13676358'])assert.ok(workflow.includes(`'${name}'`));
  assert.ok(workflow.includes('if: github.actor == github.repository_owner'));
});
