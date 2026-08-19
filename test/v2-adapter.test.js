/**
 * wire-v2 S5 — v2→v1 adapter read layer (server/lib/v2/adapter.js).
 *
 * Pure unit tier against mkdtemp dirs: entries are driven through the REAL
 * V2Writer (write side) and read back through the adapter (read side), then
 * pushed through the REAL client reconstructor — a full storage round-trip.
 * Coverage mandated by the plan's S5 row: envelope synthesis (checkpoint /
 * delta / replace-tail pair / empty delta), /clear epoch boundary, in-flight
 * synthesis, sub/misc full-messages streams, teammate re-join, §14 read-side
 * crash tolerance (truncated journal tail, missing blob, orphan conv line,
 * missing conv line), log-stream dispatch, and v2 addressing validation.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../packages/app/server/lib/v2/v2-writer.js';
import { isV2SessionDir, iterateV2RawEntries, iterateV2RawEntriesAsync, listV2Sessions, findTeammateSessionDirs } from '../packages/app/server/lib/v2/adapter.js';
import { messagesDigest, readSession } from '../packages/app/server/lib/v2/replay.js';
import { verifyV1File } from '../packages/app/server/lib/v2/verify.js';
import { createIncrementalReconstructor } from '../packages/app/server/lib/delta-reconstructor.js';
import { isPostClearCheckpoint, normalizeMsgForEquality } from '../packages/app/server/lib/session-boundary.js';
import { validateLogPath, parseV2Ref, listV2Logs } from '../packages/app/server/lib/log-management.js';
import { countLogEntries, readTailEntries, streamRawEntriesAsync } from '../packages/app/server/lib/log-stream.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';
import { resolveSessionDirName } from '../packages/app/server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2adp-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID_TM = 'b7772cc9-1bc8-56ab-cdfe-5d9a61b25495';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const clearMsg = () => textMsg('user', '<command-name>/clear</command-name>');

const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [{ name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} }, { name: 'Agent', input_schema: {} }];

let tsCounter = 0;
function nextTs() {
  return new Date(Date.UTC(2026, 6, 13, 5, 0, 0, ++tsCounter)).toISOString();
}

/** Fully materialized v1 requestEntry, the shape the S3 seam hands V2Writer. */
function mainEntry(messages, { sid = SID, teammate = null } = {}) {
  return {
    timestamp: nextTs(),
    project: 'proj',
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(sid) }, messages },
    response: null,
    duration: 0,
    isStream: false,
    isHeartbeat: false,
    isCountTokens: false,
    mainAgent: true,
    ...(teammate && { teammate: teammate.name, teamName: teammate.team }),
    requestId: `rid_${++tsCounter}`,
  };
}

function subEntry(messages) {
  const e = mainEntry(messages);
  e.mainAgent = false;
  e.body.system = 'You are a focused sub-task agent.';
  return e;
}

function newWriter(opts = {}) {
  return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, ...opts });
}

/** Fire one request through the writer: request phase + completion phase. */
function fire(w, entry, { complete = true } = {}) {
  const h = w.ingestRequest(entry, entry.body.messages);
  if (complete) {
    w.ingestCompletion(h, {
      ...entry,
      response: { status: 200, headers: { 'x-req': '1' }, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } },
      duration: 42,
    });
  }
  return h;
}

const sessionDirOf = (sid) => join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), sid) || sid);
// Task C: the addressing sid is the real dir basename (`<ts>_<uuid>`), not the UUID.
const dirNameOf = (project, sid) => resolveSessionDirName(join(dir, project), sid) || sid;
const refOf = (project, sid) => `v2:${project}/${dirNameOf(project, sid)}`;
const readAdapted = (sessionDir) => [...iterateV2RawEntries(sessionDir)].map((raw) => JSON.parse(raw));

