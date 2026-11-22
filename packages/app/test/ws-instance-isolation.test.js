/**
 * Same-name SDK twin WS isolation (review P2): a frame stamped with an instanceKey
 * must reach only clients viewing THAT instance — otherwise closing one same-basename
 * workspace wipes the surviving twin viewer's spinner/queue bubbles.
 *
 * Exercises the real broadcastWsMessage filter predicate with stubbed client set.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ws-iso-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// isSdkMode is a module-load const (server.js: `process.env.CCV_SDK_MODE === '1'` read once
// at import), so the SDK branch under test must be armed BEFORE the server import below —
// setting it inside an it()/helper would be too late and the cohere gate would stay shut.
process.env.CCV_SDK_MODE = '1';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_URL;

const mod = await import('../server/server.js');
const sdkMod = await import('../server/lib/sdk-manager.js');
const interceptor = await import('../server/interceptor.js');

/** Minimal resident fake query so initSdkSession/createSdkSession never spawn a real SDK child. */
function _fakeQuery() {
  return ({ prompt }) => {
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's-fake', model: 'm', slash_commands: [] };
      for await (const item of prompt) { if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: 's-fake', is_error: false, result: 'ok' }; }
    })();
    q.close = () => {};
    q.interrupt = () => Promise.resolve();
    return q;
  };
}

function makeClient(viewProject, viewInstance) {
  return {
    readyState: 1,
    sent: [],
    _ccvViewProject: viewProject || null,
    _ccvViewInstance: viewInstance || null,
    send(m) { this.sent.push(String(m)); },
  };
}

