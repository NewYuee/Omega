import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../bridge.mjs';

test('shared approval can only resolve once across devices', () => {
  const bridge = Object.create(Bridge.prototype);
  bridge.approvals = new Map([['7', { id: 7, params: { threadId: 't' } }]]);
  const writes = []; bridge.write = x => writes.push(x); bridge.emit = () => {};
  bridge.answer('7', { decision: 'accept' });
  assert.throws(() => bridge.answer('7', { decision: 'decline' }), /already been resolved/);
  assert.deepEqual(writes, [{ id: 7, result: { decision: 'accept' } }]);
});
test('server lifecycle resolution clears pending approval', () => {
  const bridge = Object.create(Bridge.prototype);
  bridge.approvals = new Map(); bridge.emit = () => {};
  bridge.receive({ id: 'approval', method: 'item/fileChange/requestApproval', params: {} });
  assert.equal(bridge.approvals.size, 1);
  bridge.receive({ method: 'serverRequest/resolved', params: { requestId: 'approval' } });
  assert.equal(bridge.approvals.size, 0);
});
