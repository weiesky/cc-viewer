/**
 * wire-v2 S6b (1.7.0) — V2LiveFeed (server/lib/v2/live-feed.js).
 *
 * Deterministic tier: fs.watch is stubbed out and the feed is driven manually
 * through tick() / _safetyTick(), so no timing sleeps are needed. The fixture
 * write side is the REAL V2Writer; assertions compare the live SSE emissions
 * against the cold adapter read fed through the client reconstructor — the
 * cold/live parity gate of plan step 1.2.
 *
 * Data-safety: all fixtures live in mkdtemp dirs; nothing touches a real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync as writeFileSyncFs, appendFileSync as appendFileSyncFs } from 'node:fs';
import { spawnSync as spawnSyncCp } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../packages/app/server/lib/v2/v2-writer.js';
import { V2LiveFeed } from '../packages/app/server/lib/v2/live-feed.js';
import { STAGING_DIR_NAME } from '../packages/app/server/lib/v2/convert.js';
import { sendToClients, sendEventToClients, sendEventRawToClients, sendChunkToClients } from '../packages/app/server/lib/log-watcher.js';
import { iterateV2RawEntries } from '../packages/app/server/lib/v2/adapter.js';
import { readV2RequestsMeta } from '../packages/app/server/lib/v2/meta-rows.js';
import { reconstructEntries } from '../packages/app/server/lib/delta-reconstructor.js';
import { createV3Assembler } from '../apps/web/src/utils/v3Assembler.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';
import { resolveSessionDirName } from '../packages/app/server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2feed-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'd1234567-89ab-4cde-8f01-23456789abcd';
const SID_TM = 'e2345678-9abc-4def-8012-3456789abcde';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [{ name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} }];

let tsCounter = 0;
function nextTs() {
  return new Date(Date.UTC(2026, 6, 14, 6, 0, 0, ++tsCounter)).toISOString();
}

function mainEntry(messages, { sid = SID } = {}) {
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
    requestId: `rid_${++tsCounter}`,
  };
}

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

const projectDirOf = () => join(dir, 'proj');
const sessionDirOf = (sid) => join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), sid) || sid);

/** Fake SSE client capturing everything written to it. */
function fakeClient() {
  return {
    writes: [],
    destroyed: false,
    writable: true,
    write(payload) { this.writes.push(payload); return true; },
    once() {},
    end() {},
  };
}

/** Parse `data:`-event entries out of captured SSE writes. */
function dataEntries(client) {
  const out = [];
  for (const w of client.writes) {
    if (w.startsWith('data: ')) out.push(JSON.parse(w.slice(6, w.indexOf('\n\n'))));
  }
  return out;
}
function eventNames(client) {
  return client.writes.filter((w) => w.startsWith('event: ')).map((w) => w.slice(7, w.indexOf('\n')));
}

const stubWatch = () => ({ close() {}, on() {} });

function newFeed(clients, extra = {}) {
  return new V2LiveFeed({
    clients,
    getClaudePid: () => 4242,
    runParallelHook: () => Promise.resolve(),
    watchImpl: stubWatch,
    safetyPollMs: 0, // driven manually
    ...extra,
  });
}

function newWriter(opts = {}) {
  return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, ...opts });
}

