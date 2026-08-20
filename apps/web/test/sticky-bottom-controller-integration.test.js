/**
 * StickyBottomController 集成测（mock ChatView 调用序列）
 *
 * 不挂 React，仅 mock setState / containerRef / virtuosoRef，验证 ChatView 调用 controller 的
 * 序列正确性。覆盖 9 case（含 v2.1 新增 7-9）：
 *   1. constructor → cdM bind → cdU(streamingLatest) → controller.startSmoothFollow 序列
 *   2. mainAgentSessions 引用变 → setState cb sticky 时 writeUnderLock 接管
 *   3. virtuoso atBottomStateChange → controller.notifyAtBottom，lock 期短路
 *   4. scrollToTimestamp 跳转优先于吸底（setState cb 内 _scrollTargetIdx 分支不被覆盖）
 *   5. unmount → controller.dispose → 后续 scroll / RO fire 完全 no-op
 *   6. queueNext 仍能调 scrollToBottom() 走 controller writeUnderLock
 *   7. 桌面 mobileChatVisible 翻起 → controller.writeUnderLock
 *   8. handleStickToBottom 按钮 → controller.writeUnderLock
 *   9. handleLoadMore 桌面分支 → suppressOnce + 维持位置写入 → RO fire 不打断
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StickyBottomController } from '../src/utils/stickyBottomController.js';

let rafQueue, rafIdSeq, roInstances, origRAF, origCAF, origRO, origDoc, mockNow;

function setupGlobals() {
  rafQueue = new Map();
  rafIdSeq = 1;
  roInstances = [];
  mockNow = 1_000_000;
  origRAF = globalThis.requestAnimationFrame;
  origCAF = globalThis.cancelAnimationFrame;
  origRO = globalThis.ResizeObserver;
  origDoc = globalThis.document;
  globalThis.requestAnimationFrame = (fn) => { const id = rafIdSeq++; rafQueue.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = (id) => { rafQueue.delete(id); };
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = false; roInstances.push(this); }
    observe(el) { this.observed.push(el); }
    unobserve(el) { this.observed = this.observed.filter(x => x !== el); }
    disconnect() { this.observed = []; this.disconnected = true; }
    fire(el) { try { this.cb([{ target: el }]); } catch {} }
  };
  const docListeners = new Map();
  globalThis.document = {
    addEventListener: (n, fn) => { (docListeners.get(n) || docListeners.set(n, new Set()).get(n)).add(fn); },
    removeEventListener: (n, fn) => { docListeners.get(n)?.delete(fn); },
    fire: (n, ev = {}) => { docListeners.get(n)?.forEach(fn => { try { fn(ev); } catch {} }); },
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
  };
}

// 模拟 ChatView：维护 sticky / containerRef / virtuosoRef + controller，重现集成路径
function makeFakeChatView({ mode = 'desktop' } = {}) {
  const view = {
    state: { stickyBottom: true },
    containerRef: { current: null },
    virtuosoRef: { current: null },
    _virtuosoScrollerEl: null,
    _scrollTargetIdx: null,
    scrollToTimestamp: null,
    setStateCalls: [],
  };
  view.controller = new StickyBottomController({
    getSticky: () => view.state.stickyBottom,
    setSticky: (v) => { view.state.stickyBottom = v; },
    getMode: () => mode,
    now: () => mockNow,
  });
  view._getScrollEl = () => mode === 'virtuoso' ? view._virtuosoScrollerEl : view.containerRef.current;
  view.cdM = () => { /* bind 在 ref 就绪时 */ };
  view.bindIfReady = () => {
    const el = view._getScrollEl();
    if (el) view.controller.bind(el);
  };
  // 模拟 startRender (plan §E)
  view.startRender = () => {
    view.setStateCalls.push('allItems');
    // setState cb 同步执行 (mock)
    if (view._scrollTargetIdx != null || view.scrollToTimestamp) {
      view.scrollToBottom(); // 跳转分支
      return;
    }
    if (view.state.stickyBottom) {
      const el = view._getScrollEl();
      if (el) view.controller.writeUnderLock(el, el.scrollHeight);
    }
  };
  // 模拟 scrollToBottom（含跳转 + 常规吸底两段）
  view.scrollToBottom = () => {
    if (view._scrollTargetIdx != null && mode === 'virtuoso' && view.virtuosoRef.current) {
      view.virtuosoRef.current.scrollToIndex({ index: view._scrollTargetIdx, align: 'center' });
      return;
    }
    if (!view.state.stickyBottom) return;
    const el = view._getScrollEl();
    if (el) view.controller.writeUnderLock(el, el.scrollHeight);
  };
  view.handleStickToBottom = () => {
    view.state.stickyBottom = true;
    const el = view._getScrollEl();
    if (el) view.controller.writeUnderLock(el, el.scrollHeight);
  };
  // 模拟 handleLoadMore 桌面分支
  view.handleLoadMore = (addedHeight) => {
    const el = view.containerRef.current;
    if (!el) return;
    const prevST = el.scrollTop;
    const prevSH = el.scrollHeight;
    el.scrollHeight = prevSH + addedHeight;
    view.controller.suppressOnce();
    el.scrollTop = prevST + addedHeight;
  };
  view.unmount = () => view.controller.dispose();
  return view;
}

