// StickyBottomController — vanilla JS controller for ChatView 流式吸底状态机
//
// 收敛 7 处独立 scrollTop 写入与 3 套并行吸底机制到单一权威路径。
// 关键不变量：_lockDepth >= 0；dispose 后 _lockDepth === 0 且不再变化。
// 详见 /Users/sky/.claude/plans/modular-floating-hopper.md (v2.1)。
//
// 用户滚动优先（user-scroll intent 暂停窗口）：
// scroll 事件分不清「用户滚」还是「程序滚」，只能靠 _lockDepth 屏蔽——但 SSE 流式期间
// startSmoothFollow 的缓动链被高频重启、锁几乎常驻，用户上滑信号全被吃掉，困死在吸底态。
// 解法：直接监听不可伪造的用户输入（wheel / touch / pointer 拖动），进入「用户滚动中」
// 暂停窗口：窗口内一切自动追底（缓动 / RO 跟底 / 新消息硬贴底）停摆，sticky 随阈值实时
// 翻转；最后一次输入后 userScrollIdleMs（默认 300ms）判定停手，做一次终判并恢复追底。
// 详见 /Users/sky/.claude/plans/snug-purring-wadler.md。

const NOOP = () => {};
const DEFAULT_THRESHOLD_ENTER = 10;
const DEFAULT_THRESHOLD_LEAVE = 50;
// Virtuoso 路径下 footer 子树（lastResponse / spinner / streamingLiveItem 三段）高度抖动会让
// Virtuoso 内部的 atBottom 误判翻转。匹配 Virtuoso atBottomThreshold:60，notifyAtBottom 用此值
// 兜底：仅当真实 DOM 距离 > 60px 才信任 atBottom=false 翻 sticky。
const DEFAULT_AT_BOTTOM_PX = 60;
// _setSticky 决策去重窗口（ms）：同 rAF tick 内 RO + Virtuoso atBottomStateChange 双发时合并。
// 选 16ms 对齐 60Hz 一帧；高刷屏（120Hz/144Hz）下相当于 2 帧，可能压制合法翻转——若实测有手感
// 问题可改 8ms 或动态读 screen.refreshRate（P2 backlog，待手动验证）。
const STICKY_DECISION_DEDUP_MS = 16;

// 平滑追底（startSmoothFollow → step）的帧率节流间隔（ms）。
// step 缓动本会跟随 rAF 跑满显示器刷新率——120Hz ProMotion 屏上 ~120fps，每帧读写 scrollTop
// 触发一次 forced reflow（trace 实测 get/set scrollTop 是 #1 JS 热点 + 229 Layout/s）。
// 流式追底肉眼无需如此密集：门控到 ~30fps（33ms）即与刷新率解耦、视觉等效，主线程 layout/paint
// 负载降 ~4×。可经 opts.smoothFollowMinFrameMs 调整（设 0 = 关闭节流，恢复每帧）。
const DEFAULT_SMOOTH_FOLLOW_MIN_FRAME_MS = 33;

// 用户停手判定空窗（ms）：最后一次用户输入（wheel/touch/pointer 拖动）后超过此时长视为停手，
// 触发终判并恢复自动追底。触控板惯性 wheel 事件流与 momentum scroll 事件会持续刷新窗口。
const DEFAULT_USER_SCROLL_IDLE_MS = 300;
// pointer 拖动资格判定（slop）：pointerdown 后位移超过此值才算「拖动」开窗。纯点击（展开
// 工具结果 / 复制 / 加载更早）零位移，不开窗——否则每次点击都暂停追底 300ms，且点击展开
// 导致内容长高 >thresholdLeave 时会被终判误降级踢出吸底。
const POINTER_DRAG_SLOP_PX = 5;

