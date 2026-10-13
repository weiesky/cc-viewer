/**
 * resolveInstanceForCwd — hook-scope instance upgrade (2026-10).
 *
 * A hook payload carrying only cwd degrades to project-level scope (instance=
 * null ⇒ every project viewer receives the frame — the same-cwd twin over-
 * delivery). The resolver upgrades to the exact instance ONLY when exactly
 * one live record owns the cwd; twins/none stay project-level.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PTY_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../server/pty-manager.js'), 'utf8');
const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');

describe('resolveInstanceForCwd (source contract)', () => {
  it('is exported and live-gated (dead records never claim a scope)', () => {
    assert.ok(/export function resolveInstanceForCwd\(cwd\) \{/.test(PTY_SRC), 'exported');
    assert.ok(
      /if \(!rec \|\| !rec\.ptyProcess\) continue; \/\/ LIVE only/.test(PTY_SRC),
      'dead records skipped (the corpse-scope guard)',
    );
  });

  it('returns null on a second live twin (ambiguous ⇒ project-level kept)', () => {
    assert.ok(
      /if \(found !== null\) return null; \/\/ a second live twin/.test(PTY_SRC),
      'ambiguity ⇒ null',
    );
  });

  it('matches on the lexical-normalized persistent cwd (never realpath)', () => {
    assert.ok(/normalizeSessionCwd\(cwd\)/.test(PTY_SRC), 'hook cwd normalized');
    assert.ok(/const recCwd = rec\.cwd \|\| null;/.test(PTY_SRC), 'record persistent cwd, same path space');
  });
});

describe('resolver cwd→instance upgrade (server.js source contract)', () => {
  it('the cwd branch upgrades scope with resolveInstanceForCwd when unambiguous', () => {
    assert.ok(
      /const inst = pm && typeof pm\.resolveInstanceForCwd === 'function' \? pm\.resolveInstanceForCwd\(cwd\) : null;/.test(SERVER_SRC),
      'cwd branch resolves the instance',
    );
    assert.ok(
      /return normalizeProducerScope\(\{ project: proj, instance: inst \}, _projectName \|\| ''\);/.test(SERVER_SRC),
      'scope carries the resolved instance',
    );
  });

  it('precedence is still sid → cwd → bound (sid first)', () => {
    assert.ok(
      /resolvePtyForSession\(sid\)[\s\S]*?projectKeyForCwd\(cwd\)[\s\S]*?return \{ project: '', instance: null \};/.test(SERVER_SRC),
      'sid resolution precedes the cwd fallback',
    );
  });
});
