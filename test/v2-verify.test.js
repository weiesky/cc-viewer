/**
 * wire-v2 — verifier units + end-to-end teeth (server/lib/v2/verify.js).
 *
 * 1.7.0: dual-write no longer exists, so the verifier's job is the MIGRATION
 * golden gate — a hand-authored v1 file is converted (real convertProject) and
 * verified against the produced session dirs:
 *   clean convert → zero diffs; extra v1-only entry → counted, not failed;
 *   tampered v2 conv file / blob ref → reported diff (a verifier that never
 *   fails would make the migration golden gate meaningless).
 *
 * Pure unit tier: mkdtemp dirs, no interceptor, no server.
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { convertProject } from '../packages/app/server/lib/v2/convert.js';
import { resolveSessionDirName } from '../packages/app/server/lib/v2/session-select.js';
import { verifyV1File } from '../packages/app/server/lib/v2/verify.js';
import * as replay from '../packages/app/server/lib/v2/replay.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';

let logDir;
const PROJECT = 'proj';
const V1_NAME = 'proj_20260101_000000.jsonl';
beforeEach(() => { logDir = mkdtempSync(join(tmpdir(), 'ccv-v2vfy-')); mkdirSync(join(logDir, PROJECT)); _resetForTest(); });
afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

const SID = 'aaaa1111-2222-3333-4444-bbbb5555cccc';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

let _tsCounter = 0;
const nextTs = () => `2026-01-01T00:00:${String(_tsCounter++ % 60).padStart(2, '0')}.${String(_tsCounter).padStart(3, '0')}Z`;

function entryOf(messages, extra = {}) {
  return {
    timestamp: nextTs(),
    project: PROJECT,
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'user-agent': 'test' },
    body: {
      model: 'claude-fable-5',
      system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
      tools: [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Agent' }],
      metadata: { user_id: USER_ID },
      messages,
    },
    response: { status: 200, headers: {}, body: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    duration: 42,
    isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent: true,
    ...extra,
  };
}

const v1Path = () => join(logDir, PROJECT, V1_NAME);
function writeV1(entries) {
  writeFileSync(v1Path(), entries.map(e => JSON.stringify(e) + '\n---\n').join(''));
}

/** The standard 3-turn fixture: checkpoint → delta → in-place tail replace. */
function standardEntries() {
  _tsCounter = 0;
  return [
    entryOf([textMsg('user', 'turn 1')],
      { _deltaFormat: 1, _isCheckpoint: true, _seq: 1, _seqEpoch: 'ep1', _totalMessageCount: 1, _conversationId: 'mainAgent' }),
    entryOf([textMsg('assistant', 'r1'), textMsg('user', 'turn 2')],
      { _deltaFormat: 1, _isCheckpoint: false, _seq: 2, _seqEpoch: 'ep1', _totalMessageCount: 3, _conversationId: 'mainAgent' }),
    entryOf([textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2 EDITED')],
      { _deltaFormat: 1, _isCheckpoint: true, _inPlaceReplaceDetected: true, _seq: 3, _seqEpoch: 'ep1', _totalMessageCount: 3, _conversationId: 'mainAgent' }),
  ];
}

async function convertAll() {
  await convertProject(logDir, PROJECT, { statfs: () => ({ bavail: 1n << 40n, bsize: 1n }) });
}

describe('replay units', () => {
  it('mechanical replay: snapshot / append / replace-tail', () => {
    const events = [
      { seq: 1, t: 'snapshot', msgs: [textMsg('user', 'a')] },
      { seq: 2, t: 'append', msgs: [textMsg('assistant', 'b'), textMsg('user', 'c')] },
      { seq: 3, t: 'ctl', op: 'replace-tail', msg: textMsg('user', 'C2') },
      { seq: 4, t: 'snapshot', msgs: [textMsg('user', 'fresh')] },
    ];
    const bySeq = replay.replayConversation(events);
    assert.equal(bySeq.get(1).len, 1);
    assert.equal(bySeq.get(2).len, 3);
    assert.equal(bySeq.get(3).len, 3);
    assert.notEqual(bySeq.get(2).digest, bySeq.get(3).digest, 'replace-tail changes the digest');
    assert.equal(bySeq.get(3).digest, replay.messagesDigest([textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'C2')]));
    assert.equal(bySeq.get(4).len, 1);
  });

  it('readJsonlTolerant drops a truncated tail line', () => {
    const p = join(logDir, 'trunc.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n{"trunca', 'utf-8');
    assert.deepEqual(replay.readJsonlTolerant(p), [{ a: 1 }, { b: 2 }]);
  });

  it('blobRefOf matches the BlobStore CAS formula', async () => {
    const { BlobStore } = await import('../packages/app/server/lib/v2/blob-store.js');
    const { ensureSessionDirSync } = await import('../packages/app/server/lib/v2/layout.js');
    const paths = ensureSessionDirSync(mkdtempSync(join(tmpdir(), 'ccv-ref-')), 'p', SID);
    const store = new BlobStore(paths);
    const val = [{ name: 'Bash', x: 1 }];
    assert.equal(replay.blobRefOf(val), store.put(val));
    assert.equal(replay.blobRefOf(null), null);
  });
});

