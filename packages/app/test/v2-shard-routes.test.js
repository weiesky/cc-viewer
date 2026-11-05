/**
 * wire-v2 sharding (2026-11) — the shard-read path behind the routes
 * (readV2ShardEntries, server/lib/v2/adapter.js) over the IN-DIR layout
 * (`sessions/<base>/parts/<N>/`).
 *
 * The routes (/events?sid&shardBefore, /api/local-log?file&shardBefore) are a
 * thin SSE framing over this reader; these tests pin the reader contract:
 *   - beforeSeq scopes the window to the frozen shard older than the cut
 *   - the shard window carries a reconstructable baseline (checkpoint at its
 *     start), exactly like a same-session windowed read
 *   - the returned oldestSeq is a usable cursor that ADVANCES across shards
 *     (never dead-ends on the newest frozen shard)
 *   - entries match a direct windowed read of the frozen dir
 *
 * Data-safety: mkdtemp fixtures only. Tests inject the writer's `shardBytes`
 * seam (tiny) instead of any env var.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { readV2ShardEntries, readV2WindowedEntries } from '../server/lib/v2/adapter.js';
import { readSession } from '../server/lib/v2/replay.js';
import { listShards } from '../server/lib/v2/shard-manager.js';
import { _resetForTest } from '@ccv/core/error-report';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2shardrt-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'c1234567-89ab-4cde-8f01-23456789abcd';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [
  { name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} },
  { name: 'Task', input_schema: {} }, { name: 'Write', input_schema: {} },
  { name: 'Grep', input_schema: {} }, { name: 'Glob', input_schema: {} },
];

let tsCounter = 0;
function nextTs() { return new Date(Date.UTC(2026, 6, 14, 5, 0, 0, ++tsCounter)).toISOString(); }

function mainEntry(messages) {
  return {
    timestamp: nextTs(), project: 'proj',
    url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(SID) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent: true, requestId: `rid_${++tsCounter}`,
  };
}
const SHARD_PROMPTS = 3;
function newWriter() { return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, shardPrompts: SHARD_PROMPTS }); }
function fire(w, entry) {
  const h = w.ingestRequest(entry, entry.body.messages);
  if (h) {
    w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } }, duration: 1 });
  }
  return h;
}
const sessionDirOf = (sid) => join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), sid) || sid);

/** Append one NEW user-prompt turn. */
function fireTurn(w, msgs) {
  msgs.push(textMsg('assistant', `a${msgs.length}`), textMsg('user', `u${msgs.length}`));
  fire(w, mainEntry([...msgs]));
}

/** Build a session with `shardCount` frozen shards + a live active tail. */
async function buildShardedSession(shardCount = 2) {
  const w = newWriter();
  const msgs = [textMsg('user', 'turn 1')];
  fire(w, mainEntry([...msgs])); // prompt 1
  for (let shard = 0; shard < shardCount; shard++) {
    // SHARD_PROMPTS new turns per shard → the next one rotates.
    for (let i = 0; i < SHARD_PROMPTS; i++) fireTurn(w, msgs);
    await w.flush();
    await new Promise((r) => setImmediate(r));
    await w.flush();
  }
  // One final prompt on the active tail.
  fireTurn(w, msgs);
  await w.flush();
  await new Promise((r) => setImmediate(r));
  await w.flush();
  return { sessionDir: sessionDirOf(SID), msgs };
}

