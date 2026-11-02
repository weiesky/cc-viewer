/**
 * sdk-manager-lost-result.test.js
 *
 * Covers the generation guard for late results in server/lib/sdk-manager.js — the fix for
 * the lost-result backstop swallowing the NEXT turn's result.
 *
 * Background: when the CLI reports session_state_changed(idle) (turn over) but the matching
 * result frame never arrives, a 5s backstop force-settles the turn as turn-stuck and offers
 * a manual retry. The old _lateResultTombstones counter was meant to discard that turn's
 * LATE result if it ever showed up — but it only reset on teardown/reset, never on the next
 * _startTurn. So when the owed result never came (the lost case), the count outlived its
 * turn and swallowed the NEXT turn's normal result: no FIFO shift, no turn_end, and 5s
 * later that turn force-settled as turn-stuck too — even though its content had already
 * been persisted via the wire path.
 *
 * The generation guard binds the debt to the force-settled turn's epoch. A late result is
 * discarded only while it provably belongs to the dead generation; once a newer turn is in
 * flight, its own result pairs normally.
 *
 * Harness mirrors sdk-session-state.test.js: env first, dynamic import, resident fake query
 * with gate semantics, node:test + assert/strict, mock.timers drives the 5s backstop.
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let sdk;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-lost-'));
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
  const queryErrors = [];
  const deps = {
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: (x) => turnEnds.push(x),
    onQueryError: (e, info) => queryErrors.push({ e, info }),
    ...extra,
  };
  return { deps, broadcasts, turnEnds, queryErrors };
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

function apiRetryMsg(attempt, errorStatus = 502) {
  return { type: 'system', subtype: 'api_retry', attempt, max_retries: 3, error_status: errorStatus, error: 'bad gateway', retry_delay_ms: 1000, session_id: 'sess-1' };
}

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Resident fake (subset of sdk-session-state.test.js's factory): respond(msg, call) runs
// per pushed message and returns the frames to emit. A respond() returning a Promise parks
// the turn until state.releaseCurrent() runs; endWith(err) kills the iterator.
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
              (async () => (respond ? respond(msg, rec.pushed.length) : [resultMsg()]))(),
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

const errorToasts = (queryErrors) =>
  queryErrors.filter(({ info }) => info && info.code === 'turn-stuck');

describe('sdk-manager lost-result generation guard', () => {
  it('lost-result backstop force-settles turn A, then turn B result is NOT swallowed', async () => {
    const { deps, turnEnds, queryErrors } = makeDeps();
    // Turn A (pushed #1): CLI emits running (marks cliStateSeen) then idle, but NO result —
    // the lost-result case. Turn B (pushed #2): a normal success result.
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: (msg, pushCount) => {
        void msg;
        if (pushCount === 1) return [stateMsg('running'), stateMsg('idle')]; // no result
        return [resultMsg()]; // turn B's normal result
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      // Start turn A; queue turn B behind it (A is busy → B parks in the queue). A produces
      // no result, so its promise only settles via the backstop — NEVER await it before
      // ticking fake time (same convention as the query suite's parked-turn tests).
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(8); // let A's running/idle frames land → backstop armed
      const pB = sdk.sendUserMessage('turn B').catch(() => {}); // queued (A still busy)
      await tick(4);

      // 5s backstop elapses → A force-settles as turn-stuck → drain starts B.
      mock.timers.tick(6 * 1000);
      await tick(20); // let the drain construct+push B and let B's result land

      // A was reported turn-stuck (the lost result), offered retryable.
      assert.equal(errorToasts(queryErrors).length, 1, 'turn A must report one turn-stuck');

      // THE FIX: B's own result must NOT be swallowed by A's late-result debt. B pairs
      // normally — its FIFO record shifts and turn_end fires exactly once (for B).
      assert.equal(turnEnds.length, 1,
        `turn B's result must fire turn_end exactly once (not swallowed): ${turnEnds.length}`);

      // No SECOND turn-stuck: the old bug would force-settle B as lost too 5s later.
      mock.timers.tick(6 * 1000);
      await tick(10);
      assert.equal(errorToasts(queryErrors).length, 1,
        'turn B must NOT be mis-settled as turn-stuck after its result was already paired');
      await Promise.all([pA, pB]);
    } finally {
      mock.timers.reset();
    }
  });

  it('a genuinely late result for a force-settled turn IS discarded (no spurious turn_end)', async () => {
    const { deps, turnEnds, queryErrors } = makeDeps();
    // A frame queue the test pushes into; the iterator drains it, so the test controls
    // exactly when A's late result surfaces (AFTER the backstop has already settled A).
    const frameQueue = [];
    let wake = null;
    const fq = (() => {
      function fakeQuery({ prompt }) {
        void prompt;
        const state = { ended: false };
        const api = {
          async *[Symbol.asyncIterator]() {
            yield sysInit();
            // Drain frames as the test pushes them; park when the queue runs dry.
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
    })();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(5);
      // Turn A runs then goes idle — but produces no result (the lost case).
      fq.pushFrame(stateMsg('running'));
      fq.pushFrame(stateMsg('idle'));
      await tick(8);

      // 5s backstop fires → A settles as lost, debt recorded against A's epoch.
      mock.timers.tick(6 * 1000);
      await tick(10);
      assert.equal(errorToasts(queryErrors).length, 1, 'A reported turn-stuck');
      assert.equal(turnEnds.length, 0, 'no turn_end yet — A produced no result');

      // A's result arrives LATE (the child was merely slow, the backstop already settled
      // A). The generation guard must discard it — not fire a spurious turn_end.
      fq.pushFrame(resultMsg());
      await tick(8);
      assert.equal(turnEnds.length, 0, 'late result for the dead generation must be discarded');
      await pA;
    } finally {
      mock.timers.reset();
    }
  });

  it('interrupt-grace settle records the epoch; a re-sent turn result pairs normally', async () => {
    const { deps, turnEnds } = makeDeps();
    // The interrupt-grace path (_armSettleGrace) records the SAME _lateResultEpoch the
    // lost-result backstop uses, so the shared guard branch in the result handler is what
    // keeps a re-sent turn's result from being swallowed. Turn A parks on a gate and the
    // interrupt is never answered (dead child) → the 10s grace force-settles A. Turn B is a
    // fresh user message (a real re-send lifts the Stop-parked drain), its result must pair.
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => {
        if (idx++ === 0) return new Promise(() => {}); // turn A parks forever (dead child)
        return [resultMsg()]; // turn B's normal result
      },
    });
    sdk.__setQueryForTests((args) => {
      const q = fq(args);
      q.interrupt = async () => {}; // dead child: interrupt never releases the parked turn
      return q;
    });
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(5);
      sdk.interruptTurn(); // dead child → no result → 10s grace will force-settle A
      await tick(5);

      // 10s grace elapses → A force-settles with a late-result debt against A's epoch.
      mock.timers.tick(11 * 1000);
      await tick(10);
      await pA;
      assert.equal(turnEnds.length, 0, 'A produced no result — no turn_end for A');

      // A fresh re-send lifts the parked drain and runs turn B to completion.
      const pB = sdk.sendUserMessage('turn B').catch(() => {});
      await tick(20); // B constructs, pushes, and its result lands
      await pB;
      // B's own result must pair normally — exactly one turn_end (for B), not swallowed by
      // A's interrupt-grace debt.
      assert.equal(turnEnds.length, 1,
        `re-sent turn B's result must pair normally after A's grace settle: ${turnEnds.length}`);
    } finally {
      mock.timers.reset();
    }
  });

  // A frame-queue-driven resident fake: the iterator drains frames the test pushes,
  // so the test controls exactly when each frame surfaces (and can interleave a new
  // turn's push with a late result of the old turn).
  function makeFrameQueueQuery() {
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

  it('a live turn’s api_retry frames are NOT suppressed by a stale late-result debt', async () => {
    const { deps, broadcasts } = makeDeps();
    // Turn A loses its result → backstop force-settles A (debt recorded). Turn B then
    // starts on the same generation and hits a 502 the CLI retries. The stale debt must
    // NOT swallow B's retry frames — the inline retry bar depends on them (1.9.18).
    const fq = makeFrameQueueQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(5);
      fq.pushFrame(stateMsg('running'));
      fq.pushFrame(stateMsg('idle')); // A goes idle with no result → lost
      await tick(8);
      mock.timers.tick(6 * 1000);      // backstop settles A, records debt
      await tick(10);
      await pA;

      // Turn B starts (its result is controlled by the frame queue — still in flight).
      const pB = sdk.sendUserMessage('turn B').catch(() => {});
      await tick(5);
      fq.pushFrame(stateMsg('running')); // B genuinely in-flight (cliStateSeen)
      await tick(4);
      // B hits a 502 the CLI retries — this frame must reach the client.
      fq.pushFrame(apiRetryMsg(1, 502));
      await tick(6);
      const retryFrames = broadcasts.filter((b) => b.type === 'sdk-retry-state' && b.phase === 'retrying');
      assert.equal(retryFrames.length, 1,
        `B's api_retry must be broadcast (stale debt must not suppress a live turn): ${retryFrames.length}`);
      assert.equal(retryFrames[0].errorStatus, 502);

      // Settle B cleanly so the afterEach teardown is quiet.
      fq.pushFrame(resultMsg());
      await pB;
    } finally {
      mock.timers.reset();
    }
  });

  it('backstop armed 后仍有新消息到达 → 释放 turn-stuck 误判（_inboundMsgSeq 守护）', async () => {
    const { deps, turnEnds, queryErrors } = makeDeps();
    // The lost-result backstop re-checks at fire time whether any message arrived after
    // arming (_inboundMsgSeq > armedSeq + 1). If the head turn is still producing frames
    // (a late assistant/content frame lands during the 5s grace), the conviction is a
    // false positive — the turn is alive — and must be released, not settled turn-stuck.
    const fq = makeFrameQueueQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(5);
      fq.pushFrame(stateMsg('running'));
      fq.pushFrame(stateMsg('idle')); // arms the lost-result backstop
      await tick(6);
      // During the 5s grace the turn is STILL producing work: an assistant frame bumps
      // _inboundMsgSeq past armedSeq+1, so the backstop must release rather than convict.
      fq.pushFrame({ type: 'assistant', session_id: 'sess-1', message: { content: [{ type: 'text', text: 'still working' }] } });
      await tick(4);
      // Let the 5s backstop elapse: without the _inboundMsgSeq release this would
      // force-settle turn A as turn-stuck even though it demonstrably produced a frame.
      mock.timers.tick(6 * 1000);
      await tick(10);
      assert.equal(errorToasts(queryErrors).length, 0,
        'a message arriving during the grace must release the backstop — no turn-stuck');
      assert.equal(turnEnds.length, 0, 'no result yet → no turn_end');
      // The turn's real result then settles it normally.
      fq.pushFrame(resultMsg());
      await tick(8);
      await pA;
      assert.equal(turnEnds.length, 1, 'the live turn’s own result produces its turn_end');
    } finally {
      mock.timers.reset();
    }
  });

  it('pins the trade-off: a late result arriving while a NEWER turn is in flight pairs with the live turn', async () => {
    const { deps, turnEnds } = makeDeps();
    // Deliberate trade-off (see sdk-manager result branch comment): when turn B is in
    // flight, A's late result is indistinguishable from B's own — it is paired with B
    // rather than swallowed, because losing B's real result is the worse failure. This
    // test pins that behavior so a future change cannot silently revert to swallowing.
    const fq = makeFrameQueueQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pA = sdk.sendUserMessage('turn A').catch(() => {});
      await tick(5);
      fq.pushFrame(stateMsg('running'));
      fq.pushFrame(stateMsg('idle')); // A lost
      await tick(8);
      mock.timers.tick(6 * 1000);      // backstop settles A, debt recorded
      await tick(10);
      await pA;
      assert.equal(turnEnds.length, 0, 'no turn_end yet — A produced no result');

      // B starts and goes in-flight; before B's own result arrives, A's LATE result lands.
      const pB = sdk.sendUserMessage('turn B').catch(() => {});
      await tick(5);
      fq.pushFrame(stateMsg('running'));
      await tick(4);
      // A's late result arrives while B occupies the FIFO head (newer epoch). The guard
      // pairs it with the live turn (clears the debt) rather than discarding it.
      fq.pushFrame(resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['a late error'] }));
      await tick(8);
      assert.equal(turnEnds.length, 1,
        `the late result pairs with the live turn (one turn_end), it is NOT silently dropped: ${turnEnds.length}`);

      // B's own real result then arrives with the FIFO already empty — the unconditional
      // turn_end fires again (documented cost of the trade-off).
      fq.pushFrame(resultMsg());
      await tick(8);
      await pB;
      assert.equal(turnEnds.length, 2, 'the live turn’s own result still produces its turn_end');
    } finally {
      mock.timers.reset();
    }
  });
});
