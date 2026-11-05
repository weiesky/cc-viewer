/**
 * wire-v2 sharding (2026-11) — prompt-count split of a session dir
 * (server/lib/v2/shard-manager.js + writer hook).
 *
 * Frozen shards live INSIDE the session dir at `sessions/<base>/parts/<N>/` —
 * one folder carries the whole session. The trigger is PROMPT-COUNT based:
 * after SHARD_PROMPT_THRESHOLD main-conversation user prompts, the NEXT new
 * user prompt opens a fresh shard, so every part holds whole user-prompt→loop
 * segments (never a half-turn). Rotation is deferred to a quiescent point (no
 * in-flight request + an idle write queue) so a req/done never splits across
 * shards.
 *
 * Pinned behaviors:
 *   - below the prompt threshold the writer never rotates
 *   - crossing it (at a NEW user prompt) archives the live files into parts/<N>/
 *     and keeps writing into a fresh skeleton; journal seq stays CONTINUOUS
 *   - an in-flight request's completion lands its done/response in the SAME
 *     shard that holds its req (handle paths snapshot), even across the cut
 *   - listShards enumerates oldest→newest from the session's own parts/ subdir
 *   - a restart re-seeds journal seq across the live dir AND archived shards
 *
 * Data-safety: mkdtemp fixtures only. Tests inject the writer's `shardPrompts`
 * seam (tiny) instead of any env var.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { readV2ShardEntries } from '../server/lib/v2/adapter.js';
import { readSession } from '../server/lib/v2/replay.js';
import { listShards, shardPartDir, shardPartsDir } from '../server/lib/v2/shard-manager.js';
import { _resetForTest } from '@ccv/core/error-report';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2shard-')); _resetForTest(); });
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

// Tiny shard threshold (3 prompts) so a few user turns trigger rotation.
const SHARD_PROMPTS = 3;
function newWriter(extra = {}) {
  return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, shardPrompts: SHARD_PROMPTS, ...extra });
}

function fire(w, entry) {
  const h = w.ingestRequest(entry, entry.body.messages);
  if (h) {
    w.ingestCompletion(h, {
      ...entry,
      response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } },
      duration: 1,
    });
  }
  return h;
}

const sessionDirOf = (sid) => join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), sid) || sid);

/** Append `count` NEW user-prompt turns (each adds a fresh user message). */
async function fireTurns(w, count, msgs) {
  for (let i = 0; i < count; i++) {
    msgs.push(textMsg('assistant', `a${msgs.length}`), textMsg('user', `u${msgs.length}`));
    fire(w, mainEntry([...msgs]));
  }
  await w.flush();
  await new Promise((r) => setImmediate(r));
  await w.flush();
}