describe('verifier end-to-end over converted sessions (migration golden gate)', () => {
  it('a clean conversion verifies with zero diffs', async () => {
    writeV1(standardEntries());
    await convertAll();
    const report = await verifyV1File(v1Path());
    assert.equal(report.ok, true, JSON.stringify(report.diffs, null, 2));
    assert.equal(report.counters.matched, 3);
    assert.equal(report.counters.v1Only, 0);
    assert.equal(report.integrity.length, 0);
    assert.ok(report.v2Sessions.includes(SID));
  });

  it('a v1-only entry (appended after conversion) is counted, not failed', async () => {
    writeV1(standardEntries());
    await convertAll();
    // History that never made it into the v2 store (e.g. pre-v2 tail) must be
    // tolerated forever — counted as v1Only, never a failure.
    const extra = entryOf([
      textMsg('user', 'turn 1'), textMsg('assistant', 'r1'),
      textMsg('user', 'turn 2 EDITED'), textMsg('assistant', 'r2'), textMsg('user', 'turn 3'),
    ], { _deltaFormat: 1, _isCheckpoint: true, _seq: 4, _seqEpoch: 'ep1', _totalMessageCount: 5, _conversationId: 'mainAgent' });
    appendFileSync(v1Path(), JSON.stringify(extra) + '\n---\n');
    const report = await verifyV1File(v1Path());
    assert.equal(report.ok, true);
    assert.equal(report.counters.v1Only, 1, 'the un-converted tail entry has no twin');
  });

  it('tampered v2 conversation file → digest diff reported (verifier has teeth)', async () => {
    writeV1(standardEntries());
    await convertAll();
    const convFile = join(logDir, PROJECT, 'sessions', resolveSessionDirName(join(logDir, PROJECT), SID) || SID, 'conversations', 'main', 'e0.jsonl');
    const original = readFileSync(convFile, 'utf-8');
    try {
      appendFileSync(convFile, JSON.stringify({ seq: 3, rid: 'tamper', t: 'ctl', op: 'replace-tail', msg: textMsg('user', 'TAMPERED') }) + '\n');
      const report = await verifyV1File(v1Path());
      assert.equal(report.ok, false, 'tampering must be detected');
      assert.ok(report.diffs.some(d => d.type === 'messages-digest'), 'digest diff reported');
    } finally {
      writeFileSync(convFile, original, 'utf-8');
    }
    const clean = await verifyV1File(v1Path());
    assert.equal(clean.ok, true, 'restored state verifies clean again');
  });

  it('tampered blob ref → tools-ref diff reported', async () => {
    writeV1(standardEntries());
    await convertAll();
    const journalFile = join(logDir, PROJECT, 'sessions', resolveSessionDirName(join(logDir, PROJECT), SID) || SID, 'journal.jsonl');
    const original = readFileSync(journalFile, 'utf-8');
    try {
      const lines = original.trim().split('\n');
      const idx = lines.findIndex(l => l.includes('"ph":"req"'));
      const req = JSON.parse(lines[idx]);
      req.blobs.tools = 'sha256-0000000000000000';
      lines[idx] = JSON.stringify(req);
      writeFileSync(journalFile, lines.join('\n') + '\n', 'utf-8');
      const report = await verifyV1File(v1Path());
      assert.equal(report.ok, false);
      assert.ok(report.diffs.some(d => d.type === 'tools-ref'));
    } finally {
      writeFileSync(journalFile, original, 'utf-8');
    }
  });

  // Per-session attribution powers the converter's quarantine: every diff must
  // name the session that produced it, and suspectSessions must be COMPLETE
  // (uncapped) so the converter never promotes a corrupt session past diff #50.
  it('diffs and suspectSessions attribute to the exact session (dir name)', async () => {
    writeV1(standardEntries());
    await convertAll();
    const dirName = resolveSessionDirName(join(logDir, PROJECT), SID);
    const convFile = join(logDir, PROJECT, 'sessions', dirName, 'conversations', 'main', 'e0.jsonl');
    const original = readFileSync(convFile, 'utf-8');
    try {
      appendFileSync(convFile, JSON.stringify({ seq: 3, rid: 'tamper', t: 'ctl', op: 'replace-tail', msg: textMsg('user', 'TAMPERED') }) + '\n');
      const report = await verifyV1File(v1Path());
      assert.equal(report.ok, false);
      // Every reported diff names its session.
      assert.ok(report.diffs.length > 0 && report.diffs.every(d => d.sessionId === dirName), 'each diff carries the session dir name');
      // suspectSessions folds them into a per-session tally keyed by dir name.
      assert.equal(report.suspectSessions.length, 1, 'exactly one suspect session');
      assert.equal(report.suspectSessions[0].sessionId, dirName);
      assert.ok(report.suspectSessions[0].count >= 1 && report.suspectSessions[0].reasons.length >= 1, 'suspect carries count + reasons');
    } finally {
      writeFileSync(convFile, original, 'utf-8');
    }
    const clean = await verifyV1File(v1Path());
    assert.deepEqual(clean.suspectSessions, [], 'restored state has no suspects');
  });
});