// ─── cold/live parity ────────────────────────────────────────────────────────
describe('V2LiveFeed cold/live parity', () => {
  it('live emissions reconstruct to the same final state as a cold read through the client path', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    const w = newWriter();
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
    for (const msgs of [t1, t2, t3]) fire(w, mainEntry(msgs));
    await w.flush();

    feed.tick(sessionDirOf(SID));
    // The stubbed watcher never fires; the tick attach reads synchronously.
    assert.ok(feed.isFollowing(sessionDirOf(SID)));

    const live = dataEntries(client);
    // req and done land in the same batch → the placeholder is folded away
    // and only the completed frame is emitted (one per request).
    assert.equal(live.length, 3);
    assert.equal(live.filter((e) => e.inProgress).length, 0);
    const liveFinal = live;

    // Cold path: raw adapter output through the client's own reconstruction.
    const cold = reconstructEntries([...iterateV2RawEntries(sessionDirOf(SID))].map((r) => JSON.parse(r)));
    assert.equal(liveFinal.length, cold.length);
    for (let i = 0; i < cold.length; i++) {
      assert.deepEqual(liveFinal[i].body.messages, cold[i].body.messages, `entry ${i} reconstructed messages parity`);
      assert.equal(liveFinal[i]._seq, cold[i]._seq);
      assert.equal(liveFinal[i]._seqEpoch, cold[i]._seqEpoch);
      assert.equal(liveFinal[i].pid, 4242, 'pid stamped by the shared pipeline');
    }

    // Completed main entries produce the kv/context side events like v1 did.
    const events = eventNames(client);
    assert.ok(events.includes('context_window'), 'context_window side event emitted');
  });

  it('emits incrementally: entries written after attach are broadcast on the next tick', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    const before = dataEntries(client).length;
    assert.equal(before, 1);

    fire(w, mainEntry([textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')]));
    await w.flush();
    feed._safetyTick(); // tick() debounces; the safety poll reads synchronously
    const after = dataEntries(client);
    assert.equal(after.length, before + 1, 'exactly the new completed frame');
    const last = after[after.length - 1];
    assert.equal(last.inProgress, undefined);
    assert.equal(last.body.messages.length, 3, 'delta reconstructed to full messages');
  });
});

// ─── suppression & discovery ─────────────────────────────────────────────────
describe('V2LiveFeed suppression and discovery', () => {
  it('a session that predates the feed is followed silently; only new appends emit', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'old turn')]));
    await w.flush();

    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf()); // initial scan: recent mtime → attach suppressed
    assert.ok(feed.isFollowing(sessionDirOf(SID)));
    assert.equal(dataEntries(client).length, 0, 'history suppressed');

    fire(w, mainEntry([textMsg('user', 'old turn'), textMsg('assistant', 'r'), textMsg('user', 'new turn')]));
    await w.flush();
    feed._safetyTick(); // stubbed watcher never fires — safety poll delivers
    const live = dataEntries(client);
    assert.equal(live.length, 1);
    assert.equal(live[0].body.messages.length, 3);
  });

  it('a teammate session appearing cross-process is discovered and emitted with its tag', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    // Leader session first (so the teammate dir appears mid-run).
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'leader turn')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    const baseline = dataEntries(client).length;

    // Cross-process teammate: separate writer instance, own sid, leader meta.
    const tm = newWriter({ leader: { agentName: 'worker-1', teamName: 'team-x', parentSessionId: SID } });
    fire(tm, mainEntry([textMsg('user', 'teammate turn')], { sid: SID_TM }));
    await tm.flush();

    feed._safetyTick(); // discovery fallback path (root watcher is stubbed)
    assert.ok(feed.isFollowing(sessionDirOf(SID_TM)));
    const live = dataEntries(client).slice(baseline);
    assert.ok(live.length >= 1);
    const tmEntries = live.filter((e) => e.teammate === 'worker-1');
    assert.equal(tmEntries.length, 1, 'teammate completed frame emitted');
    assert.equal(tmEntries[0].teamName, 'team-x');
  });

  it('notifyStatsWorker is nudged with the session dir after an emitting batch', async () => {
    const notified = [];
    const client = fakeClient();
    const feed = newFeed([client], { notifyStatsWorker: (d) => notified.push(d) });
    feed.start(projectDirOf());

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    assert.deepEqual(notified, [sessionDirOf(SID)]);
  });

  it('stop() detaches everything and further writes emit nothing', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    const count = dataEntries(client).length;

    feed.stop();
    fire(w, mainEntry([textMsg('user', 'turn 1'), textMsg('assistant', 'r'), textMsg('user', 'turn 2')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    feed._safetyTick();
    assert.equal(dataEntries(client).length, count);
  });
});

// ─── writer onActivity nudge ─────────────────────────────────────────────────
describe('V2Writer onActivity → live feed', () => {
  it('the writer nudges the feed on every ingest (request and completion)', async () => {
    const ticks = [];
    const w = new V2Writer({
      logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0,
      onActivity: (d) => ticks.push(d),
    });
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();
    assert.equal(ticks.length, 2, 'one nudge per ingest phase');
    assert.ok(ticks.every((d) => d === sessionDirOf(SID)));
  });

  it('an in-process tick before the queue drained retries and delivers (no lost first entry)', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    const w = new V2Writer({
      logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0,
      onActivity: (d) => feed.tick(d),
    });
    // ingest fires the nudge synchronously, before any file exists on disk —
    // the meta/dir exist (sync) but journal.jsonl only lands on queue drain.
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.flush();
    // The tick retry timer (250ms) picks the session up.
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.ok(feed.isFollowing(sessionDirOf(SID)), 'retry attached the session');
    assert.equal(dataEntries(client).length, 1);
    feed.stop();
  });
});

