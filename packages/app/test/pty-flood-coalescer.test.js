// server/lib/pty-flood-coalescer.js 单测：直通零延迟 / 阈值进限流 / 合并+单对 SYNC 重包裹 /
// pendingCap 截断走 findSafeSliceStart 且 2026 永远配对 / 连续 fallbackWins 桶回落 /
// flush 后 pending 必清（含下游 send 抛错跳发）/ reset / dispose。全程注入时钟驱动，零真实定时器。
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFloodCoalescer } from '../server/lib/pty-flood-coalescer.js';
import { findSafeSliceStart } from '../server/pty-manager.js';

const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

/** 注入式假时钟：手动 fire 到期回调，断言 timer 生命周期 */
function makeFakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    /** 触发所有当前已排程的 timer（触发前先取出，模拟一次 tick） */
    tick() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, t] of due) t.fn();
    },
    /** 仅触发指定 ms 的 timer——直通态 ptTimer(16) 与桶边界 timer(33) 并存时选择性触发 */
    fireByMs(ms) {
      const due = [...timers.entries()].filter(([, t]) => t.ms === ms);
      for (const [id] of due) timers.delete(id);
      for (const [, t] of due) t.fn();
    },
    count() { return timers.size; },
  };
}

function makeHarness(opts = {}) {
  const sent = [];
  const clock = makeFakeClock();
  const events = [];
  const c = createFloodCoalescer({
    send: opts.send || ((d) => sent.push(d)),
    findSafeSliceStart,
    onFloodStart: (b) => events.push(['start', b]),
    onFloodEnd: () => events.push(['end']),
    onTruncate: (n) => events.push(['truncate', n]),
    flushMs: 33,
    floodThresholdBytesPerWin: 100,
    fallbackWins: 3,
    pendingCap: 400,
    trimTo: 200,
    ptCoalesceMs: 0,   // 既有用例锁定"每 chunk 单发"旧语义；微合并用例显式覆盖为 16
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...opts.overrides,
  });
  return { c, sent, clock, events };
}