// ─── envelope synthesis round-trip (spec §11) ────────────────────────────────
describe('adapter envelope synthesis round-trip', () => {
  it('checkpoint / delta / empty delta / replace-tail / clear-epoch, reconstructed byte-true', async () => {
    const w = newWriter();
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    const t3 = t2; // unchanged wire → no conversation event, empty delta
    const t4 = [textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2 EDITED')]; // replace-tail
    const t5 = [clearMsg()]; // /clear → epoch e1
    const t6 = [clearMsg(), textMsg('assistant', 'post-clear')];
    const wires = [t1, t2, t3, t4, t5, t6];
    for (const msgs of wires) fire(w, mainEntry(msgs));
    await w.flush();

    const sessionDir = sessionDirOf(SID);
    assert.ok(isV2SessionDir(sessionDir));
    const entries = readAdapted(sessionDir);
    assert.equal(entries.length, 6);

    // Envelope shapes, in seq order.
    const [e1, e2, e3, e4, e5, e6] = entries;
    assert.equal(e1._isCheckpoint, true, 'first event is a self-contained checkpoint');
    assert.deepEqual(e1.body.messages, t1);
    assert.equal(e2._isCheckpoint, false);
    assert.deepEqual(e2.body.messages, t2.slice(1), 'delta carries only the appended slice');
    assert.equal(e2._totalMessageCount, 3);
    assert.equal(e3._isCheckpoint, false);
    assert.deepEqual(e3.body.messages, [], 'unchanged wire → empty delta, like v1');
    assert.equal(e3._totalMessageCount, 3);
    assert.equal(e4._isCheckpoint, true, 'replace-tail synthesizes a checkpoint');
    assert.equal(e4._inPlaceReplaceDetected, true, 'paired signal for the client helper');
    assert.deepEqual(e4.body.messages, t4);
    assert.equal(e5._isCheckpoint, true);
    assert.ok(isPostClearCheckpoint(e5, 3), 'client /clear boundary predicate fires on the synthesized entry');
    assert.equal(e6._isCheckpoint, false);
    assert.deepEqual(e6.body.messages, t6.slice(1));

    // Cross-cutting invariants.
    for (const [i, e] of entries.entries()) {
      assert.equal(e._deltaFormat, 1);
      assert.equal(e._conversationId, 'mainAgent');
      assert.equal(e._seq, i + 1, 'seq-ordered stream');
      assert.equal(e._seqEpoch, `v2:${SID}`);
      assert.equal(e.mainAgent, true);
      assert.equal(e.project, 'proj');
      assert.equal(e.body.metadata.user_id, userIdOf(SID), 'user_id replayed verbatim (client equality checks)');
      assert.deepEqual(e.body.tools, TOOLS, 'per-request blob backfill');
      assert.deepEqual(e.body.system, SYSTEM);
      assert.equal(e.response.status, 200);
      assert.equal(e.duration, 42);
      assert.equal(e._staleReorder, undefined, 'never emitted (spec §11)');
      assert.equal(e._reconstructBroken, undefined);
      assert.equal(e.inProgress, undefined);
      assert.equal(typeof e.timestamp, 'string');
    }

    // Full client round-trip: the real reconstructor must restore every
    // request's exact wire messages.
    const rec = createIncrementalReconstructor();
    entries.forEach((e, i) => {
      rec.reconstruct(e);
      assert.equal(e._staleReorder, undefined, 'seq order → guard never fires');
      assert.equal(e._reconstructBroken, undefined);
      assert.equal(messagesDigest(e.body.messages), messagesDigest(wires[i]), `request ${i + 1} wire-true after reconstruction`);
    });
  });

  it('req without done synthesizes the in-flight placeholder', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'done turn')]));
    const inflight = mainEntry([textMsg('user', 'done turn'), textMsg('assistant', 'a'), textMsg('user', 'hanging')]);
    fire(w, inflight, { complete: false });
    await w.flush();

    const entries = readAdapted(sessionDirOf(SID));
    assert.equal(entries.length, 2);
    assert.equal(entries[1].inProgress, true);
    assert.equal(entries[1].requestId, inflight.requestId);
    assert.equal(entries[1].response, null);
    assert.equal(entries[0].inProgress, undefined);
  });

  it('sub conversations come back as full-messages entries without an envelope', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'main turn')])); // establishes the sid
    const s1 = [textMsg('user', 'sub task prompt')];
    const s2 = [textMsg('user', 'sub task prompt'), textMsg('assistant', 'step'), textMsg('user', 'go on')];
    fire(w, subEntry(s1));
    fire(w, subEntry(s2));
    await w.flush();

    const entries = readAdapted(sessionDirOf(SID));
    const subs = entries.filter((e) => !e.mainAgent);
    assert.equal(subs.length, 2);
    assert.deepEqual(subs[0].body.messages, s1, 'first sub request full');
    assert.deepEqual(subs[1].body.messages, s2, 'second sub request full (append replayed)');
    for (const s of subs) {
      assert.equal(s._deltaFormat, undefined, 'no envelope on sub streams (v1 parity)');
      assert.equal(s._seq, undefined);
    }
  });
});

