import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateLogPath, readLocalLog, deleteLogFiles, isLogFileName, parseLogTs, listLocalLogs, LIVE_SESSION_MTIME_MS,
} from '../server/lib/log-management.js';

let tmpDir;

function makeEntry(ts, url, mainAgent = true) {
  return JSON.stringify({ timestamp: ts, url, mainAgent, body: { model: 'test' } });
}

function writeLog(dir, project, filename, entries) {
  const projectDir = join(dir, project);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, filename), entries.join('\n---\n') + '\n---\n');
}

/** Minimal hand-written v2 session dir (meta + journal + main conversation). */
function makeV2Session(dir, project, sid, { pid = 1, startTs = '2026-01-01T12:00:00.000Z' } = {}) {
  const sessionDir = join(dir, project, 'sessions', sid);
  mkdirSync(join(sessionDir, 'conversations', 'main'), { recursive: true });
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid, startTs }));
  writeFileSync(join(sessionDir, 'journal.jsonl'), [
    JSON.stringify({ ph: 'meta', wireFormat: 2 }),
    JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', ts: startTs, kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', method: 'POST', model: 'm', msgFrom: 0, msgTo: 1, evt: 'snapshot' }),
    JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok' }),
  ].join('\n') + '\n');
  writeFileSync(join(sessionDir, 'conversations', 'main', 'e0.jsonl'),
    JSON.stringify({ seq: 1, rid: 'r1', t: 'snapshot', msgs: [{ role: 'user', content: [{ type: 'text', text: 'first prompt' }] }] }) + '\n');
  return sessionDir;
}

/** Age a session's journal so the mtime liveness guard sees it as stale. */
function ageJournal(sessionDir, ageMs = LIVE_SESSION_MTIME_MS + 60_000) {
  const old = (Date.now() - ageMs) / 1000;
  utimesSync(join(sessionDir, 'journal.jsonl'), old, old);
}

/** The YYYYMMDD stamp deleteLogFiles derives from its `now` option. */
function stampOf(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// A processKill stub whose target pid is always gone (dead-owner default for tests).
const pidDead = () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-logmgmt-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateLogPath', () => {
  it('returns real path for valid file', () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_120000.jsonl', [makeEntry('t1', 'u1')]);
    const p = validateLogPath(tmpDir, 'proj/proj_20260601_120000.jsonl');
    assert.ok(p.endsWith('proj_20260601_120000.jsonl'));
  });

  it('throws NOT_FOUND for missing file', () => {
    assert.throws(() => validateLogPath(tmpDir, 'nope/nope.jsonl'), (e) => e.code === 'NOT_FOUND');
  });
});

describe('isLogFileName / parseLogTs', () => {
  it('never accepts legacy .jsonl.zip archives (zip support removed 2026-07-14)', () => {
    assert.equal(isLogFileName('proj_20260601_100000.jsonl.zip'), false);
    assert.equal(parseLogTs('proj_20260601_100000.jsonl.zip'), '');
    assert.equal(isLogFileName('proj_20260601_100000.jsonl'), true);
    assert.equal(parseLogTs('proj_20260601_100000.jsonl'), '20260601_100000');
    assert.equal(parseLogTs('123__proj_20260601_100000.jsonl'), '20260601_100000');
  });
});

describe('listLocalLogs (1.7.0 v1 view)', () => {
  it('lists every timestamped v1 file, including legacy pid-prefixed names, newest first', async () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_120000.jsonl', [makeEntry('t1', 'u1')]);
    writeLog(tmpDir, 'proj', '999__proj_20260702_090000.jsonl', [makeEntry('t2', 'u2')]);
    const out = await listLocalLogs(tmpDir, 'proj');
    assert.equal(out._currentProject, 'proj');
    assert.equal(out.proj.length, 2, 'legacy pid-prefixed files are listed too (instance concept gone)');
    assert.equal(out.proj[0].file, 'proj/999__proj_20260702_090000.jsonl', 'sorted by timestamp desc');
    assert.equal(out.proj[0].timestamp, '20260702_090000');
    assert.ok(out.proj.every((x) => typeof x.size === 'number' && x.size > 0));
    assert.ok(out.proj.every((x) => !('instanceId' in x)), 'no instanceId field emitted');
  });

  it('excludes _temp / non-timestamped / empty files', async () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_120000.jsonl', [makeEntry('t1', 'u1')]);
    writeLog(tmpDir, 'proj', 'proj_20260601_130000_temp.jsonl', [makeEntry('t', 'u')]);
    writeFileSync(join(tmpDir, 'proj', 'notes.jsonl'), '{}');           // no timestamp
    writeFileSync(join(tmpDir, 'proj', 'proj_20260601_140000.jsonl'), ''); // empty
    const out = await listLocalLogs(tmpDir, 'proj');
    assert.deepEqual(out.proj.map((x) => x.file), ['proj/proj_20260601_120000.jsonl']);
  });

  it('takes turns/preview from a pre-1.7 stats file; corrupt stats are tolerated', async () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_120000.jsonl', [makeEntry('t1', 'u1')]);
    writeFileSync(join(tmpDir, 'proj', 'proj.json'), JSON.stringify({
      files: { 'proj_20260601_120000.jsonl': { summary: { sessionCount: 3 }, preview: ['hello'] } },
    }));
    const withStats = await listLocalLogs(tmpDir, 'proj');
    assert.equal(withStats.proj[0].turns, 3);
    assert.deepEqual(withStats.proj[0].preview, ['hello']);

    writeFileSync(join(tmpDir, 'proj', 'proj.json'), '{corrupt');
    const corrupt = await listLocalLogs(tmpDir, 'proj');
    assert.equal(corrupt.proj[0].turns, 0, 'stats are cosmetic — corrupt file degrades gracefully');
    assert.deepEqual(corrupt.proj[0].preview, []);
  });

  it('missing logDir → only _currentProject; sessions/ dirs are never listed here', async () => {
    const missing = await listLocalLogs(join(tmpDir, 'nope'), 'x');
    assert.deepEqual(missing, { _currentProject: 'x' });
    makeV2Session(tmpDir, 'proj', 'aaaa1111-2222-4333-8444-bbbb5555cccc');
    const out = await listLocalLogs(tmpDir, 'proj');
    assert.ok(!out.proj, 'v2 session dirs contribute no v1 rows');
  });
});

