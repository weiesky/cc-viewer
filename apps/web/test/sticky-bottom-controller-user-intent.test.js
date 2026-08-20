/**
 * StickyBottomController 用户滚动意图暂停窗口（user-scroll intent）单测
 *
 * 背景：SSE 流式期间 startSmoothFollow 缓动链被高频重启、锁几乎常驻，_onScroll /
 * notifyAtBottom 被锁短路，用户上滑信号全被吃掉、困死在吸底态。修复：直接监听不可
 * 伪造的用户输入（wheel / touch / pointer 拖动）进入暂停窗口，窗口内自动追底停摆、
 * sticky 实时翻转；停手 userScrollIdleMs 后终判并恢复追底。
 *
 * 覆盖：
 *   - 逃逸主场景（desktop scroll 链 / virtuoso notifyAtBottom 链）
 *   - 窗口内 startSmoothFollow no-op + step 竞态臂、RO 抑制、writeUnderLock 畅通
 *   - 停手终判：desktop 三段滞回 / virtuoso atBottomPx 单边界 + 补追
 *   - pointer slop（纯点击不开窗）/ touch tap（立即关窗）/ 双 hold 独立
 *   - wheel deltaY 过滤双臂、timer 自检重排、hold 到点不重排
 *   - momentum 延展（desktop / virtuoso）、_followTarget 窗口内保鲜
 *   - 泄漏沿（hold 中 dispose / unbind / bind(null)）、window blur 兜底
 *   - onUserScrollChange 边沿契约、touchSuppressMs 兼容映射
 *
 * 定时器经 opts.setTimeout/clearTimeout 注入（与 opts.now 同一时钟源，advance()
 * 成对推进），不用 mock.timers——避免虚拟钟与 mockNow 双钟漂移。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StickyBottomController } from '../src/utils/stickyBottomController.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

let rafQueue, rafIdSeq, roInstances, origRAF, origCAF, origRO, origDoc, origWin;
let mockNow, timerQueue, timerIdSeq;

function makeEventTarget() {
  const listeners = new Map();
  return {
    _listeners: listeners,
    addEventListener: (name, fn) => { (listeners.get(name) || listeners.set(name, new Set()).get(name)).add(fn); },
    removeEventListener: (name, fn) => { listeners.get(name)?.delete(fn); },
    fire: (name, ev = {}) => { listeners.get(name)?.forEach(fn => { try { fn(ev); } catch {} }); },
    hasListener: (name) => (listeners.get(name)?.size ?? 0) > 0,
  };
}

function setupGlobals() {
  rafQueue = new Map();
  rafIdSeq = 1;
  roInstances = [];
  mockNow = 1_000_000;
  timerQueue = new Map();
  timerIdSeq = 1;

  origRAF = globalThis.requestAnimationFrame;
  origCAF = globalThis.cancelAnimationFrame;
  origRO = globalThis.ResizeObserver;
  origDoc = globalThis.document;
  origWin = globalThis.window;

  globalThis.requestAnimationFrame = (fn) => {
    const id = rafIdSeq++;
    rafQueue.set(id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => { rafQueue.delete(id); };

  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = false; roInstances.push(this); }
    observe(el) { this.observed.push(el); }
    unobserve(el) { this.observed = this.observed.filter(x => x !== el); }
    disconnect() { this.observed = []; this.disconnected = true; }
    fire(el) { try { this.cb([{ target: el }]); } catch {} }
  };

  globalThis.document = makeEventTarget();
  globalThis.window = makeEventTarget(); // blur 兜底监听需要
}

function teardownGlobals() {
  globalThis.requestAnimationFrame = origRAF;
  globalThis.cancelAnimationFrame = origCAF;
  globalThis.ResizeObserver = origRO;
  globalThis.document = origDoc;
  globalThis.window = origWin;
}

function flushRAF(times = 1) {
  for (let i = 0; i < times; i++) {
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of callbacks) try { cb(); } catch {}
  }
}

// 注入式假定时器：与 mockNow 同一时钟源
const fakeSetTimeout = (fn, ms) => { const id = timerIdSeq++; timerQueue.set(id, { fn, due: mockNow + ms }); return id; };
const fakeClearTimeout = (id) => { timerQueue.delete(id); };

// 成对推进 mockNow 与到期定时器（按 due 升序逐个触发，允许回调内 re-arm）
function advance(ms) {
  mockNow += ms;
  for (;;) {
    const due = [...timerQueue.entries()]
      .filter(([, t]) => t.due <= mockNow)
      .sort((a, b) => a[1].due - b[1].due);
    if (!due.length) return;
    const [id, t] = due[0];
    timerQueue.delete(id);
    t.fn();
  }
}

function makeFakeEl({ scrollHeight = 1000, clientHeight = 600, scrollTop = 0 } = {}) {
  const listeners = new Map();
  return {
    scrollHeight, clientHeight, scrollTop,
    addEventListener: (n, fn) => { (listeners.get(n) || listeners.set(n, new Set()).get(n)).add(fn); },
    removeEventListener: (n, fn) => { listeners.get(n)?.delete(fn); },
    _fire: (n, ev = {}) => { listeners.get(n)?.forEach(fn => { try { fn(ev); } catch {} }); },
    _hasListener: (n) => (listeners.get(n)?.size ?? 0) > 0,
  };
}

function makeController(overrides = {}) {
  let sticky = overrides.initialSticky ?? true;
  const stickyHistory = [];
  const scrollChanges = []; // onUserScrollChange 边沿记录
  const ctrl = new StickyBottomController({
    getSticky: () => sticky,
    setSticky: (v) => { sticky = v; stickyHistory.push(v); },
    getMode: overrides.getMode || (() => 'desktop'),
    now: () => mockNow,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    onUserScrollChange: (a) => scrollChanges.push(a),
    ...(overrides.opts || {}),
  });
  return { ctrl, getSticky: () => sticky, setSticky: (v) => { sticky = v; }, stickyHistory, scrollChanges };
}

beforeEach(setupGlobals);
afterEach(teardownGlobals);

describe('StickyBottomController user-scroll intent', () => {
  // ─── 1. 逃逸主场景（desktop）：缓动持锁中 wheel 上滑 → 锁释放 → sticky 翻 false ──
  it('U1. desktop 逃逸：smoothFollow 持锁中 wheel 上滑，锁释放且 sticky 翻 false', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    assert.equal(ctrl.isLocked(), true, '前置：缓动链持锁（修复前 _onScroll 在此被吞）');
    // 用户滚轮上滑
    el._fire('wheel', { deltaY: -100 });
    assert.equal(ctrl.isLocked(), false, '意图事件同步释放缓动锁');
    el.scrollTop = 300; // gap = 100 > thresholdLeave(50)
    el._fire('scroll');
    flushRAF(1);
    assert.equal(getSticky(), false, '上滑信号进入决策通道，sticky 翻 false');
  });

  // ─── 2. 逃逸等价物（virtuoso）：touchstart 释放锁 → notifyAtBottom 即时生效 ──
  it('U2. virtuoso 逃逸：smoothFollow 持锁中 touchstart，notifyAtBottom(false) 即时翻 false', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: true, getMode: () => 'virtuoso' });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    assert.equal(ctrl.isLocked(), true);
    document.fire('touchstart');
    assert.equal(ctrl.isLocked(), false, 'touch 意图同步释放锁');
    el.scrollTop = 300; // realGap = 100 > atBottomPx(60)
    ctrl.notifyAtBottom(false);
    assert.equal(getSticky(), false, '真值修正放行，窗口内即时翻 false');
    ctrl.dispose();
  });

  // ─── 3. 窗口内 startSmoothFollow no-op + step 竞态臂 ───────────────────
  it('U3. 窗口内 startSmoothFollow 为 no-op；step 链中途意图 → 守卫 release', () => {
    const { ctrl } = makeController({ initialSticky: true });
    // gap=40 ≤ thresholdLeave：决策通道不会翻 sticky，干净隔离 step 守卫断言
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 360 });
    ctrl.bind(el);
    // a) 窗口内入口 no-op
    el._fire('wheel', { deltaY: -1 });
    ctrl.startSmoothFollow(el);
    assert.equal(ctrl.isLocked(), false, '窗口内不抓锁');
    assert.equal(ctrl._smoothFollowRafId, null, '窗口内不排缓动链');
    ctrl.resetUserScrollState();
    // b) step 链已启动，两帧之间意图未及走 cancel（直接改 ts 模拟极端竞态）
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 双 rAF + 首步（写一段 delta，排下一步）
    assert.equal(ctrl.isLocked(), true, '前置：step 链在跑');
    ctrl._lastUserIntentTs = mockNow; // 绕过 cancelSmoothFollow 的极端竞态
    flushRAF(1);
    assert.equal(ctrl.isLocked(), false, 'step 内守卫 release');
    assert.equal(ctrl._smoothFollowRafId, null, '链已停');
    ctrl.dispose();
  });

  // ─── 4. 窗口内 RO 跟底被抑制 ───────────────────────────────────────────
  it('U4. 窗口内 handleScrollerResize 不写 scrollTop（仍刷 followTarget）', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 400, '窗口内 RO 不写');
    assert.equal(ctrl._followTarget, 1400, 'followTarget 仍刷新');
    ctrl.dispose();
  });

  // ─── 5. 停手终判：desktop 三段滞回 + 补追 ──────────────────────────────
  it('U5a. 终判贴底（gap≤enter）→ sticky=true 且启动补追', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: false });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 395 }); // gap=5
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    assert.equal(ctrl.isUserScrolling(), true);
    advance(300);
    assert.equal(getSticky(), true, '终判促升');
    assert.equal(ctrl.isUserScrolling(), false, '窗口已关');
    assert.notEqual(ctrl._smoothFollowRafId, null, '补追缓动已启动');
    ctrl.dispose();
  });

  it('U5b. 终判远离（gap>leave）→ sticky=false，无补追', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 300 }); // gap=100
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    advance(300);
    assert.equal(getSticky(), false, '终判降级');
    assert.equal(ctrl._smoothFollowRafId, null, '不补追');
    ctrl.dispose();
  });

  it('U5c. 终判中间带（enter<gap≤leave）→ 维持现状', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: false });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 370 }); // gap=30
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    advance(300);
    assert.equal(getSticky(), false, '中间带不促升');
    ctrl.dispose();
  });

  // ─── 6. 终判 virtuoso 单边界（gap∈(leave, atBottomPx] 死亡区间）─────────
  it('U6. virtuoso 终判用 atBottomPx 单边界：gap=55 → sticky=true，不与 notifyAtBottom 打架', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: false, getMode: () => 'virtuoso' });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 345 }); // realGap=55
    ctrl.bind(el);
    document.fire('touchstart');
    document.fire('touchmove');
    document.fire('touchend');
    advance(300);
    assert.equal(getSticky(), true, '55 ≤ 60 → 促升（desktop 滞回会判 55>50 维持 false，被 Virtuoso 推翻）');
    ctrl.dispose();
  });

  // ─── 7. pointer slop：纯点击不开窗，拖动达标才 hold ─────────────────────
  it('U7a. pointerdown+pointerup 零位移（纯点击）→ 不开窗，RO 照常跟底', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el._fire('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 });
    document.fire('pointerup', { pointerType: 'mouse' });
    assert.equal(ctrl.isUserScrolling(), false, '纯点击不开窗');
    assert.deepEqual(scrollChanges, [], '无开沿');
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1400, 'RO 跟底不受点击影响');
  });

  it('U7b. pointermove 超 slop → hold 开窗；pointerup 后空窗终判', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el._fire('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 });
    el._fire('pointermove', { pointerType: 'mouse', clientX: 10, clientY: 30 }); // 位移 20 > 5
    assert.equal(ctrl.isUserScrolling(), true, '拖动达标 → hold');
    advance(1000);
    assert.equal(ctrl.isUserScrolling(), true, 'hold 撑着，到点不终判');
    document.fire('pointerup', { pointerType: 'mouse' });
    assert.equal(ctrl.isUserScrolling(), true, '释放后空窗计时中');
    advance(300);
    assert.equal(ctrl.isUserScrolling(), false, '空窗过后终判关窗');
    ctrl.dispose();
  });

  it('U7c. 滚动条区域 pointerdown（offsetX≥clientWidth）→ 直接开窗，scroll 续窗', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    el.clientWidth = 380; // 纵向滚动条在 clientWidth 之外
    ctrl.bind(el);
    // 滚动条拖动期间浏览器不派发 pointermove，slop 升级不可用 → 按时间戳直接开窗
    el._fire('pointerdown', { pointerType: 'mouse', target: el, offsetX: 390, clientX: 390, clientY: 10 });
    assert.equal(ctrl.isUserScrolling(), true, '滚动条按下即开窗');
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 0, '窗口内 RO 不写');
    mockNow += 200;
    el._fire('scroll'); // 拖动产生的 scroll 经 momentum 延展续窗
    mockNow += 250;
    assert.equal(ctrl.isUserScrolling(), true, 'scroll 续窗生效');
    advance(100); // 距最后 scroll 已超 300ms → 终判关窗
    assert.equal(ctrl.isUserScrolling(), false, '停拖后空窗过期关窗');
    ctrl.dispose();
  });

  // ─── 8. touch tap：无 touchmove → 立即关窗 ─────────────────────────────
  it('U8. touchstart+touchend 无 move（tap）→ 立即关窗、不留 300ms 尾巴', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    document.fire('touchstart');
    assert.equal(ctrl.isUserScrolling(), true);
    document.fire('touchend');
    assert.equal(ctrl.isUserScrolling(), false, 'tap 立即关窗');
    assert.equal(timerQueue.size, 0, '空窗定时器已清');
    assert.deepEqual(scrollChanges, [true, false], '开关沿各一次');
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1400, 'tap 后 RO 跟底立即可用');
  });

  // ─── 9. 双 hold 独立：pointercancel 不碰 touchHold ──────────────────────
  it('U9. pointercancel 只清 pointerHold，touchHold 不受影响', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl();
    ctrl.bind(el);
    document.fire('touchstart'); // 触摸设备：手指按下
    document.fire('pointercancel', { pointerType: 'touch' }); // 浏览器接管滚动时发 cancel
    assert.equal(ctrl.isUserScrolling(), true, 'touch hold 仍在（手指还按着）');
    document.fire('pointercancel', { pointerType: 'mouse' }); // 非 touch 的 cancel 也不碰 touchHold
    assert.equal(ctrl.isUserScrolling(), true);
    ctrl.dispose();
  });

  // ─── 10. wheel deltaY 过滤双臂 ─────────────────────────────────────────
  it('U10. wheel 下滚：sticky 时非意图，不吸底时算意图', () => {
    const a = makeController({ initialSticky: true });
    const elA = makeFakeEl();
    a.ctrl.bind(elA);
    elA._fire('wheel', { deltaY: 5 });
    assert.equal(a.ctrl.isUserScrolling(), false, '贴底下滚不打断追底');
    const b = makeController({ initialSticky: false });
    const elB = makeFakeEl();
    b.ctrl.bind(elB);
    elB._fire('wheel', { deltaY: 5 });
    assert.equal(b.ctrl.isUserScrolling(), true, '未吸底时下滚算意图（驱动终判促升）');
    b.ctrl.dispose();
  });

  // ─── 11. timer 自检重排：事件只刷时间戳，到点按剩余补 ───────────────────
  it('U11. 高频 wheel 不 churn 定时器；到点不满空窗按剩余重排', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 }); // t0，armed due t0+300
    assert.equal(timerQueue.size, 1);
    const [firstId] = timerQueue.keys();
    mockNow += 200; // t0+200（不触发定时器）
    el._fire('wheel', { deltaY: -1 }); // 只刷时间戳
    assert.equal(timerQueue.size, 1, '不新建定时器');
    assert.equal([...timerQueue.keys()][0], firstId, '同一个定时器（零 churn）');
    advance(100); // t0+300：到点，elapsed=100 < 300 → 按剩余 200 重排
    assert.equal(ctrl.isUserScrolling(), true, '未终判');
    assert.deepEqual(scrollChanges, [true], '窗口未关');
    advance(200); // t0+500：满空窗 → 终判
    assert.equal(ctrl.isUserScrolling(), false);
    assert.deepEqual(scrollChanges, [true, false]);
    ctrl.dispose();
  });

  // ─── 12. hold 到点不重排，释放事件接力 re-arm ───────────────────────────
  it('U12. hold 中定时器到点直接歇火；pointerup 接力 re-arm', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
    el._fire('pointermove', { pointerType: 'mouse', clientX: 0, clientY: 20 });
    advance(300); // 到点：hold 中 → 不重排
    assert.equal(timerQueue.size, 0, 'hold 到点不自旋重排');
    assert.equal(ctrl.isUserScrolling(), true, 'hold 仍撑着窗口');
    document.fire('pointerup', { pointerType: 'mouse' });
    assert.equal(timerQueue.size, 1, '释放事件接力 re-arm');
    advance(300);
    assert.equal(ctrl.isUserScrolling(), false, '终判完成');
    ctrl.dispose();
  });

  // ─── 13. resetUserScrollState：显式动作清窗口 ───────────────────────────
  it('U13. reset 窗口期间 → 关沿+恢复；未开窗 → 纯 no-op', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.resetUserScrollState(); // 未开窗：no-op
    assert.deepEqual(scrollChanges, [], '未开窗不发关沿');
    el._fire('wheel', { deltaY: -1 });
    ctrl.resetUserScrollState();
    assert.equal(ctrl.isUserScrolling(), false);
    assert.equal(timerQueue.size, 0, '定时器已清');
    assert.deepEqual(scrollChanges, [true, false]);
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1400, 'reset 后 RO 跟底立即恢复');
  });

  // ─── 14. 窗口期间显式通道（writeUnderLock）仍畅通 ───────────────────────
  it('U14. 窗口内 writeUnderLock 照常写并持锁', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    ctrl.writeUnderLock(el, 400);
    assert.equal(el.scrollTop, 400, '显式写不被窗口抑制');
    assert.equal(ctrl.isLocked(), true);
    ctrl.dispose();
  });

  // ─── 15. momentum 延展 ─────────────────────────────────────────────────
  it('U15a. desktop：窗口活跃期 scroll 事件刷新时间戳（iOS 惯性）', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 }); // t0
    mockNow += 200;
    el._fire('scroll'); // 惯性滚动事件 → 刷新 ts 到 t0+200
    mockNow += 250;     // t0+450：距最后意图 250 < 300
    assert.equal(ctrl.isUserScrolling(), true, '延展生效');
    advance(100);       // 终判定时器自检重排链最终在满空窗后触发
    assert.equal(ctrl.isUserScrolling(), false, 't0+550 距 t0+200 已超 300，窗口关闭');
    ctrl.dispose();
  });

  it('U15b. virtuoso：轻量 scroll 监听只延展不决策；窗口关闭后程序滚不重开窗', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true, getMode: () => 'virtuoso' });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    document.fire('touchstart');
    document.fire('touchmove');
    document.fire('touchend'); // t0 起空窗
    flushRAF(1); // 排干 _noteUserIntent 主动调度的那次决策 rAF（设计内行为）
    mockNow += 200;
    el._fire('scroll'); // fling 惯性 → 延展
    assert.equal(ctrl._scrollHandlerRafId, null, 'scroll 不进决策通道（决策权威是 notifyAtBottom）');
    mockNow += 250;
    assert.equal(ctrl.isUserScrolling(), true, '延展生效');
    advance(200); // 满空窗终判（realGap=0 ≤ 60 → 维持 true + 补追）
    assert.equal(ctrl.isUserScrolling(), false);
    const histLen = stickyHistory.length;
    el._fire('scroll'); // 补追缓动持锁中的程序滚
    assert.equal(ctrl.isUserScrolling(), false, '锁内 scroll 不重开窗');
    assert.equal(stickyHistory.length, histLen, '无新决策');
    ctrl.dispose();
  });

  // ─── 16. _followTarget 窗口内保鲜：滚回旧底部不闪 sticky ────────────────
  it('U16. 窗口内内容长高后滚回旧底部：决策用保鲜 target，不误促升', () => {
    const { ctrl, getSticky } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -100 });
    el.scrollTop = 300;
    el._fire('scroll');
    flushRAF(1);
    assert.equal(getSticky(), false, '前置：已脱离');
    el.scrollHeight = 1600; // 流式期间内容长高（真实底部 followTarget=1000），RO 未 fire
    el.scrollTop = 400;     // 用户滚回「旧底部」（旧 followTarget=400 会得 gap=0 误促升）
    el._fire('scroll');
    flushRAF(1);
    assert.equal(getSticky(), false, '保鲜后 gap=600>50，不闪 sticky');
    advance(300); // 终判同样用刷新值
    assert.equal(getSticky(), false);
    ctrl.dispose();
  });

  // ─── 17. 泄漏沿三连：hold 中 dispose / unbind / bind(null) ──────────────
  it('U17a. hold 中 dispose：定时器清、监听摘、关沿发出、晚到 pointerup 无副作用', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl();
    ctrl.bind(el);
    el._fire('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
    el._fire('pointermove', { pointerType: 'mouse', clientX: 0, clientY: 20 });
    assert.deepEqual(scrollChanges, [true]);
    ctrl.dispose();
    assert.equal(timerQueue.size, 0, '定时器已清');
    assert.equal(document.hasListener('pointerup'), false, 'document 监听已摘');
    assert.equal(window.hasListener('blur'), false, 'window blur 已摘');
    assert.deepEqual(scrollChanges, [true, false], 'dispose 前发出关沿');
    assert.doesNotThrow(() => document.fire('pointerup', { pointerType: 'mouse' }));
    assert.deepEqual(scrollChanges, [true, false], '晚到事件无副作用');
  });

  it('U17b. 窗口活跃中 unbind → 关沿+复位', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl();
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    ctrl.unbind();
    assert.equal(ctrl.isUserScrolling(), false);
    assert.equal(timerQueue.size, 0);
    assert.deepEqual(scrollChanges, [true, false]);
  });

  it('U17c. 窗口活跃中 bind(null)（Virtuoso 卸载路径，不经 unbind）→ 关沿+清定时器', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true, getMode: () => 'virtuoso' });
    const el = makeFakeEl();
    ctrl.bind(el);
    document.fire('touchstart');
    document.fire('touchmove');
    document.fire('touchend');
    assert.deepEqual(scrollChanges, [true]);
    ctrl.bind(null);
    assert.equal(ctrl.isUserScrolling(), false);
    assert.equal(timerQueue.size, 0, '定时器不会带着 null el 到点');
    assert.deepEqual(scrollChanges, [true, false]);
    ctrl.dispose();
  });

  // ─── 18. window blur 兜底清 hold ───────────────────────────────────────
  it('U18. pointerup 丢失（alt-tab）→ blur 清 hold 并起空窗，追底不会永久死亡', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
    el._fire('pointermove', { pointerType: 'mouse', clientX: 0, clientY: 20 });
    advance(10_000);
    assert.equal(ctrl.isUserScrolling(), true, '前置：hold 永挂中');
    window.fire('blur');
    assert.equal(ctrl.isUserScrolling(), true, 'blur 后空窗计时中');
    advance(300);
    assert.equal(ctrl.isUserScrolling(), false, '空窗过后恢复，hold 不再永挂');
    ctrl.dispose();
  });

  // ─── 19. onUserScrollChange 边沿契约 ───────────────────────────────────
  it('U19. 开沿恰一次、关沿恰一次、dispose 后不再回调', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 400 });
    ctrl.bind(el);
    el._fire('wheel', { deltaY: -1 });
    el._fire('wheel', { deltaY: -1 });
    el._fire('wheel', { deltaY: -1 });
    assert.deepEqual(scrollChanges, [true], '高频 wheel 开沿只发一次');
    advance(300);
    assert.deepEqual(scrollChanges, [true, false], '终判关沿一次');
    el._fire('wheel', { deltaY: -1 });
    assert.deepEqual(scrollChanges, [true, false, true], '再开窗再发');
    ctrl.resetUserScrollState();
    assert.deepEqual(scrollChanges, [true, false, true, false], 'reset 关沿一次');
    ctrl.dispose();
    el._fire('wheel', { deltaY: -1 });
    assert.deepEqual(scrollChanges, [true, false, true, false], 'dispose 后不再回调');
  });

  // ─── 20. wheel 与 touch 交错 ───────────────────────────────────────────
  it('U20. touch hold 期间 wheel：hold 不被清、窗口持续、开沿仍只一次', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    document.fire('touchstart');
    el._fire('wheel', { deltaY: -1 });
    assert.deepEqual(scrollChanges, [true], '开沿去抖');
    advance(1000);
    assert.equal(ctrl.isUserScrolling(), true, 'touch hold 仍撑着（wheel 不清 hold）');
    document.fire('touchmove');
    document.fire('touchend');
    advance(300);
    assert.equal(ctrl.isUserScrolling(), false);
    ctrl.dispose();
  });

  // ─── 21. touchSuppressMs 兼容映射 ──────────────────────────────────────
  it('U21. 空窗时长映射：touchSuppressMs 兜底、userScrollIdleMs 优先、0 不被吞', () => {
    const onlyTouch = new StickyBottomController({ touchSuppressMs: 500, now: () => mockNow });
    assert.equal(onlyTouch._userScrollIdleMs, 500, '只传 touchSuppressMs → 沿用');
    const both = new StickyBottomController({ touchSuppressMs: 500, userScrollIdleMs: 200, now: () => mockNow });
    assert.equal(both._userScrollIdleMs, 200, '同传 → userScrollIdleMs 胜出');
    const neither = new StickyBottomController({ now: () => mockNow });
    assert.equal(neither._userScrollIdleMs, 300, '都不传 → 默认 300');
    const zero = new StickyBottomController({ touchSuppressMs: 0, now: () => mockNow, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout });
    assert.equal(zero._userScrollIdleMs, 0, '0 不被默认值吞（?? 语义）');
    zero._onTouchEnd(); // ts=now，但空窗 0 → 永不在窗口内
    assert.equal(zero.isUserScrolling(), false);
    advance(0); // 0ms 定时器立即到期 → _onUserIdle 终判路径（无 boundEl → 仅关沿不自旋）
    assert.equal(timerQueue.size, 0, '零空窗定时器已消化');
    zero.dispose();
  });

  // ─── 22. unbind / bind(null) 释放缓动锁，不留孤儿锁（R2 评审 P1）────────
  it('U22. 缓动持锁中 unbind / bind(null) → 锁释放，决策入口不被孤儿锁堵死', () => {
    const a = makeController({ initialSticky: true });
    const elA = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 360 });
    a.ctrl.bind(elA);
    a.ctrl.startSmoothFollow(elA);
    assert.equal(a.ctrl.isLocked(), true, '前置：缓动链持锁');
    a.ctrl.unbind();
    assert.equal(a.ctrl.isLocked(), false, 'unbind 释放缓动锁');
    assert.equal(a.ctrl._smoothLockHeld, false);
    a.ctrl.dispose();
    const b = makeController({ initialSticky: true, getMode: () => 'virtuoso' });
    const elB = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 360 });
    b.ctrl.bind(elB);
    b.ctrl.startSmoothFollow(elB);
    assert.equal(b.ctrl.isLocked(), true);
    b.ctrl.bind(null); // Virtuoso 卸载路径（不经 unbind）
    assert.equal(b.ctrl.isLocked(), false, 'bind(null) 释放缓动锁');
    assert.equal(b.ctrl._smoothFollowRafId, null, '不留 stale rAF');
    b.ctrl.dispose();
  });

  // ─── 23. 容器外触摸不开窗（R2 评审 P1：横滑代码块不暂停追底）────────────
  it('U23. touchstart target 不在 boundEl 子树 → 整段触摸序列不开窗', () => {
    const { ctrl, scrollChanges } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    const inside = {};
    el.contains = (n) => n === el || n === inside;
    ctrl.bind(el);
    const outside = {};
    document.fire('touchstart', { target: outside });
    document.fire('touchmove', { target: outside });
    document.fire('touchend', { target: outside });
    assert.equal(ctrl.isUserScrolling(), false, '容器外触摸不开窗');
    assert.equal(timerQueue.size, 0, '不起空窗定时器');
    assert.deepEqual(scrollChanges, [], '无开沿');
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1400, '追底不受容器外触摸影响');
    document.fire('touchstart', { target: inside });
    assert.equal(ctrl.isUserScrolling(), true, '容器内触摸照常开窗');
    ctrl.dispose();
  });

  // ─── 24. el 级监听卸载对称性（R2 评审：防回归漏卸）──────────────────────
  it('U24. unbind 摘除全部 el 级监听（scroll/wheel/pointerdown/pointermove）', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl();
    ctrl.bind(el);
    for (const n of ['scroll', 'wheel', 'pointerdown', 'pointermove']) {
      assert.equal(el._hasListener(n), true, `bind 后挂 ${n}`);
    }
    ctrl.unbind();
    for (const n of ['scroll', 'wheel', 'pointerdown', 'pointermove']) {
      assert.equal(el._hasListener(n), false, `unbind 后摘 ${n}`);
    }
  });
});