// ─── teammate re-join (spec §10) ─────────────────────────────────────────────
describe('teammate re-join', () => {
  async function buildLeaderAndTeammate() {
    const wl = newWriter();
    fire(wl, mainEntry([textMsg('user', 'leader 1')]));
    const wt = newWriter({ leader: { agentName: 'bob', teamName: 'builders', parentSessionId: SID } });
    fire(wt, mainEntry([textMsg('user', 'tm 1')], { sid: SID_TM, teammate: { name: 'bob', team: 'builders' } }));
    fire(wl, mainEntry([textMsg('user', 'leader 1'), textMsg('assistant', 'r'), textMsg('user', 'leader 2')]));
    await wl.flush();
    await wt.flush();
  }

  it('reading the leader merges teammate sessions by ts with dual tags', async () => {
    await buildLeaderAndTeammate();
    const entries = readAdapted(sessionDirOf(SID));
    assert.equal(entries.length, 3);
    // ts-ascending merge: leader1, teammate, leader2 (nextTs is monotonic).
    assert.equal(entries[0].teammate, undefined);
    assert.equal(entries[1].teammate, 'bob');
    assert.equal(entries[1].teamName, 'builders');
    assert.equal(entries[1]._seq, undefined, 'teammate entries carry no seq (v1 parity)');
    assert.equal(entries[1]._deltaFormat, undefined, 'teammate entries are full-messages');
    assert.deepEqual(entries[1].body.messages, [textMsg('user', 'tm 1')]);
    assert.equal(entries[1].body.metadata.user_id, userIdOf(SID_TM), 'teammate keeps its own user_id');
    assert.equal(entries[2]._seq, 2);
    const tss = entries.map((e) => e.timestamp);
    assert.deepEqual([...tss].sort(), tss, 'merged stream is ts-ascending');
  });

  it('reading a teammate session directly yields only its own tagged entries', async () => {
    await buildLeaderAndTeammate();
    const entries = readAdapted(sessionDirOf(SID_TM));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].teammate, 'bob');
    assert.equal(entries[0]._seq, undefined);
  });
});

