import React from 'react';
import { message, Tooltip, Popover, Popconfirm, Button, Checkbox, Modal } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import { tc, getClaudeConfigDir } from '../utils/tClaude';
import { apiUrl } from '../utils/apiUrl';
import { isMobile, isIOS, isPad } from '../env';
import styles from './TerminalPanel.module.css';
import { BUILTIN_PRESETS } from '../utils/builtinPresets.js';
import { buildLocalUltraplan } from '../utils/ultraplanTemplates';
import { buildBracketPasteSubmitChunks, BRACKET_PASTE_SUBMIT_SETTLE_MS } from '../utils/ptyChunkBuilder';
import { getModelMaxTokens } from '../utils/helpers';
import ConceptHelp from './ConceptHelp';
import CustomUltraplanEditModal from './CustomUltraplanEditModal';
import ImageLightbox from './ImageLightbox';
import ConfirmRemoveButton from './ConfirmRemoveButton';
import { resizeImageIfNeeded } from '../utils/imageResize';
import TerminalContext from './TerminalContext';

const darkTerminalTheme = {
  background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#0a0a0a',
  selectionBackground: '#264f78',
  black: '#000000', red: '#ef4444', green: '#73c991', yellow: '#fbbf24',
  blue: '#3b82f6', magenta: '#d946ef', cyan: '#06b6d4', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#ff7b7b', brightGreen: '#9ddc6f', brightYellow: '#ffce5b',
  brightBlue: '#66b3ff', brightMagenta: '#e88ce8', brightCyan: '#7eddd9', brightWhite: '#ffffff',
};
const lightTerminalTheme = {
  background: '#ffffff', foreground: '#333333', cursor: '#333333',
  selectionBackground: '#cce5ff',
  black: '#000000', red: '#CD3131', green: '#107C10', yellow: '#949800',
  blue: '#0451A5', magenta: '#BC05BC', cyan: '#0598BC', white: '#555555',
  brightBlack: '#666666', brightRed: '#CD3131', brightGreen: '#14CE14', brightYellow: '#B5BA00',
  brightBlue: '#0451A5', brightMagenta: '#BC05BC', brightCyan: '#0598BC', brightWhite: '#A5A5A5',
};

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

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function UltraplanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2.5"/>
      <ellipse cx="12" cy="12" rx="10" ry="4"/>
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
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
  const MAX_SIZE = 100 * 1024 * 1024; // 100MB
  let upload = file;
  // 图片压缩失败直接用原文件，保证上传流程不中断
  try { upload = await resizeImageIfNeeded(file, 2000); } catch { upload = file; }
  if (upload.size > MAX_SIZE) throw new Error('File too large (max 100MB)');
  const form = new FormData();
  form.append('file', upload);
  const res = await fetch(apiUrl('/api/upload'), { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.path;
}

class TerminalPanel extends React.Component {
  static contextType = TerminalContext;

  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.fileInputRef = React.createRef();
    this.terminal = null;
    this.fitAddon = null;
    this.ws = null;
    this.resizeObserver = null;
    // Whether this panel uses context-mediated WS (multi-terminal mode)
    this._useContextWs = !!props.tid;
    this.state = {
      terminalFocused: false,
      agentTeamEnabled: false,
      agentTeamPopoverOpen: false,
      ultraplanOpen: false,
      ultraplanVariant: 'codeExpert',
      ultraplanPrompt: '',
      ultraplanFiles: [],
      customUltraplanExperts: [],
      customUltraplanEditOpen: false,
      customUltraplanEditing: null,
      presetModalVisible: false,
      presetItems: [],
      presetSelected: new Set(),
      presetAddVisible: false,
      presetAddText: '',
      presetAddName: '',
      presetEditId: null,
      lightbox: null,
      ultraplanLightbox: null,
      ultraplanConfirming: false,
    };
  }

  componentDidMount() {
    this.initTerminal();
    if (this._useContextWs) {
      this._connectViaContext();
    } else {
      this.connectWebSocket();
    }
    this.setupResizeObserver();
    // 读取 claude settings 判断 Agent Team 是否可用
    fetch(apiUrl('/api/claude-settings')).then(r => r.json()).then(data => {
      const enabled = data?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      this.setState({ agentTeamEnabled: enabled });
    }).catch(() => {});
    this._loadPresetShortcuts();
    this._onPresetsChanged = () => this._loadPresetShortcuts();
    window.addEventListener('ccv-presets-changed', this._onPresetsChanged);
    this._onFocusTerminal = () => { if (this.terminal && this.containerRef?.current?.offsetWidth > 0) this.terminal.focus(); };
    window.addEventListener('ccv-focus-terminal', this._onFocusTerminal);
    this._themeObserver = new MutationObserver(() => {
      if (this.terminal) {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        this.terminal.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
      }
    });
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  componentDidUpdate(prevProps) {
    // When terminal becomes active (switched to in multi-terminal mode), re-fit and focus
    if (this.props.isActive && !prevProps.isActive) {
      requestAnimationFrame(() => {
        if (this.fitAddon && this.containerRef.current) {
          try {
            this.fitAddon.fit();
            this.sendResize();
          } catch {}
        }
        if (this.terminal) this.terminal.focus();
      });
    }
  }

  _loadPresetShortcuts() {
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
      const customExperts = Array.isArray(data.customUltraplanExperts) ? data.customUltraplanExperts : [];
      // 若当前选中的自定义专家已不存在（被另一端删除），回退到 codeExpert
      const current = this.state.ultraplanVariant;
      const next = { presetItems: items, customUltraplanExperts: customExperts };
      if (typeof current === 'string' && current.startsWith('custom:')) {
        const id = current.slice('custom:'.length);
        if (!customExperts.some(e => e.id === id)) next.ultraplanVariant = 'codeExpert';
      }
      this.setState(next);
    }).catch(() => {});
  }

  componentWillUnmount() {
    // Cleanup context-mediated listeners
    if (this._unregisterDataListener) this._unregisterDataListener();
    if (this._unregisterStateListener) this._unregisterStateListener();
    if (this.terminal?.textarea) {
      this.terminal.textarea.removeEventListener('focus', this._handleTermFocus);
      this.terminal.textarea.removeEventListener('blur', this._handleTermBlur);
    }
    if (this._themeObserver) { this._themeObserver.disconnect(); this._themeObserver = null; }
    window.removeEventListener('ccv-presets-changed', this._onPresetsChanged);
    window.removeEventListener('ccv-focus-terminal', this._onFocusTerminal);
    if (this._stopMobileMomentum) this._stopMobileMomentum();
    if (this._writeTimer) cancelAnimationFrame(this._writeTimer);
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
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
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    this.terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorInactiveStyle: 'none',
      fontSize: (isMobile && !isPad) ? 11 : 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: isDark ? darkTerminalTheme : lightTerminalTheme,
      allowProposedApi: true,
      scrollback: isPad ? 3000 : isIOS ? 200 : isMobile ? 1000 : 3000,
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

    // 终端 focus/blur → 边框高亮 (xterm v6 removed onFocus/onBlur, use DOM events)
    this._handleTermFocus = () => this.setState({ terminalFocused: true });
    this._handleTermBlur = () => this.setState({ terminalFocused: false });
    const termTextarea = this.terminal.textarea;
    if (termTextarea) {
      termTextarea.addEventListener('focus', this._handleTermFocus);
      termTextarea.addEventListener('blur', this._handleTermBlur);
    }

    // 启用 WebGL 渲染器，GPU 加速绘制，失败时自动回退 Canvas
    // iOS 移动端 WebGL 性能差，直接使用 Canvas 渲染器
    if (!isIOS) {
      this._loadWebglAddon(false);
    }

    // 写入节流：批量合并高频输出，避免逐条触发渲染
    this._writeBuffer = '';
    this._writeTimer = null;

    if (isMobile && !isPad) {
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

    // Shift+Enter: 发 ESC+CR（Alt+Enter 的 escape 码），和 Claude Code `/terminal-setup`
    // 写进 VS Code/Cursor keybindings 的 `\r` 等价。Claude Code CLI 识别这个序列为
    // "插入换行而非提交"。之前用 bracketed-paste-LF 对老版可能有效，2.x 版已不兼容。
    this.terminal.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) {
        // 必须显式 preventDefault：xterm customKeyEventHandler 返回 false 只阻 xterm 内部处理，
        // 不阻浏览器 textarea 默认行为（Enter 会往隐藏 textarea 塞 \n 再被 xterm onData 转发到 PTY）。
        // 不 preventDefault 会让 PTY 同时收到 \x1b\r（我们显式发的）和 \n（textarea 漏进来的），
        // 后者被 Claude Code 当作 Enter 提交，于是"看起来换行没生效"。
        e.preventDefault();
        e.stopPropagation();
        if (this._isWsReady()) {
          const msg = { type: 'input', data: '\x1b\r' };
          if (this.props.tid) msg.tid = this.props.tid;
          this._sendWsMessage(msg);
        }
        return false;
      }
      // Enter: 如果有 pending 文件，先注入路径到终端输入行（不带回车），
      // 用户可以看到路径后再按 Enter 确认发送
      // 跳过 alternate screen（vim/less 等交互程序），避免误注入
      if (e.type === 'keydown' && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const pending = this.props.pendingImages;
        const inAlternateScreen = this.terminal?.buffer?.active?.type === 'alternate';
        if (pending?.length > 0 && !inAlternateScreen && this._isWsReady()) {
          const paths = pending.map(img => `'${img.path.replace(/'/g, "'\\''")}'`).join(' ');
          const inputMsg = { type: 'input', data: paths + ' ' };
          if (this.props.tid) inputMsg.tid = this.props.tid;
          this._sendWsMessage(inputMsg);
          this.props.onClearPendingImages?.();
          return false;
        }
      }
      return true;
    });

    // alt 屏（Claude Code Ink 等 TUI，buffer.hasScrollback=false）下，xterm 默认把 wheel
    // 翻译成 ↑/↓ 发 PTY，Ink 输入会把它当作历史翻页。这里拦截：正常屏让 xterm 自己滚
    // scrollback；alt 屏转发滚动到外层 chat scroller（Virtuoso），由 ChatView 通过
    // getChatScroller prop 传入。祖先链上没有可滚元素，必须显式拿这个 sibling ref。
    this.terminal.attachCustomWheelEventHandler((ev) => {
      if (this.terminal?.buffer?.active?.type !== 'alternate') return true;
      const scroller = this.props.getChatScroller?.();
      if (scroller) {
        const px = ev.deltaMode === 1 ? ev.deltaY * 16
          : ev.deltaMode === 2 ? ev.deltaY * (scroller.clientHeight || 0)
          : ev.deltaY;
        scroller.scrollTop += px;
      }
      ev.preventDefault();
      return false;
    });

    this.terminal.onData((data) => {
      if (this._isWsReady()) {
        const msg = { type: 'input', data };
        if (this.props.tid) msg.tid = this.props.tid;
        this._sendWsMessage(msg);
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
        } else if (msg.type === 'toast') {
          this._flushWrite();
          this.terminal.write(`\r\n\x1b[33m⚠ ${msg.message}\x1b[0m\r\n`);
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this._wsReconnectTimer = setTimeout(() => {
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

  /**
   * Context-mediated connection: use TerminalContext's shared WebSocket
   * instead of creating a separate one. Register data/state listeners
   * that route only this terminal's data to the xterm instance.
   */
  _connectViaContext() {
    const ctx = this.context;
    if (!ctx) return;
    const tid = this.props.tid;

    // Register data listener -- receives only data for this tid
    this._unregisterDataListener = ctx.registerDataListener(tid, (data) => {
      this._throttledWrite(data);
    });

    // Register state listener -- receives state/exit for this tid
    this._unregisterStateListener = ctx.registerStateListener(tid, (msg) => {
      if (msg.type === 'exit') {
        this._flushWrite();
        this.terminal.write(`\r\n\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode ?? '?' })}\x1b[0m\r\n`);
        this.terminal.write(`\x1b[90m${t('ui.terminal.pressEnterForShell')}\x1b[0m\r\n`);
      } else if (msg.type === 'state') {
        if (!msg.running && msg.exitCode !== null) {
          this._flushWrite();
          this.terminal.write(`\x1b[33m${t('ui.terminal.exited', { code: msg.exitCode })}\x1b[0m\r\n`);
          this.terminal.write(`\x1b[90m${t('ui.terminal.pressEnterForShell')}\x1b[0m\r\n`);
        }
      } else if (msg.type === 'toast') {
        this._flushWrite();
        this.terminal.write(`\r\n\x1b[33m\u26a0 ${msg.message}\x1b[0m\r\n`);
      } else if (msg.type === 'editor-open') {
        if (this.props.onEditorOpen) {
          this.props.onEditorOpen(msg.sessionId, msg.filePath);
        }
      }
    });

    // Subscribe to terminal data stream (triggers buffer replay from server)
    ctx.subscribeTerminal(tid);

    // Send initial resize
    this.sendResize();
  }

  /**
   * Send a message through the appropriate WebSocket channel.
   * In context-mediated mode, uses TerminalContext.sendMessage.
   * In legacy mode, uses the local WebSocket.
   */
  _sendWsMessage(msg) {
    if (this._useContextWs) {
      const ctx = this.context;
      if (ctx) ctx.sendMessage(msg);
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Check if the WebSocket channel (either shared or local) is ready.
   */
  _isWsReady() {
    if (this._useContextWs) {
      const ctx = this.context;
      return ctx && ctx.getWs() !== null;
    }
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  sendResize() {
    if (!this.terminal) return;
    const msg = {
      type: 'resize',
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
    if (this.props.tid) msg.tid = this.props.tid;
    if (isMobile) msg.mobile = true;
    this._sendWsMessage(msg);
  }

  setupResizeObserver() {
    // 移动端使用固定尺寸，不需要 ResizeObserver（iPad 例外，走动态 fit）
    if (isMobile && !isPad) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = setTimeout(() => {
        this._resizeDebounceTimer = null;
        if (this.fitAddon && this.containerRef.current) {
          try {
            // 保存 scroll 位置，fit() 会重置 viewport 导致 scroll 跳到 0
            const vp = this.containerRef.current.querySelector('.xterm-viewport');
            const prevScrollTop = vp?.scrollTop ?? 0;
            const prevScrollHeight = vp?.scrollHeight ?? 1;
            const wasAtBottom = vp ? (prevScrollTop + vp.clientHeight >= prevScrollHeight - 5) : true;
            this.fitAddon.fit();
            // 恢复 scroll 位置（fit 后 scrollHeight 可能变化，按比例换算）
            if (vp) {
              if (wasAtBottom) {
                vp.scrollTop = vp.scrollHeight;
              } else {
                const ratio = prevScrollHeight > 0 ? prevScrollTop / prevScrollHeight : 0;
                vp.scrollTop = ratio * vp.scrollHeight;
              }
            }
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
    if (!text || !this._isWsReady()) return;
    // shell 未启用 bracketed paste 时，手動包裹多行文本，防止换行被当作 Enter 执行
    if (text.includes('\n') || text.includes('\r')) {
      e.preventDefault();
      e.stopPropagation();
      const wrapped = `\x1b[200~${text}\x1b[201~`;
      const msg = { type: 'input', data: wrapped };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
    }
  };

  _uploadClipboardImage = async (file) => {
    try {
      const optimized = await this._downscaleForRetina(file);
      const path = await uploadFileAndGetPath(optimized);
      if (this.props.onFilePath) this.props.onFilePath(path);
      // Notify other views/devices about the uploaded image
      if (this._isWsReady()) {
        this._sendWsMessage({ type: 'image-upload-notify', path, source: 'terminal' });
      }
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
    if (this._isWsReady()) {
      const msg = { type: 'input', data: seq };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
    }
    // 手机上不 focus 终端，避免弹出系统软键盘；主动 blur 防止先前已聚焦
    if (isMobile && !isPad) {
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
      // Notify other views/devices about the uploaded file
      if (this._isWsReady()) {
        this._sendWsMessage({ type: 'image-upload-notify', path, source: 'terminal' });
      }
      // refocus terminal after upload (skip on mobile to avoid system keyboard popup)
      if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
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
    }).then(() => {
      window.dispatchEvent(new Event('ccv-presets-changed'));
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
    if (this._isWsReady()) {
      const msg = {
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks(description),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  handleClearContext = () => {
    if (this._isWsReady()) {
      const msg = {
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks('/clear'),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
      this.props.onClearContextOptimistic?.();
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  handleUltraplanSend = () => {
    const trimmed = this.state.ultraplanPrompt.trim();
    if (!trimmed && this.state.ultraplanFiles.length === 0) return;
    const filePaths = this.state.ultraplanFiles.map(f => `"${f.path}"`).join(' ');
    const userInput = filePaths ? (trimmed ? `${filePaths} ${trimmed}` : filePaths) : trimmed;
    const variant = this.state.ultraplanVariant;
    let assembled;
    if (typeof variant === 'string' && variant.startsWith('custom:')) {
      const id = variant.slice('custom:'.length);
      const item = this.state.customUltraplanExperts.find(e => e.id === id);
      if (!item) { return; }
      assembled = buildLocalUltraplan(userInput, 'custom', undefined, item.content);
    } else {
      assembled = buildLocalUltraplan(userInput, variant);
    }
    // 先校验再重置，避免空模板导致用户输入被静默清空
    if (!assembled) return;
    this.setState({ ultraplanOpen: false, ultraplanPrompt: '', ultraplanVariant: 'codeExpert', ultraplanFiles: [] });
    if (this._isWsReady()) {
      const msg = {
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks(assembled),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  openCustomUltraplanEditor = (item) => {
    // 打开专家编辑器时收起 UltraPlan Popover，避免 Popover/Modal 层级混淆。
    // 快照原状态，close 时按实际值恢复——防御未来非 UltraPlan 路径调用。
    this.setState(prev => ({
      customUltraplanEditOpen: true,
      customUltraplanEditing: item || null,
      _ultraplanWasOpenBeforeEdit: prev.ultraplanOpen,
      ultraplanOpen: false,
    }));
  };

  closeCustomUltraplanEditor = () => {
    this.setState(prev => ({
      customUltraplanEditOpen: false,
      customUltraplanEditing: null,
      ultraplanOpen: !!prev._ultraplanWasOpenBeforeEdit,
      _ultraplanWasOpenBeforeEdit: false,
    }));
  };

  persistCustomUltraplanExperts = (experts) => {
    this.setState({ customUltraplanExperts: experts });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customUltraplanExperts: experts }),
    })
      .then(() => window.dispatchEvent(new Event('ccv-presets-changed')))
      .catch(() => {});
  };

  saveCustomUltraplanExpert = (item) => {
    const existing = this.state.customUltraplanExperts;
    const idx = existing.findIndex(e => e.id === item.id);
    const next = idx >= 0
      ? existing.map(e => (e.id === item.id ? item : e))
      : [...existing, item];
    this.persistCustomUltraplanExperts(next);
    this.closeCustomUltraplanEditor();
  };

  deleteCustomUltraplanExpert = (id) => {
    const next = this.state.customUltraplanExperts.filter(e => e.id !== id);
    this.persistCustomUltraplanExperts(next);
    if (this.state.ultraplanVariant === 'custom:' + id) {
      this.setState({ ultraplanVariant: 'codeExpert' });
    }
    this.closeCustomUltraplanEditor();
  };

  handleUltraplanUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const path = await uploadFileAndGetPath(file);
        this.setState(prev => ({
          ultraplanFiles: [...prev.ultraplanFiles, { name: file.name, path }],
        }));
      } catch (err) {
        console.error('Ultraplan upload failed:', err);
        message.error(err?.message || 'Upload failed');
      }
    };
    input.click();
  };

  handleUltraplanPaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const path = await uploadFileAndGetPath(file);
          const name = file.name || `paste-${Date.now()}.png`;
          this.setState(prev => ({
            ultraplanFiles: [...prev.ultraplanFiles, { name, path }],
          }));
        } catch (err) {
          console.error('Ultraplan paste upload failed:', err);
          message.error(err?.message || 'Upload failed');
        }
        return;
      }
    }
  };

  handleUltraplanRemoveFile = (idx) => {
    this.setState(prev => ({
      ultraplanFiles: prev.ultraplanFiles.filter((_, i) => i !== idx),
    }));
  };

  handleEnableAgentTeam = () => {
    if (this.state.agentTeamEnabling) return;
    this.setState({ agentTeamEnabling: true });
    if (this._isWsReady()) {
      // 用当前真实的配置目录拼 prompt，避免 CLAUDE_CONFIG_DIR 用户让 Claude 去改错文件
      const settingsPath = `${getClaudeConfigDir()}/settings.json`;
      const prompt = `Add "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" to the env object in ${settingsPath}. If the env key does not exist, create it. Preserve all existing content. Only modify this one field. If ${settingsPath} does not exist, instead add the line: export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 to the user's shell profile (~/.zshrc or ~/.bashrc).`;
      const msg = { type: 'input', data: prompt + '\r' };
      if (this.props.tid) msg.tid = this.props.tid;
      this._sendWsMessage(msg);
      message.success('需要重启 Claude Code 才能生效');
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  render() {
    const { pendingImages, onRemovePendingImage } = this.props;
    return (
      <div className={`${styles.terminalPanel}${this.state.terminalFocused ? ` ${styles.terminalPanelFocused}` : ''}`}>
        <div ref={this.containerRef} className={styles.terminalContainer} />
        {pendingImages?.length > 0 && (
          <div className={styles.pendingFileStrip}>
            {pendingImages.map((img, i) => {
              const fileName = img.path.split('/').pop() || img.path;
              const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(fileName);
              const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(img.path)}`);
              return isImage ? (
                <div key={img.path} className={styles.pendingImageItem}>
                  <img
                    src={src}
                    className={styles.pendingImageThumb}
                    alt={fileName}
                    role="button"
                    tabIndex={0}
                    onClick={() => this.setState({ lightbox: { src, alt: fileName } })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setState({ lightbox: { src, alt: fileName } }); } }}
                  />
                  <ConfirmRemoveButton
                    title={t('ui.chatInput.confirmRemoveImage')}
                    onConfirm={() => onRemovePendingImage?.(i)}
                    className={styles.pendingImageRemove}
                    ariaLabel={t('ui.chatInput.removeImage')}
                  >&times;</ConfirmRemoveButton>
                </div>
              ) : (
                <span key={img.path} className={styles.pendingFileTag}>
                  <span className={styles.pendingFileName}>{fileName}</span>
                  <ConfirmRemoveButton
                    title={t('ui.chatInput.confirmRemoveFile')}
                    onConfirm={() => onRemovePendingImage?.(i)}
                    className={styles.pendingFileClose}
                    ariaLabel={t('ui.chatInput.removeImage')}
                  >&times;</ConfirmRemoveButton>
                </span>
              );
            })}
          </div>
        )}
        <input type="file" ref={this.fileInputRef} className={styles.hiddenFileInput} onChange={this.handleFileUpload} />
        {(!isMobile || isPad) && (
          <div className={styles.terminalToolbar}>
            <button className={styles.toolbarBtn} onClick={() => this.fileInputRef.current?.click()} title={t('ui.terminal.upload')}>
              <UploadIcon />
              <span>{t('ui.terminal.upload')}</span>
            </button>
            {this.state.agentTeamEnabled ? (
              <Popover
                trigger="hover"
                placement="top"
                open={this.state.agentTeamPopoverOpen}
                onOpenChange={(v) => this.setState({ agentTeamPopoverOpen: v })}
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: 4, minWidth: 140 }}
                content={
                  <div className={styles.presetMenu}>
                    <button className={`${styles.presetMenuItem} ${styles.presetMenuItemMuted}`} onClick={() => { this.setState({ agentTeamPopoverOpen: false, presetModalVisible: true }); }}>
                      {t('ui.terminal.customShortcuts')}
                    </button>
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
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '12px 16px', maxWidth: 360 }}
                content={
                  <div>
                    <div className={styles.agentTeamDisabledTip}>{tc('ui.terminal.agentTeamDisabledTip')}</div>
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
            {this.state.agentTeamEnabled ? (
              <Popover
                trigger="click"
                placement="top"
                open={this.state.ultraplanOpen}
                onOpenChange={(v) => {
                  if (!v && (this.state.lightbox || this.state.ultraplanLightbox || this.state.ultraplanConfirming)) return;
                  if (!v) this.setState({ ultraplanOpen: false });
                }}
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: 0, width: 420 }}
                content={
                  <div className={styles.ultraplanPanel}>
                    <div className={styles.ultraplanHeader}>
                      <span className={styles.ultraplanHeaderTitle}>{t('ui.ultraplan.title')}<ConceptHelp doc="UltraPlan" zIndex={1100} /></span>
                      <button
                        type="button"
                        className={styles.ultraplanCloseBtn}
                        onClick={() => this.setState({ ultraplanOpen: false })}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <div className={styles.ultraplanVariantRow}>
                      <button
                        className={`${styles.ultraplanRoleBtn} ${this.state.ultraplanVariant === 'codeExpert' ? styles.ultraplanRoleBtnActive : ''}`}
                        onClick={() => this.setState({ ultraplanVariant: 'codeExpert' })}
                      ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>{t('ui.ultraplan.roleCodeExpert')}</button>
                      <button
                        className={`${styles.ultraplanRoleBtn} ${this.state.ultraplanVariant === 'researchExpert' ? styles.ultraplanRoleBtnActive : ''}`}
                        onClick={() => this.setState({ ultraplanVariant: 'researchExpert' })}
                      ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>{t('ui.ultraplan.roleResearchExpert')}</button>
                      {this.state.customUltraplanExperts.map(item => {
                        const vkey = 'custom:' + item.id;
                        return (
                          <span key={item.id} className={styles.ultraplanCustomWrap}>
                            <button
                              className={`${styles.ultraplanRoleBtn} ${this.state.ultraplanVariant === vkey ? styles.ultraplanRoleBtnActive : ''}`}
                              onClick={() => this.setState({ ultraplanVariant: vkey })}
                              title={item.title}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
                              <span className={styles.ultraplanCustomTitle}>{item.title}</span>
                            </button>
                            <span
                              className={styles.ultraplanEditPencil}
                              onClick={(e) => { e.stopPropagation(); this.openCustomUltraplanEditor(item); }}
                              title={t('ui.ultraplan.customEditTitle')}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                            </span>
                          </span>
                        );
                      })}
                      <button
                        type="button"
                        className={styles.ultraplanAddExpertBtn}
                        onClick={() => this.openCustomUltraplanEditor(null)}
                        title={t('ui.ultraplan.customAdd')}
                        aria-label={t('ui.ultraplan.customAdd')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    </div>
                    {(!this.props.modelName || getModelMaxTokens(this.props.modelName) < 1000000) && (
                      <div className={styles.ultraplanContextWarning}>{t('ui.ultraplan.contextWarning')}</div>
                    )}
                    {this.state.ultraplanFiles.length > 0 && (
                      <div className={styles.ultraplanFileList}>
                        {this.state.ultraplanFiles.map((f, i) => {
                          const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(f.name);
                          const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(f.path)}`);
                          return isImage ? (
                            <div key={i} className={styles.ultraplanImageItem} title={f.name}>
                              <img
                                src={src}
                                className={styles.ultraplanImageThumb}
                                alt={f.name}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); this.setState({ ultraplanLightbox: { src, alt: f.name } }); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setState({ ultraplanLightbox: { src, alt: f.name } }); } }}
                              />
                              <ConfirmRemoveButton
                                title={t('ui.chatInput.confirmRemoveImage')}
                                onConfirm={() => this.handleUltraplanRemoveFile(i)}
                                onPopupOpenChange={(open) => this.setState({ ultraplanConfirming: open })}
                                className={styles.ultraplanImageRemove}
                                ariaLabel={t('ui.chatInput.removeImage')}
                              >&times;</ConfirmRemoveButton>
                            </div>
                          ) : (
                            <span key={i} className={styles.ultraplanFileChip} title={f.name}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <span className={styles.ultraplanFileName}>{f.name}</span>
                              <ConfirmRemoveButton
                                tag="span"
                                title={t('ui.chatInput.confirmRemoveFile')}
                                onConfirm={() => this.handleUltraplanRemoveFile(i)}
                                onPopupOpenChange={(open) => this.setState({ ultraplanConfirming: open })}
                                className={styles.ultraplanFileRemove}
                                ariaLabel={t('ui.chatInput.removeImage')}
                              >&times;</ConfirmRemoveButton>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <textarea
                      className={styles.ultraplanTextarea}
                      value={this.state.ultraplanPrompt}
                      onChange={(e) => this.setState({ ultraplanPrompt: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (this.state.ultraplanPrompt.trim() || this.state.ultraplanFiles.length > 0)) { e.preventDefault(); this.handleUltraplanSend(); } }}
                      onPaste={this.handleUltraplanPaste}
                      placeholder={t('ui.ultraplan.placeholder')}
                      rows={5}
                      autoFocus
                    />
                    <div className={styles.ultraplanFooter}>
                      <button className={styles.ultraplanSendBtn} disabled={!this.state.ultraplanPrompt.trim() && this.state.ultraplanFiles.length === 0} onClick={this.handleUltraplanSend}>{t('ui.ultraplan.send')}</button>
                      <button className={styles.ultraplanUploadBtn} onClick={this.handleUltraplanUpload}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>{t('ui.ultraplan.upload')}</button>
                    </div>
                  </div>
                }
              >
                <button className={styles.toolbarBtn} onClick={() => this.setState({ ultraplanOpen: true })} title={t('ui.ultraplan')}>
                  <UltraplanIcon />
                  <span>UltraPlan</span>
                </button>
              </Popover>
            ) : (
              <Popover
                trigger="click"
                placement="top"
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '12px 16px', maxWidth: 360 }}
                content={
                  <div>
                    <div className={styles.agentTeamDisabledTip}>{t('ui.ultraplan.agentTeamRequired')}</div>
                    <Button type="primary" size="small" loading={this.state.agentTeamEnabling} disabled={this.state.agentTeamEnabling} onClick={this.handleEnableAgentTeam}>{this.state.agentTeamEnabling ? t('ui.terminal.agentTeamEnabling') : t('ui.terminal.agentTeamEnable')}</Button>
                  </div>
                }
              >
                <button className={`${styles.toolbarBtn} ${styles.toolbarBtnDisabled}`} title={t('ui.ultraplan')}>
                  <UltraplanIcon />
                  <span>UltraPlan</span>
                </button>
              </Popover>
            )}
            {(() => {
              // i18n 是单句 "X？Y。" 结构，按 ? / ？ 拆成 Popconfirm 的 title + description 以换行呈现
              const confirmFull = t('ui.chatInput.clearContextConfirm');
              const qIdx = Math.max(confirmFull.indexOf('？'), confirmFull.indexOf('?'));
              const confirmTitle = qIdx > 0 ? confirmFull.slice(0, qIdx + 1) : confirmFull;
              const confirmDesc = qIdx > 0 ? confirmFull.slice(qIdx + 1).trim() : null;
              return (
                <Popconfirm
                  title={confirmTitle}
                  description={confirmDesc}
                  okText={t('ui.chatInput.clearContext')}
                  cancelText={t('ui.common.confirmCancel')}
                  okButtonProps={{ danger: true }}
                  placement="top"
                  onConfirm={this.handleClearContext}
                >
                  <button className={styles.toolbarBtn} title={t('ui.chatInput.clearContext')}>
                    <TrashIcon />
                    <span>{t('ui.chatInput.clearContext')}</span>
                  </button>
                </Popconfirm>
              );
            })()}
            <button className={`${styles.toolbarBtn} ${styles.toolbarBtnRight}`} onClick={() => this.setState({ presetModalVisible: true })} title={t('ui.terminal.presetShortcuts')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        )}
        {(isMobile && !isPad) && (
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
          styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
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
          styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
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
        <CustomUltraplanEditModal
          open={this.state.customUltraplanEditOpen}
          initial={this.state.customUltraplanEditing}
          onSave={this.saveCustomUltraplanExpert}
          onDelete={this.deleteCustomUltraplanExpert}
          onClose={this.closeCustomUltraplanEditor}
        />
        {this.state.lightbox && (
          <ImageLightbox
            src={this.state.lightbox.src}
            alt={this.state.lightbox.alt}
            onClose={() => this.setState({ lightbox: null })}
          />
        )}
        {this.state.ultraplanLightbox && (
          <ImageLightbox
            src={this.state.ultraplanLightbox.src}
            alt={this.state.ultraplanLightbox.alt}
            zIndex={1200}
            onClose={() => this.setState({ ultraplanLightbox: null })}
          />
        )}
      </div>
    );
  }
}

export default TerminalPanel;
