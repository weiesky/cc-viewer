// 跳转高亮的「滚动即褪色」控制器（从 ChatView 抽出，仿 stickyBottomController 的事件+timer+dispose 模式）。
//
// 跳转到某条消息后高亮它；用户一滚动就开始褪色并停止监听。逻辑与宿主组件解耦，可单测。
// host 接口：
//   getScrollContainer() → 当前滚动容器 DOM（包宿主的 _getScrollContainer，含 virtuoso/desktop 分支）
//   setState(updater)    → 转发宿主 this.setState

export class ScrollHighlightController {
  constructor(host) {
    this.host = host;
    this._delayTimer = null;
    this._clearTimer = null;
    this._boundEl = null;
    this._onScroll = null;
  }

  bind() {
    this.dispose();
    // 延迟绑定：等 smooth scroll 动画完成后再监听，避免动画帧触发提前 fading。
    this._delayTimer = setTimeout(() => {
      const container = this.host.getScrollContainer();
      if (!container) return;
      this._boundEl = container;
      this._onScroll = () => {
        this.host.setState({ highlightFading: true });
        this._clearTimer = setTimeout(() => {
          this.host.setState({ highlightTs: null, highlightFading: false, highlightVisibleIdx: -1 });
        }, 2000);
        this.dispose();
      };
      container.addEventListener('scroll', this._onScroll, { passive: true });
    }, 500);
  }

  dispose() {
    if (this._delayTimer) {
      clearTimeout(this._delayTimer);
      this._delayTimer = null;
    }
    if (this._clearTimer) {
      clearTimeout(this._clearTimer);
      this._clearTimer = null;
    }
    if (this._onScroll && this._boundEl) {
      this._boundEl.removeEventListener('scroll', this._onScroll);
      this._boundEl = null;
      this._onScroll = null;
    }
  }
}
