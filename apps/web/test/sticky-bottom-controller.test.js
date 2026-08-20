/**
 * StickyBottomController 单测
 *
 * 覆盖（21 case）：
 *   - bind / unbind / dispose 生命周期 + idempotent + 切换 el
 *   - lockDepth 引用计数（writeUnderLock / startSmoothFollow / suppressOnce 三 owner）
 *   - dispose 守卫（rAF 闭包入口、不让 _lockDepth 变负）
 *   - onScroll gap 阈值翻转（>50 / ≤10）
 *   - smoothFollow easeOut step 35% gap，min 1px max 120px
 *   - cancelSmoothFollow 防重入下溢
 *   - RO 回调 sticky/non-sticky 行为 + touchSuppress 抑制
 *   - notifyAtBottom 锁短路 + 60px 兜底 + 16ms 决策去重
 *
 * 单测无法覆盖（依赖手动 5+3 场景验证）：
 *   - setState cb 与浏览器 layout/paint 真实相对时序
 *   - el.scrollHeight 触发 forced layout 实际开销
 *   - Virtuoso 内部 rAF 节流与 controller rAF 排队的交错
 *   - iOS WebKit RO 触发频率特异性 / momentum 期间 scrollTop 写入被忽略
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StickyBottomController } from '../src/utils/stickyBottomController.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

let rafQueue, rafIdSeq, roInstances, origRAF, origCAF, origRO, origDoc;
let mockNow;

function setupGlobals() {
  rafQueue = new Map();
  rafIdSeq = 1;
  roInstances = [];
  mockNow = 1_000_000;

  origRAF = globalThis.requestAnimationFrame;
  origCAF = globalThis.cancelAnimationFrame;
  origRO = globalThis.ResizeObserver;
  origDoc = globalThis.document;

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

  // Mock document for touch listener registration
  const docListeners = new Map();
  globalThis.document = {
    _listeners: docListeners,
    addEventListener: (name, fn) => { (docListeners.get(name) || docListeners.set(name, new Set()).get(name)).add(fn); },
    removeEventListener: (name, fn) => { docListeners.get(name)?.delete(fn); },
    fire: (name, ev = {}) => { docListeners.get(name)?.forEach(fn => { try { fn(ev); } catch {} }); },
    hasListener: (name) => (docListeners.get(name)?.size ?? 0) > 0,
  };
}

function teardownGlobals() {
  globalThis.requestAnimationFrame = origRAF;
  globalThis.cancelAnimationFrame = origCAF;
  globalThis.ResizeObserver = origRO;
  globalThis.document = origDoc;
}

function flushRAF(times = 1) {
  for (let i = 0; i < times; i++) {
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of callbacks) try { cb(); } catch {}
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
  const ctrl = new StickyBottomController({
    getSticky: overrides.getSticky || (() => sticky),
    setSticky: overrides.setSticky || ((v) => { sticky = v; stickyHistory.push(v); }),
    getMode: overrides.getMode || (() => 'desktop'),
    thresholdEnter: overrides.thresholdEnter ?? 10,
    thresholdLeave: overrides.thresholdLeave ?? 50,
    touchSuppressMs: overrides.touchSuppressMs ?? 300,
    atBottomPx: overrides.atBottomPx ?? 60,
    now: () => mockNow,
  });
  return { ctrl, getSticky: () => sticky, setSticky: (v) => { sticky = v; }, stickyHistory };
}

beforeEach(setupGlobals);
afterEach(teardownGlobals);

// ─── 1. bind 桌面模式装 scroll + RO ────────────────────────────────────────
describe('StickyBottomController', () => {
  it('1. bind 桌面模式装 scroll + RO', () => {
    const { ctrl } = makeController({ getMode: () => 'desktop' });
    const el = makeFakeEl();
    ctrl.bind(el);
    assert.equal(el._hasListener('scroll'), true);
    assert.equal(roInstances.length, 1);
    assert.deepEqual(roInstances[0].observed, [el]);
  });

  // ─── 2. bind virtuoso 模式装 RO + 轻量延展 scroll 监听 ─────────────────
  it('2. bind virtuoso 模式装 RO + 仅延展不决策的 scroll 监听', () => {
    const { ctrl } = makeController({ getMode: () => 'virtuoso' });
    const el = makeFakeEl();
    ctrl.bind(el);
    // 用户滚动暂停窗口机制：virtuoso 也挂 scroll，但只做 momentum 延展、不做 sticky 决策
    assert.equal(el._hasListener('scroll'), true);
    assert.equal(roInstances.length, 1);
    // 不排决策 rAF（决策权威仍是 notifyAtBottom）
    el._fire('scroll');
    assert.equal(ctrl._scrollHandlerRafId, null, 'virtuoso scroll 不进决策通道');
  });

  // ─── 3. bind 同 el 重入 idempotent ─────────────────────────────────────
  it('3. bind 同 el 重入 idempotent', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.bind(el);
    ctrl.bind(el);
    assert.equal(roInstances.length, 1, 'RO 不重复创建');
  });

  // ─── 4. bind 切换 el (A→B)，A 监听全卸 ────────────────────────────────
  it('4. bind 切换 el (A→B)，A 的 listener + RO 全卸', () => {
    const { ctrl } = makeController();
    const elA = makeFakeEl();
    const elB = makeFakeEl();
    ctrl.bind(elA);
    ctrl.bind(elB);
    assert.equal(elA._hasListener('scroll'), false, 'A scroll 卸了');
    assert.equal(roInstances[0].disconnected, true, 'A RO disconnected');
    assert.equal(elB._hasListener('scroll'), true, 'B scroll 装了');
    assert.equal(roInstances.length, 2);
  });

  // ─── 5. unbind 全卸 ───────────────────────────────────────────────────
  it('5. unbind 全卸 listener / RO / rAF', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 100);
    assert.ok(rafQueue.size > 0);
    ctrl.unbind();
    assert.equal(el._hasListener('scroll'), false);
    assert.equal(roInstances[0].disconnected, true);
    assert.equal(rafQueue.size, 0, 'rAF 全 cancel');
  });

  // ─── 6. dispose 后所有方法 no-op ───────────────────────────────────────
  it('6. dispose 后所有方法 no-op、不写 scroll', () => {
    const { ctrl, stickyHistory } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.dispose();
    ctrl.writeUnderLock(el, 200);
    ctrl.startSmoothFollow(el);
    ctrl.handleScrollerResize(el);
    ctrl.notifyAtBottom(false);
    ctrl.bind(el);
    assert.equal(el.scrollTop, 0);
    assert.equal(stickyHistory.length, 0);
  });

  // ─── 7. dispose 后正在飞的 RO 回调不写 ─────────────────────────────────
  it('7. dispose 后已 fire 的 RO 回调不写、不 setSticky', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.dispose();
    roInstances[0].fire(el); // 即使 RO 已 disconnect，回调若已排队触发不应改状态
    assert.equal(el.scrollTop, 0);
    assert.equal(stickyHistory.length, 0);
  });

  // ─── 8. dispose 后正在飞的 writeUnderLock rAF 不 decrement 到负数 ─────
  it('8. dispose 后正在飞的 writeUnderLock rAF 不让 _lockDepth 变负', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 500); // _lockDepth=1, 排了 outer rAF
    ctrl.dispose(); // _lockDepth 强制 0
    flushRAF(3);
    assert.equal(ctrl._lockDepth, 0);
  });

  // ─── 9. writeUnderLock 双 rAF 后才解锁 ─────────────────────────────────
  it('9. writeUnderLock 双 rAF 后 _lockDepth--', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 400);
    assert.equal(el.scrollTop, 400);
    assert.equal(ctrl.isLocked(), true, '立即 lock');
    flushRAF(1);
    assert.equal(ctrl.isLocked(), true, '1 帧后还 lock');
    flushRAF(1);
    assert.equal(ctrl.isLocked(), false, '2 帧后解锁');
  });

  // ─── 10. writeUnderLock 期间 onScroll 短路不翻 sticky ──────────────────
  it('10. writeUnderLock 期间 onScroll 短路不翻 sticky', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 100); // 锁住，scrollTop=100，gap=400-100=300
    el.scrollTop = 50;
    el._fire('scroll');
    flushRAF(2);
    assert.equal(stickyHistory.length, 0, '锁期间 setSticky 未被调');
  });

  // ─── 11. 双并发 writeUnderLock 引用计数正确 ────────────────────────────
  it('11. 双并发 writeUnderLock 引用计数正确', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 100); // depth=1
    ctrl.writeUnderLock(el, 200); // depth=2
    assert.equal(ctrl._lockDepth, 2);
    flushRAF(2);
    assert.equal(ctrl._lockDepth, 0, '两次都解');
  });

  // ─── 12. startSmoothFollow + writeUnderLock 并发 lockDepth 正确 ────────
  it('12. startSmoothFollow + 并发 writeUnderLock，lockDepth 路径正确归零', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el); // smooth owner +1
    ctrl.writeUnderLock(el, 200); // write +1
    assert.equal(ctrl._lockDepth, 2);
    // 让 writeUnderLock 解锁
    flushRAF(2);
    assert.equal(ctrl._lockDepth, 1, 'write 已解，smooth 仍持');
    // 让 smoothFollow 跑到底（mockNow 每帧推进越过 33ms 节流门控，缓动才会逐帧移动）
    for (let i = 0; i < 30 && ctrl._smoothFollowRafId !== null; i++) { mockNow += 40; flushRAF(1); }
    mockNow += 40; flushRAF(1);
    // 强制让 smooth follow 完成
    el.scrollTop = el.scrollHeight - el.clientHeight; // gap=0
    for (let i = 0; i < 30 && ctrl._smoothLockHeld; i++) { mockNow += 40; flushRAF(1); }
    assert.equal(ctrl._lockDepth, 0, '最后归零');
  });

  // ─── 13. startSmoothFollow 中途 setSticky(false) 停 step 链 ────────────
  it('13. startSmoothFollow 中途 sticky=false → step 链停 + lockDepth 归零', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 双 rAF + step 第一次
    sticky = false;
    flushRAF(1); // step 检测到非 sticky，release
    assert.equal(ctrl._smoothLockHeld, false);
    assert.equal(ctrl._lockDepth, 0);
  });

  // ─── 14. cancelSmoothFollow 防重入下溢 ─────────────────────────────────
  it('14. cancelSmoothFollow 重复调用不让 _lockDepth 变负', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    assert.equal(ctrl._lockDepth, 1);
    ctrl.cancelSmoothFollow();
    assert.equal(ctrl._lockDepth, 0);
    ctrl.cancelSmoothFollow();
    ctrl.cancelSmoothFollow();
    assert.equal(ctrl._lockDepth, 0, '重复 cancel 不让 lockDepth<0');
  });

  // ─── 15. onScroll gap > 50 翻 sticky=false ─────────────────────────────
  it('15. onScroll gap > thresholdLeave 翻 sticky=false', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el); // refreshFollowTarget → 400
    el.scrollTop = 100; // gap = 400 - 100 = 300 > 50
    el._fire('scroll');
    flushRAF(1);
    assert.deepEqual(stickyHistory, [false]);
  });

  // ─── 16. onScroll gap ≤ 10 翻 sticky=true ──────────────────────────────
  it('16. onScroll gap ≤ thresholdEnter 翻 sticky=true', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: false });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el.scrollTop = 395; // gap = 400-395 = 5 ≤ 10
    el._fire('scroll');
    flushRAF(1);
    assert.deepEqual(stickyHistory, [true]);
  });

  // ─── 17. smoothFollow easeOut step 35% gap，min 1 max 120 ──────────────
  it('17. smoothFollow step 35% gap，min 1px max 120px', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    // 大 gap 测 max 120 限制
    const elBig = makeFakeEl({ scrollHeight: 5000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(elBig);
    ctrl.startSmoothFollow(elBig); // target=4400, gap=4400, 应写 min(4400*0.35, 120)=120
    flushRAF(2); // 双 rAF + step 第一次
    assert.equal(elBig.scrollTop, 120);
    ctrl.dispose();
    // 小 gap 测 35%
    setupGlobals(); // 重置 rAF 状态
    let sticky2 = true;
    const ctrl2 = new StickyBottomController({
      getSticky: () => sticky2, setSticky: (v) => { sticky2 = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    const elSmall = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 300 });
    ctrl2.bind(elSmall);
    ctrl2.startSmoothFollow(elSmall); // target=400, gap=100, 写 100*0.35=35
    flushRAF(2);
    assert.equal(elSmall.scrollTop, 335);
  });

  // ─── 18. RO 回调 sticky=true 调 writeUnderLock ─────────────────────────
  it('18. RO 回调 sticky=true 调 writeUnderLock 跟到底', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el.scrollHeight = 2000; // 模拟 DOM 长高
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1400, 'writeUnderLock 写到 followTarget');
  });

  // ─── 19. RO 回调 sticky=false 不写 ─────────────────────────────────────
  it('19. RO 回调 sticky=false 不写 scrollTop', () => {
    const { ctrl } = makeController({ initialSticky: false });
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 0);
  });

  // ─── 20. touch 拖动后 300ms 用户滚动窗口内 RO 抑制 ─────────────────────
  it('20. touch 拖动 300ms 内 RO 抑制（不写 scrollTop，仍 refreshFollowTarget）', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    document.fire('touchstart');
    document.fire('touchmove'); // 有位移 = 拖动（纯 tap 不开窗，见 user-intent 测试）
    document.fire('touchend');
    el.scrollHeight = 2000;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 0, 'touch 后立即 RO 被抑制');
    assert.equal(ctrl._followTarget, 1400, 'followTarget 仍刷新');
    mockNow += 350;
    el.scrollHeight = 2200;
    roInstances[0].fire(el);
    assert.equal(el.scrollTop, 1600, '350ms 后抑制窗口过，正常跟');
    ctrl.dispose(); // 清空窗定时器，防真实 setTimeout 跨用例泄漏
  });

  // ─── 21. notifyAtBottom 锁短路 + 60px 兜底 + 16ms 决策去重 ─────────────
  it('21. notifyAtBottom 在 lock 期短路；非 lock 期翻 sticky；60px 兜底 + 决策去重', () => {
    const { ctrl, stickyHistory } = makeController({ getMode: () => 'virtuoso', initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 380 }); // realGap=20 ≤ 60
    ctrl.bind(el);
    // 锁期间短路
    ctrl.writeUnderLock(el, 200);
    ctrl.notifyAtBottom(false);
    assert.equal(stickyHistory.length, 0, '锁期间 setSticky 未调');
    flushRAF(2);
    // 非锁期：60px 兜底 — sticky=true 但 isAtBottom=false，realGap=20≤60 → 短路保留 sticky
    el.scrollTop = 380; // realGap=20
    ctrl.notifyAtBottom(false);
    assert.equal(stickyHistory.length, 0, 'realGap≤60 兜底，不翻 sticky=false');
    // 真离底：realGap=200>60 → 翻 false
    el.scrollTop = 200; // realGap=200
    ctrl.notifyAtBottom(false);
    assert.deepEqual(stickyHistory, [false]);
    // 16ms 决策去重：立即再调 false，去重
    ctrl.notifyAtBottom(false);
    assert.deepEqual(stickyHistory, [false], '16ms 内重复决策去重');
    // 17ms 后 true → 翻
    mockNow += 20;
    el.scrollTop = 395; // realGap=5
    ctrl.notifyAtBottom(true);
    assert.deepEqual(stickyHistory, [false, true]);
  });

  // ─── P1 补充：阈值临界 gap == thresholdLeave (严格 > 不翻) ──────────────
  it('22. 阈值临界：gap == thresholdLeave 时不翻 sticky=false (严格 >)', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 350 });
    ctrl.bind(el); // followTarget=400, gap=400-350=50, gap > 50 false
    el._fire('scroll');
    flushRAF(1);
    assert.equal(stickyHistory.length, 0, 'gap==50 不触发翻 false');
  });

  // ─── P1 补充：阈值临界 gap == thresholdEnter (≤ 翻 true) ────────────────
  it('23. 阈值临界：gap == thresholdEnter 时翻 sticky=true (≤ 包含等号)', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: false });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 390 });
    ctrl.bind(el); // followTarget=400, gap=400-390=10
    el._fire('scroll');
    flushRAF(1);
    assert.deepEqual(stickyHistory, [true], 'gap==10 翻 true');
  });

  // ─── P1 补充：不可滚容器 (scrollHeight==clientHeight) startSmoothFollow 立即结束 ─
  it('24. 不可滚容器 startSmoothFollow 立即 release，不反复 step', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 600, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el); // followTarget=0
    ctrl.startSmoothFollow(el);
    assert.equal(ctrl._lockDepth, 1, '入口 acquire 1');
    flushRAF(2); // 双 rAF 后 step 第一次：gap=0-0=0, ≤0.5 → release
    assert.equal(ctrl._lockDepth, 0, 'release 后归零');
    assert.equal(ctrl._smoothFollowRafId, null);
    assert.equal(ctrl._smoothLockHeld, false);
  });

  // ─── P1 补充：dispose 重复调用幂等 + writeUnderLock 飞行中 dispose 不让 lockDepth 下溢 ─
  it('25. dispose 重复调用幂等；飞行中 writeUnderLock rAF 不让 lockDepth 变负', () => {
    const { ctrl } = makeController();
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.writeUnderLock(el, 100); // outer 排队
    ctrl.dispose();
    ctrl.dispose();
    ctrl.dispose();
    assert.equal(ctrl._lockDepth, 0);
    flushRAF(3); // 即使 outer 已 cancel，调度过的回调若仍跑也不应改变 lockDepth
    assert.equal(ctrl._lockDepth, 0);
    assert.equal(ctrl._writeLockRafIds.size, 0, 'rAF id Set 已清空');
  });

  // ─── P1 补充：lock 期间 RO fire 仍刷 followTarget（写入被锁短路）─────────
  it('26. writeUnderLock 期间 RO fire → refreshFollowTarget 仍执行，但 writeUnderLock 被锁吃', () => {
    const { ctrl } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    assert.equal(ctrl._followTarget, 400);
    ctrl.writeUnderLock(el, 100); // 锁住，scrollTop=100
    el.scrollHeight = 2000; // 模拟 DOM 长高
    roInstances[0].fire(el);
    assert.equal(ctrl._followTarget, 1400, 'followTarget 已刷新（lock 不影响 RO 刷缓存）');
    assert.equal(el.scrollTop, 100, 'lock 期间 RO 不强写 scrollTop');
  });

  // ─── 额外：suppressOnce ─────────────────────────────────────────────────
  it('额外：suppressOnce 单帧锁短路', () => {
    const { ctrl, stickyHistory } = makeController({ initialSticky: true });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.suppressOnce();
    assert.equal(ctrl.isLocked(), true);
    el.scrollTop = 100;
    el._fire('scroll');
    flushRAF(1);
    assert.equal(stickyHistory.length, 0, 'suppressOnce 期间 onScroll 短路');
    flushRAF(1);
    assert.equal(ctrl.isLocked(), false, '一帧后解锁');
  });

  // ─── 帧率节流：mockNow 不前进时 step 跳帧（不写 scrollTop），仅在间隔越过后移动 ─────
  it('27. smoothFollow 帧率门控：间隔内跳帧不写 scrollTop，越过 33ms 才移动', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    const el = makeFakeEl({ scrollHeight: 5000, clientHeight: 600, scrollTop: 0 }); // target=4400
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 双 rAF + 首帧 step：lastMoveTs=0 → 立即移动 min(4400*0.35,120)=120
    assert.equal(el.scrollTop, 120, '首帧立即移动（不被节流）');
    // mockNow 不前进 → 后续帧全部被门控跳过，scrollTop 不变，但 rAF 链仍存活
    flushRAF(1);
    flushRAF(1);
    flushRAF(1);
    assert.equal(el.scrollTop, 120, '间隔内的帧被跳过，未写 scrollTop');
    assert.notEqual(ctrl._smoothFollowRafId, null, '节流期 step 链仍存活（重排 rAF）');
    // 推进越过 33ms → 下一帧恢复移动
    mockNow += 40;
    flushRAF(1);
    assert.ok(el.scrollTop > 120, '越过节流间隔后继续缓动');
  });

  // ─── 帧率可调：smoothFollowMinFrameMs=0 关闭节流，恢复每帧移动 ───────────────────
  it('28. smoothFollowMinFrameMs=0 关闭节流：mockNow 不前进也逐帧移动', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow, smoothFollowMinFrameMs: 0,
    });
    const el = makeFakeEl({ scrollHeight: 5000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2);
    assert.equal(el.scrollTop, 120, '首帧 120');
    flushRAF(1); // 节流关闭 → 即使 mockNow 不动也再移动一帧
    assert.ok(el.scrollTop > 120, 'frameMs=0 时不节流，逐帧移动');
  });

  // ─── 节流期取消即时性：sticky 守卫排在门控之前，节流帧里翻 sticky=false 仍立即 release ───
  it('29. 节流窗口内 sticky=false → step 立即 release（守卫先于门控，锁不泄漏）', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    const el = makeFakeEl({ scrollHeight: 5000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 首帧移动，lastMoveTs=mockNow → 后续帧落入节流窗口（mockNow 冻结）
    assert.equal(ctrl._lockDepth, 1);
    sticky = false; // 节流期间取消吸底
    flushRAF(1); // step：!getSticky() 守卫在门控之前命中 → 立即 release，不被节流吞掉
    assert.equal(ctrl._smoothLockHeld, false, '节流期 sticky=false 仍即时 release');
    assert.equal(ctrl._lockDepth, 0, 'lock 归零（无泄漏）');
    assert.equal(ctrl._smoothFollowRafId, null, 'step 链停，不再重排');
  });

  // ─── 节流窗口内 dispose：unbind 取消在飞 rAF、lock 强制归零，节流帧不复活 ───────────────
  it('30. 节流窗口内 dispose → 取消在飞 step rAF + lockDepth 归零', () => {
    let sticky = true;
    const ctrl = new StickyBottomController({
      getSticky: () => sticky, setSticky: (v) => { sticky = v; }, getMode: () => 'desktop',
      now: () => mockNow,
    });
    const el = makeFakeEl({ scrollHeight: 5000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 首帧移动，进入节流窗口
    ctrl.dispose(); // 节流期 dispose：unbind cancel 在飞 rAF，_lockDepth 强制 0
    assert.equal(ctrl._smoothFollowRafId, null);
    assert.equal(ctrl._lockDepth, 0);
    flushRAF(2); // 即使有残留回调也不复活 lock
    assert.equal(ctrl._lockDepth, 0);
  });
});
