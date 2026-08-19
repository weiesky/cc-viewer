/**
 * Batch/live session-boundary parity — regression suite for the "only show
 * current session" wrong-anchor bug.
 *
 * The pin identifies a session by its stable id (= messages[0]._timestamp).
 * Historically the batch reload path (_processOneEntry) and the live SSE path
 * (_flushPendingEntries) used DIVERGENT boundary heuristics, so the same log
 * prefix segmented differently live vs after a reload: stable ids shifted, the
 * persisted pin missed, and resolveDisplaySessions silently fell back — one of
 * the root causes of the intermittent wrong-session anchoring.
 *
 * Both paths now share isSessionBoundary (clearCheckpoint.js). This suite runs
 * one entry sequence through BOTH production pipelines and asserts identical
 * session counts and identical stable ids:
 *
 *   batch: createEntrySlimmer (process + finalize — the slim pass runs BEFORE
 *          boundary detection in production and empties compact-continuation
 *          messages, which is exactly why the _compactContinuation flag exists)
 *          → applyBatchEntryTimestamps → mergeMainAgentSessions
 *   live:  isSessionBoundary → assignMessageTimestamps →
 *          applyInPlaceLastMsgReplace (with the COMPUTED boundary) →
 *          mergeMainAgentSessions({ skipTransientFilter: true })
 *
 * KEEP IN SYNC: the two leg helpers below mirror AppBase.jsx _processOneEntry
 * and _flushPendingEntries. If the production call order around
 * applyBatchEntryTimestamps / isSessionBoundary changes, update these mirrors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEntrySlimmer } from '../apps/web/src/utils/entry-slim.js';
import { mergeMainAgentSessions, isMergeBlockedEntry, shouldDegradeBrokenMerge } from '../apps/web/src/utils/sessionMerge.js';
import {
  applyBatchEntryTimestamps,
  assignMessageTimestamps,
  applyInPlaceLastMsgReplace,
  getSessionStableId,
} from '../apps/web/src/utils/sessionManager.js';
import { isSessionBoundary } from '../packages/app/src/utils/clearCheckpoint.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AUTO_COMPACT_TEXT = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier discussion.';

function msg(i, role, text) {
  return { role, content: [{ type: 'text', text: text || `msg-${i}-${role}-content` }] };
}

/** n alternating user/assistant messages; optional custom first text */
function conv(n, { firstText, seed = '' } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    out.push(msg(i, role, i === 0 && firstText ? firstText : `${seed}msg-${i}-${role}`));
  }
  return out;
}

function entryOf(messages, ts, userId = 'u1', seqEpoch = null) {
  return {
    timestamp: ts,
    mainAgent: true,
    url: 'https://api.anthropic.com/v1/messages',
    ...(seqEpoch && { _seqEpoch: seqEpoch }),
    body: { messages, metadata: { user_id: userId } },
    response: { status: 200, body: { content: [{ type: 'text', text: 'resp' }] } },
  };
}

const deepCopy = (o) => JSON.parse(JSON.stringify(o));

// ─── Pipeline mirrors ────────────────────────────────────────────────────────

/** Production batch reload: slim pass first, then boundary+timestamps, then merge. */
function runBatchLeg(fileEntries) {
  const entries = fileEntries.map(deepCopy);
  const slimmer = createEntrySlimmer((e) => !!e.mainAgent);
  const acc = [];
  for (let i = 0; i < entries.length; i++) {
    slimmer.process(entries[i], acc, i);
    acc.push(entries[i]);
  }
  slimmer.finalize(acc);

  const st = { timestamps: [], generatedTimestamps: [], currentSessionId: null, prevUserId: null, prevEpoch: null, prevMainAgentTs: null, sessions: [] };
  for (const entry of acc) {
    if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) continue;
    applyBatchEntryTimestamps(st, entry);
    // KEEP IN SYNC (AppBase.jsx _processOneEntry): broken-carrier degradation
    // exception — a broken entry that is its session's only carrier merges as a
    // partial-data session instead of blanking the whole chat; the carrier is
    // STAMPED _partialData so the create branches propagate it and ChatView
    // renders the incomplete-session banner.
    if (!entry._slimmed && (shouldDegradeBrokenMerge(entry, st.sessions) || !isMergeBlockedEntry(entry, { batch: true }))) {
      if (shouldDegradeBrokenMerge(entry, st.sessions)) entry._partialData = true;
      st.sessions = mergeMainAgentSessions(st.sessions, entry);
    }
  }
  return st.sessions;
}

