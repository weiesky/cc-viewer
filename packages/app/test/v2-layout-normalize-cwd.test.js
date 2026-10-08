/**
 * normalizeSessionCwd (server/lib/v2/layout.js) — direct unit tests (2026-10-07).
 *
 * The cross-dir same-basename isolation comparison rests entirely on this one
 * lexical normalizer being applied symmetrically on the write (meta.cwd stamp),
 * read-candidate, and read-target sides — so pin its exact behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { normalizeSessionCwd } from '../server/lib/v2/layout.js';

describe('normalizeSessionCwd', () => {
  it('collapses `.`/`..` and duplicate separators lexically', () => {
    assert.equal(normalizeSessionCwd('/a/./proj'), '/a/proj');
    assert.equal(normalizeSessionCwd('/a//proj'), '/a/proj');
    assert.equal(normalizeSessionCwd('/a/b/../proj'), '/a/proj');
  });

  it('strips a trailing separator (idempotent via resolve)', () => {
    assert.equal(normalizeSessionCwd('/a/proj/'), '/a/proj');
    assert.equal(normalizeSessionCwd('/a/proj//'), '/a/proj');
  });

  it('returns "" for empty / non-string input', () => {
    assert.equal(normalizeSessionCwd(''), '');
    assert.equal(normalizeSessionCwd(null), '');
    assert.equal(normalizeSessionCwd(undefined), '');
    assert.equal(normalizeSessionCwd(0), '');
  });

  it('keeps the filesystem root as-is', () => {
    assert.equal(normalizeSessionCwd('/'), '/');
  });

  it('is absolute-path deterministic and symmetric (write vs read)', () => {
    // Both sides feed the SAME absolute spawn cwd → identical output (the byte-equality
    // the same-name fallback filter relies on).
    const cwd = '/a/proj';
    assert.equal(normalizeSessionCwd(cwd), normalizeSessionCwd(cwd));
    // A relative input resolves against process.cwd() — deterministic, never throws.
    assert.equal(normalizeSessionCwd('proj'), resolve('proj'));
  });
});
