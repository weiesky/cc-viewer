/**
 * Unit tests for the framework-independent helpers of markdownProfiler.js.
 *
 * `percentile` and `createStats` are pure and safe to import in Node:
 * the module-level `DEV = import.meta.env?.DEV === true` check short-circuits
 * to false in a `node --test` run (no Vite env), so no side effects fire.
 *
 * The side-effectful entry points (`measureParse`, `recordMountSample`,
 * `DEV_PROFILER_ENABLED`) depend on `import.meta.env.DEV` being true and
 * `window` being present, and are only exercised in a real dev browser
 * session — which is by design for a dev-only instrumentation module.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, createStats } from '../src/utils/markdownProfiler.js';

const MAX_SAMPLES = 2000;

// ─── percentile ──────────────────────────────────────────────────────────────

describe('percentile', () => {
  it('returns 0 on an empty array', () => {
    assert.equal(percentile([], 0.5), 0);
    assert.equal(percentile([], 0.95), 0);
  });

  it('returns the only element for a single-element array', () => {
    assert.equal(percentile([42], 0), 42);
    assert.equal(percentile([42], 0.5), 42);
    assert.equal(percentile([42], 1), 42);
  });

  it('computes p50 on a sorted ten-element array', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(s, 0.5), 6); // floor(10 * 0.5) = 5 → s[5] = 6
  });

  it('computes p95 on a sorted ten-element array', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(s, 0.95), 10); // floor(10 * 0.95) = 9 → s[9] = 10
  });

  it('p=1 never overflows the array', () => {
    const s = [1, 2, 3];
    assert.equal(percentile(s, 1), 3); // clamped to last index
  });

  it('assumes caller has sorted the input', () => {
    // contract: percentile expects sorted input; verifies we do not silently
    // mask a caller bug by internally sorting.
    const unsorted = [10, 3, 7, 1, 5];
    // floor(5 * 0.5) = 2 → raw index 2 → value 7 (not the true median 5)
    assert.equal(percentile(unsorted, 0.5), 7);
  });
});

// ─── createStats — bounded arrays ────────────────────────────────────────────

describe('createStats — bounded samples', () => {
  it('starts with empty samples and zero counts', () => {
    const s = createStats();
    assert.deepEqual(s.samples.parse, []);
    assert.deepEqual(s.samples.mount, []);
    assert.deepEqual(s.summary(), {
      parseN: 0, parseP50: 0, parseP95: 0, parseMax: 0,
      mountN: 0, mountP50: 0, mountP95: 0, mountMax: 0,
    });
  });

  it('caps parse samples at MAX_SAMPLES and drops oldest first', () => {
    const s = createStats();
    for (let i = 0; i < MAX_SAMPLES + 5; i++) s.recordParse(i);
    assert.equal(s.samples.parse.length, MAX_SAMPLES);
    // oldest five values (0..4) should have been dropped
    assert.equal(s.samples.parse[0], 5);
    assert.equal(s.samples.parse[MAX_SAMPLES - 1], MAX_SAMPLES + 4);
  });

  it('caps mount samples independently from parse', () => {
    const s = createStats();
    for (let i = 0; i < MAX_SAMPLES + 1; i++) s.recordMount(i);
    assert.equal(s.samples.mount.length, MAX_SAMPLES);
    assert.equal(s.samples.parse.length, 0);
  });
});

// ─── createStats — summary ───────────────────────────────────────────────────

describe('createStats — summary', () => {
  it('reports correct P50/P95/max over recorded samples', () => {
    const s = createStats();
    for (let i = 1; i <= 100; i++) s.recordParse(i);
    const sum = s.summary();
    assert.equal(sum.parseN, 100);
    // floor(100 * 0.5) = 50 → sorted[50] = 51
    assert.equal(sum.parseP50, 51);
    // floor(100 * 0.95) = 95 → sorted[95] = 96
    assert.equal(sum.parseP95, 96);
    assert.equal(sum.parseMax, 100);
  });

  it('separates parse vs. mount samples', () => {
    const s = createStats();
    s.recordParse(1);
    s.recordParse(2);
    s.recordMount(10);
    const sum = s.summary();
    assert.equal(sum.parseN, 2);
    assert.equal(sum.mountN, 1);
    assert.equal(sum.mountP50, 10);
  });

  it('does not mutate the backing arrays when summarizing', () => {
    const s = createStats();
    s.recordParse(3);
    s.recordParse(1);
    s.recordParse(2);
    s.summary();
    assert.deepEqual(s.samples.parse, [3, 1, 2]);
  });
});

// ─── createStats — reset ─────────────────────────────────────────────────────

describe('createStats — reset', () => {
  it('clears both sample arrays', () => {
    const s = createStats();
    s.recordParse(1);
    s.recordMount(2);
    s.reset();
    assert.deepEqual(s.samples.parse, []);
    assert.deepEqual(s.samples.mount, []);
  });

  it('summary after reset reports zeros', () => {
    const s = createStats();
    for (let i = 0; i < 50; i++) { s.recordParse(i); s.recordMount(i); }
    s.reset();
    const sum = s.summary();
    assert.equal(sum.parseN, 0);
    assert.equal(sum.mountN, 0);
    assert.equal(sum.parseP95, 0);
  });
});
