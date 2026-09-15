import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('release publishing is owner-only, tag-only and waits for every platform',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/build.yml',import.meta.url),'utf8');
  const block=workflow.split('\n  publish:\n')[1].split(/\n  \w+:\n/)[0];
  assert.match(block,/github.actor == github.repository_owner/);
  assert.match(block,/github.triggering_actor == github.repository_owner/);
  assert.match(block,/github.event_name == 'push'/);
  assert.match(block,/startsWith\(github.ref, 'refs\/tags\/v'\)/);
  assert.match(block,/github.event.created == true/);
  assert.match(block,/needs: \[verify, android, desktop\]/);
  assert.match(workflow,/permissions:\s+contents: read/);
  assert.equal((workflow.match(/contents: write/g)||[]).length,1);
  assert.match(block,/permissions:\s+contents: write/);
  for(const artifact of ['omega-android-arm64-release','omega-macos','omega-windows-x64'])assert.ok(block.includes(`name: ${artifact}`));
  for(const extension of ['apk','dmg','zip','exe'])assert.ok(block.includes(`*.${extension}`));
  assert.ok(block.indexOf('gh release upload')<block.indexOf('gh release edit'));
  assert.match(block,/--verify-tag/);
  assert.match(block,/--generate-notes --draft/);
  assert.match(block,/RELEASE_TAG: \$\{\{ github.ref_name \}\}/);
});

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
