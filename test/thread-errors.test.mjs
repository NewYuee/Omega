import assert from 'node:assert/strict';
import test from 'node:test';
import {activeWriterThreadId,isMissingThreadHistory,isThreadWriterConflict,THREAD_WRITER_BUSY,threadWriterBusyMessage} from '../src/shared/thread-errors.ts';

test('active writer errors are classified as a conversation-level conflict',()=>{
  const id='01a03859-b320-7132-ad05-f7bc2de95e0d';
  const native=new Error(`thread ${id} already has an active writer`);
  assert.equal(activeWriterThreadId(native),id);
  assert.equal(isThreadWriterConflict(native),true);
  assert.equal(isThreadWriterConflict(Object.assign(new Error('localized'),{code:THREAD_WRITER_BUSY,threadId:id})),true);
  assert.match(threadWriterBusyMessage(),/其他会话和服务器连接不受影响/);
});

test('recognizes missing and invalid rollout history errors',()=>{
  const id='01a0d16e-f0e5-7a60-994d-645ce019cc7e';
  assert.equal(isMissingThreadHistory(new Error(`invalid paginated history lineage for ${id}: missing source rollout`)),true);
  assert.equal(isMissingThreadHistory(new Error(`no rollout found for thread id ${id}`)),true);
  assert.equal(isMissingThreadHistory(new Error('network timeout')),false);
});