describe('verifyV1File onProgress (verify-phase live progress)', () => {
  it('reports monotonically increasing entriesScanned, final call equals the entry count', async () => {
    const entries = standardEntries();
    writeV1(entries);
    await convertProject(logDir, PROJECT, { verify: false, statfs: () => ({ bavail: 1e9, bsize: 4096 }) });

    const seen = [];
    const report = await verifyV1File(v1Path(), { onProgress: (p) => seen.push(p.entriesScanned) });
    assert.equal(report.ok, true, 'progress callback does not change the verdict');
    assert.ok(seen.length >= 1, 'final flush always fires');
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'monotonic');
    assert.equal(seen[seen.length - 1], entries.length, 'final count equals the scanned v1 entries');
  });

  it('fires an intermediate callback every 1000 entries on a long file (the moving signal for big files)', async () => {
    // No conversion needed: progress counts raw v1 entries regardless of v2 state.
    const entries = [];
    for (let i = 0; i < 2500; i++) entries.push(entryOf([textMsg('user', `m${i}`)]));
    writeV1(entries);
    const seen = [];
    await verifyV1File(v1Path(), { onProgress: (p) => seen.push(p.entriesScanned) });
    assert.deepEqual(seen, [1000, 2000, 2500], 'a callback at every 1000 scanned entries plus the final flush');
  });

  it('a throwing onProgress never breaks the verify', async () => {
    writeV1(standardEntries());
    await convertProject(logDir, PROJECT, { verify: false, statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
    const report = await verifyV1File(v1Path(), { onProgress: () => { throw new Error('ui went away'); } });
    assert.equal(report.ok, true, 'callback errors are swallowed');
  });
});
