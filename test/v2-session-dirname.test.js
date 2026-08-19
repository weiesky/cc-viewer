/**
 * Task C — v2 session dir naming `<yyyymmddhhmmss>_<uuid>` + identity/path
 * decouple (server/lib/v2/{layout,v2-writer,adapter,session-select}.js).
 *
 * Pins the load-bearing invariants the coupling review flagged:
 *   - create-with-ts: a new session's dir is `<14digits>_<uuid>`, ts from the
 *     first request's timestamp; meta.sessionId + journal sentinel stay the UUID
 *   - restart / `-c` reuse: a fresh writer (empty _sessions map) re-attaches to
 *     the SAME dir (no `<ts2>_<uuid>` sibling, seq continues) — P0-1
 *   - teammate linkage survives the rename: a teammate whose
 *     meta.leader.parentSessionId is the bare UUID still folds into the renamed
 *     leader (matched via meta.sessionId, not basename) — P0-2
 *   - format-defensive: bare-UUID / garbage dirs are read name-agnostically and
 *     never crash the readers
 *   - _seqEpoch = v2:<uuid> (identity, stable across the dir rename)
 *
 * Data-safety: mkdtemp only; never touches a real CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { V2Writer } from '../packages/app/server/lib/v2/v2-writer.js';
import { iterateV2RawEntries, findTeammateSessionDirs } from '../packages/app/server/lib/v2/adapter.js';
import { resolveSessionDirName, latestMainSessionDir } from '../packages/app/server/lib/v2/session-select.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-dirname-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'c1234567-89ab-4cde-8f01-23456789abcd';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const NAME_RE = /^\d{14}_/;

function mainEntry(messages, { ts, sid = SID } = {}) {
  return {
    timestamp: ts || '2026-07-14T09:08:07.000Z',
    project: 'proj', url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST', headers: {},
    body: { model: 'm', system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }], tools: [{ name: 'Edit' }], metadata: { user_id: userIdOf(sid) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false, mainAgent: true, requestId: `rid_${Math.random()}`,
  };
}
const newWriter = (extra = {}) => new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0, ...extra });
function fire(w, entry) {
  const h = w.ingestRequest(entry, entry.body.messages);
  w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
  return h;
}
const sessionsRoot = () => join(dir, 'proj', 'sessions');
const dirsInProject = () => (existsSync(sessionsRoot()) ? readdirSync(sessionsRoot()) : []);

describe('create-with-ts', () => {
  it('names the dir <14digits>_<uuid> from the first request ts; identity stays the UUID', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'hello')], { ts: '2026-07-14T09:08:07.000Z' }));
    await w.flush();
    const names = dirsInProject();
    assert.equal(names.length, 1);
    const name = names[0];
    assert.match(name, NAME_RE, 'dir prefixed with 14 digits + _');
    assert.ok(name.endsWith('_' + SID), 'dir ends with the UUID');
    // 14-digit prefix is LOCAL time of the first request (compare digits count, not tz).
    assert.equal(name.split('_')[0].length, 14);
    // Identity: meta.sessionId + journal sentinel = the UUID (not the dir name).
    const sdir = join(sessionsRoot(), name);
    const meta = JSON.parse(readFileSync(join(sdir, 'meta.json'), 'utf-8'));
    assert.equal(meta.sessionId, SID);
    assert.equal(meta.startTs, '2026-07-14T09:08:07.000Z', 'startTs = first request ts');
    const sentinel = JSON.parse(readFileSync(join(sdir, 'journal.jsonl'), 'utf-8').split('\n')[0]);
    assert.equal(sentinel.sessionId, SID);
    // _seqEpoch derives from the UUID (stable across a rename), not the dir name.
    const first = JSON.parse([...iterateV2RawEntries(sdir)][0]);
    assert.equal(first._seqEpoch, `v2:${SID}`);
  });
});

describe('restart / -c reuse (P0-1)', () => {
  it('a fresh writer for the same UUID reuses the existing dir; seq continues; no sibling', async () => {
    const w1 = newWriter();
    fire(w1, mainEntry([textMsg('user', 'turn 1')], { ts: '2026-07-14T09:00:00.000Z' }));
    await w1.flush();
    const nameAfter1 = dirsInProject();
    assert.equal(nameAfter1.length, 1);

    // Simulate a process restart / -c: brand-new writer, empty _sessions map,
    // a LATER ts. Must re-attach to the existing dir, not mint <ts2>_<uuid>.
    const w2 = newWriter();
    fire(w2, mainEntry([textMsg('user', 'turn 1'), textMsg('assistant', 'r1'), textMsg('user', 'turn 2')], { ts: '2026-07-14T10:00:00.000Z' }));
    await w2.flush();

    const names = dirsInProject();
    assert.equal(names.length, 1, 'exactly one dir for the UUID — no split');
    assert.equal(names[0], nameAfter1[0], 'same dir name (original ts prefix preserved)');
    // Journal seq continues monotonically across the two writers.
    const sdir = join(sessionsRoot(), names[0]);
    const seqs = readFileSync(join(sdir, 'journal.jsonl'), 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).filter((o) => o.ph === 'req').map((o) => o.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seqs monotonic');
    assert.equal(new Set(seqs).size, seqs.length, 'no duplicate seq');
  });

  it('resolveSessionDirName finds the dir by UUID suffix and exact-legacy', () => {
    mkdirSync(join(sessionsRoot(), `20260714090807_${SID}`), { recursive: true });
    assert.equal(resolveSessionDirName(join(dir, 'proj'), SID), `20260714090807_${SID}`);
    // legacy bare dir
    const other = 'a0000000-0000-4000-8000-000000000001';
    mkdirSync(join(sessionsRoot(), other), { recursive: true });
    assert.equal(resolveSessionDirName(join(dir, 'proj'), other), other);
    // unknown
    assert.equal(resolveSessionDirName(join(dir, 'proj'), 'ffffffff-0000-4000-8000-000000000000'), null);
  });
});

describe('teammate linkage survives the rename (P0-2)', () => {
  it('a teammate whose parentSessionId is the bare leader UUID still folds into the renamed leader', async () => {
    const wl = newWriter();
    fire(wl, mainEntry([textMsg('user', 'leader work')], { ts: '2026-07-14T09:00:00.000Z' }));
    await wl.flush();
    const leaderDir = join(sessionsRoot(), resolveSessionDirName(join(dir, 'proj'), SID));
    assert.match(basename(leaderDir), NAME_RE);

    // Teammate process: its meta.leader.parentSessionId is the leader's UUID
    // (from --parent-session-id), NOT the leader's `<ts>_<uuid>` dir name.
    const TM_SID = 'a0000000-0000-4000-8000-00000000000a';
    const wt = newWriter({ leader: { agentName: 'worker-1', teamName: 'team-x', parentSessionId: SID } });
    fire(wt, mainEntry([textMsg('user', 'teammate work')], { ts: '2026-07-14T09:05:00.000Z', sid: TM_SID }));
    await wt.flush();

    // findTeammateSessionDirs must match parentSessionId against the leader's
    // meta.sessionId (UUID), not its basename.
    const joined = findTeammateSessionDirs(leaderDir, SID);
    assert.equal(joined.length, 1, 'teammate folded into the renamed leader');
    assert.equal(joined[0].leader.agentName, 'worker-1');

    // End-to-end: reading the leader renders the teammate entry, tagged.
    const entries = [...iterateV2RawEntries(leaderDir)].map((r) => JSON.parse(r));
    assert.ok(entries.some((e) => e.teammate === 'worker-1'), 'teammate entry present in leader stream');
  });
});

describe('format-defensive readers', () => {
  it('bare-UUID and garbage dirs are read name-agnostically / skipped without throwing', async () => {
    // A real writer session (new format).
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'real')], { ts: '2026-07-14T09:00:00.000Z' }));
    await w.flush();
    // A hand-built legacy bare-UUID session (still readable — reader is name-agnostic).
    const bare = 'b0000000-0000-4000-8000-000000000002';
    const bareDir = join(sessionsRoot(), bare);
    mkdirSync(join(bareDir, 'conversations', 'main'), { recursive: true });
    writeFileSync(join(bareDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: bare, project: 'proj', startTs: '2026-07-14T08:00:00.000Z' }));
    writeFileSync(join(bareDir, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: bare }) + '\n');
    // A garbage dir (no journal) + a stray file — must be skipped, not crash.
    mkdirSync(join(sessionsRoot(), 'garbage-not-a-session'), { recursive: true });
    writeFileSync(join(sessionsRoot(), 'stray.txt'), 'x');

    // latestMainSessionDir must pick a real main session and not throw.
    const latest = latestMainSessionDir(join(dir, 'proj'));
    assert.ok(existsSync(join(latest, 'journal.jsonl')), 'picked a readable session');
    // findTeammateSessionDirs over the garbage-adjacent root must not throw.
    assert.doesNotThrow(() => findTeammateSessionDirs(join(sessionsRoot(), resolveSessionDirName(join(dir, 'proj'), SID)), SID));
    // The bare legacy session still reads (name-agnostic).
    assert.equal([...iterateV2RawEntries(bareDir)].length, 0, 'bare session with no reqs reads empty, not crash');
  });
});