// ─── writer generation restart: Fix A+B joint acceptance (2026-07-15) ────────
describe('V2LiveFeed across a writer restart continuation', () => {
  it('a fresh writer generation continues in the latest epoch and live stays cold-parity', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    // Generation A: two turns, then a /clear continuation (opens e1).
    const wA = newWriter();
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    const clear = [textMsg('user', '<command-name>/clear</command-name>'), textMsg('assistant', 'fresh')];
    for (const msgs of [t1, t2, clear]) fire(wA, mainEntry(msgs));
    await wA.flush();
    feed.tick(sessionDirOf(SID));

    // Generation B: process restart onto the same session dir (`-c`). The
    // fresh ConversationStore must seed epoch=1 from disk — its snapshot and
    // all later events land in e1, keeping file order == seq order.
    const wB = newWriter();
    const cont = [...clear, textMsg('user', 'after restart')];
    fire(wB, mainEntry(cont));
    await wB.flush();
    feed._safetyTick(); // tick() debounces; the safety poll reads synchronously

    const e0 = readFileSync(join(sessionDirOf(SID), 'conversations', 'main', 'e0.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const e1 = readFileSync(join(sessionDirOf(SID), 'conversations', 'main', 'e1.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(Math.max(...e0.map((l) => l.seq)) < Math.min(...e1.map((l) => l.seq)),
      'restart continuation landed in e1 — cross-file seq order preserved (Fix A)');

    // Live emissions reconstruct to the same final state as a cold read.
    const live = dataEntries(client);
    const cold = reconstructEntries([...iterateV2RawEntries(sessionDirOf(SID))].map((r) => JSON.parse(r)));
    assert.equal(live.length, cold.length, 'every generation-B entry emitted live');
    for (let i = 0; i < cold.length; i++) {
      assert.deepEqual(live[i].body.messages, cold[i].body.messages, `entry ${i} parity across the restart`);
    }
  });
});

// ─── wire v3 live rows — chat live-render regression (2026-07-16) ─────────────
// The live row builder (_rowFrom) omitted conv/evt, so the client assembler's
// `if (row.conv)` gate rebuilt every live entry with EMPTY messages: the chat
// vanished at stream end until a cold reload. These tests run the feed in
// wireV3 mode (previously ZERO v3-mode live-feed coverage) and replay its
// emitted frames through the REAL client assembler.

/** Parse `event: <name>\ndata: <json>\n\n` frames in write order. */
function namedFrames(client) {
  const out = [];
  for (const w of client.writes) {
    if (!w.startsWith('event: ')) continue;
    const nl = w.indexOf('\n');
    const event = w.slice(7, nl);
    const dataStart = w.indexOf('data: ', nl) + 6;
    out.push({ event, data: JSON.parse(w.slice(dataStart, w.indexOf('\n\n', dataStart))) });
  }
  return out;
}

describe('wire v3 live rows → client assembler', () => {
  it('rows carry conv/evt/kind/mainAgent (journal truth) and assemble to non-empty messages', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());

    const w = newWriter();
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    fire(w, mainEntry(t1));
    fire(w, mainEntry(t2));
    await w.flush();
    feed.tick(sessionDirOf(SID));

    const frames = namedFrames(client);
    const rows = frames.filter((f) => f.event === 'v2_requests_delta').map((f) => f.data);
    const completed = rows.filter((r) => !r.inProgress);
    assert.equal(completed.length, 2);
    assert.equal(completed[0].conv, 'main', 'live row names its conv channel (the regression)');
    assert.equal(completed[0].evt, 'snapshot', 'first conversation event is a snapshot');
    assert.equal(completed[1].evt, 'append');
    for (const r of completed) {
      assert.equal(r.kind, 'main');
      assert.equal(r.mainAgent, true);
    }

    // End-to-end: replay the emitted frames through the REAL client assembler
    // in write order (mirrors _applyV3Conv/_applyV3Resp/_applyV3Delta).
    const asm = createV3Assembler();
    const built = [];
    for (const f of frames) {
      if (f.event === 'v3_conv') asm.addConvLines(f.data.sessionId, f.data.channel, f.data.line);
      else if (f.event === 'v3_resp') asm.addRespLines(f.data.sessionId, f.data.line);
      else if (f.event === 'v2_requests_delta') {
        const e = asm.buildEntry(f.data);
        if (!f.data.inProgress) built.push(e);
      }
    }
    assert.equal(built.length, 2);
    const cold = reconstructEntries([...iterateV2RawEntries(sessionDirOf(SID))].map((r) => JSON.parse(r)));
    for (let i = 0; i < built.length; i++) {
      assert.ok(built[i].body.messages.length > 0, `entry ${i}: live-assembled messages must not be empty`);
      assert.deepEqual(built[i].body.messages, cold[i].body.messages, `entry ${i}: parity with cold reconstruction`);
      assert.ok(built[i].response && built[i].response.body, `entry ${i}: completed entry carries response body`);
    }
    assert.equal(built[0]._isCheckpoint, true, 'snapshot evt → checkpoint marker');
  });

  it('completed live rows are field-parallel to cold fold rows', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'parity turn')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));

    const liveRow = namedFrames(client)
      .filter((f) => f.event === 'v2_requests_delta').map((f) => f.data)
      .find((r) => !r.inProgress);
    const { rows: coldRows } = await readV2RequestsMeta(sessionDirOf(SID), { passB: false });
    const coldRow = coldRows.find((r) => r.seq === liveRow.seq);
    assert.ok(coldRow);
    for (const field of ['conv', 'evt', 'kind', 'mainAgent', 'timestamp', 'url', 'method', 'status', 'duration']) {
      assert.deepEqual(liveRow[field], coldRow[field], `field ${field} live/cold parity`);
    }
    assert.deepEqual(liveRow.usage, coldRow.usage, 'usage mapping parity');
  });

  it('countTokens: kind is journal truth, mainAgent stays false live AND cold (chat-pollution pin)', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());

    // The FULL main-agent tool set: isMainAgentRequest needs >5 tools incl.
    // Edit+Bash+Task, so this body genuinely trips the re-derivation the fix
    // outlaws (a 2-tool stub would pass with or without the fix).
    const MAIN_TOOLS = ['Edit', 'Bash', 'Task', 'Read', 'Write', 'Glob', 'Grep'].map((name) => ({ name, input_schema: {} }));
    const w = newWriter();
    const main = mainEntry([textMsg('user', 'real main turn')]);
    main.body.tools = MAIN_TOOLS;
    fire(w, main);
    // countTokens probe wearing the FULL main-agent body (system + tools):
    // the old parsed.mainAgent re-derivation mis-tagged exactly this shape.
    const ct = mainEntry([textMsg('user', 'count me')]);
    ct.body.tools = MAIN_TOOLS;
    ct.url = 'https://api.anthropic.com/v1/messages/count_tokens?beta=true';
    ct.mainAgent = false;
    ct.isCountTokens = true;
    fire(w, ct);
    await w.flush();
    feed.tick(sessionDirOf(SID));

    const rows = namedFrames(client)
      .filter((f) => f.event === 'v2_requests_delta').map((f) => f.data)
      .filter((r) => !r.inProgress);
    const ctRow = rows.find((r) => r.url.includes('count_tokens'));
    assert.ok(ctRow);
    assert.equal(ctRow.kind, 'countTokens', 'journal-truth kind, not the sub fallback');
    assert.equal(ctRow.mainAgent, false, 'kind-derived mainAgent — a main-shaped body must not pollute the chat');
    assert.equal(ctRow.conv, 'misc', 'countTokens conversations live under misc');

    // Cold parity through the DEFAULT Pass B (the path the client actually
    // loads): attachBodyFields must not re-derive mainAgent from the
    // blob-backfilled body either, or the pollution returns on reload.
    const { rows: coldRows } = await readV2RequestsMeta(sessionDirOf(SID), {});
    const coldCt = coldRows.find((r) => r.url.includes('count_tokens'));
    assert.ok(coldCt);
    assert.equal(coldCt.mainAgent, false, 'cold Pass B mainAgent stays kind-derived');
    assert.equal(coldCt.kind, 'countTokens');
  });

  it('live/cold mainAgent parity holds through the default Pass B for real main rows', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'main turn')]));
    await w.flush();
    feed.tick(sessionDirOf(SID));

    const liveRow = namedFrames(client)
      .filter((f) => f.event === 'v2_requests_delta').map((f) => f.data)
      .find((r) => !r.inProgress);
    const { rows: coldRows } = await readV2RequestsMeta(sessionDirOf(SID), {});
    const coldRow = coldRows.find((r) => r.seq === liveRow.seq);
    assert.equal(liveRow.mainAgent, true);
    assert.equal(coldRow.mainAgent, true, 'kind-derived on both paths — real mains unaffected');
  });
});

