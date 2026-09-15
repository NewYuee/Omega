import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {handoffFiles} from '../src/server/handoff-files.ts';
test('handoff files preserve full results, stay immutable and cannot escape the directory',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'omega-handoff-test-'));try{const body='完整细节'.repeat(5000),files=await handoffFiles(dir,[{id:'../unsafe',result:body}]);assert.equal(path.dirname(files['../unsafe']),dir);assert.equal(await readFile(files['../unsafe'],'utf8'),body);assert.deepEqual(await handoffFiles(dir,[{id:'../unsafe',result:body}]),files);const next=await handoffFiles(dir,[{id:'../unsafe',result:'新结果'}]);assert.notEqual(next['../unsafe'],files['../unsafe']);if(process.platform!=='win32')assert.equal((await stat(files['../unsafe'])).mode&0o777,0o600);}finally{await rm(dir,{recursive:true,force:true})}});
