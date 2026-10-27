/**
 * auto-approve.test.js — server-side auto-approve countdown pure logic.
 *
 * node:test + assert/strict; 私有 mkdtemp 作 CCV_LOG_DIR（在目标模块 import 前设好）；
 * 动态 import 目标；mock.timers 仅本文件作用域并在 finally 还原。
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let auto;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-auto-approve-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  auto = await import('../server/lib/auto-approve.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('effectiveAutoApproveSeconds', () => {
  it('plan 读 approvalModal.planAutoApproveSeconds，缺省 0 = 关闭', () => {
    assert.equal(auto.effectiveAutoApproveSeconds('plan', {}), null);
    assert.equal(auto.effectiveAutoApproveSeconds('plan', { approvalModal: {} }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('plan', { approvalModal: { planAutoApproveSeconds: 0 } }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('plan', { approvalModal: { planAutoApproveSeconds: 10 } }), 10);
    assert.equal(auto.effectiveAutoApproveSeconds('plan', { approvalModal: { planAutoApproveSeconds: -1 } }), -1);
  });

  it('perm 读 autoApproveSeconds，缺省 3（对齐客户端默认值）', () => {
    assert.equal(auto.effectiveAutoApproveSeconds('perm', {}), 3);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 0 }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 5 }), 5);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: -1 }), -1);
  });

  it('非法值 = 关闭（"abc" / -2 / NaN）', () => {
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 'abc' }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: -2 }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: NaN }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('plan', { approvalModal: { planAutoApproveSeconds: 'x' } }), null);
  });

  it('超过 MAX_AUTO_APPROVE_SECONDS(300) 的值 = 关闭（不得超过 5min 审批硬超时）', () => {
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 300 }), 300);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 301 }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 3600 }), null);
    assert.equal(auto.effectiveAutoApproveSeconds('perm', { autoApproveSeconds: 3e9 }), null);
  });
});

describe('computeAutoApprove', () => {
  const readPrefs = (prefs) => () => prefs;

  it('关闭时返回 {enabled:false}', () => {
    const r = auto.computeAutoApprove('plan', '/p', { now: 1000, readPrefs: readPrefs({}) });
    assert.deepEqual(r, { enabled: false });
  });

  it('N 秒档：autoApproveAt = now + N*1000', () => {
    const r = auto.computeAutoApprove('perm', '/p', { now: 1000, readPrefs: readPrefs({ autoApproveSeconds: 5 }) });
    assert.deepEqual(r, { enabled: true, instant: false, seconds: 5, autoApproveAt: 6000 });
  });

  it('-1 即时档：autoApproveAt = now', () => {
    const r = auto.computeAutoApprove('perm', '/p', { now: 1000, readPrefs: readPrefs({ autoApproveSeconds: -1 }) });
    assert.deepEqual(r, { enabled: true, instant: true, seconds: -1, autoApproveAt: 1000 });
  });

  it('项目 fork 覆盖全局；无 fork 键回退全局', () => {
    const prefs = {
      autoApproveSeconds: 0,
      prefsByProject: { '/p': { autoApproveSeconds: 7 } },
    };
    const r = auto.computeAutoApprove('perm', '/p', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r.enabled, true);
    assert.equal(r.seconds, 7);
    // 无 fork 的项目读全局（0 = 关）
    const r2 = auto.computeAutoApprove('perm', '/other', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r2.enabled, false);
  });

  it('fork 缺该键时回落全局值', () => {
    const prefs = {
      autoApproveSeconds: 9,
      prefsByProject: { '/p': { someOther: true } },
    };
    const r = auto.computeAutoApprove('perm', '/p', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r.seconds, 9);
  });

  it('plan 的 approvalModal 经 fork 深合并', () => {
    const prefs = {
      approvalModal: { planAutoApproveSeconds: 30 },
      prefsByProject: { '/p': { approvalModal: { planAutoApproveSeconds: 60 } } },
    };
    const r = auto.computeAutoApprove('plan', '/p', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r.seconds, 60);
  });

  it('readPrefs 抛错 → enabled:false 且不抛出', () => {
    const r = auto.computeAutoApprove('perm', '/p', {
      now: 0,
      readPrefs: () => { throw new Error('boom'); },
    });
    assert.deepEqual(r, { enabled: false });
  });
});

describe('autoApproveFireDelayMs', () => {
  it('N 秒档 = 剩余 + 1000ms buffer', () => {
    const c = { enabled: true, instant: false, seconds: 10, autoApproveAt: 11000 };
    assert.equal(auto.autoApproveFireDelayMs(c, 1000), 11000);
  });

  it('已过截止时间也不为负', () => {
    const c = { enabled: true, instant: false, seconds: 10, autoApproveAt: 500 };
    assert.equal(auto.autoApproveFireDelayMs(c, 1000), 1000);
  });

  it('instant = 0；disabled = null', () => {
    assert.equal(auto.autoApproveFireDelayMs({ enabled: true, instant: true, autoApproveAt: 1 }, 1000), 0);
    assert.equal(auto.autoApproveFireDelayMs({ enabled: false }, 1000), null);
  });
});

describe('createAutoApproveState / cancelAutoApproveState', () => {
  it('计时器到点 fire；cancel 后不 fire；二次 cancel 幂等', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = 0;
      const state = auto.createAutoApproveState(
        { enabled: true, instant: false, seconds: 5, autoApproveAt: 5000 },
        () => { fired += 1; },
      );
      assert.equal(state.autoApproveAt, 5000);
      assert.equal(state.seconds, 5);
      assert.ok(state.timer);
      mock.timers.tick(6000);
      assert.equal(fired, 1);

      let fired2 = 0;
      const state2 = auto.createAutoApproveState(
        { enabled: true, instant: false, seconds: 5, autoApproveAt: 5000 },
        () => { fired2 += 1; },
      );
      assert.equal(auto.cancelAutoApproveState(state2), true);
      assert.equal(auto.cancelAutoApproveState(state2), false); // 幂等
      mock.timers.tick(6000);
      assert.equal(fired2, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('instant 同步 fire，无计时器', () => {
    let fired = 0;
    const state = auto.createAutoApproveState(
      { enabled: true, instant: true, seconds: -1, autoApproveAt: 0 },
      () => { fired += 1; },
    );
    assert.equal(fired, 1);
    assert.equal(state.timer, null);
  });

  it('disabled 入参 → 返回 null（不武装）', () => {
    let fired = 0;
    const state = auto.createAutoApproveState({ enabled: false }, () => { fired += 1; });
    assert.equal(state, null);
    assert.equal(fired, 0);
  });
});

describe('cancelAutoApproveState', () => {
  it('entry 形式：同时置 entry.autoCancelled 与 auto.cancelled，清 timer，幂等', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = 0;
      const autoState = auto.createAutoApproveState(
        { enabled: true, instant: false, seconds: 5, autoApproveAt: 5000 },
        () => { fired += 1; },
      );
      const entry = { auto: autoState, autoCancelled: false };
      assert.equal(auto.cancelAutoApproveState(entry), true);
      assert.equal(entry.autoCancelled, true);
      assert.equal(entry.auto.cancelled, true);
      assert.equal(entry.auto.timer, null);
      assert.equal(auto.cancelAutoApproveState(entry), false); // 幂等
      mock.timers.tick(6000);
      assert.equal(fired, 0);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('replayAutoApproveFields', () => {
  it('取消后 autoApproveAt 为 null 且 autoCancelled=true', () => {
    const f = auto.replayAutoApproveFields({ autoApproveAt: 123, seconds: 5 }, true);
    assert.deepEqual(f, { autoApproveAt: null, autoApproveSeconds: 5, autoCancelled: true });
  });

  it('未取消：透传 deadline；无 auto 状态时为 null', () => {
    assert.deepEqual(
      auto.replayAutoApproveFields({ autoApproveAt: 123, seconds: 5 }, false),
      { autoApproveAt: 123, autoApproveSeconds: 5, autoCancelled: false },
    );
    assert.deepEqual(
      auto.replayAutoApproveFields(null, false),
      { autoApproveAt: null, autoApproveSeconds: null, autoCancelled: false },
    );
  });
});
