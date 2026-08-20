/**
 * TerminalWriteQueue 消化力自适应（AIMD + callback 记账）单测
 *
 * 覆盖：
 *   - 慢回调（>24ms）chunk 减半收敛到 CHUNK_MIN
 *   - 快回调（<8ms ×3）chunk 步进回升到 CHUNK_SIZE 上限
 *   - 软背压：outstanding > 2×chunk 跳帧（仍续约 rAF），fail-open 500ms 后恢复写
 *   - 门控前置条件：从未观察到 callback（mock 不回调）→ 行为与旧实现完全一致
 *   - reset/dispose 后旧 epoch callback 被丢弃（不串台、不出错）
 *   - 构造签名向后兼容 + initialChunkBytes 钳制
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalWriteQueue } from '../src/utils/terminalWriteQueue.js';

const CHUNK_MAX = TerminalWriteQueue.CHUNK_SIZE;   // 32KB
const CHUNK_MIN = TerminalWriteQueue.CHUNK_MIN;    // 4KB
const FAIL_OPEN_MS = TerminalWriteQueue.CB_FAIL_OPEN_MS;

// ── mock rAF（与 terminal-write-queue.test.js 同款）──
let _rafQueue, _rafNextId, _origRAF, _origCAF;
function setupRAF() {
  _rafQueue = new Map();
  _rafNextId = 1;
  _origRAF = globalThis.requestAnimationFrame;
  _origCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { const id = _rafNextId++; _rafQueue.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = (id) => { _rafQueue.delete(id); };
}
function teardownRAF() {
  globalThis.requestAnimationFrame = _origRAF;
  globalThis.cancelAnimationFrame = _origCAF;
}
function flushOneFrame() {
  const callbacks = [..._rafQueue.values()];
  _rafQueue.clear();
  for (const cb of callbacks) cb();
}

// ── mock 时钟（performance.now 可控推进）──
let _mockNow, _origPerfNow;
function setupClock() {
  _mockNow = 1000;
  _origPerfNow = globalThis.performance.now;
  globalThis.performance.now = () => _mockNow;
}
function teardownClock() {
  globalThis.performance.now = _origPerfNow;
}
function advance(ms) { _mockNow += ms; }

// ── mock xterm：write(data, cb) 暂存 cb，由测试控制回调时机 ──
function makeCbTerminal() {
  const writes = [];
  const pendingCbs = [];
  return {
    writes,
    pendingCbs,
    write(data, cb) {
      writes.push(data);
      if (cb) pendingCbs.push(cb);
    },
    // 推进 dt 毫秒后回调最早一笔 write
    ackOne(dt) {
      advance(dt);
      const cb = pendingCbs.shift();
      if (cb) cb();
    },
  };
}

describe('TerminalWriteQueue adaptive feeding', { concurrency: false }, () => {
  let term;
  let q;

  beforeEach(() => {
    setupRAF();
    setupClock();
    term = makeCbTerminal();
  });
  afterEach(() => {
    if (q) { q.dispose(); q = null; }
    teardownRAF();
    teardownClock();
  });

  it('slow callbacks (>24ms) halve chunk down to CHUNK_MIN', () => {
    q = new TerminalWriteQueue(() => term);
    q.push('x'.repeat(300 * 1024));
    flushOneFrame();
    assert.equal(term.writes[0].length, CHUNK_MAX, 'first chunk at初值 32KB');
    // 连续慢回调：32K→16K→8K→4K→4K（floor）
    const expected = [16 * 1024, 8 * 1024, 4 * 1024, 4 * 1024];
    for (const want of expected) {
      term.ackOne(30);
      flushOneFrame();
      assert.equal(term.writes[term.writes.length - 1].length, want, `chunk shrinks to ${want}`);
    }
  });

  it('fast callbacks (<8ms x3) step chunk up to CHUNK_MAX cap', () => {
    q = new TerminalWriteQueue(() => term, { initialChunkBytes: CHUNK_MIN });
    // 数据量须覆盖爬坡全程：3×(4+8+...+32)KB + 若干 32KB 帧 ≈ 624KB，给足 1MB（低于 2MB trim 水位）
    q.push('x'.repeat(1024 * 1024));
    flushOneFrame();
    assert.equal(term.writes[0].length, CHUNK_MIN);
    // 每 3 次快回调 +4KB：4K → 8K → … → 32K（cap 后稳定）
    let lastSize = CHUNK_MIN;
    for (let step = 0; step < 10; step++) {
      for (let i = 0; i < 3; i++) {
        term.ackOne(2);
        flushOneFrame();
      }
      lastSize = term.writes[term.writes.length - 1].length;
    }
    assert.equal(lastSize, CHUNK_MAX, 'converges to 32KB cap');
  });

  it('soft backpressure: skip frames while outstanding > 2*chunk, fail-open after 500ms', () => {
    q = new TerminalWriteQueue(() => term);
    q.push('x'.repeat(500 * 1024));
    flushOneFrame();           // w1 (outstanding 32K)
    term.ackOne(10);           // cb 正常 → _cbSeen=true（10ms 中性区不调 chunk）
    flushOneFrame();           // w2 (32K)
    flushOneFrame();           // w3 (64K) — 此后 outstanding 64K = 2×32K 未超
    flushOneFrame();           // w4 → outstanding 96K > 64K?  w4 前检查 64K>64K=false → 写出
    const writesBeforeSkip = term.writes.length;
    flushOneFrame();           // outstanding 96K > 64K → 跳帧（无新 write，rAF 已续约）
    assert.equal(term.writes.length, writesBeforeSkip, 'frame skipped, no new write');
    assert.ok(_rafQueue.size > 0, 'rAF re-scheduled during skip');
    flushOneFrame();           // 仍在 500ms 内 → 继续跳
    assert.equal(term.writes.length, writesBeforeSkip);
    advance(FAIL_OPEN_MS + 1); // callback 失联超时
    flushOneFrame();           // fail-open：清账恢复写
    assert.equal(term.writes.length, writesBeforeSkip + 1, 'fail-open resumes writing');
  });

  it('no callback ever (legacy mock terminal): behavior identical to old impl', () => {
    const writes = [];
    const legacyTerm = { write(data) { writes.push(data); } }; // 不接收/不回调 cb
    q = new TerminalWriteQueue(() => legacyTerm);
    q.push('x'.repeat(200 * 1024));
    let frames = 0;
    while (_rafQueue.size > 0 && frames < 50) { flushOneFrame(); frames++; }
    assert.equal(writes.reduce((s, w) => s + w.length, 0), 200 * 1024, 'all bytes written');
    assert.ok(writes.every(w => w.length <= CHUNK_MAX), 'chunking unchanged');
    assert.equal(frames, Math.ceil(200 / 32), 'frame count = ceil(200KB/32KB), no skips');
  });

  it('reset(): old epoch callback discarded, chunk resets to initial, in-flight rAF cancelled', () => {
    q = new TerminalWriteQueue(() => term);
    q.push('x'.repeat(100 * 1024));
    flushOneFrame();                  // w1, cb 在途
    const staleCb = term.pendingCbs.shift();
    q.reset();
    assert.equal(_rafQueue.size, 0, 'in-flight rAF cancelled by reset');
    advance(30);
    staleCb();                        // 旧 epoch 回调 → 应被丢弃
    q.push('y'.repeat(50 * 1024));
    flushOneFrame();
    const lastWrite = term.writes[term.writes.length - 1];
    // 复位到构造初值（默认 32KB）：若旧 epoch 慢回调被误采纳会缩到 16KB
    assert.equal(lastWrite.length, CHUNK_MAX, 'chunk reset to initial (stale slow-cb did not shrink)');
    assert.ok(lastWrite.startsWith('y'), 'queue content reset');
  });

  it('reset() 复位到平台初值而非 MIN：Windows 16KB 构造 → 缩到 4KB 后 reset 回 16KB', () => {
    q = new TerminalWriteQueue(() => term, { initialChunkBytes: 16 * 1024 });
    q.push('x'.repeat(200 * 1024));
    flushOneFrame();
    assert.equal(term.writes[0].length, 16 * 1024, 'starts at Windows-conservative 16KB');
    term.ackOne(30); flushOneFrame();  // 16K → 8K
    term.ackOne(30); flushOneFrame();  // 8K → 4K
    assert.equal(term.writes[term.writes.length - 1].length, CHUNK_MIN, 'shrunk to floor');
    q.reset();
    q.push('y'.repeat(50 * 1024));
    flushOneFrame();
    assert.equal(term.writes[term.writes.length - 1].length, 16 * 1024, 'reset restores initial, not MIN');
  });

  it('dispose(): stale callback after dispose is a no-op (no throw)', () => {
    q = new TerminalWriteQueue(() => term);
    q.push('x'.repeat(40 * 1024));
    flushOneFrame();
    const staleCb = term.pendingCbs.shift();
    q.dispose();
    assert.doesNotThrow(() => staleCb());
    q = null;
  });

  it('constructor back-compat: no opts → 32KB; initialChunkBytes clamped to [MIN, MAX]', () => {
    const q1 = new TerminalWriteQueue(() => term);
    assert.equal(q1._chunkSize, CHUNK_MAX);
    const q2 = new TerminalWriteQueue(() => term, { initialChunkBytes: 1 });
    assert.equal(q2._chunkSize, CHUNK_MIN, 'clamped up to MIN');
    const q3 = new TerminalWriteQueue(() => term, { initialChunkBytes: 10 * 1024 * 1024 });
    assert.equal(q3._chunkSize, CHUNK_MAX, 'clamped down to MAX');
    const q4 = new TerminalWriteQueue(() => term, { initialChunkBytes: 16 * 1024 });
    assert.equal(q4._chunkSize, 16 * 1024);
    q1.dispose(); q2.dispose(); q3.dispose(); q4.dispose();
  });

  it('write throw still rolls back pointers and outstanding accounting', () => {
    let threw = false;
    const throwingTerm = {
      writes: [],
      write(data, cb) {
        if (!threw && this.writes.length === 1) { threw = true; throw new Error('mock'); }
        this.writes.push(data);
        if (cb) cb();
      },
    };
    q = new TerminalWriteQueue(() => throwingTerm);
    q.push('x'.repeat(64 * 1024));
    flushOneFrame();                          // w1 ok（cb 同步回调 → _cbSeen=true）
    flushOneFrame();                          // w2 throw → 回滚，rAF 停续约
    assert.equal(throwingTerm.writes.length, 1);
    assert.equal(q._outstanding, 0, 'outstanding rolled back on throw');
    q.push('y');                              // 重新触发
    flushOneFrame();                          // 重试 x 的剩余 32KB
    flushOneFrame();                          // 写 'y'
    assert.equal(
      throwingTerm.writes.reduce((s, w) => s + w.length, 0),
      64 * 1024 + 1,
      'no data lost after throw-rollback-retry'
    );
  });
});