/** Production live SSE: entries arrive unslimmed, one at a time. */
function runLiveLeg(fileEntries) {
  let sessions = [];
  let prevMainAgentTs = null;
  for (const raw of fileEntries) {
    const entry = deepCopy(raw);
    if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) continue;
    if (entry._slimmed || isMergeBlockedEntry(entry)) continue;
    const timestamp = entry.timestamp;
    const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
    const prevMessages = lastSession?.messages || [];
    const prevCount = prevMessages.length;
    const messages = entry.body.messages;
    const userId = entry.body.metadata?.user_id || null;

    const isNewSession = isSessionBoundary(entry, {
      prevCount,
      count: messages.length,
      prevUserId: lastSession ? lastSession.userId : null,
      userId,
      prevEpoch: lastSession ? lastSession._seqEpoch : null,
      epoch: entry._seqEpoch || null,
    });
    if (isNewSession) prevMainAgentTs = null;

    assignMessageTimestamps(messages, prevMessages, isNewSession, prevCount, timestamp, prevMainAgentTs);
    const r = applyInPlaceLastMsgReplace(sessions, entry, timestamp, isNewSession);
    sessions = r.applied
      ? r.sessions
      : mergeMainAgentSessions(sessions, entry, { skipTransientFilter: true });
    prevMainAgentTs = timestamp;
  }
  return sessions;
}

function stableIds(sessions) {
  return sessions.map(getSessionStableId);
}

function assertParity(fileEntries, label) {
  const batch = runBatchLeg(fileEntries);
  const live = runLiveLeg(fileEntries);
  assert.equal(batch.length, live.length,
    `${label}: session counts diverge — batch ${batch.length}, live ${live.length}`);
  assert.deepEqual(stableIds(batch), stableIds(live),
    `${label}: stable ids diverge — batch ${JSON.stringify(stableIds(batch))}, live ${JSON.stringify(stableIds(live))}`);
  return { batch, live };
}

// ─── Cases ───────────────────────────────────────────────────────────────────

const T1 = '2026-07-01T08:00:00.000Z';
const T2 = '2026-07-01T09:00:00.000Z';
const T3 = '2026-07-01T10:00:00.000Z';
const T4 = '2026-07-01T11:00:00.000Z';

