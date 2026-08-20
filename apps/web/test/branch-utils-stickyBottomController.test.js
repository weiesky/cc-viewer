/**
 * StickyBottomController 分支补强测（branch coverage 专项）
 *
 * 现有 sticky-bottom-controller.test.js / -integration.test.js 已覆盖主路径，但 branch% 仅 64.74：
 * 缺的是各处守卫的另一臂 + 构造默认值 ||/?? 兜底 + 无 rAF/cAF 环境 fallback。
 * 本文件只补这些缺口，不重复主路径断言。
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let StickyBottomController;
before(async () => {
  const mod = await import('../src/utils/stickyBottomController.js');
  StickyBottomController = mod.StickyBottomController;
});

// ─── 公共 fixtures（rAF/cAF/RO/document mock）────────────────────────────────
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
    hasListener: (n) => (docListeners.get(n)?.size ?? 0) > 0,
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

beforeEach(setupGlobals);
afterEach(teardownGlobals);

describe('StickyBottomController 分支补强', () => {
  // ─── 构造默认值兜底（||、?? 的 falsy 臂）─────────────────────────────────
  it('B1. 空 opts 构造：所有 ||/?? 走默认值兜底臂', () => {
    const ctrl = new StickyBottomController();
    // getSticky 默认 () => false
    assert.equal(ctrl._getSticky(), false);
    // getMode 默认 () => 'desktop'
    assert.equal(ctrl._getMode(), 'desktop');
    // setStickyExternal 默认 NOOP — 调一下不抛
    assert.doesNotThrow(() => ctrl._setStickyExternal(true));
    // 阈值 ?? 默认值
    assert.equal(ctrl._thresholdEnter, 10);
    assert.equal(ctrl._thresholdLeave, 50);
    assert.equal(ctrl._userScrollIdleMs, 300);
    assert.equal(ctrl._atBottomPx, 60);
    assert.equal(ctrl._smoothFollowMinFrameMs, 33);
    // now 默认 Date.now — 返回数字
    assert.equal(typeof ctrl._now(), 'number');
  });

  it('B1b. opts 给定值时走非默认臂（覆盖 ?? 左值/?? 配 0）', () => {
    const ctrl = new StickyBottomController({
      getSticky: () => true,
      setSticky: () => {},
      getMode: () => 'virtuoso',
      thresholdEnter: 0,        // ?? 对 0 取 0（非默认）
      thresholdLeave: 5,
      touchSuppressMs: 0,
      atBottomPx: 0,
      smoothFollowMinFrameMs: 0,
      now: () => 42,
    });
    assert.equal(ctrl._getSticky(), true);
    assert.equal(ctrl._getMode(), 'virtuoso');
    assert.equal(ctrl._thresholdEnter, 0);
    assert.equal(ctrl._thresholdLeave, 5);
    assert.equal(ctrl._userScrollIdleMs, 0, 'touchSuppressMs:0 经兼容映射不被默认值吞');
    assert.equal(ctrl._atBottomPx, 0);
    assert.equal(ctrl._smoothFollowMinFrameMs, 0);
    assert.equal(ctrl._now(), 42);
  });

  // ─── _raf / _cancelRaf：无 rAF/cAF 环境 fallback（line 85-86 / 94-95）────
  it('B2. _raf 无 requestAnimationFrame 时走 setTimeout 兜底（line 85-86）', async () => {
    const savedRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = undefined; // 触发 typeof !== function 臂
    try {
      const ctrl = new StickyBottomController({ now: () => mockNow });
      let fired = false;
      const id = ctrl._raf(() => { fired = true; });
      assert.notEqual(id, null, '返回 setTimeout id');
      await new Promise((r) => setTimeout(r, 5)); // setTimeout(fn,0) 到期
      assert.equal(fired, true, 'setTimeout 兜底回调执行');
    } finally {
      globalThis.requestAnimationFrame = savedRAF;
    }
  });

  it('B3. _cancelRaf id==null 早退（line 90）', () => {
    const ctrl = new StickyBottomController();
    // 不抛、无副作用即覆盖早退臂
    assert.doesNotThrow(() => ctrl._cancelRaf(null));
    assert.doesNotThrow(() => ctrl._cancelRaf(undefined));
  });

  it('B4. _cancelRaf 无 cancelAnimationFrame 时走 clearTimeout 兜底（line 93-95）', () => {
    const savedCAF = globalThis.cancelAnimationFrame;
    globalThis.cancelAnimationFrame = undefined; // 触发 else 臂
    try {
      const ctrl = new StickyBottomController();
      // 用真实 setTimeout 拿一个 id 再 clearTimeout 它
      const id = setTimeout(() => { throw new Error('不该触发'); }, 1000);
      assert.doesNotThrow(() => ctrl._cancelRaf(id));
    } finally {
      globalThis.cancelAnimationFrame = savedCAF;
    }
  });

  it('B4b. _cancelRaf cancelAnimationFrame 抛错被 catch 吞掉', () => {
    const savedCAF = globalThis.cancelAnimationFrame;
    globalThis.cancelAnimationFrame = () => { throw new Error('boom'); };
    try {
      const ctrl = new StickyBottomController();
      assert.doesNotThrow(() => ctrl._cancelRaf(123), 'cAF 抛错被 try/catch 吞');
    } finally {
      globalThis.cancelAnimationFrame = savedCAF;
    }
  });

  // ─── _onScroll 各守卫臂 ─────────────────────────────────────────────────
  it('B5. _onScroll disposed 守卫直接 return', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.dispose();
    // disposed 后 fire scroll：_onScroll 第一守卫 this._disposed return
    assert.doesNotThrow(() => el._fire('scroll'));
  });

  it('B6. _onScroll lockDepth>0 时短路（不排 rAF）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.suppressOnce(); // lockDepth=1
    const before = rafQueue.size;
    el._fire('scroll');
    assert.equal(rafQueue.size, before, 'lock 期间 _onScroll 不排新 rAF');
  });

  it('B7. _onScroll 已有 scrollHandlerRafId 在飞时重复 fire 不二次排队', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    el._fire('scroll'); // 排第一个 scrollHandler rAF
    const sizeAfter1 = rafQueue.size;
    el._fire('scroll'); // _scrollHandlerRafId !== null → 短路
    assert.equal(rafQueue.size, sizeAfter1, '第二次 fire 被 scrollHandlerRafId 守卫短路');
  });

  it('B8. _onScroll rAF 内 disposed → 早退', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    el._fire('scroll'); // 排 rAF
    ctrl.dispose();     // dispose 把在飞 rAF cancel；手动也直接 flush 看不复活
    assert.doesNotThrow(() => flushRAF(1));
  });

  it('B9. _onScroll rAF 内 boundEl 为空 → 早退（!el 臂）', () => {
    // 构造 scrollHandlerRafId 排队后再清掉 boundEl
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    el._fire('scroll'); // 排 scrollHandler rAF
    ctrl._boundEl = null; // 模拟 rAF 跑前 el 被解绑
    assert.doesNotThrow(() => flushRAF(1)); // rAF 内 if (!el) return
  });

  // ─── bind：无 document / 无 ResizeObserver 环境 ─────────────────────────
  it('B10. bind 无 ResizeObserver 环境：跳过 RO 创建（typeof undefined 臂）', () => {
    const savedRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = undefined;
    try {
      const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
      const el = makeFakeEl();
      assert.doesNotThrow(() => ctrl.bind(el));
      assert.equal(ctrl._resizeObserver, null, '无 RO 时不创建');
      assert.equal(el._hasListener('scroll'), true, 'scroll 仍装');
    } finally {
      globalThis.ResizeObserver = savedRO;
    }
  });

  it('B11. bind null el → _boundEl=null 后直接 return（!el 臂）', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl.bind(null); // el=null → 先 detach 旧 el，再 _boundEl=null，return
    assert.equal(ctrl._boundEl, null);
    assert.equal(el._hasListener('scroll'), false, '旧 el scroll 已卸');
  });

  it('B12. _attachTouchListenersOnce 无 document 时跳过', () => {
    const savedDoc = globalThis.document;
    globalThis.document = undefined;
    try {
      const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
      const el = makeFakeEl();
      assert.doesNotThrow(() => ctrl.bind(el));
      assert.equal(ctrl._touchListenersAttached, false, '无 document 不挂 touch');
    } finally {
      globalThis.document = savedDoc;
    }
  });

  it('B13. _attachTouchListenersOnce 第二次调用早退（already attached）', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const elA = makeFakeEl();
    const elB = makeFakeEl();
    ctrl.bind(elA); // attach touch
    assert.equal(ctrl._touchListenersAttached, true);
    ctrl.bind(elB); // 再次 bind 会再走 _attachTouchListenersOnce，命中 already attached 早退
    assert.equal(ctrl._touchListenersAttached, true);
  });

  it('B14. addEventListener 抛错被 catch（scroll 监听）', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    el.addEventListener = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => ctrl.bind(el), 'addEventListener 抛错被吞');
  });

  it('B15. ResizeObserver 构造抛错被 catch', () => {
    const savedRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor() { throw new Error('boom'); } };
    try {
      const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
      const el = makeFakeEl();
      assert.doesNotThrow(() => ctrl.bind(el), 'RO 构造抛错被吞');
    } finally {
      globalThis.ResizeObserver = savedRO;
    }
  });

  // ─── _detachTouchListeners：无 document / removeEventListener 抛错 ────────
  it('B16. _detachTouchListeners 未 attach 时早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    // 从未 bind，touchListenersAttached=false → dispose 调 detach 早退
    assert.doesNotThrow(() => ctrl.dispose());
  });

  it('B17. _detachTouchListeners 无 document 时早退（attach 后置空 document）', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el); // attach touch
    const savedDoc = globalThis.document;
    globalThis.document = undefined; // detach 时 document undefined → 早退（attached 标志仍 true）
    try {
      assert.doesNotThrow(() => ctrl.dispose());
    } finally {
      globalThis.document = savedDoc;
    }
  });

  it('B18. _detachTouchListeners removeEventListener 抛错被 catch', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    const origRemove = globalThis.document.removeEventListener;
    globalThis.document.removeEventListener = () => { throw new Error('boom'); };
    try {
      assert.doesNotThrow(() => ctrl.dispose(), 'removeEventListener 抛错被吞');
    } finally {
      globalThis.document.removeEventListener = origRemove;
    }
  });

  // ─── _detachFromBoundEl：无 el / RO disconnect 抛错 ─────────────────────
  it('B19. _detachFromBoundEl 无 boundEl 时早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    // 从未 bind → unbind 调 _detachFromBoundEl 命中 !el 早退
    assert.doesNotThrow(() => ctrl.unbind());
  });

  it('B20. _detachFromBoundEl RO.disconnect 抛错被 catch', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    ctrl._resizeObserver.disconnect = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => ctrl.unbind(), 'disconnect 抛错被吞');
  });

  it('B21. _detachFromBoundEl removeEventListener(scroll) 抛错被 catch', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    el.removeEventListener = () => { throw new Error('boom'); };
    assert.doesNotThrow(() => ctrl.unbind());
  });

  // ─── unbind：scrollHandlerRafId 非空时 cancel（line 164-167）────────────
  it('B22. unbind 时 scrollHandlerRafId 在飞 → cancel 并置 null（line 164-167）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600 });
    ctrl.bind(el);
    el._fire('scroll'); // 排 scrollHandler rAF
    assert.notEqual(ctrl._scrollHandlerRafId, null, '前置：scrollHandlerRafId 已排队');
    ctrl.unbind();
    assert.equal(ctrl._scrollHandlerRafId, null, 'unbind 已 cancel 并置 null');
  });

  it('B23. unbind 时 smoothFollowRafId 在飞 → cancel 并置 null', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 2000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el); // 排 smoothFollow rAF
    assert.notEqual(ctrl._smoothFollowRafId, null);
    ctrl.unbind();
    assert.equal(ctrl._smoothFollowRafId, null);
  });

  // ─── refreshFollowTarget：disposed / 无 target / scrollHeight??0 兜底 ────
  it('B24. refreshFollowTarget disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    assert.doesNotThrow(() => ctrl.refreshFollowTarget(makeFakeEl()));
  });

  it('B25. refreshFollowTarget 无 el 无 boundEl → 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    assert.doesNotThrow(() => ctrl.refreshFollowTarget()); // target = undefined → return
    assert.equal(ctrl._followTarget, 0);
  });

  it('B26. refreshFollowTarget scrollHeight/clientHeight 为 undefined → ??0 兜底', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = { scrollHeight: undefined, clientHeight: undefined };
    ctrl.refreshFollowTarget(el);
    assert.equal(ctrl._followTarget, 0, 'undefined ??0 → max(0,0-0)=0');
  });

  it('B27. refreshFollowTarget 用 boundEl 兜底（el 入参为空时取 _boundEl）', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1500, clientHeight: 500 });
    ctrl.bind(el);
    ctrl._followTarget = 0;
    ctrl.refreshFollowTarget(); // el 空 → 用 _boundEl
    assert.equal(ctrl._followTarget, 1000);
  });

  // ─── writeUnderLock：入参守卫各臂（line 201-204）────────────────────────
  it('B28. writeUnderLock disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    const el = makeFakeEl();
    ctrl.writeUnderLock(el, 100);
    assert.equal(ctrl._lockDepth, 0, 'disposed 不 lock');
  });

  it('B29. writeUnderLock el 为 null 早退（!el 臂）', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.writeUnderLock(null, 100);
    assert.equal(ctrl._lockDepth, 0);
  });

  it('B30. writeUnderLock el.scrollTop 非 number 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = { scrollTop: 'oops' }; // typeof !== number
    ctrl.writeUnderLock(el, 100);
    assert.equal(ctrl._lockDepth, 0, '非 number scrollTop 不 lock');
  });

  it('B31. writeUnderLock target 非有限数早退（NaN / Infinity）', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = makeFakeEl();
    ctrl.writeUnderLock(el, NaN);
    ctrl.writeUnderLock(el, Infinity);
    assert.equal(ctrl._lockDepth, 0, 'NaN/Infinity 不 lock');
  });

  it('B32. writeUnderLock el.scrollTop= 抛错被 catch（写入失败仍 lock）', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = { get scrollTop() { return 0; }, set scrollTop(_) { throw new Error('boom'); } };
    assert.doesNotThrow(() => ctrl.writeUnderLock(el, 100));
    assert.equal(ctrl._lockDepth, 1, '写抛错被吞，但 lock 已增');
    flushRAF(2);
    assert.equal(ctrl._lockDepth, 0, '双 rAF 后解锁');
  });

  it('B33. writeUnderLock 内层 rAF disposed → 不 decrement（保留 disposed 守卫臂）', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    const el = makeFakeEl();
    ctrl.writeUnderLock(el, 100); // outer 排队
    flushRAF(1); // outer 跑 → 排 inner
    ctrl.dispose(); // 在 inner 跑前 dispose，_lockDepth 强制 0
    flushRAF(1); // inner：disposed 守卫 return
    assert.equal(ctrl._lockDepth, 0);
  });

  // ─── suppressOnce：disposed / rAF disposed 守卫 ─────────────────────────
  it('B34. suppressOnce disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    ctrl.suppressOnce();
    assert.equal(ctrl._lockDepth, 0);
  });

  it('B35. suppressOnce rAF 内 disposed → 不 decrement', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.suppressOnce(); // lock=1, 排 rAF
    ctrl.dispose();      // lock 强制 0
    flushRAF(1);         // rAF: disposed 守卫 return
    assert.equal(ctrl._lockDepth, 0);
  });

  // ─── startSmoothFollow：disposed / 无 scroller / re-entrant cancel（line 246-249）─
  it('B36. startSmoothFollow disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    ctrl.startSmoothFollow(makeFakeEl());
    assert.equal(ctrl._lockDepth, 0);
  });

  it('B37. startSmoothFollow 无 scroller 无 boundEl → 早退', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, now: () => mockNow });
    ctrl.startSmoothFollow(); // scroller=undefined, boundEl=null → return
    assert.equal(ctrl._lockDepth, 0);
  });

  it('B38. startSmoothFollow 已 smoothLockHeld 时不重复 increment + cancel 旧 rAF（line 246-249）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el); // lockHeld=true, lock=1, 排 smoothFollowRafId
    const firstRafId = ctrl._smoothFollowRafId;
    assert.notEqual(firstRafId, null);
    ctrl.startSmoothFollow(el); // 已 lockHeld → 不再 ++；smoothFollowRafId !== null → cancel 旧 + 排新
    assert.equal(ctrl._lockDepth, 1, '不重复 increment');
    assert.equal(ctrl._smoothLockHeld, true);
    assert.notEqual(ctrl._smoothFollowRafId, null, '排了新 rAF');
    assert.equal(rafQueue.has(firstRafId), false, '旧 smoothFollow rAF 已 cancel');
  });

  it('B39. startSmoothFollow 双 rAF 外层 disposed → release', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    ctrl._disposed = true; // 模拟外层 rAF 跑前 disposed（不动 lock 以观察 release）
    flushRAF(1); // 外层 rAF：disposed → release
    assert.equal(ctrl._smoothLockHeld, false, 'release 执行');
  });

  it('B40. startSmoothFollow 内层 rAF disposed → release', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(1); // 外层 rAF 跑 → 排内层
    ctrl._disposed = true;
    flushRAF(1); // 内层 rAF：disposed → release
    assert.equal(ctrl._smoothLockHeld, false);
  });

  it('B41. step 内 disposed → release', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(2); // 双 rAF → step 首次移动（lastMoveTs=0 立即动），排下一 step
    ctrl._disposed = true;
    mockNow += 100; // 越过节流门控，确保进 step body
    flushRAF(1); // step：disposed → release
    assert.equal(ctrl._smoothLockHeld, false);
  });

  it('B42. step gap 非有限数 → release 防死循环（line 271）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    // followTarget 正常，但 scroller.scrollTop 返回 NaN → gap=NaN
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(1); // 外层
    el.scrollTop = NaN; // 内层会 refreshFollowTarget（用 scrollHeight/clientHeight 仍 OK）→ step 读 scrollTop=NaN
    flushRAF(1); // 内层 + step：gap = target - NaN = NaN → !isFinite → release
    assert.equal(ctrl._smoothLockHeld, false, 'gap 非有限 → release');
    assert.equal(ctrl._lockDepth, 0);
  });

  it('B43. step scroller.scrollTop 为 undefined → ??0 兜底（line 268）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 3000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.startSmoothFollow(el);
    flushRAF(1);
    el.scrollTop = undefined; // step current = undefined ?? 0 = 0
    flushRAF(1); // 内层 refreshFollowTarget(target=2400) + step：current=0, gap=2400 → 移动 120
    assert.equal(el.scrollTop, 120, 'current ??0 → 正常缓动');
  });

  // ─── cancelSmoothFollow：disposed / 无 rafId / 无 lockHeld ──────────────
  it('B44. cancelSmoothFollow disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    assert.doesNotThrow(() => ctrl.cancelSmoothFollow());
  });

  it('B45. cancelSmoothFollow 无 rafId 且无 lockHeld → 两 if 都跳过', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    // 从未 startSmoothFollow → smoothFollowRafId=null, smoothLockHeld=false
    ctrl.cancelSmoothFollow();
    assert.equal(ctrl._lockDepth, 0);
  });

  // ─── handleScrollerResize：disposed / 无 target / sticky / lock / touch ──
  it('B46. handleScrollerResize disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    assert.doesNotThrow(() => ctrl.handleScrollerResize(makeFakeEl()));
  });

  it('B47. handleScrollerResize 无 target 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    assert.doesNotThrow(() => ctrl.handleScrollerResize()); // el 空 + boundEl 空
  });

  it('B48. handleScrollerResize lockDepth>0 时短路（sticky 但 lock）', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.suppressOnce(); // lock=1
    el.scrollHeight = 3000;
    ctrl.handleScrollerResize(el); // sticky 但 lockDepth>0 → return（refreshFollowTarget 仍跑）
    assert.equal(ctrl._followTarget, 2400, 'followTarget 已刷');
    assert.equal(el.scrollTop, 0, 'lock 期间不写');
  });

  it('B49. handleScrollerResize touchSuppress 期内短路', () => {
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: () => {}, getMode: () => 'desktop', touchSuppressMs: 300, now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl._onTouchEnd(); // lastUserIntentTs = mockNow → 在用户滚动窗口
    el.scrollHeight = 3000;
    ctrl.handleScrollerResize(el);
    assert.equal(el.scrollTop, 0, 'touch 抑制窗口内不写');
    ctrl.dispose(); // 清空窗定时器，防真实 setTimeout 跨用例泄漏
  });

  // ─── _isWithinTouchSuppress（= isUserScrolling 薄别名）：三臂 ───────────
  it('B50. _isWithinTouchSuppress: touchstart 按住（hold）→ true', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl._onTouchStart(); // _touchHold = true
    assert.equal(ctrl._isWithinTouchSuppress(), true);
    ctrl.dispose();
  });

  it('B51. _isWithinTouchSuppress: 从未有意图（初始 ts=0）→ false', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    // 初始 _lastUserIntentTs=0 → <=0 → false
    assert.equal(ctrl._isWithinTouchSuppress(), false);
  });

  it('B52. _isWithinTouchSuppress: 窗口外（now-ts >= 空窗）→ false', () => {
    let now = 1000;
    const ctrl = new StickyBottomController({ touchSuppressMs: 300, now: () => now });
    ctrl._onTouchEnd(); // lastUserIntentTs = 1000（touchSuppressMs 兼容映射为空窗时长）
    now = 1000 + 350; // 越过 300ms
    assert.equal(ctrl._isWithinTouchSuppress(), false);
    ctrl.dispose();
  });

  it('B53. _isWithinTouchSuppress: 窗口内（now-ts < 空窗）→ true', () => {
    let now = 1000;
    const ctrl = new StickyBottomController({ touchSuppressMs: 300, now: () => now });
    ctrl._onTouchEnd(); // lastUserIntentTs = 1000
    now = 1000 + 100; // 100 < 300
    assert.equal(ctrl._isWithinTouchSuppress(), true);
    ctrl.dispose();
  });

  // ─── notifyAtBottom：disposed / lock / 真值修正 (A) 两条 + (B) ──────────
  it('B54. notifyAtBottom disposed 早退', () => {
    const ctrl = new StickyBottomController({ now: () => mockNow });
    ctrl.dispose();
    assert.doesNotThrow(() => ctrl.notifyAtBottom(true));
  });

  it('B55. notifyAtBottom lockDepth>0 短路', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 });
    ctrl.bind(el);
    ctrl.suppressOnce(); // lock=1
    ctrl.notifyAtBottom(false);
    assert.equal(hist.length, 0, 'lock 期短路');
  });

  it('B56. notifyAtBottom 无 boundEl 时跳过真值修正层，直接走 (B)', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => false, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', now: () => mockNow });
    // 不 bind → el=null → 跳过 (A)，直接 _setSticky
    ctrl.notifyAtBottom(true);
    assert.deepEqual(hist, [true]);
  });

  it('B57. notifyAtBottom el.scrollHeight 非 number 时跳过真值修正层', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => false, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', now: () => mockNow });
    const el = { scrollHeight: 'x', scrollTop: 0, clientHeight: 0, addEventListener() {}, removeEventListener() {} };
    ctrl.bind(el);
    ctrl.notifyAtBottom(true); // scrollHeight 非 number → 跳过 (A)
    assert.deepEqual(hist, [true]);
  });

  it('B58. notifyAtBottom (A) 臂一：!isAtBottom && sticky && realGap<=px → 短路保留', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', atBottomPx: 60, now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 380 }); // realGap=20<=60
    ctrl.bind(el);
    ctrl.notifyAtBottom(false); // Virtuoso 误报离底，但真实距底 20px → 短路不翻 false
    assert.equal(hist.length, 0);
  });

  it('B59. notifyAtBottom (A) 臂二：isAtBottom && !sticky && realGap>px → 短路保留', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => false, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', atBottomPx: 60, now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 }); // realGap=400>60
    ctrl.bind(el);
    ctrl.notifyAtBottom(true); // Virtuoso 误报到底，但真实距底 400px → 短路不翻 true
    assert.equal(hist.length, 0);
  });

  it('B60. notifyAtBottom (A) 两守卫都不命中 → 走 (B) 翻 sticky', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => true, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', atBottomPx: 60, now: () => mockNow });
    const el = makeFakeEl({ scrollHeight: 1000, clientHeight: 600, scrollTop: 0 }); // realGap=400>60
    ctrl.bind(el);
    ctrl.notifyAtBottom(false); // sticky=true, !isAtBottom, realGap=400>60 → 臂一不命中 → 走 (B) 翻 false
    assert.deepEqual(hist, [false]);
  });

  it('B61. notifyAtBottom scrollHeight/scrollTop/clientHeight 为 undefined → ??0 兜底', () => {
    const hist = [];
    const ctrl = new StickyBottomController({ getSticky: () => false, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', now: () => mockNow });
    // scrollHeight 是 number(0)，scrollTop/clientHeight undefined → realGap = 0-0-0 = 0
    const el = { scrollHeight: 0, scrollTop: undefined, clientHeight: undefined, addEventListener() {}, removeEventListener() {} };
    ctrl.bind(el);
    ctrl.notifyAtBottom(true); // isAtBottom && !sticky && realGap(0)>60? 否 → 走 (B)
    assert.deepEqual(hist, [true]);
  });

  // ─── _setSticky：disposed / setStickyExternal 抛错被 catch ──────────────
  it('B62. _setSticky setStickyExternal 抛错被 catch', () => {
    const ctrl = new StickyBottomController({
      getSticky: () => false,
      setSticky: () => { throw new Error('boom'); },
      getMode: () => 'virtuoso',
      now: () => mockNow,
    });
    assert.doesNotThrow(() => ctrl.notifyAtBottom(true), 'setSticky 抛错被吞');
  });

  it('B63. _setSticky 决策去重：同值且窗口内 → return（不调外部）', () => {
    let now = 1000;
    const hist = [];
    const ctrl = new StickyBottomController({
      getSticky: () => false, setSticky: (v) => hist.push(v), getMode: () => 'virtuoso', now: () => now,
    });
    ctrl.notifyAtBottom(true);  // 翻 true
    ctrl.notifyAtBottom(true);  // 同值 + 16ms 窗口内 → 去重
    assert.deepEqual(hist, [true]);
    now += 20; // 越过 16ms
    ctrl.notifyAtBottom(true);  // 同值但窗口外 → 仍调（值未变，但去重条件需 ts 差 < 16）
    assert.deepEqual(hist, [true, true], '窗口外即使同值也调外部');
  });

  // ─── _onTouchStart / _onTouchEnd 直接触发（document.fire 路径）──────────
  it('B64. document touchstart/touchmove/touchend 经监听驱动用户滚动窗口', () => {
    const ctrl = new StickyBottomController({ getMode: () => 'desktop', now: () => mockNow });
    const el = makeFakeEl();
    ctrl.bind(el);
    globalThis.document.fire('touchstart');
    assert.equal(ctrl.isUserScrolling(), true, 'touchstart → hold 撑起窗口');
    globalThis.document.fire('touchmove'); // 有位移 = 拖动
    globalThis.document.fire('touchend');
    assert.equal(ctrl.isUserScrolling(), true, '拖动结束 → 空窗计时中');
    mockNow += 350; // 越过 300ms 空窗
    assert.equal(ctrl.isUserScrolling(), false, '空窗过后窗口关闭');
    ctrl.dispose();
  });
});
