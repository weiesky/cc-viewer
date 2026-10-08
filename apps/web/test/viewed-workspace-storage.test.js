/**
 * viewedWorkspaceStorage — persistence + restore resolver for the parallel
 * workspace view (2026-10).
 *
 * Pins the localStorage round-trip (with an injected fake storage), the
 * resolveRestoredViewScope decision table (exact instance / cwd re-resolution
 * after an instanceKey re-mint / single-row name-only restore / same-name
 * ambiguity → bound fallback), and resolveCwdForView.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  VIEWED_WORKSPACE_KEY,
  readViewedWorkspace,
  writeViewedWorkspace,
  clearViewedWorkspace,
  resolveRestoredViewScope,
  resolveCwdForView,
} = await import('../src/utils/viewedWorkspaceStorage.js');

/** In-memory localStorage stand-in. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/** Build a live-process row. */
function proc(project, instanceKey, cwd) {
  return { kind: 'main', project, instanceKey, cwd, pid: 1, active: false };
}

// ─── storage round-trip ───────────────────────────────────────────────────

describe('storage round-trip', () => {
  it('write → read preserves project/instanceKey/cwd/ts', () => {
    const s = fakeStorage();
    writeViewedWorkspace({ project: 'proj', instanceKey: 'ccv-abc123', cwd: '/abs/proj', ts: 111 }, s);
    assert.deepEqual(readViewedWorkspace(s), {
      project: 'proj', instanceKey: 'ccv-abc123', cwd: '/abs/proj', ts: 111,
    });
  });

  it('uses the ccv_viewedWorkspace key', () => {
    const s = fakeStorage();
    writeViewedWorkspace({ project: 'p', instanceKey: null, cwd: null, ts: null }, s);
    assert.ok(s._map.has(VIEWED_WORKSPACE_KEY));
  });

  it('normalizes missing fields to null', () => {
    const s = fakeStorage({ [VIEWED_WORKSPACE_KEY]: JSON.stringify({ project: 'p' }) });
    assert.deepEqual(readViewedWorkspace(s), { project: 'p', instanceKey: null, cwd: null, ts: null });
  });

  it('malformed JSON → null', () => {
    const s = fakeStorage({ [VIEWED_WORKSPACE_KEY]: '{not json' });
    assert.equal(readViewedWorkspace(s), null);
  });

  it('missing project → null', () => {
    const s = fakeStorage({ [VIEWED_WORKSPACE_KEY]: JSON.stringify({ instanceKey: 'ccv-x' }) });
    assert.equal(readViewedWorkspace(s), null);
  });

  it('empty-string project → null', () => {
    const s = fakeStorage({ [VIEWED_WORKSPACE_KEY]: JSON.stringify({ project: '' }) });
    assert.equal(readViewedWorkspace(s), null);
  });

  it('non-object payload → null', () => {
    const s = fakeStorage({ [VIEWED_WORKSPACE_KEY]: JSON.stringify('just a string') });
    assert.equal(readViewedWorkspace(s), null);
  });

  it('clear removes; read after clear → null', () => {
    const s = fakeStorage();
    writeViewedWorkspace({ project: 'p', instanceKey: null, cwd: null, ts: null }, s);
    clearViewedWorkspace(s);
    assert.equal(readViewedWorkspace(s), null);
  });

  it('no storage (null) → read null, write/clear do not throw', () => {
    assert.equal(readViewedWorkspace(null), null);
    assert.doesNotThrow(() => writeViewedWorkspace({ project: 'p' }, null));
    assert.doesNotThrow(() => clearViewedWorkspace(null));
  });

  it('write rejects an entry without a project', () => {
    const s = fakeStorage();
    writeViewedWorkspace({ project: '' }, s);
    writeViewedWorkspace({ instanceKey: 'ccv-x' }, s);
    assert.equal(s._map.has(VIEWED_WORKSPACE_KEY), false);
  });
});

// ─── resolveRestoredViewScope ─────────────────────────────────────────────