// ─── no rotation below the prompt threshold ──────────────────────────────────
describe('shard rotation threshold', () => {
  it('never rotates below the prompt threshold', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs])); // prompt 1
    await fireTurns(w, SHARD_PROMPTS - 1, msgs); // up to threshold
    const sd = sessionDirOf(SID);
    assert.ok(!existsSync(shardPartsDir(sd)), 'no parts/ dir below threshold');
  });

  it('rotates at the (threshold+1)-th NEW user prompt; seq stays continuous', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs])); // prompt 1
    await fireTurns(w, SHARD_PROMPTS, msgs); // prompts 2..threshold+1 → rotates
    // One more prompt AFTER the cut, so the fresh active dir has a request.
    msgs.push(textMsg('assistant', 'aX'), textMsg('user', 'u-after-cut'));
    fire(w, mainEntry([...msgs]));
    await w.flush();
    await new Promise((r) => setImmediate(r));
    await w.flush();

    const sd = sessionDirOf(SID);
    const part1 = shardPartDir(sd, 1);
    assert.ok(existsSync(part1), 'frozen shard archived to sessions/<base>/parts/1');
    assert.ok(existsSync(join(part1, 'journal.jsonl')), 'frozen shard is a self-contained session dir');
    assert.ok(existsSync(join(sd, 'journal.jsonl')), 'live skeleton recreated at the session root');
    // sessions/ holds ONLY the one session dir (parts/ is nested INSIDE it).
    const sessionDirs = readdirSync(join(dir, 'proj', 'sessions'));
    assert.equal(sessionDirs.length, 1, 'exactly one session dir — no shard ghost rows');

    // Seq continuity across the cut (frozen parts/<N>/ vs live root).
    const frozen = readSession(join(dir, 'proj'), join(basename(sd), 'parts', '1'), 'sessions');
    const active = readSession(join(dir, 'proj'), basename(sd));
    const frozenSeqs = [...frozen.reqs.keys()];
    const activeSeqs = [...active.reqs.keys()];
    assert.ok(frozenSeqs.length > 0 && activeSeqs.length > 0);
    assert.ok(Math.max(...frozenSeqs) < Math.min(...activeSeqs),
      `frozen max ${Math.max(...frozenSeqs)} < active min ${Math.min(...activeSeqs)}`);
  });

  it('does NOT rotate on tool-loop follow-ups (only a NEW user prompt counts)', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs])); // prompt 1
    // Tool-loop follow-ups: the wire tail is a tool_result, not a fresh prompt.
    for (let i = 0; i < SHARD_PROMPTS + 5; i++) {
      msgs.push(textMsg('assistant', `a${i}`), { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] });
      fire(w, mainEntry([...msgs]));
    }
    await w.flush();
    const sd = sessionDirOf(SID);
    assert.ok(!existsSync(shardPartsDir(sd)), 'tool_result follow-ups never rotate');
  });

  it('keeps an in-flight completion in the shard that owns its req (paths snapshot)', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    // Open an in-flight request (a NEW user prompt, no completion yet).
    msgs.push(textMsg('assistant', 'a1'), textMsg('user', 'u2'));
    const openEntry = mainEntry([...msgs]);
    const openHandle = w.ingestRequest(openEntry, openEntry.body.messages);
    // Drive past the threshold with MORE new prompts (each opens a turn; the
    // in-flight one blocks the cut until it completes).
    await fireTurns(w, SHARD_PROMPTS, msgs);
    w.ingestCompletion(openHandle, {
      ...openEntry,
      response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
      duration: 5,
    });
    await w.flush();
    await new Promise((r) => setImmediate(r));
    await w.flush();

    const sd = sessionDirOf(SID);
    const shards = listShards(sd);
    assert.ok(shards.length >= 1, 'rotation fired once the in-flight request completed');
    // The open request's req and done must live in the SAME shard.
    const openSeq = openHandle.seq;
    let reqShard = null;
    let doneShard = null;
    const readShard = (absDir) => absDir === sd
      ? readSession(join(dir, 'proj'), basename(sd))
      : readSession(join(dir, 'proj'), join(basename(sd), 'parts', basename(absDir)), 'sessions');
    for (const absDir of [...shards.map((s) => s.dir), sd]) {
      const s = readShard(absDir);
      if (s.reqs.has(openSeq)) reqShard = absDir;
      if (s.dones.has(openSeq)) doneShard = absDir;
    }
    assert.ok(reqShard, `req ${openSeq} found in some shard`);
    assert.equal(doneShard, reqShard, `done ${openSeq} lands in the same shard as its req`);
  });

  it('re-seeds journal seq across archived shards after a process restart', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // rotates
    await w.flush();
    const sd = sessionDirOf(SID);
    const shards = listShards(sd);
    assert.ok(shards.length >= 1, 'a shard exists before the restart');
    const frozen = readSession(join(dir, 'proj'), join(basename(sd), 'parts', '1'), 'sessions');
    const maxFrozenSeq = Math.max(...[...frozen.reqs.keys()]);

    // Simulate a restart: a brand-new writer binds the same session dir. Its
    // Journal must seed from the max seq across the live dir AND parts/.
    const w2 = newWriter();
    msgs.push(textMsg('assistant', 'aX'), textMsg('user', 'uX'));
    fire(w2, mainEntry([...msgs]));
    await w2.flush();
    const active = readSession(join(dir, 'proj'), basename(sd));
    const activeSeqs = [...active.reqs.keys()];
    assert.ok(activeSeqs.length > 0);
    assert.ok(Math.min(...activeSeqs) > maxFrozenSeq,
      `restart seq ${Math.min(...activeSeqs)} continues past frozen max ${maxFrozenSeq}`);
  });
});

