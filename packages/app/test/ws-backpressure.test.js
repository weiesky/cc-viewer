/**
 * ws-backpressure 单测 —— WebSocket per-client 反压闸门
 *
 * 覆盖：
 *   - 低水位下 offer 正常放行
 *   - bufferedAmount 越过高水位 → 转 behind、offer 返回 false
 *   - behind 期间轮询，降回低水位以下 → onResume 触发、恢复放行
 *   - 迟滞带（高低水位之间）保持 hold 不反复开关
 *   - behind 超时 → onTimeout 触发且闸门失效
 *   - dispose 清理轮询 interval
 *   - getBufferedAmount 抛异常的容错
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBackpressureGate } from '../server/lib/ws-backpressure.js';

const OPTS = { highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000 };

describe('createBackpressureGate', { concurrency: false }, () => {
  let buffered;
  let resumed;
  let timedOut;
  let gate;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    buffered = 0;
    resumed = 0;
    timedOut = 0;
    gate = createBackpressureGate({
      ...OPTS,
      getBufferedAmount: () => buffered,
      onResume: () => { resumed++; },
      onTimeout: () => { timedOut++; },
    });
  });

  afterEach(() => {
    gate.dispose();
    mock.timers.reset();
  });

  it('低水位下 offer 放行', () => {
    buffered = 500;
    assert.equal(gate.offer(), true);
    assert.equal(gate.isBehind(), false);
  });

  it('越过高水位 → behind，offer 返回 false 且持续 hold', () => {
    buffered = 1500;
    assert.equal(gate.offer(), false);
    assert.equal(gate.isBehind(), true);
    // behind 期间即使 bufferedAmount 已降（轮询未跑），offer 仍 hold
    assert.equal(gate.offer(), false);
  });

  it('降回低水位以下 → 轮询触发 onResume，恢复放行', () => {
    buffered = 1500;
    gate.offer();
    buffered = 100;             // 客户端排空
    mock.timers.tick(100);      // 跑一轮 poll
    assert.equal(resumed, 1);
    assert.equal(gate.isBehind(), false);
    assert.equal(gate.offer(), true, 'offer resumes after drain');
  });

  it('迟滞带内（低水位 < buffered < 高水位）保持 hold 不恢复', () => {
    buffered = 1500;
    gate.offer();
    buffered = 500;             // 仍在迟滞带（200 < 500 < 1000）
    mock.timers.tick(1000);     // 多轮 poll
    assert.equal(resumed, 0);
    assert.equal(gate.isBehind(), true);
  });

  it('behind 持续超 timeoutMs → onTimeout，闸门终态失效', () => {
    buffered = 1500;
    gate.offer();
    mock.timers.tick(60000);    // 一直不排空直到超时
    assert.equal(timedOut, 1);
    assert.equal(resumed, 0);
    // 终态：即使之后排空也不再恢复
    buffered = 0;
    mock.timers.tick(1000);
    assert.equal(resumed, 0);
    assert.equal(gate.offer(), false);
  });

  it('onBehind 在进入 behind 时回调一次（带 bufferedAmount），hold 期间不重复', () => {
    const behindCalls = [];
    const g = createBackpressureGate({
      ...OPTS,
      getBufferedAmount: () => buffered,
      onBehind: (b) => behindCalls.push(b),
      onResume: () => {},
    });
    buffered = 1500;
    g.offer();
    g.offer();                  // behind 中再 offer 不应重复回调
    assert.deepEqual(behindCalls, [1500]);
    buffered = 100;
    mock.timers.tick(100);      // 恢复
    buffered = 2000;
    g.offer();                  // 二次进 behind → 再回调一次
    assert.deepEqual(behindCalls, [1500, 2000]);
    g.dispose();
  });

  it('恢复之后再次洪泛 → 重新进 behind（状态机可循环）', () => {
    buffered = 1500;
    gate.offer();               // 第一次进 behind
    buffered = 100;
    mock.timers.tick(100);      // 排空恢复
    assert.equal(resumed, 1);
    assert.equal(gate.isBehind(), false);
    buffered = 2000;            // 立刻再次越线
    assert.equal(gate.offer(), false, 're-enters behind');
    assert.equal(gate.isBehind(), true);
    buffered = 100;
    mock.timers.tick(100);      // 第二轮也能正常恢复
    assert.equal(resumed, 2);
    assert.equal(gate.offer(), true);
  });

  it('dispose 清理轮询：之后排空也不再回调', () => {
    buffered = 1500;
    gate.offer();
    gate.dispose();
    buffered = 0;
    mock.timers.tick(1000);
    assert.equal(resumed, 0);
    assert.equal(gate.offer(), false, 'disposed gate stops offering');
  });

  it('offer 时 getBufferedAmount 抛异常 → 按 0 处理继续放行（不因瞬时读取失败误杀）', () => {
    const g = createBackpressureGate({
      ...OPTS,
      getBufferedAmount: () => { throw new Error('boom'); },
      onResume: () => {},
    });
    assert.equal(g.offer(), true);
    g.dispose();
  });

  it('behind 轮询中 getBufferedAmount 抛异常 → 视为未排空，最终走超时', () => {
    let shouldThrow = false;
    const g = createBackpressureGate({
      ...OPTS,
      getBufferedAmount: () => {
        if (shouldThrow) throw new Error('socket gone');
        return buffered;
      },
      onResume: () => { resumed++; },
      onTimeout: () => { timedOut++; },
    });
    buffered = 1500;
    g.offer();
    shouldThrow = true;
    mock.timers.tick(60000);
    assert.equal(resumed, 0);
    assert.equal(timedOut, 1);
    g.dispose();
  });
});