// ─── read-side crash tolerance (spec §14) ────────────────────────────────────
describe('read-side crash tolerance', () => {
  async function seedTwoTurns() {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    fire(w, mainEntry([textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')]));
    await w.flush();
    return sessionDirOf(SID);
  }

  it('truncated journal tail line is dropped, earlier entries survive', async () => {
    const sessionDir = await seedTwoTurns();
    appendFileSync(join(sessionDir, 'journal.jsonl'), '{"ph":"req","seq":9,"ts":"2026-07-13T0', 'utf-8');
    const entries = readAdapted(sessionDir);
    assert.equal(entries.length, 2);
  });

  it('missing blob file degrades that field, never throws', async () => {
    const sessionDir = await seedTwoTurns();
    const blobsDir = join(sessionDir, 'blobs');
    for (const f of readdirSync(blobsDir)) unlinkSync(join(blobsDir, f));
    const entries = readAdapted(sessionDir);
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.body.tools, undefined);
      assert.equal(e.body.system, undefined);
      assert.deepEqual(e.body.messages && e.body.messages.length >= 0, true, 'messages unaffected');
    }
  });

  it('orphan conversation line (no journal req) is ignored', async () => {
    const sessionDir = await seedTwoTurns();
    const convFile = join(sessionDir, 'conversations', 'main', 'e0.jsonl');
    appendFileSync(convFile, JSON.stringify({ seq: 999, rid: 'ghost', t: 'append', msgs: [textMsg('user', 'GHOST')] }) + '\n');
    const entries = readAdapted(sessionDir);
    assert.equal(entries.length, 2);
    const rec = createIncrementalReconstructor();
    entries.forEach((e) => rec.reconstruct(e));
    assert.equal(entries[1].body.messages.some((m) => JSON.stringify(m).includes('GHOST')), false);
  });

  it('journal line whose conversation event is missing is skipped, not mis-synthesized', async () => {
    const sessionDir = await seedTwoTurns();
    const convFile = join(sessionDir, 'conversations', 'main', 'e0.jsonl');
    const lines = readFileSync(convFile, 'utf-8').trim().split('\n');
    // Drop the second event (the append) — simulates the §14 pendingTail window.
    writeFileSync(convFile, lines.slice(0, 1).join('\n') + '\n', 'utf-8');
    const entries = readAdapted(sessionDir);
    assert.equal(entries.length, 1, 'the event-less request is skipped');
    assert.deepEqual(entries[0].body.messages, [textMsg('user', 'turn 1')]);
  });
});

// ─── log-stream dispatch + addressing (spec §12) ─────────────────────────────
describe('log-stream dispatch over a v2 session dir', () => {
  it('countLogEntries / streamRawEntriesAsync / readTailEntries accept the session dir', async () => {
    const w = newWriter();
    const wires = [
      [textMsg('user', 'turn 1')],
      [textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')],
      [textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2'), textMsg('assistant', 'r2'), textMsg('user', 'turn 3')],
    ];
    for (const msgs of wires) fire(w, mainEntry(msgs));
    await w.flush();
    const sessionDir = sessionDirOf(SID);

    assert.equal(await countLogEntries(sessionDir), 3);

    const sent = [];
    const { totalCount } = await streamRawEntriesAsync(sessionDir, (raw) => sent.push(JSON.parse(raw)));
    assert.equal(totalCount, 3);
    assert.equal(sent.length, 3);

    const tail = await readTailEntries(sessionDir, { limit: 2 });
    assert.ok(tail.entries.length >= 2, 'tail window (checkpoint-extended)');
    assert.ok(JSON.parse(tail.entries[0])._isCheckpoint, 'tail slice starts at a checkpoint');
  });

  it('async iterator parity with the sync one', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    fire(w, mainEntry([textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')]));
    await w.flush();
    const sessionDir = sessionDirOf(SID);
    const sync = [...iterateV2RawEntries(sessionDir)];
    const async_ = [];
    for await (const raw of iterateV2RawEntriesAsync(sessionDir)) async_.push(raw);
    assert.deepEqual(async_, sync);
  });

  it('listV2Logs lists sessions with v1-shaped items; teammate sessions fold away', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'the leader opening prompt')]));
    fire(w, mainEntry([textMsg('user', 'the leader opening prompt'), textMsg('assistant', 'r'), textMsg('user', 'more')]));
    fire(w, mainEntry([
      textMsg('user', 'the leader opening prompt'), textMsg('assistant', 'r'), textMsg('user', 'more'),
      textMsg('assistant', 'x'), textMsg('user', 'hanging'),
    ]), { complete: false });
    const wt = newWriter({ leader: { agentName: 'bob', parentSessionId: SID } });
    fire(wt, mainEntry([textMsg('user', 'tm')], { sid: SID_TM, teammate: { name: 'bob', team: 't' } }));
    const OTHER_SID = 'd4d4d4d4-5555-6666-7777-888899990000';
    const w2 = newWriter();
    fire(w2, mainEntry([textMsg('user', 'second session')], { sid: OTHER_SID }));
    await w.flush(); await wt.flush(); await w2.flush();

    const def = listV2Logs(dir, 'proj');
    assert.ok(Array.isArray(def.proj));
    assert.equal(def.proj.length, 2, 'teammate folded into leader; every main session listed');
    const item = def.proj.find((x) => x.file === refOf('proj', SID));
    assert.ok(item, 'leader session listed');
    assert.equal(item.kind, 'v2');
    assert.match(item.timestamp, /^\d{8}_\d{6}$/, 'compact ts for formatTimestamp/sort');
    assert.equal(item.turns, 2, 'completed main requests only');
    assert.ok(item.size > 0);
    assert.equal(item.archived, undefined, 'archive semantics removed 2026-07-14 — no dead field');
    assert.ok(!('instanceId' in item), 'instance concept removed — field no longer emitted');
    assert.match(item.preview[0], /^the leader opening prompt/);
    assert.ok(def.proj.some((x) => x.file === refOf('proj', OTHER_SID)), 'second session listed too');
  });

  it('preview lists ALL user prompts from the prompts.jsonl cache (deduped, in order)', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'first question')]));
    fire(w, mainEntry([textMsg('user', 'first question'), textMsg('assistant', 'a1'), textMsg('user', 'second question')]));
    fire(w, mainEntry([
      textMsg('user', 'first question'), textMsg('assistant', 'a1'), textMsg('user', 'second question'),
      textMsg('assistant', 'a2'), textMsg('user', 'third question'),
    ]));
    await w.flush();
    const s = listV2Sessions(join(dir, 'proj')).find((x) => x.sid === dirNameOf('proj', SID));
    assert.deepEqual(s.preview, ['first question', 'second question', 'third question']);
  });

  it('preview falls back to a caveat-filtered first-line extract when prompts.jsonl is absent', async () => {
    // Hand-written session (no writer → no prompts.jsonl), first line wraps a
    // /command in local-command-caveat chrome plus a real prompt.
    const sid2 = 'e5e5e5e5-6666-7777-8888-999900001111';
    const sdir = join(dir, 'proj', 'sessions', sid2);
    mkdirSync(join(sdir, 'conversations', 'main'), { recursive: true });
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid2, pid: 1, startTs: '2026-01-02T00:00:00.000Z' }));
    writeFileSync(join(sdir, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n');
    writeFileSync(join(sdir, 'conversations', 'main', 'e0.jsonl'), JSON.stringify({
      seq: 1, rid: 'r1', t: 'snapshot', msgs: [
        { role: 'user', content: '<local-command-caveat>Caveat: local commands</local-command-caveat>\n<command-name>/theme</command-name>' },
        { role: 'user', content: 'legacy session real prompt' },
      ],
    }) + '\n');
    const s = listV2Sessions(join(dir, 'proj')).find((x) => x.sid === sid2);
    assert.deepEqual(s.preview, ['legacy session real prompt'], 'chrome filtered even on the fallback path');
  });

  it('validateLogPath v2 branch: valid ref resolves, traversal and missing rejected', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();

    assert.deepEqual(parseV2Ref(`v2:proj/${SID}`), { project: 'proj', sessionId: SID });
    assert.equal(parseV2Ref('v2:proj/../etc'), null, 'dot-only component rejected');
    assert.equal(parseV2Ref('v2:proj/a/b'), null, 'extra separators rejected');
    assert.equal(parseV2Ref('proj.jsonl'), null);

    const resolved = validateLogPath(dir, refOf('proj', SID));
    assert.ok(isV2SessionDir(resolved));
    assert.throws(() => validateLogPath(dir, `v2:proj/${SID_TM}`), /File not found/);
    assert.throws(() => validateLogPath(dir, 'v2:proj/..'), /Invalid v2 log reference/);
    assert.throws(() => validateLogPath(dir, 'v2:pro&j/x'), /Invalid v2 log reference/);
  });
});