describe('readLocalLog', () => {
  it('reads and deduplicates entries', async () => {
    const e1 = makeEntry('2026-06-01T00:00:00Z', 'http://api/v1/messages');
    const e2 = makeEntry('2026-06-01T00:00:01Z', 'http://api/v1/messages');
    writeLog(tmpDir, 'proj', 'proj_20260601_100000.jsonl', [e1, e2, e1]);
    const entries = await readLocalLog(tmpDir, 'proj/proj_20260601_100000.jsonl');
    assert.equal(entries.length, 2);
  });

  it('throws for path traversal', async () => {
    await assert.rejects(
      () => readLocalLog(tmpDir, '../etc/passwd'),
      (e) => e.code === 'NOT_FOUND' || e.code === 'ACCESS_DENIED'
    );
  });
});

// ─────────────────── deleteLogFiles (soft delete, 1.7.0) ───────────────────
// Nothing is ever unlinked: v2 session dirs are renamed into the project's
// sessions-removed-<YYYYMMDD>/ recycle dir, legacy .jsonl into removed-<date>/.
describe('deleteLogFiles v2 soft delete', () => {
  const SID = 'aaaa1111-2222-4333-8444-bbbb55550001';
  // Freeze "now" so the recycle-dir date stamp is deterministic in assertions.
  const NOW = Date.now();
  const now = () => NOW;

  it('moves the session dir into sessions-removed-<date>/, content intact', () => {
    const sessionDir = makeV2Session(tmpDir, 'proj', SID);
    ageJournal(sessionDir);
    const journalBefore = readFileSync(join(sessionDir, 'journal.jsonl'), 'utf-8');

    const results = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], { now, processKill: pidDead });
    assert.equal(results[0].ok, true);
    const expected = join(tmpDir, 'proj', `sessions-removed-${stampOf(NOW)}`, SID);
    assert.equal(results[0].movedTo, expected);
    // Original location gone, nothing unlinked: full tree moved intact.
    assert.equal(existsSync(sessionDir), false);
    assert.equal(readFileSync(join(expected, 'journal.jsonl'), 'utf-8'), journalBefore);
    assert.equal(existsSync(join(expected, 'meta.json')), true);
    assert.equal(existsSync(join(expected, 'conversations', 'main', 'e0.jsonl')), true);
    // sessions/ itself survives, just emptied of this sid.
    assert.deepEqual(readdirSync(join(tmpDir, 'proj', 'sessions')), []);
  });

  it('suffixes the target on recycle-dir collision instead of overwriting', () => {
    const first = makeV2Session(tmpDir, 'proj', SID);
    ageJournal(first);
    const r1 = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], { now, processKill: pidDead });
    assert.equal(r1[0].ok, true);
    // Same sid comes back (restore + re-delete scenario) — must not clobber.
    const second = makeV2Session(tmpDir, 'proj', SID);
    ageJournal(second);
    const r2 = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], { now, processKill: pidDead });
    assert.equal(r2[0].ok, true);
    assert.notEqual(r2[0].movedTo, r1[0].movedTo);
    assert.equal(r2[0].movedTo, `${r1[0].movedTo}-${NOW}`);
    assert.equal(existsSync(r1[0].movedTo), true, 'first recycle entry untouched');
    assert.equal(existsSync(r2[0].movedTo), true);
  });

  it('refuses the caller\'s own live session (liveSessionDir match)', () => {
    const sessionDir = makeV2Session(tmpDir, 'proj', SID);
    ageJournal(sessionDir); // stale mtime + dead pid: only the liveSessionDir guard fires
    const results = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], {
      now, processKill: pidDead, liveSessionDir: sessionDir,
    });
    assert.equal(results[0].ok, undefined);
    assert.match(results[0].error, /live/i);
    assert.equal(existsSync(sessionDir), true, 'live session must stay in place');
  });

  it('refuses when meta.pid belongs to a running process', () => {
    const sessionDir = makeV2Session(tmpDir, 'proj', SID, { pid: 424242 });
    ageJournal(sessionDir); // stale mtime: only the pid guard fires
    const seen = [];
    const results = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], {
      now, processKill: (pid) => { seen.push(pid); /* no throw = alive */ },
    });
    assert.deepEqual(seen, [424242], 'liveness probe hits meta.pid');
    assert.match(results[0].error, /live/i);
    assert.equal(existsSync(sessionDir), true);
  });

  it('refuses when the journal mtime is fresh (< LIVE_SESSION_MTIME_MS)', () => {
    const sessionDir = makeV2Session(tmpDir, 'proj', SID);
    // Journal was just written; dead pid, no liveSessionDir — mtime guard alone fires.
    const results = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], { now: Date.now, processKill: pidDead });
    assert.match(results[0].error, /live/i);
    assert.equal(existsSync(sessionDir), true);
  });

  it('skips the pid probe for our own pid (own crashed-and-restarted session is deletable)', () => {
    const sessionDir = makeV2Session(tmpDir, 'proj', SID, { pid: process.pid });
    ageJournal(sessionDir);
    // processKill would report "alive" — but it must never be consulted for process.pid.
    const results = deleteLogFiles(tmpDir, [`v2:proj/${SID}`], { now, processKill: () => {} });
    assert.equal(results[0].ok, true);
  });

  it('reports Not found for a missing session and rejects malformed v2 refs', () => {
    const results = deleteLogFiles(tmpDir, [
      `v2:proj/${SID}`,            // well-formed but nonexistent
      'v2:../evil/x',              // traversal — never parses as v2, fails legacy name check too
      'v2:proj/..',                // dot component rejected by sanitizePathComponent
    ], { now, processKill: pidDead });
    assert.equal(results[0].error, 'Not found');
    assert.ok(results[1].error);
    assert.ok(results[2].error);
    assert.ok(results.every((r) => r.ok === undefined));
  });
});

