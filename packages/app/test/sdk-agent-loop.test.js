/**
 * sdk-agent-loop.test.js
 *
 * Covers the authoritative agent-loop boundary signals in server/lib/sdk-manager.js:
 *  - onAgentLoopStart fires exactly once per ACCEPTED turn (queued/undelivered never ring),
 *  - onAgentLoopEnd fires exactly once per settled turn with the right reason
 *    (success / interrupted / error / interrupt-timeout / lost-result / session-ended),
 *  - background-task pseudo results (origin.kind === 'task-notification') produce NO
 *    turnEnd, NO loopEnd, NO idle and do not shift the pending-turn FIFO,
 *  - sdk-session-state frames carry turn correlation (turnId + wall-clock turnStartedAt),
 *  - a late CLI idle from the PREVIOUS turn is suppressed (cliStateSeen gate),
 *  - message-level activity frames are coalesced to ≤1/s and reuse the
 *    sdk-session-state shape (heartbeat+activity flags).
 *
 * Harness conventions mirror sdk-session-state.test.js (resident fake query with
 * gate semantics; turn promises never awaited without a settle path).
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let sdk;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-loop-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(async () => {
  try { await sdk.stopSession(); } catch { /* best-effort */ }
});

function makeDeps(extra = {}) {
  const broadcasts = [];
  const turnEnds = [];
  const loopStarts = [];
  const loopEnds = [];
  const deps = {
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: (x) => turnEnds.push(x),
    onAgentLoopStart: (x) => loopStarts.push(x),
    onAgentLoopEnd: (x) => loopEnds.push(x),
    ...extra,
  };
  return { deps, broadcasts, turnEnds, loopStarts, loopEnds };
}

function sysInit(sessionId = 'sess-1') {
  return {
    type: 'system', subtype: 'init', session_id: sessionId,
    model: 'claude-x', slash_commands: ['help'], tools: [],
  };
}

function resultMsg(extra = {}) {
  return { type: 'result', subtype: 'success', ...extra };
}

function stateMsg(state, sessionId = 'sess-1') {
  return { type: 'system', subtype: 'session_state_changed', state, session_id: sessionId, uuid: 'u' };
}