// ─── reader version gate (spec §14) ──────────────────────────────────────────
describe('reader version gate (spec §14)', () => {
  const projDir = () => join(dir, 'proj');
  async function buildSession() {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'gate turn 1')]));
    await w.flush();
    return sessionDirOf(SID);
  }

  it('meta.json with an unknown wireFormat refuses the whole session', async () => {
    const sdir = await buildSession();
    const metaPath = join(sdir, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    writeFileSync(metaPath, JSON.stringify({ ...meta, wireFormat: 3 }));

    const session = readSession(projDir(), dirNameOf('proj', SID));
    assert.equal(session.unsupported, true);
    assert.equal(session.wireFormat, 3);
    assert.equal(session.reqs.size, 0, 'empty folds — nothing interpreted');
    assert.deepEqual(readAdapted(sdir), [], 'adapter must yield nothing');
    assert.deepEqual(listV2Sessions(projDir()), [], 'list must skip the session');
  });

  it('journal sentinel version wins over meta.json and refuses too', async () => {
    const sdir = await buildSession();
    const jPath = join(sdir, 'journal.jsonl');
    const lines = readFileSync(jPath, 'utf-8').split('\n');
    lines[0] = JSON.stringify({ ph: 'meta', wireFormat: 99, sessionId: SID });
    writeFileSync(jPath, lines.join('\n'));

    const session = readSession(projDir(), dirNameOf('proj', SID));
    assert.equal(session.unsupported, true);
    assert.equal(session.wireFormat, 99);
    assert.deepEqual(readAdapted(sdir), [], 'meta says 2 but the per-file sentinel wins');
    assert.deepEqual(listV2Sessions(projDir()), [], 'list must honor the sentinel too — no phantom row that opens empty');
  });

  it('missing version everywhere (torn creation) is tolerated as current', async () => {
    const sdir = await buildSession();
    const metaPath = join(sdir, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    delete meta.wireFormat;
    writeFileSync(metaPath, JSON.stringify(meta));
    const jPath = join(sdir, 'journal.jsonl');
    const kept = readFileSync(jPath, 'utf-8').split('\n').filter((l) => l && !l.includes('"ph":"meta"'));
    writeFileSync(jPath, kept.join('\n') + '\n');

    const session = readSession(projDir(), dirNameOf('proj', SID));
    assert.equal(session.unsupported, undefined);
    assert.equal(readAdapted(sdir).length, 1, 'still readable');
  });

  it('verify FAILS a project containing an unsupported session (no silent coverage hole)', async () => {
    const sdir = await buildSession();
    const metaPath = join(sdir, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    writeFileSync(metaPath, JSON.stringify({ ...meta, wireFormat: 3 }));
    const v1File = join(projDir(), 'empty.jsonl');
    writeFileSync(v1File, '');

    const report = await verifyV1File(v1File);
    assert.equal(report.ok, false);
    assert.equal(report.unsupportedSessions.length, 1);
    assert.equal(report.unsupportedSessions[0].wireFormat, 3);
  });
});

// ─── digest normalization (S4 decision 2026-07-14) ───────────────────────────
describe('messagesDigest normalization', () => {
  it('invariant under cache_control migration and string↔block form; still content-sensitive', () => {
    const before = [{ role: 'user', content: 'hello world' }, textMsg('assistant', 'r1')];
    const migrated = [{ role: 'user', content: [{ type: 'text', text: 'hello world', cache_control: { type: 'ephemeral', ttl: '1h' } }] }, textMsg('assistant', 'r1')];
    assert.equal(messagesDigest(before), messagesDigest(migrated), 'v1 reconstruction (old form) must digest-equal v2 replay (migrated form)');

    const edited = [{ role: 'user', content: 'hello world EDITED' }, textMsg('assistant', 'r1')];
    assert.notEqual(messagesDigest(before), messagesDigest(edited), 'real content changes must still diverge');
  });

  it('strips cache_control from ALL top-level blocks, not just content[0]', () => {
    // messageFingerprint only reads content[0], so a digest comparison would
    // pass even without stripping — pin the normalized FULL JSON instead,
    // which is exactly what the converter's exactFps hashes.
    const plain = { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_X1', content: 'result body' },
      { type: 'text', text: 'follow-up' },
    ] };
    const migrated = { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_X1', content: 'result body' },
      { type: 'text', text: 'follow-up', cache_control: { type: 'ephemeral' } },
    ] };
    assert.equal(JSON.stringify(normalizeMsgForEquality(migrated)), JSON.stringify(normalizeMsgForEquality(plain)),
      'cache_control on a NON-FIRST block must be invisible to exactFps equality');
  });
});

