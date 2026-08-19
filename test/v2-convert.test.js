/**
 * wire-v2 S8 — offline v1→v2 converter unit tests (server/lib/v2/convert.js,
 * convert-manager.js, convert-worker.js).
 *
 * Pure unit tier: mkdtemp dirs, no interceptor, no server. Coverage mandated
 * by the plan's S8 row: golden round-trip (convert → verifyV1File zero diffs),
 * cross-file session continuity, file-level resume, session-level skip
 * (dual-write authority), dual-encoding user_id, .jsonl.zip archives,
 * space assertion, path-injection rejection, doneTs/metaExtra seams,
 * manager mutual exclusion.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertProject, listV1Files, listConvertibleProjects, readConvertState, STAGING_DIR_NAME, QUARANTINE_DIR_NAME } from '../packages/app/server/lib/v2/convert.js';
import { startConvert, stopConvert, convertStatus, isConvertRunning } from '../packages/app/server/lib/v2/convert-manager.js';
import { migrationStatus, _resetForTest as _resetMigMemo } from '../packages/app/server/lib/v2/migrate-prompt.js';
import { verifyV1File } from '../packages/app/server/lib/v2/verify.js';
import { listSessionIds } from '../packages/app/server/lib/v2/replay.js';
import { ensureSessionDirSync } from '../packages/app/server/lib/v2/layout.js';
import { resolveSessionDirName } from '../packages/app/server/lib/v2/session-select.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';

let logDir;
const PROJECT = 'proj';
beforeEach(() => { logDir = mkdtempSync(join(tmpdir(), 'ccv-v2cvt-')); mkdirSync(join(logDir, PROJECT)); _resetForTest(); _resetMigMemo(); });
afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID2 = 'b1111111-2222-3333-4444-555566667777';
const SID_LEGACY = 'c2222222-3333-4444-5555-666677778888';
const SID_TM = 'd3333333-4444-5555-6666-777788889999';
const jsonUid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const legacyUid = (sid) => `user_deadbeef123_account__session_${sid}`;
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const clearMsg = () => textMsg('user', '<command-name>/clear</command-name>');

const TOOLS = [{ name: 'Bash' }, { name: 'Read' }];
const SYSTEM = [{ type: 'text', text: 'You are Claude Code test system.' }];
let _tsCounter = 0;
const nextTs = () => `2026-01-01T00:00:${String(_tsCounter++ % 60).padStart(2, '0')}.${String(_tsCounter).padStart(3, '0')}Z`;

function entryOf({ messages, uid = jsonUid(SID), ts = nextTs(), mainAgent = true, extra = {}, duration = 1000 }) {
  return {
    timestamp: ts,
    project: PROJECT,
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'user-agent': 'test' },
    body: {
      model: 'claude-fable-5',
      system: SYSTEM,
      tools: TOOLS,
      ...(uid && { metadata: { user_id: uid } }),
      messages,
    },
    response: { status: 200, headers: {}, body: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 2 }, stop_reason: 'end_turn' } },
    duration,
    isStream: false,
    isHeartbeat: false,
    isCountTokens: false,
    mainAgent,
    ...extra,
  };
}

function writeV1(name, entries) {
  writeFileSync(join(logDir, PROJECT, name), entries.map(e => JSON.stringify(e) + '\n---\n').join(''));
}

// Task C: converted session dirs are `<ts>_<uuid>`; resolve by UUID (falls back
// to the bare id for direct ensureSessionDirSync fixtures / not-yet-created).
const sessionsDir = (sid) => join(logDir, PROJECT, 'sessions', resolveSessionDirName(join(logDir, PROJECT), sid) || sid);
const readJournal = (sid) => readFileSync(join(sessionsDir(sid), 'journal.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

describe('listV1Files ordering and filtering', () => {
  it('orders by filename timestamp, skips _temp and non-jsonl files (incl. legacy .jsonl.zip)', () => {
    const p = join(logDir, PROJECT);
    for (const n of ['proj_20260102_000000.jsonl', 'proj_20260101_000000.jsonl', '999__proj_20260101_120000.jsonl', 'proj_20260103_000000.jsonl.zip', 'proj_20260101_000000_temp.jsonl', 'notalog.txt']) {
      writeFileSync(join(p, n), '');
    }
    assert.deepEqual(listV1Files(p), [
      'proj_20260101_000000.jsonl',
      '999__proj_20260101_120000.jsonl',
      'proj_20260102_000000.jsonl',
    ]);
  });

  it('listConvertibleProjects finds only project dirs with log files', () => {
    mkdirSync(join(logDir, 'empty'));
    writeFileSync(join(logDir, PROJECT, 'proj_20260101_000000.jsonl'), '');
    writeFileSync(join(logDir, 'stray.jsonl'), ''); // files at root are not projects
    assert.deepEqual(listConvertibleProjects(logDir), [PROJECT]);
  });
});

describe('convertProject golden round-trip', () => {
  it('converts a mixed v1 file and passes full golden verify', async () => {
    const entries = [
      // main conversation: full → delta chain → /clear epoch split
      entryOf({ messages: [textMsg('user', 'u1')], extra: { _deltaFormat: true, _isCheckpoint: true, _seq: 1, _seqEpoch: 'ep1', _totalMessageCount: 1 } }),
      entryOf({ messages: [textMsg('assistant', 'a1'), textMsg('user', 'u2')], extra: { _deltaFormat: true, _seq: 2, _seqEpoch: 'ep1', _totalMessageCount: 3 } }),
      // placeholder frame (inProgress) must be skipped by the converter
      { ...entryOf({ messages: [clearMsg()] }), inProgress: true, response: null },
      // /clear checkpoint: shorter than previous state → epoch e1
      entryOf({ messages: [clearMsg(), textMsg('assistant', 'cleared')], extra: { _deltaFormat: true, _isCheckpoint: true, _seq: 3, _seqEpoch: 'ep1', _totalMessageCount: 2 } }),
      // subagent of the same session (no mainAgent flag)
      entryOf({ messages: [textMsg('user', 'sub prompt')], mainAgent: false }),
      // heartbeat without metadata → current-sid fallback
      { ...entryOf({ messages: [], uid: null }), isHeartbeat: true, body: { model: 'claude-fable-5' } },
      // teammate entry (own session, leader's file)
      entryOf({ messages: [textMsg('user', 'tm')], uid: jsonUid(SID_TM), extra: { teammate: { agentName: 'tm1', teamName: 't' } } }),
      // legacy user_id encoding session
      entryOf({ messages: [textMsg('user', 'legacy hello')], uid: legacyUid(SID_LEGACY) }),
    ];
    writeV1('proj_20260101_000000.jsonl', entries);
    // Finder-junk resilience: a .DS_Store inside staging must not survive the
    // post-promote cleanup (real-data 2026-07-14: rmdirSync left the dir behind).
    mkdirSync(join(logDir, PROJECT, STAGING_DIR_NAME), { recursive: true });
    writeFileSync(join(logDir, PROJECT, STAGING_DIR_NAME, '.DS_Store'), 'finder junk');

    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done');
    assert.equal(state.sessionsSkipped, 0);
    assert.equal(state.sessionsConverted, 3, 'SID + SID_TM + SID_LEGACY');
    assert.ok(!existsSync(join(logDir, PROJECT, STAGING_DIR_NAME)), 'staging fully promoted and removed (incl. junk files)');

    // Golden: the promoted tree verifies against the source with zero diffs.
    const report = await verifyV1File(join(logDir, PROJECT, 'proj_20260101_000000.jsonl'));
    assert.equal(report.ok, true, JSON.stringify(report.diffs.concat(report.integrity), null, 2));
    assert.equal(report.counters.v1Only, 0, 'every completed v1 entry has a v2 twin');

    // /clear split epochs: e0 + e1 under main
    assert.ok(existsSync(join(sessionsDir(SID), 'conversations', 'main', 'e0.jsonl')));
    assert.ok(existsSync(join(sessionsDir(SID), 'conversations', 'main', 'e1.jsonl')));

    // doneTs seam: done line = request ts + duration, not wall clock
    const j = readJournal(SID);
    const req1 = j.find(l => l.ph === 'req' && l.seq === 1);
    const done1 = j.find(l => l.ph === 'done' && l.seq === 1);
    assert.equal(done1.ts, new Date(Date.parse(req1.ts) + 1000).toISOString());

    // metaExtra + sources stamped
    const meta = JSON.parse(readFileSync(join(sessionsDir(SID), 'meta.json'), 'utf8'));
    assert.equal(meta.origin, 'convert');
    assert.deepEqual(meta.sources, ['proj_20260101_000000.jsonl']);
    // teammate session landed in its own dir
    assert.ok(existsSync(sessionsDir(SID_TM)));
    assert.ok(existsSync(sessionsDir(SID_LEGACY)));

    // prompts.jsonl display cache rides the shared writer path: converted
    // sessions carry it (and the golden verify above proved it's invisible to
    // the whitelist reader).
    const promptLines = readFileSync(join(sessionsDir(SID), 'prompts.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(promptLines.flatMap((l) => l.texts), ['u1', 'u2'], 'main-conv user prompts cached during conversion');
  });

  it('v1→v2 upgrade preserves residual body params and response statusText (no info loss)', async () => {
    const e = entryOf({ messages: [textMsg('user', 'params survive upgrade')] });
    e.body = { ...e.body, max_tokens: 32000, temperature: 0.5, stream: true, thinking: { type: 'enabled', budget_tokens: 2048 } };
    e.response = { ...e.response, statusText: 'OK' };
    writeV1('proj_20260101_000000.jsonl', [e]);

    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done');
    assert.equal(state.sessionsConverted, 1, 'session promoted, not quarantined — golden verify passes with params present');

    const req = readJournal(SID).find(l => l.ph === 'req');
    assert.deepEqual(req.params, {
      model: 'claude-fable-5',
      metadata: { user_id: jsonUid(SID) },
      max_tokens: 32000,
      temperature: 0.5,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 2048 },
    }, 'converter rides the same writer path: params land on the journal req line');

    const respLine = readFileSync(join(sessionsDir(SID), 'responses.jsonl'), 'utf8')
      .trim().split('\n').map(l => JSON.parse(l))[0];
    assert.equal(respLine.statusText, 'OK');
  });

  it('converts sessions spanning rotation files with a continuous journal', async () => {
    writeV1('proj_20260101_000000.jsonl', [
      entryOf({ messages: [textMsg('user', 'u1')], uid: jsonUid(SID2) }),
    ]);
    // Post-rotation: v1 resets delta state → full checkpoint that prefix-extends.
    writeV1('proj_20260102_000000.jsonl', [
      entryOf({ messages: [textMsg('user', 'u1'), textMsg('assistant', 'a1'), textMsg('user', 'u2')], uid: jsonUid(SID2) }),
    ]);
    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done');
    assert.equal(state.sessionsConverted, 1, 'one session across two files');

    const seqs = readJournal(SID2).filter(l => l.ph === 'req').map(l => l.seq);
    assert.deepEqual(seqs, [1, 2], 'journal seq continuous across the file boundary');
    const events = readFileSync(join(sessionsDir(SID2), 'conversations', 'main', 'e0.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(events.map(e => e.t), ['snapshot', 'append'], 'cross-file wire state prefix-extends');
    const meta = JSON.parse(readFileSync(join(sessionsDir(SID2), 'meta.json'), 'utf8'));
    assert.deepEqual(meta.sources, ['proj_20260101_000000.jsonl', 'proj_20260102_000000.jsonl']);
  });
});

describe('convertProject quarantine (weak, per-session verify)', () => {
  // Injected verifier flagging one session by its staged dir name (found via uuid).
  const flagVerifier = (flagUuid) => async (v1File, o) => {
    const projectDir = join(logDir, PROJECT);
    let suspectDir = null;
    for (const dir of listSessionIds(projectDir, o.sessionsDirName)) {
      try {
        const m = JSON.parse(readFileSync(join(projectDir, o.sessionsDirName, dir, 'meta.json'), 'utf8'));
        if (m.sessionId === flagUuid) suspectDir = dir;
      } catch { /* torn meta — not our target */ }
    }
    const suspectSessions = suspectDir ? [{ sessionId: suspectDir, count: 4, reasons: ['messages-digest@seq1'] }] : [];
    return { diffs: [], integrity: [], unsupportedSessions: [], suspectSessions, ok: suspectSessions.length === 0 };
  };

  it('holds only the flagged session and still promotes the rest (no abort)', async () => {
    writeV1('proj_20260101_000000.jsonl', [
      entryOf({ messages: [textMsg('user', 'good')], uid: jsonUid(SID) }),
      entryOf({ messages: [textMsg('user', 'bad')], uid: jsonUid(SID2) }),
    ]);

    const state = await convertProject(logDir, PROJECT, {
      verifyFn: flagVerifier(SID2),
      statfs: () => ({ bavail: 1e9, bsize: 4096 }),
    });

    // A verify failure must NOT abort the batch.
    assert.equal(state.status, 'done', 'one bad session never aborts the migration');
    assert.equal(state.sessionsQuarantined, 1);
    assert.equal(state.quarantined.length, 1);
    assert.equal(state.quarantined[0].uuid, SID2);
    assert.ok(state.quarantined[0].reasons.length >= 1, 'quarantine record carries reasons');

    // Clean session went live; flagged session was held aside.
    assert.ok(resolveSessionDirName(join(logDir, PROJECT), SID), 'clean session promoted to sessions/');
    assert.ok(!resolveSessionDirName(join(logDir, PROJECT), SID2), 'flagged session NOT promoted to sessions/');
    const held = listSessionIds(join(logDir, PROJECT), QUARANTINE_DIR_NAME);
    assert.equal(held.length, 1, 'flagged session lives in sessions-quarantine/');
    const heldMeta = JSON.parse(readFileSync(join(logDir, PROJECT, QUARANTINE_DIR_NAME, held[0], 'meta.json'), 'utf8'));
    assert.equal(heldMeta.sessionId, SID2);
    // Staging fully drained (promoted or moved to quarantine).
    assert.ok(!existsSync(join(logDir, PROJECT, STAGING_DIR_NAME)), 'staging removed after promote/quarantine');
  });

  it('a crash inside the verifier is soft — migration completes, nothing quarantined', async () => {
    writeV1('proj_20260101_000000.jsonl', [
      entryOf({ messages: [textMsg('user', 'a')], uid: jsonUid(SID) }),
    ]);
    const state = await convertProject(logDir, PROJECT, {
      verifyFn: async () => { throw new Error('verifier blew up'); },
      statfs: () => ({ bavail: 1e9, bsize: 4096 }),
    });
    assert.equal(state.status, 'done', 'verifier crash must not sink the migration');
    assert.equal(state.sessionsQuarantined, 0);
    assert.ok(resolveSessionDirName(join(logDir, PROJECT), SID), 'session still promoted');
  });
});