describe('deleteLogFiles legacy .jsonl soft delete', () => {
  const NOW = Date.now();
  const now = () => NOW;

  it('moves the file into removed-<date>/ next to it, content intact', () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_100000.jsonl', [makeEntry('t1', 'u1')]);
    const original = join(tmpDir, 'proj', 'proj_20260601_100000.jsonl');
    const contentBefore = readFileSync(original, 'utf-8');

    const results = deleteLogFiles(tmpDir, ['proj/proj_20260601_100000.jsonl'], { now });
    assert.equal(results[0].ok, true);
    // movedTo is realpath-based (dirname of the resolved file) — compare the suffix,
    // macOS resolves /var → /private/var.
    const expected = results[0].movedTo;
    assert.ok(expected.endsWith(join('proj', `removed-${stampOf(NOW)}`, 'proj_20260601_100000.jsonl')),
      `unexpected movedTo: ${expected}`);
    assert.equal(existsSync(original), false);
    assert.equal(readFileSync(expected, 'utf-8'), contentBefore, 'nothing unlinked, bytes intact');
  });

  it('suffixes on collision inside removed-<date>/', () => {
    writeLog(tmpDir, 'proj', 'proj_20260601_100000.jsonl', [makeEntry('t1', 'u1')]);
    const r1 = deleteLogFiles(tmpDir, ['proj/proj_20260601_100000.jsonl'], { now });
    writeLog(tmpDir, 'proj', 'proj_20260601_100000.jsonl', [makeEntry('t2', 'u2')]);
    const r2 = deleteLogFiles(tmpDir, ['proj/proj_20260601_100000.jsonl'], { now });
    assert.equal(r2[0].ok, true);
    assert.notEqual(r2[0].movedTo, r1[0].movedTo);
    assert.ok(r2[0].movedTo.endsWith(`-${NOW}.jsonl`));
    assert.equal(existsSync(r1[0].movedTo), true);
    assert.equal(existsSync(r2[0].movedTo), true);
  });

  it('rejects path traversal', () => {
    const results = deleteLogFiles(tmpDir, ['../evil.jsonl']);
    assert.equal(results[0].error, 'Invalid file name');
  });

  it('rejects non-log filenames', () => {
    const results = deleteLogFiles(tmpDir, ['proj/config.json']);
    assert.equal(results[0].error, 'Invalid file name');
  });
});