// ─── request params fidelity (journal req.params, 2026-07-16) ─────────────────
describe('request params fidelity', () => {
  it('reconstructed body carries all residual params; response.statusText restored', async () => {
    const w = newWriter();
    const e = mainEntry([textMsg('user', 'p1')]);
    e.body = { ...e.body, max_tokens: 32000, temperature: 0.7, stop_sequences: ['###'], thinking: { type: 'enabled', budget_tokens: 1024 } };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, {
      ...e,
      response: { status: 200, statusText: 'OK', headers: { 'x-req': '1' }, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
      duration: 5,
    });
    await w.flush();

    const [entry] = readAdapted(sessionDirOf(SID));
    assert.equal(entry.body.max_tokens, 32000);
    assert.equal(entry.body.temperature, 0.7);
    assert.deepEqual(entry.body.stop_sequences, ['###']);
    assert.deepEqual(entry.body.thinking, { type: 'enabled', budget_tokens: 1024 });
    assert.equal(entry.body.model, 'claude-fable-5', 'dedicated req.model agrees with params.model');
    assert.deepEqual(entry.body.system, SYSTEM, 'blob-backed fields still come from blobs');
    assert.deepEqual(entry.body.tools, TOOLS);
    assert.equal(entry.body.metadata.user_id, userIdOf(SID));
    assert.equal(entry.response.statusText, 'OK');
  });

  it('params-less journal (pre-params session) reconstructs exactly as before', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'old session')]));
    await w.flush();

    // Simulate a session recorded before params existed: strip them from disk.
    const sdir = sessionDirOf(SID);
    const jPath = join(sdir, 'journal.jsonl');
    const stripped = readFileSync(jPath, 'utf-8').trim().split('\n')
      .map((l) => { const { params, ...rest } = JSON.parse(l); return JSON.stringify(rest); })
      .join('\n') + '\n';
    writeFileSync(jPath, stripped);

    const [entry] = readAdapted(sdir);
    assert.deepEqual(Object.keys(entry.body).sort(), ['messages', 'metadata', 'model', 'system', 'tools'],
      'legacy reconstruction shape unchanged');
    assert.deepEqual(entry.body.metadata, { user_id: userIdOf(SID) });
  });

  it('user_id always comes from meta.userIdRaw even when params.metadata differs (-c adoption)', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'adopted')]));
    await w.flush();

    // A `-c` adopted folder mixes real user_ids: rewrite the on-disk params
    // to carry a different user_id plus an extra metadata key.
    const sdir = sessionDirOf(SID);
    const jPath = join(sdir, 'journal.jsonl');
    const rewritten = readFileSync(jPath, 'utf-8').trim().split('\n')
      .map((l) => {
        const line = JSON.parse(l);
        if (line.ph === 'req') line.params = { ...line.params, metadata: { user_id: userIdOf(SID_TM), custom: 'kept' } };
        return JSON.stringify(line);
      })
      .join('\n') + '\n';
    writeFileSync(jPath, rewritten);

    const [entry] = readAdapted(sdir);
    assert.equal(entry.body.metadata.user_id, userIdOf(SID),
      'meta.userIdRaw wins — a params user_id must never split the client timeline');
    assert.equal(entry.body.metadata.custom, 'kept', 'other params.metadata keys are merged');
  });

  it('noid session (no meta.userIdRaw): raw params user_id is dropped, other metadata keys kept', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'noid')]));
    await w.flush();

    // Simulate a noid session: no userIdRaw in meta, an unparseable raw
    // user_id in params.metadata (varying per request in the wild).
    const sdir = sessionDirOf(SID);
    const metaPath = join(sdir, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    delete meta.userIdRaw;
    writeFileSync(metaPath, JSON.stringify(meta));
    const jPath = join(sdir, 'journal.jsonl');
    const rewritten = readFileSync(jPath, 'utf-8').trim().split('\n')
      .map((l) => {
        const line = JSON.parse(l);
        if (line.ph === 'req') line.params = { ...line.params, metadata: { user_id: 'garbage-varies-per-request', custom: 'kept' } };
        return JSON.stringify(line);
      })
      .join('\n') + '\n';
    writeFileSync(jPath, rewritten);

    const [entry] = readAdapted(sdir);
    assert.equal(entry.body.metadata.user_id, undefined,
      'no userIdRaw → raw user_id dropped (would spuriously split the client timeline)');
    assert.equal(entry.body.metadata.custom, 'kept');
  });
});