describe('verify-phase progress persisted to the state file', () => {
  const okReport = { diffs: [], integrity: [], unsupportedSessions: [], suspectSessions: [], ok: true };
  const twoFiles = () => {
    writeV1('proj_20260101_000000.jsonl', [entryOf({ messages: [textMsg('user', 'u1')], uid: jsonUid(SID) })]);
    writeV1('proj_20260102_000000.jsonl', [entryOf({ messages: [textMsg('user', 'u2')], uid: jsonUid(SID2) })]);
  };

  it('verifyIndex/verifyTotal/verifyEntries land on DISK mid-verify (the frontend renders from the state file)', async () => {
    twoFiles();
    const midStates = []; // state-file snapshot taken at the START of each verifyFn call
    const verifyFn = async (v1File, o) => {
      midStates.push(readConvertState(join(logDir, PROJECT)));
      // Emulate verifyV1File's cumulative per-file counter (1000, then 2000).
      o.onProgress({ entriesScanned: 1000 });
      o.onProgress({ entriesScanned: 2000 });
      return okReport;
    };
    const state = await convertProject(logDir, PROJECT, { verifyFn, statfs: () => ({ bavail: 1e9, bsize: 4096 }) });

    assert.equal(state.status, 'done');
    assert.equal(state.verifyTotal, 2, 'n = all v1 files (the verify loop does not skip done files)');
    assert.equal(state.verifyIndex, 2, 'x reaches n');
    assert.equal(state.verifyEntries, 4000, 'entries accumulate ACROSS files');

    assert.equal(midStates.length, 2);
    assert.equal(midStates[0].status, 'verifying');
    assert.equal(midStates[0].verifyTotal, 2, 'verifyTotal persisted before the first verifyFn runs');
    assert.equal(midStates[0].verifyIndex, 0);
    assert.equal(midStates[1].verifyIndex, 1, 'per-file advance persisted unconditionally before file #2');
    assert.equal(midStates[1].verifyEntries, 2000, 'file #1 entries persisted at the file boundary');

    const disk = readConvertState(join(logDir, PROJECT));
    assert.equal(disk.verifyIndex, 2);
    assert.equal(disk.verifyEntries, 4000);
  });

  it('a throwing verifyFn still advances the persisted counter to n (no skipped numbers)', async () => {
    twoFiles();
    let calls = 0;
    const state = await convertProject(logDir, PROJECT, {
      verifyFn: async () => { if (++calls === 1) throw new Error('boom'); return okReport; },
      statfs: () => ({ bavail: 1e9, bsize: 4096 }),
    });
    assert.equal(state.status, 'done');
    assert.equal(calls, 2, 'both files attempted');
    assert.equal(state.verifyIndex, state.verifyTotal, 'x reaches n even when a file verifier throws');
  });
});