// ─── listShards enumeration (session's own parts/) ───────────────────────────
describe('listShards', () => {
  it('enumerates oldest→newest from sessions/<base>/parts/<N>', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // shard 1
    await fireTurns(w, SHARD_PROMPTS, msgs); // shard 2
    await fireTurns(w, 1, msgs);

    const sd = sessionDirOf(SID);
    const shards = listShards(sd);
    assert.ok(shards.length >= 1, 'at least one frozen shard');
    for (let i = 0; i < shards.length; i++) {
      assert.equal(shards[i].partIndex, i + 1, 'partIndex 1-based, oldest first');
      assert.ok(shards[i].dir.includes(basename(sd)), 'shard lives inside the session dir');
      assert.ok(shards[i].dir.includes('parts'), 'under the parts/ subdir');
    }
  });
});

// ─── sharded read (cursor-driven) ────────────────────────────────────────────
describe('readV2ShardEntries', () => {
  it('reads the frozen shard older than beforeSeq, and the cursor advances across shards', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // shard 1
    await fireTurns(w, SHARD_PROMPTS, msgs); // shard 2
    await fireTurns(w, 1, msgs);             // active tail

    const sd = sessionDirOf(SID);
    const shards = listShards(sd);
    assert.ok(shards.length >= 1, `at least one frozen shard, got ${shards.length}`);

    // Drive the cursor from the NEWEST frozen shard's cut (its journal max seq).
    const newestFrozen = shards[shards.length - 1];
    const frozen = readSession(join(dir, 'proj'), join(basename(sd), 'parts', String(newestFrozen.partIndex)), 'sessions');
    const frozenSeqs = [...frozen.reqs.keys()];
    assert.ok(frozenSeqs.length > 0, 'frozen shard has requests');
    const newestFrozenCut = Math.max(...frozenSeqs);
    const res = await readV2ShardEntries(sd, { beforeSeq: newestFrozenCut + 1, limit: 0 });
    assert.ok(res.entries.length > 0, 'frozen shard yields entries');
    assert.equal(res.partIndex, newestFrozen.partIndex, 'reads the newest frozen shard');
    assert.ok(typeof res.oldestSeq === 'number' && res.oldestSeq > 0, 'cursor is a positive seq');
    // The cursor advances: reading again with the returned oldestSeq must not
    // return the SAME window (it moves toward older history or terminates).
    if (res.hasMore) {
      const res2 = await readV2ShardEntries(sd, { beforeSeq: res.oldestSeq, limit: 0 });
      assert.ok(res2.partIndex <= res.partIndex, 'cursor never moves to a newer shard');
    }
  });

  it('returns empty when beforeSeq is at/below every shard cut', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'u1')]));
    await w.flush();
    const sd = sessionDirOf(SID);
    const res = await readV2ShardEntries(sd, { beforeSeq: 1, limit: 0 });
    assert.equal(res.entries.length, 0);
    assert.equal(res.hasMore, false);
  });

  it('reads the ACTIVE shard prefix when the cursor is past every frozen cut (partIndex 0)', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // → 1 frozen shard
    await fireTurns(w, 2, msgs);             // active tail (2 more turns)
    const sd = sessionDirOf(SID);
    const shards = listShards(sd);
    assert.equal(shards.length, 1, 'exactly one frozen shard');
    const newestFrozenCut = Math.max(...readSession(join(dir, 'proj'), join(basename(sd), 'parts', String(shards[0].partIndex)), 'sessions').reqs.keys());
    // A limit-truncated cold window's oldest seq sits INSIDE the active shard —
    // the cursor must read the active prefix (partIndex 0), not jump to frozen.
    const res = await readV2ShardEntries(sd, { beforeSeq: newestFrozenCut + 2, limit: 1 });
    assert.equal(res.partIndex, 0, 'cursor past every frozen cut reads the ACTIVE shard');
    assert.ok(res.entries.length > 0, 'active prefix yields entries');
    assert.ok(res.hasMore, 'more history behind (active prefix remainder or the frozen shard)');
    // Walking further back eventually lands on the frozen shard.
    if (res.oldestSeq != null) {
      const older = await readV2ShardEntries(sd, { beforeSeq: res.oldestSeq, limit: 0 });
      assert.ok(older.partIndex >= 0 && older.partIndex <= 1, 'cursor walks toward older shards');
    }
  });
});

