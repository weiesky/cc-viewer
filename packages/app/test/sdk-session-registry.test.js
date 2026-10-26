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

  it('each session self-tags x-ccv-project-dir AND x-ccv-instance = its own identity', async () => {
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
    const inst = sdk.listSdkSessions().find((s) => s.cwd === '/wa').instanceKey;
    assert.ok(String(opt.env.ANTHROPIC_CUSTOM_HEADERS).includes(`x-ccv-instance: ${inst}`),
      'child env self-reports the stable instanceKey (same-name twin wire isolation)');
    // Every frame the session emits carries the routing envelope (cwd + sessionId +
    // instanceKey) so a same-basename twin viewer never eats its lifecycle frames.
    const frames = [];
    sdk.stopSession();
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wb', 'wb', { ...deps, broadcastWs: (m) => frames.push(m) });
    await sdk.sendUserMessage('drive');
    await tick();
    assert.ok(frames.length > 0, 'frames emitted');
    assert.ok(frames.every((f) => f.instanceKey && /^ccv-[0-9a-f]+$/.test(f.instanceKey)),
      'every broadcast frame is stamped with the session instanceKey');
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

  it('instance keys are stable per normalized cwd and distinct for same-basename dirs', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/a/same/', 'same', deps);
    const first = sdk.listSdkSessions()[0].instanceKey;
    assert.match(first, /^ccv-[0-9a-f]+$/);
    sdk.initSdkSession('/a/same', 'same', deps);
    assert.equal(sdk.listSdkSessions()[0].instanceKey, first);
    sdk.initSdkSession('/b/same', 'same', deps);
    const rows = sdk.listSdkSessions();
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].instanceKey, rows[1].instanceKey);
    sdk.stopSession();
    sdk.initSdkSession('/a/same', 'same', deps);
    assert.equal(sdk.listSdkSessions()[0].instanceKey, first, 'close/restart registration keeps cwd identity');
  });

  it('an exact instance anchor routes between same-basename sessions', async () => {
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/x/same', 'same', deps);
    sdk.initSdkSession('/y/same', 'same', deps);
    const target = sdk.listSdkSessions().find((s) => s.cwd === '/x/same');
    await sdk.sendUserMessage('targeted', { project: 'same', instanceKey: target.instanceKey });
    await tick();
    assert.ok(rec.some((r) => r.cwd === '/x/same'), 'instance key beats the ambiguous project name');
    assert.equal(sdk.getActiveSdkCwd(), '/x/same');
  });

  it('a project+instance anchor pair must agree; a foreign instance never wins', async () => {
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/ws/alpha', 'alpha', deps);
    sdk.initSdkSession('/ws/beta', 'beta', deps);
    const alpha = sdk.listSdkSessions().find((s) => s.cwd === '/ws/alpha');
    const beta = sdk.listSdkSessions().find((s) => s.cwd === '/ws/beta');

    await sdk.sendUserMessage('go', { project: 'alpha', instanceKey: alpha.instanceKey });
    await tick();
    assert.equal(sdk.getSessionId({ project: 'alpha', instanceKey: alpha.instanceKey }), 's-/ws/alpha',
      'a matching pair resolves normally');
    assert.equal(sdk.getSessionId({ project: 'alpha', instanceKey: beta.instanceKey }), null,
      'an instance from another project must not win by instance priority');
    assert.equal(sdk.getSessionId({ project: 'beta', instanceKey: alpha.instanceKey }), null);
    assert.equal(sdk.getSessionId({ instanceKey: alpha.instanceKey }), 's-/ws/alpha',
      'instance-only anchors keep their exact behavior');

    sdk.initSdkSession('/ws/My Project', 'My Project', deps);
    await sdk.sendUserMessage('spaced', { project: 'My_Project' });
    await tick();
    const spaced = sdk.listSdkSessions().find((s) => s.cwd === '/ws/My Project');
    assert.equal(sdk.getSessionId({ project: 'My_Project', instanceKey: spaced.instanceKey }), 's-/ws/My Project',
      'sanitized project keys pair with their instance');
  });

  it('a stale instance anchor is dropped, never degraded to a same-basename sibling', async () => {
    const rec = [];
    const errors = [];
    const metas = [];
    const errDeps = { broadcastWs() {}, onTurnEnd() {}, onQueryError: (m, meta) => { errors.push(m); metas.push(meta); } };
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/x/same', 'same', errDeps);
    sdk.initSdkSession('/y/same', 'same', errDeps);
    const closed = sdk.listSdkSessions().find((s) => s.cwd === '/x/same');
    sdk.closeSdkSession({ instanceKey: closed.instanceKey });
    // The surviving workspace shares the basename; the stale key must not degrade
    // to name routing (that would deliver the message into /y/same).
    await sdk.sendUserMessage('must-not-land', { project: 'same', instanceKey: closed.instanceKey });
    await tick();
    assert.ok(!rec.length, 'no query may be constructed for the dead instance');
    assert.equal(sdk.getActiveSdkCwd(), '/y/same', 'active pointer untouched by the dropped send');
    assert.equal(sdk.attachSdkSession({ project: 'same', instanceKey: closed.instanceKey }).ok, false);
    assert.equal(sdk.switchToSession('sid-x', { project: 'same', instanceKey: closed.instanceKey }).reason, 'bad-id');
    assert.equal(sdk.getSessionId({ cwd: '/y/same' }) === null, true, 'survivor never adopted the dead session id');
    assert.equal(errors.length, 1, 'the dropped send surfaces a user-visible error instead of vanishing');
    // Module-level route failure has no session closure — meta comes from the anchor
    // (production anchors never carry cwd), so this frame scopes by project + instanceKey.
    assert.equal(metas.length, 1);
    assert.equal(metas[0].instanceKey, closed.instanceKey);
    assert.equal(metas[0].cwd, null);
    assert.equal(metas[0].sessionId, null);
    assert.equal(metas[0].project, 'same', 'anchor project key rides along so the broadcast can scope it');
  });

  it('closeSdkSession tears down only its target and reanchors an active close', async () => {
    const rec = [];
    sdk.__setQueryForTests(makeQuery(rec));
    sdk.initSdkSession('/wa', 'wa', deps);
    await sdk.sendUserMessage('wa-first');
    await tick();
    sdk.initSdkSession('/wb', 'wb', deps);
    await sdk.sendUserMessage('wb-first');
    await tick();
    const wa = sdk.listSdkSessions().find((s) => s.cwd === '/wa');
    const closed = sdk.closeSdkSession({ instanceKey: wa.instanceKey });
    assert.equal(closed.ok, true);
    assert.equal(closed.killedActive, false);
    assert.deepEqual(sdk.listSdkSessions().map((s) => s.cwd), ['/wb']);
    assert.equal(sdk.getActiveSdkCwd(), '/wb');
    assert.equal(sdk.getSessionId(), 's-/wb', 'sibling continuity survives');

    const active = sdk.listSdkSessions()[0];
    const activeClose = sdk.closeSdkSession({ instanceKey: active.instanceKey });
    assert.equal(activeClose.killedActive, true);
    assert.equal(activeClose.reattachedTo, null);
    assert.equal(sdk.getActiveSdkCwd(), '');
    assert.deepEqual(sdk.listSdkSessions(), []);
    assert.equal(sdk.closeSdkSession({ instanceKey: active.instanceKey }).reason, 'not-found');
  });

  it('closeSdkSession dismisses pending approvals and clears the queue on close', async () => {
    // The ONLY difference between close() and bare teardown() is the approval-dismiss
    // broadcast loop — pin it so a regression to teardown() can never pass silently
    // (without it every client keeps the ghost modal until the 5min/24h timeout).
    const frames = [];
    const wiredDeps = { broadcastWs: (m) => frames.push(m), onTurnEnd() {} };
    let canUseToolOpts = null;
    let approvalStarted = false;
    sdk.__setQueryForTests(({ prompt, options }) => {
      const q = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's-approve', model: 'm', slash_commands: [] };
        for await (const item of prompt) {
          void item;
          // Trigger one permission approval and park on it forever. Await it inline so
          // the close's resolve(null) is observable to the test.
          approvalStarted = true;
          canUseToolOpts = await options.canUseTool('Bash', { command: 'ls' }, { toolUseID: 'perm-close-1' });
          return; // never yields a result — the turn stays open until close
        }
      })();
      q.close = () => {};
      q.interrupt = () => Promise.resolve();
      return q;
    });
    sdk.initSdkSession('/wa', 'wa', wiredDeps);
    const sendP = sdk.sendUserMessage('go');
    sendP.catch(() => {});
    // Wait for the approval to register + broadcast its pending frame (poll — the
    // canUseTool call happens one microtask chain after the init message).
    for (let i = 0; i < 80 && !approvalStarted; i++) await new Promise((r) => setTimeout(r, 2));
    assert.ok(approvalStarted, 'precondition: canUseTool invoked');
    assert.ok(frames.some((f) => f.type === 'perm-hook-pending' && f.id === 'perm-close-1'),
      'precondition: approval pending and announced');
    const closed = sdk.closeSdkSession({ cwd: '/wa' });
    assert.equal(closed.ok, true);
    const dismiss = frames.filter((f) => f.type === 'perm-hook-timeout' && f.id === 'perm-close-1' && f.reason === 'session-closed');
    assert.equal(dismiss.length, 1, 'close must broadcast the session-closed dismissal so modals close');
    await sendP; // the parked turn settles at close, never hangs
    await tick();
    assert.deepEqual(canUseToolOpts, { behavior: 'deny', message: 'Timeout waiting for user approval' },
      'the resolved-null approval takes the deny branch instead of leaking its timer');
    assert.equal(sdk.listSdkSessions().length, 0);
  });

  it('name-only close refuses same-basename ambiguity and attach activates an exact instance', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/x/same', 'same', deps);
    sdk.initSdkSession('/y/same', 'same', deps);
    const ambiguous = sdk.closeSdkSession({ project: 'same' });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.reason, 'ambiguous');
    assert.equal(ambiguous.candidates.length, 2);
    assert.equal(sdk.listSdkSessions().length, 2);
    const target = sdk.listSdkSessions().find((s) => s.cwd === '/x/same');
    const attached = sdk.attachSdkSession({ project: 'same', instanceKey: target.instanceKey });
    assert.equal(attached.ok, true);
    assert.equal(attached.cwd, '/x/same');
    assert.equal(sdk.getActiveSdkCwd(), '/x/same');
    assert.equal(sdk.attachSdkSession({ project: 'same' }).reason, 'ambiguous');
  });
});