describe('legacy-format hardening (real-data classes, 2026-07-14)', () => {
  it('old entries without requestId + same-ms countTokens burst + equal-length interleave pass golden verify', async () => {
    const ts = '2026-01-01T00:00:00.100Z'; // deliberately reused: ts|url key collision
    const ct = (text) => {
      const e = entryOf({ messages: [textMsg('user', text)], uid: null, ts, mainAgent: false });
      e.isCountTokens = true;
      e.url = 'https://api.anthropic.com/v1/messages/count_tokens?beta=true';
      delete e.body.tools; delete e.body.system;
      return e;
    };
    const entries = [
      // cold-start: metadata-less countTokens BEFORE any sid, same ts|url key,
      // different payloads — held, then flushed into the first session.
      ct('count A'), ct('count B'),
      // equal-length wholly-different wires under one conv (pre-flag proxy
      // teammate interleave shape) — must snapshot, not tail-patch.
      entryOf({ messages: [textMsg('user', 'conv A opening'), textMsg('assistant', 'A reply')] }),
      entryOf({ messages: [textMsg('user', 'conv B opening'), textMsg('assistant', 'B reply')] }),
      entryOf({ messages: [textMsg('user', 'conv A opening'), textMsg('assistant', 'A reply'), textMsg('user', 'A u2')] }),
    ];
    for (const e of entries) delete e.requestId; // pre-requestId era
    writeV1('proj_20260101_000000.jsonl', entries);

    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done', 'golden verify must pass on legacy shapes');

    const j = readJournal(SID);
    const reqs = j.filter(l => l.ph === 'req');
    const dones = j.filter(l => l.ph === 'done');
    assert.equal(reqs.length, 5);
    assert.equal(dones.length, 5, 'held cold-start entries must still get their done lines (synthetic rid)');
    const report = await verifyV1File(join(logDir, PROJECT, 'proj_20260101_000000.jsonl'));
    assert.equal(report.ok, true, JSON.stringify(report.diffs.concat(report.integrity), null, 2));
    assert.equal(report.counters.v2ReqWithoutDone, 0);
  });
});

