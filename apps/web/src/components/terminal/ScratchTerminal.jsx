// ============================================================================
// scratch (小) terminal 组件 —— 工具栏下方的多 tab 临时 shell 面板
// 区别于"主 terminal"（Claude Code TUI 渲染区，见 TerminalPanel.jsx）
// CSS：scratch 用 .scratchInner + .scratchHost；主 terminal 用 .terminalContainer + .terminalHost
// ============================================================================
import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { darkTerminalTheme, lightTerminalTheme, terminalFontFamily } from './terminalThemes';
import { isWindows, isMac } from '../../env';
import styles from './TerminalPanel.module.css';
import { TerminalWriteQueue, INBAND_RESET } from '../../utils/terminalWriteQueue';
import { diagCount } from '../../utils/termDiag';
import { sanitizeBracketPasteText } from '../../utils/ptyChunkBuilder';
import { clipboardKeyAction, copyTextToClipboard, planPasteSend } from '../../utils/terminalClipboard';
import { appendToken, getBasePath } from '../../utils/apiUrl';

class ScratchTerminal extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.terminal = null;
    this.fitAddon = null;
    this.ws = null;
    this.resizeObserver = null;
    // 写入节流复用 TerminalPanel 同款 utility（utils/terminalWriteQueue.js）。
    // ScratchTerminal 历史用 [string].push + join 的实现，单字符串 push 不存在
    // O(n²) 切片问题，但 unmount 时同样会丢最后 16ms buffer；改用 utility 统一行为。
    // Windows DOM 渲染器 chunk 初值保守起步，AIMD 自适应（与 TerminalPanel 同策略）
    this._writeQ = new TerminalWriteQueue(
      () => this.terminal,
      {
        ...(isWindows ? { initialChunkBytes: 16 * 1024 } : null),
        // 积压丢弃后向服务端请求权威快照对齐（同 TerminalPanel，2s 节流见 _requestResync）
        onTrim: () => this._requestResync(),
      }
    );
    this._closing = false;
  }

  // write-queue 积压丢弃后请求服务端快照对齐（服务端回 data-resync）。
  // 持续过载期 _maybeTrim 每次 push 都可能触发——2s 节流防请求风暴（服务端另有冷却兜底）。
  _requestResync() {
    const nowTs = Date.now();
    if (nowTs - (this._lastResyncReqAt || 0) < 2000) return;
    this._lastResyncReqAt = nowTs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'resync-request' })); } catch {}
    }
  }

  componentDidMount() {
    this.initTerminal();
    this.connectWebSocket();
    this.setupResizeObserver();
    this._themeObserver = new MutationObserver(() => {
      if (this.terminal) {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        this.terminal.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
      }
    });
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  componentWillUnmount() {
    this._closing = true;
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this._themeObserver) { this._themeObserver.disconnect(); this._themeObserver = null; }
    // unmount 前同步排空 buffer 给 xterm，再 dispose 队列；与 terminal.dispose 顺序无关。
    if (this._writeQ) {
      try { this._writeQ.drain(); } catch {}
      this._writeQ.dispose();
    }
    if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    // 解绑 textarea focus/blur 监听并把 parent 的 focus state 清掉，
    // 防止 toggle 关闭 scratch 时 .scratchPanesFocused 边框残留亮起
    if (this.terminal?.textarea) {
      try {
        this.terminal.textarea.removeEventListener('focus', this._handleScratchFocus);
        this.terminal.textarea.removeEventListener('blur', this._handleScratchBlur);
        this.terminal.textarea.removeEventListener('paste', this._handleScratchPaste, true);
      } catch {}
    }
    try { this.props.onFocusChange?.(false); } catch {}
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.terminal) {
      try { this.terminal.dispose(); } catch {}
      this.terminal = null;
    }
  }

  initTerminal() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    this.terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorWidth: 1,
      fontSize: 13,
      fontFamily: terminalFontFamily,
      theme: isDark ? darkTerminalTheme : lightTerminalTheme,
      allowProposedApi: true,
      // 与 TerminalPanel 同款：Windows 下超宽字形按 cell 缩放，治 IME 中文偏移
      rescaleOverlappingGlyphs: isWindows,
      scrollback: 1000,
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

    // Win/Linux 智能复制粘贴（同 TerminalPanel，见 utils/terminalClipboard.js）：
    // xterm 6 把 Ctrl+C/Ctrl+V 当控制字符并 preventDefault，压掉原生 paste。
    this.terminal.attachCustomKeyEventHandler((e) => {
      const clipAction = clipboardKeyAction(e, { isMac });
      if (clipAction === 'paste') {
        // 主动读剪贴板（scratch 是真实 shell，无图片上传，纯文本），走 _pasteScratchText 安全路径。
        if (navigator.clipboard?.readText) {
          e.preventDefault();
          e.stopPropagation();
          // 双重粘贴防护：见 TerminalPanel 同名注释。主动读期间让 _handleScratchPaste 早退。
          this._activePasteInFlight = true;
          setTimeout(() => { this._activePasteInFlight = false; }, 0);
          this._activeScratchPaste();
          return false;
        }
        return false; // 非安全上下文无 clipboard API：放行原生 paste → _handleScratchPaste
      }
      if (clipAction === 'copy') {
        const sel = this.terminal?.getSelection?.();
        if (sel) {
          // 仅复制成功才清选区（失败时保留，用户可改用 Ctrl+Insert）
          e.preventDefault();
          e.stopPropagation();
          copyTextToClipboard(sel).then((ok) => { if (ok) this.terminal?.clearSelection?.(); });
          return false;
        }
        return true; // 无选区：交回 xterm 发 \x03（SIGINT）
      }
      return true;
    });

    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // 上报 focus / blur 给父组件，驱动 .scratchPanesFocused 边框
    this._handleScratchFocus = () => { try { this.props.onFocusChange?.(true); } catch {} };
    this._handleScratchBlur = () => { try { this.props.onFocusChange?.(false); } catch {} };
    // 粘贴注入防护：含 \x1b[20[01]~ 时接管（sanitize + 自行包裹），否则交回 xterm 默认处理
    this._handleScratchPaste = (e) => {
      // 主动粘贴进行中：阻止原生 paste 叠加（见 attachCustomKeyEventHandler 的 _activePasteInFlight 注释）
      if (this._activePasteInFlight) { e.preventDefault?.(); e.stopPropagation?.(); return; }
      const text = e.clipboardData?.getData('text');
      if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // 包裹/消毒决策抽到 planPasteSend（与 TerminalPanel._handlePaste 同策略）：返回 null 交 xterm 处理
      const data = planPasteSend(text, {
        bracketedPasteMode: this.terminal?.modes?.bracketedPasteMode,
        active: false,
        sanitize: sanitizeBracketPasteText,
      });
      if (data != null) {
        e.preventDefault();
        e.stopPropagation();
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    };
    const ta = this.terminal.textarea;
    if (ta) {
      ta.addEventListener('focus', this._handleScratchFocus);
      ta.addEventListener('blur', this._handleScratchBlur);
      // paste-injection 防护（与 TerminalPanel._handlePaste 同策略）：scratch 是真实 shell，
      // 剪贴板内嵌 \x1b[201~ 会提前闭合 bracketed paste 注入命令；xterm 6.0 自动包裹不
      // sanitize（上游 7.0 才修）。capture=true 抢在 xterm 自身 paste handler 之前接管。
      ta.addEventListener('paste', this._handleScratchPaste, true);
    }

    // 字体异步就绪后重 fit（与 TerminalPanel 同理，复用公开 refit）
    if (typeof document !== 'undefined' && document.fonts?.ready?.then) {
      document.fonts.ready.then(() => {
        if (!this.terminal) return;
        this.refit();
        try { this.terminal.refresh(0, this.terminal.rows - 1); } catch { /* noop */ }
      });
    }
  }

  // 主动粘贴的安全送出：复用 planPasteSend（active=true，无原生 paste 事件 → bracketedPasteMode 也自行包裹）
  _pasteScratchText = (text) => {
    if (!text || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const data = planPasteSend(text, {
      bracketedPasteMode: this.terminal?.modes?.bracketedPasteMode,
      active: true,
      sanitize: sanitizeBracketPasteText,
    });
    if (data != null) this.ws.send(JSON.stringify({ type: 'input', data }));
  };

  // 调用前已确认 navigator.clipboard.readText 存在（见 open() 中 attachCustomKeyEventHandler 的 paste 分支）
  _activeScratchPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this._pasteScratchText(text);
    } catch (err) {
      console.warn('[CC Viewer] scratch active paste failed; fall back to Ctrl+Shift+V', err);
    }
  };

  _throttledWrite = (data) => {
    this._writeQ.push(data);
  };

  connectWebSocket() {
    if (this._closing) return;
    const id = this.props.id;
    if (!id) return; // 没 id 不能连
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 带上 LAN token(已有 ?id= → appendToken 用 & 续接);密码登录用户走 cookie。见 TerminalWsContext。
    const wsUrl = appendToken(`${protocol}//${window.location.host}${getBasePath().replace(/\/$/, '')}/ws/terminal-scratch?id=${encodeURIComponent(id)}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          this._throttledWrite(msg.data);
        } else if (msg.type === 'data-resync') {
          // 服务端反压恢复:丢弃积压、带内重置、写快照对齐(reset 清 scrollback 的取舍 +
          // 带内 INBAND_RESET 防 WriteBuffer 残留撕裂,见 TerminalPanel 同分支注释)
          diagCount('resyncCount');
          this._writeQ.reset();
          this._writeQ.push(INBAND_RESET + '\x1b[33m[cc-viewer] output skipped during congestion\x1b[0m\r\n');
          if (msg.data) this._writeQ.push(msg.data);
        } else if (msg.type === 'state') {
          // 后端首条 state 消息携带 shellBasename，给父组件渲染 tab 标签
          if (msg.shellBasename) {
            try { this.props.onShellInfo?.(msg.shellBasename); } catch {}
          }
        } else if (msg.type === 'exit') {
          // xterm 在 dispose 与同步 ws 消息之间存在窗口，写入 disposed terminal 会抛——保险起见 try/catch
          try { if (this.terminal) this.terminal.write(`\r\n\x1b[90m[scratch shell exited: ${msg.exitCode ?? '?'}]\x1b[0m\r\n`); } catch {}
        } else if (msg.type === 'toast') {
          try { if (this.terminal) this.terminal.write(`\r\n\x1b[33m⚠ ${msg.message}\x1b[0m\r\n`); } catch {}
        }
      } catch {
        // 解析失败/handler 抛错 = 该条消息整体丢弃（流中间挖洞）→ 请求快照对齐兜底
        try { this.ws?.send(JSON.stringify({ type: 'resync-request' })); } catch {}
      }
    };

    this.ws.onclose = () => {
      if (this._closing) return;
      // 重连前清屏 + 清写队列（同 TerminalPanel 的 close 处理）：服务端每次新连接都无条件
      // 重发完整 replay buffer(≤50KB)，不 reset 会让旧内容整段在 scrollback 重复渲染。
      // 重置走带内序列防 WriteBuffer 残留撕裂（见 terminalWriteQueue.INBAND_RESET doc）。
      this._writeQ.reset();
      this._writeQ.push(INBAND_RESET);
      this._wsReconnectTimer = setTimeout(() => {
        if (!this._closing && this.containerRef.current) {
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
    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = setTimeout(() => {
        if (!this.fitAddon || !this.terminal) return;
        const el = this.containerRef.current;
        if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
        try {
          this.fitAddon.fit();
          this.sendResize();
        } catch {}
      }, 80);
    });
    if (this.containerRef.current) {
      this.resizeObserver.observe(this.containerRef.current);
    }
  }

  // 公开方法：父组件在 tab 切换 / 首次显示时调用
  // display:none -> block 不会触发 ResizeObserver，必须显式 fit
  refit = () => {
    if (!this.fitAddon || !this.terminal) return;
    const el = this.containerRef.current;
    if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
    try {
      this.fitAddon.fit();
      this.sendResize();
    } catch {}
  };

  focus = () => {
    try { this.terminal?.focus(); } catch {}
  };

  // 关闭 tab 时通知后端 kill 该 id 的 pty
  requestKill = () => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'kill' })); } catch {}
    }
    this._closing = true;
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  };

  render() {
    // === scratch (小) terminal 渲染区 ===
    // 外层 .scratchInner：focus 出血带；内层 .scratchHost：xterm 实际父容器，
    // margin-bottom 4px 让 fitAddon 拿到的高度始终 -4px，xterm-screen 接触不到下方分隔线
    return (
      <div className={styles.scratchInner}>
        <div ref={this.containerRef} className={styles.scratchHost} />
      </div>
    );
  }
}

export default ScratchTerminal;