describe('resolveRestoredViewScope', () => {
  const live = (processes, currentProject = 'bound', currentInstanceKey = 'ccv-bound') =>
    ({ processes, currentProject, currentInstanceKey });

  it('null saved → null', () => {
    assert.equal(resolveRestoredViewScope(null, live([proc('p', 'ccv-a', '/p')])), null);
  });

  it('saved project with zero matching live rows → null (project gone)', () => {
    const saved = { project: 'gone', instanceKey: 'ccv-a', cwd: '/gone' };
    assert.equal(resolveRestoredViewScope(saved, live([proc('other', 'ccv-b', '/other')])), null);
  });

  it('exact instance alive (different-name project) → restore that instance', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-aaa', cwd: '/proj' };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', 'ccv-aaa', '/proj')]));
    assert.deepEqual(scope, { project: 'proj', instance: 'ccv-aaa' });
  });

  it('exact instance alive among same-name siblings → restore the exact one', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-twin2', cwd: '/dir2' };
    const scope = resolveRestoredViewScope(saved, live([
      proc('proj', 'ccv-twin1', '/dir1'),
      proc('proj', 'ccv-twin2', '/dir2'),
    ], 'bound', 'ccv-bound'));
    assert.deepEqual(scope, { project: 'proj', instance: 'ccv-twin2' });
  });

  it('exact instance that IS the bound project\'s own instance → null (bound view)', () => {
    // The saved scope is just the bound project itself (e.g. the user switched
    // to a parallel view, then back, but an exact-instance entry lingered):
    // restoring it as a "parallel view" would bypass the bound boot path.
    const saved = { project: 'bound', instanceKey: 'ccv-bound', cwd: '/bound' };
    const scope = resolveRestoredViewScope(saved, live([proc('bound', 'ccv-bound', '/bound')], 'bound', 'ccv-bound'));
    assert.equal(scope, null);
  });

  it('same-name SIBLING of the bound instance still restores (guard does not over-fire)', () => {
    // Two same-basename instances: the bound one (ccv-bound) and a twin. The
    // saved scope is the TWIN — a genuine parallel view that must restore.
    const saved = { project: 'bound', instanceKey: 'ccv-twin', cwd: '/bound-twin' };
    const scope = resolveRestoredViewScope(saved, live([
      proc('bound', 'ccv-bound', '/bound'),
      proc('bound', 'ccv-twin', '/bound-twin'),
    ], 'bound', 'ccv-bound'));
    assert.deepEqual(scope, { project: 'bound', instance: 'ccv-twin' });
  });

  it('instance dead + cwd matches a live row with a FRESH instanceKey → re-resolve', () => {
    // Server restarted: the project re-spawned with a new instanceKey.
    const saved = { project: 'proj', instanceKey: 'ccv-old', cwd: '/proj' };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', 'ccv-new', '/proj')]));
    assert.deepEqual(scope, { project: 'proj', instance: 'ccv-new' });
  });

  it('instance dead + cwd matches a live row with NO instanceKey → instance null', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-old', cwd: '/proj' };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', null, '/proj')]));
    assert.deepEqual(scope, { project: 'proj', instance: null });
  });

  it('instance dead + no cwd + exactly one live row (different name) → name-only restore', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-old', cwd: null };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', 'ccv-any', '/proj')], 'bound'));
    assert.deepEqual(scope, { project: 'proj', instance: null });
  });

  it('instance dead + cwd unmatched + one live row (different name) → name-only restore', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-old', cwd: '/elsewhere' };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', 'ccv-any', '/proj')], 'bound'));
    assert.deepEqual(scope, { project: 'proj', instance: null });
  });

  it('instance dead + no cwd + single live row IS the bound name → null (bound view)', () => {
    const saved = { project: 'bound', instanceKey: 'ccv-old', cwd: null };
    const scope = resolveRestoredViewScope(saved, live([proc('bound', 'ccv-bound', '/bound')], 'bound'));
    assert.equal(scope, null);
  });

  it('instance dead + no cwd + TWO same-name live rows → null (never guess)', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-old', cwd: null };
    const scope = resolveRestoredViewScope(saved, live([
      proc('proj', 'ccv-a', '/d1'),
      proc('proj', 'ccv-b', '/d2'),
    ], 'bound'));
    assert.equal(scope, null);
  });

  it('no saved instance + single live row (different name) → restore, instance null', () => {
    const saved = { project: 'proj', instanceKey: null, cwd: null };
    const scope = resolveRestoredViewScope(saved, live([proc('proj', 'ccv-a', '/proj')], 'bound'));
    assert.deepEqual(scope, { project: 'proj', instance: null });
  });

  it('no saved instance + single live row IS the bound name → null', () => {
    const saved = { project: 'bound', instanceKey: null, cwd: null };
    const scope = resolveRestoredViewScope(saved, live([proc('bound', 'ccv-bound', '/bound')], 'bound'));
    assert.equal(scope, null);
  });

  it('no saved instance + two same-name rows → null (ambiguous)', () => {
    const saved = { project: 'proj', instanceKey: null, cwd: null };
    const scope = resolveRestoredViewScope(saved, live([
      proc('proj', 'ccv-a', '/d1'),
      proc('proj', 'ccv-b', '/d2'),
    ], 'bound'));
    assert.equal(scope, null);
  });

  it('tolerates a live payload with missing processes array', () => {
    const saved = { project: 'proj', instanceKey: 'ccv-a', cwd: '/proj' };
    assert.equal(resolveRestoredViewScope(saved, { processes: null, currentProject: 'bound' }), null);
    assert.equal(resolveRestoredViewScope(saved, null), null);
  });
});

// ─── resolveCwdForView ────────────────────────────────────────────────────

describe('resolveCwdForView', () => {
  const tabs = [
    { project: 'proj', instanceKey: 'ccv-a', cwd: '/proj' },
    { project: 'proj', instanceKey: 'ccv-b', cwd: '/proj-twin' },
    { project: 'other', instanceKey: 'ccv-c', cwd: '/other' },
  ];

  it('exact project+instance → that row cwd', () => {
    assert.equal(resolveCwdForView('proj', 'ccv-b', tabs), '/proj-twin');
  });

  it('project-only (null instance) → first matching row cwd', () => {
    assert.equal(resolveCwdForView('other', null, tabs), '/other');
  });

  it('unknown project → null', () => {
    assert.equal(resolveCwdForView('nope', null, tabs), null);
  });

  it('unknown instance → null', () => {
    assert.equal(resolveCwdForView('proj', 'ccv-zzz', tabs), null);
  });

  it('non-array tabs / empty project → null', () => {
    assert.equal(resolveCwdForView('proj', null, null), null);
    assert.equal(resolveCwdForView('', null, tabs), null);
  });
});