describe('resume and skip semantics', () => {
  it('stops at a file boundary and resumes without redoing done files', async () => {
    writeV1('proj_20260101_000000.jsonl', [entryOf({ messages: [textMsg('user', 'u1')], uid: jsonUid(SID2) })]);
    writeV1('proj_20260102_000000.jsonl', [entryOf({ messages: [textMsg('user', 'u1'), textMsg('assistant', 'a1'), textMsg('user', 'u2')], uid: jsonUid(SID2) })]);

    let filesDone = 0;
    const stopped = await convertProject(logDir, PROJECT, {
      statfs: () => ({ bavail: 1e9, bsize: 4096 }),
      onProgress: (p) => { if (p.phase === 'convert') filesDone++; },
      shouldStop: () => filesDone >= 1, // stop at the boundary after file 1
    });
    assert.equal(stopped.status, 'stopped');
    assert.deepEqual(stopped.files.map(f => f.done), [true, false]);
    // Task C: staged dir is `<ts>_<uuid>` too — resolve by UUID under staging.
    assert.ok(resolveSessionDirName(join(logDir, PROJECT), SID2, STAGING_DIR_NAME), 'staging kept for resume');
    assert.ok(!resolveSessionDirName(join(logDir, PROJECT), SID2), 'nothing promoted yet');

    const resumed = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(resumed.status, 'done');
    assert.equal(resumed.entries, 1, 'only the pending file was re-processed');
    const seqs = readJournal(SID2).filter(l => l.ph === 'req').map(l => l.seq);
    assert.deepEqual(seqs, [1, 2], 'journal seq seeded from staging — no collision across the resume');
    const report = await verifyV1File(join(logDir, PROJECT, 'proj_20260102_000000.jsonl'));
    assert.equal(report.ok, true, JSON.stringify(report.diffs, null, 2));
    assert.equal(readConvertState(join(logDir, PROJECT)).status, 'done');
  });

  it('resume ACROSS a /clear seeds the epoch from staging — continuation lands in e1, golden passes', async () => {
    // File 1 drives SID2 through a /clear (e0 → e1) and completes; file 2's
    // continuation is converted by a RESUMED run whose fresh ConversationStore
    // must seed epoch=1 from the staged files, not restart at e0 (2026-07-15
    // fix — pre-fix it appended newer seqs into e0, breaking file-seq order).
    const preClear = [textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c'),
                      textMsg('assistant', 'd'), textMsg('user', 'e'), textMsg('assistant', 'f')];
    const postClear = [clearMsg(), textMsg('assistant', 'fresh')];
    writeV1('proj_20260101_000000.jsonl', [
      entryOf({ messages: preClear, uid: jsonUid(SID2), extra: { _isCheckpoint: true } }),
      entryOf({ messages: postClear, uid: jsonUid(SID2), extra: { _isCheckpoint: true } }),
    ]);
    writeV1('proj_20260102_000000.jsonl', [
      entryOf({ messages: [...postClear, textMsg('user', 'resumed turn')], uid: jsonUid(SID2) }),
    ]);

    let filesDone = 0;
    const stopped = await convertProject(logDir, PROJECT, {
      statfs: () => ({ bavail: 1e9, bsize: 4096 }),
      onProgress: (p) => { if (p.phase === 'convert') filesDone++; },
      shouldStop: () => filesDone >= 1,
    });
    assert.equal(stopped.status, 'stopped');

    const resumed = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(resumed.status, 'done');
    const e0 = readFileSync(join(sessionsDir(SID2), 'conversations', 'main', 'e0.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(JSON.parse);
    const e1 = readFileSync(join(sessionsDir(SID2), 'conversations', 'main', 'e1.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(JSON.parse);
    const maxE0 = Math.max(...e0.map(l => l.seq));
    const minE1 = Math.min(...e1.map(l => l.seq));
    assert.ok(maxE0 < minE1, `file-seq order preserved across the resume (e0 max ${maxE0} < e1 min ${minE1})`);
    assert.ok(e1.length >= 2, 'the resumed continuation landed in e1, not e0');
    const report = await verifyV1File(join(logDir, PROJECT, 'proj_20260102_000000.jsonl'));
    assert.equal(report.ok, true, JSON.stringify(report.diffs, null, 2));
  });

  it('skips sessions that already have a real v2 dir (dual-write authority)', async () => {
    ensureSessionDirSync(logDir, PROJECT, SID, {});
    const journalBefore = readFileSync(join(sessionsDir(SID), 'journal.jsonl'), 'utf8');
    writeV1('proj_20260101_000000.jsonl', [
      entryOf({ messages: [textMsg('user', 'u1')] }),               // SID — must be skipped
      entryOf({ messages: [textMsg('user', 'x')], uid: jsonUid(SID2) }), // SID2 — converted
    ]);
    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done');
    assert.equal(state.sessionsSkipped, 1);
    assert.equal(state.sessionsConverted, 1);
    assert.equal(readFileSync(join(sessionsDir(SID), 'journal.jsonl'), 'utf8'), journalBefore, 'live session untouched');
    assert.ok(existsSync(sessionsDir(SID2)));
  });
});

describe('archives, rejections, guards', () => {
  it('ignores legacy .jsonl.zip archives (never a candidate, plain files still convert)', async () => {
    // zip read support was removed with the archive feature — a leftover archive
    // must be silently excluded from the candidate list, not read or crashed on.
    writeFileSync(join(logDir, PROJECT, 'proj_20260101_000000.jsonl.zip'), 'legacy zip bytes');
    writeV1('proj_20260102_000000.jsonl', [entryOf({ messages: [textMsg('user', 'plain hello')], uid: jsonUid(SID2) })]);
    assert.deepEqual(listV1Files(join(logDir, PROJECT)), ['proj_20260102_000000.jsonl']);
    const state = await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    assert.equal(state.status, 'done');
    assert.equal(state.entries, 1);
    assert.deepEqual(state.files.map(f => f.name), ['proj_20260102_000000.jsonl'], 'zip never entered the file list');
    assert.ok(existsSync(sessionsDir(SID2)));
  });

  it('rejects path-traversal project names', async () => {
    await assert.rejects(() => convertProject(logDir, '../evil'), /invalid project name/);
    await assert.rejects(() => convertProject(logDir, ''), /invalid project name/);
  });

  it('refuses to start without 2x free disk space and records the error', async () => {
    writeV1('proj_20260101_000000.jsonl', [entryOf({ messages: [textMsg('user', 'u1')] })]);
    await assert.rejects(
      () => convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1, bsize: 1 }) }),
      /insufficient disk space/,
    );
    assert.equal(readConvertState(join(logDir, PROJECT)).status, 'error');
  });
});

