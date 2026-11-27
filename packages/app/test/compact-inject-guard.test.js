/**
 * compact-inject-guard.test.js — unit tests for server/lib/compact-inject-guard.js.
 * Covers per-scope dedup: in-flight occupancy, success window, release/commit/clearSuccess, cross-scope independence, reset.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCompactInjectGuard } from '../server/lib/compact-inject-guard.js';

describe('compact-inject-guard', () => {
  it('first tryBegin acquires the injection right', () => {
    const g = createCompactInjectGuard();
    assert.deepEqual(g.tryBegin('p|i'), { allowed: true });
  });

  it('concurrent request during in-flight occupancy returns inFlight (retryable, not fake success)', () => {
    const g = createCompactInjectGuard();
    g.tryBegin('s', 1000);
    const r = g.tryBegin('s', 1001);
    assert.equal(r.allowed, false);
    assert.equal(r.inFlight, true, 'in-flight should return inFlight rather than duplicate (the lock holder may fail)');
    assert.equal(r.duplicate, undefined);
  });

  it('released immediately after release (busy/failure does not occupy the window)', () => {
    const g = createCompactInjectGuard();
    g.tryBegin('s', 1000);
    g.release('s');
    assert.equal(g.tryBegin('s', 1001).allowed, true);
  });

  it('enters the success window after commit; duplicate inside the window', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    g.tryBegin('s', 1000);
    g.commit('s', 2000);
    assert.equal(g.tryBegin('s', 30000).duplicate, true);   // inside the window
    assert.equal(g.tryBegin('s', 2000 + 60001).allowed, true); // outside the window
  });

  it('clearSuccess clears the success window, allowing the next one', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    g.tryBegin('s', 1000);
    g.commit('s', 2000);
    g.clearSuccess('s');
    assert.equal(g.tryBegin('s', 3000).allowed, true);
  });

  it('scopes are independent of each other', () => {
    const g = createCompactInjectGuard();
    g.tryBegin('a', 1000);
    assert.equal(g.tryBegin('b', 1001).allowed, true);
    assert.equal(g.tryBegin('a', 1001).inFlight, true); // a is in flight, returns inFlight (retryable)
  });

  it('clearProject clears the project-level + all instance-key success windows (PTY turn-end is normalized without instance stamps)', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    // Injection-side keys carry the instance stamp (scopeKeyOf → `proj\0inst`); after turn-end normalization only proj remains.
    g.tryBegin('proj\0ccv-aaa', 1000); g.commit('proj\0ccv-aaa', 2000);
    g.tryBegin('proj\0ccv-bbb', 1000); g.commit('proj\0ccv-bbb', 2000);
    g.tryBegin('other\0ccv-xxx', 1000); g.commit('other\0ccv-xxx', 2000);
    assert.equal(g.tryBegin('proj\0ccv-aaa', 3000).duplicate, true, 'inside window before clear');
    g.clearProject('proj');
    assert.equal(g.tryBegin('proj\0ccv-aaa', 3001).allowed, true, 'proj instance key cleared');
    assert.equal(g.tryBegin('proj\0ccv-bbb', 3001).allowed, true, 'another proj instance key cleared');
    assert.equal(g.tryBegin('other\0ccv-xxx', 3001).duplicate, true, 'other projects unaffected');
  });

  it('clearProject does not false-match projects with the same name prefix (uses \\0 boundary)', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    g.tryBegin('proj2\0ccv-aaa', 1000); g.commit('proj2\0ccv-aaa', 2000);
    g.clearProject('proj'); // 'proj' is a prefix of 'proj2', but the \0 boundary protects it
    assert.equal(g.tryBegin('proj2\0ccv-aaa', 3000).duplicate, true, 'proj2 not mistakenly cleared');
  });

  it('clearProject reclaims fully idle entries (prevents unbounded Map growth)', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    g.tryBegin('proj\0ccv-aaa', 1000); g.commit('proj\0ccv-aaa', 2000); // idle (not in flight)
    g.tryBegin('proj\0ccv-busy', 1000);                                 // in flight (not committed)
    g.clearProject('proj');
    // Idle entry reclaimed: tryBegin again is a brand-new entry (allowed). In-flight entry kept: still returns inFlight.
    assert.equal(g.tryBegin('proj\0ccv-aaa', 3001).allowed, true);
    assert.equal(g.tryBegin('proj\0ccv-busy', 3001).inFlight, true, 'in-flight entry is not reclaimed');
  });

  it('rollback clears both in-flight and the success window (SDK not-delivered optimistic rollback)', () => {
    const g = createCompactInjectGuard({ successWindowMs: 60000 });
    g.tryBegin('s', 1000);
    g.commit('s', 2000);              // optimistic success: enters the 60s window
    assert.equal(g.tryBegin('s', 3000).duplicate, true, 'judged duplicate inside the window');
    g.rollback('s');                  // not-delivered rollback
    assert.equal(g.tryBegin('s', 3001).allowed, true, 'genuine retry allowed immediately after rollback');
  });

  it('rollback does not throw for an unseen scope', () => {
    const g = createCompactInjectGuard();
    g.rollback('never-seen');
    assert.equal(g.tryBegin('never-seen').allowed, true);
  });

  it('empty scopeKey is rejected (badScope)', () => {
    const g = createCompactInjectGuard();
    const r = g.tryBegin('');
    assert.equal(r.allowed, false);
    assert.equal(r.badScope, true);
  });

  it('reset clears everything', () => {
    const g = createCompactInjectGuard();
    g.tryBegin('a', 1000);
    g.commit('a', 2000);
    g.reset();
    assert.equal(g.tryBegin('a', 2001).allowed, true);
  });

  it('clearProject minAgeMs: freshly succeeded windows are kept, old windows released normally', () => {
    const g = createCompactInjectGuard();
    // commit at t=1000; at t=+30s turn_end clears windows (minAgeMs=60s) → too fresh, kept → still duplicate
    g.tryBegin('proj', 1000);
    g.commit('proj', 1000);
    g.clearProject('proj', { minAgeMs: 60000, now: 1000 + 30000 });
    assert.equal(g.tryBegin('proj', 1000 + 31000).duplicate, true, 'fresh success window survives clearProject');
    // clear again at t=+70s (beyond minAgeMs) → released → can inject again
    g.clearProject('proj', { minAgeMs: 60000, now: 1000 + 70000 });
    assert.equal(g.tryBegin('proj', 1000 + 70001).allowed, true, 'aged success window is released');
  });
});