describe('pty-flood-coalescer', () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it('直通态：低于阈值的 chunk 立即原样发出，零延迟', () => {
    h.c.offer('hello');
    h.c.offer('world');
    assert.deepEqual(h.sent, ['hello', 'world']);
    assert.equal(h.c.isFlooding(), false);
    assert.deepEqual(h.events, []);
  });

  it('直通态桶边界 timer 到点清零计数，分散流量不会累计触发限流', () => {
    h.c.offer('x'.repeat(60));   // 桶内 60 < 100，直通
    h.clock.tick();              // 桶边界：计数清零
    h.c.offer('x'.repeat(60));   // 新桶 60 < 100，仍直通
    assert.equal(h.sent.length, 2);
    assert.equal(h.c.isFlooding(), false);
  });

  it('单桶累计超阈值 → 进入限流态，压垮桶的 chunk 进 pending 不直发', () => {
    h.c.offer('x'.repeat(60));   // 直通
    h.c.offer('y'.repeat(60));   // 60+60=120 > 100 → 限流，本条进 pending
    assert.deepEqual(h.sent, ['x'.repeat(60)]);
    assert.equal(h.c.isFlooding(), true);
    assert.deepEqual(h.events, [['start', 120]]);
    // flush tick：pending 以单对 SYNC 包裹发出
    h.clock.tick();
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1], SYNC_BEGIN + 'y'.repeat(60) + SYNC_END);
  });

  it('限流态合并多 chunk 为一条，剥除自带 2026 标记后整体单对重包裹', () => {
    h.c.offer('x'.repeat(200)); // 直接超阈值进限流
    h.c.offer(SYNC_BEGIN + 'aaa' + SYNC_END);
    h.c.offer(SYNC_BEGIN + 'bbb' + SYNC_END);
    h.clock.tick();
    assert.equal(h.sent.length, 1);
    const out = h.sent[0];
    // 单对配平：恰好一个 BEGIN 开头、一个 END 结尾，内部无残留标记
    assert.ok(out.startsWith(SYNC_BEGIN) && out.endsWith(SYNC_END));
    assert.equal(out.split(SYNC_BEGIN).length - 1, 1, 'exactly one SYNC_BEGIN');
    assert.equal(out.split(SYNC_END).length - 1, 1, 'exactly one SYNC_END');
    assert.equal(out, SYNC_BEGIN + 'x'.repeat(200) + 'aaa' + 'bbb' + SYNC_END);
  });

  it('pending 超 cap 截断只留尾部（last-wins），且截断后 2026 仍配对', () => {
    h.c.offer('x'.repeat(200));            // 进限流，pending=200
    h.c.offer(SYNC_BEGIN + 'y'.repeat(300) + SYNC_END); // 剥标记后 pending=500 > 400 → 截到尾部 ~200
    h.clock.tick();
    assert.equal(h.sent.length, 1);
    const out = h.sent[0];
    const inner = out.slice(SYNC_BEGIN.length, -SYNC_END.length);
    // findSafeSliceStart 返回值 ≥ rawStart，tail 必 ≤ trimTo
    assert.ok(inner.length <= 200, `tail kept bounded by trimTo, got ${inner.length}`);
    assert.ok(inner.endsWith('y'.repeat(50)), 'tail is the newest data (last-wins)');
    assert.equal(out.split(SYNC_BEGIN).length - 1, 1, 'still exactly one SYNC_BEGIN after trim');
    assert.equal(out.split(SYNC_END).length - 1, 1, 'still exactly one SYNC_END after trim');
  });

  it('单次 flush 发送预算：超 flushBudgetBytes 截到尾部，洪泛期速率真正有界', () => {
    const hh = makeHarness({ overrides: { flushBudgetBytes: 150, pendingCap: 1000, trimTo: 500 } });
    hh.c.offer('x'.repeat(120)); // 120 > 100 阈值 → 进限流，pending=120
    hh.c.offer('y'.repeat(180)); // pending=300，未超 pendingCap(1000)
    hh.clock.tick();
    assert.equal(hh.sent.length, 1);
    const inner = hh.sent[0].slice(SYNC_BEGIN.length, -SYNC_END.length);
    // pending=300（x*120+y*180），预算 150 → 截到尾部恰为 y*150，最旧的 x 全部丢弃
    assert.equal(inner, 'y'.repeat(150), 'flush bounded by budget, tail is newest (last-wins)');
  });

  it('截断起点经 findSafeSliceStart：不会从 ANSI 序列中间开始', () => {
    h.c.offer('x'.repeat(200)); // 进限流
    // 构造截断点恰好落进一段长 CSI 序列内部：尾部前缀放转义序列
    const esc = '\x1b[38;5;196m';
    const payload = ('A'.repeat(190) + esc + 'B'.repeat(195));
    h.c.offer(payload); // pending = 200+385=585 > 400 → rawStart=385 落在尾部区域
    h.clock.tick();
    const inner = h.sent[0].slice(SYNC_BEGIN.length, -SYNC_END.length);
    // 不以裸序列残端开头（findSafeSliceStart 会跳过被切断的转义序列）
    assert.ok(!/^[0-9;]+m/.test(inner), `must not start inside a CSI sequence, got: ${JSON.stringify(inner.slice(0, 16))}`);
  });

  it('连续 fallbackWins 个低于阈值的桶后回落直通，残余 pending 先 flush', () => {
    h.c.offer('x'.repeat(200)); // 进限流
    h.clock.tick();             // 桶1结算（本桶 200>100 → calm=0）+ flush
    assert.equal(h.sent.length, 1);
    h.c.offer('q');             // 桶2 仅 1 字节
    h.clock.tick();             // 桶2:calm=1 + flush('q')
    h.clock.tick();             // 桶3:calm=2
    h.clock.tick();             // 桶4:calm=3 → 回落
    assert.equal(h.c.isFlooding(), false);
    assert.deepEqual(h.events, [['start', 200], ['end']]);
    assert.equal(h.sent[1], SYNC_BEGIN + 'q' + SYNC_END);
    // 回落后直通
    h.c.offer('after');
    assert.equal(h.sent.at(-1), 'after');
  });

  it('限流期间持续高流量不回落（calm 计数被重置）', () => {
    h.c.offer('x'.repeat(200)); // 进限流
    for (let i = 0; i < 5; i++) {
      h.clock.tick();
      h.c.offer('z'.repeat(150)); // 每桶都超阈值 → calm 归零
    }
    assert.equal(h.c.isFlooding(), true);
    assert.equal(h.events.filter((e) => e[0] === 'end').length, 0);
  });

  it('下游 send 抛错（bpGate 跳发场景）时 flush 仍清空 pending，不重试不累积', () => {
    let throwNext = false;
    const sent = [];
    const hh = makeHarness({ send: (d) => { if (throwNext) throw new Error('skip'); sent.push(d); } });
    hh.c.offer('x'.repeat(200)); // 进限流
    throwNext = true;
    hh.clock.tick();             // flush 抛错被吞，pending 已清
    throwNext = false;
    hh.c.offer('new');
    hh.clock.tick();
    // 只有 'new'，旧 200 字节不回灌
    assert.equal(sent.length, 1);
    assert.equal(sent[0], SYNC_BEGIN + 'new' + SYNC_END);
  });

  it('reset()：清 pending + timer + 回直通（bpGate onBehind/onResume 防回灌）', () => {
    h.c.offer('x'.repeat(200)); // 进限流，pending 有数据
    h.c.reset();
    assert.equal(h.c.isFlooding(), false);
    assert.equal(h.clock.count(), 0, 'flush timer cleared');
    h.clock.tick(); // 无残留 timer 可触发
    assert.deepEqual(h.sent, [], 'old pending never flushed after reset');
    // reset 后恢复正常直通
    h.c.offer('ok');
    assert.deepEqual(h.sent, ['ok']);
  });

  it('dispose()：终态，offer 不再发送，timer 清理', () => {
    h.c.offer('x'.repeat(200));
    h.c.dispose();
    assert.equal(h.clock.count(), 0);
    h.c.offer('ignored');
    h.clock.tick();
    assert.deepEqual(h.sent, []);
  });

  it('空 chunk 被忽略', () => {
    h.c.offer('');
    h.c.offer(null);
    assert.deepEqual(h.sent, []);
    assert.equal(h.c.isFlooding(), false);
  });

  describe('直通态微合并（ptCoalesceMs，/plugins 消息风暴防卡死）', () => {
    const PT = 16;
    let m;
    beforeEach(() => { m = makeHarness({ overrides: { ptCoalesceMs: PT } }); });

    it('leading：空窗期首 chunk 立即发出并开窗（ptTimer 与桶边界 timer 并存）', () => {
      m.c.offer('k');
      assert.deepEqual(m.sent, ['k'], 'leading 零延迟');
      assert.equal(m.clock.count(), 2, 'ptTimer(16) + 桶边界 timer(33) 两个 timer 并存');
    });

    it('trailing：同窗后续 chunk 合并为一条发出，不添 SYNC 标记', () => {
      m.c.offer('a');                 // leading
      m.c.offer('b');
      m.c.offer('c');                 // 同窗缓冲
      assert.deepEqual(m.sent, ['a'], '窗口开启期间不发');
      m.clock.fireByMs(PT);           // 仅触发 ptTimer
      assert.deepEqual(m.sent, ['a', 'bc'], 'trailing 合并为一条');
      assert.ok(!m.sent[1].includes(SYNC_BEGIN), '直通合并不添加 SYNC 标记');
    });

    it('窗口重开：trailing flush 后下一 chunk 重新 leading 立即发', () => {
      m.c.offer('a');
      m.c.offer('b');
      m.clock.fireByMs(PT);           // flush 'b'，窗口关闭
      m.c.offer('c');                 // 新窗 leading
      assert.deepEqual(m.sent, ['a', 'b', 'c']);
    });

    it('直通拼接 SYNC 配平守恒（chunk 预配平，合并后 begin 数 === end 数）', () => {
      m.c.offer(SYNC_BEGIN + '1' + SYNC_END);   // leading
      m.c.offer(SYNC_BEGIN + '2' + SYNC_END);
      m.c.offer(SYNC_BEGIN + '3' + SYNC_END);
      m.clock.fireByMs(PT);
      const merged = m.sent[1];
      assert.equal(merged, SYNC_BEGIN + '2' + SYNC_END + SYNC_BEGIN + '3' + SYNC_END,
        'merge preserves per-chunk SYNC pairs verbatim');
      assert.equal(merged.split(SYNC_BEGIN).length, merged.split(SYNC_END).length,
        'begin/end balanced');
    });

    it('洪泛转换折叠非空 ptBuffer：序保持、标记剥净、单对 SYNC、leading 不召回', () => {
      m.c.offer('a'.repeat(30));                            // leading 发出（winBytes=30）
      m.c.offer(SYNC_BEGIN + 'b'.repeat(30) + SYNC_END);    // 缓冲（winBytes=76）
      m.c.offer('c'.repeat(40));                            // winBytes=116 > 100 → 洪泛
      assert.equal(m.c.isFlooding(), true);
      assert.deepEqual(m.sent, ['a'.repeat(30)], 'leading 不召回，ptBuffer 未单独发出');
      assert.equal(m.clock.count(), 1, 'ptTimer 已清，仅剩洪泛 flush timer');
      m.clock.fireByMs(33);                                 // 洪泛 flush
      assert.equal(m.sent.length, 2);
      assert.equal(m.sent[1], SYNC_BEGIN + 'b'.repeat(30) + 'c'.repeat(40) + SYNC_END,
        'ptBuffer 序在触发 chunk 之前，标记剥净后单对重包裹');
    });

    it('winBytes 计账不被合并致盲：缓冲中的 chunk 仍触发洪泛阈值', () => {
      m.c.offer('a'.repeat(50));   // leading（winBytes=50）
      m.c.offer('b'.repeat(40));   // 缓冲（winBytes=90）
      m.c.offer('c'.repeat(20));   // winBytes=110 > 100 → 洪泛（即便只实际发出了一条）
      assert.equal(m.c.isFlooding(), true);
    });

    it('reset 清 ptBuffer + 双 timer：缓冲 chunk 永不发出，reset 后恢复 leading', () => {
      m.c.offer('a');              // leading
      m.c.offer('b');              // 缓冲
      m.c.reset();
      assert.equal(m.clock.count(), 0, 'ptTimer 与桶边界 timer 均已清');
      m.clock.tick();
      assert.deepEqual(m.sent, ['a'], '缓冲的 b 永不发出（防 pre-snapshot 回灌）');
      m.c.offer('c');
      assert.deepEqual(m.sent, ['a', 'c'], 'reset 后正常 leading');
    });

    it('dispose 清 ptBuffer + ptTimer，终态不再发送', () => {
      m.c.offer('a');
      m.c.offer('b');
      m.c.dispose();
      assert.equal(m.clock.count(), 0);
      m.clock.tick();
      assert.deepEqual(m.sent, ['a']);
    });

    it('ptCoalesceMs=0 禁用：回旧行为每 chunk 单发', () => {
      const z = makeHarness({ overrides: { ptCoalesceMs: 0 } });
      z.c.offer('a');
      z.c.offer('b');
      assert.deepEqual(z.sent, ['a', 'b']);
    });
  });

  describe('onTruncate（截断终态对齐通知，server 端接 data-resync 快照）', () => {
    const drainToFallback = (hh) => {
      // 结算超阈值的首桶 + 连续 fallbackWins(3) 个 calm 桶 → 回落直通
      for (let i = 0; i < 4; i++) hh.clock.tick();
    };

    it('pendingCap 截断 → 回落后紧随 onFloodEnd 触发一次，携带累计丢弃量', () => {
      h.c.offer('x'.repeat(200));   // 进限流（onFloodStart）
      h.c.offer('y'.repeat(300));   // pending=500 > cap(400) → 截到尾部 ~200，丢 ~300
      drainToFallback(h);
      assert.equal(h.c.isFlooding(), false);
      const truncates = h.events.filter((e) => e[0] === 'truncate');
      assert.equal(truncates.length, 1, '每轮洪泛至多一次');
      assert.ok(truncates[0][1] >= 300, `携带累计丢弃量，got ${truncates[0][1]}`);
      assert.deepEqual(h.events.at(-2), ['end'], 'onFloodEnd 在前');
      assert.equal(h.events.at(-1)[0], 'truncate', 'onTruncate 紧随其后');
    });

    it('flush 预算截断同样计入', () => {
      const hh = makeHarness({ overrides: { flushBudgetBytes: 150, pendingCap: 1000, trimTo: 500 } });
      hh.c.offer('x'.repeat(120));  // 进限流
      hh.c.offer('y'.repeat(180));  // pending=300，flush 时超预算 150 → 丢 ~150
      drainToFallback(hh);
      const truncates = hh.events.filter((e) => e[0] === 'truncate');
      assert.equal(truncates.length, 1);
      assert.ok(truncates[0][1] >= 150, `预算截断丢弃量计入，got ${truncates[0][1]}`);
    });

    it('洪泛全程未丢字节 → 回落只有 onFloodEnd，不触发 onTruncate', () => {
      h.c.offer('x'.repeat(200));   // pending=200 < cap(400)，flush 也低于预算
      drainToFallback(h);
      assert.equal(h.c.isFlooding(), false);
      assert.deepEqual(h.events, [['start', 200], ['end']]);
    });

    it('reset() 清零累计：resync 路径已快照对齐，后续回落不补发', () => {
      h.c.offer('x'.repeat(200));
      h.c.offer('y'.repeat(300));   // cap 截断，丢 ~300
      h.c.reset();                  // bpGate onBehind/onResume 场景
      h.c.offer('z'.repeat(200));   // 新一轮洪泛，本轮无截断
      drainToFallback(h);
      assert.equal(h.events.filter((e) => e[0] === 'truncate').length, 0,
        'reset 后旧丢弃量不跨轮泄漏');
    });
  });

  it('CCV_FLOOD_PT_COALESCE_MS=0 经 env 禁用（envIntAllowZero 接受 0）', async () => {
    process.env.CCV_FLOOD_PT_COALESCE_MS = '0';
    try {
      const { createFloodCoalescer: cfc } = await import('../server/lib/pty-flood-coalescer.js?ccv-pt-env-zero');
      const clock = makeFakeClock();
      const sent = [];
      const c = cfc({
        send: (d) => sent.push(d), findSafeSliceStart,
        floodThresholdBytesPerWin: 1000,
        setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      });
      c.offer('a');
      c.offer('b');
      assert.deepEqual(sent, ['a', 'b'], 'env=0 关闭微合并，逐条直发');
      c.dispose();
    } finally {
      delete process.env.CCV_FLOOD_PT_COALESCE_MS;
    }
  });

  it('CCV_FLOOD_PT_COALESCE_MS 非法/负值回落默认 16（envIntAllowZero）', async () => {
    process.env.CCV_FLOOD_PT_COALESCE_MS = '-5';
    try {
      const { createFloodCoalescer: cfc } = await import('../server/lib/pty-flood-coalescer.js?ccv-pt-env-neg');
      const clock = makeFakeClock();
      const sent = [];
      const c = cfc({
        send: (d) => sent.push(d), findSafeSliceStart,
        floodThresholdBytesPerWin: 1000,
        setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      });
      c.offer('a');
      c.offer('b');
      assert.deepEqual(sent, ['a'], '回落默认 16ms，第二条进缓冲');
      clock.fireByMs(16);
      assert.deepEqual(sent, ['a', 'b']);
      c.dispose();
    } finally {
      delete process.env.CCV_FLOOD_PT_COALESCE_MS;
    }
  });

  it('envInt/envIntAllowZero 严格十进制白名单：科学计数法/十六进制回落默认（parseInt 截断陷阱）', async () => {
    process.env.CCV_TEST_DEC = '42';
    process.env.CCV_TEST_SCI = '1e9';    // parseInt → 1，须拒绝
    process.env.CCV_TEST_HEX = '0x10';   // parseInt(,10) → 0，须拒绝
    process.env.CCV_TEST_ZERO = '0';
    try {
      const { envInt, envIntAllowZero } = await import('../server/lib/pty-flood-coalescer.js?ccv-env-helpers');
      assert.equal(envInt('CCV_TEST_DEC', 7), 42, '纯十进制通过');
      assert.equal(envInt('CCV_TEST_SCI', 7), 7, "'1e9' 拒绝回落而非截断成 1");
      assert.equal(envInt('CCV_TEST_HEX', 7), 7, "'0x10' 拒绝回落而非截断成 0");
      assert.equal(envInt('CCV_TEST_ZERO', 7), 7, 'envInt 拒 0');
      assert.equal(envIntAllowZero('CCV_TEST_ZERO', 7), 0, 'allowZero 接受 0');
      assert.equal(envIntAllowZero('CCV_TEST_SCI', 7), 7, "allowZero 同样拒 '1e9'");
      assert.equal(envIntAllowZero('CCV_TEST_HEX', 7), 7, "allowZero 同样拒 '0x10'（否则误关功能）");
      assert.equal(envIntAllowZero('CCV_TEST_MISSING', 7), 7, '缺失回落');
    } finally {
      delete process.env.CCV_TEST_DEC;
      delete process.env.CCV_TEST_SCI;
      delete process.env.CCV_TEST_HEX;
      delete process.env.CCV_TEST_ZERO;
    }
  });

  it('超长数字串拒绝回落（parseInt 溢出 Infinity 会穿透 v>0，钳坏 setTimeout）', async () => {
    process.env.CCV_TEST_HUGE = '9'.repeat(400);   // parseInt → Infinity
    process.env.CCV_TEST_16D = '9'.repeat(16);     // 16 位 > 15 位上限，同拒
    process.env.CCV_TEST_15D = '9'.repeat(15);     // 15 位边界，应通过
    try {
      const { envInt, envIntAllowZero } = await import('../server/lib/pty-flood-coalescer.js?ccv-env-huge');
      assert.equal(envInt('CCV_TEST_HUGE', 7), 7, '400 位拒绝（否则返回 Infinity）');
      assert.equal(envIntAllowZero('CCV_TEST_HUGE', 7), 7, 'allowZero 同拒');
      assert.equal(envInt('CCV_TEST_16D', 7), 7, '16 位超上限拒绝');
      assert.equal(envInt('CCV_TEST_15D', 7), 999999999999999, '15 位边界通过');
    } finally {
      delete process.env.CCV_TEST_HUGE;
      delete process.env.CCV_TEST_16D;
      delete process.env.CCV_TEST_15D;
    }
  });

  it('knob 级防截断：CCV_FLOOD_FLUSH_MS=1e9 / CCV_FLOOD_PT_COALESCE_MS=0x10 均回落默认', async () => {
    process.env.CCV_FLOOD_FLUSH_MS = '1e9';        // 若被截成 1ms 桶宽，洪泛判定频度爆炸
    process.env.CCV_FLOOD_PT_COALESCE_MS = '0x10'; // 若被截成 0，微合并被误关
    try {
      const { createFloodCoalescer: cfc } = await import('../server/lib/pty-flood-coalescer.js?ccv-env-strict');
      const timerMs = [];
      const c = cfc({
        send: () => {}, findSafeSliceStart,
        setTimer: (fn, ms) => { timerMs.push(ms); return 0; },
        clearTimer: () => {},
      });
      c.offer('x');   // 直通 leading：桶边界 timer(默认 33) + ptTimer(默认 16) 均应按默认值排程
      assert.deepEqual(timerMs.sort((a, b) => a - b), [16, 33],
        'both knobs rejected, defaults 33/16 in effect');
      c.dispose();
    } finally {
      delete process.env.CCV_FLOOD_FLUSH_MS;
      delete process.env.CCV_FLOOD_PT_COALESCE_MS;
    }
  });

  it('CCV_FLOOD_* 环境变量覆盖默认常量（非法值回落默认）', async () => {
    process.env.CCV_FLOOD_FLUSH_MS = '50';
    process.env.CCV_FLOOD_THRESHOLD = 'not-a-number'; // 非法 → 回落 8192
    try {
      // ESM query 缓存击穿：以新 env 重新评估模块顶层常量
      const { createFloodCoalescer: cfc } = await import('../server/lib/pty-flood-coalescer.js?ccv-env-test');
      const timerMs = [];
      const c = cfc({
        send: () => {},
        findSafeSliceStart,
        setTimer: (fn, ms) => { timerMs.push(ms); return 0; },
        clearTimer: () => {},
      });
      c.offer('x'.repeat(9000)); // 9000 > 默认阈值 8192（非法 env 已回落）→ 进限流，armTimer
      assert.equal(c.isFlooding(), true, 'illegal CCV_FLOOD_THRESHOLD falls back to default 8KB');
      assert.deepEqual(timerMs, [50], 'CCV_FLOOD_FLUSH_MS=50 takes effect');
      c.dispose();
    } finally {
      delete process.env.CCV_FLOOD_FLUSH_MS;
      delete process.env.CCV_FLOOD_THRESHOLD;
    }
  });
});