describe('the cohered bound stamp narrows twin frames (end-to-end filter check)', () => {
  it('a client stamped with the cohered primary key drops the twin and keeps its own frames', () => {
    const wss = { clients: new Set() };
    const primary = makeClient('same', 'ccv-primarykey'); // what _cohereAttachInstance now writes
    const twin = makeClient('same', 'ccv-twinkey');
    wss.clients.add(primary);
    wss.clients.add(twin);
    mod.setTerminalWssForTests(wss);
    try {
      // A twin-stamped frame no longer reaches the cohered primary viewer during the window.
      mod.broadcastWsMessage({ type: 'sdk-session-state', cwd: '/a/same', state: 'running', instanceKey: 'ccv-twinkey' });
      assert.equal(primary.sent.length, 0, 'the twin frame is dropped for the cohered primary view');
      assert.equal(twin.sent.length, 1, 'the twin viewer still receives its own frame');
      // And the primary's own frame reaches the cohered client.
      mod.broadcastWsMessage({ type: 'sdk-session-state', cwd: '/a/same', state: 'running', instanceKey: 'ccv-primarykey' });
      assert.equal(primary.sent.length, 1, 'the cohered primary receives its own frame');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });
});

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

describe('broadcastWsMessage id-addressed approval clears bypass narrowing', () => {
  // An auto-approve/auto-answer/timeout emits a terminal "this pending is over" frame whose
  // ONLY consumer action is "clear the pending whose id matches" (a no-op otherwise). Routing
  // it through view narrowing turns a display optimization into a correctness dependency: a
  // diverged connection stamp would silently drop the only close signal, and the server-side
  // pending is already deleted, so no replay can recover it. These frames broadcast to all.
  it('id-addressed SDK terminal frames reach every viewer regardless of project/instance stamp', () => {
    const wss = { clients: new Set() };
    const owner = makeClient('same', 'ccv-aaa111');
    const twin = makeClient('same', 'ccv-bbb222');
    const foreign = makeClient('other-proj', 'ccv-zzz999');
    const unstamped = makeClient(null, null);
    for (const c of [owner, twin, foreign, unstamped]) wss.clients.add(c);
    mod.setTerminalWssForTests(wss);
    try {
      const types = ['sdk-plan-resolved', 'sdk-ask-resolved', 'perm-hook-resolved', 'sdk-ask-timeout', 'perm-hook-timeout'];
      for (const type of types) {
        for (const c of [owner, twin, foreign, unstamped]) c.sent.length = 0;
        mod.broadcastWsMessage({ type, id: 'req-1', reason: 'auto-approved', cwd: '/a/same', instanceKey: 'ccv-aaa111' });
        assert.equal(owner.sent.length, 1, `${type}: owner receives`);
        assert.equal(twin.sent.length, 1, `${type}: same-basename twin receives (id no-op)`);
        assert.equal(foreign.sent.length, 1, `${type}: foreign project viewer receives (id no-op)`);
        assert.equal(unstamped.sent.length, 1, `${type}: unstamped receives`);
      }
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });

  it('a no-id perm-hook-timeout (legacy clear-all) stays narrowed', () => {
    const wss = { clients: new Set() };
    const owner = makeClient('same', 'ccv-aaa111');
    const foreign = makeClient('other-proj', null);
    wss.clients.add(owner);
    wss.clients.add(foreign);
    mod.setTerminalWssForTests(wss);
    try {
      mod.broadcastWsMessage({ type: 'perm-hook-timeout', cwd: '/a/same', instanceKey: 'ccv-aaa111' });
      assert.equal(owner.sent.length, 1, 'the owning instance viewer receives the legacy clear-all');
      assert.equal(foreign.sent.length, 0, 'a no-id clear-all must NOT cross views');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });

  it('non-clear approval frames (pending / auto-cancel) stay narrowed even with an id', () => {
    const wss = { clients: new Set() };
    const owner = makeClient('same', 'ccv-aaa111');
    const foreign = makeClient('other-proj', 'ccv-zzz999');
    wss.clients.add(owner);
    wss.clients.add(foreign);
    mod.setTerminalWssForTests(wss);
    try {
      for (const type of ['sdk-plan-pending', 'sdk-ask-pending', 'perm-hook-pending', 'sdk-plan-auto-cancel']) {
        owner.sent.length = 0; foreign.sent.length = 0;
        mod.broadcastWsMessage({ type, id: 'req-1', cwd: '/a/same', instanceKey: 'ccv-aaa111' });
        assert.equal(owner.sent.length, 1, `${type}: owner receives`);
        assert.equal(foreign.sent.length, 0, `${type}: still narrowed (state-carrying frames must not bleed)`);
      }
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

// ─── Attach-stamp coherence (2026-11): the fix for the same-cwd twin chat-panel bleed ───
// A bound-project client whose boundInstance hasn't hydrated attaches with NO instanceKey;
// the server coheres the stamp to the bound cwd's PRIMARY instanceKey so broadcastWsMessage's
// instance narrowing applies immediately (instead of leaking both twins' frames until the
// first /api/live-processes poll).
describe('sdk-manager resolveBoundPrimaryInstanceKey', () => {
  const wsDir = join(tmpDir, 'cohere-project');
  mkdirSync(wsDir, { recursive: true });
  const bootKey = `ccv-${createHash('sha256').update(pathResolve(wsDir)).digest('hex').slice(0, 32)}`;

  afterEach(() => { try { sdkMod.stopSession(); } catch {} try { sdkMod.__setQueryForTests(undefined); } catch {} });

  it('resolves the deterministic primary (not the active fresh sibling)', () => {
    sdkMod.__setQueryForTests(_fakeQuery());
    sdkMod.initSdkSession(wsDir, 'cohere-project', { permissionMode: 'default', env: { ...process.env } });
    const sibling = sdkMod.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } }); // becomes active
    assert.notEqual(sibling.instanceKey, bootKey, 'the fresh sibling has a distinct random key');
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(wsDir), bootKey, 'the bound identity is the stable primary, not the active sibling');
  });

  it('falls back to the newest same-cwd session when only a fresh key exists', () => {
    sdkMod.__setQueryForTests(_fakeQuery());
    const only = sdkMod.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(wsDir), only.instanceKey, 'no deterministic session → the latest row');
  });

  it('deterministic-boot-closed: with only fresh siblings left, falls back to the NEWEST', () => {
    sdkMod.__setQueryForTests(_fakeQuery());
    sdkMod.initSdkSession(wsDir, 'cohere-project', { permissionMode: 'default', env: { ...process.env } }); // deterministic boot
    const older = sdkMod.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    const newer = sdkMod.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    // Close the deterministic boot session, leaving only the two fresh siblings.
    const closed = sdkMod.closeSdkSession({ instanceKey: bootKey });
    assert.equal(closed.ok, true, 'the boot session closed');
    // The bound identity must fall back to the NEWEST surviving sibling (Map-insertion-last),
    // not the oldest — and resume.js delegates here, so the header agrees.
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(wsDir), newer.instanceKey, 'fallback picks the newest fresh sibling');
    assert.notEqual(newer.instanceKey, older.instanceKey, 'the two fresh siblings are distinct');
  });

  it('returns null for a cwd with no session', () => {
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(join(tmpDir, 'no-such-cwd')), null);
  });

  it('normalizes the cwd (trailing-dot spelling resolves to the same primary)', () => {
    sdkMod.__setQueryForTests(_fakeQuery());
    sdkMod.initSdkSession(wsDir, 'cohere-project', { permissionMode: 'default', env: { ...process.env } });
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(join(wsDir, '.')), bootKey, 'a non-normalized cwd spelling still hits the same session');
  });

  it('returns null for an empty/unresolvable cwd', () => {
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(''), null, 'empty cwd → null');
    assert.equal(sdkMod.resolveBoundPrimaryInstanceKey(null), null, 'non-string cwd → null');
  });
});