export class StickyBottomController {
  constructor(opts = {}) {
    this._getSticky = opts.getSticky || (() => false);
    this._setStickyExternal = opts.setSticky || NOOP;
    this._getMode = opts.getMode || (() => 'desktop');
    this._thresholdEnter = opts.thresholdEnter ?? DEFAULT_THRESHOLD_ENTER;
    this._thresholdLeave = opts.thresholdLeave ?? DEFAULT_THRESHOLD_LEAVE;
    // 兼容映射：旧 touchSuppressMs 语义被统一空窗超集覆盖；显式传入且未传 userScrollIdleMs
    // 时沿用其值（?? 保证 0 这种合法值不被默认值吞掉）。
    this._userScrollIdleMs = opts.userScrollIdleMs ?? opts.touchSuppressMs ?? DEFAULT_USER_SCROLL_IDLE_MS;
    this._atBottomPx = opts.atBottomPx ?? DEFAULT_AT_BOTTOM_PX;
    this._smoothFollowMinFrameMs = opts.smoothFollowMinFrameMs ?? DEFAULT_SMOOTH_FOLLOW_MIN_FRAME_MS;
    this._now = opts.now || (() => Date.now());
    // 定时器可注入（与 opts.now 对称）：测试单一时钟源，避免 fake-timer 双钟漂移
    this._setTimeout = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = opts.clearTimeout || ((id) => clearTimeout(id));
    this._onUserScrollChange = opts.onUserScrollChange || NOOP;

    this._lockDepth = 0;
    this._smoothLockHeld = false;
    this._followTarget = 0;
    this._smoothFollowRafId = null;
    this._scrollHandlerRafId = null;
    // Set 而非 Array：流式高频 writeUnderLock 时 add/delete 都 O(1)；Array.filter 是 O(n)
    // 累积成 O(n²) 帧成本，是 perf-auditor 找出的 P0 内存泄漏路径。
    this._writeLockRafIds = new Set();
    this._resizeObserver = null;
    this._boundEl = null;
    this._touchListenersAttached = false;
    // 决策去重快照：拆为两字段而非 { value, ts } 对象，避免 _setSticky 高频调用时重复 GC
    this._lastStickyValue = null; // boolean | null（null = 尚无决策）
    this._lastStickyTs = 0;
    this._disposed = false;

    // ── 用户滚动意图状态 ──
    // _pointerHold / _touchHold 必须是两个独立布尔：触摸设备浏览器接管滚动时会发
    // pointercancel，单布尔会被它误清掉 touch 的 hold → 手指按住不动 >空窗 即被终判拽底。
    this._pointerHold = false;
    this._touchHold = false;
    this._pointerTracking = false; // pointerdown 已发生、等待 slop 升级
    this._pointerDownX = 0;
    this._pointerDownY = 0;
    this._touchSession = false; // touchstart 已发生（区分测试直调 _onTouchEnd 的旧路径）
    this._touchMoved = false;   // touchstart 后是否有 touchmove（tap 判定）
    this._touchIgnored = false; // touchstart 落在容器外（横滑代码块/DiffView 等），整段序列不开窗
    this._lastUserIntentTs = 0; // 0 = 从未有过意图
    this._userIdleTimer = null;
    this._userScrollActive = false; // 窗口开/关沿（onUserScrollChange 去抖）

    this._onScroll = () => {
      if (this._disposed) return;
      if (this._lockDepth > 0) return;
      this._extendMomentumWindow();
      this._scheduleStickyDecision();
    };

    // virtuoso 模式的轻量 scroll 监听：仅做 momentum 延展（安卓 fling 惯性常超空窗，无延展
    // 会在惯性中被终判补追杀掉 fling），不做 sticky 决策——决策权威仍是 notifyAtBottom。
    this._onVirtuosoScroll = () => {
      if (this._disposed) return;
      if (this._lockDepth > 0) return;
      this._extendMomentumWindow();
    };

    this._onWheel = (e) => {
      if (this._disposed) return;
      const dy = (e && typeof e.deltaY === 'number') ? e.deltaY : 0;
      // 上滚恒为意图；下滚仅在未吸底时算意图（贴底下滚无位移可言，不为此打断追底）
      if (dy < 0 || !this._getSticky()) this._noteUserIntent();
    };

    this._onPointerDown = (e) => {
      if (this._disposed) return;
      if (e && e.pointerType === 'touch') return; // 触摸由 touch 通道负责
      const el = this._boundEl;
      // 纵向滚动条区域按下（offsetX 超出 clientWidth）：滚动条拖动期间浏览器不派发
      // pointermove 给页面，slop 升级不可用 → 直接按时间戳开窗，拖动产生的 scroll 事件
      // 经 momentum 延展续窗。
      if (el && e && e.target === el && typeof e.offsetX === 'number'
          && typeof el.clientWidth === 'number' && e.offsetX >= el.clientWidth) {
        this._noteUserIntent();
        return;
      }
      this._pointerTracking = true;
      this._pointerDownX = (e && typeof e.clientX === 'number') ? e.clientX : 0;
      this._pointerDownY = (e && typeof e.clientY === 'number') ? e.clientY : 0;
    };

    this._onPointerMove = (e) => {
      if (this._disposed) return;
      if (e && e.pointerType === 'touch') return;
      if (!this._pointerTracking || this._pointerHold) return;
      const dx = ((e && typeof e.clientX === 'number') ? e.clientX : 0) - this._pointerDownX;
      const dy = ((e && typeof e.clientY === 'number') ? e.clientY : 0) - this._pointerDownY;
      if ((dx * dx + dy * dy) > POINTER_DRAG_SLOP_PX * POINTER_DRAG_SLOP_PX) {
        this._pointerHold = true; // slop 达标：拖滚动条外的内容拖动（选文本等）
        this._noteUserIntent({ setTs: false }); // hold 本身即意图，时间戳等释放时再记
      }
    };

    this._onPointerUp = (e) => {
      if (this._disposed) return;
      if (e && e.pointerType === 'touch') return;
      this._pointerTracking = false;
      if (!this._pointerHold) return; // 纯点击从未开窗，无事可做
      this._pointerHold = false;
      this._lastUserIntentTs = this._now();
      this._armUserIdleTimer();
    };

    this._onTouchStart = (ev) => {
      if (this._disposed) return;
      // 容器子树过滤：touch 监听挂在 document，横滑代码块/DiffView、滑 RoleFilterBar 等
      // 「非滚 chat」的触摸不应暂停追底。事件无 target（测试直调）时跳过过滤，保持旧语义。
      const el = this._boundEl;
      if (el && ev && ev.target && typeof el.contains === 'function' && !el.contains(ev.target)) {
        this._touchIgnored = true;
        return;
      }
      this._touchIgnored = false;
      this._touchSession = true;
      this._touchMoved = false;
      this._touchHold = true;
      this._noteUserIntent({ setTs: false });
    };

    this._onTouchMove = () => {
      if (this._touchHold) this._touchMoved = true;
    };

    this._onTouchEnd = () => {
      if (this._disposed) return;
      if (this._touchIgnored) { this._touchIgnored = false; return; } // 容器外序列整段忽略
      const wasSession = this._touchSession;
      const moved = this._touchMoved;
      this._touchSession = false;
      this._touchHold = false;
      if (wasSession && !moved) {
        // 纯 tap（点展开/复制等）：不起空窗，立即关窗，RO 跟底不中断
        this._lastUserIntentTs = 0;
        this._cancelUserIdleTimer();
        if (!this.isUserScrolling()) this._setUserScrollActive(false);
        return;
      }
      // 拖动结束（或测试直调 _onTouchEnd 的旧 touch 抑制路径）：起空窗计时
      this._lastUserIntentTs = this._now();
      this._armUserIdleTimer();
    };

    // pointerup 丢失兜底（alt-tab、原生右键菜单等场景收不到 up）：hold 永挂 = 追底永久死亡
    this._onWindowBlur = () => {
      if (this._disposed) return;
      if (!this._pointerHold && !this._touchHold && !this._pointerTracking) return;
      this._pointerHold = false;
      this._touchHold = false;
      this._pointerTracking = false;
      this._touchSession = false;
      this._lastUserIntentTs = this._now();
      this._armUserIdleTimer();
    };
  }

