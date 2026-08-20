/**
 * wire-v2 S10a — two-pass windowed synthesis (server/lib/v2/adapter.js).
 *
 * The 2026-07-15 OOM: the single-pass readV2WindowedEntries stringified and
 * RETAINED every synthesized entry (~10x on-disk expansion resident per load)
 * even when only a tail window was returned. The two-pass rewrite selects the
 * window over light descriptors (Pass A, same pump/gate/replay semantics) and
 * materializes only its members (Pass B). These tests pin:
 *   - golden equality: two-pass window output is byte-identical to the naive
 *     full-stream dedup+slice reference (the historical algorithm)
 *   - `since` pushdown: the streaming reader materializes and delivers exactly
 *     the deduped winners at/after `since` (the /events incremental path)
 *   - crash-orphan parity: a journal req whose conv event never landed is
 *     excluded from window membership exactly like the full synthesis skips it
 *   - mainAgentRing: the newest ≤3 isMain raws are folded into the result
 *     (onScan replacement); teammate-session mains and sub entries whose
 *     backfilled body merely LOOKS main-agent are excluded — the latter is an
 *     intentional divergence from the old `"mainAgent":true` substring filter
 *     (algorithm review F4: kind is the ground truth, the recomputed body flag
 *     is not)
 *
 * Data-safety: all fixtures live in mkdtemp dirs; nothing touches a real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { iterateV2RawEntries, readV2WindowedEntries, streamV2WindowedEntries } from '../server/lib/v2/adapter.js';
import { _resetForTest } from '@ccv/core/error-report';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2win-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'c1234567-89ab-4cde-8f01-23456789abcd';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
// >5 tools with Edit+Bash+Task — satisfies isMainAgentRequest's tool triad, so
// a body carrying these RECOMPUTES as main-agent (the hand-crafted sub fixture
// below depends on that).
const TOOLS = [
  { name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} },
  { name: 'Task', input_schema: {} }, { name: 'Write', input_schema: {} },
  { name: 'Grep', input_schema: {} }, { name: 'Glob', input_schema: {} },
];

let tsCounter = 0;
function nextTs() {
  return new Date(Date.UTC(2026, 6, 14, 5, 0, 0, ++tsCounter)).toISOString();
}

function mainEntry(messages) {
  return {
    timestamp: nextTs(),
    project: 'proj',
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(SID) }, messages },
    response: null,
    duration: 0,
    isStream: false,
    isHeartbeat: false,
    isCountTokens: false,
    mainAgent: true,
    requestId: `rid_${++tsCounter}`,
  };
}

function subEntry(messages) {
  const e = mainEntry(messages);
  e.mainAgent = false;
  // A sub-agent system prompt that does NOT satisfy isMainAgentRequest.
  e.body.system = [{ type: 'text', text: 'You are a file search specialist working on a subtask.' }];
  return e;
}

function newWriter(extra = {}) {
  return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, ...extra });
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

const sessionDirOf = (sid) => join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), sid) || sid);

/** The historical single-pass algorithm as an independent reference: dedup the
 *  FULL synthesized stream (timestamp|url, last wins), then tail-slice. The
 *  baseline promotion is excluded — asserted structurally where it applies. */
function naiveWindowReference(sessionDir, limit) {
  const dedup = new Map();
  let nokey = 0;
  for (const raw of iterateV2RawEntries(sessionDir)) {
    const e = JSON.parse(raw);
    const key = e.timestamp && e.url ? `${e.timestamp}|${e.url}` : `__nokey_${nokey++}`;
    dedup.set(key, raw);
  }
  let recs = [...dedup.values()];
  const totalCount = recs.length;
  let hasMore = false;
  if (limit > 0 && recs.length > limit) {
    hasMore = true;
    recs = recs.slice(recs.length - limit);
  }
  return { entries: recs, totalCount, hasMore };
}

async function buildDeltaHeavySession({ entries = 6 } = {}) {
  const w = newWriter();
  const msgs = [textMsg('user', 'turn 1')];
  fire(w, mainEntry([...msgs]));
  for (let i = 2; i <= entries; i++) {
    msgs.push(textMsg('assistant', `r${i - 1}`), textMsg('user', `turn ${i}`));
    fire(w, mainEntry([...msgs]));
  }
  await w.flush();
  return { sessionDir: sessionDirOf(SID), finalMsgs: msgs };
}

