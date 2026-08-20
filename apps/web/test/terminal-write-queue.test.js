/**
 * TerminalWriteQueue 单测
 *
 * 覆盖：
 *   - 基本 push + flush 节奏（每帧 1 chunk ≤32KB）
 *   - O(n²) 修复：单 1MB push 不会复制大字符串
 *   - UTF-16 surrogate 边界守卫（4 种 case）
 *   - terminal.write 抛异常时 head/offset 回滚 + 不死循环
 *   - drain 同步排空所有剩余字节
 *   - dispose 后 push 静默忽略
 *   - 空字符串 / 非 string 输入静默忽略
 *   - queue 头部周期压缩
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalWriteQueue, INBAND_RESET } from '../src/utils/terminalWriteQueue.js';

// ==== 测试夹具：mock requestAnimationFrame + xterm ====

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
  // 取出当前队列里所有待 callback 一次性触发（rAF 一帧的语义）
  const callbacks = [..._rafQueue.values()];
  _rafQueue.clear();
  for (const cb of callbacks) cb();
}

function flushAllFrames(maxFrames = 100) {
  let frames = 0;
  while (_rafQueue.size > 0 && frames < maxFrames) {
    flushOneFrame();
    frames++;
  }
  return frames;
}

function makeTerminal() {
  const writes = [];
  let throwOn = null;
  return {
    writes,
    write(data) {
      if (throwOn != null && writes.length === throwOn) {
        throwOn = null;
        throw new Error('mock xterm throw');
      }
      writes.push(data);
    },
    setThrowOn(n) { throwOn = n; },
    receivedString() { return writes.join(''); },
    receivedBytes() { return writes.reduce((s, w) => s + w.length, 0); },
  };
}

describe('TerminalWriteQueue', { concurrency: false }, () => {
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

  it('小 push 一帧合并到一次 write', () => {
    q.push('hello ');
    q.push('world');
    flushOneFrame();
    assert.equal(term.writes.length, 1);
    assert.equal(term.writes[0], 'hello world');
  });

  it('1MB 单次 push：每帧 1 个 32KB chunk，~32 帧吃完，无 O(n²)', () => {
    const big = 'x'.repeat(1024 * 1024);
    q.push(big);
    const frames = flushAllFrames(200);
    // 32KB / 帧 → ceil(1MB / 32KB) = 32 帧
    assert.ok(frames >= 32 && frames <= 33, `expected ~32 frames, got ${frames}`);
    // 每帧 write 一次（除了最后一帧 +1）
    assert.equal(term.receivedBytes(), big.length, 'bytes received != bytes pushed');
    assert.equal(term.receivedString(), big);
    // 每条 write 都 ≤ CHUNK_SIZE
    for (const w of term.writes) {
      assert.ok(w.length <= TerminalWriteQueue.CHUNK_SIZE);
    }
  });

  it('多个小 push 跨 chunk 边界保持顺序', () => {
    // 凑出 65KB（2 个 chunk + 余）
    const a = 'a'.repeat(20000);
    const b = 'b'.repeat(20000);
    const c = 'c'.repeat(25000);
    q.push(a);
    q.push(b);
    q.push(c);
    flushAllFrames();
    assert.equal(term.receivedString(), a + b + c);
  });

  it('UTF-16 surrogate: emoji 跨 32KB 边界不切碎', () => {
    // 在 CHUNK_SIZE-1 位置放一个 emoji（surrogate pair 占 2 code unit）
    const filler = 'x'.repeat(TerminalWriteQueue.CHUNK_SIZE - 1);
    const emoji = '🚀';   // U+1F680, surrogate pair
    const rest = 'tail';
    q.push(filler + emoji + rest);
    flushAllFrames();
    assert.equal(term.receivedString(), filler + emoji + rest);
    // 关键：emoji 不应被切成两半 —— 任何 write 里不能有孤立高代理
    for (const w of term.writes) {
      for (let i = 0; i < w.length; i++) {
        const code = w.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
          // 高代理后必须紧跟低代理
          const next = w.charCodeAt(i + 1);
          assert.ok(
            next >= 0xDC00 && next <= 0xDFFF,
            `lone high surrogate at write[${i}]: ${code.toString(16)}`,
          );
        }
      }
    }
  });

  it('UTF-16 surrogate: emoji 恰好在 CHUNK_SIZE 位置（cut 落在高代理后）', () => {
    // filler 长 32766（CHUNK_SIZE - 2），加 1 个 emoji 占 2 → 总长 32768 == CHUNK_SIZE
    // 第二条 push 接 'tail' → 整体 surrogate pair 在第一段 chunk 的最后
    const filler = 'x'.repeat(TerminalWriteQueue.CHUNK_SIZE - 2);
    const emoji = '😀';
    const tail = 'tail';
    q.push(filler + emoji);
    q.push(tail);
    flushAllFrames();
    assert.equal(term.receivedString(), filler + emoji + tail);
  });

  it('UTF-16 surrogate: 单字符 push 是孤立高代理（数据本身坏）— 也不死循环', () => {
    // 极端：单 1-char string，charCode 在 D800-DBFF（孤立高代理）
    const lone = String.fromCharCode(0xD83D);  // 高代理本体（无低代理跟）
    q.push(lone);
    q.push('after');
    flushAllFrames();
    // 应当尽量发出去，xterm 自己会容错；不能死循环
    assert.equal(term.receivedString(), lone + 'after');
  });

  it('terminal.write 抛异常 → 回滚 head/offset，停续约 rAF，下次 push 继续', () => {
    term.setThrowOn(0);  // 第 0 次 write 抛
    q.push('first');
    flushOneFrame();
    // write 抛错 → 指针回滚到消费前，数据保留待重试；rAF 不再续约
    assert.equal(_rafQueue.size, 0, '抛错后不应再续约 rAF');
    assert.equal(term.writes.length, 0, '抛错的 write 不应进入 writes');

    // 下次 push 重新触发 rAF：抛错帧的数据重组重试，不丢失
    // （原实现指针快照误在消费循环后，抛错即丢该 chunk——与源码回滚契约相反，已修正）
    q.push('second');
    flushAllFrames();
    assert.equal(term.receivedString(), 'firstsecond');
  });

  it('drain 同步排空 buffer，无需 rAF', () => {
    q.push('a');
    q.push('b');
    assert.equal(term.writes.length, 0);  // 还没 rAF 触发
    q.drain();
    assert.equal(term.receivedString(), 'ab');
    assert.equal(_rafQueue.size, 1, 'drain 不取消已排队的 rAF');
    flushAllFrames();
    // rAF 触发时 buffer 已空，无新 write
    assert.equal(term.writes.length, 1);
  });

  it('drain 在 1MB 数据下能一次写完（unmount 路径）', () => {
    const big = 'y'.repeat(1024 * 1024);
    q.push(big);
    q.drain();
    assert.equal(term.receivedString(), big);
  });

  it('dispose 后 push 静默忽略', () => {
    q.push('before');
    q.dispose();
    q.push('after');
    flushAllFrames();
    assert.equal(term.writes.length, 0, 'dispose 后不应再有 write');
  });

  it('dispose 取消已排队的 rAF', () => {
    q.push('x');
    assert.equal(_rafQueue.size, 1);
    q.dispose();
    assert.equal(_rafQueue.size, 0);
  });

  it('空字符串 / 非 string 输入静默忽略', () => {
    q.push('');
    q.push(null);
    q.push(undefined);
    q.push(123);
    q.push({});
    flushAllFrames();
    assert.equal(term.writes.length, 0);
  });

  it('queue 头部消费过多时压缩，不无限增长', () => {
    // 推 100 个小 chunk 然后逐帧消费
    for (let i = 0; i < 100; i++) q.push('x'.repeat(100));
    flushAllFrames();
    // 100 chunks × 100 字节 = 10KB，单帧吃完（< CHUNK_SIZE）
    assert.equal(term.receivedBytes(), 10000);
    // queue 内部已被压缩（不直接读私有字段，验证后续 push 还能正常工作）
    q.push('after');
    flushAllFrames();
    assert.equal(term.receivedString().slice(-5), 'after');
  });

  it('terminal getter 返回 null 时不 write 不死循环', () => {
    let termInstance = term;
    const dynQ = new TerminalWriteQueue(() => termInstance);
    dynQ.push('hello');
    termInstance = null;  // 模拟 dispose 中途
    flushAllFrames();
    assert.equal(term.writes.length, 0);
    // 即使 terminal 没了，dynQ 不应死循环
    assert.equal(_rafQueue.size, 0);
    dynQ.dispose();
  });
});

describe('TerminalWriteQueue 积压自保（trim）', { concurrency: false }, () => {
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

  it('积压超 HIGH_WATER 时丢最旧整项，回落到 TRIM_TARGET 以下', () => {
    // 推 3 个 1MB 项（共 3MB > 2MB 高水位）
    const mb = 1024 * 1024;
    q.push('a'.repeat(mb));
    q.push('b'.repeat(mb));
    q.push('c'.repeat(mb));
    // 最新项永不丢 → trim 后剩恰好最新的 1MB（'a'/'b' 整项丢弃）
    assert.equal(q._pendingBytes(), mb,
      `pending ${q._pendingBytes()} should be exactly the newest item after trim`);
    // 最旧的 'a'/'b' 被丢、最新的 'c' 保留（丢旧保新）
    flushAllFrames(200);
    const received = term.receivedString();
    assert.ok(!received.includes('a'), 'oldest item should be dropped');
    assert.ok(received.includes('c'), 'newest item should survive');
  });

  it('丢弃后下一帧先写 TRIM_NOTICE（以 \\x18 开头）', () => {
    const mb = 1024 * 1024;
    q.push('a'.repeat(mb));
    q.push('b'.repeat(mb));
    q.push('c'.repeat(mb));
    flushOneFrame();
    assert.equal(term.writes[0], TerminalWriteQueue.TRIM_NOTICE);
    assert.ok(term.writes[0].startsWith('\x18'), 'notice must start with CAN to abort half escape seq');
    assert.ok(term.writes[0].includes('output trimmed'));
    // 提示只写一次
    flushAllFrames(200);
    const noticeCount = term.writes.filter(w => w === TerminalWriteQueue.TRIM_NOTICE).length;
    assert.equal(noticeCount, 1);
  });

  it('INBAND_RESET 形状:BEL+CAN 脱困在前,且不含任何清 scrollback 序列(保历史)', () => {
    assert.equal(INBAND_RESET, '\x07\x18\x1b[2J\x1b[H\x1b[!p');
    assert.ok(INBAND_RESET.startsWith('\x07\x18'), 'BEL+CAN 打头——零残片防线靠这两字节中止半截序列');
    // 关键回归守卫:绝不能含 RIS(\x1bc) 或 ED3(\x1b[3J)——它们会清 scrollback,正是"只剩一页"病根。
    assert.ok(!INBAND_RESET.includes('\x1bc'), '不得含 RIS(\\x1bc):会清 scrollback');
    assert.ok(!INBAND_RESET.includes('\x1b[3J'), '不得含 ED3(\\x1b[3J):会清 scrollback');
  });

  it('TRIM_NOTICE 形状:CAN 开头,?2026l 先于可见提示(防 DEC 2026 配对撕裂)', () => {
    const n = TerminalWriteQueue.TRIM_NOTICE;
    assert.ok(n.startsWith('\x18'), 'CAN first to abort half escape seq');
    const idx2026 = n.indexOf('\x1b[?2026l');
    assert.ok(idx2026 !== -1, 'notice must contain DEC 2026 exit sequence');
    assert.ok(idx2026 < n.indexOf('output trimmed'), '?2026l must precede visible text');
  });

  it('配对撕裂:?2026h 已写出、含 ?2026l 的项被 trim 丢弃 → 交付流在后续内容前补 ?2026l(免 1s 超时停顿)', () => {
    const mb = 1024 * 1024;
    // h 项:首帧 32KB 已把 ?2026h 写给 xterm
    q.push('\x1b[?2026h' + 'a'.repeat(mb));
    flushOneFrame();
    assert.ok(term.receivedString().includes('\x1b[?2026h'), 'precondition: h delivered');
    // l 项随后被洪泛 trim 丢弃(丢旧保新):h/l 配对撕裂
    q.push('b'.repeat(mb) + '\x1b[?2026l');
    q.push('c'.repeat(mb));
    q.push('d'.repeat(mb));
    flushAllFrames(400);
    const received = term.receivedString();
    const hIdx = received.indexOf('\x1b[?2026h');
    const lIdx = received.indexOf('\x1b[?2026l');
    const tailIdx = received.indexOf('ddd');   // 'd'/'b' 单字符会误匹配 NOTICE 文本(trimmed/behind)
    assert.ok(!received.includes('bbb'), 'item carrying the original ?2026l was dropped');
    assert.ok(lIdx !== -1 && lIdx > hIdx, 'notice supplies a ?2026l after the orphan h');
    assert.ok(tailIdx !== -1 && lIdx < tailIdx, '?2026l must arrive before post-trim content renders');
  });

  it('trim 撕裂防护：被丢项以半截序列结尾 → 新 head 项的孤儿尾巴不按字面交付（锚点推进）', () => {
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 1000, trimTargetBytes: 300 });
    // 项 A 以半截真彩 SGR 结尾，项 B 以它的尾巴开头（PTY 分块切断场景）
    smallQ.push('a'.repeat(600) + '\x1b[38;2;1');
    smallQ.push('02;145;178mREAL\x1b[0m' + 'b'.repeat(600));   // 越线 → 丢 A 整项
    flushAllFrames(200);
    const received = term.receivedString();
    assert.ok(!received.includes('02;145;178m'), '孤儿参数尾巴不得按字面交付');
    assert.ok(received.includes('\x1b[0m'), '锚点（B 项内下一个 ESC）之后的内容完整保留');
    smallQ.dispose();
  });

  it('trim 撕裂防护：新 head 项无 ESC 有 LF → 推进到首个 LF 之后', () => {
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 1000, trimTargetBytes: 300 });
    smallQ.push('a'.repeat(600) + '\x1b[38;2;1');
    smallQ.push('02;145m-tail\nclean line\n' + 'b'.repeat(600));
    flushAllFrames(200);
    const received = term.receivedString();
    assert.ok(!received.includes('02;145m'), '孤儿尾巴不交付');
    assert.ok(received.includes('clean line'), 'LF 之后内容保留');
    smallQ.dispose();
  });

  it('trim 撕裂防护：新 head 项纯文本无锚点 → offset 保持 0 全量交付（无撕裂风险不丢数据）', () => {
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 1000, trimTargetBytes: 300 });
    smallQ.push('a'.repeat(600));
    smallQ.push('plain'.repeat(130));   // 650 字节纯文本，无 ESC/LF
    flushAllFrames(200);
    assert.ok(term.receivedString().includes('plain'.repeat(130)), '纯文本项全量保留');
    smallQ.dispose();
  });

  it('trim 撕裂防护：新 head 项以孤立低代理开头且无锚点 → 跳过 1 字符', () => {
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 1000, trimTargetBytes: 300 });
    const emoji = '😀';
    smallQ.push('a'.repeat(600) + emoji[0]);            // 高代理收尾（整项被丢）
    smallQ.push(emoji[1] + 'plain'.repeat(130));        // 低代理开头 + 纯文本无 ESC/LF
    flushAllFrames(200);
    const received = term.receivedString();
    assert.ok(!received.includes(emoji[1]), '孤立低代理不交付');
    assert.ok(received.includes('plain'.repeat(130)), '其余纯文本全量保留');
    smallQ.dispose();
  });

  it('1MB 单次 push 不触发 trim（防误伤 /resume 大流量）', () => {
    const big = 'x'.repeat(1024 * 1024);
    q.push(big);
    flushAllFrames(200);
    assert.equal(term.receivedString(), big, 'no data lost');
    assert.ok(!term.receivedString().includes('output trimmed'));
  });

  it('单项 >HIGH_WATER（3MB 超大快照）：最新项永不丢，且不得报假 trim 提示', () => {
    // 越过 2MB 高水位但队列只有一项 → 循环什么都没丢，不能给用户写
    // "output trimmed" 黄字（数据其实 100% 完整交付），trimCount 也不能脏
    const big = 'x'.repeat(3 * 1024 * 1024);
    q.push(big);
    flushAllFrames(200);
    assert.equal(term.receivedString(), big, 'oversized single item fully delivered');
    assert.ok(!term.receivedString().includes('output trimmed'), 'no false trim notice');
  });

  it('自定义 highWaterBytes 选项生效（移动端低水位）', () => {
    const smallQ = new TerminalWriteQueue(() => term, { highWaterBytes: 1000, trimTargetBytes: 300 });
    smallQ.push('a'.repeat(600));
    smallQ.push('b'.repeat(600));   // 1200 > 1000 → trim
    assert.ok(smallQ._pendingBytes() <= 300 + 600, 'trimmed by whole items down to target');
    flushAllFrames(200);
    assert.ok(!term.receivedString().includes('a'), 'oldest dropped under custom watermark');
    smallQ.dispose();
  });

  it('onTrim：实际丢弃整项时回调（调用方借此发 resync-request 请求快照对齐）', () => {
    let trims = 0;
    const smallQ = new TerminalWriteQueue(() => term, {
      highWaterBytes: 1000, trimTargetBytes: 300,
      onTrim: () => { trims++; },
    });
    smallQ.push('a'.repeat(600));
    assert.equal(trims, 0, '未越线不触发');
    smallQ.push('b'.repeat(600));   // 越线 → 丢 'a' 整项
    assert.equal(trims, 1, '实际丢弃触发一次');
    smallQ.dispose();
  });

  it('onTrim：单项超大（最新项永不丢）什么都没丢 → 不触发（与假 trim 提示同一守卫）', () => {
    let trims = 0;
    const smallQ = new TerminalWriteQueue(() => term, {
      highWaterBytes: 1000, trimTargetBytes: 300,
      onTrim: () => { trims++; },
    });
    smallQ.push('x'.repeat(5000));  // 单项越线但 length-1 守卫一项都不丢
    assert.equal(trims, 0);
    smallQ.dispose();
  });

  it('onTrim：回调抛异常不污染 push 路径，数据照常交付', () => {
    const smallQ = new TerminalWriteQueue(() => term, {
      highWaterBytes: 1000, trimTargetBytes: 300,
      onTrim: () => { throw new Error('callback boom'); },
    });
    smallQ.push('a'.repeat(600));
    smallQ.push('b'.repeat(600));   // 触发 trim，回调抛错被吞
    flushAllFrames(200);
    assert.ok(term.receivedString().includes('b'.repeat(600)), 'newest data still delivered');
    smallQ.dispose();
  });

  it('trim 只丢整项：消费中项（offset>0）的剩余部分按剩余字节计入', () => {
    // 先推一个 40KB 项并消费一帧（32KB），留 offset>0 的部分项
    q.push('p'.repeat(40 * 1024));
    flushOneFrame();
    // 再洪泛触发 trim
    const mb = 1024 * 1024;
    q.push('q'.repeat(mb));
    q.push('r'.repeat(mb));
    q.push('s'.repeat(mb));
    // trim 发生在 push('r') 越线时：丢 'p' 剩余部分 + 'q' 整项、保最新 'r'；
    // 之后 push('s') 时 pending 2MB 未再越线 → 'r'+'s' 都保留
    assert.equal(q._pendingBytes(), 2 * mb);
    flushAllFrames(200);
    // 不应出现半截 surrogate 之类的撕裂：整项丢弃语义下尾部数据完整
    assert.ok(term.receivedString().endsWith('s'), 'newest data fully delivered');
  });

  it('reset() 清空队列但保持可用', () => {
    q.push('old-data');
    q.reset();
    assert.equal(q._pendingBytes(), 0);
    flushAllFrames();
    assert.ok(!term.receivedString().includes('old-data'), 'reset discards pending data');
    q.push('new-data');
    flushAllFrames();
    assert.equal(term.receivedString(), 'new-data', 'queue still usable after reset');
  });

  it('trim 后 rAF 未跑即 drain（unmount）：提示行随排空写出', () => {
    const mb = 1024 * 1024;
    q.push('a'.repeat(mb));
    q.push('b'.repeat(mb));
    q.push('c'.repeat(mb));   // 触发 trim，rAF 尚未 flush
    q.drain();                // unmount 同步排空
    assert.equal(term.writes[0], TerminalWriteQueue.TRIM_NOTICE);
    assert.ok(term.receivedString().includes('c'), 'remaining data drained');
  });

  it('reset() 清掉 trim 标记，不再写提示', () => {
    const mb = 1024 * 1024;
    q.push('a'.repeat(mb));
    q.push('b'.repeat(mb));
    q.push('c'.repeat(mb));   // 触发 trim
    q.reset();                // resync 路径：标记一并清掉
    q.push('fresh');
    flushAllFrames();
    assert.equal(term.receivedString(), 'fresh');
  });
});
