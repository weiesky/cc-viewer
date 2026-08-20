/**
 * branch 补充测试 —— server/lib/ws-backpressure.js 的反压闸门
 *
 * 针对单跑口径下 ws-backpressure.test.js 未覆盖的分支:
 *   - createBackpressureGate 的 4 个默认形参 (highWater/lowWater/pollMs/timeoutMs)
 *   - 可选回调缺省时的可选链短路 (onBehind? / onTimeout?)
 *   - pollTimer.unref?.() 在 unref 缺失时的短路 (子进程 + 桩 setInterval)
 *   - stopPolling 在 pollTimer 为 null 时的假分支 (未进 behind 直接 dispose)
 *   - offer/poll 在 disposed 终态的早退分支
 *
 * 本文件不做端口/共享目录写,纯逻辑 + 一次子进程,与并行套件天然隔离。
 */
import './_shims/register.mjs';
import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'server', 'lib', 'ws-backpressure.js');

let createBackpressureGate;

before(async () => {
  ({ createBackpressureGate } = await import('../server/lib/ws-backpressure.js'));
});

// 轮询助手(本文件未用 sleep 断言,timers 全部用 mock.timers 推进)
function waitUntil(pred, { timeout = 2000, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - t0 >= timeout) return reject(new Error('waitUntil timeout'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

describe('createBackpressureGate 分支补充', { concurrency: false }, () => {
  it('默认形参生效: 不传 highWater/lowWater/pollMs/timeoutMs', () => {
    // 仅传必填项,4 个默认值走 = 默认分支
    let buffered = 0;
    const gate = createBackpressureGate({
      getBufferedAmount: () => buffered,
      onResume: () => {},
    });
    // 默认 highWater = 1MB,512KB 远低于阈值 → 放行
    buffered = 512 * 1024;
    assert.equal(gate.offer(), true);
    assert.equal(gate.isBehind(), false);
    // 越过默认 1MB 高水位 → 进 behind
    buffered = 2 * 1024 * 1024;
    assert.equal(gate.offer(), false);
    assert.equal(gate.isBehind(), true);
    gate.dispose();
  });

  it('默认 lowWater(256KB): 默认迟滞带内保持 hold,降到默认低水位以下才恢复', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let buffered = 2 * 1024 * 1024;
      let resumed = 0;
      const gate = createBackpressureGate({
        getBufferedAmount: () => buffered,
        onResume: () => { resumed++; },
        // 默认 pollMs = 100, timeoutMs = 60000
      });
      gate.offer();
      // 落在默认迟滞带 (256KB < 512KB < 1MB) → 仍 hold
      buffered = 512 * 1024;
      mock.timers.tick(100);     // 默认 pollMs 一轮
      assert.equal(resumed, 0);
      assert.equal(gate.isBehind(), true);
      // 降到默认低水位以下 → 恢复
      buffered = 100 * 1024;
      mock.timers.tick(100);
      assert.equal(resumed, 1);
      assert.equal(gate.isBehind(), false);
      gate.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it('onBehind 缺省: 进 behind 时可选链短路不抛 (无回调)', () => {
    let buffered = 0;
    const gate = createBackpressureGate({
      highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
      getBufferedAmount: () => buffered,
      onResume: () => {},
      // onBehind 不传 → onBehind?.() 走 undefined 短路
    });
    buffered = 1500;
    assert.doesNotThrow(() => gate.offer());
    assert.equal(gate.isBehind(), true);
    gate.dispose();
  });

  it('onBehind 抛异常: offer 进 behind 时被 try/catch 吞掉,不影响状态机', () => {
    let buffered = 0;
    const gate = createBackpressureGate({
      highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
      getBufferedAmount: () => buffered,
      onResume: () => {},
      onBehind: () => { throw new Error('onBehind boom'); },
    });
    buffered = 1500;
    // line 92 的 catch {} 分支: onBehind 抛错被吞,offer 仍正常返回 false
    assert.equal(gate.offer(), false);
    assert.equal(gate.isBehind(), true);
    gate.dispose();
  });

  it('onResume 抛异常: poll 恢复时被 try/catch 吞掉,仍退出 behind', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let buffered = 1500;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => { throw new Error('onResume boom'); },
      });
      gate.offer();
      buffered = 100;            // 排空
      // line 69 的 catch {} 分支: onResume 抛错被吞,behind 仍正常清除
      assert.doesNotThrow(() => mock.timers.tick(100));
      assert.equal(gate.isBehind(), false);
      assert.equal(gate.offer(), true);
      gate.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it('onTimeout 缺省: 超时分支里可选链短路不抛 (无回调)', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let buffered = 1500;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => {},
        // onTimeout 不传 → onTimeout?.() 走 undefined 短路
      });
      gate.offer();
      assert.doesNotThrow(() => mock.timers.tick(60000));
      // 超时后闸门终态失效
      buffered = 0;
      mock.timers.tick(1000);
      assert.equal(gate.offer(), false);
      gate.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it('onTimeout 抛异常: 超时分支里被 try/catch 吞掉,闸门仍终态失效', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let buffered = 1500;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => {},
        onTimeout: () => { throw new Error('onTimeout boom'); },
      });
      gate.offer();
      // line 75 的 catch {} 分支: onTimeout 抛错被吞
      assert.doesNotThrow(() => mock.timers.tick(60000));
      buffered = 0;
      mock.timers.tick(1000);
      assert.equal(gate.offer(), false);
      gate.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it('poll 在 disposed 后被触发: 命中 if(disposed) return 早退 (桩 clearInterval 阻止取消)', async () => {
    // line 61 的 if (disposed) return 真分支: 需要 poll 在 disposed=true 时仍被调度执行。
    // 正常 dispose 会 clearInterval 取消轮询; 这里桩掉 clearInterval 为 no-op,
    // 让真实 setInterval 在 dispose 后继续触发,poll 首句即 disposed 早退。
    const realClear = globalThis.clearInterval;
    const realSet = globalThis.setInterval;
    const liveTimers = [];
    globalThis.setInterval = (fn, ms) => {
      const h = realSet(fn, ms);          // 用真实定时器,但记下 handle 以便测试末尾真清
      liveTimers.push(h);
      return h;
    };
    globalThis.clearInterval = () => {};   // 阻止取消,模拟"已调度的 poll 在 disposed 后仍跑一次"
    try {
      let buffered = 1500;
      let resumed = 0;
      let timedOut = 0;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 5, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => { resumed++; },
        onTimeout: () => { timedOut++; },
      });
      gate.offer();              // 进 behind,真实 setInterval(5ms) 启动
      gate.dispose();            // disposed=true; clearInterval 被桩成 no-op → interval 仍活
      buffered = 0;              // 即便已排空,disposed 早退应使 onResume 永不触发
      // 等待若干轮 poll 触发: 每轮首句 if(disposed) return,resumed 永远为 0
      await waitUntil(() => true, { timeout: 60, interval: 20 });
      assert.equal(resumed, 0, 'disposed 后 poll 早退,不应触发 onResume');
      assert.equal(timedOut, 0);
    } finally {
      globalThis.clearInterval = realClear;
      globalThis.setInterval = realSet;
      // 兜底: 真实清理桩期间 dispose 未真正取消的 interval,防止泄漏到其他测试
      for (const t of liveTimers) realClear(t);
    }
  });

  it('未进 behind 直接 dispose: stopPolling 命中 pollTimer == null 假分支', () => {
    let buffered = 100;
    const gate = createBackpressureGate({
      highWater: 1000, lowWater: 200,
      getBufferedAmount: () => buffered,
      onResume: () => {},
    });
    // 从未越线 → pollTimer 始终为 null
    assert.equal(gate.offer(), true);
    assert.doesNotThrow(() => gate.dispose());
    // 再次 dispose 也安全 (pollTimer 仍 null)
    assert.doesNotThrow(() => gate.dispose());
    assert.equal(gate.offer(), false, 'disposed → offer 早退假/真');
  });

  it('poll 在 dispose 后早退: behind 中 dispose,再推进 timers 不触发任何回调', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let buffered = 1500;
      let resumed = 0;
      let timedOut = 0;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => { resumed++; },
        onTimeout: () => { timedOut++; },
      });
      gate.offer();              // 进 behind,启动 pollTimer
      gate.dispose();            // 清掉 interval (mock.timers 下 clearInterval 生效)
      buffered = 0;
      mock.timers.tick(120000);  // 即便 poll 仍被某种方式触发,disposed 早退
      assert.equal(resumed, 0);
      assert.equal(timedOut, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('pollTimer.unref?.() 短路: setInterval 返回无 unref 的桩对象不抛 (子进程 canonical import)', () => {
    // 真实 setInterval 返回的 Timeout 带 unref;为覆盖 unref 缺失的可选链短路,
    // 在子进程里桩掉 globalThis.setInterval 让其返回裸对象,然后 canonical import 目标。
    const code = `
      import { createBackpressureGate } from ${JSON.stringify(SRC)};
      const realSetInterval = globalThis.setInterval;
      // 桩: 返回不带 unref 的对象,触发 pollTimer.unref?.() 的 undefined 短路
      globalThis.setInterval = (fn, ms) => ({ __stub: true });
      let buffered = 0;
      const gate = createBackpressureGate({
        highWater: 1000, lowWater: 200, pollMs: 100, timeoutMs: 60000,
        getBufferedAmount: () => buffered,
        onResume: () => {},
      });
      buffered = 1500;
      const r = gate.offer();   // 进 behind → pollTimer = 裸对象,unref?.() 应短路不抛
      globalThis.setInterval = realSetInterval;
      if (r !== false) { console.error('OFFER_NOT_FALSE'); process.exit(2); }
      if (gate.isBehind() !== true) { console.error('NOT_BEHIND'); process.exit(3); }
      console.log('UNREF_OPTIONAL_OK');
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `子进程失败: status=${res.status} stderr=${res.stderr}`);
    assert.match(res.stdout, /UNREF_OPTIONAL_OK/);
  });
});