describe('_cohereAttachInstance (server attach-stamp coherence)', () => {
  const wsDir = join(tmpDir, 'cohere-project');
  mkdirSync(wsDir, { recursive: true });
  const bootKey = `ccv-${createHash('sha256').update(pathResolve(wsDir)).digest('hex').slice(0, 32)}`;
  const prevProjectDir = process.env.CCV_PROJECT_DIR;

  afterEach(() => {
    try { sdkMod.stopSession(); } catch {}
    try { sdkMod.__setQueryForTests(undefined); } catch {}
    mod.setSdkResolveBoundPrimaryInstanceKey(null);
    try { interceptor.resetWorkspace(); } catch {} // release the _projectName binding
    if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR; else process.env.CCV_PROJECT_DIR = prevProjectDir;
  });

  function armBoundTwin() {
    sdkMod.__setQueryForTests(_fakeQuery());
    // Bind the server to this cwd so `_projectName` (the live ESM binding _cohereAttachInstance
    // compares the view against) becomes this project key; CCV_PROJECT_DIR makes it the bound cwd.
    interceptor.initForWorkspace(wsDir, { forceNew: true });
    process.env.CCV_PROJECT_DIR = wsDir;
    sdkMod.initSdkSession(wsDir, 'cohere-project', { permissionMode: 'default', env: { ...process.env } });
    sdkMod.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } }); // live twin
    mod.setSdkResolveBoundPrimaryInstanceKey(sdkMod.resolveBoundPrimaryInstanceKey);
  }

  it('a bound-project attach with NO instanceKey coheres to the primary', () => {
    armBoundTwin();
    assert.equal(mod._cohereAttachInstance('cohere-project', ''), bootKey, 'the empty key resolves to the bound primary');
    assert.equal(mod._cohereAttachInstance('cohere-project', null), bootKey);
    assert.equal(mod._cohereAttachInstance('cohere-project', undefined), bootKey);
  });

  it('an explicit instanceKey is NEVER overridden', () => {
    armBoundTwin();
    assert.equal(mod._cohereAttachInstance('cohere-project', 'ccv-twin999'), 'ccv-twin999', 'a parallel-view pin is left untouched');
  });

  it('a non-bound project is left alone (null)', () => {
    armBoundTwin();
    assert.equal(mod._cohereAttachInstance('other-proj', ''), null, 'a parallel/foreign project keeps its own (null) anchor');
  });

  it('a null view (early boot, before the project name hydrates) stays null', () => {
    armBoundTwin();
    assert.equal(mod._cohereAttachInstance(null, null), null, 'no view → no coherence (legacy early-boot behavior)');
  });

  it('a non-normalized bound cwd still resolves (both sides share _normalizeCwd)', () => {
    armBoundTwin();
    process.env.CCV_PROJECT_DIR = join(wsDir, '.'); // trailing-dot spelling of the same dir
    assert.equal(mod._cohereAttachInstance('cohere-project', ''), bootKey, 'cwd normalization keeps the resolution stable');
  });

  it('a throwing resolver is swallowed to null (reportSwallowed, never breaks the upgrade handler)', () => {
    interceptor.initForWorkspace(wsDir, { forceNew: true });
    process.env.CCV_PROJECT_DIR = wsDir;
    mod.setSdkResolveBoundPrimaryInstanceKey(() => { throw new Error('boom'); });
    assert.equal(mod._cohereAttachInstance('cohere-project', ''), null, 'resolution failure degrades to the legacy null stamp');
  });

  it('no resolver registered → null (unchanged legacy behavior)', () => {
    interceptor.initForWorkspace(wsDir, { forceNew: true });
    process.env.CCV_PROJECT_DIR = wsDir;
    mod.setSdkResolveBoundPrimaryInstanceKey(null);
    assert.equal(mod._cohereAttachInstance('cohere-project', ''), null);
  });
});
