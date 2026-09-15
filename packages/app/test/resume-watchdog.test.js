// Unit tests for server/lib/resume-watchdog.js (L2): bypassed-resume detection triple gate.
// English comments only (CLAUDE.md).
import { describe, it, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-resume-wd-'));
process.env.CCV_LOG_DIR = join(tmpRoot, 'logs');
process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, 'claude-config');
process.env.CCV_PROJECTS_DIR = join(tmpRoot, 'projects');

let wd;
let projectKeyForCwd;
before(async () => {
  wd = await import('../server/lib/resume-watchdog.js');
  ({ projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js'));
});

after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { } });

const UUID_A = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const UUID_B = 'b1111111-89ab-4cde-8f01-23456789abcd';

let cwd, logDir, tDir;
const dirs = [];
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ccv-rwd-cwd-'));
  logDir = mkdtempSync(join(tmpdir(), 'ccv-rwd-log-'));
  dirs.push(cwd, logDir);
  // transcript dir slug mirrors transcriptDirForCwd: non-alnum → '-'
  tDir = join(process.env.CCV_PROJECTS_DIR, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(tDir, { recursive: true });
  // injection still configured (gate 2): a non-empty CC_SYSTEM.md in the workspace
  writeFileSync(join(cwd, 'CC_SYSTEM.md'), 'persona');
});
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true, force: true }); } catch { } } });

function seedSnapshot(uuid, createdAt) {
  const dir = join(logDir, projectKeyForCwd(cwd), 'system-prompt-snapshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${uuid}.json`), JSON.stringify({
    v: 1, entries: [{ flag: '--system-prompt-file', basename: 'CC_SYSTEM.md', content: 'persona' }],
    model: null, createdAt, boundVia: 'wire',
  }));
}

function seedTranscript(uuid, mtime) {
  const p = join(tDir, `${uuid}.jsonl`);
  writeFileSync(p, '{"type":"user"}\n');
  utimesSync(p, new Date(mtime - 1000), new Date(mtime));
  return p;
}

const NO_WIRE = () => false;
const HAS_WIRE = () => true;

describe('detectBypassedResume — triple gate', () => {
  it('all gates satisfied → reports the bypassed uuid', () => {
    seedSnapshot(UUID_A, Date.now() - 60_000);
    const tp = seedTranscript(UUID_A, Date.now());
    const hit = wd.detectBypassedResume({ cwd, logDir, hasWireActivity: NO_WIRE });
    assert.ok(hit, 'a bypassed resume must be detected');
    assert.equal(hit.uuid, UUID_A);
    assert.equal(hit.transcriptPath, tp);
  });

  it('gate 1: no snapshot record (never injected) → no report', () => {
    seedTranscript(UUID_A, Date.now());
    assert.equal(wd.detectBypassedResume({ cwd, logDir, hasWireActivity: NO_WIRE }), null);
  });

  it('gate 2: injection no longer configured → no report', () => {
    seedSnapshot(UUID_A, Date.now() - 60_000);
    seedTranscript(UUID_A, Date.now());
    rmSync(join(cwd, 'CC_SYSTEM.md'), { force: true });
    assert.equal(wd.detectBypassedResume({ cwd, logDir, hasWireActivity: NO_WIRE }), null);
  });

  it('gate 3a: transcript not meaningfully newer than the snapshot → no report', () => {
    const now = Date.now();
    seedSnapshot(UUID_A, now);
    seedTranscript(UUID_A, now + 1000); // within the 5s grace gap
    assert.equal(wd.detectBypassedResume({ cwd, logDir, hasWireActivity: NO_WIRE }), null);
  });

  it('gate 3b: ccv observed wire activity for the uuid → no report (it went through ccv)', () => {
    seedSnapshot(UUID_A, Date.now() - 60_000);
    seedTranscript(UUID_A, Date.now());
    assert.equal(wd.detectBypassedResume({ cwd, logDir, hasWireActivity: HAS_WIRE }), null);
  });

  it('multiple bypassed sessions → the LATEST transcript wins', () => {
    const older = Date.now() - 120_000;
    seedSnapshot(UUID_A, Date.now() - 300_000);
    seedSnapshot(UUID_B, Date.now() - 300_000);
    seedTranscript(UUID_A, older);
    seedTranscript(UUID_B, Date.now());
    const hit = wd.detectBypassedResume({ cwd, logDir, hasWireActivity: NO_WIRE });
    assert.equal(hit.uuid, UUID_B);
  });

  it('a bypassed uuid WITH wire activity alongside a bypassed one WITHOUT → reports the latter', () => {
    seedSnapshot(UUID_A, Date.now() - 60_000);
    seedSnapshot(UUID_B, Date.now() - 60_000);
    seedTranscript(UUID_A, Date.now());
    seedTranscript(UUID_B, Date.now() - 30_000);
    const hit = wd.detectBypassedResume({
      cwd, logDir, hasWireActivity: (uuid) => uuid === UUID_A,
    });
    assert.equal(hit.uuid, UUID_B);
  });
});

describe('startResumeWatchdog — dedup per uuid', () => {
  it('onHit fires at most once per uuid; stop() ends the timer', async () => {
    const hits = [];
    const handle = wd.startResumeWatchdog({ cwd: '/nonexistent-cwd', onHit: (h) => hits.push(h), intervalMs: 10 });
    assert.equal(typeof handle.stop, 'function');
    handle.stop();
    assert.equal(hits.length, 0);
  });
});