beforeEach(setupGlobals);
afterEach(teardownGlobals);

describe('StickyBottomController × ChatView 集成', () => {
  it('1. constructor → bind → cdU(streamingLatest) → startSmoothFollow 序列', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    // 模拟 streamingLatest 变化
    view.controller.startSmoothFollow(el);
    flushRAF(2);
    assert.ok(el.scrollTop > 0, 'smoothFollow 已写入 scrollTop');
  });

  it('2. mainAgentSessions 引用变 → startRender setState cb 内 sticky 时 writeUnderLock 接管', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    el.scrollHeight = 2000;
    view.startRender();
    assert.equal(el.scrollTop, 2000, 'sticky 时直接写到 scrollHeight');
  });

  it('3. virtuoso atBottomStateChange → notifyAtBottom，lock 期短路', () => {
    const view = makeFakeChatView({ mode: 'virtuoso' });
    const scroller = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 100 }); // realGap=300
    view._virtuosoScrollerEl = scroller;
    view.bindIfReady();
    view.state.stickyBottom = true;
    // 锁期间短路
    view.controller.writeUnderLock(scroller, 200);
    view.controller.notifyAtBottom(false);
    assert.equal(view.state.stickyBottom, true, '锁期间未翻 sticky');
    flushRAF(2);
    // 锁解 → 真实 gap=300>60 → 翻 false
    scroller.scrollTop = 100;
    view.controller.notifyAtBottom(false);
    assert.equal(view.state.stickyBottom, false);
  });

  it('4. scrollToTimestamp 跳转优先于吸底（setState cb 内分支不被 sticky 覆盖）', () => {
    const view = makeFakeChatView({ mode: 'virtuoso' });
    const scroller = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    view._virtuosoScrollerEl = scroller;
    let scrolledToIdx = null;
    view.virtuosoRef.current = {
      scrollToIndex: ({ index }) => { scrolledToIdx = index; },
    };
    view.bindIfReady();
    view._scrollTargetIdx = 42;
    view.startRender();
    assert.equal(scrolledToIdx, 42, '跳转生效');
    assert.equal(scroller.scrollTop, 0, 'scrollTop 未被 sticky 写到底');
  });

  it('5. unmount → dispose → 后续 scroll / RO fire 完全 no-op', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    view.unmount();
    el.scrollTop = 100;
    el._fire('scroll');
    flushRAF(2);
    el.scrollHeight = 5000;
    if (roInstances[0]) roInstances[0].fire(el);
    assert.equal(view.state.stickyBottom, true, 'sticky 不变');
    assert.equal(el.scrollTop, 100, 'scroll fire 不触发吸底');
  });

  it('6. queueNext 仍能调 scrollToBottom() 走 controller writeUnderLock（保留方法名）', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 800, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    view.scrollToBottom();
    assert.equal(el.scrollTop, 800, 'scrollToBottom 走 controller 写到 scrollHeight');
  });

  it('7. 桌面 mobileChatVisible 翻起 → writeUnderLock 写到底', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 2000, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    // 模拟 cdU L660 mobileChatVisible 翻起
    view.controller.writeUnderLock(el, el.scrollHeight);
    assert.equal(el.scrollTop, 2000);
    assert.equal(view.controller.isLocked(), true, '锁住，下一帧 RO 不会重写');
  });

  it('8. handleStickToBottom 按钮 → writeUnderLock', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 600, scrollTop: 0 });
    view.containerRef.current = el;
    view.bindIfReady();
    view.state.stickyBottom = false;
    view.handleStickToBottom();
    assert.equal(view.state.stickyBottom, true, '按钮翻 sticky=true');
    assert.equal(el.scrollTop, 1500);
  });

  it('9. handleLoadMore 桌面：suppressOnce + 维持位置写入 → RO fire 不打断', () => {
    const view = makeFakeChatView();
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 200 });
    view.containerRef.current = el;
    view.bindIfReady();
    view.state.stickyBottom = false; // 用户在历史顶部，sticky 通常 false
    view.handleLoadMore(500); // 加载历史 +500px
    assert.equal(el.scrollTop, 700, '维持视觉位置');
    // 触发 RO，模拟 DOM 长高
    if (roInstances[0]) roInstances[0].fire(el);
    assert.equal(el.scrollTop, 700, 'RO 触发期间被 suppressOnce 锁短路，不被覆盖');
    flushRAF(1);
    assert.equal(view.controller.isLocked(), false, '一帧后解锁');
  });
});