// ─── corrupt/oversized session containment (issue #129) ──────────────────────
describe('corrupt session containment', () => {
  it('a session whose read throws degrades to skipped — the scan and healthy siblings survive', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'healthy')]));
    await w.flush();

    // Handcraft a corrupt sibling: `conversations` is a regular FILE, so
    // readSession's readdirSync throws (deterministic cross-platform stand-in
    // for the ERR_STRING_TOO_LONG / unreadable-session crash class).
    const badSid = 'deadbeef-dead-4bad-8bad-badbadbadbad';
    const bad = join(dir, 'proj', 'sessions', `20260716000000_${badSid}`);
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: badSid, pid: 1, startTs: '2026-07-16T00:00:00.000Z' }));
    writeFileSync(join(bad, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n');
    writeFileSync(join(bad, 'conversations'), 'not a directory');

    assert.deepEqual([...iterateV2RawEntries(bad)], [], 'corrupt session yields nothing instead of throwing');
    const good = readAdapted(sessionDirOf(SID));
    assert.equal(good.length, 1, 'healthy sibling session still reads fine');
    assert.equal(good[0].body.messages[0].content[0].text, 'healthy');
  });
});

// ─── discardable sessions excluded from listing surfaces (2026-07-16) ─────────
describe('discardable session exclusion', () => {
  const probeDir = (sid, startTs) => {
    const dir = join(dir_probe_root(), `${startTs.replace(/[-:.TZ]/g, '').slice(0, 14)}_${sid}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, project: 'proj', startTs }));
    writeFileSync(join(dir, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
      JSON.stringify({ ph: 'req', seq: 1, rid: 'rq', kind: 'sub', conv: 'sub-fp-x', ts: startTs, url: 'https://api.anthropic.com/v1/messages' }),
      JSON.stringify({ ph: 'done', seq: 1, rid: 'rq', ts: startTs, status: 'ok', http: 429 }),
    ].join('\n') + '\n');
    return dir;
  };
  const dir_probe_root = () => join(dir, 'proj', 'sessions');

  it('listV2Sessions marks quota-probe orphans discard:true; real and teammate sessions false', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'real turn')]));
    await w.flush();
    probeDir('deadbeef-0000-4000-8000-000000000001', '2026-07-16T13:27:10.598Z');

    const sessions = listV2Sessions(join(dir, 'proj'));
    const real = sessions.find((s) => s.sid.endsWith(SID));
    const probe = sessions.find((s) => s.sid.includes('deadbeef'));
    assert.ok(real && probe);
    assert.equal(real.discard, false);
    assert.equal(probe.discard, true);
  });

  it('listV2Logs omits discardable sessions while keeping real ones', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'kept turn')]));
    await w.flush();
    probeDir('deadbeef-0000-4000-8000-000000000002', '2026-07-16T13:27:10.598Z');

    const grouped = listV2Logs(dir, 'proj');
    const rows = grouped.proj || [];
    assert.equal(rows.length, 1, 'only the real session listed');
    assert.ok(!rows[0].file.includes('deadbeef'));
    // Direct addressing stays usable (escape hatch for deleteLogFiles).
    const probePath = probeDir('deadbeef-0000-4000-8000-000000000003', '2026-07-16T13:27:11.598Z');
    const probeRef = `v2:proj/${probePath.split('/').pop()}`;
    assert.ok(validateLogPath(dir, probeRef), 'hidden ≠ unaddressable');
  });

  it('findTeammateSessionDirs never lets a probe act as a leader candidate', async () => {
    // Real leader starts at T1; probe fires at T2 (right after, like a spawn);
    // an orphan teammate (leader without sid) starts at T3. Without the gate
    // the probe (latest ≤ T3) would claim the orphan and the real leader
    // would drop it.
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'leader turn')]));
    await w.flush();
    const leaderDir = sessionDirOf(SID);
    probeDir('deadbeef-0000-4000-8000-000000000004', '2026-07-16T23:59:58.000Z');
    const tmSid = 'facefeed-0000-4000-8000-000000000001';
    const tmDir = join(dir, 'proj', 'sessions', `20260716235959_${tmSid}`);
    mkdirSync(tmDir, { recursive: true });
    writeFileSync(join(tmDir, 'meta.json'), JSON.stringify({
      wireFormat: 2, sessionId: tmSid, project: 'proj', startTs: '2026-07-16T23:59:59.000Z',
      leader: { agentName: 'tm1' }, // leaderless orphan: no parentSessionId
    }));
    writeFileSync(join(tmDir, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: tmSid }) + '\n');

    const found = findTeammateSessionDirs(leaderDir, SID);
    assert.equal(found.length, 1, 'the real leader claims the orphan — the probe cannot steal it');
    assert.ok(found[0].dir === tmDir);
  });
});
