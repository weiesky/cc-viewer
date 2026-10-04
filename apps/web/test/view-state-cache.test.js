/**
 * Unit tests for src/utils/viewStateCache.js — the per-project view-state
 * cache behind instant multi-project tab switching (snapshot on departure,
 * restore + since-incremental resume on return).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createViewStateCache } from '../src/utils/viewStateCache.js';

const req = (ts, url = '/v1/messages') => ({ timestamp: ts, url, mainAgent: true });
const row = (ts, sessionId = 's1', seq = 1) => ({ timestamp: ts, sessionId, seq });

function mkState({ nReq = 3, ts0 = 1000, withRows = false } = {}) {
  const requests = Array.from({ length: nReq }, (_, i) => req(new Date(ts0 + i * 1000).toISOString()));
  return {
    requests,
    v2Rows: withRows ? [row(new Date(ts0).toISOString(), 's1', 1), row(new Date(ts0 + 2000).toISOString(), 's1', 2)] : [],
    v2RowsMeta: { totalCount: nReq, hasMore: false, oldestTs: '' },
    mainAgentSessions: [{ messages: [], response: null }],
    pinnedSessionTs: 'pin-1',
    selectedIndex: nReq - 1,
  };
}

describe('viewStateCache snapshot/restore', () => {
  it('round-trips a full view state with lastTs + count', () => {
    const c = createViewStateCache();
    const st = mkState({ nReq: 3, ts0: 1000 });
    assert.equal(c.snapshot('projA', st), true);
    const got = c.restore('projA');
    assert.ok(got);
    assert.equal(got.requests.length, 3);
    assert.equal(got.count, 3);
    assert.equal(got.lastTs, new Date(3000).toISOString(), 'lastTs = newest request timestamp');
    assert.equal(got.pinnedSessionTs, 'pin-1');
    assert.equal(got.selectedIndex, 2);
    assert.equal(got.mainAgentSessions.length, 1);
  });

  it('prefers the v2 row tail timestamp over request timestamps', () => {
    const c = createViewStateCache();
    const st = mkState({ nReq: 2, ts0: 1000, withRows: true });
    c.snapshot('p', st);
    const got = c.restore('p');
    assert.equal(got.lastTs, new Date(3000).toISOString(), 'v2 row tail wins (ts0+2000)');
  });

  it('restore returns null for an unknown project; size tracks entries', () => {
    const c = createViewStateCache();
    assert.equal(c.restore('ghost'), null);
    assert.equal(c.size(), 0);
    c.snapshot('a', mkState());
    c.snapshot('b', mkState());
    assert.equal(c.size(), 2);
  });

  it('rejects an empty/missing project key', () => {
    const c = createViewStateCache();
    assert.equal(c.snapshot('', mkState()), false);
    assert.equal(c.snapshot(null, mkState()), false);
    assert.equal(c.size(), 0);
  });

  it('re-snapshotting a project replaces the old entry and refreshes FIFO order', () => {
    const c = createViewStateCache({ maxProjects: 2 });
    c.snapshot('a', mkState({ nReq: 1, ts0: 1000 }));
    c.snapshot('b', mkState({ nReq: 1, ts0: 5000 }));
    // Re-snapshot 'a' → 'b' becomes the oldest; adding 'c' must evict 'b', not 'a'.
    c.snapshot('a', mkState({ nReq: 1, ts0: 9000 }));
    c.snapshot('c', mkState({ nReq: 1, ts0: 12000 }));
    assert.equal(c.restore('b'), null, 'b evicted (oldest after a re-snapshot)');
    assert.ok(c.restore('a'));
    assert.ok(c.restore('c'));
    assert.equal(c.restore('a').lastTs, new Date(9000).toISOString());
  });

  it('FIFO evicts the oldest project beyond maxProjects', () => {
    const c = createViewStateCache({ maxProjects: 3 });
    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) c.snapshot(p, mkState({ nReq: 1 }));
    assert.equal(c.size(), 3);
    assert.equal(c.restore('p1'), null);
    assert.equal(c.restore('p2'), null);
    assert.ok(c.restore('p3'));
    assert.ok(c.restore('p4'));
    assert.ok(c.restore('p5'));
  });

  it('trims requests/rows to the window (tail kept)', () => {
    const c = createViewStateCache({ windowSize: 5 });
    const st = mkState({ nReq: 12, ts0: 1000 });
    c.snapshot('p', st);
    const got = c.restore('p');
    assert.equal(got.requests.length, 5);
    assert.equal(got.lastTs, new Date(12000).toISOString(), 'lastTs still the newest (tail window)');
    assert.equal(got.requests[0].timestamp, new Date(8000).toISOString(), 'head trimmed');
  });

  it('caches a timestamp-less state with lastTs=null (restore ok, no since resume)', () => {
    const c = createViewStateCache();
    c.snapshot('p', { requests: [{ url: '/x' }], v2Rows: [] });
    const got = c.restore('p');
    assert.ok(got);
    assert.equal(got.lastTs, null);
  });

  it('count counts BOTH requests and v2Rows (wireV3 rows-only snapshot must not yield cc=0)', () => {
    const c = createViewStateCache();
    // wireV3 rows-only: requests empty, rows present — lastTs from row tail.
    c.snapshot('p', {
      requests: [],
      v2Rows: [row('2026-10-04T00:00:01Z', 's1', 1), row('2026-10-04T00:00:02Z', 's1', 2)],
    });
    const got = c.restore('p');
    assert.ok(got);
    assert.equal(got.count, 2, 'cc falls back to v2Rows length (cc>0 keeps server incremental alive)');
    assert.equal(got.lastTs, '2026-10-04T00:00:02Z');
    // Symmetric: requests present, rows empty → requests win.
    const c2 = createViewStateCache();
    c2.snapshot('q', { requests: [req('2026-10-04T00:00:05Z')], v2Rows: [] });
    assert.equal(c2.restore('q').count, 1);
  });

  it('invalidate/clear remove entries', () => {
    const c = createViewStateCache();
    c.snapshot('a', mkState());
    c.snapshot('b', mkState());
    c.invalidate('a');
    assert.equal(c.restore('a'), null);
    assert.equal(c.size(), 1);
    c.clear();
    assert.equal(c.size(), 0);
  });

  it('lastTsOf is exposed for standalone use', () => {
    const c = createViewStateCache();
    assert.equal(c.lastTsOf({ requests: [req('2026-01-01T00:00:00.000Z')] }), '2026-01-01T00:00:00.000Z');
    assert.equal(c.lastTsOf(null), null);
    assert.equal(c.lastTsOf({}), null);
  });
});
