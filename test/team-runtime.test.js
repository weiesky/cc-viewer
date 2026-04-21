import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTeamRuntime, checkTeamsRuntime } from '../lib/team-runtime.js';

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ccv-team-runtime-'));
});

after(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

function setupTeamDir(name, { inboxMessages = null, inboxMtimeMs = null } = {}) {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  if (inboxMessages !== null) {
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    const file = join(inbox, 'worker.json');
    writeFileSync(file, JSON.stringify(inboxMessages));
    if (inboxMtimeMs !== null) {
      const secs = inboxMtimeMs / 1000;
      utimesSync(file, secs, secs);
    }
  }
  return dir;
}

describe('checkTeamRuntime', () => {

  it('T1: directory does not exist → dead', async () => {
    const res = await checkTeamRuntime('never-existed', null, sandbox);
    assert.equal(res.state, 'dead');
  });

  it('T2: dir exists, no inboxes subdir → residue', async () => {
    setupTeamDir('no-inbox');
    const res = await checkTeamRuntime('no-inbox', null, sandbox);
    assert.equal(res.state, 'residue');
    assert.equal(res.lastInboxMtime, 0);
  });

  it('T3: dir + inbox recently written (<10min) → possiblyAlive', async () => {
    setupTeamDir('active', { inboxMessages: [], inboxMtimeMs: Date.now() - 60_000 });
    const res = await checkTeamRuntime('active', null, sandbox);
    assert.equal(res.state, 'possiblyAlive');
    assert.ok(res.lastInboxMtime > 0);
  });

  it('T4: dir + inbox mtime is old (>30min) → residue', async () => {
    setupTeamDir('old', { inboxMessages: [], inboxMtimeMs: Date.now() - 45 * 60_000 });
    const res = await checkTeamRuntime('old', null, sandbox);
    assert.equal(res.state, 'residue');
    assert.ok(res.lastInboxMtime > 0);
  });

  it('T5: birthtime newer than endTime+5min → reused', async () => {
    setupTeamDir('reused');
    const endTimeMs = Date.now() - 60 * 60_000; // 1 hour ago
    const res = await checkTeamRuntime('reused', endTimeMs, sandbox);
    // dir was just created, so birthMs ≈ now >> endTimeMs + 5min
    assert.equal(res.state, 'reused');
  });

  it('T6: invalid name → error', async () => {
    const res = await checkTeamRuntime(null, null, sandbox);
    assert.equal(res.state, 'error');
    const res2 = await checkTeamRuntime('', null, sandbox);
    assert.equal(res2.state, 'error');
  });

  it('T7: checkTeamsRuntime batches multiple teams', async () => {
    setupTeamDir('batch-a', { inboxMessages: [], inboxMtimeMs: Date.now() - 60_000 });
    const res = await checkTeamsRuntime([
      { name: 'batch-a' },
      { name: 'never-existed' },
    ], sandbox);
    assert.equal(res['batch-a'].state, 'possiblyAlive');
    assert.equal(res['never-existed'].state, 'dead');
  });

  it('T8: checkTeamsRuntime handles ISO-string endTime', async () => {
    setupTeamDir('iso-end');
    const endTime = new Date(Date.now() - 60 * 60_000).toISOString();
    const res = await checkTeamsRuntime([{ name: 'iso-end', endTime }], sandbox);
    // birthMs > endTime + 5min → reused
    assert.equal(res['iso-end'].state, 'reused');
  });

  it('T9: "." / ".." as name → error invalid_name (not ENOENT/path traversal)', async () => {
    assert.equal((await checkTeamRuntime('.', null, sandbox)).state, 'error');
    assert.equal((await checkTeamRuntime('..', null, sandbox)).state, 'error');
    assert.equal((await checkTeamRuntime('../outside', null, sandbox)).state, 'error');
  });

  it('T10: symlink team dir → rejected with error', async () => {
    // Create a target dir outside of sandbox to be sure no traversal
    const target = mkdtempSync(join(tmpdir(), 'ccv-symlink-target-'));
    try {
      const linkPath = join(sandbox, 'symlink-team');
      try { symlinkSync(target, linkPath); } catch (err) {
        // 某些文件系统不支持 symlink；跳过
        if (err.code === 'EPERM' || err.code === 'EACCES') return;
        throw err;
      }
      const res = await checkTeamRuntime('symlink-team', null, sandbox);
      assert.equal(res.state, 'error');
      assert.equal(res.error, 'symlink_rejected');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('T11: file (not directory) at team path → error not_a_directory', async () => {
    writeFileSync(join(sandbox, 'file-not-dir'), 'x');
    const res = await checkTeamRuntime('file-not-dir', null, sandbox);
    assert.equal(res.state, 'error');
    assert.equal(res.error, 'not_a_directory');
  });
});