// ─── golden equality vs the historical algorithm ─────────────────────────────
describe('two-pass golden equality', () => {
  it('a checkpoint-start window is byte-identical to the naive full-stream reference', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    // limit == totalCount → window starts at the organic checkpoint, no promotion.
    const ref = naiveWindowReference(sessionDir, 6);
    const win = await readV2WindowedEntries(sessionDir, { limit: 6 });
    assert.deepEqual(win.entries, ref.entries, 'byte-identical to the single-pass reference');
    assert.equal(win.totalCount, ref.totalCount);
    assert.equal(win.hasMore, ref.hasMore);
  });

  it('a delta-start window matches the reference except the promoted baseline head', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    const ref = naiveWindowReference(sessionDir, 3);
    const win = await readV2WindowedEntries(sessionDir, { limit: 3 });
    assert.equal(win.entries.length, ref.entries.length);
    assert.equal(win.totalCount, ref.totalCount);
    assert.equal(win.hasMore, ref.hasMore);
    // Non-head slots: byte-identical.
    assert.deepEqual(win.entries.slice(1), ref.entries.slice(1));
    // Head slot: same entry, promoted to a checkpoint over the replayed state
    // (everything except the envelope flag and messages is unchanged).
    const head = JSON.parse(win.entries[0]);
    const refHead = JSON.parse(ref.entries[0]);
    assert.equal(refHead._isCheckpoint, false, 'reference head is a delta');
    assert.equal(head._isCheckpoint, true, 'window head promoted');
    assert.equal(head.timestamp, refHead.timestamp);
    assert.equal(head._seq, refHead._seq);
    assert.equal(head.body.messages.length, head._totalMessageCount, 'carries full replayed state');
    assert.deepEqual({ ...head, _isCheckpoint: false, body: { ...head.body, messages: refHead.body.messages } }, refHead,
      'promotion changed ONLY the checkpoint flag and messages');
  });

  it('unlimited window (limit=0) equals the full deduped stream byte-for-byte', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    const ref = naiveWindowReference(sessionDir, 0);
    const win = await readV2WindowedEntries(sessionDir, {});
    assert.deepEqual(win.entries, ref.entries);
    assert.equal(win.hasMore, false);
  });

  it('duplicate timestamp|url: last-wins dedup holds, byte-identical, no pass divergence', async () => {
    // The real-data hazard the whole two-pass keying rests on: Pass A dedups by
    // `ts|url`, Pass B's materialize predicate keys by `(sessionId,seq)`. They
    // only have to AGREE when a collision drops a seq. Same-ms same-url bursts
    // (S8 convert notes: countTokens) produce exactly this. A divergence would
    // surface as a dropped slot (shorter entries) or a wrong last-winner.
    const w = newWriter();
    const msgs = [textMsg('user', 'turn 1')];
    fire(w, mainEntry([...msgs]));
    msgs.push(textMsg('assistant', 'r1'), textMsg('user', 'turn 2'));
    const e2 = mainEntry([...msgs]);
    msgs.push(textMsg('assistant', 'r2'), textMsg('user', 'turn 3'));
    const e3 = mainEntry([...msgs]);
    e3.timestamp = e2.timestamp; // force ts collision (url is already identical)
    fire(w, e2);
    fire(w, e3);
    await w.flush();
    const sessionDir = sessionDirOf(SID);

    const ref = naiveWindowReference(sessionDir, 0);
    assert.equal(ref.totalCount, 2, 'e2/e3 collide on ts|url → collapse to one survivor');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => warnings.push(a.map(String).join(' '));
    let win;
    try {
      win = await readV2WindowedEntries(sessionDir, {});
    } finally {
      console.warn = origWarn;
    }
    assert.deepEqual(win.entries, ref.entries, 'two-pass byte-identical under collision (last wins)');
    // The surviving member is the LAST seq (e3): its delta appends e3's slice
    // ("turn 3"), not e2's ("turn 2"). Confirms last-wins, not first.
    const survivor = JSON.stringify(JSON.parse(win.entries[1]).body.messages);
    assert.ok(survivor.includes('turn 3') && !survivor.includes('turn 2'), 'last-wins survivor is e3, not e2');
    assert.ok(!warnings.some((w) => w.includes('window-pass-divergence')), 'no Pass A/B divergence reported');
  });
});

