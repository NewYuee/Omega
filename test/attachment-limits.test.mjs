import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MAX_MESSAGE_IMAGES,MAX_MESSAGE_TEXT_FILES} from '../src/shared/attachment-limits.ts';
import {ImageStore} from '../src/server/images.ts';
import {PastedTextStore} from '../src/server/pasted-content.ts';

test('message attachments accept twenty references and reject twenty-one',async()=>{
  assert.equal(MAX_MESSAGE_IMAGES,20);assert.equal(MAX_MESSAGE_TEXT_FILES,20);
  const ids=Array.from({length:21},()=>`${Date.now()}-${randomUUID()}`);
  const images=new ImageStore('/tmp/omega-limit-test-images');
  images.resolve=async id=>images.file(id);
  const input=await images.turnInput([],ids.slice(0,20));
  assert.equal(input.length,20);assert.equal(images.fromContent(input).length,20);
  await assert.rejects(images.turnInput([],ids),/20/);
  const pastes=new PastedTextStore('/tmp/omega-limit-test-text');
  pastes.resolve=async id=>({id,text:'example',chars:7,bytes:7});
  assert.equal((await pastes.refs(ids.slice(0,20))).length,20);
  await assert.rejects(pastes.refs(ids),/20/);
});
