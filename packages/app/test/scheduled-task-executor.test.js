// Tests for packages/app/server/lib/scheduled-task-executor.js — the L1 glue between a
// claimed task and the SDK/PTY execution paths. All SDK/PTY accessors are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeScheduledTask } from '../server/lib/scheduled-task-executor.js';

const TASK = { id: 'st_1', project: 'proj', cwd: '/tmp/proj', prompt: 'do it', mode: 'inject', schedule: { kind: 'daily', time: '09:00' } };
const samePath = (a, b) => a === b;

function sdkFake(over = {}) {
  return {
    isSdkAvailable: () => true,
    listSdkSessions: () => [{ key: '/tmp/proj', cwd: '/tmp/proj', active: true, instanceKey: 'ccv-abc' }],
    // Real contract: getQueueSnapshot returns an ARRAY (sdk-manager _getQueueSnapshot).
    getQueueSnapshot: () => [],
    sendUserMessage: async () => {},
    spawnEphemeralSession: async () => ({ ok: true, sessionId: 'sid-1', subtype: 'success' }),
    ...over,
  };
}
function ptyFake(over = {}) {
  return {
    listLivePtys: () => [{ ptyKind: 'claude', cwd: '/tmp/proj', isActive: true, instanceKey: 'ccv-abc' }],
    getPtyKindFor: () => 'claude',
    ...over,
  };
}
const chatQueueOk = { enqueue: (text, anchor) => ({ id: 'q1', anchor }) };

// ─── inject / SDK ───

test('inject (SDK): dispatched when the resident session accepts', async () => {
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: true, sdk: sdkFake(), pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.equal(r.status, 'dispatched');
});

test('inject (SDK): sdk unavailable → failed/sdk_unavailable', async () => {
  const sdk = sdkFake({ isSdkAvailable: () => false });
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'sdk_unavailable']);
});

test('inject (SDK): no resident session for cwd → failed/no_live_session', async () => {
  const sdk = sdkFake({ listSdkSessions: () => [{ key: '/other', cwd: '/other', instanceKey: 'ccv-x' }] });
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'no_live_session']);
});

test('inject (SDK): full queue → failed/queue_rejected (P1-4, no false dispatched)', async () => {
  // 50-item ARRAY (the real getQueueSnapshot shape) → rejected, not falsely dispatched.
  const sdk = sdkFake({ getQueueSnapshot: () => new Array(50).fill({}) });
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'queue_rejected']);
});

test('inject (SDK): exact instance is authoritative even for a legacy mismatched project stamp', async () => {
  let seen;
  const sdk = sdkFake({ sendUserMessage: async (text, anchor) => { seen = { text, anchor }; } });
  const r = await executeScheduledTask({ ...TASK, project: 'legacy-mismatch' }, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.equal(r.status, 'dispatched');
  assert.deepEqual(seen, { text: TASK.prompt, anchor: { instanceKey: 'ccv-abc' } });
});

// ─── inject / PTY ───

test('inject (PTY): dispatched with strictAnchor passed to enqueue', async () => {
  let seenAnchor;
  const cq = { enqueue: (text, anchor) => { seenAnchor = anchor; return { id: 'q1', anchor }; } };
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: false, sdk: sdkFake(), pty: ptyFake(), chatQueue: cq, samePath });
  assert.equal(r.status, 'dispatched');
  assert.equal(seenAnchor.strictAnchor, true, 'strictAnchor is set (P0-2)');
  assert.equal(seenAnchor.instanceKey, 'ccv-abc');
});

test('inject (PTY): strict precheck uses instanceKey ONLY (P0-2)', async () => {
  let precheckArg;
  const pty = ptyFake({ getPtyKindFor: (a) => { precheckArg = a; return 'claude'; } });
  await executeScheduledTask(TASK, {}, { isSdkMode: false, sdk: sdkFake(), pty, chatQueue: chatQueueOk, samePath });
  assert.deepEqual(Object.keys(precheckArg), ['instanceKey'], 'no project/cwd → _resolveKey cannot fall back');
});

test('inject (PTY): dead instance (strict precheck null) → failed/no_live_session', async () => {
  const pty = ptyFake({ getPtyKindFor: () => null });
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: false, sdk: sdkFake(), pty, chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'no_live_session']);
});

test('inject (PTY): no live claude PTY for cwd → failed/no_live_session', async () => {
  const pty = ptyFake({ listLivePtys: () => [{ ptyKind: 'claude', cwd: '/other', instanceKey: 'ccv-x' }] });
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: false, sdk: sdkFake(), pty, chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'no_live_session']);
});

test('inject (PTY): enqueue rejection → failed/queue_rejected', async () => {
  const r = await executeScheduledTask(TASK, {}, { isSdkMode: false, sdk: sdkFake(), pty: ptyFake(), chatQueue: { enqueue: () => null }, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'queue_rejected']);
});

// ─── spawn ───

test('spawn: completed + sessionId on success', async () => {
  const r = await executeScheduledTask({ ...TASK, mode: 'spawn' }, {}, { isSdkMode: true, sdk: sdkFake(), pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.equal(r.status, 'completed');
  assert.equal(r.sessionId, 'sid-1');
});

test('spawn: non-SDK mode → failed/spawn_unavailable', async () => {
  const r = await executeScheduledTask({ ...TASK, mode: 'spawn' }, {}, { isSdkMode: false, sdk: sdkFake(), pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.deepEqual([r.status, r.reason], ['failed', 'spawn_unavailable']);
});

test('spawn: SDK error → error with reason', async () => {
  const sdk = sdkFake({ spawnEphemeralSession: async () => ({ ok: false, reason: 'turn-error', error: 'boom', sessionId: 'sid-1' }) });
  const r = await executeScheduledTask({ ...TASK, mode: 'spawn' }, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.equal(r.status, 'error');
  assert.equal(r.reason, 'turn-error');
  assert.equal(r.error, 'boom');
});

test('spawn: executor throw → error/internal (contained)', async () => {
  const sdk = sdkFake({ spawnEphemeralSession: async () => { throw new Error('crash'); } });
  const r = await executeScheduledTask({ ...TASK, mode: 'spawn' }, {}, { isSdkMode: true, sdk, pty: ptyFake(), chatQueue: chatQueueOk, samePath });
  assert.equal(r.status, 'error');
  assert.equal(r.reason, 'internal');
});
