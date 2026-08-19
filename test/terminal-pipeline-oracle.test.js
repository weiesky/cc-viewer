/**
 * 终端管线端到端 oracle 测试：系统化论证"乱码残片"问题类已根治。
 *
 * 不变量：xterm 解析器收到的字节流中，任何删除的续点都必须是新序列起点（锚点），
 * 任何解析器重置都必须与字节流同序（带内 INBAND_RESET）。残片 = 不变量被破坏。
 *
 * 组装真实模块（非 mock 逻辑）：
 *   服务端 createFloodCoalescer（真）+ createBackpressureGate（真）+
 *   findSafeSliceStart（真）+ pty-manager 同款 outputBuffer 滚动裁剪与 SYNC 包裹；
 *   客户端 TerminalWriteQueue（真）+ TerminalPanel 同款 data/data-resync 处理。
 * 裁判：忠实的 DEC VT 解析状态机（GROUND/ESC/CSI/OSC/DCS + CAN/BEL/ST/RIS/ED2 语义，
 *   RIS 与 ED2(\x1b[2J) 均清空可见文本；scrollback 保留契约由 terminal-scrollback-preserve.test.js 另测），
 *   输出"最终可见文本"。
 * 断言：可见文本的每一行 ∈ { 合法内容行, 已知提示行, 空行 }——任何序列残片
 *   （`[9m`/`2;8;145m`/`5C` 类）都会形成非法行而失败。
 *
 * 夹具与真实 server.js 接线的已知差异（有意简化，不影响不变量判定）：
 *   - bpGate（ws 反压门）未接入——其行为（跳发后 resume 快照对齐）与 onTruncate 路径
 *     同构，由"洪泛截断+快照对齐"与"send 抛错兜底"两场景等价覆盖；
 *   - resync-request 的客户端 2s 节流 / 服务端冷却未模拟——节流只降低 resync 频次，
 *     不影响单次 resync 的字节序正确性；
 *   - serverFeed 复刻 pty-manager.flushBatch 的缓带+SYNC 包裹（见该处注释的同步警告）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFloodCoalescer } from '../packages/app/server/lib/pty-flood-coalescer.js';
import { findSafeSliceStart, splitTrailingIncomplete } from '../packages/app/server/lib/ansi-safe-slice.js';
import { TerminalWriteQueue, INBAND_RESET } from '../apps/web/src/utils/terminalWriteQueue.js';

// ── 裁判：迷你 VT 解析器（xterm 状态机语义子集，足以判定"残片是否上屏"）──
function vtVisibleText(payloads) {
  let visible = '';
  let csiParams = '';
  let st = 'GROUND';
  const reprocessEsc = (ch) => { // OSC/DCS 中 ESC+非\ → 中止并按新 ESC 序列处理
    st = 'ESC';
    return stepEsc(ch);
  };
  const stepEsc = (ch) => {
    const c = ch.charCodeAt(0);
    if (ch === 'c') { visible = ''; st = 'GROUND'; return; } // RIS（历史；现 INBAND_RESET 已不含，仅防御保留）：清屏
    if (ch === '[') { st = 'CSI'; csiParams = ''; return; }
    if (ch === ']') { st = 'OSC'; return; }
    if (ch === 'P') { st = 'DCS'; return; }
    if (c === 0x1b) { st = 'ESC'; return; }
    if (c === 0x18) { st = 'GROUND'; return; }              // CAN 中止
    if (c >= 0x20 && c <= 0x2f) { return; }                 // 中间字节（charset 等），停留
    st = 'GROUND';                                          // 两字符转义收尾
  };
  for (const data of payloads) {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const c = data.charCodeAt(i);
      switch (st) {
        case 'GROUND':
          if (c === 0x1b) st = 'ESC';
          else if (c === 0x0a) visible += '\n';
          else if (c === 0x0d || c === 0x07 || c === 0x18) { /* CR/BEL/CAN：无可见输出 */ }
          else if (c >= 0x20 || c >= 0xd800) visible += ch; // 可打印（含代理对单元）
          break;
        case 'ESC':
          stepEsc(ch);
          break;
        case 'CSI':
          if (c === 0x1b) st = 'ESC';                       // ESC 中止 CSI
          else if (c === 0x18) st = 'GROUND';               // CAN 中止
          else if (c >= 0x40 && c <= 0x7e) {                // 终止符
            // ED2(\x1b[2J)：清可视区。真实 xterm 保留 scrollback（见 terminal-scrollback-preserve.test.js），
            // 本扁平模型无 viewport/scrollback 之分，按"清可见文本"处理——足以判定残片不变量。
            if (ch === 'J' && csiParams.split(';')[0] === '2') visible = ''; // 含多参数 \x1b[2;…J 形式
            st = 'GROUND';
          }
          else if (c >= 0x20 && c <= 0x3f) csiParams += ch;  // 参数/私有/中间字节累积（用于识别 2J）
          // 其余 C0：停留
          break;
        case 'OSC':
          if (c === 0x07 || c === 0x18) st = 'GROUND';      // BEL 终止 / CAN 中止
          else if (c === 0x1b) st = 'OSC_ESC';
          break;
        case 'OSC_ESC':
          if (ch === '\\') st = 'GROUND';                   // ST
          else reprocessEsc(ch);
          break;
        case 'DCS':
          if (c === 0x18) st = 'GROUND';
          else if (c === 0x1b) st = 'DCS_ESC';
          break;
        case 'DCS_ESC':
          if (ch === '\\') st = 'GROUND';
          else reprocessEsc(ch);
          break;
      }
    }
  }
  return visible;
}

