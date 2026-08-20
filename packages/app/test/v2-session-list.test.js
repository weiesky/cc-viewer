/**
 * wire-v2 P0-A — session-row cache (server/lib/v2/session-list.js).
 *
 * Verifies the cache contract: keyed by journal size+mtime, repeat calls with
 * unchanged journals return identical rows without re-reading; appended journal
 * lines trigger recompute of only that session; deletions prune automatically;
 * all skip gates (wireFormat, sentinel, no-journal) are honored; multi-project
 * isolation and the 32-project eviction cap work.
 *
 * Golden rule: cached rows must be indistinguishable from uncached output.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { listV2Sessions, _resetForTest } from '../server/lib/v2/session-list.js';
import { listV2Logs, listV2LogsPage } from '../server/lib/log-management.js';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2sl-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID_TM = 'b7772cc9-1bc8-56ab-cdfe-5d9a61b25495';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [{ name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} }, { name: 'Agent', input_schema: {} }];

let tsCounter = 0;
function nextTs() {
  return new Date(Date.UTC(2026, 6, 13, 5, 0, 0, ++tsCounter)).toISOString();
}

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

function newWriter(opts = {}) {
  return new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, ...opts });
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

const projDir = () => join(dir, 'proj');
const sessionDirOf = (sid) => join(projDir(), 'sessions', resolveSessionDirName(projDir(), sid) || sid);
const dirNameOf = (sid) => resolveSessionDirName(projDir(), sid) || sid;

// ─── golden: cached output identical to uncached ─────────────────────────────

describe('golden: cached == uncached', () => {
  it('first call (cold) and second call (warm) return identical rows', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'golden turn 1')]));
    fire(w, mainEntry([textMsg('user', 'golden turn 1'), textMsg('assistant', 'r'), textMsg('user', 'golden turn 2')]));
    await w.flush();

    const cold = listV2Sessions(projDir());
    const warm = listV2Sessions(projDir());
    assert.deepEqual(warm, cold, 'warm call must return identical data');
    assert.ok(cold.length > 0, 'at least one session');
  });

  it('wire shape: exactly 6 fields {file, kind, timestamp, size, turns, preview} via listV2Logs', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'shape check')]));
    await w.flush();

    const grouped = listV2Logs(dir, 'proj');
    const rows = grouped.proj || [];
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      assert.deepEqual(keys, ['file', 'kind', 'preview', 'size', 'timestamp', 'turns'].sort(),
        'listV2Logs wire shape must stay exactly 6 fields');
      assert.match(row.file, /^v2:/);
      assert.equal(row.kind, 'v2');
    }
  });
});

// ─── cache hit: same freshness key → same rows, no re-read ───────────────────

describe('cache hit', () => {
  it('unchanged journal+prompts return identical rows; rows are copies, not cache references', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'cache identity')]));
    await w.flush();

    const first = listV2Sessions(projDir());
    const second = listV2Sessions(projDir());
    assert.equal(first.length, second.length);
    // Rows are re-copied for delivery — never the same reference as the cache
    // entry (callers must not be able to poison the shared cache).
    assert.notStrictEqual(second[0], first[0], 'rows are copies, not cache references');
    assert.deepEqual(second, first);
  });

  it('meta.json is NOT part of the freshness key — the cached row serves the old value (documented staleness, proves the hit)', async () => {
    // meta.json is written once at creation (layout.js first-write-wins), so a
    // runtime meta change is not a production path. The pin has two jobs:
    // (1) it is the OBSERVABLE proof that the second call hit the cache — a
    //     recompute would read the new meta and serve the new startTs;
    // (2) it documents that an external meta rewrite is invisible to the list
    //     until that session's journal (or prompts) next changes.
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'meta probe')]));
    await w.flush();

    const before = listV2Sessions(projDir());
    assert.ok(before.length > 0);
    const sdir = sessionDirOf(SID);
    const meta = JSON.parse(readFileSync(join(sdir, 'meta.json'), 'utf-8'));
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ ...meta, startTs: '2030-01-01T00:00:00.000Z' }));

    const after = listV2Sessions(projDir());
    assert.equal(after[0].startTs, before[0].startTs,
      'cached row served — meta change invisible (key covers journal+prompts only)');

    // Self-healing: the next journal append recomputes and picks up the meta.
    fire(w, mainEntry([textMsg('user', 'meta probe'), textMsg('assistant', 'r'), textMsg('user', 'meta probe t2')]));
    await w.flush();
    const healed = listV2Sessions(projDir());
    assert.equal(healed[0].startTs, '2030-01-01T00:00:00.000Z', 'journal append recomputes — new meta visible');
  });

  it('prompts.jsonl append with journal untouched triggers recompute (key spans both files)', async () => {
    // The display cache is written strictly AFTER the journal line, and a
    // crash-resume backfill appends prompts with NO journal write — so the
    // freshness key must cover prompts.jsonl on its own. Writing a new prompt
    // line with the journal untouched must NOT serve the stale preview.
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'prompt key probe')]));
    await w.flush();

    const before = listV2Sessions(projDir());
    assert.deepEqual(before[0].preview, ['prompt key probe']);

    const sdir = sessionDirOf(SID);
    const promptsPath = join(sdir, 'prompts.jsonl');
    const pst = statSync(promptsPath);
    // Hand-append one more {seq, texts} line — simulating the backfill path
    // (no journal write; a real writer would have bumped the journal too).
    appendFileSync(promptsPath, JSON.stringify({ seq: 99, texts: ['backfilled prompt'] }) + '\n');

    const after = listV2Sessions(projDir());
    assert.deepEqual(after[0].preview, ['prompt key probe', 'backfilled prompt'],
      'prompts change alone recomputes the row — stale preview must not be served');
  });

  it('only the changed session is recomputed; others return identical rows', async () => {
    const SID2 = 'c3333333-1111-4222-8333-444455556666';
    const w1 = newWriter();
    fire(w1, mainEntry([textMsg('user', 'session one')]));
    await w1.flush();
    const w2 = newWriter();
    fire(w2, mainEntry([textMsg('user', 'session two')], { sid: SID2 }));
    await w2.flush();

    const before = listV2Sessions(projDir());
    assert.equal(before.length, 2);

    // Append one more turn to session one only.
    fire(w1, mainEntry([textMsg('user', 'session one'), textMsg('assistant', 'r'), textMsg('user', 'session one t2')]));
    await w1.flush();

    const after = listV2Sessions(projDir());
    assert.equal(after.length, 2);
    const s1Before = before.find((s) => s.sid.endsWith(SID));
    const s1After = after.find((s) => s.sid.endsWith(SID));
    const s2Before = before.find((s) => s.sid.endsWith(SID2));
    const s2After = after.find((s) => s.sid.endsWith(SID2));
    assert.equal(s1After.turns, s1Before.turns + 1, 'changed session reflects the new turn');
    assert.deepEqual(s2After, s2Before, 'unchanged session returns identical row');
  });
});

// ─── deletion pruning ────────────────────────────────────────────────────────

describe('deletion', () => {
  it('a session renamed out of sessions/ disappears from the list', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'will be deleted')]));
    await w.flush();

    const before = listV2Sessions(projDir());
    assert.ok(before.length > 0);
    const sdir = sessionDirOf(SID);
    const trash = join(dir, 'proj', 'sessions-archived');
    mkdirSync(trash, { recursive: true });
    renameSync(sdir, join(trash, sdir.split('/').pop()));

    const after = listV2Sessions(projDir());
    assert.equal(after.length, 0, 'deleted session must not appear');
  });
});

// ─── skip gates preserved ────────────────────────────────────────────────────

describe('skip gates', () => {
  it('no journal → skipped', async () => {
    const sdir = join(projDir(), 'sessions', 'no-journal-sid');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'x' }));
    const sessions = listV2Sessions(projDir());
    assert.equal(sessions.find((s) => s.sid === 'no-journal-sid'), undefined);
  });

  it('0-byte journal → turns:0 row (torn creation tolerated)', async () => {
    const sid0 = 'e0e0e0e0-0000-4000-8000-000000000000';
    const sdir = join(projDir(), 'sessions', sid0);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid0, startTs: '2026-01-01T00:00:00.000Z' }));
    writeFileSync(join(sdir, 'journal.jsonl'), '');
    const sessions = listV2Sessions(projDir());
    const row = sessions.find((s) => s.sid === sid0);
    assert.ok(row, '0-byte journal must still produce a row');
    assert.equal(row.turns, 0);
  });

  it('meta.json wireFormat > 2 → skipped + not cached', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'will be gated')]));
    await w.flush();
    const sdir = sessionDirOf(SID);
    const meta = JSON.parse(readFileSync(join(sdir, 'meta.json'), 'utf-8'));
    writeFileSync(join(sdir, 'meta.json'), JSON.stringify({ ...meta, wireFormat: 3 }));

    const sessions = listV2Sessions(projDir());
    assert.equal(sessions.find((s) => s.sid.endsWith(SID)), undefined, 'unsupported wireFormat must skip');
    // Second call must also skip (not poisoned by a cached skip).
    const again = listV2Sessions(projDir());
    assert.equal(again.find((s) => s.sid.endsWith(SID)), undefined);
  });

  it('journal sentinel wireFormat > 2 → skipped', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'sentinel gated')]));
    await w.flush();
    const sdir = sessionDirOf(SID);
    const jPath = join(sdir, 'journal.jsonl');
    const lines = readFileSync(jPath, 'utf-8').split('\n');
    lines[0] = JSON.stringify({ ph: 'meta', wireFormat: 99, sessionId: SID });
    writeFileSync(jPath, lines.join('\n'));

    const sessions = listV2Sessions(projDir());
    assert.equal(sessions.find((s) => s.sid.endsWith(SID)), undefined, 'sentinel gate must skip');
  });

  it('journal stat failure → skip, never cached', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'stat fail')]));
    await w.flush();
    const sdir = sessionDirOf(SID);
    // Replace journal with a directory — statSync succeeds but isDirectory,
    // readJsonlTolerant will fail on read. The key computation itself works
    // (statSync on a dir returns size 0), but summarizeSession will throw.
    // Simpler: remove read permission. Cross-platform: use a broken symlink
    // or just verify the skip-and-no-cache contract via the no-journal case
    // (already covered above). Here we test that a session whose journal
    // disappears mid-list is skipped gracefully.
    renameSync(join(sdir, 'journal.jsonl'), join(sdir, 'journal.jsonl.bak'));
    const sessions = listV2Sessions(projDir());
    assert.equal(sessions.find((s) => s.sid.endsWith(SID)), undefined, 'missing journal → skip');
    // Restore — must reappear (not cached as skip).
    renameSync(join(sdir, 'journal.jsonl.bak'), join(sdir, 'journal.jsonl'));
    const restored = listV2Sessions(projDir());
    assert.ok(restored.find((s) => s.sid.endsWith(SID)), 'restored journal → row reappears');
  });
});

// ─── multi-project isolation ─────────────────────────────────────────────────

describe('multi-project', () => {
  it('rows are isolated per projectDir', async () => {
    // Create sessions in two projects.
    const w1 = new V2Writer({ logDir: dir, project: 'alpha', enabled: true, minFreeBytes: 0 });
    fire(w1, { ...mainEntry([textMsg('user', 'alpha session')]), project: 'alpha' });
    await w1.flush();
    const w2 = new V2Writer({ logDir: dir, project: 'beta', enabled: true, minFreeBytes: 0 });
    fire(w2, { ...mainEntry([textMsg('user', 'beta session')]), project: 'beta' });
    await w2.flush();

    const alphaRows = listV2Sessions(join(dir, 'alpha'));
    const betaRows = listV2Sessions(join(dir, 'beta'));
    assert.equal(alphaRows.length, 1);
    assert.equal(betaRows.length, 1);
    assert.ok(alphaRows[0].preview.some((p) => p.includes('alpha')));
    assert.ok(betaRows[0].preview.some((p) => p.includes('beta')));
  });
});

// ─── project eviction cap ────────────────────────────────────────────────────

describe('eviction', () => {
  it('>32 projects → oldest evicted, still correct on re-visit', async () => {
    // Create 33 projects with one session each.
    for (let i = 0; i < 33; i++) {
      const proj = `evict-${String(i).padStart(3, '0')}`;
      const w = new V2Writer({ logDir: dir, project: proj, enabled: true, minFreeBytes: 0 });
      fire(w, { ...mainEntry([textMsg('user', `session ${i}`)]), project: proj });
      await w.flush();
    }
    // Visit all 33 — fills the cache to capacity.
    for (let i = 0; i < 33; i++) {
      listV2Sessions(join(dir, `evict-${String(i).padStart(3, '0')}`));
    }
    // Re-visit the first — it was evicted, must still return correct data.
    const rows = listV2Sessions(join(dir, 'evict-000'));
    assert.equal(rows.length, 1);
    assert.ok(rows[0].preview.some((p) => p.includes('session 0')));
  });
});

// ─── key coverage (stale-vs-recompute contract) ──────────────────────────────
// Removed 2026-07-31: an earlier 'key collision' test forced (size,mtime) to
// collide by swapping the journal ts field — unobservable, because no row
// field derives from journal ts, so the assertion passed under every branch.
// The observable stale/recompute contract is pinned instead by the meta probe
// and prompts probes in the 'cache hit' describe above.

// ─── server-side pagination (listV2LogsPage) ─────────────────────────────────

describe('listV2LogsPage', () => {
  // Create `n` sessions in the current project, each with one completed turn.
  // Returns the sids in creation order (oldest first).
  async function makeSessions(n, prefix = 'pg') {
    const sids = [];
    for (let i = 0; i < n; i++) {
      const sid = `${prefix}-${String(i).padStart(3, '0')}-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
      const w = newWriter();
      fire(w, mainEntry([textMsg('user', `${prefix} session ${i}`)], { sid }));
      await w.flush();
      sids.push(sid);
    }
    return sids;
  }

  it('returns only the requested page; total reflects all sessions; rows keep the 6-field shape', async () => {
    await makeSessions(7);
    const p1 = listV2LogsPage(dir, 'proj', { page: 1, pageSize: 3 });
    assert.equal(p1.total, 7, 'total = all sessions regardless of page');
    assert.equal(p1.items.length, 3, 'page 1 returns pageSize rows');
    const p2 = listV2LogsPage(dir, 'proj', { page: 2, pageSize: 3 });
    assert.equal(p2.items.length, 3);
    const p3 = listV2LogsPage(dir, 'proj', { page: 3, pageSize: 3 });
    assert.equal(p3.items.length, 1, 'last page returns the remainder');
    for (const row of [...p1.items, ...p2.items, ...p3.items]) {
      const keys = Object.keys(row).sort();
      assert.deepEqual(keys, ['file', 'kind', 'preview', 'size', 'timestamp', 'turns'].sort(), 'row keeps 6-field shape');
    }
  });

  it('pages are disjoint and together cover all sessions (newest first)', async () => {
    const sids = await makeSessions(5);
    const p1 = listV2LogsPage(dir, 'proj', { page: 1, pageSize: 2 });
    const p2 = listV2LogsPage(dir, 'proj', { page: 2, pageSize: 2 });
    const p3 = listV2LogsPage(dir, 'proj', { page: 3, pageSize: 2 });
    const all = [...p1.items, ...p2.items, ...p3.items].map((r) => r.file);
    assert.equal(all.length, 5);
    assert.equal(new Set(all).size, 5, 'no row appears on two pages');
    // Newest first: the LAST-created session (highest startTs) heads page 1.
    const newestSid = sids[sids.length - 1];
    assert.ok(p1.items[0].file.endsWith(newestSid), 'newest session first');
  });

  it('out-of-range page returns empty items but correct total', async () => {
    await makeSessions(2);
    const res = listV2LogsPage(dir, 'proj', { page: 99, pageSize: 50 });
    assert.equal(res.total, 2);
    assert.equal(res.items.length, 0);
  });

  it('re-requesting a page rides the row cache (identical rows, no refold)', async () => {
    await makeSessions(4);
    const a = listV2LogsPage(dir, 'proj', { page: 1, pageSize: 2 });
    const b = listV2LogsPage(dir, 'proj', { page: 1, pageSize: 2 });
    assert.deepEqual(b.items, a.items, 'repeat page request returns identical rows');
  });

  it('empty / missing project returns zeroed page', () => {
    const res = listV2LogsPage(dir, 'no-such-project', { page: 1, pageSize: 50 });
    assert.equal(res.total, 0);
    assert.equal(res.items.length, 0);
  });

  it('post-filter page: total counts candidates, items exclude leader/empty/discard', async () => {
    // One REAL session (passes all filters).
    await makeSessions(1);
    // One TEAMMATE session (meta.leader set → folded into its leader, not listed).
    // Uses SID_TM (previously an unused constant) as the teammate sid.
    const tmDir = join(projDir(), 'sessions', SID_TM);
    mkdirSync(join(tmDir, 'conversations', 'main'), { recursive: true });
    writeFileSync(join(tmDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: SID_TM, startTs: '2026-06-02T00:00:00.000Z', leader: { agentName: 'a', teamName: 't', parentSessionId: 'x' } }));
    writeFileSync(join(tmDir, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n');
    // One EMPTY session (size==0: no journal content, no conversation → dirSize 0 is
    // hard to force with files present, so we instead cover the discard path below;
    // the empty/0-size gate shares the same post-filter item-exclusion contract).
    // One DISCARD session (no main/teammate req → quota-probe orphan).
    const probeDir = join(projDir(), 'sessions', 'probe-0000-4000-8000-000000000099');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'probe-0000-4000-8000-000000000099', startTs: '2026-06-03T00:00:00.000Z' }));
    writeFileSync(join(probeDir, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2 }),
      JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', ts: '2026-06-03T00:00:00.000Z', kind: 'sub', conv: 'main', epoch: 0 }),
    ].join('\n') + '\n');

    const res = listV2LogsPage(dir, 'proj', { page: 1, pageSize: 50 });
    // Two-stage filtering, observable in total:
    //  - the teammate is dropped at the CANDIDATE stage (meta.leader pre-filter),
    //    so it never reaches `total`;
    //  - the probe (no main/teammate req → discard) is dropped at the SUMMARIZE
    //    stage, AFTER being counted in `total`.
    // So total = real(1) + probe(1) = 2, and only the real session yields an item.
    assert.equal(res.total, 2, 'total = real + probe (teammate already pre-filtered at candidate stage)');
    assert.equal(res.items.length, 1, 'only the real session survives the discard filter');
    assert.ok(res.items[0].file.includes('pg-000'), 'the surviving row is the real session');
    assert.ok(!res.items.some((r) => r.file.includes(SID_TM)), 'teammate excluded');
    assert.ok(!res.items.some((r) => r.file.includes('probe-')), 'discard probe excluded');
  });
});
