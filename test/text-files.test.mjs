import test from 'node:test';
import assert from 'node:assert/strict';
import {readTextFile,validateTextFile,TEXT_FILE_LIMIT} from '../client/src/text-files.ts';

test('text attachments preserve filename and UTF-8 source without interpreting it',async()=>{
  assert.equal(await readTextFile(new File(['你好\n<script>x</script>'],'demo.ts')), '附件文件名：demo.ts\n\n你好\n<script>x</script>');
  validateTextFile({name:'README.MD',size:TEXT_FILE_LIMIT});
});
test('text attachments reject unsupported types, oversize, empty, binary and invalid encoding',async()=>{
  for(const name of ['x.pdf','x.docx','x.zip','x.exe'])assert.throws(()=>validateTextFile({name,size:10}));
  assert.throws(()=>validateTextFile({name:'x.txt',size:TEXT_FILE_LIMIT+1}));
  for(const content of ['', '   ',new Uint8Array([0,1,2]),new Uint8Array([255,254])])await assert.rejects(()=>readTextFile(new File([content],'x.txt')));
});
