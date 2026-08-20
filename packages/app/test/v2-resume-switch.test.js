/**
 * In-terminal /resume routing switch (server/lib/v2/v2-writer.js
 * beginResumeSwitch / _resolveResumeSwitch).
 *
 * An in-terminal /resume switches the running claude to a PAST conversation
 * while the wire session_id may stay the SAME — without a re-bind the writer
 * grafts the resumed conversation onto the old session dir (snapshot
 * tail-mismatch) and the panel (keyed on `_seqEpoch = v2:<dir identity>`)
 * never switches. The SessionStart hook (source:'resume') arms a one-shot
 * switch consumed by the next real MAIN request:
 *   - recorded target (dir resolved by transcript uuid) → re-join it,
 *     identity preserved (meta.sessionId), claim transferred;
 *   - target held by another LIVE window → fresh dir (fork semantics);
 *   - never recorded → fresh `<ts>_<hookSid>` dir;
 *   - same-sid re-bind drops the old binding and releases its claim.
 *
 * Data-safety: mkdtemp only; never touches a real CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { _resetForTest } from '@ccv/core/error-report';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-resume-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID_A = 'aaaa1111-89ab-4cde-8f01-23456789abcd'; // launch session (wire sid stays this)
const SID_R = 'bbbb2222-89ab-4cde-8f01-23456789abcd'; // the resumed conversation's transcript uuid
const HOOK_SID = 'cccc3333-89ab-4cde-8f01-23456789abcd'; // fresh uuid the hook mints
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function mainEntry(messages, { sid = SID_A, ts, countTokens = false, heartbeat = false } = {}) {
  return {
    timestamp: ts || '2026-07-17T09:00:00.000Z',
    project: 'proj', url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {},
    body: { model: 'm', system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }], tools: [{ name: 'Edit' }], metadata: { user_id: userIdOf(sid) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: heartbeat, isCountTokens: countTokens,
    mainAgent: true, requestId: `rid_${Math.random()}`,
  };
}
const newWriter = () => new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0 });
function fire(w, entry) {
  const h = w.ingestRequest(entry, entry.body.messages);
  w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
  return h;
}
const sessionsRoot = () => join(dir, 'proj', 'sessions');
const dirsInProject = () => (existsSync(sessionsRoot()) ? readdirSync(sessionsRoot()) : []);
const dirOf = (suffix) => dirsInProject().find((n) => n.endsWith('_' + suffix) || n === suffix);
const journalLen = (name) => readFileSync(join(sessionsRoot(), name, 'journal.jsonl'), 'utf-8').trim().split('\n').length;

// Seed the RESUMED conversation's recorded dir (transcript uuid SID_R) with
// one completed main turn, written by a separate writer that then closed
// (its claim released — a past window's session).
async function seedResumedDir() {
  const w = newWriter();
  fire(w, mainEntry([textMsg('user', 'resumed conversation history')], { sid: SID_R, ts: '2026-07-17T08:00:00.000Z' }));
  await w.flush(); await w.close();
  const name = dirOf(SID_R);
  assert.ok(name, 'seed dir exists');
  return name;
}

describe('same-sid re-bind (the actual /resume wire behavior)', () => {
  it('re-joins the recorded dir: writes land there, identity preserved, claims transferred', async () => {
    const seedName = await seedResumedDir();
    const seedJournalBefore = journalLen(seedName);

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume turn')], { sid: SID_A })); // launch session
    await w.flush();
    const oldName = dirOf(SID_A);
    const oldDir = join(sessionsRoot(), oldName);
    const oldJournalBefore = journalLen(oldName);
    assert.equal(JSON.parse(readFileSync(join(oldDir, 'owner.lock'), 'utf-8')).pid, process.pid);

    // /resume signal, then the next main request arrives on the SAME sid but
    // carrying the resumed conversation's history.
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });
    fire(w, mainEntry([textMsg('user', 'resumed conversation history'), textMsg('assistant', 'r'), textMsg('user', 'post-resume turn')], { sid: SID_A, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush();

    assert.equal(dirsInProject().length, 2, 'no third dir minted');
    assert.ok(journalLen(seedName) > seedJournalBefore, 'post-resume writes land in the RESUMED dir');
    assert.equal(journalLen(oldName), oldJournalBefore, 'the old dir stops receiving writes');
    const seedMeta = JSON.parse(readFileSync(join(sessionsRoot(), seedName, 'meta.json'), 'utf-8'));
    assert.equal(seedMeta.sessionId, SID_R, 'identity preserved (first-write-wins) → _seqEpoch continues v2:<R>');
    assert.equal(existsSync(join(oldDir, 'owner.lock')), false, 'old dir claim released (its conversation ended)');
    assert.equal(JSON.parse(readFileSync(join(sessionsRoot(), seedName, 'owner.lock'), 'utf-8')).pid, process.pid, 'resumed dir claimed by this process');

    // Continuity: writes keep flowing to the resumed dir on the same sid.
    const after = journalLen(seedName);
    fire(w, mainEntry([textMsg('user', 'x'), textMsg('assistant', 'y'), textMsg('user', 'z')], { sid: SID_A, ts: '2026-07-17T09:06:00.000Z' }));
    await w.flush();
    assert.ok(journalLen(seedName) > after, 'subsequent same-sid requests stay bound to the resumed dir');
    await w.close();
  });

  it('never-recorded target → fresh dir named by the hook sid (not the old wire sid)', async () => {
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume')], { sid: SID_A }));
    await w.flush();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID }); // SID_R has no recorded dir
    fire(w, mainEntry([textMsg('user', 'resumed elsewhere')], { sid: SID_A, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush(); await w.close();
    const names = dirsInProject();
    assert.equal(names.length, 2);
    const fresh = dirOf(HOOK_SID);
    assert.ok(fresh, 'fresh dir carries the hook sid as identity');
    assert.equal(JSON.parse(readFileSync(join(sessionsRoot(), fresh, 'meta.json'), 'utf-8')).sessionId, HOOK_SID);
    assert.ok(!fresh.endsWith('_' + SID_A), 'must NOT be named by the old wire sid (resolveSessionDirName would loop it back to the old dir)');
  });

  it('target held by another LIVE window → fresh dir (fork semantics, no shared journal)', async () => {
    const seedName = await seedResumedDir();
    writeFileSync(join(sessionsRoot(), seedName, 'owner.lock'), JSON.stringify({ pid: process.ppid, startedAt: 'x' }));
    const seedBefore = journalLen(seedName);

    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume')], { sid: SID_A }));
    await w.flush();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });
    fire(w, mainEntry([textMsg('user', 'resume into a live session')], { sid: SID_A, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush(); await w.close();

    assert.equal(journalLen(seedName), seedBefore, 'the live window\'s journal is untouched');
    assert.equal(JSON.parse(readFileSync(join(sessionsRoot(), seedName, 'owner.lock'), 'utf-8')).pid, process.ppid, 'its claim is not stolen');
    assert.ok(dirOf(HOOK_SID), 'the resume landed in a fresh dir instead');
  });

  it('a DEAD previous owner of the target is recycled (crash never blocks re-join)', async () => {
    const seedName = await seedResumedDir();
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(sessionsRoot(), seedName, 'owner.lock'), JSON.stringify({ pid: deadPid, startedAt: 'x' }));
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume')], { sid: SID_A }));
    await w.flush();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });
    fire(w, mainEntry([textMsg('user', 'resume after crash')], { sid: SID_A, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush();
    assert.equal(JSON.parse(readFileSync(join(sessionsRoot(), seedName, 'owner.lock'), 'utf-8')).pid, process.pid, 'dead claim recycled, re-join succeeded');
    await w.close();
  });
});

describe('fresh-sid variant (wire minted a new sid after /resume)', () => {
  it('the fresh sid is routed into the recorded dir, not a new one', async () => {
    const seedName = await seedResumedDir();
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume')], { sid: SID_A }));
    await w.flush();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });
    // Post-resume request arrives on a brand-new wire sid.
    fire(w, mainEntry([textMsg('user', 'resumed conversation history'), textMsg('assistant', 'r'), textMsg('user', 'next')], { sid: HOOK_SID, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush();
    assert.equal(dirsInProject().length, 2, 'no third dir — the fresh sid adopted the recorded dir');
    assert.equal(JSON.parse(readFileSync(join(sessionsRoot(), seedName, 'meta.json'), 'utf-8')).sessionId, SID_R);
    // The DEPARTING conversation was keyed by the OLD sid — its binding and
    // claim must be released too (fresh-sid leak, review P2): asserted before
    // close() so the release can't be attributed to the shutdown sweep.
    const oldName = dirOf(SID_A);
    assert.equal(existsSync(join(sessionsRoot(), oldName, 'owner.lock')), false,
      'old conversation\'s claim released on the fresh-sid path as well');
    await w.close();
  });
});

describe('consumption discipline', () => {
  it('one-shot: only the first main request re-binds; probes/heartbeats do not consume', async () => {
    await seedResumedDir();
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'pre-resume')], { sid: SID_A }));
    await w.flush();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });

    // A countTokens probe wearing the main body shape must NOT consume.
    const probe = mainEntry([textMsg('user', 'probe')], { sid: SID_A, countTokens: true });
    fire(w, probe);
    await w.flush();
    assert.ok(w._pendingResumeSwitch, 'probe left the pending switch armed');

    // Neither must a heartbeat (each exclusion arm pinned independently).
    fire(w, mainEntry([textMsg('user', 'hb')], { sid: SID_A, heartbeat: true }));
    await w.flush();
    assert.ok(w._pendingResumeSwitch, 'heartbeat left the pending switch armed');

    fire(w, mainEntry([textMsg('user', 'real turn')], { sid: SID_A, ts: '2026-07-17T09:05:00.000Z' }));
    await w.flush();
    assert.equal(w._pendingResumeSwitch, null, 'real main request consumed it');
    await w.close();
  });

  it('last-wins across repeated /resume picks; resetSessions clears the signal', async () => {
    const w = newWriter();
    w.beginResumeSwitch({ transcriptUuid: SID_R, hookSid: HOOK_SID });
    w.beginResumeSwitch({ transcriptUuid: SID_A, hookSid: HOOK_SID });
    assert.equal(w._pendingResumeSwitch.transcriptUuid, SID_A, 'last pick wins');
    w.resetSessions();
    assert.equal(w._pendingResumeSwitch, null, 'workspace switch clears a stale signal');
    await w.close();
  });

  it('invalid signals are ignored (no transcriptUuid)', async () => {
    const w = newWriter();
    w.beginResumeSwitch({});
    w.beginResumeSwitch({ transcriptUuid: 42 });
    assert.equal(w._pendingResumeSwitch, null);
    await w.close();
  });
});