// ─── readNewLines chunked cursor reader (issue #129 twin) ─────────────────────
describe('readNewLines chunked cursor', () => {
  it('splits lines across tiny chunks byte-exact, carries the partial tail across calls', async () => {
    const { readNewLines } = await import('../packages/app/server/lib/v2/live-feed.js');
    const { writeFileSync, appendFileSync } = await import('node:fs');
    const p = join(dir, 'cursor.jsonl');
    const l1 = JSON.stringify({ seq: 1, t: '中文跨块内容' });
    const l2 = JSON.stringify({ seq: 2, pad: 'x'.repeat(37) });
    writeFileSync(p, l1 + '\n' + l2 + '\n{"seq":3,"partial"');
    const cursor = { path: p, offset: 0, pending: '' };
    assert.deepEqual(readNewLines(cursor, 5), [l1, l2], 'complete lines only; 5-byte chunks tear nothing');
    // the torn tail stays pending until its newline arrives
    appendFileSync(p, ':true}\n');
    assert.deepEqual(readNewLines(cursor, 5), ['{"seq":3,"partial":true}']);
    assert.deepEqual(readNewLines(cursor, 5), [], 'cursor fully drained');
  });
});

// ─── discardable sessions never followed (2026-07-16) ─────────────────────────
describe('discardable session attach gate', () => {
  it('a quota-probe orphan is not attached; it attaches once a main req lands', async () => {
    const { writeFileSync: wf, mkdirSync: mk, appendFileSync: af } = await import('node:fs');
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    const sid = 'deadbeef-0000-4000-8000-00000000000a';
    const probe = join(dir, 'proj', 'sessions', `20260716132710_${sid}`);
    mk(join(probe, 'conversations', 'sub-fp-x'), { recursive: true });
    wf(join(probe, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs: '2026-07-16T13:27:10.598Z', project: 'proj' }));
    wf(join(probe, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
      JSON.stringify({ ph: 'req', seq: 1, rid: 'rq', kind: 'sub', conv: 'sub-fp-x', ts: '2026-07-16T13:27:10.598Z', url: 'u' }),
      JSON.stringify({ ph: 'done', seq: 1, rid: 'rq', ts: '2026-07-16T13:27:12.168Z', status: 'ok', http: 429 }),
    ].join('\n') + '\n');

    feed.tick(probe);
    assert.equal(feed.isFollowing(probe), false, 'probe-only dir refused at _attach');
    assert.equal(dataEntries(client).length, 0, 'zero frames emitted for the probe');

    // The dir later gains a real main turn → the gate flips and attach works
    // (safety poll / tick re-attempt path).
    af(join(probe, 'journal.jsonl'),
      JSON.stringify({ ph: 'req', seq: 2, rid: 'rm', kind: 'main', conv: 'main', ts: '2026-07-16T13:28:00.000Z', url: 'u' }) + '\n');
    feed._safetyTick();
    assert.equal(feed.isFollowing(probe), true, 'main-bearing dir attaches on the next poll');
    // First real attach of a previously-gated dir must NOT suppress history:
    // cross-process observers have no cold-load fallback, so the first main
    // turn (in-flight placeholder here) must be broadcast, not swallowed.
    const emitted = dataEntries(client);
    assert.ok(emitted.some((e) => e.inProgress && e._seq === 2),
      'the first main turn is broadcast on the gated→real attach');
  });

  it('readNewLines skips an oversized line (maxLineBytes seam); neighbors survive, skip-state resets', async () => {
    const { readNewLines } = await import('../packages/app/server/lib/v2/live-feed.js');
    const { writeFileSync: wf } = await import('node:fs');
    const p = join(dir, 'oversize.jsonl');
    const big = JSON.stringify({ seq: 2, blob: 'y'.repeat(200) });
    wf(p, `{"seq":1}\n${big}\n{"seq":3}\n`);
    const cursor = { path: p, offset: 0 };
    assert.deepEqual(readNewLines(cursor, 16, 64), ['{"seq":1}', '{"seq":3}'],
      'the ERR_STRING_TOO_LONG class degrades to a skipped line in the cursor reader too');
  });

  it('teammate live rows carry journal-truth kind/conv and mainAgent:false (wire v3)', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());

    // Teammate identity rides the WRITER (a teammate process constructs its
    // own V2Writer with leader info), plus the entry-level teammate tag.
    const w = newWriter({ leader: { agentName: 'tm1', teamName: 'teamA', parentSessionId: SID } });
    const tm = mainEntry([textMsg('user', 'teammate work')], { sid: SID_TM });
    tm.teammate = 'tm1';
    tm.teamName = 'teamA';
    fire(w, tm);
    await w.flush();
    const tmDir = sessionDirOf(SID_TM);
    feed.tick(tmDir);
    assert.equal(feed.isFollowing(tmDir), true, 'teammate dir (meta.leader) is never discard-gated');

    const rows = namedFrames(client)
      .filter((f) => f.event === 'v2_requests_delta').map((f) => f.data)
      .filter((r) => !r.inProgress);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'teammate', 'journal-truth kind');
    assert.equal(rows[0].mainAgent, false, 'kind-derived: teammate is never mainAgent');
    assert.equal(rows[0].conv, 'main', 'teammate conversations ride the main channel');
    assert.equal(rows[0].teammate, 'tm1');
  });
});

