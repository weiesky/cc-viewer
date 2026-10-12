/**
 * Per-cwd SDK session registry (sdk-manager.js, 2026-10-12) — the multi-session seam that
 * replaces the single resident session: launching a workspace registers one session per cwd,
 * the active pointer selects which workspace the SDK composer talks to, and each session's
 * child env self-tags `x-ccv-project-dir` so its transcript routes to its own project.
 *
 * Fake query via __setQueryForTests (no real SDK child is spawned). Isolated CCV_LOG_DIR.
 */
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-reg-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const sdk = await import('../server/lib/sdk-manager.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
afterEach(() => { sdk.stopSession(); sdk.__setQueryForTests(undefined); });

/** Minimal resident fake query: emits an init, then one result per pushed user message. */
function makeQuery(record) {
  return ({ prompt, options }) => {
    record.push({ cwd: options.cwd, env: options.env, model: options.model, permissionMode: options.permissionMode });
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: `s-${options.cwd}`, model: options.model || 'm', slash_commands: ['x'] };
      for await (const item of prompt) {
        if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: `s-${options.cwd}`, is_error: false, result: 'ok' };
      }
    })();
    q.close = () => { q._closed = true; };
    q.interrupt = () => Promise.resolve();
    return q;
  };
}
const deps = { broadcastWs() {}, onTurnEnd() {} };
const tick = (n = 8) => new Promise((r) => setTimeout(r, n));