// ── 内容生成与断言 ──
const makeLine = (i) =>
  `\x1b[38;2;${i % 256};${(i * 7) % 256};${(i * 13) % 256}m${String(i).padStart(5, '0')} 彩色压测😀\x1b[0m\r\n`;

const LINE_RE = /^\d{5} 彩色压测😀$/;
const ALLOWED_NOTICES = new Set([
  '[cc-viewer] output trimmed (renderer behind)',
  '[cc-viewer] output skipped during congestion',
]);

function assertNoFragments(visibleText, label) {
  const lines = visibleText.split('\n');
  for (const line of lines) {
    if (line === '') continue;
    if (LINE_RE.test(line)) continue;
    if (ALLOWED_NOTICES.has(line)) continue;
    assert.fail(`[${label}] 可见文本出现非法行（残片）: ${JSON.stringify(line.slice(0, 60))}`);
  }
}

// ── 确定性工具：seeded LCG + 不劈代理对的随机分块（模拟 PTY 读边界）──
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}
function chunkStream(stream, rng, min = 50, max = 1500) {
  const chunks = [];
  let i = 0;
  while (i < stream.length) {
    let cut = Math.min(stream.length, i + min + Math.floor(rng() * (max - min)));
    const tail = stream.charCodeAt(cut - 1);
    if (tail >= 0xd800 && tail <= 0xdbff && cut < stream.length) cut++; // 与 node-pty 同语义：不劈码点
    chunks.push(stream.slice(i, cut));
    i = cut;
  }
  return chunks;
}

// ── 假时钟（coalescer 注入）与 RAF mock ──
function makeFakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); },
    tick() { const due = [...timers.values()]; timers.clear(); for (const fn of due) fn(); },
    size() { return timers.size; },
  };
}
let _rafQ, _origRAF, _origCAF;
beforeEach(() => {
  _rafQ = new Map();
  let id = 1;
  _origRAF = globalThis.requestAnimationFrame;
  _origCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { const i = id++; _rafQ.set(i, cb); return i; };
  globalThis.cancelAnimationFrame = (i) => { _rafQ.delete(i); };
});
afterEach(() => {
  globalThis.requestAnimationFrame = _origRAF;
  globalThis.cancelAnimationFrame = _origCAF;
});
function flushFrames(max = 5000) {
  let n = 0;
  while (_rafQ.size > 0 && n++ < max) {
    const cbs = [..._rafQ.values()];
    _rafQ.clear();
    for (const cb of cbs) cb();
  }
}

// ── 端到端夹具：server（SYNC 包裹 + outputBuffer 滚动 + coalescer）→ client（写队列 + resync 语义）──
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';
const RESYNC_NOTICE = '\x1b[33m[cc-viewer] output skipped during congestion\x1b[0m\r\n';

