/**
 * sdk-session-state.test.js
 *
 * Covers the turn-level session-state relay in server/lib/sdk-manager.js:
 *  - push-path 'running' fallback broadcast (covers CLIs that never emit
 *    session_state_changed),
 *  - CLI-emitted session_state_changed forwarding (idle/running/requires_action),
 *  - result-time synchronous 'idle' broadcast (the debounced turn_end SSE is
 *    voice-pack semantics and too slow for the spinner),
 *  - interrupt / session-teardown 'idle' clears,
 *  - WS reconnect snapshot (getSessionStateSnapshot) and switch/reset hygiene.
 *
 * Harness conventions mirror sdk-manager-query.test.js: env first, dynamic import,
 * resident fake query with gate semantics, node:test + assert/strict. Turn promises
 * are NEVER awaited without a settle path — `sendUserMessage(...).catch(() => {})`
 * plus microtask ticks, exactly like the query suite's parked-turn tests.
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let sdk;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-state-'));
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
  const deps = {
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: (x) => turnEnds.push(x),
    ...extra,
  };
  return { deps, broadcasts, turnEnds };
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

async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Resident fake with gate semantics (subset of sdk-manager-query.test.js's factory):
// respond() returning a Promise parks the turn until state.releaseCurrent() is called
// (real CLI turns wait on tools); respond() returning an array emits it immediately.
// endWith(err) ends the iterator (err → throw): session-level death.
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
            // Parked turn: wait for an explicit release or teardown. An interrupt that
            // arrived while respond() was still awaiting is honored NOW (the pending
            // flag), releasing the park immediately so the wrap-up result is emitted.
            await new Promise((resolve) => {
              state.releaseCurrent = resolve;
              if (state.interruptReleasePending) {
                state.interruptReleasePending = false;
                resolve();
              } else if (state.err || state.ended) resolve();
            });
            state.releaseCurrent = null;
            if (state.ended) { done(); return; }
            // close()/teardown ends the stream WITHOUT completing the turn; an
            // interrupt release falls through to the wrap-up result below (the CLI
            // emits an error result for the aborted turn — is_error is irrelevant
            // to the relay assertions).
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
        // CLI contract: interrupt → the in-flight turn wraps up with an (error)
        // result. The turn may still be inside respond()'s race (gate wait) with no
        // parked release registered yet — remember it (interruptReleasePending) and
        // the park branch releases immediately on entry.
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

const stateFrames = (broadcasts) => broadcasts.filter((b) => b.type === 'sdk-session-state');

describe('sdk-session-state relay', () => {
  it('push broadcasts running fallback; result broadcasts idle', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(6);

    const frames = stateFrames(broadcasts);
    assert.deepEqual(frames.map((f) => f.state), ['running', 'idle']);
  });

  it('forwards CLI-emitted session_state_changed (incl. requires_action)', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [stateMsg('requires_action'), stateMsg('running'), resultMsg()],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(8);

    const states = stateFrames(broadcasts).map((f) => f.state);
    // push fallback → CLI messages → result fallback idle
    assert.deepEqual(states, ['running', 'requires_action', 'running', 'idle']);
  });

  it('duplicate consecutive states are suppressed (change guard)', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [stateMsg('running'), stateMsg('running'), resultMsg()],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(8);

    // push running + forwarded dup running (dropped) + idle
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running', 'idle']);
  });

  it('snapshot reflects the last announced state for WS reconnect replay', async () => {
    const { deps } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    assert.equal(sdk.getSessionStateSnapshot(), null, 'fresh session: no frame');
    await sdk.sendUserMessage('hi');
    await tick(6);

    const snap = sdk.getSessionStateSnapshot();
    assert.equal(snap?.type, 'sdk-session-state');
    assert.equal(snap?.state, 'idle');
    assert.equal(snap?.sessionId, 'sess-1');
  });

  it('switchToSession resets the snapshot (no stale replay into the new session)', async () => {
    const { deps } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(6);
    assert.ok(sdk.getSessionStateSnapshot());

    await sdk.switchToSession('sess-2');
    assert.equal(sdk.getSessionStateSnapshot(), null);
  });

  it('interruptTurn settles the turn (CLI interrupt → result) and clears to idle', async () => {
    const { deps, broadcasts } = makeDeps();
    // First turn parks on a gate (real CLI waiting on tools); interruptTurn() issues
    // the control request, then the test releases the gate — the CLI's contract is
    // that the aborted turn wraps up with an (error) result, which the fake's
    // post-park branch emits. Runs on the wall clock (the grace timer is unref'd
    // and canceled by the result path; nothing here waits on it).
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
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running']);

    sdk.interruptTurn();
    releaseFirst(); // CLI answers the interrupt with the turn's (error) result
    await p;
    await tick(8);
    const states = stateFrames(broadcasts).map((f) => f.state);
    assert.deepEqual(states, ['running', 'idle']);
  });

  it('interrupt with a dead child (no result ever) clears to idle via the grace path', async () => {
    const { deps, broadcasts } = makeDeps();
    // respond parks forever and interrupt() does NOT release — simulating a child
    // that never answers (the INTERRUPT_GRACE_MS force-settle is the only out).
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => new Promise(() => {}),
    });
    // Override: interrupt must not release the parked turn.
    sdk.__setQueryForTests((args) => {
      const q = fq(args);
      q.interrupt = async () => {}; // dead child: no release
      return q;
    });
    sdk.initSdkSession(tmpDir, 'proj', deps);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sdk.sendUserMessage('hi').catch(() => {});
      // Under mock.timers, microtasks still run in real time.
      for (let i = 0; i < 6; i++) await Promise.resolve();
      sdk.interruptTurn();
      for (let i = 0; i < 60; i++) await Promise.resolve();
      // 10s grace elapses → force-settle → idle broadcast (no result ever arrived).
      mock.timers.tick(11 * 1000);
      await p;
      for (let i = 0; i < 6; i++) await Promise.resolve();
      const states = stateFrames(broadcasts).map((f) => f.state);
      assert.equal(states[states.length - 1], 'idle',
        `grace force-settle must clear the spinner: ${JSON.stringify(states)}`);
    } finally {
      mock.timers.reset();
    }
  });

  it('session death mid-turn announces idle (no result will arrive)', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => new Promise(() => {}),
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('hi').catch(() => {});
    await tick(4);
    assert.deepEqual(stateFrames(broadcasts).map((f) => f.state), ['running']);

    fq.endWith(new Error('child died')); // iterator throws → _onResidentDeath
    await p;
    await tick(6);
    const states = stateFrames(broadcasts).map((f) => f.state);
    assert.equal(states[states.length - 1], 'idle',
      `spinner must not survive session death: ${JSON.stringify(states)}`);
    // The retained snapshot is 'idle' (not 'running'): a WS reconnect after the death
    // replays the idle frame, which is correct — the session is dead, not mid-turn.
    // Only session switch / full reset nulls the snapshot (covered above).
    assert.equal(sdk.getSessionStateSnapshot()?.state, 'idle');
  });
});
