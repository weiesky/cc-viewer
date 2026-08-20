/**
 * `-c` continuation folder ADOPTION (server/lib/v2/{v2-writer,session-select}.js).
 *
 * Claude CLI 2.1.210 hands a FRESH wire session_id (metadata.user_id.session_id)
 * on every `-c`/`--continue`, so cc-viewer used to mint a new blank session
 * folder each continue and the [对话] panel showed the empty new session. A
 * continuation launch now ADOPTS the previous main session's folder: the new
 * wire sid's writes are routed into that existing folder (identity preserved via
 * meta.sessionId first-write-wins), so the log continues in place.
 *
 * Pins:
 *   - adopt: continuation launch + wire replaying assistant history ⇒ NO new
 *     folder; writes land in the previous folder; identity (`_seqEpoch`) stable;
 *     the continued turn is readable.
 *   - `--fork-session` (fork=true) ⇒ new folder, never adopts.
 *   - explicit `-r`/`--resume` (resume=true) ⇒ new folder — adoption targets
 *     the LATEST main session, not the user's chosen one, so it serves `-c` only.
 *   - no previous main session ⇒ new folder (nothing to adopt).
 *   - leader/subagent writer ⇒ never adopts.
 *   - same-UUID re-attach ⇒ existing reuse path (resolveSessionDirName), NOT the
 *     adoption path — adoption must not hijack a real restart.
 *   - retry-without-`-c` signature (single user message, no assistant turn) ⇒ no
 *     adoption even with the continuation flag set (pty-manager strips `-c`).
 *   - resetSessions (workspace switch) re-enables adoption.
 *   - sessionHasCompletedMainTurn: an in-flight main req (no done) is NOT
 *     "activated"; a completed one is — even when the done lands far past the
 *     256KB head (streaming scan).
 *   - latestMainSession excludeDir: the cold-load fallback skips the in-flight
 *     current session instead of re-selecting the dir the completed-turn gate
 *     just rejected.
 *
 * Data-safety: mkdtemp only; never touches a real CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import {
  latestMainSession, latestMainSessionDir,
  sessionHasMainTurn, sessionHasCompletedMainTurn,
} from '../server/lib/v2/session-select.js';
import { iterateV2RawEntries } from '../server/lib/v2/adapter.js';
import { _resetForTest } from '@ccv/core/error-report';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-adopt-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID_A = 'aaaaaaaa-89ab-4cde-8f01-23456789abcd';
const SID_B = 'bbbbbbbb-89ab-4cde-8f01-23456789abcd';
const SID_C = 'cccccccc-89ab-4cde-8f01-23456789abcd';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function mainEntry(messages, { ts, sid = SID_A } = {}) {
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

// The replayed-history wire of a `-c` continuation: prior user+assistant turns
// followed by the new user prompt (this is what Claude sends on the wire).
const continuedMsgs = (newPrompt) => [
  textMsg('user', 'first prompt'),
  textMsg('assistant', 'first reply'),
  textMsg('user', newPrompt),
];

// Seed a previous MAIN session (SID_A) with one completed main turn.
async function seedPrev() {
  const w = newWriter();
  fire(w, mainEntry([textMsg('user', 'first prompt')], { ts: '2026-07-14T09:00:00.000Z', sid: SID_A }));
  await w.flush();
  await w.close();
  const names = dirsInProject();
  assert.equal(names.length, 1, 'seed created exactly one session folder');
  return names[0];
}

describe('adopts the previous main folder on a -c continuation', () => {
  it('routes a fresh wire sid into the previous folder — no new folder, identity stable, turn readable', async () => {
    const seedName = await seedPrev();

    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('second prompt'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush();
    await w.close();

    const names = dirsInProject();
    assert.equal(names.length, 1, 'NO new folder minted — the -c writes adopt the previous folder');
    assert.equal(names[0], seedName, 'the surviving folder is the previous session (identity/basename unchanged)');
    assert.ok(names[0].endsWith('_' + SID_A), 'folder still carries the ORIGINAL uuid, not the fresh wire sid');

    const sdir = join(sessionsRoot(), names[0]);
    const meta = JSON.parse(readFileSync(join(sdir, 'meta.json'), 'utf-8'));
    assert.equal(meta.sessionId, SID_A, 'meta.sessionId preserved (first-write-wins) → _seqEpoch stays v2:<A>');

    const entries = [...iterateV2RawEntries(sdir)].map((r) => JSON.parse(r));
    assert.ok(entries.length >= 2, 'both the seed turn and the continued turn are present');
    for (const e of entries) {
      if (e._seqEpoch != null) assert.equal(e._seqEpoch, 'v2:' + SID_A, 'one continuous session identity');
    }
    assert.ok(entries.some((e) => JSON.stringify(e).includes('second prompt')), 'the continued turn is readable in the adopted folder');
  });
});

describe('does NOT adopt', () => {
  it('--fork-session mints a new folder (user wants a fresh session)', async () => {
    const seedName = await seedPrev();
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: true });
    fire(w, mainEntry(continuedMsgs('forked'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject().sort();
    assert.equal(names.length, 2, 'fork-session mints its own folder');
    assert.ok(names.some((n) => n.endsWith('_' + SID_A)) && names.some((n) => n.endsWith('_' + SID_B)));
    assert.notEqual(names[0], seedName === names[0] ? names[1] : names[0], 'two distinct folders');
  });

  it('an explicit -r/--resume (resume=true) keeps its own folder — adoption serves -c only', async () => {
    await seedPrev();
    const w = newWriter();
    // A resume that Claude hands a fresh wire sid: adoption would misroute it
    // into the LATEST main session instead of the one the user chose.
    w.setContinuationMode({ continued: true, fork: false, resume: true });
    fire(w, mainEntry(continuedMsgs('resumed an older session'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 2, 'explicit resume mints its own folder, never redirected to the latest main session');
    assert.ok(names.some((n) => n.endsWith('_' + SID_B)));
  });

  it('no previous main session ⇒ the continuation creates its own folder', async () => {
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('lonely'), { sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 1);
    assert.ok(names[0].endsWith('_' + SID_B), 'created its own folder — nothing to adopt');
  });

  it('a leader/subagent writer never adopts', async () => {
    await seedPrev();
    const w = newWriter({ leader: { agentName: 'sub', teamName: 't' } });
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('teammate'), { sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 2, 'teammate writer keeps its own folder, does not hijack the main session');
    assert.ok(names.some((n) => n.endsWith('_' + SID_B)));
  });

  it('a same-uuid re-attach uses the existing reuse path, not adoption', async () => {
    const seedName = await seedPrev();
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    // Same wire sid as the seed — resolveSessionDirName finds its own folder, so
    // adoption must not fire (and would be a no-op anyway).
    fire(w, mainEntry(continuedMsgs('same uuid'), { sid: SID_A }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 1, 'reused its own folder via the standard reuse scan');
    assert.equal(names[0], seedName);
  });

  it('the retry-without-c signature (single user message, no assistant turn) does not adopt', async () => {
    await seedPrev();
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false }); // flag still set (env sticky), but the wire is fresh
    fire(w, mainEntry([textMsg('user', 'brand new conversation')], { sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 2, 'a genuinely fresh conversation (no replayed history) mints its own folder');
    assert.ok(names.some((n) => n.endsWith('_' + SID_B)));
  });
});

describe('multi-window isolation: adoption respects the live-owner claim', () => {
  const lockOf = (name) => join(sessionsRoot(), name, 'owner.lock');
  const claim = (name, pid) => writeFileSync(lockOf(name), JSON.stringify({ pid, startedAt: '2026-07-14T09:00:00.000Z' }));

  it('a previous dir claimed by another LIVE process is never adopted — fresh folder (fork semantics)', async () => {
    const seedName = await seedPrev();
    claim(seedName, process.ppid); // the live test runner stands in for a parallel window
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('second window -c'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 2, 'no adoption into a live foreign session — two writers must never share a journal');
    assert.ok(names.some((n) => n.endsWith('_' + SID_B)), 'the -c launch minted its own folder');
  });

  it('a DEAD owner claim is recycled and adoption proceeds (crash never locks a dir forever)', async () => {
    const seedName = await seedPrev();
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid; // exited → dead
    claim(seedName, deadPid);
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('after a crash'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush();
    assert.equal(dirsInProject().length, 1, 'adopted the crashed window\'s folder');
    // The claim transferred to the adopter while it was live…
    assert.equal(JSON.parse(readFileSync(lockOf(seedName), 'utf-8')).pid, process.pid);
    await w.close();
    // …and a clean close released it.
    assert.equal(existsSync(lockOf(seedName)), false, 'close() released the adopted claim');
  });

  it('a dir claimed by THIS process is still adoptable (same-process re-launch / multi-tab)', async () => {
    const seedName = await seedPrev();
    claim(seedName, process.pid);
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('own claim'), { ts: '2026-07-14T10:00:00.000Z', sid: SID_B }));
    await w.flush(); await w.close();
    assert.equal(dirsInProject().length, 1, 'idempotent self-claim does not block adoption');
    assert.equal(dirsInProject()[0], seedName);
  });
});

describe('resetSessions re-enables adoption for a second workspace launch', () => {
  it('adopts again after resetSessions', async () => {
    const seedName = await seedPrev();
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('b'), { sid: SID_B }));
    await w.flush();
    assert.equal(dirsInProject().length, 1, 'first -c adopted');
    // Simulate a workspace switch: sessions + adoption latch reset.
    w.resetSessions();
    w.setContinuationMode({ continued: true, fork: false });
    fire(w, mainEntry(continuedMsgs('c'), { sid: SID_C }));
    await w.flush(); await w.close();
    assert.equal(dirsInProject().length, 1, 'the second -c adopted the same previous folder (still no new folder)');
    assert.equal(dirsInProject()[0], seedName);
  });
});

describe('sessionHasCompletedMainTurn vs sessionHasMainTurn', () => {
  it('an in-flight main request is NOT a completed turn; a done makes it one', async () => {
    // In-flight: req written, no completion.
    const w = newWriter();
    const entry = mainEntry([textMsg('user', 'hi')], { sid: SID_A });
    w.ingestRequest(entry, entry.body.messages); // no ingestCompletion
    await w.flush();
    const sdir = join(sessionsRoot(), dirsInProject()[0]);
    assert.equal(sessionHasMainTurn(sdir), true, 'a main req line alone counts as a main turn');
    assert.equal(sessionHasCompletedMainTurn(sdir), false, 'but not a COMPLETED main turn (no done) → cold-load keeps falling back');

    // Complete it.
    const w2 = newWriter();
    fire(w2, mainEntry([textMsg('user', 'hi'), textMsg('assistant', 'yo'), textMsg('user', 'again')], { sid: SID_A }));
    await w2.flush(); await w2.close();
    assert.equal(sessionHasCompletedMainTurn(sdir), true, 'a req with a matching done is a completed main turn');
    assert.equal(latestMainSessionDir(join(dir, 'proj')), sdir);
    assert.equal(latestMainSession(join(dir, 'proj')).sessionId, SID_A);
  });

  it('finds a main done that lands far past the 256KB head (heavy multi-agent first turn)', async () => {
    const w = newWriter();
    const entry = mainEntry([textMsg('user', 'hi')], { sid: SID_A });
    w.ingestRequest(entry, entry.body.messages); // main req at the head, no done yet
    await w.flush(); await w.close();
    const sdir = join(sessionsRoot(), dirsInProject()[0]);
    const journal = join(sdir, 'journal.jsonl');
    // The main req is not necessarily line 0 (the journal opens with a sentinel line).
    const mainSeq = readFileSync(journal, 'utf-8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((o) => o && o.ph === 'req' && o.kind === 'main').seq;
    // Interleave ~400KB of sub/heartbeat traffic before the main done — the
    // shape that used to push the done outside the old single-head-read window.
    const pad = 'x'.repeat(1000);
    let filler = '';
    for (let i = 0; i < 400; i++) {
      filler += JSON.stringify({ ph: 'req', seq: mainSeq + 1 + i, rid: `sub${i}`, kind: 'sub', pad }) + '\n';
    }
    appendFileSync(journal, filler);
    assert.equal(sessionHasCompletedMainTurn(sdir), false, 'still in-flight: no done for the main seq anywhere');
    appendFileSync(journal, JSON.stringify({ ph: 'done', seq: mainSeq, rid: 'r', status: 'ok' }) + '\n');
    assert.equal(sessionHasMainTurn(sdir), true);
    assert.equal(sessionHasCompletedMainTurn(sdir), true, 'the streaming scan correlates a done megabytes past the head');
  });
});

describe('cold-load fallback skips the in-flight current session (excludeDir)', () => {
  it('latestMainSession excludes the given dir so the previous conversation is selected', async () => {
    // Previous session P: one COMPLETED main turn.
    const seedName = await seedPrev();
    // Newer in-flight session N (fresh `ccv`, NOT a continuation): req only, no done.
    const w = newWriter();
    const entry = mainEntry([textMsg('user', 'hi')], { ts: '2026-07-14T10:00:00.000Z', sid: SID_B });
    w.ingestRequest(entry, entry.body.messages);
    await w.flush(); await w.close();
    const nDir = join(sessionsRoot(), dirsInProject().find((n) => n.endsWith('_' + SID_B)));
    const pDir = join(sessionsRoot(), seedName);
    assert.equal(sessionHasCompletedMainTurn(nDir), false, 'N is in-flight — the strict gate rejects it');
    // Without exclusion the weak has-a-main-req gate re-selects N (newest) —
    // exactly the nullification getLiveLogSource must avoid…
    assert.equal(latestMainSessionDir(join(dir, 'proj')), nDir);
    // …excludeDir (what getLiveLogSource passes) lands on the previous, renderable session.
    assert.equal(latestMainSessionDir(join(dir, 'proj'), { excludeDir: nDir }), pDir);
  });
});
