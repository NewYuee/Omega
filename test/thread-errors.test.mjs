import assert from 'node:assert/strict';
import test from 'node:test';
import {activeWriterThreadId,isThreadWriterConflict,THREAD_WRITER_BUSY,threadWriterBusyMessage} from '../src/shared/thread-errors.ts';

test('active writer errors are classified as a conversation-level conflict',()=>{
  const id='01a03859-b320-7132-ad05-f7bc2de95e0d';
  const native=new Error(`thread ${id} already has an active writer`);
  assert.equal(activeWriterThreadId(native),id);
  assert.equal(isThreadWriterConflict(native),true);
  assert.equal(isThreadWriterConflict(Object.assign(new Error('localized'),{code:THREAD_WRITER_BUSY,threadId:id})),true);
  assert.match(threadWriterBusyMessage(),/其他会话和服务器连接不受影响/);
});
