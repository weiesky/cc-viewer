// turnEnd trailing debounce + flush-on-rising-edge 单测。
//
// 必须在 import interceptor / server 之前设置 env：
// - CCV_PROXY_MODE=1 防止 interceptor 顶层启 server / setupInterceptor
// - CCV_WORKSPACE_MODE=1 防止 server.js 自动 startViewer()
// - NODE_ENV=test 让 server.js 的 __testing namespace 真正工作（非 test 环境下走 frozen no-op）
//   也让 _emitTurnEnd 内 test-hook 抛错能 rethrow 不被吞
// 调试窗口走默认 10000ms，用 node:test 内置 mock.timers.tick() 推进时间，避免 wall-clock 抖动。
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.NODE_ENV = 'test';

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { unwatchFile } from 'node:fs';

let serverMod, streamingState, resetStreamingState, PROFILE_PATH;
let broadcasts = [];
let DEBOUNCE_MS;

before(async () => {
  const interceptor = await import('../server/interceptor.js');
  streamingState = interceptor.streamingState;
  resetStreamingState = interceptor.resetStreamingState;
  PROFILE_PATH = interceptor.PROFILE_PATH;
  serverMod = await import('../server/server.js');
  DEBOUNCE_MS = serverMod.__testing.getDebounceMs();
});

after(() => { try { unwatchFile(PROFILE_PATH); } catch {} });

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  broadcasts = [];
  serverMod.__testing.reset();
  serverMod.__testing.onBroadcast((ev) => broadcasts.push(ev));
  resetStreamingState();
});

afterEach(() => {
  mock.timers.reset();
});

