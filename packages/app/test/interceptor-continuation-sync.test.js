/**
 * Interceptor-side wiring of `-c` folder adoption (server/interceptor.js):
 *
 *   launch signals (CCV_CLAUDE_CONTINUE / CCV_CLAUDE_FORK_SESSION /
 *   CCV_CLAUDE_RESUME envs, markContinuedLaunch / markForkSession /
 *   markResumeSession workspace markers)
 *     → _syncContinuationMode() → V2Writer.setContinuationMode()
 *
 * The adoption decision itself is pinned in v2-continuation-adopt.test.js by
 * driving the writer directly; THIS file pins the upper half of the chain —
 * that the writer actually receives the {continued, fork, resume} the launch
 * implies — plus the getLiveLogSource cold-load fallback end-to-end (an
 * in-flight current session must fall back to the previous conversation, not
 * re-select itself).
 *
 * Module state note: the interceptor is a singleton; this file owns a fresh
 * process (node --test runs each file in its own child), envs are locked to a
 * mkdtemp dir BEFORE the dynamic import, and markContinuedLaunch (sticky by
 * design) is never called here so `continued` stays env-driven throughout.
 *
 * Data-safety: env is locked to a mkdtemp dir BEFORE any dynamic import of
 * project modules; fixtures never touch a real CCV_LOG_DIR.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-cont-sync-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1'; // interceptor boots project-less; tests bind via initForWorkspace
process.env.CCV_CLI_MODE = '0';
process.env.CCV_CLAUDE_CONTINUE = '1'; // set BEFORE import: the module-load seed must pick it up
delete process.env.CCV_CLAUDE_FORK_SESSION;
delete process.env.CCV_CLAUDE_RESUME;

let interceptor;
before(async () => { interceptor = await import('../server/interceptor.js'); });
const writer = () => interceptor._v2Writer;

describe('module-load seeding from the CLI env', () => {
  it('CCV_CLAUDE_CONTINUE=1 at import time reaches the writer', () => {
    assert.equal(writer()._continuationLaunch, true, 'continued seeded from env at module load');
    assert.equal(writer()._forkSession, false);
    assert.equal(writer()._resumeSession, false);
  });
});

describe('marker channels re-sync the writer', () => {
  it('markForkSession pushes fork:true (continued untouched)', () => {
    interceptor.markForkSession();
    assert.equal(writer()._forkSession, true);
    assert.equal(writer()._continuationLaunch, true);
  });

  it('markResumeSession pushes resume:true', () => {
    interceptor.markResumeSession();
    assert.equal(writer()._resumeSession, true);
  });

  it('initForWorkspace clears the fork+resume marks and re-syncs; env-continued persists', () => {
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projSync'));
    assert.equal(writer()._forkSession, false, 'fork mark is per-launch — must not leak into a later -c');
    assert.equal(writer()._resumeSession, false, 'resume mark is per-launch too');
    assert.equal(writer()._continuationLaunch, true, 'CCV_CLAUDE_CONTINUE env still set');
  });
});

describe('env channels re-sync on the next launch', () => {
  it('CCV_CLAUDE_FORK_SESSION / CCV_CLAUDE_RESUME reach the writer via initForWorkspace', () => {
    process.env.CCV_CLAUDE_FORK_SESSION = '1';
    process.env.CCV_CLAUDE_RESUME = '1';
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projSync'));
    assert.equal(writer()._forkSession, true, 'fork env channel');
    assert.equal(writer()._resumeSession, true, 'resume env channel');
    assert.equal(interceptor.isForkSession(), true);
    assert.equal(interceptor.isResumeSession(), true);
    delete process.env.CCV_CLAUDE_FORK_SESSION;
    delete process.env.CCV_CLAUDE_RESUME;
    delete process.env.CCV_CLAUDE_CONTINUE;
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projSync'));
    assert.equal(writer()._forkSession, false);
    assert.equal(writer()._resumeSession, false);
    assert.equal(writer()._continuationLaunch, false, 'no env, no marker — a plain launch');
  });
});

// ---------------------------------------------------------------------------
// getLiveLogSource end-to-end: with a previous COMPLETED session P on disk and
// the CURRENT session N still in-flight (main req written, no done), the
// cold-load source must be P — not N, which has nothing renderable yet. This
// is the non-adopted (`ccv` without -c) blank-flash path.
// ---------------------------------------------------------------------------
describe('getLiveLogSource falls back past the in-flight current session', () => {
  const SID_P = 'eeeeeeee-89ab-4cde-8f01-23456789abcd';
  const SID_N = 'ffffffff-89ab-4cde-8f01-23456789abcd';
  const uid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
  const entryOf = (sid, messages, ts) => ({
    timestamp: ts,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    body: {
      model: 'm',
      system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
      tools: [{ name: 'Bash' }],
      metadata: { user_id: uid(sid) }, messages,
    },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent: true, requestId: `r${Math.random()}`,
  });

  it('serves the previous completed session while the current one has no done, then switches', async () => {
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projLive')); // plain launch (envs cleared above)
    const w = writer();

    // Previous session P: one COMPLETED main turn.
    const e1 = entryOf(SID_P, [{ role: 'user', content: 'p' }], '2026-07-14T09:00:00.000Z');
    const h1 = w.ingestRequest(e1, e1.body.messages);
    w.ingestCompletion(h1, { ...e1, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    const pDir = w.currentSessionDir();
    assert.ok(pDir && pDir.includes(SID_P));
    assert.equal(interceptor.getLiveLogSource(), pDir, 'completed current session is served directly');

    // Current session N: in-flight (req written, response still streaming).
    const e2 = entryOf(SID_N, [{ role: 'user', content: 'n' }], '2026-07-14T10:00:00.000Z');
    w.ingestRequest(e2, e2.body.messages); // no completion
    await w.flush();
    const nDir = w.currentSessionDir();
    assert.ok(nDir && nDir.includes(SID_N), 'the writer moved on to N');
    assert.equal(interceptor.getLiveLogSource(), pDir,
      'cold load falls back to P — the fallback must not re-select the in-flight N it just rejected');

    // N completes → it becomes the cold-load source.
    const e3 = entryOf(SID_N, [{ role: 'user', content: 'n' }, { role: 'assistant', content: 'r' }, { role: 'user', content: 'n2' }], '2026-07-14T10:01:00.000Z');
    const h3 = w.ingestRequest(e3, e3.body.messages);
    w.ingestCompletion(h3, { ...e3, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    assert.equal(interceptor.getLiveLogSource(), nDir, 'once N has a completed main turn it is served');
  });
});

// ---------------------------------------------------------------------------
// getLiveLogSource skipForeignLive wiring (multi-window isolation): the
// fallback must SKIP a newest session claimed by another LIVE process and
// serve it again the moment that owner is dead. The predicate itself is
// unit-tested in v2-session-owner/v2-session-select; THIS pins the one-line
// wiring at interceptor.js getLiveLogSource — deleting `skipForeignLive: true`
// there must turn this red.
// ---------------------------------------------------------------------------
describe('getLiveLogSource skips a foreign-live claimed session (wiring)', () => {
  const SID_F = 'abababab-89ab-4cde-8f01-23456789abcd';
  const uid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });

  it("another live window's session is skipped; a dead owner's is served again", async () => {
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projForeign'));
    const w = writer();

    // Seed one COMPLETED session F through the real writer, then hand its
    // claim to "another live window" (process.ppid — the test runner).
    const e = {
      timestamp: '2026-07-14T09:00:00.000Z',
      url: 'https://api.anthropic.com/v1/messages', method: 'POST',
      body: {
        model: 'm', system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
        tools: [{ name: 'Bash' }], metadata: { user_id: uid(SID_F) },
        messages: [{ role: 'user', content: 'f' }],
      },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent: true, requestId: 'rf1',
    };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    const fDir = w.currentSessionDir();
    assert.ok(fDir && fDir.includes(SID_F));
    writeFileSync(join(fDir, 'owner.lock'), JSON.stringify({ pid: process.ppid, startedAt: 'x' }));

    // Re-bind the workspace: this process now has NO current session, so the
    // cold load rides the latestMainSessionDir fallback — which must NOT hand
    // back the other window's live session.
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projForeign'));
    assert.ok(!w.currentSessionDir(), 'fresh binding: no current session');
    assert.equal(interceptor.getLiveLogSource(), '',
      'the only candidate is foreign-live — intentional empty cold load, never the other window\'s conversation');

    // The owner "crashes": a reaped child pid makes the claim dead — the very
    // next cold load serves the session again (no permanent lock).
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(fDir, 'owner.lock'), JSON.stringify({ pid: deadPid, startedAt: 'x' }));
    assert.equal(interceptor.getLiveLogSource(), fDir, 'dead claim = unowned — served again');
  });
});

// ---------------------------------------------------------------------------
// markSessionStart wiring (SessionStart hook → V2Writer.beginResumeSwitch):
// only source:'resume' arms the switch; foreign-project cwd and missing
// transcript_path are ignored; the transcript basename becomes the target id.
// ---------------------------------------------------------------------------
describe('markSessionStart arms the writer resume switch', () => {
  const T_UUID = 'dddd4444-89ab-4cde-8f01-23456789abcd';

  it('source:resume with matching cwd → pending switch armed with transcript uuid', () => {
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projHook'));
    writer()._pendingResumeSwitch = null;
    interceptor.markSessionStart({
      source: 'resume',
      sessionId: 'eeee5555-89ab-4cde-8f01-23456789abcd',
      transcriptPath: `/Users/x/.claude/projects/p/${T_UUID}.jsonl`,
      cwd: '/Users/x/work/projHook',
    });
    assert.ok(writer()._pendingResumeSwitch, 'armed');
    assert.equal(writer()._pendingResumeSwitch.transcriptUuid, T_UUID);
    assert.equal(writer()._pendingResumeSwitch.hookSid, 'eeee5555-89ab-4cde-8f01-23456789abcd');
  });

  it('non-resume sources are ignored (teammate startup events land here too)', () => {
    writer()._pendingResumeSwitch = null;
    for (const source of ['startup', 'clear', 'compact', undefined]) {
      interceptor.markSessionStart({ source, transcriptPath: `/t/${T_UUID}.jsonl`, cwd: '/Users/x/work/projHook' });
    }
    assert.equal(writer()._pendingResumeSwitch, null);
  });

  it('foreign-project cwd is ignored; missing transcript_path is ignored', () => {
    writer()._pendingResumeSwitch = null;
    interceptor.markSessionStart({ source: 'resume', transcriptPath: `/t/${T_UUID}.jsonl`, cwd: '/elsewhere/otherProj' });
    assert.equal(writer()._pendingResumeSwitch, null, 'cross-project signal dropped');
    interceptor.markSessionStart({ source: 'resume', cwd: '/Users/x/work/projHook' });
    assert.equal(writer()._pendingResumeSwitch, null, 'no transcript_path → dropped');
  });
});