describe('convert-manager', () => {
  it('enforces single-flight and reaches done via the worker', async () => {
    writeV1('proj_20260101_000000.jsonl', [entryOf({ messages: [textMsg('user', 'managed')], uid: jsonUid(SID2) })]);
    const first = startConvert(logDir, PROJECT);
    assert.equal(first.ok, true);
    assert.equal(isConvertRunning(), true, '_running is set synchronously');
    const second = startConvert(logDir, PROJECT);
    assert.equal(second.ok, false);
    assert.match(second.error, /already running/);

    // Poll until the resident worker finishes (state file is the truth).
    const deadline = Date.now() + 15000;
    let status;
    while (Date.now() < deadline) {
      status = convertStatus(logDir, PROJECT);
      if (!status.running && status.state && status.state.status === 'done') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(status.state && status.state.status, 'done', JSON.stringify(status));
    assert.ok(existsSync(sessionsDir(SID2)));
    assert.equal(stopConvert().ok, false, 'nothing left to stop');
  });

  it("worker 'final' invalidates the migrationStatus memo so the next call re-scans", async () => {
    writeV1('proj_20260101_000000.jsonl', [entryOf({ messages: [textMsg('user', 'memo invalidation')], uid: jsonUid(SID2) })]);
    // Pre-fill the memo with the pre-conversion verdict — without the
    // invalidation hook this test fails because the stale entry is served.
    assert.equal(migrationStatus(logDir, PROJECT).pending, true, 'pending before conversion (memoized)');

    const start = startConvert(logDir, PROJECT);
    assert.equal(start.ok, true);
    const deadline = Date.now() + 15000;
    let status;
    while (Date.now() < deadline) {
      status = convertStatus(logDir, PROJECT);
      if (!status.running && status.state && status.state.status === 'done') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(status.state && status.state.status, 'done', JSON.stringify(status));

    // The worker's 'final' message must have dropped the memo: the fresh
    // read sees status:'done' and reports nothing pending.
    const after = migrationStatus(logDir, PROJECT);
    assert.equal(after.pending, false, 'finished conversion reflected immediately (memo invalidated)');
  });
});
