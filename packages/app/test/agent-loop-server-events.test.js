/**
 * agent-loop-server-events.test.js
 *
 * Behavioral coverage for the server-side agent-loop boundary frames:
 *  - broadcastAgentLoopStart/End payload shape + cwd→scope routing + stop-freeze,
 *  - PTY parity: _setTurnActive rising edge emits start; the plain Stop-hook clear
 *    does NOT end (defers to the debounce); queue-suppress ends 'interrupted';
 *  - _emitTurnEnd emits agent_loop_end BEFORE turn_end in PTY mode (single-writer
 *    ordering lets the client suppress the legacy voice),
 *  - the plugin parallel hooks (onAgentLoopStart/onAgentLoopEnd) fire with the
 *    same payload and are exception-isolated.
 *
 * Harness mirrors turn-end-debounce.test.js: env first, dynamic import,
 * __testing seams, mock.timers for the debounce window.
 */
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.NODE_ENV = 'test';
// This file exercises the PTY lane (_setTurnActive / _emitTurnEnd PTY branches are
// gated on !isSdkMode). A developer shell running INSIDE an SDK-mode Claude Code
// session leaks CCV_SDK_MODE=1 into the test process — force PTY mode explicitly.
delete process.env.CCV_SDK_MODE;
delete process.env.CCV_BASE_URL;
// findcc's resolveLogDir maps the keyword 'tmp' to a process-private disposable dir
// (os.tmpdir()/cc-viewer-test/<pid>) — the ONLY form its test-isolation barrier and
// setLogDir's whitelist both accept. A raw mkdtemp path under macOS /var/folders is
// rejected by setLogDir, and an inherited non-tmp CCV_LOG_DIR triggers the guard.
process.env.CCV_LOG_DIR = 'tmp';

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { unwatchFile } from 'node:fs';

let serverMod, interceptorMod, PROFILE_PATH, DEBOUNCE_MS;
let loopEvents = [];
let turnEndBroadcasts = [];

before(async () => {
  interceptorMod = await import('../server/interceptor.js');
  PROFILE_PATH = interceptorMod.PROFILE_PATH;
  serverMod = await import('../server/server.js');
  DEBOUNCE_MS = serverMod.__testing.getDebounceMs();
  // Detach the module-level StatWatchers (proxy profile + retry-config) — a
  // watchFile handle keeps the event loop alive and node --test never exits.
  try { unwatchFile(PROFILE_PATH); } catch {}
  try { unwatchFile(interceptorMod.RETRY_CONFIG_PATH); } catch {}
});

after(() => { try { unwatchFile(PROFILE_PATH); } catch {} });

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  loopEvents = [];
  turnEndBroadcasts = [];
  serverMod.__testing.reset();
  serverMod.__testing.onAgentLoopBroadcast((ev) => loopEvents.push(ev));
  serverMod.__testing.onBroadcast((ev) => turnEndBroadcasts.push(ev));
  interceptorMod.resetStreamingState();
});

afterEach(() => {
  mock.timers.reset();
});

describe('broadcastAgentLoopStart/End (SDK entry)', () => {
  it('emits start then end with the SDK payload and cwd→scope routing', () => {
    serverMod.broadcastAgentLoopStart({ sessionId: 's1', ts: 100, cwd: '/tmp/proj-x', instanceKey: null, turnId: 't1', turnStartedAt: 50 });
    serverMod.broadcastAgentLoopEnd({ sessionId: 's1', ts: 200, cwd: '/tmp/proj-x', instanceKey: null, turnId: 't1', turnStartedAt: 50, reason: 'success' });
    assert.equal(loopEvents.length, 2);
    assert.equal(loopEvents[0].phase, 'start');
    assert.equal(loopEvents[1].phase, 'end');
    const p = loopEvents[1].payload;
    assert.equal(p.sessionId, 's1');
    assert.equal(p.ts, 200);
    assert.equal(p.mode, 'sdk');
    assert.equal(p.turnId, 't1');
    assert.equal(p.turnStartedAt, 50);
    assert.equal(p.reason, 'success');
    assert.equal(p.project, 'proj-x', 'cwd routes to the project scope');
    assert.equal(p.instance, null);
  });

  it('stop-freeze: _isStopping drops boundary emissions', () => {
    serverMod.__testing.setIsStopping(true);
    serverMod.broadcastAgentLoopStart({ sessionId: 's1', ts: 1, cwd: '/tmp/proj-x', turnId: 't1', turnStartedAt: 1 });
    serverMod.broadcastAgentLoopEnd({ sessionId: 's1', ts: 2, cwd: '/tmp/proj-x', turnId: 't1', turnStartedAt: 1, reason: 'success' });
    assert.equal(loopEvents.length, 0);
  });
});

