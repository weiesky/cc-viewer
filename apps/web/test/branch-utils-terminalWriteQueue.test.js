/**
 * TerminalWriteQueue 分支补盲单测
 *
 * 现有 test/terminal-write-queue.test.js 已覆盖主路径（push/flush/surrogate/trim 等），
 * 本文件专攻全量报告里未命中的防御性 / 错误路径分支：
 *   - _flush 在 unmounted 下被直接调用的早退（L102）
 *   - _flush 写 TRIM_NOTICE 时 term.write 抛错的 catch（L111）
 *   - GC 第二条件分支：head>8 且 head*2>queue.length（L167-169 右臂单独命中）
 *   - drain 在 dispose 后早退（L183）
 *   - drain 在 term 为 null 时早退（L185）
 *   - drain 写 TRIM_NOTICE 抛错的 catch（L189）
 *   - drain 队列已空（仅 trim 标记）时早退（L191）
 *   - drain 消费中项 offset>0 的 slice 分支（L195）
 *   - drain 最终 write 抛错的 catch（L200）
 *   - reset 在 dispose 后早退（L209）
 *
 * 加载方式：先静态 import 注册 vite-loader hooks，再动态 import 目标模块。
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let TerminalWriteQueue;

before(async () => {
  ({ TerminalWriteQueue } = await import('../src/utils/terminalWriteQueue.js'));
});

// ==== 夹具：mock requestAnimationFrame + xterm ====

let _rafQueue;
let _rafNextId;
let _origRAF;
let _origCAF;

function setupRAF() {
  _rafQueue = new Map();
  _rafNextId = 1;
  _origRAF = globalThis.requestAnimationFrame;
  _origCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    const id = _rafNextId++;
    _rafQueue.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    _rafQueue.delete(id);
  };
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

function flushAllFrames(maxFrames = 300) {
  let frames = 0;
  while (_rafQueue.size > 0 && frames < maxFrames) {
    flushOneFrame();
    frames++;
  }
  return frames;
}

/**
 * 可配置 mock terminal：
 *   - throwModes: 'trim' → 写 TRIM_NOTICE（以 \x18 开头）时抛
 *                 'all'  → 任意 write 都抛
 *                 null   → 不抛
 */
function makeTerminal(opts = {}) {
  const writes = [];
  let throwMode = opts.throwMode || null;
  return {
    writes,
    write(data) {
      if (throwMode === 'all') throw new Error('mock xterm throw all');
      if (throwMode === 'trim' && typeof data === 'string' && data.startsWith('\x18')) {
        throw new Error('mock xterm throw on trim notice');
      }
      writes.push(data);
    },
    setThrowMode(m) { throwMode = m; },
    receivedString() { return writes.join(''); },
  };
}

const MB = 1024 * 1024;

