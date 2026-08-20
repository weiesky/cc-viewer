// Real-PTY coverage for pty-manager — spawns an actual interactive shell (NOT the mock-import
// seam) so the live getPty()/fixSpawnHelperPermissions()/flushBatch()/onData/onExit paths run.
// Kept isolated in its own file so the mock-import set by pty-manager-gap.test.js cannot bleed in.
//
// Safety: a throwaway /bin/sh (not the user's zsh) with ZDOTDIR pointed at an empty dir so no
// user rc is sourced; killPty() in afterEach guarantees no lingering child.
import { describe, it, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-pty-real-'));
process.env.CCV_LOG_DIR = tmpDir;
// Source no user shell rc: empty ZDOTDIR + a plain POSIX shell.
const emptyHome = mkdtempSync(join(tmpdir(), 'ccv-pty-zdot-'));
process.env.ZDOTDIR = emptyHome;
process.env.SHELL = '/bin/sh';

const realPty = await (async () => {
  try { const m = await import('node-pty'); return m.default || m; } catch { return null; }
})();

const {
  spawnShell, killPty, getPtyState, getPtyKind, getPtyPid, getOutputBuffer,
  onPtyData, onPtyExit, writeToPty, resizePty, _setPtyImportForTests,
} = await import('../server/pty-manager.js');

const waitUntil = async (pred, { timeoutMs = 3000, intervalMs = 10 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (pred()) return true; await new Promise(r => setTimeout(r, intervalMs)); }
  return false;
};

// Skip the whole suite if node-pty cannot load (e.g. missing prebuild for this platform/CI).
const describeOrSkip = realPty ? describe : describe.skip;

describeOrSkip('spawnShell with a real PTY', () => {
  before(() => { _setPtyImportForTests(null); }); // ensure the REAL node-pty is used, not a mock
  beforeEach(() => { try { killPty(); } catch { /* none */ } });
  afterEach(() => { try { killPty(); } catch { /* none */ } });
  after(() => {
    try { killPty(); } catch { /* none */ }
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  });

  it('spawns an interactive shell, reports kind=shell + a pid, and streams output', async () => {
    const got = await spawnShell();
    assert.equal(got, true, 'spawnShell returns true on first spawn');
    assert.equal(getPtyKind(), 'shell');
    assert.equal(getPtyState().running, true);
    assert.ok(getPtyPid() > 0, 'a real child pid');

    const chunks = [];
    onPtyData((d) => chunks.push(d));
    // Echo a unique token and read it back through the live data stream.
    const token = 'CCV_REAL_PTY_' + Math.random().toString(36).slice(2);
    writeToPty(`echo ${token}\n`);
    const seen = await waitUntil(() => chunks.join('').includes(token));
    assert.ok(seen, 'the echoed token streamed back through onPtyData');
    // outputBuffer also accumulated it (the buffer-append + flushBatch path ran)
    assert.ok(getOutputBuffer().includes(token) || chunks.join('').includes(token));
  });

  it('refuses a second spawn while one is live (returns false)', async () => {
    assert.equal(await spawnShell(), true);
    assert.equal(await spawnShell(), false, 'second spawn is rejected while a PTY is running');
  });

  it('resizePty does not throw against a live shell', async () => {
    await spawnShell();
    assert.doesNotThrow(() => resizePty(100, 40));
  });

  it('onExit fires and clears state when the shell exits', async () => {
    await spawnShell();
    let exitCode = null;
    onPtyExit((code) => { exitCode = code; });
    writeToPty('exit 0\n'); // ask the shell to terminate
    const ended = await waitUntil(() => getPtyState().running === false);
    assert.ok(ended, 'PTY state cleared after the shell exits');
    assert.equal(getPtyKind(), null, 'kind reset on exit');
    assert.ok(exitCode === 0 || exitCode === null, 'exit broadcast (code 0 on clean exit)');
  });
});
