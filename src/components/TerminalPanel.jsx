import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import styles from './TerminalPanel.module.css';

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// 虚拟按键定义：label 显示文字，seq 为发送到终端的转义序列
const VIRTUAL_KEYS = [
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: 'Enter', seq: '\r' },
  { label: 'Tab', seq: '\t' },
  { label: 'Esc', seq: '\x1b' },
  { label: 'Ctrl+C', seq: '\x03' },
];

class TerminalPanel extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.terminal = null;
    this.fitAddon = null;
    this.ws = null;
    this.resizeObserver = null;
  }

  componentDidMount() {
    this.initTerminal();
    this.connectWebSocket();
    this.setupResizeObserver();
  }

  componentWillUnmount() {
    if (this._stopMobileMomentum) this._stopMobileMomentum();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.terminal) {
      this.terminal.dispose();
    }
  }

  initTerminal() {
    this.terminal = new Terminal({
      cursorBlink: !isMobile,
      fontSize: isMobile ? 11 : 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      allowProposedApi: true,
      scrollback: isMobile ? 500 : 1000,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.containerRef.current);

    if (isMobile) {
      // 移动端：基于屏幕尺寸一次性计算固定 cols/rows，避免动态 fit 导致渲染抖动
      requestAnimationFrame(() => {
        this._mobileFixedResize();
      });
    } else {
      requestAnimationFrame(() => {
        this.fitAddon.fit();
      });
    }

    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    if (isMobile) {
      this._setupMobileTouchScroll();
    }
  }

  /**
   * 手机端触摸滚动：xterm 的 viewport 在 screen 层之下，原生触摸无法滚动。
   * 使用 terminal.scrollLines() 官方 API 代替直接操作 scrollTop，
   * 确保与 xterm 内部状态同步。通过 rAF 批量处理 + 惯性动画实现流畅滚动。
   * 参考: https://github.com/xtermjs/xterm.js/issues/594
   */
  _setupMobileTouchScroll() {
    const screen = this.containerRef.current?.querySelector('.xterm-screen');
    if (!screen) return;

    const term = this.terminal;
    // 获取行高（用于将像素 delta 转为行数）
    const getLineHeight = () => {
      const cellDims = term._core?._renderService?.dimensions?.css?.cell;
      return cellDims?.height || 15;
    };

    let lastY = 0;
    let lastTime = 0;
    let momentumRaf = null;
    // 像素级累积器，不足一行时保留小数部分
    let pixelAccum = 0;
    let pendingDy = 0;
    let scrollRaf = null;
    let velocitySamples = [];

    const stopMomentum = () => {
      if (momentumRaf) {
        cancelAnimationFrame(momentumRaf);
        momentumRaf = null;
      }
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
      pendingDy = 0;
      pixelAccum = 0;
    };

    // 将累积的像素偏移转化为行滚动
    const flushScroll = () => {
      scrollRaf = null;
      if (pendingDy === 0) return;
      pixelAccum += pendingDy;
      pendingDy = 0;
      const lh = getLineHeight();
      const lines = Math.trunc(pixelAccum / lh);
      if (lines !== 0) {
        term.scrollLines(lines);
        pixelAccum -= lines * lh;
      }
    };

    screen.addEventListener('touchstart', (e) => {
      stopMomentum();
      if (e.touches.length !== 1) return;
      lastY = e.touches[0].clientY;
      lastTime = performance.now();
      velocitySamples = [];
    }, { passive: true });

    screen.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const now = performance.now();
      const dt = now - lastTime;
      const dy = lastY - y; // 正值 = 向上滚

      if (dt > 0) {
        const v = dy / dt * 16;
        velocitySamples.push({ v, t: now });
        // 只保留最近 100ms 的样本
        while (velocitySamples.length > 0 && now - velocitySamples[0].t > 100) {
          velocitySamples.shift();
        }
      }

      pendingDy += dy;
      if (!scrollRaf) {
        scrollRaf = requestAnimationFrame(flushScroll);
      }

      lastY = y;
      lastTime = now;
    }, { passive: true });

    screen.addEventListener('touchend', () => {
      // 刷掉剩余 pending
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
      if (pendingDy !== 0) {
        pixelAccum += pendingDy;
        pendingDy = 0;
        const lh = getLineHeight();
        const lines = Math.trunc(pixelAccum / lh);
        if (lines !== 0) term.scrollLines(lines);
        pixelAccum = 0;
      }

      // 用加权平均计算末速度（像素/帧）
      let velocity = 0;
      if (velocitySamples.length >= 2) {
        let totalWeight = 0;
        let weightedV = 0;
        const latest = velocitySamples[velocitySamples.length - 1].t;
        for (const s of velocitySamples) {
          const w = Math.max(0, 1 - (latest - s.t) / 100);
          weightedV += s.v * w;
          totalWeight += w;
        }
        velocity = totalWeight > 0 ? weightedV / totalWeight : 0;
      }
      velocitySamples = [];

      // 惯性滚动（仍用像素级累积器保证精度）
      if (Math.abs(velocity) < 0.5) return;
      const friction = 0.95;
      let mAccum = 0;
      const tick = () => {
        if (Math.abs(velocity) < 0.3) {
          // 最后残余不足一行则四舍五入
          const lh = getLineHeight();
          const rest = Math.round(mAccum / lh);
          if (rest !== 0) term.scrollLines(rest);
          momentumRaf = null;
          return;
        }
        mAccum += velocity;
        const lh = getLineHeight();
        const lines = Math.trunc(mAccum / lh);
        if (lines !== 0) {
          term.scrollLines(lines);
          mAccum -= lines * lh;
        }
        velocity *= friction;
        momentumRaf = requestAnimationFrame(tick);
      };
      momentumRaf = requestAnimationFrame(tick);
    }, { passive: true });

    this._stopMobileMomentum = stopMomentum;
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          this.terminal.write(msg.data);
        } else if (msg.type === 'exit') {
          this.terminal.write(`\r\n\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode ?? '?' })}\x1b[0m\r\n`);
        } else if (msg.type === 'state') {
          if (!msg.running && msg.exitCode !== null) {
            this.terminal.write(`\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode })}\x1b[0m\r\n`);
          }
        }
      } catch {}
    };

    this.ws.onclose = () => {
      setTimeout(() => {
        if (this.containerRef.current) {
          this.connectWebSocket();
        }
      }, 2000);
    };

    this.ws.onopen = () => {
      this.sendResize();
    };
  }

  sendResize() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.terminal) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      }));
    }
  }

  setupResizeObserver() {
    // 移动端使用固定尺寸，不需要 ResizeObserver
    if (isMobile) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon && this.containerRef.current) {
        try {
          this.fitAddon.fit();
          this.sendResize();
        } catch {}
      }
    });
    if (this.containerRef.current) {
      this.resizeObserver.observe(this.containerRef.current);
    }
  }

  /**
   * 移动端固定尺寸计算：基于屏幕宽高一次性确定 cols/rows，
   * 避免 fitAddon.fit() 因容器尺寸波动导致的反复重排。
   */
  _mobileFixedResize() {
    if (!this.terminal) return;

    // 从 xterm 渲染器获取实际字符尺寸
    const cellDims = this.terminal._core?._renderService?.dimensions?.css?.cell;
    if (!cellDims || !cellDims.width || !cellDims.height) {
      // 渲染器尚未就绪，延迟重试
      setTimeout(() => this._mobileFixedResize(), 50);
      return;
    }

    const charWidth = cellDims.width;
    const lineHeight = cellDims.height;

    // 容器内边距 padding: 4px 8px
    const padX = 16; // 8px * 2
    const padY = 8;  // 4px * 2

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // 顶部状态栏 ~40px，虚拟按键栏 ~52px (44px + padding)
    const topBarHeight = 40;
    const keybarHeight = 52;
    const availableHeight = screenHeight - topBarHeight - keybarHeight;

    const cols = Math.floor((screenWidth - padX) / charWidth);
    const rows = Math.floor((availableHeight - padY) / lineHeight);

    // 确保合理范围
    const safeCols = Math.max(20, Math.min(cols, 200));
    const safeRows = Math.max(5, Math.min(rows, 100));

    this.terminal.resize(safeCols, safeRows);
    this.sendResize();
  }

  handleVirtualKey = (seq) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
    // 手机上不 focus 终端，避免弹出系统软键盘
    if (!isMobile) {
      this.terminal?.focus();
    }
  };

  render() {
    return (
      <div className={styles.terminalPanel}>
        <div ref={this.containerRef} className={styles.terminalContainer} />
        {isMobile && (
          <div className={styles.virtualKeybar}>
            {VIRTUAL_KEYS.map(k => (
              <button
                key={k.label}
                className={styles.virtualKey}
                onTouchStart={(e) => { e.preventDefault(); this.handleVirtualKey(k.seq); }}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}

export default TerminalPanel;