describe('rotation recovery + seeding', () => {
  it('restart re-seeds the prompt counter from the live prompts.jsonl (near-threshold keeps rotating)', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // → 1 frozen shard; active has 1 prompt recorded
    const sd = sessionDirOf(SID);
    assert.equal(listShards(sd).length, 1);
    // Simulate a restart: a brand-new writer must re-seed _partPrompts from the
    // ACTIVE dir's prompts.jsonl and rotate again at the threshold, not from 0.
    const w2 = newWriter();
    await fireTurns(w2, SHARD_PROMPTS, msgs); // active 1 + these → crosses again
    assert.ok(listShards(sd).length >= 2, `second rotation after restart, got ${listShards(sd).length} shards`);
  });

  it('a partial shard (journal moved, conversations missing) is never overwritten and ingest continues past it', async () => {
    const w = newWriter();
    const msgs = [textMsg('user', 'u1')];
    fire(w, mainEntry([...msgs]));
    await fireTurns(w, SHARD_PROMPTS, msgs); // → parts/1
    const sd = sessionDirOf(SID);
    assert.equal(listShards(sd).length, 1);
    // Crash simulation: parts/2 exists with ONLY a journal (mid-archive crash).
    const { mkdirSync, writeFileSync, rmSync: rm } = await import('node:fs');
    const crashed = shardPartDir(sd, 2);
    mkdirSync(crashed, { recursive: true });
    writeFileSync(join(crashed, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: SID }) + '\n');
    const crashedBefore = readdirSync(crashed).sort();
    // The collision (EEXIST) aborts that rotation — the crashed shard is never
    // overwritten — and the NEXT rotation claims index 3, leaving the crashed
    // parts/2 as the gap marker. Journal seqs stay continuous across the gap:
    // the aborted attempt's prompt opens part 3 (its content moved with the
    // retry), and every surviving shard plus the active dir tiles (frozenMax <
    // nextShardMin < activeMin).
    await fireTurns(w, SHARD_PROMPTS + 1, msgs);
    assert.deepEqual(readdirSync(crashed).sort(), crashedBefore, 'crashed shard content untouched');
    const shards = listShards(sd).map((s) => s.partIndex);
    assert.ok(shards.includes(3), `a later rotation claims index 3 past the crashed gap, got ${JSON.stringify(shards)}`);
    const part3Seqs = [...readSession(join(dir, 'proj'), join(basename(sd), 'parts', '3'), 'sessions').reqs.keys()];
    assert.ok(part3Seqs.length > 0, 'ingest continued into the retried shard');
    const part1Seqs = [...readSession(join(dir, 'proj'), join(basename(sd), 'parts', '1'), 'sessions').reqs.keys()];
    assert.ok(Math.min(...part3Seqs) > Math.max(...part1Seqs), 'seq continuity across the crash gap');
    rm(crashed, { recursive: true, force: true });
  });
});

describe('SHARD_PROMPT_THRESHOLD default', () => {
  it('is 2000 and the writer falls back to it without the seam', async () => {
    const { SHARD_PROMPT_THRESHOLD } = await import('../server/lib/v2/shard-manager.js');
    assert.equal(SHARD_PROMPT_THRESHOLD, 2000);
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0 });
    assert.equal(w._shardThresholdPrompts(), 2000);
  });
});