describe('turn_end trailing debounce + flush-on-rising-edge', () => {
  it('schedules broadcast after debounce window', () => {
    serverMod.broadcastTurnEnd('sid-1', 1000);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), ['sid-1']);
    assert.equal(broadcasts.length, 0, 'no immediate broadcast');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(broadcasts[0], { sessionId: 'sid-1', ts: 1000 });
    assert.deepEqual(serverMod.__testing.getPendingKeys(), []);
  });

  it('coalesces two POSTs within window into a single broadcast with the latest ts', () => {
    serverMod.broadcastTurnEnd('sid-1', 1000);
    mock.timers.tick(DEBOUNCE_MS / 2);
    serverMod.broadcastTurnEnd('sid-1', 2000);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1, 'only one broadcast');
    assert.equal(broadcasts[0].ts, 2000, 'latest ts wins');
  });

  it('different sessionIds debounce independently', () => {
    serverMod.broadcastTurnEnd('sid-a', 100);
    serverMod.broadcastTurnEnd('sid-b', 200);
    assert.equal(serverMod.__testing.getPendingKeys().length, 2);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 2);
    const tsByKey = Object.fromEntries(broadcasts.map(b => [b.sessionId, b.ts]));
    assert.deepEqual(tsByKey, { 'sid-a': 100, 'sid-b': 200 });
  });

  it('null sessionId maps to a single bucket; second null POST coalesces', () => {
    serverMod.broadcastTurnEnd(null, 100);
    serverMod.broadcastTurnEnd(null, 200);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), [null]);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].ts, 200);
  });

  it('non-string sessionId (number / object) is normalized to null bucket', () => {
    serverMod.broadcastTurnEnd(42, 100);
    serverMod.broadcastTurnEnd({ id: 'x' }, 200);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), [null], 'both fall into null bucket');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].sessionId, null, 'emitted sessionId is null');
  });

  it('SDK streaming rising-edge CANCELS pending (10s 内有新请求 → 不算完成 → 不播)', () => {
    serverMod.broadcastTurnEnd('sid-1', 1000);
    serverMod.setSdkStreamingState({ active: true, model: 'x' });
    // 按用户原始语义：rising-edge 直接 cancel，不立即播放、未来也不补播
    assert.equal(broadcasts.length, 0, 'pending was cancelled, not flushed');
    assert.deepEqual(serverMod.__testing.getPendingKeys(), [], 'cleared');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 0, 'no resurrection');
  });

  it('SDK stay-active does NOT re-cancel (no extra effect)', () => {
    serverMod.setSdkStreamingState({ active: true });
    serverMod.setSdkStreamingState({ active: false });
    serverMod.broadcastTurnEnd('sid-1', 1000);
    serverMod.setSdkStreamingState({ active: false }); // 重复 inactive 不应触发
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1, 'normal scheduled broadcast still fires');
  });

  it('CLI/PTY-mode tick rising-edge cancels pending', () => {
    serverMod.broadcastTurnEnd('sid-1', 1000);
    const rose = serverMod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(rose, true);
    assert.equal(broadcasts.length, 0, 'pending was cancelled');
    assert.deepEqual(serverMod.__testing.getPendingKeys(), []);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 0, 'no resurrection');
  });

  it('CLI/PTY-mode tick stay-active does NOT re-cancel', () => {
    serverMod.__testing.observeStreamingTick(true, 'cli');
    const rose = serverMod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(rose, false);
  });

  it('streamingState active when POST arrives → still schedules (race-guard removed); fires if no rising edge', () => {
    // 历史 race-guard 会在 streamingState.active=true 时静默丢弃 POST，导致 Claude Code 在
    // Stop 后还有 housekeeping 子请求让 active 短暂 true 时，turn-end 声音永远不响。
    // 现在 POST 一律入桶；真有新一轮 query() 由 rising-edge cancel 兜底（见下方两个测试）。
    streamingState.active = true;
    serverMod.broadcastTurnEnd('sid-1', 1000);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), ['sid-1'], 'POST scheduled despite active=true');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1, 'fires after debounce when no rising edge follows');
    assert.equal(broadcasts[0].ts, 1000);
  });

  it('_isStopping guard prevents scheduling new timers', () => {
    serverMod.__testing.setIsStopping(true);
    serverMod.broadcastTurnEnd('sid-1', 1000);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), []);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 0);
  });

  it('cancelAll (shutdown path) clears without flushing', () => {
    serverMod.broadcastTurnEnd('sid-a', 100);
    serverMod.broadcastTurnEnd('sid-b', 200);
    assert.equal(serverMod.__testing.getPendingKeys().length, 2);
    // reset 走 cancelAll 路径
    serverMod.__testing.reset();
    serverMod.__testing.onBroadcast((ev) => broadcasts.push(ev));
    assert.deepEqual(serverMod.__testing.getPendingKeys(), []);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 0, 'cleared timers never fire');
  });

  it('after a fire, same sessionId can schedule again', () => {
    serverMod.broadcastTurnEnd('sid-1', 100);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 1);
    serverMod.broadcastTurnEnd('sid-1', 200);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), ['sid-1']);
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 2);
    assert.equal(broadcasts[1].ts, 200);
  });

  it('POST while active=true → subsequent rising-edge cancels pending (real new turn)', () => {
    // race-guard 移除后等价场景：POST 落在 active 窗口里照样排 timer；
    // 真正下一轮 query() 起来时（rising edge）正常 cancel，保持「10s 内有新请求 → 不算完成」
    // 的用户原始语义。
    streamingState.active = true;
    serverMod.broadcastTurnEnd('sid-1', 1000);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), ['sid-1'], 'scheduled');
    // _lastCliActive 在 reset 后是 false，所以这次 tick 算 rising edge
    const rose = serverMod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(rose, true);
    assert.deepEqual(serverMod.__testing.getPendingKeys(), [], 'cancelled by rising edge');
    mock.timers.tick(DEBOUNCE_MS);
    assert.equal(broadcasts.length, 0, 'no fire after cancel');
  });

  it('isStopping blocks streaming-tick (shutdown-then-late-tick is no-op)', () => {
    serverMod.broadcastTurnEnd('sid-1', 1000);
    serverMod.__testing.setIsStopping(true);
    // 迟到的 tick 进来：_observeStreamingTick 应 early return，不触发 flush
    const rose = serverMod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(rose, false, 'tick suppressed during shutdown');
    // pending 还在（没被 flush），但下一次任何 schedule 也会被 isStopping 短路
    assert.deepEqual(serverMod.__testing.getPendingKeys(), ['sid-1']);
  });

  it('reset (simulate stop→start) clears state so first active is a real rising edge', () => {
    // 旧 cycle 把 CLI 标记为 active
    serverMod.__testing.observeStreamingTick(true, 'cli');
    // reset == stop+start
    serverMod.__testing.reset();
    serverMod.__testing.onBroadcast((ev) => broadcasts.push(ev));
    // 新 cycle 第一次 active 应该重新算 rising edge
    const rose = serverMod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(rose, true, 'rising edge after reset');
  });
});
