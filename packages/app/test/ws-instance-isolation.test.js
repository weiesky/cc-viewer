/**
 * Same-name SDK twin WS isolation (review P2): a frame stamped with an instanceKey
 * must reach only clients viewing THAT instance — otherwise closing one same-basename
 * workspace wipes the surviving twin viewer's spinner/queue bubbles.
 *
 * Exercises the real broadcastWsMessage filter predicate with stubbed client set.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const tmpDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'ccv-ws-iso-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';

const mod = await import('../server/server.js');

function makeClient(viewProject, viewInstance) {
  return {
    readyState: 1,
    sent: [],
    _ccvViewProject: viewProject || null,
    _ccvViewInstance: viewInstance || null,
    send(m) { this.sent.push(String(m)); },
  };
}

describe('broadcastWsMessage instance narrowing', () => {
  it('an instanceKey-stamped frame reaches only that instance viewer, not the same-basename twin', () => {
    const wss = { clients: new Set() };
    const a = makeClient('same', 'ccv-aaa111');
    const b = makeClient('same', 'ccv-bbb222');
    wss.clients.add(a);
    wss.clients.add(b);
    mod.setTerminalWssForTests(wss);
    try {
      mod.broadcastWsMessage({ type: 'queue-state', cwd: '/a/same', instanceKey: 'ccv-aaa111', items: [] });
      assert.equal(a.sent.length, 1, 'the owning instance viewer receives the frame');
      assert.equal(b.sent.length, 0, 'the same-basename twin viewer must NOT receive it');
      // Untagged / cwd-only frames narrow only by project — but b's viewInstance stamp
      // alone must not drop a project-scoped frame for it (its project matches).
      mod.broadcastWsMessage({ type: 'sdk-session-state', cwd: '/a/same', state: 'idle' });
      assert.equal(a.sent.length, 2);
      assert.equal(b.sent.length, 1, 'cwd-only frames stay project-scoped (unchanged behavior)');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });

  it('a project-tagged (cwd-less) frame scopes to that project viewer, not to everyone', () => {
    const wss = { clients: new Set() };
    const a = makeClient('same', null);
    const other = makeClient('other-proj', null);
    const unstamped = makeClient(null, null);
    wss.clients.add(a);
    wss.clients.add(other);
    wss.clients.add(unstamped);
    mod.setTerminalWssForTests(wss);
    try {
      // The sdk-manager route-failure fallback carries {project, instanceKey} but no cwd.
      mod.broadcastWsMessage({ type: 'sdk-error', message: 'Workspace "same" is no longer available', project: 'same', instanceKey: 'ccv-aaa111' });
      assert.equal(a.sent.length, 1, 'the owning project viewer receives the frame');
      assert.equal(other.sent.length, 0, 'another project viewer must NOT receive it');
      assert.equal(unstamped.sent.length, 1, 'unstamped clients keep historical receive-all behavior');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });

  it('an instance-stamped sdk-context-usage frame reaches only that instance viewer', () => {
    const wss = { clients: new Set() };
    const a = makeClient('same', 'ccv-aaa111');
    const b = makeClient('same', 'ccv-bbb222');
    wss.clients.add(a);
    wss.clients.add(b);
    mod.setTerminalWssForTests(wss);
    try {
      mod.broadcastWsMessage({ type: 'sdk-context-usage', cwd: '/a/same', instanceKey: 'ccv-aaa111', usage: { totalTokens: 1 } });
      assert.equal(a.sent.length, 1, 'the owning instance viewer receives its usage frame');
      assert.equal(b.sent.length, 0, 'the same-basename twin viewer must NOT receive it');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });
});

describe('sdkContextReplayFrame — context-only instance-aware reconnect replay', () => {
  const frame = (cwd, instanceKey) => ({
    type: 'sdk-context-usage', ts: 1, usage: { totalTokens: 1 }, cwd,
    ...(instanceKey ? { instanceKey } : {}),
  });

  it('anchors by exact viewed instance (instance wins over project)', () => {
    const calls = [];
    const snap = frame('/ws/same', 'ccv-aaa111');
    const out = mod.sdkContextReplayFrame((anchor) => { calls.push(anchor); return snap; }, 'same', 'ccv-aaa111');
    assert.deepEqual(calls, [{ instanceKey: 'ccv-aaa111' }], 'exact instance is the anchor');
    assert.equal(out, snap);
  });

  it('rejects missing/mismatched instance frames when the viewer is pinned to an instance', () => {
    const missing = frame('/ws/same');
    const foreign = frame('/ws/same', 'ccv-bbb222');
    assert.equal(mod.sdkContextReplayFrame(() => missing, 'same', 'ccv-aaa111'), null,
      'an unstamped snapshot cannot be trusted for an exact-instance view');
    assert.equal(mod.sdkContextReplayFrame(() => foreign, 'same', 'ccv-aaa111'), null,
      'a twin instance snapshot must be rejected');
    assert.equal(mod.sdkContextReplayFrame(() => frame('/ws/other', 'ccv-aaa111'), 'same', 'ccv-aaa111'), null,
      'the project filter still applies alongside the instance filter');
    assert.equal(mod.sdkContextReplayFrame(() => missing, null, 'ccv-aaa111'), null,
      'instance filtering does not depend on a project stamp');
  });

  it('falls back to a project anchor and filters via projectKeyForCwd', () => {
    const calls = [];
    const snap = frame('/ws/My Project');
    const out = mod.sdkContextReplayFrame((anchor) => { calls.push(anchor); return snap; }, 'My_Project', null);
    assert.deepEqual(calls, [{ project: 'My_Project' }], 'project is the fallback anchor');
    assert.equal(out, snap, 'sanitized project keys match the sanitized cwd basename');
    assert.equal(mod.sdkContextReplayFrame(() => frame('/ws/other'), 'My_Project', null), null,
      'another project’s frame is rejected');
  });

  it('uses no anchor when the view carries neither project nor instance', () => {
    const calls = [];
    const snap = frame('/anything');
    const out = mod.sdkContextReplayFrame((anchor) => { calls.push(anchor); return snap; }, null, null);
    assert.deepEqual(calls, [undefined], 'no-param replay uses the active snapshot fallback');
    assert.equal(out, snap);
  });

  it('returns null for an unknown/ambiguous anchor (never falls back to active)', () => {
    const calls = [];
    const out = mod.sdkContextReplayFrame((anchor) => { calls.push(anchor); return null; }, 'same', null);
    assert.equal(out, null);
    assert.deepEqual(calls, [{ project: 'same' }], 'the anchor getter is consulted exactly once');
  });
});