describe('session-boundary parity — /compact continuation survives the slim pass (P0)', () => {
  // Long session → /compact continuation (>4 msgs) → follow-up growth.
  // In production the follow-up entry slims the compact entry (messages emptied),
  // so without the _compactContinuation flag the batch leg would split at the
  // compact and derive a different stable id than the live leg.
  const longSession = conv(30);
  const compactMsgs = [msg(0, 'user', AUTO_COMPACT_TEXT), ...conv(9).map((m, i) => msg(i + 1, m.role, `post-compact-${i}`))];
  const followUp = [...compactMsgs.map(deepCopy), msg(10, 'user', 'next question'), msg(11, 'assistant', 'next answer')];
  const entries = [
    entryOf(longSession, T1),
    entryOf(compactMsgs, T2),
    entryOf(followUp, T3),
  ];

  it('premise guard: the slim pass really empties the compact entry (else this suite proves nothing)', () => {
    // The P0 scenario only exists because the follow-up entry slims the compact
    // entry BEFORE boundary detection runs. If a future slimmer change stops
    // slimming it, isCompactContinuation would still see the summary and these
    // parity tests would pass without exercising the _compactContinuation flag.
    const copies = entries.map(deepCopy);
    const slimmer = createEntrySlimmer((e) => !!e.mainAgent);
    const acc = [];
    for (let i = 0; i < copies.length; i++) {
      slimmer.process(copies[i], acc, i);
      acc.push(copies[i]);
    }
    slimmer.finalize(acc);
    assert.equal(acc[1]._slimmed, true, 'compact entry must be slimmed by the follow-up');
    assert.equal(acc[1].body.messages.length, 0, 'compact entry messages must be emptied');
    assert.equal(acc[1]._compactContinuation, true, 'flag must be stamped before slimming');
  });

  it('batch and live segment identically with identical stable ids', () => {
    const { batch } = assertParity(entries, 'compact-continuation');
    assert.equal(batch.length, 1, 'compact continuation must stay one logical session');
  });

  it('stable id is the ORIGINAL session start ts, not the compact entry ts', () => {
    const { batch, live } = assertParity(entries, 'compact-continuation-id');
    assert.equal(getSessionStableId(batch[0]), T1);
    assert.equal(getSessionStableId(live[0]), T1);
  });

  it('post-compact growth gets fresh timestamps in both legs (accumulator truncation)', () => {
    const { batch, live } = assertParity(entries, 'compact-continuation-fresh-ts');
    const lastBatch = batch[0].messages[batch[0].messages.length - 1];
    const lastLive = live[0].messages[live[0].messages.length - 1];
    assert.equal(lastBatch._timestamp, T3);
    assert.equal(lastLive._timestamp, T3);
  });
});

describe('session-boundary parity — same-user new-terminal bigDrop', () => {
  // A fresh terminal session from the same user: big drop, msg[0] is a genuine
  // user prompt (not a compact summary) → both legs must treat it as a boundary
  // and derive the NEW entry ts as the current session id.
  const entries = [
    entryOf(conv(30), T1),
    entryOf(conv(6, { firstText: 'brand new terminal prompt', seed: 'nt-' }), T2),
    entryOf([...conv(6, { firstText: 'brand new terminal prompt', seed: 'nt-' }), msg(6, 'user', 'more'), msg(7, 'assistant', 'ok')], T3),
  ];

  it('batch and live agree, and the derived current-session id is the new terminal start', () => {
    const { batch, live } = assertParity(entries, 'new-terminal');
    assert.equal(getSessionStableId(batch[batch.length - 1]), T2);
    assert.equal(getSessionStableId(live[live.length - 1]), T2);
  });
});

describe('session-boundary parity — live user_id change (duplicate stable id regression)', () => {
  // Before the shared predicate, the live path had no user_id trigger: merge
  // appended a new session while assignMessageTimestamps positionally inherited
  // the OLD session's first _timestamp → two sessions with the SAME stable id,
  // and the pin resolved to the older one.
  const entries = [
    entryOf(conv(20, { seed: 'u1-' }), T1, 'u1'),
    entryOf(conv(25, { seed: 'u2-' }), T2, 'u2'),
    entryOf([...conv(25, { seed: 'u2-' }), msg(25, 'user', 'more'), msg(26, 'assistant', 'ok')], T4, 'u2'),
  ];

  it('batch and live agree with two distinct sessions', () => {
    const { batch, live } = assertParity(entries, 'userid-change');
    assert.equal(batch.length, 2);
    assert.deepEqual(stableIds(batch), [T1, T2]);
    assert.deepEqual(stableIds(live), [T1, T2]);
  });

  it('no duplicate stable ids in the live leg', () => {
    const live = runLiveLeg(entries);
    const ids = stableIds(live);
    assert.equal(new Set(ids).size, ids.length, `duplicate stable ids: ${JSON.stringify(ids)}`);
  });
});