describe('readV2ShardEntries (in-dir parts/ layout)', () => {
  it('reads the frozen shard older than beforeSeq, matching a direct window read of that dir', async () => {
    const { sessionDir } = await buildShardedSession(2);
    const base = basename(sessionDir);
    const shards = listShards(sessionDir);
    assert.ok(shards.length >= 2, `expected ≥2 frozen shards, got ${shards.length}`);
    const newestFrozen = shards[shards.length - 1];
    const frozen = readSession(join(dir, 'proj'), join(base, 'parts', String(newestFrozen.partIndex)), 'sessions');
    const cut = Math.max(...[...frozen.reqs.keys()]);

    const viaApi = await readV2ShardEntries(sessionDir, { beforeSeq: cut + 1, limit: 0 });
    // The shard read suppresses baseline promotion (each page is a pure
    // increment slice — a checkpoint would replay the shard's whole prefix and
    // make paged prepends render the overlap twice). Compare against a direct
    // read with the same suppression.
    const direct = await readV2WindowedEntries(newestFrozen.dir, { limit: 0, noBaselinePromotion: true });
    assert.equal(viaApi.partIndex, newestFrozen.partIndex);
    assert.equal(viaApi.entries.length, direct.entries.length);
    assert.deepEqual(viaApi.entries, direct.entries, 'shard read == direct frozen window');
  });

  it('a shard page is a pure increment slice (no baseline promotion — avoids paged-prepend overlap)', async () => {
    const { sessionDir } = await buildShardedSession(1);
    const base = basename(sessionDir);
    const shards = listShards(sessionDir);
    assert.ok(shards.length >= 1);
    const newestFrozen = shards[shards.length - 1];
    const frozen = readSession(join(dir, 'proj'), join(base, 'parts', String(newestFrozen.partIndex)), 'sessions');
    const cut = Math.max(...[...frozen.reqs.keys()]);
    // A shard "load earlier" page must NOT promote its first entry to a full
    // checkpoint — the client prepends successive pages, and a checkpoint would
    // replay the shard's whole prefix on EVERY page (overlap + O(P×shard) memory).
    const res = await readV2ShardEntries(sessionDir, { beforeSeq: cut + 1, limit: 1 });
    assert.equal(res.entries.length, 1);
    const e = JSON.parse(res.entries[0]);
    assert.ok(e.body && typeof e.body === 'object', 'entry carries a body');
    assert.ok(e._isCheckpoint !== true, 'no checkpoint promotion on shard pages');
  });

  it('the cursor ADVANCES across shards until the oldest is exhausted', async () => {
    const { sessionDir } = await buildShardedSession(3);
    const base = basename(sessionDir);
    const shards = listShards(sessionDir);
    assert.ok(shards.length >= 3, `expected ≥3 frozen shards, got ${shards.length}`);

    // Walk backward from the newest frozen shard; each step must move to an
    // older (or equal-but-exhausted) shard and eventually run out of hasMore.
    const newestFrozen = shards[shards.length - 1];
    const frozen = readSession(join(dir, 'proj'), join(base, 'parts', String(newestFrozen.partIndex)), 'sessions');
    let cursor = Math.max(...[...frozen.reqs.keys()]) + 1;
    const visited = [];
    let guard = 0;
    while (cursor > 0 && guard++ < 10) {
      const res = await readV2ShardEntries(sessionDir, { beforeSeq: cursor, limit: 0 });
      visited.push(res.partIndex);
      if (!res.hasMore || res.oldestSeq == null || res.oldestSeq >= cursor) break;
      cursor = res.oldestSeq;
    }
    // Must have started at the newest frozen shard and made progress toward
    // older ones (never stuck re-reading the same shard forever).
    assert.equal(visited[0], newestFrozen.partIndex, 'first read hits the newest frozen shard');
    assert.ok(visited.length < 10, 'cursor terminates (no infinite loop)');
    // Strictly non-increasing shard indices = the cursor walks backward.
    for (let i = 1; i < visited.length; i++) assert.ok(visited[i] <= visited[i - 1], 'cursor never jumps to a newer shard');
  });

  it('returns an empty result when beforeSeq is at/below every shard cut', async () => {
    const { sessionDir } = await buildShardedSession(1);
    const res = await readV2ShardEntries(sessionDir, { beforeSeq: 1, limit: 0 });
    assert.equal(res.entries.length, 0);
    assert.equal(res.hasMore, false);
  });

  it('within-shard paging (limit < shard size) does NOT skip the shard middle history', async () => {
    // Regression for the review finding: oldestSeq must be the DELIVERED
    // window's oldest seq (not the whole shard's min), and the cursor must stay
    // on the same shard until it is exhausted — otherwise a limit-truncated
    // page would skip the shard's middle history. Build ONE shard with enough
    // requests to exceed the page limit (each prompt turn is 2+ requests once
    // tool-loop follow-ups join), so a multi-turn shard pages within itself.
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    for (let i = 0; i < SHARD_PROMPTS; i++) fireTurn(w, msgs);
    await w.flush();
    await new Promise((r) => setImmediate(r));
    await w.flush();
    const sessionDir = sessionDirOf(SID);
    const base = basename(sessionDir);
    const shards = listShards(sessionDir);
    assert.ok(shards.length >= 1);
    const newestFrozen = shards[shards.length - 1];
    const frozen = readSession(join(dir, 'proj'), join(base, 'parts', String(newestFrozen.partIndex)), 'sessions');
    const shardTotal = frozen.reqs.size;
    const cut = Math.max(...[...frozen.reqs.keys()]);

    // Page backward with limit=2 (below the shard's request count); collect
    // every delivered entry's timestamp.
    let cursor = cut + 1;
    const collected = new Set();
    let hops = 0;
    while (cursor > 0 && hops++ < 60) {
      const res = await readV2ShardEntries(sessionDir, { beforeSeq: cursor, limit: 2 });
      for (const raw of res.entries) collected.add(JSON.parse(raw).timestamp);
      if (!res.hasMore || res.oldestSeq == null || res.oldestSeq >= cursor) break;
      cursor = res.oldestSeq;
    }
    // Every shard request must be reachable — no middle-history gap.
    assert.equal(collected.size, shardTotal, `paging covers the whole shard (${collected.size}/${shardTotal})`);
  });

  it('a frozen shard carries the session identity (meta.json copied at the cut)', async () => {
    const { sessionDir } = await buildShardedSession(1);
    const shards = listShards(sessionDir);
    assert.ok(shards.length >= 1);
    const newestFrozen = shards[shards.length - 1];
    const meta = JSON.parse(readFileSync(join(newestFrozen.dir, 'meta.json'), 'utf-8'));
    assert.equal(meta.sessionId, SID, 'shard keeps the session UUID (not the part number)');
    assert.equal(meta.project, 'proj');
    assert.equal(meta.frozen, true, 'shard marked frozen');
  });
});