function makeHarness({ coalescerOpts = {}, clientOpts = {}, maxBuffer = 30000, trimTo = 27000 } = {}) {
  const clock = makeFakeClock();
  // —— server 侧 ——
  let outputBuffer = '';
  const wsMessages = [];          // 服务端 → 客户端的有序消息流
  let truncated = false;
  let _failNextSend = false;      // 模拟 ws.send 抛错（server.js: catch { sendResync(); return; }）
  const coalescer = createFloodCoalescer({
    send: (data) => {
      if (_failNextSend) { _failNextSend = false; pushResync(); return; }
      wsMessages.push({ type: 'data', data });
    },
    findSafeSliceStart,
    onTruncate: () => { truncated = true; coalescer.reset(); pushResync(); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ptCoalesceMs: 0,
    ...coalescerOpts,
  });
  const pushResync = () => wsMessages.push({ type: 'data-resync', data: outputBuffer });
  let batchCarry = '';
  const serverFeed = (chunk) => {
    outputBuffer += chunk;
    if (outputBuffer.length > maxBuffer) {
      outputBuffer = outputBuffer.slice(findSafeSliceStart(outputBuffer, outputBuffer.length - trimTo));
    }
    // ⚠ 复刻 server/pty-manager.js::flushBatch 的"缓带 + SYNC 包裹"语义
    //   （scratch-pty-manager.js::flushBatch 同源）——那边改了这里必须同步，
    //   否则 oracle 失真（测的不再是真实管线的批边界行为）。
    const [safe, carry] = splitTrailingIncomplete(batchCarry + chunk);
    batchCarry = carry;
    if (safe) coalescer.offer(SYNC_BEGIN + safe + SYNC_END);
  };
  // —— client 侧 ——
  const written = [];             // term.write 实际收到的 payload（= xterm WriteBuffer 输入序）
  const term = { write: (d, cb) => { written.push(d); if (cb) cb(); } };
  let resyncRequested = false;
  const q = new TerminalWriteQueue(() => term, {
    onTrim: () => { resyncRequested = true; },
    ...clientOpts,
  });
  const clientHandle = (msg) => {  // TerminalPanel._onTerminalWsMessage 同款语义
    if (msg.type === 'data') q.push(msg.data);
    else if (msg.type === 'data-resync') {
      q.reset();
      q.push(INBAND_RESET + RESYNC_NOTICE);
      if (msg.data) q.push(msg.data);
    }
  };
  const deliverAll = () => { while (wsMessages.length) clientHandle(wsMessages.shift()); };
  return {
    clock, serverFeed, coalescer, wsMessages, pushResync, deliverAll,
    written, q,
    getOutputBuffer: () => outputBuffer,
    wasTruncated: () => truncated,
    wasResyncRequested: () => resyncRequested,
    clearResyncRequested: () => { resyncRequested = false; },
    failNextSend: () => { _failNextSend = true; },
  };
}

// ════════════════════════════════════════════════════════════════════════
describe('terminal-pipeline-oracle: 端到端零残片不变量', () => {
  it('直通态：任意随机分块完整透传，可见文本逐行精确', () => {
    const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 } });
    const stream = Array.from({ length: 200 }, (_, i) => makeLine(i + 1)).join('');
    for (const c of chunkStream(stream, makeRng(42))) h.serverFeed(c);
    h.deliverAll();
    flushFrames();
    const visible = vtVisibleText(h.written);
    assertNoFragments(visible, '直通');
    assert.equal(visible.split('\n').filter(Boolean).length, 200, '200 行全部上屏');
  });

  it('切割点穷举：单条彩色行的每个字节位置劈成两个 chunk 都不产生残片', () => {
    const stream = makeLine(43) + makeLine(44) + makeLine(45);
    for (let p = 1; p < stream.length - 1; p++) {
      const c1 = stream.charCodeAt(p - 1);
      if (c1 >= 0xd800 && c1 <= 0xdbff) continue; // PTY 不会劈码点
      const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 } });
      h.serverFeed(stream.slice(0, p));
      h.serverFeed(stream.slice(p));
      h.deliverAll();
      flushFrames();
      assertNoFragments(vtVisibleText(h.written), `切割点 p=${p}`);
    }
  });

  it('服务端洪泛 + 截断 + 快照对齐：丢中段但零残片，尾部最新内容保留', () => {
    const h = makeHarness({
      coalescerOpts: { floodThresholdBytesPerWin: 2048, flushBudgetBytes: 4096, pendingCap: 8192, trimTo: 4096 },
    });
    const N = 2000;
    const rng = makeRng(7);
    const stream = Array.from({ length: N }, (_, i) => makeLine(i + 1)).join('');
    const chunks = chunkStream(stream, rng);
    for (let i = 0; i < chunks.length; i++) {
      h.serverFeed(chunks[i]);
      if (i % 8 === 0) h.clock.tick();   // 洪泛桶结算 + flush
    }
    let guard = 0;
    while (h.coalescer.isFlooding() && guard++ < 50) h.clock.tick(); // 回落 → onTruncate → resync
    h.deliverAll();
    flushFrames();
    assert.ok(h.wasTruncated(), '前置：本场景必须真的发生过截断');
    const visible = vtVisibleText(h.written);
    assertNoFragments(visible, '洪泛截断');
    assert.ok(visible.includes(`${String(N).padStart(5, '0')} 彩色压测😀`), '快照对齐后最新行在屏');
  });

  it('前端积压整项丢弃 + resync-request 对齐：零残片', () => {
    const h = makeHarness({
      coalescerOpts: { floodThresholdBytesPerWin: 1e9 },
      clientOpts: { highWaterBytes: 6000, trimTargetBytes: 1500 },
    });
    const stream = Array.from({ length: 400 }, (_, i) => makeLine(i + 1)).join('');
    for (const c of chunkStream(stream, makeRng(99), 200, 800)) h.serverFeed(c);
    h.deliverAll();                       // 一帧未刷，全部堆进写队列 → 必触发 _maybeTrim
    assert.ok(h.wasResyncRequested(), '前置：本场景必须真的发生过前端整项丢弃');
    h.pushResync();                       // 服务端响应 resync-request
    h.deliverAll();
    flushFrames();
    assertNoFragments(vtVisibleText(h.written), '前端积压丢弃');
  });

  it('重连恢复：close 带内重置 + 整段 replay，零残片零状态错位', () => {
    const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 } });
    const stream = Array.from({ length: 300 }, (_, i) => makeLine(i + 1)).join('');
    const chunks = chunkStream(stream, makeRng(5));
    const half = Math.floor(chunks.length / 2);
    for (let i = 0; i < half; i++) h.serverFeed(chunks[i]);
    h.deliverAll();
    flushFrames();
    // ws close（TerminalPanel close 分支同款）：清队列 + 带内重置
    h.q.reset();
    h.q.push(INBAND_RESET);
    // 重连 replay：服务端无条件整段重发 outputBuffer
    h.q.push(h.getOutputBuffer());
    for (let i = half; i < chunks.length; i++) h.serverFeed(chunks[i]);
    h.deliverAll();
    flushFrames();
    const visible = vtVisibleText(h.written);
    assertNoFragments(visible, '重连恢复');
    assert.ok(visible.includes('00300 彩色压测😀'), '重连后续流完整');
  });

  it('INBAND_RESET 状态穷举：解析器停在任意中间状态时带内重置都能干净接管', () => {
    const sample = makeLine(77) + '\x1b]8;;https://example.com\x1b\\link\x1b]0;title\x07' + makeLine(78);
    for (let p = 1; p < sample.length; p++) {
      const visible = vtVisibleText([sample.slice(0, p), INBAND_RESET + 'OK\r\n']);
      assert.equal(visible, 'OK\n', `前缀截断 p=${p} 时 RIS 后可见文本必须恰为 OK`);
    }
  });

  it('carry 跨多批拼接：每 2 字符一批（半截序列连续跨多批）最终内容逐字精确', () => {
    const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 } });
    const stream = makeLine(7) + makeLine(8);
    let i = 0;
    while (i < stream.length) {
      let end = Math.min(i + 2, stream.length);
      const c = stream.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff && end < stream.length) end++; // 不劈码点
      h.serverFeed(stream.slice(i, end));
      i = end;
    }
    h.deliverAll();
    flushFrames();
    assert.equal(vtVisibleText(h.written), '00007 彩色压测😀\n00008 彩色压测😀\n');
  });

  it('send 抛错（该条数据永久丢失）→ resync 快照兜底后零残片、尾部完整', () => {
    const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 } });
    const stream = Array.from({ length: 80 }, (_, i) => makeLine(i + 1)).join('');
    const chunks = chunkStream(stream, makeRng(13));
    for (let i = 0; i < chunks.length; i++) {
      if (i === Math.floor(chunks.length / 2)) h.failNextSend(); // 中途一条 send 失败
      h.serverFeed(chunks[i]);
    }
    h.deliverAll();
    flushFrames();
    const visible = vtVisibleText(h.written);
    assertNoFragments(visible, 'send 抛错兜底');
    assert.ok(visible.includes('00080 彩色压测😀'), '快照对齐后尾部内容完整');
  });

  it('服务端滚动缓冲裁剪 + 重放：buffer 顶满后任意时刻重放头部零残片', () => {
    const h = makeHarness({ coalescerOpts: { floodThresholdBytesPerWin: 1e9 }, maxBuffer: 20000, trimTo: 16000 });
    const stream = Array.from({ length: 600 }, (_, i) => makeLine(i + 1)).join('');
    for (const c of chunkStream(stream, makeRng(11))) h.serverFeed(c);
    // 模拟新 ws 连接：丢弃 live 流，全新终端只收整段 replay
    const replayVisible = vtVisibleText([h.getOutputBuffer()]);
    assertNoFragments(replayVisible, '滚动裁剪重放');
    assert.ok(replayVisible.includes('00600 彩色压测😀'), '尾部最新内容在');
  });
});