// A parked CLI control-plane answer: the activity probe (getContextUsage) must
// receive a REAL round-trip response or, under node:test mocked timers, the
// probe's own 10s timeout is unresolvable — a wedged-control-plane child would
// deadlock the mocked clock (the probe re-arms at 3min intervals and conviction
// needs two unanswered probes, so the test's seconds-scale tick never converges).
// An answered probe proves liveness and simply re-arms — the turn is NOT failed,
// which is the documented contract for long silent turns.
function withProbeAnswer(q, snapshot = { contextWindow: 200000, used: 1234 }) {
  q.getContextUsage = async () => snapshot;
  return q;
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Resident fake with gate semantics — identical to sdk-session-state.test.js's factory.
function makeResidentQuery({ respond, initMsgs } = {}) {
  const calls = [];
  let current = null;
  function fakeQuery({ prompt, options }) {
    const rec = { options, pushed: [] };
    calls.push(rec);
    const state = { ended: false, err: null, releaseCurrent: null, interruptReleasePending: false };
    current = state;
    const api = {
      async *[Symbol.asyncIterator]() {
        const done = () => { if (state.err) throw state.err; };
        for (const m of initMsgs || []) {
          if (state.ended) { done(); return; }
          await Promise.resolve();
          yield m;
        }
        for await (const msg of prompt) {
          if (state.ended) { done(); return; }
          rec.pushed.push(msg);
          let out = null;
          try {
            out = await Promise.race([
              (async () => (respond ? respond(msg) : [resultMsg()]))(),
              new Promise((res) => { state.deathWake = () => res(undefined); }),
            ]);
          } catch { out = null; }
          if (out == null) {
            if (state.ended) { done(); return; }
            await new Promise((resolve) => {
              state.releaseCurrent = resolve;
              if (state.interruptReleasePending) {
                state.interruptReleasePending = false;
                resolve();
              } else if (state.err || state.ended) resolve();
            });
            state.releaseCurrent = null;
            if (state.ended) { done(); return; }
            out = [resultMsg()];
          }
          for (const m of out) {
            if (state.ended) { done(); return; }
            await Promise.resolve();
            yield m;
          }
        }
        done();
      },
      async interrupt() {
        state.interruptCalls = (state.interruptCalls || 0) + 1;
        if (state.releaseCurrent) state.releaseCurrent();
        else if (state.deathWake) { state.deathWake(); state.interruptReleasePending = true; }
      },
      close() {
        state.ended = true;
        if (state.releaseCurrent) state.releaseCurrent();
        if (state.deathWake) state.deathWake();
      },
    };
    return api;
  }
  fakeQuery.calls = calls;
  fakeQuery.state = () => current;
  fakeQuery.endWith = (err) => {
    if (!current) return;
    current.ended = true;
    current.err = err || null;
    if (current.releaseCurrent) current.releaseCurrent();
    if (current.deathWake) current.deathWake();
  };
  return fakeQuery;
}

const stateFrames = (broadcasts) =>
  broadcasts.filter((b) => b.type === 'sdk-session-state' && !b.heartbeat);

// A frame-queue fake: the test pushes SDK frames and the iterator drains them, so
// the test controls the EXACT arrival order across turns (unlike makeResidentQuery's
// per-message respond batch, which cannot deliver turn 1's trailing frame AFTER
// turn 2's push). Needed to exercise the stale-idle gate against a real interleaving.
function makeFrameQuery() {
  const frameQueue = [];
  let wake = null;
  function fakeQuery({ prompt }) {
    void prompt;
    const state = { ended: false };
    const api = {
      async *[Symbol.asyncIterator]() {
        yield sysInit();
        while (!state.ended) {
          if (frameQueue.length === 0) {
            await new Promise((res) => { wake = res; });
            continue;
          }
          const m = frameQueue.shift();
          await Promise.resolve();
          yield m;
        }
      },
      async interrupt() {},
      close() { state.ended = true; if (wake) wake(); },
    };
    return api;
  }
  fakeQuery.pushFrame = (m) => { frameQueue.push(m); if (wake) { const w = wake; wake = null; w(); } };
  return fakeQuery;
}

describe('agent-loop boundaries (SDK)', () => {
  it('an accepted turn emits exactly one start and one success end, turn-correlated', async () => {
    const { deps, loopStarts, loopEnds } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(8);

    assert.equal(loopStarts.length, 1, 'exactly one loop start');
    assert.equal(loopEnds.length, 1, 'exactly one loop end');
    assert.equal(loopEnds[0].reason, 'success');
    assert.equal(loopStarts[0].turnId, loopEnds[0].turnId, 'same turn id on both boundaries');
    assert.equal(typeof loopStarts[0].turnStartedAt, 'number');
    assert.ok(loopStarts[0].turnStartedAt > 0);
    assert.equal(loopStarts[0].turnStartedAt, loopEnds[0].turnStartedAt, 'same turn epoch');
    assert.equal(loopStarts[0].cwd, tmpDir);
    assert.equal(loopEnds[0].sessionId, 'sess-1');
  });

  it('a queued message rings only when its own turn starts (not at enqueue time)', async () => {
    const { deps, loopStarts, loopEnds } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async () => {
        if (idx++ === 0) await firstGate;
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('one').catch(() => {});
    await tick(6);
    await sdk.sendUserMessage('two'); // queued behind the busy turn
    await tick(4);
    assert.equal(loopStarts.length, 1, 'the queued message has not started a loop yet');

    releaseFirst();
    await p1;
    await tick(12); // first result → drain → second turn start+result
    assert.equal(loopStarts.length, 2, 'the drained message starts its own loop');
    assert.equal(loopEnds.length, 2);
    assert.notEqual(loopStarts[0].turnId, loopStarts[1].turnId, 'distinct turns get distinct ids');
    assert.ok(loopStarts[1].turnStartedAt >= loopStarts[0].turnStartedAt, 'epochs are monotonic');
  });

  it('an interrupted turn ends with reason interrupted (CLI answers with an error result)', async () => {
    const { deps, loopEnds } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async () => {
        if (idx++ === 0) await firstGate;
        return [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['turn aborted'] })];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('hi').catch(() => {});
    await tick(5);
    sdk.interruptTurn();
    releaseFirst(); // CLI answers the interrupt with the turn's (error) result
    await p;
    await tick(8);
    assert.equal(loopEnds.length, 1);
    assert.equal(loopEnds[0].reason, 'interrupted');
  });

  it('an error result (not user-interrupted) ends with reason error', async () => {
    const { deps, loopEnds } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] })],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(8);
    assert.equal(loopEnds.length, 1);
    assert.equal(loopEnds[0].reason, 'error');
  });

  it('task-notification pseudo results produce NO turnEnd / loopEnd / idle and keep the FIFO', async () => {
    const { deps, broadcasts, turnEnds, loopEnds } = makeDeps();
    let releaseReal;
    const realGate = new Promise((r) => { releaseReal = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async () => {
        // CLI behavior while background tasks resolve: a synthetic pseudo result
        // first, the REAL held-back result only later (gated here).
        const out = [{ type: 'result', subtype: 'success', num_turns: 0, result: '', origin: { kind: 'task-notification' } }];
        await realGate;
        out.push(resultMsg());
        return out;
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('hi').catch(() => {});
    await tick(10);
    // The pseudo result arrived and was filtered: nothing may fire.
    assert.equal(turnEnds.length, 0, 'no phantom turnEnd');
    assert.equal(loopEnds.length, 0, 'no phantom loopEnd');
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running'], 'still running — no idle');
    releaseReal();
    await p;
    await tick(8);
    assert.equal(turnEnds.length, 1, 'the real result still ends the turn');
    assert.equal(loopEnds.length, 1);
    assert.equal(loopEnds[0].reason, 'success');
  });

  it('a pseudo result with NO pending turn is fully silent (no phantom turnEnd)', async () => {
    const { deps, turnEnds, loopEnds } = makeDeps();
    // initMsgs run BEFORE any user message — a pseudo result in the init batch
    // must not produce a turn-end of any kind.
    const fq = makeResidentQuery({
      initMsgs: [sysInit(), { type: 'result', subtype: 'success', num_turns: 0, result: '', origin: { kind: 'task-notification' } }],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    assert.equal(turnEnds.length, 1, 'only the real turn end fires');
    assert.equal(loopEnds.length, 1);
  });

  it('interrupt grace expiry (dead child, no result) ends with interrupt-timeout', async () => {
    const { deps, loopEnds } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => new Promise(() => {}),
    });
    sdk.__setQueryForTests((args) => {
      const q = withProbeAnswer(fq(args));
      q.interrupt = async () => {}; // dead child: never answers the interrupt
      return q;
    });
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sdk.sendUserMessage('hi').catch(() => {});
      for (let i = 0; i < 6; i++) await Promise.resolve();
      sdk.interruptTurn();
      for (let i = 0; i < 60; i++) await Promise.resolve();
      mock.timers.tick(11 * 1000); // INTERRUPT_GRACE_MS (10s) elapses
      await p;
      for (let i = 0; i < 6; i++) await Promise.resolve();
      assert.equal(loopEnds.length, 1);
      assert.equal(loopEnds[0].reason, 'interrupt-timeout');
    } finally {
      mock.timers.reset();
    }
  });

  it('CLI idle with no result (lost result) ends with lost-result', async () => {
    const { deps, loopEnds } = makeDeps();
    // The CLI emits running + idle but NEVER a result: the 5s lost-result
    // backstop settles the turn.
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [stateMsg('running'), stateMsg('idle')],
    });
    sdk.__setQueryForTests((args) => withProbeAnswer(fq(args)));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sdk.sendUserMessage('hi').catch(() => {});
      // Generous microtask flush: the mock-clock probe round-trip plus the
      // settle path chain dozens of microtask hops — under-flushing leaves the
      // turn unsettled at the assertion (documented in the probe-era suites).
      for (let i = 0; i < 60; i++) await Promise.resolve();
      mock.timers.tick(6 * 1000); // lost-result GRACE_MS (5s) elapses
      for (let i = 0; i < 60; i++) await Promise.resolve();
      await p;
      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert.equal(loopEnds.length, 1);
      assert.equal(loopEnds[0].reason, 'lost-result');
    } finally {
      mock.timers.reset();
    }
  });

  it('session death mid-turn ends every pending turn with session-ended', async () => {
    const { deps, loopEnds } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => new Promise(() => {}),
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('hi').catch(() => {});
    await tick(5);
    fq.endWith(new Error('child died'));
    await p;
    await tick(8);
    assert.equal(loopEnds.length, 1);
    assert.equal(loopEnds[0].reason, 'session-ended');
  });

  it('sdk-session-state frames carry turnId + turnStartedAt; heartbeat and snapshot included', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async () => {
        if (idx++ === 0) await firstGate;
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests((args) => withProbeAnswer(fq(args)));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const p = sdk.sendUserMessage('hi').catch(() => {});
      await tick(6);
      const running = stateFrames(broadcasts).find((f) => f.state === 'running');
      assert.ok(running.turnId, 'running frame carries the turn id');
      assert.equal(typeof running.turnStartedAt, 'number');
      assert.ok(running.turnStartedAt > 0);

      mock.timers.tick(10 * 1000);
      await tick(2);
      const beats = broadcasts.filter((b) => b.type === 'sdk-session-state' && b.heartbeat === true);
      assert.ok(beats.length >= 1, 'heartbeat re-broadcasts while active');
      assert.equal(beats[0].turnId, running.turnId, 'heartbeat carries the same turn id');
      assert.equal(beats[0].turnStartedAt, running.turnStartedAt, 'heartbeat carries the same epoch');

      const snap = sdk.getSessionStateSnapshot();
      assert.equal(snap?.turnId, running.turnId);
      assert.equal(snap?.turnStartedAt, running.turnStartedAt);

      releaseFirst();
      await p;
      await tick(8);
      const idle = stateFrames(broadcasts).filter((f) => f.state === 'idle').pop();
      assert.equal(idle.turnId, running.turnId, 'the settle idle is stamped with the settled turn (not the next head)');
    } finally {
      mock.timers.reset();
    }
  });

  it('a late CLI idle from the PREVIOUS turn is suppressed for a fresh turn', async () => {
    const { deps, broadcasts } = makeDeps();
    // Frame-queue control: turn 1's trailing idle is delivered only AFTER turn 2's
    // push (head = turn 2, cliStateSeen false) — the exact interleaving the gate
    // exists for. A respond-batch fake cannot deliver a frame across the push.
    const fq = makeFrameQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('one').catch(() => {});
    await tick(4);
    fq.pushFrame(stateMsg('running'));
    fq.pushFrame(resultMsg());
    await tick(8);
    await p1;
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running', 'idle'], 'turn 1 completes');

    // Turn 2 pushed (cliStateSeen false); turn 1's LATE trailing idle now lands —
    // the gate must drop it (no spinner clear, no lost-result conviction of turn 2).
    const p2 = sdk.sendUserMessage('two').catch(() => {});
    await tick(4);
    fq.pushFrame(stateMsg('idle'));
    await tick(6);
    const states = stateFrames(broadcasts).map((f) => f.state);
    assert.equal(states[states.length - 1], 'running',
      `turn 1's late idle must not clear turn 2's spinner: ${JSON.stringify(states)}`);
    fq.pushFrame(stateMsg('running'));
    fq.pushFrame(resultMsg());
    await tick(8);
    await p2;
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running', 'idle', 'running', 'idle']);
  });

  it('message-level activity frames are coalesced (≤1/s) and marked heartbeat+activity', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async () => {
        // A burst of mid-turn messages (tool phases) BEFORE the real result:
        // assistant + tool result + task progress — all non-boundary activity.
        const out = [];
        for (let i = 0; i < 5; i++) {
          out.push({ type: 'assistant', session_id: 'sess-1', message: { role: 'assistant', content: [] } });
          out.push({ type: 'user', session_id: 'sess-1', message: { role: 'user', content: [] } });
        }
        await firstGate;
        out.push(resultMsg());
        return out;
      },
    });
    sdk.__setQueryForTests((args) => withProbeAnswer(fq(args)));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sdk.sendUserMessage('hi').catch(() => {});
      await tick(30); // let the burst flow through the iterator
      const activity = broadcasts.filter((b) => b.type === 'sdk-session-state' && b.activity === true);
      assert.ok(activity.length >= 1, 'at least one activity frame for the burst');
      assert.ok(activity.length <= 2, `coalesced well below the 10-message burst: ${activity.length}`);
      assert.equal(activity[0].state, 'running');
      assert.equal(activity[0].heartbeat, true);
      assert.ok(activity[0].turnId, 'activity frame is turn-correlated');
      assert.ok(activity[0].kind, 'activity frame names the message kind');
      releaseFirst();
      await p;
      await tick(10);
      const afterIdle = broadcasts.filter((b) => b.type === 'sdk-session-state' && b.activity === true).length;
      mock.timers.tick(5 * 1000);
      await tick(4);
      assert.equal(
        broadcasts.filter((b) => b.type === 'sdk-session-state' && b.activity === true).length,
        afterIdle,
        'no activity frames once the turn settled',
      );
    } finally {
      mock.timers.reset();
    }
  });

  it('stopSession clears the loop-boundary wiring (no leak into the next init)', async () => {
    const { deps, loopStarts } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    assert.equal(loopStarts.length, 1);

    await sdk.stopSession();
    // Re-init WITHOUT the callbacks (workspace stop→relaunch without durable
    // wiring in tests): nothing may fire into the old closures.
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('again');
    await tick(8);
    assert.equal(loopStarts.length, 1, 'no callback leak after stopSession');
  });
});