// ─── since pushdown (streaming reader, /events incremental path) ─────────────
describe('streamV2WindowedEntries since pushdown', () => {
  it('delivers exactly the deduped winners at/after since, without limit', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    const all = naiveWindowReference(sessionDir, 0).entries;
    const since = JSON.parse(all[3]).timestamp;
    const got = [];
    const res = await streamV2WindowedEntries(sessionDir, { since }, (raw) => { got.push(raw); });
    assert.deepEqual(got, all.slice(3), 'streams the since-tail byte-identically');
    assert.equal(res.sentCount, 3);
    assert.equal(res.totalCount, 6, 'totalCount counts the whole deduped session');
  });

  it('since composes with limit: window first, then since filters emission', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    const all = naiveWindowReference(sessionDir, 0).entries;
    // Window = last 4; since sits inside the window → only the since-tail emits.
    const since = JSON.parse(all[4]).timestamp;
    const got = [];
    const res = await streamV2WindowedEntries(sessionDir, { limit: 4, since }, (raw) => { got.push(raw); });
    assert.equal(res.totalCount, 6);
    assert.equal(got.length, 2);
    assert.deepEqual(got, all.slice(4));
  });

  it('full stream (no since, no limit) equals the deduped reference, emitted incrementally', async () => {
    // Pins the S10c central claim: the unbounded streaming path (/api/requests,
    // workspaces reload, ?limit=0) delivers the whole session correctly via
    // per-entry onEntry with NO accumulation (a regression that switched this
    // to `collect` would still pass — but a wrong/dropped entry would not).
    const { sessionDir } = await buildDeltaHeavySession();
    const ref = naiveWindowReference(sessionDir, 0).entries;
    const got = [];
    // Prove the callback is driven per-entry (not handed a pre-built array):
    // record how many entries existed at each onEntry call.
    const callbackLengths = [];
    const res = await streamV2WindowedEntries(sessionDir, {}, (raw) => {
      got.push(raw);
      callbackLengths.push(got.length);
    });
    // Order here is synthesis (seq) order; with unique-ts fixtures it equals the
    // dedup reference. (Duplicate-ts order divergence is covered above.)
    assert.deepEqual(got, ref, 'streams every entry, byte-identical to the reference');
    assert.equal(res.sentCount, ref.length);
    assert.equal(res.totalCount, 6);
    assert.deepEqual(callbackLengths, [1, 2, 3, 4, 5, 6], 'onEntry invoked once per entry, incrementally');
  });

  it('onReady fires before entries with window-shape info', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    const order = [];
    await streamV2WindowedEntries(sessionDir, {
      limit: 2,
      onReady: (info) => order.push(['ready', info.totalCount, info.hasMore]),
    }, () => { order.push(['entry']); });
    assert.deepEqual(order[0], ['ready', 6, true]);
    assert.equal(order.filter((o) => o[0] === 'entry').length, 2);
  });
});

// ─── crash-orphan membership parity (P0-1) ───────────────────────────────────
describe('window membership under crash-orphans', () => {
  it('a journal req whose conv event never landed is excluded from the window', async () => {
    const { sessionDir } = await buildDeltaHeavySession();
    // Simulate the §14 crash: a req line recorded an append event that never
    // reached the conversation file. The cold synthesizer skips it; a
    // journal-only Pass A would have counted it (the P0-1 divergence).
    const orphan = {
      ph: 'req', seq: 99, rid: 'rid_orphan', ts: nextTs(), kind: 'main', conv: 'main',
      epoch: 0, url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
      evt: 'append', msgFrom: 11, msgTo: 13,
    };
    appendFileSync(join(sessionDir, 'journal.jsonl'), JSON.stringify(orphan) + '\n');

    const fullCount = [...iterateV2RawEntries(sessionDir)].length;
    assert.equal(fullCount, 6, 'full synthesis skips the orphan');
    const win = await readV2WindowedEntries(sessionDir, { limit: 4 });
    assert.equal(win.totalCount, 6, 'Pass A window count matches the synthesis, not the journal');
    for (const raw of win.entries) {
      assert.ok(!raw.includes('rid_orphan'), 'orphan never materializes');
    }
  });
});