describe('sdk-manager per-cwd session registry', () => {
  it('each initSdkSession registers one record per cwd; last init is active', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps);
    const cwds = sdk.listSdkSessions().map((s) => s.cwd).sort();
    assert.deepEqual(cwds, ['/wa', '/wb']);
    assert.equal(sdk.getActiveSdkCwd(), '/wb', 'last-initialized session is active');
    const byActive = sdk.listSdkSessions().find((s) => s.active);
    assert.equal(byActive.cwd, '/wb');
  });

  it('re-initializing the SAME cwd reuses one registry record (no duplicate)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wa', 'wa', deps);
    assert.equal(sdk.listSdkSessions().filter((s) => s.cwd === '/wa').length, 1);
  });

  it('setActiveSdkSession switches the active cwd; unknown cwd refuses (false, no-op)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps);
    assert.equal(sdk.getActiveSdkCwd(), '/wb');
    assert.equal(sdk.setActiveSdkSession('/wa'), true);
    assert.equal(sdk.getActiveSdkCwd(), '/wa');
    assert.equal(sdk.setActiveSdkSession('/nope'), false, 'unknown cwd → false');
    assert.equal(sdk.getActiveSdkCwd(), '/wa', 'active unchanged after refused switch');
    assert.equal(sdk.setActiveSdkSession('/wa'), true, 'already-active → true no-op');
  });

  it('a switch adopts the TARGET session’s own launch config (per-cwd isolation)', async () => {
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/wa', 'wa', { ...deps, permissionMode: 'bypassPermissions', model: 'model-a' });
    sdk.initSdkSession('/wb', 'wb', { ...deps, permissionMode: 'default', model: 'model-b' });
    sdk.setActiveSdkSession('/wa');
    await sdk.sendUserMessage('hi'); // lazily constructs /wa's resident query
    await tick();
    const last = rec[rec.length - 1];
    assert.equal(last.cwd, '/wa');
    assert.equal(last.permissionMode, 'bypassPermissions', 'wa keeps ITS OWN permissionMode, not wb’s');
    assert.equal(last.model, 'model-a');
  });

  it('each session self-tags x-ccv-project-dir = its own cwd (transcript routing)', async () => {
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210' };
    sdk.initSdkSession('/wa', 'wa', { ...deps, env });
    await sdk.sendUserMessage('hi');
    await tick();
    const opt = rec[rec.length - 1];
    assert.equal(opt.cwd, '/wa');
    assert.ok(String(opt.env.ANTHROPIC_CUSTOM_HEADERS).includes('x-ccv-project-dir: /wa'),
      'child env carries the per-cwd project header');
  });

  it('setActiveSdkSession keeps the OUTGOING session resident (concurrent-keep, lazy switch)', async () => {
    // The historical behavior (switch = teardown of the outgoing resident query) is GONE:
    // switching is lazy — the outgoing session's state (sessionId, queue, resident query)
    // is preserved so a background workspace keeps running undisturbed.
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps); // active: /wb
    assert.equal(sdk.setActiveSdkSession('/wa'), true); // activate /wa (its query builds lazily)
    await sdk.sendUserMessage('first'); // construct /wa's resident query
    await tick();
    assert.equal(rec.length, 1, 'one construction before the switch');
    assert.equal(sdk.getSessionId(), 's-/wa', '/wa captured its session id');
    // Switch away and back: NO teardown may have touched /wa — its sessionId survives
    // (stopSession/teardown is the only thing that nulls it) and the still-alive
    // resident query serves the next message WITHOUT a new construction.
    assert.equal(sdk.setActiveSdkSession('/wb'), true);
    await sdk.sendUserMessage('to-wb'); // /wb constructs its own query
    await tick();
    const constructionsAtSwitch = rec.length;
    assert.equal(sdk.setActiveSdkSession('/wa'), true);
    const p = sdk.sendUserMessage('second-on-wa'); // reuses /wa's STILL-ALIVE query
    await p;
    await tick(16);
    assert.equal(rec.length, constructionsAtSwitch, 'a lazy switch did NOT teardown /wa — no reconstruction');
    assert.equal(sdk.getSessionId(), 's-/wa', '/wa continuity intact (sessionId never reset)');
  });

  it('anchor-routed reads do NOT switch active (queue snapshot of another session)', async () => {
    // Read-addressing parity with PTY anchors: an anchored getter must observe THAT
    // session without re-routing the global active pointer.
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps);
    assert.equal(sdk.getActiveSdkCwd(), '/wb', 'last init is active');
    const viaAnchor = sdk.getQueueSnapshot({ cwd: '/wa' });
    assert.ok(Array.isArray(viaAnchor), 'anchored read on a registered session works');
    assert.equal(sdk.getActiveSdkCwd(), '/wb', 'anchored read did NOT switch active');
    // Unknown anchor → the empty/neutral default, never a throw.
    assert.deepEqual(sdk.getQueueSnapshot({ cwd: '/nope' }), []);
    // sendUserMessage WITH an anchor DOES re-route (it is an action, not a read).
    await sdk.sendUserMessage('go', { cwd: '/wa' });
    assert.equal(sdk.getActiveSdkCwd(), '/wa', 'anchored send re-routed active');
  });

  it('anchor by project BASENAME routes a send to that workspace (the web client sends names, not paths)', async () => {
    // Regression: the web composer stamps `project: viewProject || projectName` (a basename),
    // not an absolute cwd. Anchor resolution must map the basename to that session's cwd —
    // otherwise the send silently dropped (the exact bug behind "发消息不可路由").
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/ws/alpha', 'alpha', deps);
    sdk.initSdkSession('/ws/beta', 'beta', deps);
    assert.equal(sdk.getActiveSdkCwd(), '/ws/beta');
    await sdk.sendUserMessage('hello-alpha', { project: 'alpha' });
    await tick();
    const alpha = rec.find((r) => r.cwd === '/ws/alpha');
    assert.ok(alpha, 'a basename-anchored send reached the alpha session (constructed its query)');
    assert.equal(sdk.getActiveSdkCwd(), '/ws/alpha', 'the action re-routed active to alpha');
  });

  it('an ambiguous basename (two sessions sharing it) resolves to null — never guesses', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/x/same', 'same', deps);
    sdk.initSdkSession('/y/same', 'same', deps);
    // basename 'same' matches both → ambiguous → no target → message dropped (not misrouted).
    // We assert via getQueueSnapshot (read path shares _sessionForAnchor): ambiguous → neutral.
    const out = sdk.getQueueSnapshot({ project: 'same' });
    assert.deepEqual(out, [], 'ambiguous basename yields no session, not an arbitrary one');
  });

  it('anchor by SANITIZED project name routes a send (dirs with spaces/CJK → projectKeyForCwd)', async () => {
    // The web client sends projectName = projectKeyForCwd(cwd), which sanitizes non
    // [a-zA-Z0-9_-] chars to '_'. A dir like "/ws/My Project" is sent as "My_Project" —
    // anchor matching must use the sanitized name, or sends to such workspaces drop.
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/ws/My Project', 'My Project', deps);
    await sdk.sendUserMessage('hi', { project: 'My_Project' });
    await tick();
    assert.ok(rec.some((r) => r.cwd === '/ws/My Project'), 'sanitized project name routed to the spaced dir session');
  });

  it('initSdkSession with NO callbacks does NOT clobber the process-global wiring', async () => {
    // Regression (workspaces launch): the launch route calls initSdkSession for a new
    // workspace WITHOUT callbacks. The process-global _broadcastWs/_onTurnEnd must survive,
    // or every workspace's broadcasts die. (2026-10-12 P0)
    const frames = [];
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/wa', 'wa', { ...deps, broadcastWs: (m) => frames.push(m) });
    await sdk.sendUserMessage('first');
    await tick();
    assert.ok(frames.length > 0, 'broadcasts flow after the wired init');
    // Re-init a DIFFERENT cwd with no callbacks (the launch route's shape).
    sdk.initSdkSession('/wb', 'wb', { permissionMode: 'default' });
    frames.length = 0;
    await sdk.sendUserMessage('second'); // active is now /wb, built on the SAME global wiring
    await tick();
    assert.ok(frames.length > 0, 'broadcasts still flow after a callback-less re-init (wiring not clobbered)');
  });

  it('stopSession tears down every session and clears the registry + active cwd', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps);
    sdk.stopSession();
    assert.deepEqual(sdk.listSdkSessions(), []);
    assert.equal(sdk.getActiveSdkCwd(), '', 'no stale cwd after a hard stop');
  });

  it('cwd key normalization: "/a/" and "/a" map to one session; "/a" vs "/b" stay distinct', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/a/', 'a', deps);
    sdk.initSdkSession('/a', 'a', deps);
    sdk.initSdkSession('/b', 'b', deps);
    assert.equal(sdk.listSdkSessions().length, 2, 'trailing-slash collapses; distinct dirs stay separate');
  });
});