  _raf(fn) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return globalThis.requestAnimationFrame(fn);
    }
    // SSR / 缺失 rAF 环境：setTimeout 0 兜底（同步语义不可恢复，但至少不挂死）
    return setTimeout(fn, 0);
  }

  _cancelRaf(id) {
    if (id == null) return;
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      try { globalThis.cancelAnimationFrame(id); } catch {}
    } else {
      try { clearTimeout(id); } catch {}
    }
  }

  _setSticky(value) {
    if (this._disposed) return;
    const ts = this._now();
    if (this._lastStickyValue === value && (ts - this._lastStickyTs) < STICKY_DECISION_DEDUP_MS) {
      return;
    }
    this._lastStickyValue = value;
    this._lastStickyTs = ts;
    try { this._setStickyExternal(value); } catch {}
  }

  // ── 用户滚动意图机制 ──────────────────────────────────────────────────────

  // 统一意图入口：wheel / touchstart / pointer 拖动达标 / 滚动条按下 都汇到这里。
  // setTs=false 用于 hold 型意图（按住期间 isUserScrolling 由 hold 撑着，时间戳等释放再记，
  // 这样纯 tap 可以无痕撤销、不留 300ms 尾巴）。
  _noteUserIntent({ setTs = true } = {}) {
    if (this._disposed) return;
    if (setTs) this._lastUserIntentTs = this._now();
    // 逃逸关键步：同步释放缓动锁，让紧随其后的 scroll / atBottomStateChange 信号不再被锁吃掉
    this.cancelSmoothFollow();
    this._setUserScrollActive(true);
    this._armUserIdleTimer();
    // 主动调度一次决策 rAF（绕过事件层锁检查）：意图可能恰落在 writeUnderLock 双 rAF 残留
    // 锁（≤2 帧）内，首批 scroll 事件被吞——主动决策保证「上滑立刻显示按钮」真正立刻。
    this._scheduleStickyDecision();
  }

  // 窗口开/关沿（去抖：仅翻转沿发回调）。故意不查 _disposed：dispose 路径也要把关沿发出去，
  // 保证不变量「dispose 后 _userScrollActive === false 且关沿回调已发」（宿主有 _unmounted 兜底）。
  _setUserScrollActive(active) {
    if (this._userScrollActive === active) return;
    this._userScrollActive = active;
    try { this._onUserScrollChange(active); } catch {}
  }

  // 自检重排定时器：armed 即不动（高频 wheel 只刷时间戳零 churn），到点时不满空窗按剩余重排
  _armUserIdleTimer() {
    if (this._userIdleTimer != null) return;
    this._userIdleTimer = this._setTimeout(() => {
      this._userIdleTimer = null;
      this._onUserIdle();
    }, this._userScrollIdleMs);
  }

  _cancelUserIdleTimer() {
    if (this._userIdleTimer == null) return;
    try { this._clearTimeout(this._userIdleTimer); } catch {}
    this._userIdleTimer = null;
  }

  // 停手终判：用户停止手动滚动后按位置重新判定 sticky，并在吸底时恢复追底补欠距
  _onUserIdle() {
    if (this._disposed) return;
    // hold 中到点：不重排（剩余时间为负会 setTimeout(0) 自旋），靠 pointerup/touchend 接力 re-arm
    if (this._pointerHold || this._touchHold) return;
    const elapsed = this._now() - this._lastUserIntentTs;
    if (this._lastUserIntentTs > 0 && elapsed < this._userScrollIdleMs) {
      this._userIdleTimer = this._setTimeout(() => {
        this._userIdleTimer = null;
        this._onUserIdle();
      }, Math.max(0, this._userScrollIdleMs - elapsed));
      return;
    }
    const el = this._boundEl;
    if (!el) {
      // 无绑定元素也必须关沿，否则宿主 userScrolling 永真、followOutput 永久残废
      this._setUserScrollActive(false);
      return;
    }
    this.refreshFollowTarget(el);
    // 终判按模式分流：desktop 用 enter/leave 滞回；virtuoso 用 atBottomPx 单边界——
    // 否则 gap∈(thresholdLeave, atBottomPx] 区间终判翻 false 会被下一次 Virtuoso
    // atBottomStateChange(true) 强行推翻、用户被拽回。
    let sticky = this._getSticky();
    if (this._getMode() === 'virtuoso') {
      const realGap = (el.scrollHeight ?? 0) - (el.scrollTop ?? 0) - (el.clientHeight ?? 0);
      if (Number.isFinite(realGap)) sticky = realGap <= this._atBottomPx;
    } else {
      const gap = this._followTarget - (el.scrollTop ?? 0);
      if (gap <= this._thresholdEnter) sticky = true;
      else if (gap > this._thresholdLeave) sticky = false;
      // 中间带：维持现状
    }
    this._setSticky(sticky);
    this._setUserScrollActive(false);
    if (sticky) this.startSmoothFollow(el);
  }

  // sticky 决策（rAF 防抖统一通道）：_onScroll 事件路径与 _noteUserIntent 主动路径共用
  _scheduleStickyDecision() {
    if (this._scrollHandlerRafId !== null) return;
    this._scrollHandlerRafId = this._raf(() => {
      this._scrollHandlerRafId = null;
      if (this._disposed) return;
      const el = this._boundEl;
      if (!el) return;
      // 窗口内缓动停摆、_followTarget 无人保鲜，内容长高时用冻结值会造成「滚回旧底部
      // sticky 闪现又被终判翻回」的按钮闪烁——决策前刷新（成本与 30fps 缓动同阶，仅交互期）
      if (this.isUserScrolling()) this.refreshFollowTarget(el);
      const sticky = this._getSticky();
      if (this._getMode() === 'virtuoso') {
        // virtuoso 用与 notifyAtBottom 真值修正层一致的 60px 单边界，避免双权威打架
        const realGap = (el.scrollHeight ?? 0) - (el.scrollTop ?? 0) - (el.clientHeight ?? 0);
        if (!Number.isFinite(realGap)) return;
        if (sticky && realGap > this._atBottomPx) this._setSticky(false);
        else if (!sticky && realGap <= this._atBottomPx) this._setSticky(true);
        return;
      }
      const gap = this._followTarget - el.scrollTop;
      if (sticky && gap > this._thresholdLeave) {
        this._setSticky(false);
      } else if (!sticky && gap <= this._thresholdEnter) {
        this._setSticky(true);
      }
    });
  }

  // 松手惯性期续窗：窗口活跃且非按住时，scroll 事件刷新意图时间戳（hold 期由 hold 自己撑窗）。
  // 调用方必须先过 _lockDepth 检查——程序滚在锁内短路，不会误延展。
  _extendMomentumWindow() {
    if (this._pointerHold || this._touchHold) return;
    if (this._lastUserIntentTs <= 0) return;
    if ((this._now() - this._lastUserIntentTs) >= this._userScrollIdleMs) return;
    this._lastUserIntentTs = this._now();
  }

  // 是否处于「用户滚动中」窗口：hold 撑着，或最后一次意图在空窗内。
  // _lastUserIntentTs > 0 臂必须保留（「从未有过意图」→ false，小时钟注入下依赖）。
  isUserScrolling() {
    if (this._pointerHold || this._touchHold) return true;
    if (this._lastUserIntentTs <= 0) return false;
    return (this._now() - this._lastUserIntentTs) < this._userScrollIdleMs;
  }

  // 旧名薄别名（touch 抑制语义已被统一空窗超集覆盖；既有测试直调此名）
  _isWithinTouchSuppress() { return this.isUserScrolling(); }

  // 显式动作（「回到底部」按钮、移动端面板切换）清除用户滚动窗口：用户明确要贴底，
  // 残留窗口不应再抑制任何自动追底
  resetUserScrollState() {
    this._pointerHold = false;
    this._touchHold = false;
    this._pointerTracking = false;
    this._touchSession = false;
    this._touchMoved = false;
    this._touchIgnored = false;
    this._lastUserIntentTs = 0;
    this._cancelUserIdleTimer();
    this._setUserScrollActive(false);
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  _attachTouchListenersOnce() {
    if (this._touchListenersAttached) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this._touchListenersAttached = true;
    try { document.addEventListener('touchstart', this._onTouchStart, { passive: true }); } catch {}
    try { document.addEventListener('touchmove', this._onTouchMove, { passive: true }); } catch {}
    try { document.addEventListener('touchend', this._onTouchEnd, { passive: true }); } catch {}
    try { document.addEventListener('touchcancel', this._onTouchEnd, { passive: true }); } catch {}
    try { document.addEventListener('pointerup', this._onPointerUp, { passive: true }); } catch {}
    try { document.addEventListener('pointercancel', this._onPointerUp, { passive: true }); } catch {}
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      try { window.addEventListener('blur', this._onWindowBlur); } catch {}
    }
  }

  _detachTouchListeners() {
    if (!this._touchListenersAttached) return;
    if (typeof document === 'undefined' || typeof document.removeEventListener !== 'function') return;
    try { document.removeEventListener('touchstart', this._onTouchStart); } catch {}
    try { document.removeEventListener('touchmove', this._onTouchMove); } catch {}
    try { document.removeEventListener('touchend', this._onTouchEnd); } catch {}
    try { document.removeEventListener('touchcancel', this._onTouchEnd); } catch {}
    try { document.removeEventListener('pointerup', this._onPointerUp); } catch {}
    try { document.removeEventListener('pointercancel', this._onPointerUp); } catch {}
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      try { window.removeEventListener('blur', this._onWindowBlur); } catch {}
    }
    this._touchListenersAttached = false;
  }

  bind(el) {
    if (this._disposed) return;
    if (el === this._boundEl) return; // idempotent
    if (this._boundEl) this._detachFromBoundEl();
    this._boundEl = el || null;
    if (!el) return;
    const mode = this._getMode();
    if (mode !== 'virtuoso') {
      try { el.addEventListener('scroll', this._onScroll, { passive: true }); } catch {}
    } else {
      try { el.addEventListener('scroll', this._onVirtuosoScroll, { passive: true }); } catch {}
    }
    try { el.addEventListener('wheel', this._onWheel, { passive: true }); } catch {}
    try { el.addEventListener('pointerdown', this._onPointerDown, { passive: true }); } catch {}
    try { el.addEventListener('pointermove', this._onPointerMove, { passive: true }); } catch {}
    if (typeof ResizeObserver !== 'undefined') {
      try {
        this._resizeObserver = new ResizeObserver(() => this.handleScrollerResize(el));
        this._resizeObserver.observe(el);
      } catch {}
    }
    this.refreshFollowTarget(el);
    this._attachTouchListenersOnce();
  }

  _detachFromBoundEl() {
    const el = this._boundEl;
    if (!el) return;
    try { el.removeEventListener('scroll', this._onScroll); } catch {}
    try { el.removeEventListener('scroll', this._onVirtuosoScroll); } catch {}
    try { el.removeEventListener('wheel', this._onWheel); } catch {}
    try { el.removeEventListener('pointerdown', this._onPointerDown); } catch {}
    try { el.removeEventListener('pointermove', this._onPointerMove); } catch {}
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch {}
      this._resizeObserver = null;
    }
    this._boundEl = null;
    // 换绑/解绑（Virtuoso 卸载走 bind(null)，不经 unbind）必须：
    // ① 取消缓动链并释放其锁——只 cancel rAF 不 release 会留下孤儿锁（_lockDepth 卡 1），
    //    在重新 bind 前堵死 _onScroll/notifyAtBottom/RO 三条决策入口；
    // ② 复位用户滚动窗口——否则定时器带着 null el 到点、userScrolling 开沿永不关闭。
    this.cancelSmoothFollow();
    this.resetUserScrollState();
  }

  unbind() {
    this.cancelSmoothFollow(); // _boundEl 已空时 _detachFromBoundEl 早退，孤儿锁在此兜底释放
    this._detachFromBoundEl();
    this.resetUserScrollState();
    if (this._scrollHandlerRafId !== null) {
      this._cancelRaf(this._scrollHandlerRafId);
      this._scrollHandlerRafId = null;
    }
    if (this._smoothFollowRafId !== null) {
      this._cancelRaf(this._smoothFollowRafId);
      this._smoothFollowRafId = null;
    }
    for (const id of this._writeLockRafIds) this._cancelRaf(id);
    this._writeLockRafIds.clear();
  }

  dispose() {
    if (this._disposed) return;
    // 先关沿再置 _disposed：保证关沿回调发得出去（不变量：dispose 后 _userScrollActive===false）
    this.resetUserScrollState();
    this._disposed = true;
    this.unbind();
    this._detachTouchListeners();
    this._lockDepth = 0;
    this._smoothLockHeld = false;
  }

  isLocked() { return this._lockDepth > 0; }

  refreshFollowTarget(el) {
    if (this._disposed) return;
    const target = el || this._boundEl;
    if (!target) return;
    const sh = target.scrollHeight ?? 0;
    const ch = target.clientHeight ?? 0;
    this._followTarget = Math.max(0, sh - ch);
  }

  // Single authoritative scrollTop write entry.
  // 双 rAF 后 _lockDepth--。期间 _onScroll / RO writeUnderLock 都会被锁短路。
  // 所有入参守卫（disposed / el / 类型 / 数值有限性）必须在 _lockDepth++ 之前完成，
  // 防极端值（NaN/Infinity）/非法元素让 lock 白占一个 rAF 周期（防 DoS + 防御）。
  // 注意：不查 isUserScrolling——这是显式动作（回到底部按钮等）的通道，必须保持畅通；
  // 自动追底调用方各自把关。
  writeUnderLock(el, target) {
    if (this._disposed) return;
    if (!el) return;
    if (typeof el.scrollTop !== 'number') return;
    if (!Number.isFinite(target)) return;
    this._lockDepth++;
    try { el.scrollTop = target; } catch {}
    let inner = null;
    const outer = this._raf(() => {
      this._writeLockRafIds.delete(outer);
      if (this._disposed) return;
      inner = this._raf(() => {
        this._writeLockRafIds.delete(inner);
        if (this._disposed) return;
        this._lockDepth = Math.max(0, this._lockDepth - 1);
      });
      if (inner != null) this._writeLockRafIds.add(inner);
    });
    if (outer != null) this._writeLockRafIds.add(outer);
  }

  // 单次锁短路一帧（handleLoadMore 桌面分支用：裸写 scrollTop 后让 RO fire 被吃掉）
  suppressOnce() {
    if (this._disposed) return;
    this._lockDepth++;
    const id = this._raf(() => {
      this._writeLockRafIds.delete(id);
      if (this._disposed) return;
      this._lockDepth = Math.max(0, this._lockDepth - 1);
    });
    if (id != null) this._writeLockRafIds.add(id);
  }

  // 缓动追底：双 rAF 等 layout 完，然后 step easeOut（35% gap，min 1px max 120px）
  // _smoothLockHeld 是 owner 标记，整条 step 链占 1 个 lock 引用；嵌套 startSmoothFollow
  // 不重复 increment（已持有 owner 的 lock）。
  // 帧率节流：step 用 _smoothFollowMinFrameMs（默认 33ms≈30fps）门控——未到间隔的帧只重排
  // rAF、不读写 scrollTop，避免每帧 forced reflow（与显示器刷新率解耦，可经 opts 调整）。
  // 用户滚动窗口内整体停摆（入口 + step 双守卫）：SSE 高频重启在窗口内全部 no-op，
  // 锁不会被重新抓走，用户的 scroll 信号得以进入决策通道。
  startSmoothFollow(el) {
    if (this._disposed) return;
    if (this.isUserScrolling()) return;
    const scroller = el || this._boundEl;
    if (!scroller) return;
    if (!this._smoothLockHeld) {
      this._lockDepth++;
      this._smoothLockHeld = true;
    }
    if (this._smoothFollowRafId !== null) {
      this._cancelRaf(this._smoothFollowRafId);
      this._smoothFollowRafId = null;
    }
    // 上一次实际移动 scrollTop 的时间戳（闭包内，每条 step 链独立）；0 = 首帧立即移动，不被节流
    let lastMoveTs = 0;
    const release = () => {
      if (!this._smoothLockHeld) return;
      this._smoothLockHeld = false;
      this._lockDepth = Math.max(0, this._lockDepth - 1);
    };
    const step = () => {
      this._smoothFollowRafId = null;
      if (this._disposed) { release(); return; }
      if (!this._getSticky()) { release(); return; }
      // 竞态臂：意图事件经 cancelSmoothFollow 同步取消链，这里兜两帧之间事件未及取消的极端情况
      if (this.isUserScrolling()) { release(); return; }
      // 帧率门控：距上次移动不足 _smoothFollowMinFrameMs 则跳过本帧（不触碰 layout），仅重排 rAF。
      // disposed / sticky 守卫放在门控之前，保证取消语义在节流期间仍即时生效。
      if (this._smoothFollowMinFrameMs > 0 && (this._now() - lastMoveTs) < this._smoothFollowMinFrameMs) {
        this._smoothFollowRafId = this._raf(step);
        return;
      }
      const target = this._followTarget;
      const current = scroller.scrollTop ?? 0;
      const gap = target - current;
      // 非有限数（scroller 异常 / target 缓存被污染）防御：直接 release 避免死循环 step
      if (!Number.isFinite(gap)) { release(); return; }
      if (gap <= 0.5) {
        try { scroller.scrollTop = target; } catch {}
        release();
        return;
      }
      lastMoveTs = this._now();
      const delta = Math.max(1, Math.min(gap * 0.35, 120));
      try { scroller.scrollTop = current + delta; } catch {}
      this._smoothFollowRafId = this._raf(step);
    };
    // 双 rAF：先让新内容 layout 完成再测量 target
    this._smoothFollowRafId = this._raf(() => {
      if (this._disposed) { release(); return; }
      this._smoothFollowRafId = this._raf(() => {
        if (this._disposed) { release(); return; }
        this.refreshFollowTarget(scroller);
        step();
      });
    });
  }

  cancelSmoothFollow() {
    if (this._disposed) return;
    if (this._smoothFollowRafId !== null) {
      this._cancelRaf(this._smoothFollowRafId);
      this._smoothFollowRafId = null;
    }
    if (this._smoothLockHeld) {
      this._smoothLockHeld = false;
      this._lockDepth = Math.max(0, this._lockDepth - 1);
    }
  }

  // RO 回调统一入口：尺寸变 → 刷缓存 → sticky 时跟到底（受 lock + 用户滚动窗口守卫）
  handleScrollerResize(el) {
    if (this._disposed) return;
    const target = el || this._boundEl;
    if (!target) return;
    this.refreshFollowTarget(target);
    if (!this._getSticky()) return;
    if (this._lockDepth > 0) return;
    if (this.isUserScrolling()) return;
    this.writeUnderLock(target, this._followTarget);
  }

  // Virtuoso atBottomStateChange 接管入口。
  //
  // 这个方法整合两层职责（按下到上）：
  //   ── (A) Virtuoso 真值修正层 ──
  //         Virtuoso footer 子树（lastResponse / spinner / streamingLiveItem 三段）高度抖动
  //         会让内部 atBottom 误判翻转。用真实 DOM 距离 ≤/> _atBottomPx 兜底，过滤掉抖动。
  //   ── (B) 状态翻转决策层 ──
  //         走 _setSticky 享受 16ms 决策去重（合并同 tick 内 RO + Virtuoso 双发）。
  //
  // 锁期间统一短路（保留 Virtuoso 真实 atBottom 不可靠）。未来若有 iPad 等新 scroller 出
  // 类似 atBottom 不可靠场景，可考虑把 (A) 抽成可插拔的 correctionFn。
  notifyAtBottom(isAtBottom) {
    if (this._disposed) return;
    if (this._lockDepth > 0) return;
    // (A) 真值修正：DOM 实测距离 vs _atBottomPx 兜底
    const el = this._boundEl;
    if (el && typeof el.scrollHeight === 'number') {
      const realGap = (el.scrollHeight ?? 0) - (el.scrollTop ?? 0) - (el.clientHeight ?? 0);
      if (!isAtBottom && this._getSticky() && realGap <= this._atBottomPx) return;
      if (isAtBottom && !this._getSticky() && realGap > this._atBottomPx) return;
    }
    // (B) 翻转决策：走 _setSticky 决策去重
    this._setSticky(!!isAtBottom);
  }
}

export default StickyBottomController;