// ─── migration promote → live feed OOM guard (2026-07-17) ─────────────────────
// convertProject's promote loop renames every staged session into sessions/;
// each promoted dir used to attach as a "brand-new live session" and replay its
// ENTIRE history through synthesis + JSON round-trips inside the safety-poll /
// debounce timers — the 4GB main-thread OOM. Convert output is dead history:
// it must attach seeked to EOF, reading and broadcasting nothing.
describe('migration promote → live feed (OOM guard)', () => {
  it('a promoted convert-origin session attaches seeked to EOF: zero read, zero broadcast', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    // Write into the staging tree exactly like the converter does.
    const w = newWriter({ sessionsDirName: STAGING_DIR_NAME, metaExtra: { origin: 'convert', convertedAt: nextTs() } });
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    for (const msgs of [t1, t2]) fire(w, mainEntry(msgs));
    await w.close();

    // Promote exactly like convert.js: renameSync staging → sessions/.
    const stagedName = resolveSessionDirName(projectDirOf(), SID, STAGING_DIR_NAME);
    mkdirSync(join(projectDirOf(), 'sessions'), { recursive: true });
    const promoted = join(projectDirOf(), 'sessions', stagedName);
    renameSync(join(projectDirOf(), STAGING_DIR_NAME, stagedName), promoted);

    feed._safetyTick(); // discovery (root watcher is stubbed) — the production path
    assert.equal(feed.isFollowing(promoted), true, 'promoted dir is followed (future appends admissible)');
    assert.equal(client.writes.length, 0, 'zero SSE frames of any kind — no history replay');

    const cur = feed._sessions.get(promoted);
    assert.equal(cur.convertOrigin, true);
    assert.equal(cur.journal.offset, statSync(cur.journal.path).size, 'journal seeked to EOF');
    const e0 = join(promoted, 'conversations', 'main', 'e0.jsonl');
    assert.ok(cur.convFiles.has(e0), 'pre-existing conv epoch enumerated up front');
    assert.equal(cur.convFiles.get(e0).offset, statSync(e0).size, 'conv epoch seeked to EOF');

    // Theoretical post-promote append (a writer restart onto the same dir):
    // bytes past the seeked offsets still flow — nothing is permanently muted.
    const wB = newWriter();
    const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
    fire(wB, mainEntry(t3));
    await wB.flush();
    feed._safetyTick();
    const live = dataEntries(client);
    assert.equal(live.length, 1, 'post-promote append is delivered');
    assert.equal(live[0].body.messages.length, 5, 'restart snapshot materializes full messages');
  });

  it('unreadable meta.json never falls through to a full replay', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'turn 1')]));
    await w.close();
    unlinkSync(join(sessionDirOf(SID), 'meta.json'));

    // Mid-conversion: treated as convert output (seek-to-EOF).
    const clientA = fakeClient();
    const feedA = newFeed([clientA], { isConvertRunningFn: () => true });
    feedA.start(projectDirOf());
    feedA.tick(sessionDirOf(SID));
    assert.equal(feedA.isFollowing(sessionDirOf(SID)), true);
    assert.equal(feedA._sessions.get(sessionDirOf(SID)).convertOrigin, true, 'convert-running fallback');
    assert.equal(clientA.writes.length, 0);
    feedA.stop();

    // No conversion running: seeded suppressed (cold load owns the history).
    const clientB = fakeClient();
    const feedB = newFeed([clientB], { isConvertRunningFn: () => false });
    feedB.start(projectDirOf()); // initial scan attaches (recent mtime), suppressed by fallback
    feedB.tick(sessionDirOf(SID));
    assert.equal(feedB.isFollowing(sessionDirOf(SID)), true);
    assert.equal(dataEntries(clientB).length, 0, 'history suppressed, not replayed');
    feedB.stop();
  });

  it('idle cursors are evicted; a tick() re-attach replays nothing and new appends still flow', async () => {
    const client = fakeClient();
    const feed = newFeed([client]); // default idleEvictMs — no accidental eviction
    feed.start(projectDirOf());
    const w = newWriter();
    const t1 = [textMsg('user', 'turn 1')];
    fire(w, mainEntry(t1));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    assert.equal(dataEntries(client).length, 1);

    // Let the journal mtime go stale relative to a 1ms threshold, then evict.
    await new Promise((r) => setTimeout(r, 25));
    feed._idleEvictMs = 1;
    feed._safetyTick();
    assert.equal(feed.isFollowing(sessionDirOf(SID)), false, 'idle cursor evicted');
    feed._idleEvictMs = 10 * 60 * 1000; // restore so the tail of the test reads, not evicts

    // Resume: the entry that lands during the eviction gap is history on
    // re-attach (seen dir → suppressed seed) — no replay through the broadcast
    // path (the OOM shape), the cold-load channel owns it.
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    fire(w, mainEntry(t2));
    await w.flush();
    feed.tick(sessionDirOf(SID));
    assert.equal(feed.isFollowing(sessionDirOf(SID)), true, 'tick() re-attached');
    assert.equal(dataEntries(client).length, 1, 'no history replay on re-attach');

    // Post-re-attach appends broadcast live again.
    const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
    fire(w, mainEntry(t3));
    await w.flush();
    feed._safetyTick();
    const live = dataEntries(client);
    assert.equal(live.length, 2, 'increment after re-attach is live');
    assert.equal(live[1].body.messages.length, 5);
  });

  it('a cursor with an open (in-flight) request is never evicted mid-flight', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());
    const w = newWriter();
    const entry = mainEntry([textMsg('user', 'long turn')]);
    const h = fire(w, entry, { complete: false }); // req only — journal mtime now frozen
    await w.flush();
    feed.tick(sessionDirOf(SID));
    const placeholders = dataEntries(client);
    assert.equal(placeholders.length, 1);
    assert.ok(placeholders[0].inProgress, 'placeholder broadcast at request start');

    // The journal looks idle (req line was its last touch), but the request
    // is open — eviction must skip it or the placeholder is stranded forever.
    await new Promise((r) => setTimeout(r, 25));
    feed._idleEvictMs = 1;
    feed._safetyTick();
    assert.equal(feed.isFollowing(sessionDirOf(SID)), true, 'open request pins the cursor');

    // Completion lands → still attached → resolved live, not swallowed.
    w.ingestCompletion(h, {
      ...entry,
      response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
      duration: 5,
    });
    await w.flush();
    feed._safetyTick();
    const completed = dataEntries(client).filter((e) => !e.inProgress);
    assert.equal(completed.length, 1, 'completion broadcast live');

    // With no request open the idle eviction reclaims the cursor as usual.
    await new Promise((r) => setTimeout(r, 25));
    feed._safetyTick();
    assert.equal(feed.isFollowing(sessionDirOf(SID)), false, 'evictable once idle AND no open request');
  });

  it('wire v3 mode: a promoted convert session emits no v3 frames either', async () => {
    const client = fakeClient();
    const feed = newFeed([client], { wireV3: true });
    feed.start(projectDirOf());

    const w = newWriter({ sessionsDirName: STAGING_DIR_NAME, metaExtra: { origin: 'convert', convertedAt: nextTs() } });
    fire(w, mainEntry([textMsg('user', 'migrated turn')]));
    await w.close();
    const stagedName = resolveSessionDirName(projectDirOf(), SID, STAGING_DIR_NAME);
    mkdirSync(join(projectDirOf(), 'sessions'), { recursive: true });
    const promoted = join(projectDirOf(), 'sessions', stagedName);
    renameSync(join(projectDirOf(), STAGING_DIR_NAME, stagedName), promoted);

    feed._safetyTick();
    assert.equal(feed.isFollowing(promoted), true);
    assert.equal(client.writes.length, 0, 'no v3_conv/v3_resp/v2_requests_delta frames on convert attach');
  });
});