// ─── mainAgentRing (onScan replacement, P0-2 / review F4) ────────────────────
describe('mainAgentRing', () => {
  it('returns the newest ≤3 main raws byte-identical to the full stream', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'turn 1')];
    fire(w, mainEntry([...msgs]));
    fire(w, subEntry([textMsg('user', 'sub task')]));
    for (let i = 2; i <= 5; i++) {
      msgs.push(textMsg('assistant', `r${i - 1}`), textMsg('user', `turn ${i}`));
      fire(w, mainEntry([...msgs]));
    }
    await w.flush();
    const sessionDir = sessionDirOf(SID);

    const fullMains = [...iterateV2RawEntries(sessionDir)]
      .filter((raw) => JSON.parse(raw).mainAgent === true);
    const win = await readV2WindowedEntries(sessionDir, { limit: 2 });
    assert.equal(win.mainAgentRing.length, 3);
    assert.deepEqual(win.mainAgentRing, fullMains.slice(-3),
      'ring = newest 3 main raws, materialized even when outside the window');
    // The streaming reader folds the same ring.
    const res = await streamV2WindowedEntries(sessionDir, { limit: 2 }, () => {});
    assert.deepEqual(res.mainAgentRing, win.mainAgentRing);
  });

  it('a teammate session read directly contributes no ring entries', async () => {
    const w = newWriter({ leader: { agentName: 'worker-1', teamName: 'team-x' } });
    const e = mainEntry([textMsg('user', 'teammate work')]);
    fire(w, e);
    await w.flush();
    const win = await readV2WindowedEntries(sessionDirOf(SID), { limit: 5 });
    assert.equal(win.entries.length, 1);
    assert.match(win.entries[0], /"teammate":"worker-1"/);
    assert.deepEqual(win.mainAgentRing, [], 'teammate main-kind entries stay out of the ring');
  });

  it('a sub entry whose backfilled body merely looks main-agent stays out of the ring (intentional divergence from the substring filter)', async () => {
    // Hand-crafted session: journal kind='sub' but the system/tools blobs
    // satisfy isMainAgentRequest, so the synthesized entry recomputes
    // mainAgent:true (adapter stamps over the backfilled body). The old
    // `"mainAgent":true` substring filter would have ringed it; the isMain
    // (kind-based) ring must not.
    const sid = 'a0000000-0000-4000-8000-0000000000aa';
    const sdir = sessionDirOf(sid);
    mkdirSync(join(sdir, 'conversations', 'sub-fp-x'), { recursive: true });
    mkdirSync(join(sdir, 'blobs'), { recursive: true });
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, project: 'proj', startTs: nextTs() }));
    writeFileSync(join(sdir, 'blobs', 'sha256-aaaaaaaaaaaaaaaa.json'), JSON.stringify(SYSTEM));
    writeFileSync(join(sdir, 'blobs', 'sha256-bbbbbbbbbbbbbbbb.json'), JSON.stringify(TOOLS));
    const ts = nextTs();
    writeFileSync(join(sdir, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
      JSON.stringify({
        ph: 'req', seq: 1, rid: 'r1', ts, kind: 'sub', conv: 'sub-fp-x', epoch: 0,
        url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
        blobs: { sys: 'sha256-aaaaaaaaaaaaaaaa', tools: 'sha256-bbbbbbbbbbbbbbbb' },
        evt: 'snapshot', msgFrom: 0, msgTo: 1,
      }),
      JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: nextTs(), status: 'ok', http: 200 }),
    ].join('\n') + '\n');
    writeFileSync(join(sdir, 'conversations', 'sub-fp-x', 'e0.jsonl'),
      JSON.stringify({ seq: 1, rid: 'r1', t: 'snapshot', msgs: [textMsg('user', 'looks main')] }) + '\n');
    writeFileSync(join(sdir, 'responses.jsonl'),
      JSON.stringify({ seq: 1, rid: 'r1', body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');

    const raws = [...iterateV2RawEntries(sdir)];
    assert.equal(raws.length, 1);
    assert.match(raws[0], /"mainAgent":true/, 'fixture premise: the recomputed body flag says main');
    assert.ok(!raws[0].includes('"teammate"'), 'fixture premise: no teammate tag');
    const win = await readV2WindowedEntries(sdir, { limit: 5 });
    assert.deepEqual(win.mainAgentRing, [], 'kind-based ring excludes the main-looking sub');
  });
});