describe('session-boundary parity — post-/clear checkpoint', () => {
  // /clear always splits in both legs, even for a 1-message checkpoint.
  const clearMsg = {
    role: 'user',
    content: [{ type: 'text', text: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' }],
  };
  const clearEntry = { ...entryOf([clearMsg], T2), _isCheckpoint: true, _deltaFormat: 1, _totalMessageCount: 1 };
  const entries = [
    entryOf(conv(30), T1),
    clearEntry,
    entryOf([deepCopy(clearMsg), msg(1, 'assistant', 'fresh answer'), msg(2, 'user', 'q'), msg(3, 'assistant', 'a'), msg(4, 'user', 'q2'), msg(5, 'assistant', 'a2')], T3),
  ];

  it('batch and live agree: /clear starts a new session anchored at the checkpoint ts', () => {
    const { batch, live } = assertParity(entries, 'post-clear');
    assert.equal(batch.length, 2);
    assert.equal(getSessionStableId(batch[1]), T2);
    assert.equal(getSessionStableId(live[1]), T2);
  });
});

describe('session-boundary parity — session.model stamp', () => {
  function entryWithModel(messages, ts, model, responseModel) {
    const e = entryOf(messages, ts);
    e.body.model = model;
    if (responseModel) e.response.body.model = responseModel;
    return e;
  }

  it('same-user rebuild: both legs upgrade the single session to the response-reported model', () => {
    const entries = [
      entryWithModel(conv(12), T1, 'claude-fable-5'),
      // Big drop 12 → 5 with the same user REBUILDS the session in place (no append); the
      // response-reported model must win over body.model on both legs (hot-switch semantics).
      entryWithModel(conv(5, { seed: 'fresh-' }), T2, 'claude-fable-5', 'claude-opus-4-8'),
    ];
    const { batch, live } = assertParity(entries, 'session-model-rebuild');
    assert.equal(batch.length, 1);
    assert.equal(batch[0].model, 'claude-opus-4-8');
    assert.equal(live[0].model, 'claude-opus-4-8');
  });

  it('post-clear checkpoint: both legs stamp each session with its own model', () => {
    const clearMsg = {
      role: 'user',
      content: [{ type: 'text', text: '<command-name>/clear</command-name>' }],
    };
    const clearEntry = { ...entryWithModel([clearMsg], T2, 'claude-opus-4-8'), _isCheckpoint: true, _deltaFormat: 1, _totalMessageCount: 1 };
    const entries = [
      entryWithModel(conv(30), T1, 'claude-fable-5'),
      clearEntry,
    ];
    const { batch, live } = assertParity(entries, 'session-model-clear');
    assert.equal(batch.length, 2);
    for (const sessions of [batch, live]) {
      assert.equal(sessions[0].model, 'claude-fable-5');
      assert.equal(sessions[1].model, 'claude-opus-4-8');
    }
  });
});

describe('session-boundary parity — task B: _seqEpoch change (short prior session, same user)', () => {
  // The H5 case the cold-load fallback creates: a SHORT prior session A
  // (cold-loaded) followed by the live current session B, same user_id, B's
  // opening count NOT a >50% drop from A (A is short) → without the epoch
  // signal neither the bigDrop nor user_id rule fires and B would merge INTO
  // A. The _seqEpoch change forces a definitive boundary in BOTH legs.
  const EA = 'v2:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const EB = 'v2:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const shortA = conv(2, { seed: 'a-' });        // 2 msgs
  const bStart = conv(3, { seed: 'b-' });         // 3 msgs — no >50% drop from 2
  const entries = [
    entryOf(shortA, T1, 'u1', EA),
    entryOf(bStart, T2, 'u1', EB),
    entryOf([...bStart.map(deepCopy), msg(3, 'user', 'more'), msg(4, 'assistant', 'ok')], T3, 'u1', EB),
  ];

  it('batch and live agree: two sessions, B is not swallowed by short A', () => {
    const { batch, live } = assertParity(entries, 'epoch-change');
    assert.equal(batch.length, 2, 'A and B are distinct despite same user + no bigDrop');
    assert.deepEqual(stableIds(batch), [T1, T2]);
    assert.deepEqual(stableIds(live), [T1, T2]);
  });

  it('null-safe: without _seqEpoch the same short-B WOULD merge (proves epoch is what splits)', () => {
    // Same shapes, epoch stripped → the heuristics can't split → one blended
    // session. Confirms the new split is driven by epoch, not a side effect.
    const noEpoch = [
      entryOf(shortA, T1, 'u1'),
      entryOf(bStart, T2, 'u1'),
      entryOf([...bStart.map(deepCopy), msg(3, 'user', 'more'), msg(4, 'assistant', 'ok')], T3, 'u1'),
    ];
    const { batch, live } = assertParity(noEpoch, 'epoch-absent');
    assert.equal(batch.length, 1, 'without epoch, short B merges into A (the H5 bug)');
    assert.equal(live.length, 1);
  });

  it('same epoch does not split (no-op when the session id is unchanged)', () => {
    const sameEpoch = [
      entryOf(conv(6, { seed: 's-' }), T1, 'u1', EA),
      entryOf([...conv(6, { seed: 's-' }), msg(6, 'user', 'q'), msg(7, 'assistant', 'a')], T2, 'u1', EA),
    ];
    const { batch, live } = assertParity(sameEpoch, 'epoch-same');
    assert.equal(batch.length, 1);
    assert.equal(live.length, 1);
  });
});

// ─── degraded-broken-carrier wiring (KEEP IN SYNC: AppBase.jsx gate) ────────
// The batch gate stamps _partialData on a degraded carrier; the merge create
// branch must propagate it onto the session so ChatView renders the banner.
// Regression guard for the stamp-wiring (the flag was once only hand-set in
// unit tests, leaving the production gate without it).
describe('session-boundary parity — degraded broken carrier wiring', () => {
  it('gate stamps _partialData and the created session carries it', () => {
    const entry = entryOf(conv(4, { seed: 'd-' }), T1, 'u1', 'v2:d');
    entry._reconstructBroken = true; // slim keeps it as the only carrier
    const sessions = runBatchLeg([entry]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]._partialData, true, 'degraded carrier must stamp the session');
  });

  it('same-epoch preceding session blocks degradation (no stamp, no merge)', () => {
    // The slim pass keeps only the LAST main entry as the messages carrier, so
    // a same-epoch healthy entry that precedes a broken carrier gets slimmed
    // away and never builds a session — the broken carrier is then the only
    // non-slimmed entry and legitimately degrades (prevSessions empty). To
    // reach the "same epoch already merged" rejection, build the preceding
    // session directly and run the gate predicate.
    const prev = [entryOf(conv(4, { seed: 'h-' }), T1, 'u1', 'v2:c')];
    const broken = entryOf(conv(6, { seed: 'd-' }), T2, 'u1', 'v2:c'); // same epoch
    broken._reconstructBroken = true;
    assert.equal(shouldDegradeBrokenMerge(broken, prev), false, 'same-epoch predecessor must block degradation');
    // A DIFFERENT epoch (new session) degrades and stamps a new session.
    const other = entryOf(conv(6, { seed: 'd-' }), T2, 'u1', 'v2:d');
    other._reconstructBroken = true;
    assert.equal(shouldDegradeBrokenMerge(other, prev), true);
    const sessions = runBatchLeg([other]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]._partialData, true);
  });

  it('anchor-hit merge clears _partialData on the live leg', () => {
    const partial = runBatchLeg([entryOf(conv(4, { seed: 'p-' }), T1, 'u1', 'v2:p')]);
    partial[0]._partialData = true; // simulate a degraded carrier base
    const full = entryOf([...conv(4, { seed: 'p-' }), msg(5, 'user', 'q')], T2, 'u1', 'v2:p');
    const live = runLiveLeg([full]);
    // The live leg rebuilds the session from the full carrier — the partial
    // flag must not survive a clean anchor-hit merge.
    assert.equal(live[0]._partialData, undefined);
  });
});
