/**
 * termDiag 纯逻辑测试（计数器/水位/EWMA/快照/安装守卫）
 */
import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import {
  diagCount,
  diagSet,
  diagEwma,
  getTermDiagSnapshot,
  installTermDiag,
  uninstallTermDiag,
  _resetTermDiagForTest,
} from '../src/utils/termDiag.js';

describe('termDiag', () => {
  beforeEach(() => _resetTermDiagForTest());

  it('counters accumulate and unknown names are ignored', () => {
    diagCount('trimCount');
    diagCount('trimCount', 2);
    diagCount('resyncCount');
    diagCount('nonexistent');
    const snap = getTermDiagSnapshot();
    assert.strictEqual(snap.trimCount, 3);
    assert.strictEqual(snap.resyncCount, 1);
    assert.strictEqual(snap.nonexistent, undefined);
  });

  it('longtaskCount batch increment (PerformanceObserver 路径形态) and resyncCount semantics', () => {
    // longtask observer 一次回调可能带多条 entry：diagCount(name, n) 批量累加
    diagCount('longtaskCount', 3);
    diagCount('longtaskCount');
    // data-resync 每次触发计 1（TerminalPanel/ScratchTerminal 两处接线同此语义）
    diagCount('resyncCount');
    diagCount('resyncCount');
    const snap = getTermDiagSnapshot();
    assert.strictEqual(snap.longtaskCount, 4);
    assert.strictEqual(snap.resyncCount, 2);
  });

  it('gauges set and round in snapshot; non-number values ignored', () => {
    diagSet('writeQPendingBytes', 1234.6);
    diagSet('chunkSize', 16384);
    diagSet('chunkSize', 'oops');
    const snap = getTermDiagSnapshot();
    assert.strictEqual(snap.writeQPendingBytes, 1235);
    assert.strictEqual(snap.chunkSize, 16384);
  });

  it('ewma: first sample adopted, then converges toward new samples', () => {
    const v1 = diagEwma('cbLatencyEwma', 10);
    assert.strictEqual(v1, 10);
    const v2 = diagEwma('cbLatencyEwma', 20, 0.5);
    assert.strictEqual(v2, 15);
    assert.strictEqual(diagEwma('unknown', 5), 0);
  });

  it('snapshot includes promptDetect stats fields', () => {
    const snap = getTermDiagSnapshot();
    for (const key of ['detectCalls', 'detectLastMs', 'detectMaxMs', 'detectOverruns']) {
      assert.strictEqual(typeof snap[key], 'number', `${key} present`);
    }
  });

  it('installTermDiag is a no-op without window (node env), uninstall safe', () => {
    installTermDiag();
    installTermDiag(); // 幂等
    uninstallTermDiag();
    uninstallTermDiag();
    assert.ok(true, 'no throw in node environment');
  });
});
