// Unit tests for server/lib/shell-hook-inspect.js (L1): read-only hook state probe.
// English comments only (CLAUDE.md).
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The inspector resolves rc files from homedir(); tests steer HOME to a private tmpdir
// BEFORE importing the module (homedir() is read at call time, so env steering works).
const tmpHome = mkdtempSync(join(tmpdir(), 'ccv-hook-inspect-'));
const origHome = process.env.HOME;
process.env.HOME = tmpHome;

const { inspectShellHook, SHELL_HOOK_START, SHELL_HOOK_END } = await import('../server/lib/shell-hook-inspect.js');

const HOOK_V1 = `${SHELL_HOOK_START}\nclaude() { ccv run -- claude --ccv-internal "$@"; }\n${SHELL_HOOK_END}`;
const HOOK_V2 = `${SHELL_HOOK_START}\nclaude() { ccv run -- claude --ccv-internal "$@"; } # v2\n${SHELL_HOOK_END}`;

afterEach(() => {
  for (const f of ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']) {
    try { rmSync(join(tmpHome, f), { force: true }); } catch { }
  }
});

describe('inspectShellHook', () => {
  it('no rc files → not installed', () => {
    const r = inspectShellHook(null);
    assert.equal(r.installed, false);
    assert.equal(r.path, null);
    assert.equal(r.stale, false);
    assert.equal(r.corrupt, null);
  });

  it('hook marker in any candidate rc → installed, path reported', () => {
    writeFileSync(join(tmpHome, '.zshrc'), `export PATH=/x\n\n${HOOK_V1}\n`);
    const r = inspectShellHook(null);
    assert.equal(r.installed, true);
    assert.equal(r.path, join(tmpHome, '.zshrc'));
  });

  it('stale detection: block differing from BOTH templates → stale=true', () => {
    writeFileSync(join(tmpHome, '.zshrc'), `${HOOK_V1}\n`);
    const build = (isNative) => (isNative ? HOOK_V2 : HOOK_V2);
    const r = inspectShellHook(build);
    assert.equal(r.installed, true);
    assert.equal(r.stale, true);
  });

  it('either template matching (npm OR native) → not stale', () => {
    writeFileSync(join(tmpHome, '.zshrc'), `${HOOK_V1}\n`);
    const build = (isNative) => (isNative ? HOOK_V2 : HOOK_V1); // npm template matches
    const r = inspectShellHook(build);
    assert.equal(r.stale, false);
  });

  it('START marker without a complete block → corrupt path reported, not installed', () => {
    writeFileSync(join(tmpHome, '.bashrc'), `${SHELL_HOOK_START}\nclaude() { broken\n`);
    const r = inspectShellHook(null);
    assert.equal(r.installed, false);
    assert.equal(r.corrupt, join(tmpHome, '.bashrc'));
  });

  it('hook in a secondary candidate (old shell rc) still counts as installed', () => {
    writeFileSync(join(tmpHome, '.profile'), `${HOOK_V1}\n`);
    const r = inspectShellHook(null);
    assert.equal(r.installed, true);
    assert.equal(r.path, join(tmpHome, '.profile'));
  });
});

after(() => {
  process.env.HOME = origHome;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { }
});