describe('PTY parity via _setTurnActive', () => {
  it('the rising edge emits exactly one agent_loop_start (mode pty)', () => {
    const scope = { project: 'projA', instance: null };
    serverMod.__testing.setPtyTurnActive(true, 'sid-A', scope);
    serverMod.__testing.setPtyTurnActive(true, 'sid-A', scope); // idempotent — no dup
    const starts = loopEvents.filter((e) => e.phase === 'start');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].payload.mode, 'pty');
    assert.equal(starts[0].payload.sessionId, 'sid-A');
    assert.equal(starts[0].payload.project, 'projA');
  });

  it('the plain Stop-hook clear does NOT emit an end (defers to the debounce)', () => {
    const scope = { project: 'projA', instance: null };
    serverMod.__testing.setPtyTurnActive(true, 'sid-A', scope);
    serverMod.__testing.clearPtyTurnActive(scope); // Stop-hook clear path
    const ends = loopEvents.filter((e) => e.phase === 'end');
    assert.equal(ends.length, 0, 'no immediate end on the hook clear');
  });

  it('an interrupted clear (queue-suppress source) emits an immediate end', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');
    // Source anchor: the queue-suppress handler routes through the interrupted source.
    assert.ok(/msg\.type === 'queue-suppress'[\s\S]{0,1600}?_setTurnActive\(false, null, qScope, 'interrupted'\)/.test(src),
      'queue-suppress clears with the interrupted source');
    // Behavior: an 'interrupted'-sourced transition fires agent_loop_end immediately.
    const scope = { project: 'projA', instance: null };
    serverMod.__testing.setPtyTurnActive(true, 'sid-A', scope);
    serverMod.__testing.setPtyTurnActive(false, null, scope, 'interrupted');
    const ends = loopEvents.filter((e) => e.phase === 'end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].payload.mode, 'pty');
    assert.equal(ends[0].payload.reason, 'interrupted');
    assert.equal(ends[0].payload.project, 'projA');
  });
});

describe('_emitTurnEnd agent_loop_end emission (PTY)', () => {
  it('emits agent_loop_end BEFORE turn_end, with reason stop-hook', () => {
    // Order is load-bearing: the client suppresses the legacy turnEnd voice only
    // when agentLoopEnd already played for the SAME boundary ts, and the two frames
    // are emitted back-to-back. Record a merged ordered stream to assert the order.
    const ordered = [];
    serverMod.__testing.onAgentLoopBroadcast((ev) => ordered.push(['loop', ev.phase, ev.payload]));
    serverMod.__testing.onBroadcast((ev) => ordered.push(['turn_end', null, ev]));
    serverMod.__testing.scheduleTurnEnd('sid-1', 1000);
    assert.equal(ordered.length, 0, 'no emission before the debounce fires');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(ordered.length, 2, 'loop end then turn_end after the debounce');
    assert.equal(ordered[0][0], 'loop');
    assert.equal(ordered[0][1], 'end');
    assert.equal(ordered[0][2].mode, 'pty');
    assert.equal(ordered[0][2].reason, 'stop-hook');
    assert.equal(ordered[0][2].ts, 1000, 'same boundary ts as turn_end (client voice suppression keys off it)');
    assert.equal(ordered[1][0], 'turn_end');
    assert.equal(ordered[1][2].ts, 1000);
    assert.ok(ordered[0][2].ts === ordered[1][2].ts, 'shared boundary ts');
    assert.deepEqual(ordered.map((e) => e[0]), ['loop', 'turn_end'],
      'agent_loop_end is emitted strictly BEFORE turn_end for the same boundary');
  });
});

describe('plugin parallel hooks', () => {
  it('onAgentLoopStart/onAgentLoopEnd dispatch to loaded plugins, exception-isolated', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { LOG_DIR } = await import('../findcc.js');
    // LOG_DIR is the process-private guard dir (CCV_LOG_DIR='tmp' at file top) —
    // plugin-loader's getPluginsDir reads the same live binding.
    const tmp = LOG_DIR;
    try {
      mkdirSync(join(tmp, 'plugins'), { recursive: true });
      globalThis.__ccvLoopTestEvents = [];
      writeFileSync(join(tmp, 'plugins', 'z-loop.js'), `
        export default {
          name: 'z-loop',
          hooks: {
            async onAgentLoopStart(p) { globalThis.__ccvLoopTestEvents.push(['start', p.mode, p.turnId]); },
            async onAgentLoopEnd(p) { globalThis.__ccvLoopTestEvents.push(['end', p.reason]); throw new Error('boom'); },
          },
        };
      `);
      writeFileSync(join(tmp, 'plugins', 'a-loop.js'), `
        export default {
          name: 'a-loop',
          hooks: {
            async onAgentLoopEnd(p) { globalThis.__ccvLoopTestEvents.push(['end-ok', p.reason]); },
          },
        };
      `);
      const loader = await import('../server/lib/plugin-loader.js');
      loader._resetModuleCacheForTest();
      await loader.loadPlugins();
      // Drive through the PRODUCTION boundary path (broadcastAgentLoopStart/End →
      // _emitAgentLoopBoundary → runParallelHook), not runParallelHook directly, so
      // the boundary→plugin fan-out line itself is covered.
      serverMod.broadcastAgentLoopStart({ sessionId: 's1', ts: 1, cwd: '/tmp/proj-p', instanceKey: null, turnId: 't1', turnStartedAt: 1 });
      serverMod.broadcastAgentLoopEnd({ sessionId: 's1', ts: 2, cwd: '/tmp/proj-p', instanceKey: null, turnId: 't1', turnStartedAt: 1, reason: 'success' });
      // runParallelHook is awaited internally; give the parallel tasks a microtask turn.
      for (let i = 0; i < 6; i++) await Promise.resolve();
      const ev = globalThis.__ccvLoopTestEvents;
      assert.deepEqual(ev.filter((e) => e[0] === 'start'), [['start', 'sdk', 't1']]);
      assert.ok(ev.some((e) => e[0] === 'end' && e[1] === 'success'), 'throwing plugin received the end');
      assert.ok(ev.some((e) => e[0] === 'end-ok' && e[1] === 'success'), 'a throwing plugin does not block the next one');
    } finally {
      try { rmSync(join(tmp, 'plugins'), { recursive: true, force: true }); } catch {}
    }
  });
});
