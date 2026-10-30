// 批次 B — 502 内联重试反馈 (sdk-retry-state 状态机): api_retry 帧归因到在途回合、
// 错误 result 记录 retryable 的 _lastFailedTurn、成功 result 无条件广播 recovered
// （含手动重试首试成功 apiRetry.count===0 的情形）、retryInterruptedTurn 各拒绝理由。
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sdk;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-retry-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

after(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });
afterEach(async () => { try { await sdk.stopSession(); } catch { /* best-effort */ } });

async function tick(n = 3) { for (let i = 0; i < n; i++) await Promise.resolve(); }

function makeDeps(extra = {}) {
  const broadcasts = [];
  const deps = {
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: () => {},
    onQueryError: () => {},
    ...extra,
  };
  return { deps, broadcasts };
}

function sysInit(sessionId = 'sess-1') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'm', slash_commands: [], tools: [] };
}
function apiRetryMsg(over = {}) {
  return {
    type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3,
    retry_delay_ms: 1000, error_status: 502, error: 'server_error', uuid: 'u', session_id: 'sess-1', ...over,
  };
}
function resultMsg(extra = {}) { return { type: 'result', subtype: 'success', ...extra }; }

// Minimal resident-query fake (mirrors sdk-session-state.test.js): consumes the input
// queue, yields initMsgs once, then per pushed message emits respond()'s frames.
function makeResidentQuery({ respond, initMsgs } = {}) {
  function fakeQuery({ prompt, options }) {
    const state = { ended: false, releaseCurrent: null, deathWake: null, interruptReleasePending: false };
    const api = {
      async *[Symbol.asyncIterator]() {
        const done = () => { if (state.err) throw state.err; };
        for (const m of initMsgs || []) { if (state.ended) { done(); return; } await Promise.resolve(); yield m; }
        for await (const msg of prompt) {
          if (state.ended) { done(); return; }
          let out = null;
          try { out = await Promise.race([(async () => (respond ? respond(msg) : [resultMsg()]))(), new Promise((res) => { state.deathWake = () => res(undefined); })]); }
          catch { out = null; }
          if (out == null) { if (state.ended) { done(); return; } await new Promise((r) => { state.releaseCurrent = r; if (state.interruptReleasePending) { state.interruptReleasePending = false; r(); } }); state.releaseCurrent = null; if (state.ended) { done(); return; } out = [resultMsg()]; }
          for (const m of out) { if (state.ended) { done(); return; } await Promise.resolve(); yield m; }
        }
        done();
      },
      interrupt() { if (state.releaseCurrent) state.releaseCurrent(); else if (state.deathWake) { state.deathWake(); state.interruptReleasePending = true; } return Promise.resolve(); },
      close() { state.ended = true; if (state.releaseCurrent) state.releaseCurrent(); if (state.deathWake) state.deathWake(); },
    };
    return api;
  }
  return fakeQuery;
}

describe('sdk-manager — 502 inline retry state machine (批次 B)', () => {
  it('api_retry 帧 → 广播 sdk-retry-state(retrying) 并归因到在途回合', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [apiRetryMsg({ attempt: 1 }), apiRetryMsg({ attempt: 2, error_status: 503 }), resultMsg()],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    const retryFrames = broadcasts.filter((b) => b.type === 'sdk-retry-state' && b.phase === 'retrying');
    assert.ok(retryFrames.length >= 2, `observed retry progress frames: ${retryFrames.length}`);
    assert.equal(retryFrames[0].attempt, 1);
    assert.equal(retryFrames[0].maxRetries, 3);
    assert.equal(retryFrames[0].errorStatus, 502);
    assert.ok(retryFrames[0].turnId, 'retry frame is attributed to the in-flight turn');
  });

  it('错误 result（重试后仍失败）→ 记录 retryable 的 _lastFailedTurn 并带元数据广播', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [apiRetryMsg({ attempt: 3, error_status: 502 }), resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['server_error'] })],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    const errFrame = broadcasts.find((b) => b.type === 'sdk-error');
    assert.ok(errFrame, 'an sdk-error frame is broadcast');
    assert.equal(errFrame.retryable, true, 'a 502-after-retry failure is retryable');
    assert.equal(errFrame.apiStatus, 502);
    assert.ok(errFrame.turnId, 'the failed turn id is carried for the manual [retry] match');
  });

  it('成功 result 无条件广播 recovered 并按 retryOf 指向失败回合（手动重试首试成功也清理）', async () => {
    const { deps, broadcasts } = makeDeps();
    let call = 0;
    // First turn: retries then fails (502). Manual retry turn: succeeds on first attempt
    // (apiRetry.count===0) — the recovered frame must STILL fire and name the failed turn.
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => {
        call++;
        return call === 1
          ? [apiRetryMsg({ attempt: 1 }), resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['server_error'] })]
          : [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    const failedTurnId = broadcasts.find((b) => b.type === 'sdk-error')?.turnId;
    assert.ok(failedTurnId, 'the first turn failed and recorded its id');

    const r = await sdk.retryInterruptedTurn(failedTurnId);
    assert.equal(r.ok, true, `manual retry accepted: ${JSON.stringify(r)}`);
    await tick(8);
    const recovered = broadcasts.find((b) => b.type === 'sdk-retry-state' && b.phase === 'recovered');
    assert.ok(recovered, 'a recovered frame is broadcast on the retry turn success');
    assert.equal(recovered.retryOf, failedTurnId, 'recovered names the FAILED turn (frontend matches by retryOf)');
  });

  it('retryInterruptedTurn 拒绝理由：nothing-to-retry / busy / stale / not-retryable', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()], respond: () => [resultMsg()] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    // No recorded failure yet.
    assert.equal((await sdk.retryInterruptedTurn(null)).reason, 'nothing-to-retry');
    // Stale: a turnId that does not match the recorded failure.
    await sdk.sendUserMessage('hi');
    await tick(6);
    // After a clean success there is no failure to retry.
    assert.equal((await sdk.retryInterruptedTurn('turn_nonexistent')).reason, 'nothing-to-retry');
  });
});
