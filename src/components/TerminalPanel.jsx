import React from 'react';
import { message, Tooltip, Popover, Button, Modal, Checkbox } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { isMobile, isIOS } from '../env';
import styles from './TerminalPanel.module.css';
import { BUILTIN_PRESETS } from '../utils/builtinPresets.js';

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

function UltrathinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.5-3 5.7V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.3C6.3 13.5 5 11.5 5 9a7 7 0 0 1 7-7z" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <line x1="10" y1="24" x2="14" y2="24" />
      <line x1="12" y1="6" x2="12" y2="12" />
      <line x1="9" y1="9" x2="15" y2="9" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function AgentTeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export async function uploadFileAndGetPath(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_SIZE) throw new Error('File too large (max 50MB)');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(apiUrl('/api/upload'), { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.path;
}

class TerminalPanel extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.fileInputRef = React.createRef();
    this.terminal = null;
    this.fitAddon = null;
    this.ws = null;
    this.resizeObserver = null;
    this.state = {
      agentTeamEnabled: false,
      agentTeamPopoverOpen: false,
      presetModalVisible: false,
      presetItems: [],
      presetSelected: new Set(),
      presetAddVisible: false,
      presetAddText: '',
      presetAddName: '',
      presetEditId: null,
    };
  }

  componentDidMount() {
    this.initTerminal();
    this.connectWebSocket();
    this.setupResizeObserver();
    // 读取 claude settings 判断 Agent Team 是否可用
    fetch(apiUrl('/api/claude-settings')).then(r => r.json()).then(data => {
      const enabled = data?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      this.setState({ agentTeamEnabled: enabled });
    }).catch(() => {});
    // 读取预置快捷方式（兼容旧版 string[] 和新版 {teamName, description}[]），合并内置预置
    fetch(apiUrl('/api/preferences')).then(r => r.json()).then(data => {
      const dismissed = Array.isArray(data.dismissedBuiltinPresets) ? new Set(data.dismissedBuiltinPresets) : new Set();
      this._dismissedBuiltinPresets = dismissed;
      let items = [];
      if (Array.isArray(data.presetShortcuts)) {
        items = data.presetShortcuts.map((item, i) => {
          if (typeof item === 'string') return { id: Date.now() + i, teamName: '', description: item };
          return {
            id: Date.now() + i,
            teamName: item.teamName || '',
            description: item.description || '',
            ...(item.builtinId ? { builtinId: item.builtinId } : {}),
            ...(item.modified ? { modified: true } : {}),
          };
        });
      }
      // 合并内置预置：未被用户删除且不在已有列表中的
      const existingBuiltinIds = new Set(items.filter(i => i.builtinId).map(i => i.builtinId));
      for (const bp of BUILTIN_PRESETS) {
        if (dismissed.has(bp.builtinId) || existingBuiltinIds.has(bp.builtinId)) continue;
        items.unshift({ id: Date.now() + Math.random(), builtinId: bp.builtinId, teamName: bp.teamName, description: bp.description });
      }
      this.setState({ presetItems: items });
    }).catch(() => {});
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
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorInactiveStyle: 'none',
      fontSize: isMobile ? 11 : 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#0a0a0a',
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
    // 检查剪贴板中是否包含图片，如有则上传并将路径插入终端
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) this._uploadClipboardImage(file);
          return;
        }
      }
    }

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

  _uploadClipboardImage = async (file) => {
    try {
      const optimized = await this._downscaleForRetina(file);
      const path = await uploadFileAndGetPath(optimized);
      if (this.props.onFilePath) this.props.onFilePath(path);
      if (this.terminal) this.terminal.focus();
    } catch (err) {
      console.error('[CC Viewer] Clipboard image upload failed:', err);
      message.error(t('ui.terminal.pasteImageFailed'));
    }
  };

  /**
   * Retina 屏幕截图为 2x 分辨率，上传前按 devicePixelRatio 缩小到 1x，
   * 减少文件体积。非 Retina 屏幕或 Canvas 不可用时返回原始文件。
   */
  _downscaleForRetina(file) {
    const dpr = window.devicePixelRatio || 1;
    if (dpr <= 1) return Promise.resolve(file);

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const w = Math.round(img.width / dpr);
        const h = Math.round(img.height / dpr);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name || 'clipboard.png', { type: file.type }));
        }, file.type);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

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

  _vkTouchEnd = (action, e) => {
    e.preventDefault(); // 阻止后续 ghost click
    this._vkTarget?.classList.remove(styles.virtualKeyPressed);
    this._vkTarget = null;
    if (!this._vkMoved) {
      action();
    }
  };

  handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const path = await uploadFileAndGetPath(file);
      if (this.props.onFilePath) this.props.onFilePath(path);
      // refocus terminal after upload (skip on mobile to avoid system keyboard popup)
      if (!isMobile && this.terminal) this.terminal.focus();
    } catch (err) {
      console.error('[CC Viewer] Upload failed:', err);
    }
    // reset so same file can be re-selected
    e.target.value = '';
  };

  // --- 预置快捷方式相关 ---
  _savePresetShortcuts = (items, dismissed) => {
    const payload = {
      presetShortcuts: items.map(i => {
        const o = { teamName: i.teamName, description: i.description };
        if (i.builtinId) o.builtinId = i.builtinId;
        if (i.modified) o.modified = true;
        return o;
      }),
    };
    if (dismissed) payload.dismissedBuiltinPresets = [...dismissed];
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };

  handlePresetAdd = () => {
    const description = this.state.presetAddText.trim();
    const teamName = this.state.presetAddName.trim();
    if (!description && !teamName) return;
    const { presetEditId, presetItems } = this.state;
    let next;
    if (presetEditId) {
      next = presetItems.map(i => {
        if (i.id !== presetEditId) return i;
        const updated = { ...i, teamName, description };
        if (i.builtinId) updated.modified = true;
        return updated;
      });
    } else {
      next = [...presetItems, { id: Date.now(), teamName, description }];
    }
    this.setState({ presetItems: next, presetAddVisible: false, presetAddText: '', presetAddName: '', presetEditId: null });
    this._savePresetShortcuts(next);
  };

  handlePresetDelete = () => {
    const { presetItems, presetSelected } = this.state;
    if (presetSelected.size === 0) return;
    // 收集被删除的内置项 builtinId
    const dismissed = new Set(this._dismissedBuiltinPresets || []);
    for (const item of presetItems) {
      if (presetSelected.has(item.id) && item.builtinId) {
        dismissed.add(item.builtinId);
      }
    }
    this._dismissedBuiltinPresets = dismissed;
    const next = presetItems.filter(i => !presetSelected.has(i.id));
    this.setState({ presetItems: next, presetSelected: new Set() });
    this._savePresetShortcuts(next, dismissed);
  };

  handlePresetToggle = (id) => {
    this.setState(prev => {
      const next = new Set(prev.presetSelected);
      next.has(id) ? next.delete(id) : next.add(id);
      return { presetSelected: next };
    });
  };

  // --- 拖拽排序 ---
  _dragIdx = null;
  _dragOverIdx = null;

  handleDragStart = (idx, e) => {
    e.stopPropagation();
    this._dragIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-preset-reorder', String(idx));
    requestAnimationFrame(() => this.forceUpdate());
  };

  handleDragOver = (idx, e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (this._dragOverIdx !== idx) {
      this._dragOverIdx = idx;
      this.forceUpdate();
    }
  };

  handleDragEnd = (e) => {
    if (e) e.stopPropagation();
    this._dragIdx = null;
    this._dragOverIdx = null;
    this.forceUpdate();
  };

  handleDragLeave = (idx, e) => {
    e.stopPropagation();
    if (this._dragOverIdx === idx) {
      this._dragOverIdx = null;
      this.forceUpdate();
    }
  };

  handleDrop = (idx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const from = this._dragIdx;
    if (from === null || from === idx) { this.handleDragEnd(); return; }
    const items = [...this.state.presetItems];
    const [moved] = items.splice(from, 1);
    items.splice(from < idx ? idx - 1 : idx, 0, moved);
    this.setState({ presetItems: items });
    this._savePresetShortcuts(items);
    this.handleDragEnd();
  };

  handlePresetSend = (description) => {
    if (!description) return;
    this.setState({ agentTeamPopoverOpen: false });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: description }));
    }
    if (!isMobile && this.terminal) this.terminal.focus();
  };

  handleEnableAgentTeam = () => {
    if (this.state.agentTeamEnabling) return;
    this.setState({ agentTeamEnabling: true });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const prompt = 'Add "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" to the env object in ~/.claude/settings.json. If the env key does not exist, create it. Preserve all existing content. Only modify this one field.';
      this.ws.send(JSON.stringify({ type: 'input', data: prompt + '\r' }));
      message.success('需要重启 Claude Code 才能生效');
    }
    if (!isMobile && this.terminal) this.terminal.focus();
  };

  handleUltrathink = () => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: 'ultrathink ' }));
    }
    if (this.terminal) this.terminal.focus();
  };

  render() {
    return (
      <div className={styles.terminalPanel}>
        <div ref={this.containerRef} className={styles.terminalContainer} />
        <input type="file" ref={this.fileInputRef} className={styles.hiddenFileInput} onChange={this.handleFileUpload} />
        {!isMobile && (
          <div className={styles.terminalToolbar}>
            <button className={styles.toolbarBtn} onClick={() => this.fileInputRef.current?.click()} title={t('ui.terminal.upload')}>
              <UploadIcon />
              <span>{t('ui.terminal.upload')}</span>
            </button>
            <button className={styles.toolbarBtn} onClick={this.handleUltrathink} title={t('ui.terminal.ultrathink')}>
              <UltrathinkIcon />
              <span>{t('ui.terminal.ultrathink')}</span>
            </button>
            {this.state.agentTeamEnabled ? (
              <Popover
                trigger="hover"
                placement="top"
                open={this.state.agentTeamPopoverOpen}
                onOpenChange={(v) => this.setState({ agentTeamPopoverOpen: v })}
                overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: 4, minWidth: 140 }}
                content={
                  <div className={styles.presetMenu}>
                    {this.state.presetItems.length === 0 ? (
                      <div className={styles.popoverEmptyHint}>—</div>
                    ) : (
                      this.state.presetItems.map(item => {
                        const isBuiltinRaw = item.builtinId && !item.modified;
                        const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                        const desc = isBuiltinRaw ? t(item.description) : item.description;
                        return (
                          <button key={item.id} className={styles.presetMenuItem} onClick={() => this.handlePresetSend(desc)} title={desc}>
                            {name || desc}
                          </button>
                        );
                      })
                    )}
                  </div>
                }
              >
                <button className={styles.toolbarBtn} title={t('ui.terminal.agentTeam')}>
                  <AgentTeamIcon />
                  <span>{t('ui.terminal.agentTeam')}</span>
                </button>
              </Popover>
            ) : (
              <Popover
                trigger="click"
                placement="top"
                overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '12px 16px', maxWidth: 360 }}
                content={
                  <div>
                    <div className={styles.agentTeamDisabledTip}>{t('ui.terminal.agentTeamDisabledTip')}</div>
                    <Button type="primary" size="small" loading={this.state.agentTeamEnabling} disabled={this.state.agentTeamEnabling} onClick={this.handleEnableAgentTeam}>{this.state.agentTeamEnabling ? t('ui.terminal.agentTeamEnabling') : t('ui.terminal.agentTeamEnable')}</Button>
                  </div>
                }
              >
                <button className={`${styles.toolbarBtn} ${styles.toolbarBtnDisabled}`} title={t('ui.terminal.agentTeam')}>
                  <AgentTeamIcon />
                  <span>{t('ui.terminal.agentTeam')}</span>
                </button>
              </Popover>
            )}
            <button className={`${styles.toolbarBtn} ${styles.toolbarBtnRight}`} onClick={() => this.setState({ presetModalVisible: true })} title={t('ui.terminal.presetShortcuts')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        )}
        {isMobile && (
          <div className={styles.virtualKeybar}>
            {VIRTUAL_KEYS.map(k => (
              <button
                key={k.label}
                className={styles.virtualKey}
                onTouchStart={this._vkTouchStart}
                onTouchMove={this._vkTouchMove}
                onTouchEnd={(e) => this._vkTouchEnd(() => this.handleVirtualKey(k.seq), e)}
              >
                {k.label}
              </button>
            ))}
            {/* TODO: 移动端文件上传 - 受限于浏览器安全策略，触摸事件链中 input.click() 无法触发文件选择器
            <span className={styles.vkSeparator} />
            <button
              className={`${styles.virtualKey} ${styles.vkAction}`}
              onClick={() => {
                this.fileInputRef.current?.click();
                const ta = this.containerRef.current?.querySelector('.xterm-helper-textarea');
                if (ta) ta.blur();
              }}
              title={t('ui.terminal.upload')}
            >
              <UploadIcon />
            </button>
            */}
            {this.state.agentTeamEnabled ? (
              this.state.presetItems.length > 0 && <>
                <span className={styles.vkSeparator} />
                {this.state.presetItems.map(item => {
                  const isBuiltinRaw = item.builtinId && !item.modified;
                  const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                  const desc = isBuiltinRaw ? t(item.description) : item.description;
                  return (
                    <button
                      key={item.id}
                      className={`${styles.virtualKey} ${styles.vkAction} ${styles.vkTeamPreset}`}
                      onTouchStart={this._vkTouchStart}
                      onTouchMove={this._vkTouchMove}
                      onTouchEnd={(e) => this._vkTouchEnd(() => this.handlePresetSend(desc), e)}
                      title={desc}
                    >
                      <AgentTeamIcon /><span className={styles.vkTeamLabel}>{name || desc}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <span className={styles.vkSeparator} />
                <button
                  className={`${styles.virtualKey} ${styles.vkAction} ${styles.vkDisabled}`}
                  onTouchStart={this._vkTouchStart}
                  onTouchMove={this._vkTouchMove}
                  onTouchEnd={(e) => this._vkTouchEnd(() => this.handleEnableAgentTeam(), e)}
                >
                  <AgentTeamIcon /><span className={styles.vkTeamLabel}>{t('ui.terminal.agentTeam')}</span>
                </button>
              </>
            )}
          </div>
        )}
        {/* 预置快捷方式弹窗 */}
        <Modal
          title={t('ui.terminal.presetShortcuts')}
          open={this.state.presetModalVisible}
          onCancel={() => this.setState({ presetModalVisible: false, presetSelected: new Set() })}
          footer={null}
          width={800}
          styles={{ content: { background: '#1e1e1e', border: '1px solid #333' }, header: { background: '#1e1e1e', borderBottom: 'none' } }}
        >
          <div className={styles.presetSectionHeader}>
            <span className={styles.presetSectionTitle}>{t('ui.terminal.agentTeamCustom')}</span>
          </div>
          <div className={styles.presetList} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            {this.state.presetItems.length === 0 ? (
              <div className={styles.presetListEmptyHint}>—</div>
            ) : (
              this.state.presetItems.map((item, idx) => {
                const isBuiltinRaw = item.builtinId && !item.modified;
                const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                const desc = isBuiltinRaw ? t(item.description) : item.description;
                const isDragging = this._dragIdx === idx;
                const isDragOver = this._dragOverIdx === idx && this._dragIdx !== idx;
                return (
                  <div
                    key={item.id}
                    className={`${styles.presetRow} ${isDragging ? styles.presetRowDragging : ''} ${isDragOver ? styles.presetRowDragOver : ''}`}
                    onDragOver={(e) => this.handleDragOver(idx, e)}
                    onDragLeave={(e) => this.handleDragLeave(idx, e)}
                    onDrop={(e) => this.handleDrop(idx, e)}
                    onDragEnd={this.handleDragEnd}
                  >
                    <span
                      className={styles.dragHandle}
                      draggable
                      onDragStart={(e) => this.handleDragStart(idx, e)}
                    >
                      <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
                        <circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>
                        <circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/>
                        <circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/>
                      </svg>
                    </span>
                    <Checkbox
                      checked={this.state.presetSelected.has(item.id)}
                      onChange={() => this.handlePresetToggle(item.id)}
                    />
                    <span className={styles.presetName} title={name}>{name || '—'}</span>
                    <span className={styles.presetText} title={desc}>{desc}</span>
                    <Button size="small" type="link" onClick={() => this.setState({ presetAddVisible: true, presetAddName: isBuiltinRaw ? t(item.teamName) : item.teamName, presetAddText: isBuiltinRaw ? t(item.description) : item.description, presetEditId: item.id })}>{t('ui.terminal.editItem')}</Button>
                  </div>
                );
              })
            )}
          </div>
          <div className={styles.presetActions}>
            <Button size="small" danger disabled={this.state.presetSelected.size === 0} onClick={this.handlePresetDelete}>{t('ui.terminal.deleteSelected')}</Button>
            <Button size="small" onClick={() => this.setState({ presetAddVisible: true, presetAddName: '', presetAddText: '', presetEditId: null })}>{t('ui.terminal.addItem')}</Button>
          </div>
        </Modal>

        {/* 添加快捷方式弹窗 */}
        <Modal
          title={this.state.presetEditId ? t('ui.terminal.editItem') : t('ui.terminal.addItem')}
          open={this.state.presetAddVisible}
          onCancel={() => this.setState({ presetAddVisible: false, presetAddName: '', presetAddText: '', presetEditId: null })}
          onOk={this.handlePresetAdd}
          okText={this.state.presetEditId ? t('ui.ok') : t('ui.terminal.addItem')}
          cancelText={t('ui.cancel')}
          okButtonProps={{ disabled: !this.state.presetAddText.trim() && !this.state.presetAddName.trim() }}
          width="fit-content"
          styles={{ content: { background: '#1e1e1e', border: '1px solid #333' }, header: { background: '#1e1e1e', borderBottom: 'none' } }}
        >
          <div className={styles.presetFormField}>
            <label className={styles.presetFormLabel}>Team {t('ui.terminal.teamName')}</label>
            <input
              className={styles.presetInput}
              placeholder={t('ui.terminal.teamNamePlaceholder')}
              value={this.state.presetAddName}
              onChange={(e) => this.setState({ presetAddName: e.target.value })}
            />
          </div>
          <div>
            <label className={styles.presetFormLabel}>Team {t('ui.terminal.teamDesc')}</label>
            <textarea
              className={styles.presetTextarea}
              rows={6}
              placeholder={t('ui.terminal.presetInputPlaceholder')}
              value={this.state.presetAddText}
              onChange={(e) => this.setState({ presetAddText: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
            />
          </div>
        </Modal>
      </div>
    );
  }
}

export default TerminalPanel;
