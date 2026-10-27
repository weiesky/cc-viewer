import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { remainingSeconds, startDeadlineCountdown } from '../src/utils/deadlineCountdown.js';

describe('remainingSeconds', () => {
  it('向上取整并夹到 0', () => {
    assert.equal(remainingSeconds(11000, 1000), 10);
    assert.equal(remainingSeconds(10500, 1000), 10); // ceil
    assert.equal(remainingSeconds(500, 1000), 0);    // clamp
  });
});

describe('startDeadlineCountdown', () => {
  it('按 wall-clock 报剩余：interval 漂移不影响显示值', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      const ticks = [];
      const now = Date.now();
      const stop = startDeadlineCountdown({
        deadlineMs: now + 5000,
        onTick: (s) => ticks.push(s),
        documentRef: undefined,
      });
      assert.deepEqual(ticks, [5]); // 立即一次
      // 模拟 interval 被节流：一次 tick 跨了 3 秒
      mock.timers.tick(3000);
      assert.equal(ticks.at(-1), 2, 'wall-clock 重算，不是 -1 递减');
      stop();
    } finally {
      mock.timers.reset();
    }
  });

  it('到期一次性 onExpire 并自动停止', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      let expired = 0;
      const ticks = [];
      const now = Date.now();
      startDeadlineCountdown({
        deadlineMs: now + 2000,
        onTick: (s) => ticks.push(s),
        onExpire: () => { expired += 1; },
        documentRef: undefined,
      });
      mock.timers.tick(10_000);
      assert.equal(expired, 1);
      assert.equal(ticks.at(-1) > 0, true, '到期前最后一次 tick 仍为正');
    } finally {
      mock.timers.reset();
    }
  });

  it('已过的 deadline 同步 fire onExpire，不起 interval', () => {
    let expired = 0;
    const stop = startDeadlineCountdown({
      deadlineMs: Date.now() - 100,
      onExpire: () => { expired += 1; },
      documentRef: undefined,
    });
    assert.equal(expired, 1);
    stop(); // 幂等
  });

  it('visibilitychange→visible 立即重算', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      const listeners = [];
      const doc = {
        visibilityState: 'visible',
        addEventListener: (ev, cb) => { if (ev === 'visibilitychange') listeners.push(cb); },
        removeEventListener: (ev, cb) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
      const ticks = [];
      const now = Date.now();
      const stop = startDeadlineCountdown({
        deadlineMs: now + 9000,
        onTick: (s) => ticks.push(s),
        documentRef: doc,
      });
      assert.equal(listeners.length, 1);
      // 不经 interval：直接拨动 wall-clock 再触发 visible
      mock.timers.tick(4000);
      const before = ticks.length;
      doc.visibilityState = 'visible';
      for (const cb of [...listeners]) cb();
      assert.ok(ticks.length > before, 'visibility recompute fires a tick');
      stop();
      assert.equal(listeners.length, 0, 'stop() removes the listener');
    } finally {
      mock.timers.reset();
    }
  });

  it('stop() 幂等且停止后续 tick', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    try {
      const ticks = [];
      const now = Date.now();
      const stop = startDeadlineCountdown({
        deadlineMs: now + 8000,
        onTick: (s) => ticks.push(s),
        documentRef: undefined,
      });
      stop();
      stop();
      const n = ticks.length;
      mock.timers.tick(3000);
      assert.equal(ticks.length, n);
    } finally {
      mock.timers.reset();
    }
  });
});
