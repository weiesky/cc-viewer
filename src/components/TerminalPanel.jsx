import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import { isMobile, isIOS } from '../env';
import styles from './TerminalPanel.module.css';

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
    if (this._writeTimer) cancelAnimationFrame(this._writeTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
    if (this._webglRecoveryTimer) clearTimeout(this._webglRecoveryTimer);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.webglAddon) {
      this.webglAddon.dispose();
      this.webglAddon = null;
    }
    if (this.terminal) {
      if (this.terminal.textarea) {
        this.terminal.textarea.removeEventListener('paste', this._handlePaste, true);
      }
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
      scrollback: isIOS ? 200 : isMobile ? 1000 : 3000,
      smoothScrollDuration: 0,
      scrollOnUserInput: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    const unicode11 = new Unicode11Addon();
    this.terminal.loadAddon(unicode11);
    this.terminal.unicode.activeVersion = '11';

    this.terminal.open(this.containerRef.current);

    // 启用 WebGL 渲染器，GPU 加速绘制，失败时自动回退 Canvas
    // iOS 移动端 WebGL 性能差，直接使用 Canvas 渲染器
    if (!isIOS) {
      this._loadWebglAddon(false);
    }

    // 写入节流：批量合并高频输出，避免逐条触发渲染
    this._writeBuffer = '';
    this._writeTimer = null;

    if (isMobile) {
      // 移动端：基于屏幕尺寸一次性计算固定 cols/rows，避免动态 fit 导致渲染抖动
      requestAnimationFrame(() => {
        this._mobileFixedResize();
      });
    } else {
      requestAnimationFrame(() => {
        this.fitAddon.fit();
        this.terminal.focus();
      });
    }

    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // 拦截粘贴事件，用 bracketed paste 转义序列包裹，
    // 防止多行粘贴时换行符被当作 Enter 逐行执行
    // 使用 capture 阶段确保在 xterm.js 自身的 paste handler 之前执行
    if (this.terminal.textarea) {
      this.terminal.textarea.addEventListener('paste', this._handlePaste, true);
    }

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
          this._throttledWrite(msg.data);
        } else if (msg.type === 'exit') {
          this._flushWrite();
          this.terminal.write(`\r\n\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode ?? '?' })}\x1b[0m\r\n`);
          this.terminal.write(`\x1b[90m${t('ui.terminal.pressEnterForShell')}\x1b[0m\r\n`);
        } else if (msg.type === 'editor-open') {
          if (this.props.onEditorOpen) {
            this.props.onEditorOpen(msg.sessionId, msg.filePath);
          }
        } else if (msg.type === 'state') {
          if (!msg.running && msg.exitCode !== null) {
            this._flushWrite();
            this.terminal.write(`\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode })}\x1b[0m\r\n`);
            this.terminal.write(`\x1b[90m${t('ui.terminal.pressEnterForShell')}\x1b[0m\r\n`);
          }
        }
      } catch {}
    };

    this.ws.onclose = () => {
      setTimeout(() => {
        if (this.containerRef.current) {
          this.terminal?.reset();
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
      const msg = {
        type: 'resize',
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      };
      if (isMobile) msg.mobile = true;
      this.ws.send(JSON.stringify(msg));
    }
  }

  setupResizeObserver() {
    // 移动端使用固定尺寸，不需要 ResizeObserver
    if (isMobile) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = setTimeout(() => {
        this._resizeDebounceTimer = null;
        if (this.fitAddon && this.containerRef.current) {
          try {
            this.fitAddon.fit();
            this.sendResize();
          } catch {}
        }
      }, 150);
    });
    if (this.containerRef.current) {
      this.resizeObserver.observe(this.containerRef.current);
    }
  }

  _loadWebglAddon(isRetry) {
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        this.webglAddon?.dispose();
        this.webglAddon = null;
        if (!isRetry) {
          this._webglRecoveryTimer = setTimeout(() => {
            this._webglRecoveryTimer = null;
            this._loadWebglAddon(true);
          }, 1000);
        }
      });
      this.terminal.loadAddon(this.webglAddon);
    } catch {
      this.webglAddon = null;
    }
  }

  /**
   * 移动端固定 60 列：通过调整 fontSize 使 60 列恰好撑满屏幕宽度，
   * 行数根据缩放后的行高和可用高度动态计算。
   */
  _mobileFixedResize() {
    if (!this.terminal) return;

    // 从 xterm 渲染器获取当前字符尺寸
    const cellDims = this.terminal._core?._renderService?.dimensions?.css?.cell;
    if (!cellDims || !cellDims.width || !cellDims.height) {
      // 渲染器尚未就绪，延迟重试
      setTimeout(() => this._mobileFixedResize(), 50);
      return;
    }

    const MOBILE_COLS = 60;
    const padX = 16; // 8px * 2 容器内边距
    const padY = 8;  // 4px * 2
    const topBarHeight = 40;
    const keybarHeight = 52;

    const availableWidth = window.innerWidth - padX;
    const availableHeight = window.innerHeight - topBarHeight - keybarHeight - padY;

    // 根据当前 fontSize 和 charWidth 的比例，计算让 60 列恰好填满宽度所需的 fontSize
    const currentFontSize = this.terminal.options.fontSize;
    const currentCharWidth = cellDims.width;
    const targetFontSize = Math.floor(currentFontSize * availableWidth / (MOBILE_COLS * currentCharWidth) * 10) / 10;

    // 更新字号，xterm 会重新渲染
    this.terminal.options.fontSize = targetFontSize;

    // 等渲染器更新后再计算行数
    requestAnimationFrame(() => {
      const newCellDims = this.terminal._core?._renderService?.dimensions?.css?.cell;
      const lineHeight = newCellDims?.height || cellDims.height;
      const rows = Math.max(5, Math.min(Math.floor(availableHeight / lineHeight), 100));

      this.terminal.resize(MOBILE_COLS, rows);
      this.sendResize();
    });
  }

  /**
   * 写入节流：将高频数据合并到缓冲区，每 16ms（一帧）批量写入一次，
   * 避免大量输出时逐条触发 xterm 渲染导致卡顿。
   * 当数据量超过 CHUNK_SIZE 时分帧写入，防止 /resume 等场景阻塞主线程。
   */
  _throttledWrite(data) {
    this._writeBuffer += data;
    if (!this._writeTimer) {
      this._writeTimer = requestAnimationFrame(() => {
        this._flushWrite();
      });
    }
  }

  _flushWrite() {
    if (this._writeTimer) {
      cancelAnimationFrame(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this._writeBuffer || !this.terminal) return;

    const CHUNK_SIZE = 32768; // 32KB per frame
    if (this._writeBuffer.length <= CHUNK_SIZE) {
      // 正常小数据：直接写入，无额外开销
      const buf = this._writeBuffer;
      this._writeBuffer = '';
      this.terminal.write(buf);
    } else {
      // 大数据分帧：每帧写 32KB，剩余排入下一帧
      const chunk = this._writeBuffer.slice(0, CHUNK_SIZE);
      this._writeBuffer = this._writeBuffer.slice(CHUNK_SIZE);
      this.terminal.write(chunk);
      // 还有剩余数据，排入下一帧继续写
      this._writeTimer = requestAnimationFrame(() => {
        this._flushWrite();
      });
    }
  }

  _handlePaste = (e) => {
    // 当 shell 已启用 bracketedPasteMode 时，xterm.js 会自动包裹，无需干预
    if (this.terminal?.modes?.bracketedPasteMode) return;
    const text = e.clipboardData?.getData('text');
    if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // shell 未启用 bracketed paste 时，手动包裹多行文本，防止换行被当作 Enter 执行
    if (text.includes('\n') || text.includes('\r')) {
      e.preventDefault();
      e.stopPropagation();
      const wrapped = `\x1b[200~${text}\x1b[201~`;
      this.ws.send(JSON.stringify({ type: 'input', data: wrapped }));
    }
  };

  handleVirtualKey = (seq) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
    // 手机上不 focus 终端，避免弹出系统软键盘；主动 blur 防止先前已聚焦
    if (isMobile) {
      const ta = this.containerRef.current?.querySelector('.xterm-helper-textarea');
      if (ta) ta.blur();
    } else {
      this.terminal?.focus();
    }
  };

  /**
   * 移动端虚拟按键触摸处理：区分点击与拖动滚动。
   * 仅当触摸位移 < 阈值时才视为点击并触发按键，否则视为滚动不触发。
   */
  _vkTouchStart = (e) => {
    e.preventDefault(); // 阻止触摸导致 xterm textarea 获焦弹出键盘
    const touch = e.touches[0];
    this._vkStartX = touch.clientX;
    this._vkStartY = touch.clientY;
    this._vkMoved = false;
    this._vkTarget = e.currentTarget;
    this._vkTarget.classList.add(styles.virtualKeyPressed);
  };

  _vkTouchMove = (e) => {
    if (this._vkMoved) return;
    const touch = e.touches[0];
    const dx = touch.clientX - this._vkStartX;
    const dy = touch.clientY - this._vkStartY;
    if (dx * dx + dy * dy > 64) { // 8px 阈值
      this._vkMoved = true;
    }
  };

  _vkTouchEnd = (seq, e) => {
    e.preventDefault(); // 阻止后续 ghost click
    this._vkTarget?.classList.remove(styles.virtualKeyPressed);
    this._vkTarget = null;
    if (!this._vkMoved) {
      this.handleVirtualKey(seq);
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
                onTouchStart={this._vkTouchStart}
                onTouchMove={this._vkTouchMove}
                onTouchEnd={(e) => this._vkTouchEnd(k.seq, e)}
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