describe('TerminalWriteQueue 分支补盲', { concurrency: false }, () => {
  let term;
  let q;

  beforeEach(() => {
    setupRAF();
    term = makeTerminal();
    q = new TerminalWriteQueue(() => term);
  });

  afterEach(() => {
    q.dispose();
    teardownRAF();
  });

  it('_flush 在 dispose 后被直接调用时早退（L102 unmounted return）', () => {
    q.push('data');
    q.dispose();              // _unmounted=true，rAF 已取消
    // 直接戳 _flush（模拟极端时序：rAF 回调已排程但 dispose 抢先）
    q._flush();
    assert.equal(term.writes.length, 0, 'unmounted 下 _flush 不应写');
  });

  it('_flush 写 TRIM_NOTICE 抛错：保留标记、下帧重试（L111 catch）', () => {
    term.setThrowMode('trim');
    q.push('a'.repeat(MB));
    q.push('b'.repeat(MB));
    q.push('c'.repeat(MB));   // 触发 trim → _trimmedSinceFlush=true
    flushOneFrame();          // 第一帧：写 TRIM_NOTICE 抛错被 catch 吞掉，标记保留
    // 提示行没成功写出（被抛），数据 chunk 仍照常写
    assert.ok(!term.receivedString().includes('output trimmed'),
      '第一帧 notice 抛错不应进入 writes');
    // 恢复 term，后续帧应重新尝试写出提示
    term.setThrowMode(null);
    flushAllFrames();
    assert.ok(term.receivedString().includes('output trimmed'),
      'catch 后标记保留，恢复后下帧补写提示');
  });

  it('GC 第二条件命中：head>8 且 head*2>queue.length（L169 右臂）', () => {
    // 构造：队列项数固定，逐帧消费到 head>8 且 head*2>length，但 head 不超过 64。
    // 每项很小（单帧可吞多项），但要让每帧只前进 1 项 → 让每项 = CHUNK_SIZE 整。
    // 推 18 项各 32KB：每帧消费 1 项（恰好一个 chunk），head 递增。
    // 当 head=9 时：9>8 且 9*2=18 > 剩余 length。slice 触发后 head 归 0。
    const chunk = 'z'.repeat(TerminalWriteQueue.CHUNK_SIZE);
    for (let i = 0; i < 12; i++) q.push(chunk);
    const frames = flushAllFrames();
    // 12 项 * 32KB 全部写出，无丢失
    assert.equal(term.receivedString().length, 12 * TerminalWriteQueue.CHUNK_SIZE);
    assert.ok(frames >= 12, `应至少 12 帧逐项消费, got ${frames}`);
    // 验证 GC 后队列仍可用
    q.push('tail');
    flushAllFrames();
    assert.equal(term.receivedString().slice(-4), 'tail');
  });

  it('drain 在 dispose 后早退（L183 unmounted return）', () => {
    q.push('x');
    q.dispose();
    q.drain();                // _unmounted → 立即 return
    assert.equal(term.writes.length, 0, 'dispose 后 drain 不写');
  });

  it('drain 在 term 为 null 时早退（L185 !term return）', () => {
    let termInstance = null;
    const dynQ = new TerminalWriteQueue(() => termInstance);
    dynQ.push('data');
    dynQ.drain();             // getTerminal()→null → return
    // 没有 term 可写，断言不抛即可
    assert.equal(_rafQueue.size, 1, 'push 已排程 rAF，drain 不影响它');
    dynQ.dispose();
  });

  it('drain 写 TRIM_NOTICE 抛错被吞（L189 catch），后续数据仍尝试排空', () => {
    // 让 trim notice 抛、普通 chunk 写正常
    term.setThrowMode('trim');
    q.push('a'.repeat(MB));
    q.push('b'.repeat(MB));
    q.push('c'.repeat(MB));   // 触发 trim，rAF 尚未跑
    q.drain();                // 同步排空：先写 notice（抛被吞）→ 再写剩余数据
    // notice 抛掉了，但最新数据 'c' 仍被排空写出
    assert.ok(term.receivedString().includes('c'), 'notice 抛错不阻断后续排空');
    assert.ok(!term.receivedString().includes('output trimmed'), 'notice 未成功写出');
  });

  it('drain 队列已空但有 trim 标记：写完提示后 head>=length 早退（L191 return）', () => {
    // 用极小水位制造 trim，然后 flush 把数据全部消费掉、只留 trim 标记，再 drain。
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 100, trimTargetBytes: 50 });
    smallQ.push('a'.repeat(80));
    smallQ.push('b'.repeat(80));   // 越线 trim，_trimmedSinceFlush=true
    flushAllFrames();              // _flush 写 notice + 数据，队列消费空
    const before = term.writes.length;
    smallQ.drain();               // 标记已被 flush 清掉、队列空 → head>=length 早退
    assert.equal(term.writes.length, before, 'drain 在空队列+无标记下不再写');
    smallQ.dispose();
  });

  it('drain 排空消费中项 offset>0（L195 head.slice(offset) 分支）', () => {
    // 推一个 40KB 项，flush 一帧消费 32KB → 留 offset=32768 的部分项
    q.push('p'.repeat(40 * 1024));
    flushOneFrame();
    assert.equal(q._offset > 0, true, '应留有 offset>0 的部分项');
    const consumedBefore = term.receivedString().length;
    q.drain();                // drain 走 offset>0 的 slice 分支排空剩余 ~8KB
    assert.equal(term.receivedString().length, 40 * 1024, 'drain 排空剩余部分项');
    assert.ok(term.receivedString().length > consumedBefore);
  });

  it('drain 最终 write 抛错被吞（L200 catch），不向外抛', () => {
    q.push('hello');
    q.push('world');
    term.setThrowMode('all');  // drain 的合并 write 抛
    assert.doesNotThrow(() => q.drain(), 'drain 在 write 抛错时静默吞掉');
    assert.equal(term.writes.length, 0, '抛掉的 write 不进 writes');
  });

  it('reset 在 dispose 后早退（L209 unmounted return）', () => {
    q.push('data');
    q.dispose();
    // dispose 已清空队列；reset 应直接 return，不抛
    assert.doesNotThrow(() => q.reset());
    assert.equal(q._pendingBytes(), 0);
  });
});