// ─── SSE senders zero-client short-circuit (2026-07-17) ───────────────────────
describe('SSE senders zero-client short-circuit', () => {
  it('with no clients the payload is never built (no stringify of huge entries)', () => {
    // A landmine object: any JSON.stringify attempt throws.
    const landmine = { get boom() { throw new Error('stringified'); } };
    // Sanity: with a client attached the payload IS built (and throws) —
    // proving the zero-client path is what skips construction.
    assert.throws(() => sendToClients([fakeClient()], landmine));
    assert.throws(() => sendEventToClients([fakeClient()], 'x', landmine));
    // Zero clients: all four senders return before touching the data.
    sendToClients([], landmine);
    sendEventToClients([], 'x', landmine);
    sendEventRawToClients([], 'x', '{}');
    sendChunkToClients([], '{}');
  });
});

// ─── multi-window isolation: foreign live-owner gate (2026-07-17) ────────────
// A session dir exclusively claimed (owner.lock, pid-liveness validity) by
// ANOTHER live process must never enter this feed — a parallel ccv window's
// traffic broadcasting into this window's SSE clients was the live half of the
// cross-window mixing bug. Real predicate, no mocks: process.ppid (the live
// test runner) stands in for the other window; a reaped child pid for a
// crashed one.
describe('foreign live-owner attach gate', () => {
  const claimAs = (sdir, pid) =>
    writeFileSyncFs(join(sdir, 'owner.lock'), JSON.stringify({ pid, startedAt: '2026-07-17T00:00:00.000Z' }));

  async function seedForeignSession() {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'other window secret')]));
    await w.flush();
    await w.close(); // releases OUR claim…
    const sdir = sessionDirOf(SID);
    claimAs(sdir, process.ppid); // …and the "other window" claims it, alive
    return sdir;
  }

  it('a dir claimed by another LIVE process is refused at _attach and lands in no gate set', async () => {
    const sdir = await seedForeignSession();
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf()); // _initialScan sees the recent dir
    assert.equal(feed.isFollowing(sdir), false, 'foreign-live dir never followed');
    assert.equal(feed._discardGated.has(sdir), false, 'never routed through _discardGated (its delete side-effect would un-suppress history later)');
    assert.equal(dataEntries(client).length, 0, 'zero frames leaked to this window');
  });

  it('a DEAD owner claim does not block following (crash auto-release)', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'crashed window history')]));
    await w.flush();
    await w.close();
    const sdir = sessionDirOf(SID);
    const deadPid = spawnSyncCp(process.execPath, ['-e', '']).pid; // exited → dead
    claimAs(sdir, deadPid);
    const feed = newFeed([fakeClient()]);
    feed.start(projectDirOf());
    assert.equal(feed.isFollowing(sdir), true, 'dead claim = unowned; the dir follows as before');
  });

  it('an ATTACHED dir that turns foreign-owned is detached by the safety tick before its cursor is re-read', async () => {
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'was unowned')]));
    await w.flush();
    await w.close(); // release → dir is unowned and attach-eligible
    const sdir = sessionDirOf(SID);
    feed._safetyTick();
    assert.equal(feed.isFollowing(sdir), true, 'unowned recent dir followed');

    // Another window adopts the dir (ccv -c after the first window closed).
    claimAs(sdir, process.ppid);
    feed._safetyTick();
    assert.equal(feed.isFollowing(sdir), false, 'ownership re-check detached the cursor');

    // The adopter keeps writing: mtime bumps trigger re-attach attempts that
    // the gate keeps refusing — nothing from the adopter reaches this window.
    const before = dataEntries(client).length;
    appendFileSyncFs(join(sdir, 'journal.jsonl'),
      JSON.stringify({ ph: 'req', seq: 99, rid: 'foreign', kind: 'main', conv: 'main', ts: '2026-07-17T00:01:00.000Z', url: 'u' }) + '\n');
    feed._safetyTick();
    assert.equal(feed.isFollowing(sdir), false, 'still gated while the adopter lives');
    assert.equal(dataEntries(client).length, before, 'no foreign frames emitted after the adoption');
  });

  it('a dir that is BOTH discardable AND foreign-live: foreign gate wins, _discardGated stays empty until the owner dies', async () => {
    // A quota-probe-shaped dir (sub-only journal, no meta.leader) claimed by a
    // live foreign process. The foreign gate must refuse it BEFORE the discard
    // gate ever sees it; once the owner dies, the discard gate takes over with
    // its own (unsuppress-on-first-real-attach) semantics.
    const sid = 'deadbeef-0000-4000-8000-00000000000b';
    const probe = join(dir, 'proj', 'sessions', `20260717000000_${sid}`);
    mkdirSync(probe, { recursive: true });
    writeFileSyncFs(join(probe, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, startTs: '2026-07-17T00:00:00.000Z', project: 'proj' }));
    writeFileSyncFs(join(probe, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
      JSON.stringify({ ph: 'req', seq: 1, rid: 'rq', kind: 'sub', conv: 'sub-fp-x', ts: 't', url: 'u' }),
    ].join('\n') + '\n');
    claimAs(probe, process.ppid); // foreign, alive

    const feed = newFeed([fakeClient()]);
    feed.start(projectDirOf());
    feed._safetyTick();
    assert.equal(feed.isFollowing(probe), false, 'refused');
    assert.equal(feed._discardGated.has(probe), false, 'foreign gate ran first — discard bookkeeping untouched');

    // Owner dies → next attach attempt falls through to the discard gate.
    const deadPid = spawnSyncCp(process.execPath, ['-e', '']).pid;
    claimAs(probe, deadPid);
    appendFileSyncFs(join(probe, 'journal.jsonl'), JSON.stringify({ ph: 'done', seq: 1, rid: 'rq', ts: 't', status: 'ok' }) + '\n');
    feed._safetyTick();
    assert.equal(feed.isFollowing(probe), false, 'still a main-less probe — discard gate refuses now');
    assert.equal(feed._discardGated.has(probe), true, 'and its self-healing bookkeeping engages normally');
  });

  it('after the foreign owner dies, renewed activity re-attaches with history SUPPRESSED (no flood)', async () => {
    const sdir = await seedForeignSession();
    const client = fakeClient();
    const feed = newFeed([client]);
    feed.start(projectDirOf());
    assert.equal(feed.isFollowing(sdir), false);

    // Owner "dies": replace the live claim with a reaped child's pid, then the
    // dir sees new bytes (e.g. this process adopts it later, or a stray flush).
    const deadPid = spawnSyncCp(process.execPath, ['-e', '']).pid;
    claimAs(sdir, deadPid);
    appendFileSyncFs(join(sdir, 'journal.jsonl'),
      JSON.stringify({ ph: 'req', seq: 98, rid: 'late', kind: 'main', conv: 'main', ts: '2026-07-17T00:02:00.000Z', url: 'u' }) + '\n');
    feed._safetyTick();
    assert.equal(feed.isFollowing(sdir), true, 'dead-owner dir re-attaches on the mtime bump');
    const leaked = dataEntries(client).filter((e) => JSON.stringify(e).includes('other window secret'));
    assert.equal(leaked.length, 0, 'the pre-existing history stays suppressed — cold load owns it');
  });
});
