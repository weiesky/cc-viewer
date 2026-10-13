/**
 * Per-project view routing (server/lib/v2/view-router.js).
 *
 * Verifies: filterClientsByViewProject keeps the single-project default
 * byte-identical (same array reference) and filters foreign-view clients
 * correctly (unstamped ⇒ bound project); projectOfSessionDir parses the owning
 * project out of a <LOG_DIR>/<projectSan>/sessions/<dir> path and rejects
 * foreign/empty inputs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sep, join } from 'node:path';

import { filterClientsByViewProject, filterClientsByScope, projectOfSessionDir, resolveActivityFeedKey } from '../server/lib/v2/view-router.js';

describe('filterClientsByViewProject', () => {
  const c = (vp) => (vp === undefined ? {} : { _ccvViewProject: vp });

  it('single-project default is byte-identical (same reference, no filter alloc)', () => {
    const clients = [c(), c(), c()];
    const out = filterClientsByViewProject(clients, 'A', 'A');
    assert.equal(out, clients, 'bound project + no foreign viewers → same array reference');
  });

  it('no project → passthrough', () => {
    const clients = [c('A'), c()];
    assert.equal(filterClientsByViewProject(clients, null, 'A'), clients);
    assert.equal(filterClientsByViewProject(clients, undefined, 'A'), clients);
  });

  it('empty client list → []', () => {
    assert.deepEqual(filterClientsByViewProject([], 'A', 'A'), []);
  });

  it('foreign-view filtering: unstamped clients fall to the bound project', () => {
    const a1 = c('A'), b1 = c('B'), un = c(), a2 = c('A');
    const clients = [a1, b1, un, a2];
    // Feed for project A (bound=B): only A-stamped clients.
    const forA = filterClientsByViewProject(clients, 'A', 'B');
    assert.deepEqual(forA, [a1, a2]);
    // Feed for project B (bound=B): the B-stamped client AND the unstamped one
    // (unstamped ⇒ bound = B). Note: a foreign viewer exists, so no fast-path.
    const forB = filterClientsByViewProject(clients, 'B', 'B');
    assert.deepEqual(forB, [b1, un]);
  });

  it('bound feed with a foreign viewer still serves its own + unstamped clients', () => {
    const foreign = c('other'), home = c('A'), un = c();
    const out = filterClientsByViewProject([foreign, home, un], 'A', 'A');
    assert.deepEqual(out, [home, un], 'foreign viewer excluded; unstamped ⇒ bound A');
  });

  it('null entries are dropped without throwing (when filtering actually runs)', () => {
    // Force the non-fast-path (a foreign viewer exists) so .filter executes.
    const foreign = c('other'), home = c('A');
    const out = filterClientsByViewProject([null, home, undefined, foreign], 'A', 'A');
    assert.deepEqual(out, [home], 'null/undefined dropped; foreign viewer excluded');
  });
});

describe('projectOfSessionDir', () => {
  const LOG = join('/', 'root', 'cc-viewer');

  it('parses the owning project from <LOG_DIR>/<projectSan>/sessions/<dir>', () => {
    const dir = join(LOG, 'projB', 'sessions', '20261004_aaaa-bbbb');
    assert.equal(projectOfSessionDir(dir, LOG, sep), 'projB');
  });

  it('handles LOG_DIR with or without a trailing separator', () => {
    const dir = join(LOG, 'projC', 'sessions', 'x');
    assert.equal(projectOfSessionDir(dir, LOG + sep, sep), 'projC');
  });

  it('rejects dirs not under LOG_DIR', () => {
    assert.equal(projectOfSessionDir(join('/', 'elsewhere', 'projB', 'sessions', 'x'), LOG, sep), '');
  });

  it('rejects empty / non-string input', () => {
    assert.equal(projectOfSessionDir('', LOG, sep), '');
    assert.equal(projectOfSessionDir(null, LOG, sep), '');
    assert.equal(projectOfSessionDir(undefined, LOG, sep), '');
    assert.equal(projectOfSessionDir(join(LOG, 'p', 'sessions', 'x'), '', sep), '');
  });

  it('a dir directly under LOG_DIR (no project segment beyond) → the first segment', () => {
    // <LOG_DIR>/<projectSan> itself (no deeper path) still yields the segment.
    assert.equal(projectOfSessionDir(join(LOG, 'projD'), LOG, sep), 'projD');
  });
});

describe('resolveActivityFeedKey (streaming-switch bleed: no-feed-is-drop routing)', () => {
  const LOG = join('/', 'root', 'cc-viewer');

  it('activity under a project root → that project key, bound fallback FORBIDDEN', () => {
    // The core anti-bleed rule: sage's session dir routes to the sage feed key
    // and must NOT fall back to the bound (e.g. finqa) feed when sage has none.
    const dir = join(LOG, 'sage', 'sessions', '20260925_aaaa');
    assert.deepEqual(resolveActivityFeedKey(dir, LOG, sep), { feedKey: 'sage', allowBoundFallback: false });
  });

  it('activity outside every project root → no key, bound fallback ALLOWED (legacy single-project)', () => {
    const dir = join('/', 'somewhere-else', 'sessions', 'x');
    assert.deepEqual(resolveActivityFeedKey(dir, LOG, sep), { feedKey: null, allowBoundFallback: true });
  });

  it('two sibling projects resolve to distinct keys, neither falls back to bound', () => {
    // The exact reproduce shape: server bound to finqa, sage continuation also
    // written by the same server — each activity must keep its own key.
    const sage = resolveActivityFeedKey(join(LOG, 'sage', 'sessions', 's1'), LOG, sep);
    const finqa = resolveActivityFeedKey(join(LOG, 'finqa-remote-cc', 'sessions', 'f1'), LOG, sep);
    assert.deepEqual(sage, { feedKey: 'sage', allowBoundFallback: false });
    assert.deepEqual(finqa, { feedKey: 'finqa-remote-cc', allowBoundFallback: false });
  });
});

describe('filterClientsByScope', () => {
  const c = (vp, vi) => {
    const o = {};
    if (vp !== undefined) o._ccvViewProject = vp;
    if (vi !== undefined) o._ccvViewInstance = vi;
    return o;
  };

  it('reduces to filterClientsByViewProject when instance is unset (same reference)', () => {
    const clients = [c(), c('A'), c('B')];
    const out = filterClientsByScope(clients, 'B', null, 'B');
    assert.deepEqual(out, [clients[0], clients[2]], 'unstamped ⇒ bound B; foreign A excluded');
  });

  it('single-project bound fast path with instance is still reference-identical when nobody is instance-stamped', () => {
    const clients = [c(), c(), c()];
    const out = filterClientsByScope(clients, 'A', 'ccv-aa', 'A');
    assert.equal(out, clients, 'bound project + no instance viewers → same array');
  });

  it('instance narrowing: only the matching instance viewer + unstamped clients kept', () => {
    const instA = c('P', 'ccv-aa'), instB = c('P', 'ccv-bb'), un = c('P'), other = c('Q');
    const clients = [instA, instB, un, other];
    const out = filterClientsByScope(clients, 'P', 'ccv-aa', 'B');
    assert.deepEqual(out, [instA, un], 'different-instance and foreign-project viewers excluded');
  });

  it('frame without instance reaches every instance viewer of the project', () => {
    const instA = c('P', 'ccv-aa'), instB = c('P', 'ccv-bb'), un = c();
    const clients = [instA, instB, un];
    const out = filterClientsByScope(clients, 'P', null, 'P');
    assert.deepEqual(out, [instA, instB, un]);
  });

  it('null entries survive only when no narrowing actually runs', () => {
    // Force filterClientsByViewProject OFF its fast path (a DIFFERENT-project stamp
    // exists) so the project filter's own .filter executes — then null is dropped
    // regardless of narrowing. This pins down that filterClientsByScope adds no
    // null handling of its own beyond the two delegated predicates.
    const instA = c('P', 'ccv-aa');
    const clients = [null, instA, c('Q')];
    assert.deepEqual(filterClientsByScope(clients, 'P', null, 'P'), [instA]);
    assert.deepEqual(filterClientsByScope(clients, 'P', 'ccv-aa', 'P'), [instA]);
  });
});
