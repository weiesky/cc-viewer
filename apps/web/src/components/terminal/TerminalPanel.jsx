// ============================================================================
// 主 terminal 组件 —— 渲染 Claude Code TUI 的"大 terminal"
// 工具栏下方的"小/scratch terminal"是另外一个独立组件，见 ScratchTerminal.jsx
// CSS：主 terminal 用 .terminalContainer + .terminalHost；scratch 用 .scratchInner + .scratchHost
// ============================================================================
import React from 'react';
import { message, Tooltip, Popover, Popconfirm, Button, Checkbox, Modal } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { t } from '../../i18n';
import { TerminalWsContext } from './TerminalWsContext';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile, isIOS, isAndroid, isPad, isWindows, isMac } from '../../env';
import styles from './TerminalPanel.module.css';
import { BUILTIN_PRESETS } from '../../utils/builtinPresets.js';
import { buildLocalUltraplan } from '../../utils/ultraplanTemplates';
import { UltraplanController } from '../../utils/ultraplanController';
import { buildBracketPasteSubmitChunks, BRACKET_PASTE_SUBMIT_SETTLE_MS, sanitizeBracketPasteText } from '../../utils/ptyChunkBuilder';
import { clipboardKeyAction, copyTextToClipboard, planPasteSend } from '../../utils/terminalClipboard';
import CustomUltraplanEditModal from './CustomUltraplanEditModal';
import UltraplanExpertManagerModal from './UltraplanExpertManagerModal';
import { visibleExpertKeys } from '../../utils/ultraplanExperts';
import { TerminalWriteQueue, INBAND_RESET } from '../../utils/terminalWriteQueue';
import { installTermDiag, diagCount } from '../../utils/termDiag';
import { downscaleForRetina } from '../../utils/imageDownscale';
import { buildPresetShortcutsPayload } from '../../utils/presetShortcuts';
import ImageLightbox from '../common/ImageLightbox';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import ScratchTerminal from './ScratchTerminal';
import { darkTerminalTheme, lightTerminalTheme, terminalFontFamily } from './terminalThemes';
import { resizeImageIfNeeded } from '../../utils/imageResize';
import UltraplanPanel, { readUltraplanPopoverSize, ultraplanOverlayInnerStyle } from './UltraplanPanel';
import { AgentTeamIcon, UploadIcon, TrashIcon, SPARKLE_MASK_STYLE, ULTRAPLAN_MASK_STYLE } from '../common/quickMenuIcons';
import QuickAutoApproveRows from '../common/QuickAutoApproveRows';
import { createQuickMenuHoverIntent } from '../../utils/quickMenuHoverIntent';
import chrome from '../common/sharedChrome.module.css';

// WebGL longtask 自动降级常量
const WEBGL_STALL_MS = 200;          // 单次 longtask 阈值 (ms)
const WEBGL_STALL_COUNT = 3;         // 触发降级的 stall 次数
const WEBGL_STALL_WINDOW_MS = 30000; // 滑动窗口 (ms)
const WEBGL_GRACE_MS = 5000;         // 初始化宽限期 (ms)
const WEBGL_STICKY_KEY = 'ccv_webgl_disabled_until';
const WEBGL_STICKY_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天后自动重试

// 渲染器平台策略:Android(移动端 DOM 卡顿明显)无条件 WebGL;macOS 桌面在 longtask 守卫
// 可用时启用 WebGL(能力门:Safari 无 'longtask' PerformanceObserver,守卫失效则不冒险,
// 留 DOM;Chrome/Edge/Electron 带完整降级安全网)。Windows/Linux 维持 DOM(GPU 长任务/
// 花屏实测多发)。isIOS 排除 iPadOS(iPad 桌面 UA 的 navigator.platform 是 MacIntel,
// 会误命中 isMac)。
const WEBGL_RENDERER = isAndroid || (isMac && !isIOS
  && typeof PerformanceObserver !== 'undefined'
  && !!PerformanceObserver.supportedEntryTypes?.includes('longtask'));

const SCRATCH_OPEN_KEY = 'cc-viewer-scratch-open';
const SCRATCH_HEIGHT_KEY = 'cc-viewer-scratch-height';
const SCRATCH_TABS_KEY = 'cc-viewer-scratch-tabs';
const SCRATCH_ACTIVE_TAB_KEY = 'cc-viewer-scratch-active-tab';
// 注：.scratchWrap 用 outline + outline-offset:-4px 画 focus 环（不占布局），存储/clamp 的高度
// 即可见高度本身，不再被边框吞噬；fitAddon 自动 refit，与历史 session 存储值兼容。
const SCRATCH_HEIGHT_MIN = 100;
const SCRATCH_HEIGHT_MAX = 600;
const SCRATCH_HEIGHT_DEFAULT = 200;
const SCRATCH_TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SCRATCH_TAB_MAX = 8;

function readScratchOpen() {
  try { return localStorage.getItem(SCRATCH_OPEN_KEY) === 'true'; } catch { return false; }
}
function readScratchHeight() {
  try {
    const v = parseInt(localStorage.getItem(SCRATCH_HEIGHT_KEY), 10);
    if (!Number.isFinite(v)) return SCRATCH_HEIGHT_DEFAULT;
    return Math.max(SCRATCH_HEIGHT_MIN, Math.min(SCRATCH_HEIGHT_MAX, v));
  } catch { return SCRATCH_HEIGHT_DEFAULT; }
}

function genScratchTabId() {
  // 与服务端 SCRATCH_ID_RE `/^[A-Za-z0-9_-]{1,64}$/` 兼容
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return ('t-' + rand).slice(0, 64);
}

function readScratchTabs() {
  try {
    const raw = localStorage.getItem(SCRATCH_TABS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const t of arr) {
      if (t && typeof t.id === 'string' && SCRATCH_TAB_ID_RE.test(t.id)) {
        out.push({ id: t.id });
        if (out.length >= SCRATCH_TAB_MAX) break;
      }
    }
    return out;
  } catch { return []; }
}

function readScratchActiveTab(tabs) {
  try {
    const v = localStorage.getItem(SCRATCH_ACTIVE_TAB_KEY);
    if (v && tabs.some(t => t.id === v)) return v;
  } catch {}
  return tabs[0]?.id ?? '';
}

function writeScratchTabs(tabs) {
  try { localStorage.setItem(SCRATCH_TABS_KEY, JSON.stringify(tabs)); } catch {}
}
function writeScratchActiveTab(id) {
  try { localStorage.setItem(SCRATCH_ACTIVE_TAB_KEY, id); } catch {}
}

// 真实 $SHELL basename 由后端 WS state 消息上报后填进 state.scratchShellBasename，
// 在拿到之前用 'zsh' 作为占位（macOS 默认 shell；新 server 到达 state 后会按真实 basename 覆盖）

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// SparkleIcon / ShieldCheckIcon / PlanClipboardIcon / AgentTeamIcon / UltraplanIcon /
// UploadIcon / TrashIcon 已迁至 ../common/quickMenuIcons.jsx（与 ChatInputBar 四芒星菜单共用）

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ScratchTerminalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

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
  // 通过 Context 共享 App 层的单条 /ws/terminal,this.context = { send, isOpen, addMessageHandler, addStateListener }
  static contextType = TerminalWsContext;

  // 兼容 stub:同 ChatView,getter 模拟旧 this.ws 的 send/readyState API → 映射到 context。
  // 这样所有 `this.ws.send(JSON.stringify(...))` 和 `this.ws.readyState === WebSocket.OPEN` 不用改。
  get ws() {
    const ctx = this.context;
    if (!ctx || typeof ctx.send !== 'function') return null;
    return {
      get readyState() { return ctx.isOpen && ctx.isOpen() ? WebSocket.OPEN : WebSocket.CLOSED; },
      send: (s) => {
        let obj;
        try { obj = JSON.parse(s); } catch { return false; }
        return ctx.send(obj);
      },
    };
  }

  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.fileInputRef = React.createRef();
    // UltraPlan 文件 / 自定义专家纯逻辑（与 ChatView 共享，见 ../utils/ultraplanController）。
    // host 适配器桥接 state / 上传 / 提示 / 偏好 / 关闭编辑器；下方 6 个方法退化为委托。
    this._ultraplan = new UltraplanController({
      getState: () => this.state,
      setState: (updater) => this.setState(updater),
      onUpdatePreferences: (p) => this.props.onUpdatePreferences?.(p),
      uploadFile: (file) => uploadFileAndGetPath(file),
      messageError: (msg) => message.error(msg),
      closeEditor: () => this.closeCustomUltraplanEditor(),
    });
    this.terminal = null;
    this.fitAddon = null;
    // ws 现在是 getter(挂在原型),不在 constructor 上设字段,避免覆盖 getter
    this._unsubWsHandler = null;
    this._unsubWsState = null;
    this.resizeObserver = null;
    this.state = {
      terminalFocused: false,
      // Optimistic: agent-teams is on by default at launch, so assume enabled until
      // /api/claude-settings resolves — avoids a first-paint layout shift on the common
      // path. Flips to false on mount/update only for the rare explicit opt-out.
      agentTeamEnabled: true,
      quickSettingsOpen: false,
      quickSettingsExpanded: null, // null | 'agentteam' | 'perm' | 'plan' —— 同时只展开一个子菜单

      ultraplanOpen: false,
      ultraplanVariant: 'codeExpert',
      ultraplanPrompt: '',
      ultraplanFiles: [],
      // PC UltraPlan popover 拖拽尺寸,持久化到 localStorage 两 key;手机/iPad 不走这条路径
      // (那边用 UltraPlanModal),所以无 gate,但 popover 入口本身 isMobile 不显示终端工具栏。
      ultraplanPopoverSize: readUltraplanPopoverSize(),
      customUltraplanExperts: [],
      // 专家显隐 / 排序(管理弹窗)。键 = 'codeExpert' / 'researchExpert' / 'custom:'+id;
      // 落服务端 preferences(ultraplanExpertOrder / ultraplanExpertHidden),缺省=自然序、全可见。
      ultraplanExpertOrder: [],
      ultraplanExpertHidden: [],
      ultraplanManagerOpen: false,
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
      scratchOpen: readScratchOpen(),
      scratchHeight: readScratchHeight(),
      isDraggingScratch: false,
      scratchFocused: false,
      scratchTabs: (() => {
        const t = readScratchTabs();
        return t.length > 0 ? t : [{ id: genScratchTabId() }];
      })(),
      activeScratchTabId: '',
      scratchShellBasename: '',
    };
    // 持久化 active id（先用 readScratchActiveTab 选；下面 mount 后再 sync 到 localStorage）
    this.state.activeScratchTabId = readScratchActiveTab(this.state.scratchTabs);
    this._scratchWrapRef = React.createRef();
    this._scratchRefs = new Map(); // id -> React.createRef()
    this._scratchDragging = false;
    this._scratchDragLastH = null;
    this._scratchPointerId = null;
  }

  _getScratchRef(id) {
    let ref = this._scratchRefs.get(id);
    if (!ref) {
      ref = React.createRef();
      this._scratchRefs.set(id, ref);
    }
    return ref;
  }

  handleScratchTabClick = (id) => {
    if (id === this.state.activeScratchTabId) return;
    this.setState({ activeScratchTabId: id }, () => {
      writeScratchActiveTab(id);
      const r = this._scratchRefs.get(id);
      if (r?.current) {
        r.current.refit();
        r.current.focus();
      }
    });
  };

  handleScratchTabAdd = () => {
    if (this.state.scratchTabs.length >= SCRATCH_TAB_MAX) return;
    const newId = genScratchTabId();
    const tabs = [...this.state.scratchTabs, { id: newId }];
    this.setState({ scratchTabs: tabs, activeScratchTabId: newId }, () => {
      writeScratchTabs(tabs);
      writeScratchActiveTab(newId);
      // 等下一帧 ScratchTerminal mount + 显示后再 refit/focus
      Promise.resolve().then(() => {
        const r = this._scratchRefs.get(newId);
        r?.current?.refit();
        r?.current?.focus();
      });
    });
  };

  handleScratchTabClose = (id, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (this.state.scratchTabs.length <= 1) return; // 最少保留 1
    const ref = this._scratchRefs.get(id);
    try { ref?.current?.requestKill(); } catch {}
    this._scratchRefs.delete(id);
    const idx = this.state.scratchTabs.findIndex(t => t.id === id);
    const tabs = this.state.scratchTabs.filter(t => t.id !== id);
    let active = this.state.activeScratchTabId;
    if (active === id) {
      // 取右邻居，否则左邻居
      active = (this.state.scratchTabs[idx + 1] ?? this.state.scratchTabs[idx - 1])?.id ?? tabs[0]?.id ?? '';
    }
    this.setState({ scratchTabs: tabs, activeScratchTabId: active }, () => {
      writeScratchTabs(tabs);
      writeScratchActiveTab(active);
      if (active) {
        const r = this._scratchRefs.get(active);
        r?.current?.refit();
        r?.current?.focus();
      }
    });
  };

  // 仅 active tab 的 focus/blur 事件影响 scratchFocused，避免 tab 切换时新旧并发触发抖动
  handleScratchTabFocusChange = (id, focused) => {
    if (id !== this.state.activeScratchTabId) return;
    if (focused !== this.state.scratchFocused) {
      this.setState({ scratchFocused: focused });
    }
  };

  // 后端首条 state 消息携带 shellBasename；所有 tab 共用一个 $SHELL，只需取第一次到达的
  handleScratchShellInfo = (name) => {
    if (!name || this.state.scratchShellBasename) return;
    this.setState({ scratchShellBasename: name });
  };

  toggleScratch = () => {
    const next = !this.state.scratchOpen;
    this.setState({ scratchOpen: next });
    try { localStorage.setItem(SCRATCH_OPEN_KEY, String(next)); } catch {}
  };

  // 用 DOM 直写 style.height 而非 React JSX inline style：
  // 1) 防 theme MutationObserver / preset-changed 等无关 setState 在拖拽中途把高度 snap 回去
  // 2) 拖拽期间每帧 setState 抖动开销大；mouseup 时一次性 setState + localStorage 提交
  _applyScratchHeight = () => {
    const el = this._scratchWrapRef.current;
    if (el) el.style.height = this.state.scratchHeight + 'px';
  };

  // Pointer Events + setPointerCapture：自动覆盖 mouseup 飞出窗口、iPad 触摸；不挂 document 全局监听
  handleScratchResizerPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // 仅主键
    e.preventDefault();
    this._scratchDragging = true;
    this._scratchDragStartY = e.clientY;
    this._scratchDragStartH = this.state.scratchHeight;
    this._scratchDragLastH = this.state.scratchHeight;
    this._scratchPointerId = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    this.setState({ isDraggingScratch: true });
  };

  handleScratchResizerPointerMove = (e) => {
    if (!this._scratchDragging) return;
    const newH = Math.max(
      SCRATCH_HEIGHT_MIN,
      Math.min(SCRATCH_HEIGHT_MAX, this._scratchDragStartH + (this._scratchDragStartY - e.clientY))
    );
    const el = this._scratchWrapRef.current;
    if (!el) return;
    el.style.height = newH + 'px';
    this._scratchDragLastH = newH;
  };

  handleScratchResizerPointerUp = (e) => {
    if (!this._scratchDragging) return;
    this._endScratchDrag(e);
  };

  _endScratchDrag = (e) => {
    this._scratchDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (e && this._scratchPointerId != null && e.currentTarget) {
      try { e.currentTarget.releasePointerCapture(this._scratchPointerId); } catch {}
    }
    this._scratchPointerId = null;
    const h = this._scratchDragLastH;
    this._scratchDragLastH = null;
    if (h != null) {
      try { localStorage.setItem(SCRATCH_HEIGHT_KEY, String(h)); } catch {}
      this.setState({ scratchHeight: h, isDraggingScratch: false });
    } else {
      this.setState({ isDraggingScratch: false });
    }
  };

  componentDidMount() {
    // 幂等：window.__ccvTermDiag 快照 + longtask 计数 + ccv_term_diag 周期日志。
    // 有意不在 unmount 配对卸载——app-lifetime 单例（计数器/定时器全局唯一，
    // 跨面板共享；_installed 守卫防重复安装）。
    installTermDiag();
    this.initTerminal();
    // 注册 ws 消息 + 状态 handler。Provider 已在 App/Mobile 层根据 cliMode/terminalVisible 决定是否建立 ws。
    if (this.context && this.context.addMessageHandler) {
      this._unsubWsHandler = this.context.addMessageHandler(this._onTerminalWsMessage);
    }
    if (this.context && this.context.addStateListener) {
      this._unsubWsState = this.context.addStateListener(this._onTerminalWsState);
    }
    // 若 ws 已 OPEN(本组件 mount 较 Provider 晚的常见场景),立即 sendResize 让 PTY 用当前 cols/rows。
    if (this.context && this.context.isOpen && this.context.isOpen()) {
      this.sendResize();
    }
    this.setupResizeObserver();
    // 定时强制刷新,按渲染器分流:
    // - Android(WebGL):纹理脏真实存在,保留 60s L2(clearTextureAtlas + refresh + fit;
    //   phone 上 canFit=false 自动退化为 atlas+refresh,轻量)。L3(dispose+reload
    //   WebglAddon)留给用户手动判定"画面真的坏了"时升级,避免长期 GPU 抖动。
    // - mac(WebGL)/Windows·Linux·iPad(DOM):120s 轻量分支——atlas 清理(mac WebGL 防
    //   sleep-wake/GPU 切换的纹理脏累积,DOM 渲染器下为 no-op)+ 全行 refresh 被动自愈;
    //   不走 _executeRefresh(其尾部 sendResize 会复活每分钟 PTY resize 抖动),也不并入
    //   60s L2(定时 fit 重算 scrollTop 是 PC 滚动跳动来源)。iPhone 维持无定时器(内存/
    //   电量预算)。tab 隐藏时跳过(无渲染需求)。
    if (isAndroid) {
      this._autoRefreshInterval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        this._executeRefresh(2);
      }, 60000);
    } else if (!isMobile || isPad) {
      this._autoRefreshInterval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (!this.terminal) return;
        try { this.terminal.clearTextureAtlas?.(); } catch {}
        this.terminal.refresh(0, this.terminal.rows - 1);
      }, 120000);
    }
    // claude-settings 由 SettingsContext 集中提供;通过 props 派生 agentTeamEnabled,
    // mount 时若已 ready 同步 setState,否则等 componentDidUpdate 接力。
    if (this.props.claudeSettings) {
      const enabled = this.props.claudeSettings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      this.setState({ agentTeamEnabled: enabled });
    }
    // 加载预置 (props.preferences 已 ready 时立即,否则 componentDidUpdate 接力)
    this._loadPresetShortcuts();
    this._onFocusTerminal = () => { if (this.terminal && this.containerRef?.current?.offsetWidth > 0) this.terminal.focus(); };
    window.addEventListener('ccv-focus-terminal', this._onFocusTerminal);
    this._themeObserver = new MutationObserver(() => {
      if (this.terminal) {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        this.terminal.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
      }
    });
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (this.state.scratchOpen) this._applyScratchHeight();
    // mount 时 sync tab 列表 / active id 到 localStorage（兼容旧版本只有 open/height 的存档）
    writeScratchTabs(this.state.scratchTabs);
    if (this.state.activeScratchTabId) writeScratchActiveTab(this.state.activeScratchTabId);
  }

  componentDidUpdate(prevProps, prevState) {
    // SettingsContext 异步 fetch 完成后,props.claudeSettings / props.preferences 才到达;
    // 同步派生的 agentTeamEnabled 与 _loadPresetShortcuts 都在这里接力。
    if (prevProps.claudeSettings !== this.props.claudeSettings) {
      const enabled = this.props.claudeSettings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      if (enabled !== this.state.agentTeamEnabled) {
        this.setState({ agentTeamEnabled: enabled });
      }
    }
    if (prevProps.preferences !== this.props.preferences) {
      this._loadPresetShortcuts();
    }
    if (prevState.scratchOpen !== this.state.scratchOpen) {
      if (this.state.scratchOpen) {
        // componentDidUpdate 在 React commit 之后、浏览器 paint 之前同步触发，
        // 此时 ref.current 已是最新 DOM；直接写 style.height，不走 microtask 防 1 帧闪烁
        this._applyScratchHeight();
      } else if (this._scratchDragging) {
        // 拖拽过程中 scratchOpen 被外部翻 false：resizer 已卸载、pointerup 不会再触达，
        // 这里兜底恢复 body 样式与拖拽标志，防止 cursor/userSelect 残留
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this._scratchDragging = false;
        this._scratchDragLastH = null;
        this._scratchPointerId = null;
        this.setState({ isDraggingScratch: false });
      }
    }
  }

  _loadPresetShortcuts() {
    // 数据从 props.preferences 派生(SettingsContext 集中 fetch);未 ready 时静默返回,
    // componentDidUpdate 接力。
    const data = this.props.preferences;
    if (!data) return;
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
    const expertOrder = Array.isArray(data.ultraplanExpertOrder) ? data.ultraplanExpertOrder : [];
    const expertHidden = Array.isArray(data.ultraplanExpertHidden) ? data.ultraplanExpertHidden : [];
    const next = { presetItems: items, customUltraplanExperts: customExperts, ultraplanExpertOrder: expertOrder, ultraplanExpertHidden: expertHidden };
    // 若当前选中的变体已不可见（被另一端删除 / 隐藏），回退到首个可见专家（无可见则 codeExpert）。
    const current = this.state.ultraplanVariant;
    const visible = visibleExpertKeys(customExperts, expertOrder, expertHidden);
    if (typeof current === 'string' && !visible.includes(current)) {
      next.ultraplanVariant = visible[0] || 'codeExpert';
    }
    this.setState(next);
  }

  componentWillUnmount() {
    this._qmHover.cancel();
    // mid-drag 卸载兜底：恢复 body 样式，标记终止
    if (this._scratchDragging) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this._scratchDragging = false;
      this._scratchDragLastH = null;
      this._scratchPointerId = null;
    }
    if (this.terminal?.textarea) {
      this.terminal.textarea.removeEventListener('focus', this._handleTermFocus);
      this.terminal.textarea.removeEventListener('blur', this._handleTermBlur);
    }
    if (this._themeObserver) { this._themeObserver.disconnect(); this._themeObserver = null; }
    window.removeEventListener('ccv-focus-terminal', this._onFocusTerminal);
    if (this._stopMobileMomentum) this._stopMobileMomentum();
    // unmount 前同步排空 buffer 给 xterm，防最后 16ms 数据丢失（既有 bug 缓解）。
    // dispose 后 push 静默忽略、rAF 取消，与 terminal.dispose 顺序无关。
    if (this._writeQ) {
      try { this._writeQ.drain(); } catch {}
      this._writeQ.dispose();
    }
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this._unsubWsHandler) { try { this._unsubWsHandler(); } catch {} this._unsubWsHandler = null; }
    if (this._unsubWsState) { try { this._unsubWsState(); } catch {} this._unsubWsState = null; }
    if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
    if (this._webglRecoveryTimer) clearTimeout(this._webglRecoveryTimer);
    if (this._autoRefreshInterval) { clearInterval(this._autoRefreshInterval); this._autoRefreshInterval = null; }
    if (this._initRafId) { cancelAnimationFrame(this._initRafId); this._initRafId = 0; }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.webglAddon || this._webglLongtaskObserver) {
      this._disposeWebgl();
    }
    if (this.terminal) {
      if (this.terminal.textarea) {
        this.terminal.textarea.removeEventListener('paste', this._handlePaste, true);
      }
      this.terminal.dispose();
      // 置 null 让晚到的异步回调（如 document.fonts.ready 重 fit）的 !this.terminal
      // 守卫真正生效，与 ScratchTerminal 行为对齐
      this.terminal = null;
    }
    // fitAddon 随 terminal.dispose 失效，置 null 让晚到回调的 !this.fitAddon 守卫生效
    this.fitAddon = null;
  }

  initTerminal() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    this.terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorInactiveStyle: 'none',
      fontSize: (isMobile && !isPad) ? 11 : 13,
      fontFamily: terminalFontFamily,
      theme: isDark ? darkTerminalTheme : lightTerminalTheme,
      allowProposedApi: true,
      // Windows：超出 cell 宽度的字形（CJK 落回退字体时常见）按 cell 缩放，配合
      // terminalFontFamily 治 IME 中文输入整体偏移；仅 win 开启，mac 渲染零变化。
      // 注：DOM 渲染器下该选项无效（WebGL/Canvas 有效），字体栈修复不受影响。
      rescaleOverlappingGlyphs: isWindows,
      scrollback: isPad ? 2000 : isIOS ? 200 : isMobile ? 1000 : 2000,
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

    // 渲染器选择：Android + macOS 桌面(Chromium 系)启用 WebGL,详见 WEBGL_RENDERER 常量；
    // Windows/Linux/iOS/Safari 走 xterm.js 6.0 内置 DOM 渲染器——Windows 上实测 DOM 比
    // WebGL 更稳定（无纹理脏花屏 / context loss / GPU 长任务降级等问题）。
    if (WEBGL_RENDERER) {
      this._loadWebglAddon(false);
    } else {
      // WebGL 时代 longtask 降级留下的 sticky key 在 DOM 平台已是死状态,一次性清理
      try { localStorage.removeItem(WEBGL_STICKY_KEY); } catch {}
    }

    // 写入节流：批量合并高频输出，避免逐条触发渲染。
    // 用 TerminalWriteQueue 替代原「string += / slice」实现，消除大流量时
    // O(n²) 字符串切片热点（trace3 显示 _flushWrite 794ms self），同时
    // 修复 UTF-16 surrogate 边界切碎、unmount 16ms 数据丢失等隐患。
    // 节奏与原实现等价：每帧 1 个 chunk，不做激进 multi-chunk drain。
    // 移动端内存预算低,积压自保水位减半(默认桌面 2MB/512KB)。
    // chunk 初值：Windows DOM 渲染器解析慢，16KB 保守起步（其余平台 32KB），
    // 运行期由 write callback 计时 AIMD 自适应收敛（详见 terminalWriteQueue 头注释）。
    this._writeQ = new TerminalWriteQueue(
      () => this.terminal,
      {
        ...((isMobile && !isPad) ? { highWaterBytes: 1024 * 1024, trimTargetBytes: 256 * 1024 } : null),
        ...(isWindows ? { initialChunkBytes: 16 * 1024 } : null),
        // 积压丢弃后向服务端请求权威快照对齐（整项丢弃的中段对增量输出流不会自愈）
        onTrim: () => this._requestResync(),
      }
    );

    if (isMobile && !isPad) {
      // 移动端：基于屏幕尺寸一次性计算固定 cols/rows，避免动态 fit 导致渲染抖动
      this._initRafId = requestAnimationFrame(() => {
        this._initRafId = 0;
        if (!this.terminal) return; // mount 后一帧内 unmount 的竞态守卫
        this._mobileFixedResize();
      });
    } else {
      this._initRafId = requestAnimationFrame(() => {
        this._initRafId = 0;
        if (!this.terminal || !this.fitAddon) return; // unmount 竞态：fit/focus 作用于尸体会抛
        this.fitAddon.fit();
        this.terminal.focus();
      });
      // 字体异步就绪后重 fit + 重绘：初始 fit 可能基于回退字体的 cell 测量，
      // 字体加载完成后宽度变化会造成错位（Windows CJK 场景尤甚）。
      if (typeof document !== 'undefined' && document.fonts?.ready?.then) {
        document.fonts.ready.then(() => {
          if (!this.terminal) return;
          this._fitPreservingScroll();
          try { this.terminal.refresh(0, this.terminal.rows - 1); } catch { /* noop */ }
        });
      }
    }

    // Shift+Enter: 发 ESC+CR（Alt+Enter 的 escape 码），和 Claude Code `/terminal-setup`
    // 写进 VS Code/Cursor keybindings 的 `\x1b\r` 等价。Claude Code CLI 识别这个序列为
    // "插入换行而非提交"。之前用 bracketed-paste-LF 对老版可能有效，2.x 版已不兼容。
    this.terminal.attachCustomKeyEventHandler((e) => {
      // Win/Linux 智能复制粘贴（见 utils/terminalClipboard.js 注释）：xterm 6 把 Ctrl+C/Ctrl+V
      // 当控制字符并 preventDefault，压掉原生 paste。这里在最先执行的 customKeyEventHandler 接管。
      const clipAction = clipboardKeyAction(e, { isMac });
      if (clipAction === 'paste') {
        // 主动读剪贴板（不依赖被 xterm 压掉的原生 paste 默认动作 → 同样修复 Electron 端），
        // 终端走 _pasteText 安全路径（bracketed-paste 包裹 + 注入消毒，保留图片粘贴）。
        if (navigator.clipboard && (navigator.clipboard.read || navigator.clipboard.readText)) {
          e.preventDefault();
          e.stopPropagation();
          // 双重粘贴防护：主动读剪贴板期间，若个别浏览器仍触发原生 paste（preventDefault 抑制
          // paste 是约定行为、非规范硬保证），让 _handlePaste 早退，避免叠加。下个事件循环清闸。
          this._activePasteInFlight = true;
          setTimeout(() => { this._activePasteInFlight = false; }, 0);
          this._activePaste();
          return false;
        }
        // 非安全上下文（如 LAN HTTP）无 clipboard API：不 preventDefault，放行原生 paste → _handlePaste
        return false;
      }
      if (clipAction === 'copy') {
        const sel = this.terminal?.getSelection?.();
        if (sel) {
          // 有选区：复制（对齐 VS Code / Windows Terminal）。仅复制成功才清选区——失败（非安全
          // 上下文且 execCommand 也失败）时保留选区，用户可改用 Ctrl+Insert 重试，不致"选区被吞"。
          e.preventDefault();
          e.stopPropagation();
          copyTextToClipboard(sel).then((ok) => { if (ok) this.terminal?.clearSelection?.(); });
          return false;
        }
        return true; // 无选区：交回 xterm 发 \x03（SIGINT），保留中断能力
      }
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) {
        // 必须显式 preventDefault：xterm customKeyEventHandler 返回 false 只阻 xterm 内部处理，
        // 不阻浏览器 textarea 默认行为（Enter 会往隐藏 textarea 塞 \n 再被 xterm onData 转发到 PTY）。
        // 不 preventDefault 会让 PTY 同时收到 \x1b\r（我们显式发的）和 \n（textarea 漏进来的），
        // 后者被 Claude Code 当作 Enter 提交，于是"看起来换行没生效"。
        e.preventDefault();
        e.stopPropagation();
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data: '\x1b\r' }));
        }
        return false;
      }
      // Enter: 如果有 pending 文件，先注入路径到终端输入行（不带回车），
      // 用户可以看到路径后再按 Enter 确认发送
      // 跳过 alternate screen（vim/less 等交互程序），避免误注入
      if (e.type === 'keydown' && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const pending = this.props.pendingImages;
        const inAlternateScreen = this.terminal?.buffer?.active?.type === 'alternate';
        if (pending?.length > 0 && !inAlternateScreen && this.ws?.readyState === WebSocket.OPEN) {
          // 必须 preventDefault（同上 Shift+Enter 分支）：仅 return false 不阻浏览器默认，
          // Enter 的 keypress 仍被 xterm 转发 \r 到 PTY → 路径注入后立即提交，违背
          // "用户看到路径再按 Enter 确认" 的设计。
          e.preventDefault();
          e.stopPropagation();
          const paths = pending.map(img => `'${img.path.replace(/'/g, "'\\''")}'`).join(' ');
          this.ws.send(JSON.stringify({ type: 'input', data: paths + ' ' }));
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

  // 通过 TerminalWsContext 共享 ws — 不再自建。本方法接收 Provider 派发的所有消息,
  // 自己 switch type;ChatView/TerminalPanel 各自只处理关心的类型,互不干扰。
  // (原 hook/sdk-* 类消息在合并 ws 后也会进来,但这里不识别 → try/catch 之外也无作用,自然忽略。)
  _onTerminalWsMessage = (msg) => {
    try {
      if (msg.type === 'data') {
        this._throttledWrite(msg.data);
      } else if (msg.type === 'data-resync') {
        // 服务端反压恢复:丢弃本地积压、重置 xterm、写快照一步对齐到服务端当前末态
        // (与 ws close→重连全量 replay 的既有恢复惯例同款;TUI 重绘由服务端 SIGWINCH/resize 抖动驱动)。
        // 有意取舍:全量重置会连洪泛前的 scrollback 一起清掉——保留 scrollback 改写
        // 分隔条+追加快照的方案会让快照开头与已渲染内容重叠重复,且洪泛流的半截转义残留可能
        // 卡坏 ANSI 状态机;reset 换取干净对齐,黄字提示已向用户明示发生过跳过。
        // 重置必须走带内 INBAND_RESET 而非带外 terminal.reset()——后者不清 xterm 内部
        // WriteBuffer,残留字节在 reset 后以 ground state 续解析,半截序列按字面渲染成
        // `0;134m` 类残片且永久留在新 scrollback(见 terminalWriteQueue.INBAND_RESET doc)。
        diagCount('resyncCount');
        this._writeQ.reset();
        this._writeQ.push(INBAND_RESET + '\x1b[33m[cc-viewer] output skipped during congestion\x1b[0m\r\n');
        if (msg.data) this._writeQ.push(msg.data);
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

  // ws 状态变更:open 时 sendResize(原 onopen 行为);close 时 reset xterm(避免残留半截 ANSI)。
  // 重连本身由 Provider 内部 2s 退避完成,组件无感。
  _onTerminalWsState = (state) => {
    if (state === 'open') {
      this.sendResize();
    } else if (state === 'close') {
      // writeQ 与 terminal 都要 reset（同 data-resync 分支）：close 时队列若有积压，
      // 重连 replay 会把这些字节再发一遍 → 局部重复。只 reset xterm 漏了写队列。
      // 重置走带内序列防 WriteBuffer 残留撕裂（同 data-resync 分支注释）。
      this._writeQ?.reset();
      this._writeQ?.push(INBAND_RESET);
    }
  };

  // write-queue 积压丢弃后请求服务端快照对齐（服务端回 data-resync，见上方分支）。
  // 持续过载期 _maybeTrim 每次 push 都可能触发——2s 节流防请求风暴（服务端另有冷却兜底）。
  _requestResync() {
    const nowTs = Date.now();
    if (nowTs - (this._lastResyncReqAt || 0) < 2000) return;
    this._lastResyncReqAt = nowTs;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'resync-request' })); } catch {}
    }
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

  // 强制重绘终端,走 xterm 官方 escape hatch,**不**通过改 DOM 高度骗 fit() 重建渲染层
  // (旧 hack 会让 viewport scrollTop 在 shrink/restore 之间错位 ≈shrink 像素)。
  // 三档分别对应不同严重度的 xterm 渲染 issue:
  //   L1: clearTextureAtlas + refresh —— 纹理脏 / sleep-wake 后小花屏(DOM 下 atlas 为 no-op,refresh 仍是全行重绘)
  //   L2: L1 + fitAddon.fit() —— 维度漂移叠加纹理脏
  //   L3: dispose+reload WebglAddon (onContextLoss 同款配方) + fit + 纹理重画 —— 整片白屏 / WebGL 失同步
  //       注:仅 WebGL 平台(Android / macOS Chromium)有 WebGL,_rebuildWebglAddon 在 DOM 平台早退,
  //       故 DOM 下 L3 实效 = L2。
  // 两条调用路径:handleForceRefresh(用户点击,连击窗口推进级别),自动定时器
  // (Android 60s 走 L2 预防性维护;mac/PC/iPad 120s 仅轻量 atlas 清理+全行重绘,不经此函数)。
  _executeRefresh = (level) => {
    const term = this.terminal;
    if (!term) return;

    const fullRedraw = () => {
      try { term.clearTextureAtlas?.(); } catch {}
      try { term.refresh(0, term.rows - 1); } catch {}
    };
    // 仅动态 fit 路径才允许 fit();移动端非 iPad 由 _mobileFixedResize 维护固定 60 列,
    // 调 fit() 会把固定列覆盖成按容器算的动态列,破坏移动端契约。
    const canFit = !isMobile || isPad;

    if (level === 1) {
      fullRedraw();
    } else if (level === 2) {
      fullRedraw();
      if (canFit) this._fitPreservingScroll();
    } else {
      this._rebuildWebglAddon();
      if (canFit) this._fitPreservingScroll();
      fullRedraw();
    }
    if (canFit) this.sendResize();
  };

  // 用户点击入口:抖动级别按连击窗口推进(3s 内 L1→L2→L3,超时回 L1)。
  // 越高级动作越重,默认从轻到重渐次试,只有用户不满意再点才会升级。
  handleForceRefresh = () => {
    const now = Date.now();
    const within = (now - (this._lastRefreshAt || 0)) < 3000;
    this._refreshLevel = within ? Math.min(3, (this._refreshLevel || 1) + 1) : 1;
    this._lastRefreshAt = now;
    this._executeRefresh(this._refreshLevel);
  };

  // 调 fitAddon.fit() 并尽量保持用户的 scrollTop —— fit() 会重排 viewport,scrollHeight 变后
  // scrollTop 默认会被重置。贴底时直接贴底,其他情况按 prev/new scrollHeight 比例换算。
  // ResizeObserver 路径和 60s 自动刷新 / 手动 L2/L3 都走它,行为统一。
  _fitPreservingScroll = () => {
    if (!this.fitAddon || !this.containerRef.current) return;
    // 0/极小尺寸守卫（同 ScratchTerminal）：容器可见但高度≈0 时 FitAddon 会算出 2×1
    // (MINIMUM_COLS=2/ROWS=1) 并经 sendResize 发给 PTY → ConPTY 全屏 reflow 崩坏 +
    // 恢复时二次重绘。尺寸无效时跳过 fit，等容器恢复后 ResizeObserver 再触发。
    const el = this.containerRef.current;
    if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
    try {
      const vp = this.containerRef.current.querySelector('.xterm-viewport');
      const prevScrollTop = vp?.scrollTop ?? 0;
      const prevScrollHeight = vp?.scrollHeight ?? 1;
      const wasAtBottom = vp ? (prevScrollTop + vp.clientHeight >= prevScrollHeight - 5) : true;
      this.fitAddon.fit();
      if (vp) {
        if (wasAtBottom) {
          vp.scrollTop = vp.scrollHeight;
        } else {
          const ratio = prevScrollHeight > 0 ? prevScrollTop / prevScrollHeight : 0;
          vp.scrollTop = ratio * vp.scrollHeight;
        }
      }
    } catch {}
  };

  setupResizeObserver() {
    // 移动端使用固定尺寸，不需要 ResizeObserver（iPad 例外，走动态 fit）
    if (isMobile && !isPad) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeDebounceTimer) clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = setTimeout(() => {
        this._resizeDebounceTimer = null;
        this._fitPreservingScroll();
        this.sendResize();
      }, 150);
    });
    if (this.containerRef.current) {
      this.resizeObserver.observe(this.containerRef.current);
    }
  }

  _loadWebglAddon(isRetry) {
    // Sticky disable 检查：7 天内曾因 GPU 长任务降级过，跳过 WebGL 加载
    try {
      const until = localStorage.getItem(WEBGL_STICKY_KEY);
      if (until && Date.now() < Number(until)) return;
    } catch {}

    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        this._disposeWebgl();
        if (!isRetry) {
          this._webglRecoveryTimer = setTimeout(() => {
            this._webglRecoveryTimer = null;
            this._loadWebglAddon(true);
          }, 1000);
        }
      });
      this.terminal.loadAddon(this.webglAddon);
      this._installWebglLongtaskGuard();
    } catch {
      // 若 loadAddon(activate) 中途抛出，addon 可能已创建 GL context/canvas/onContextLoss
      // disposable——只置 null 会泄漏，先显式 dispose 再置 null。
      try { this.webglAddon?.dispose(); } catch {}
      this.webglAddon = null;
    }
  }

  _disposeWebgl() {
    // 清掉 pending 的 onContextLoss 恢复重试:longtask 降级(写 sticky)与 1s 恢复 timer
    // 交错时,不再依赖 sticky 检查巧合拦截重载已判废的 addon(mac 上 context loss 更频繁)。
    if (this._webglRecoveryTimer) {
      clearTimeout(this._webglRecoveryTimer);
      this._webglRecoveryTimer = null;
    }
    if (this._webglLongtaskObserver) {
      this._webglLongtaskObserver.disconnect();
      this._webglLongtaskObserver = null;
    }
    if (this.webglAddon) {
      try { this.webglAddon.dispose(); } catch {}
      this.webglAddon = null;
    }
  }

  // GPU 长任务监测：滑动窗口内累积 stall 达到阈值则自动降级到 DOM 渲染器
  _installWebglLongtaskGuard() {
    if (typeof PerformanceObserver === 'undefined') return;
    const startTime = performance.now();
    const recentStalls = [];

    this._webglLongtaskObserver = new PerformanceObserver((list) => {
      if (!this.webglAddon) return;
      const now = performance.now();
      if (now - startTime < WEBGL_GRACE_MS) return;
      for (const entry of list.getEntries()) {
        if (entry.duration >= WEBGL_STALL_MS) {
          recentStalls.push(now);
        }
      }
      while (recentStalls.length > 0 && now - recentStalls[0] > WEBGL_STALL_WINDOW_MS) {
        recentStalls.shift();
      }
      if (recentStalls.length >= WEBGL_STALL_COUNT) {
        console.warn('[cc-viewer] WebGL longtask guard: %d stalls in %ds, falling back to DOM renderer',
          recentStalls.length, WEBGL_STALL_WINDOW_MS / 1000);
        try { localStorage.setItem(WEBGL_STICKY_KEY, String(Date.now() + WEBGL_STICKY_TTL_MS)); } catch {}
        this._disposeWebgl();
        this.terminal?.refresh(0, this.terminal.rows - 1);
      }
    });
    try {
      this._webglLongtaskObserver.observe({ type: 'longtask', buffered: false });
    } catch {
      this._webglLongtaskObserver = null;
    }
  }

  // L3 兜底:dispose 当前 WebglAddon 再 load 一个新的(xterm 官方 README 同款 onContextLoss
  // 配方)。保留 cols/rows/scrollback,不动 DOM 高度,不影响其他 addon。
  _rebuildWebglAddon = () => {
    if (!this.terminal) return;
    if (!WEBGL_RENDERER) return; // 仅 WebGL 平台（Android / macOS Chromium），其余始终走 DOM 渲染器
    // 抢在 onContextLoss recovery 之前清 timer,否则 1s 后醒来会把刚 rebuild 的 addon 再 load 一次
    if (this._webglRecoveryTimer) {
      clearTimeout(this._webglRecoveryTimer);
      this._webglRecoveryTimer = null;
    }
    this._disposeWebgl();
    this._loadWebglAddon(false);
  };

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
      if (!this.terminal) return; // unmount 竞态：this.terminal._core 对 null 取属性会抛
      const newCellDims = this.terminal._core?._renderService?.dimensions?.css?.cell;
      const lineHeight = newCellDims?.height || cellDims.height;
      const rows = Math.max(5, Math.min(Math.floor(availableHeight / lineHeight), 100));

      this.terminal.resize(MOBILE_COLS, rows);
      this.sendResize();
    });
  }

  /**
   * 写入节流：委托给 TerminalWriteQueue（src/utils/terminalWriteQueue.js）。
   * 行为与原实现等价 —— 每帧最多 write 一个 32KB chunk，rAF 续约。
   * 收益：消除原 `_writeBuffer = _writeBuffer.slice(N)` 的 O(n²) 字符串切片
   *       + UTF-16 surrogate 守卫 + 异常时不死循环 + drain 修 unmount 数据丢失。
   */
  _throttledWrite(data) {
    this._writeQ.push(data);
  }

  // 同步排空（exit/state/toast 路径在自身 write 前调用，保留既有顺序语义）。
  // 注：与原实现一样，这里只 drain 已积累 buffer，不影响 xterm 内部 parser 异步队列。
  _flushWrite() {
    this._writeQ.drain();
  }

  _handlePaste = (e) => {
    // 主动粘贴进行中：阻止原生 paste 叠加（见 attachCustomKeyEventHandler 的 _activePasteInFlight 注释）
    if (this._activePasteInFlight) { e.preventDefault?.(); e.stopPropagation?.(); return; }
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

    const rawText = e.clipboardData?.getData('text');
    if (!rawText || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // paste-injection 防护 + bracketed-paste 包裹决策抽到 planPasteSend（见 utils/terminalClipboard.js）：
    // 剪贴板内嵌的 \x1b[201~ 会提前闭合包裹、余下字节作真实按键注入；xterm 6.0 自动包裹不 sanitize
    // （上游 7.0 才修），故含该序列 / 多行时我们接管（preventDefault + 自行 sanitize 包裹），
    // 否则返回 null 交回 xterm / 浏览器原生处理。
    const data = planPasteSend(rawText, {
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

  // 主动粘贴的安全送出：复用 planPasteSend（active=true）。区别于 _handlePaste：这里没有原生
  // paste 事件让 xterm 自动包裹，故 bracketedPasteMode 时也自行包裹（planPasteSend 内已处理）。
  _pasteText = (rawText) => {
    if (!rawText || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const data = planPasteSend(rawText, {
      bracketedPasteMode: this.terminal?.modes?.bracketedPasteMode,
      active: true,
      sanitize: sanitizeBracketPasteText,
    });
    if (data != null) this.ws.send(JSON.stringify({ type: 'input', data }));
  };

  // Ctrl+V 主动读剪贴板：优先取图片（与 _handlePaste 一致地走上传），否则取文本走 _pasteText。
  // 取不到文本（如剪贴板仅 text/html）或 read() 不可用 / 失败时，显式回退到 readText。
  _activePaste = async () => {
    const clip = navigator.clipboard;
    if (clip?.read) {
      let items = null;
      try { items = await clip.read(); }
      catch (err) { console.warn('[CC Viewer] clipboard.read() 失败，回退 readText', err); }
      if (items) {
        for (const item of items) {
          const imgType = item.types?.find((ty) => ty.startsWith('image/'));
          if (imgType) {
            try {
              const blob = await item.getType(imgType);
              this._uploadClipboardImage(new File([blob], 'clipboard-image', { type: imgType }));
              return;
            } catch { /* 取图失败 → 落到文本 */ }
          }
        }
        // 无图片：从 ClipboardItem 取 text/plain；取到则发送返回，取不到（仅 html 等）显式落到 readText
        const withText = items.find((it) => it.types?.includes('text/plain'));
        if (withText) {
          try {
            const text = await (await withText.getType('text/plain')).text();
            if (text) this._pasteText(text);
            return;
          } catch { /* 取文本失败 → 落到 readText */ }
        }
      }
    }
    if (clip?.readText) {
      try {
        const text = await clip.readText();
        if (text) this._pasteText(text);
      } catch (err) {
        console.warn('[CC Viewer] active paste failed; fall back to Ctrl+Shift+V', err);
      }
    }
  };

  _uploadClipboardImage = async (file) => {
    try {
      const optimized = await downscaleForRetina(file);
      const path = await uploadFileAndGetPath(optimized);
      if (this.props.onFilePath) this.props.onFilePath(path);
      // Notify other views/devices about the uploaded image
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'image-upload-notify', path, source: 'terminal' }));
      }
      if (this.terminal) this.terminal.focus();
    } catch (err) {
      console.error('[CC Viewer] Clipboard image upload failed:', err);
      message.error(t('ui.terminal.pasteImageFailed'));
    }
  };


  handleVirtualKey = (seq) => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', data: seq }));
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'image-upload-notify', path, source: 'terminal' }));
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
    if (this.props.onUpdatePreferences) {
      this.props.onUpdatePreferences(buildPresetShortcutsPayload(items, dismissed));
    }
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

  // 级联子菜单 hover-intent 共享实现见 utils/quickMenuHoverIntent。
  // iPad 无 hover 不参与（tap 的 synthetic mouseEnter 会与 click 切换互抵），由点击行切换兜底。
  _qmHover = createQuickMenuHoverIntent({
    getExpanded: () => this.state.quickSettingsExpanded,
    setExpanded: (k) => this.setState({ quickSettingsExpanded: k }),
    skip: () => isPad,
  });

  handlePresetSend = (description) => {
    if (!description) return;
    this.setState({ quickSettingsOpen: false, quickSettingsExpanded: null });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks(description),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      }));
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  handleClearContext = () => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks('/clear'),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      }));
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks(assembled),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      }));
    }
    if ((!isMobile || isPad) && this.terminal) this.terminal.focus();
  };

  openCustomUltraplanEditor = (item) => {
    // UltraPlan 是 Antd Popover(自带"点击外部即关闭"),编辑器是 Antd Modal(portal 挂 body)。
    // 打开编辑器时不主动收 Popover——保留 UltraPlan 在背景里(编辑器自带蒙层会压暗);
    // 编辑器 mask 引起的"外部点击"由下面 Popover 的 onOpenChange 守卫拦下(customUltraplanEditOpen)。
    this.setState({
      customUltraplanEditOpen: true,
      customUltraplanEditing: item || null,
    });
  };

  closeCustomUltraplanEditor = () => {
    this.setState({
      customUltraplanEditOpen: false,
      customUltraplanEditing: null,
    });
  };

  // UltraPlan 文件 / 专家逻辑委托给共享控制器（见 ../utils/ultraplanController）。方法名保持不变，render 零改动。
  saveCustomUltraplanExpert = (...a) => this._ultraplan.saveExpert(...a);

  deleteCustomUltraplanExpert = (...a) => this._ultraplan.deleteExpert(...a);

  // tab 条上每个专家的图标：内置 code=<> / research=放大镜，自定义=星形。
  handleUltraplanUpload = (...a) => this._ultraplan.handleUpload(...a);

  handleUltraplanPaste = (...a) => this._ultraplan.handlePaste(...a);

  handleUltraplanRemoveFile = (...a) => this._ultraplan.handleRemoveFile(...a);

  render() {
    const { pendingImages, onRemovePendingImage } = this.props;
    return (
      <div className={styles.terminalPanel}>
        {/* === 主 terminal (Claude Code TUI 渲染区) ===
            外层 .terminalContainer：padding + focus 边线；内层 .terminalHost：xterm 实际父容器，
            margin-bottom 4px 让 fitAddon 拿到的高度始终 -4px，xterm-screen 接触不到下方 toolbar */}
        <div
          className={`${styles.terminalContainer}${this.state.terminalFocused ? ` ${styles.terminalContainerFocused}` : ''}`}
        >
          <div ref={this.containerRef} className={styles.terminalHost} />
          {(!isMobile || isPad) && (
            <button
              type="button"
              className={styles.terminalRefreshBtn}
              title={t('ui.terminal.refreshTip')}
              aria-label={t('ui.terminal.refresh')}
              onClick={this.handleForceRefresh}
            >
              <RefreshIcon />
              <span>{t('ui.terminal.refresh')}</span>
            </button>
          )}
        </div>
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
            <div className={styles.toolbarLeft}>
            <Popover
              trigger="click"
              placement="top"
              open={this.state.quickSettingsOpen}
              onOpenChange={(v) => {
                if (!v) this._qmHover.cancel();
                this.setState(v ? { quickSettingsOpen: true } : { quickSettingsOpen: false, quickSettingsExpanded: null });
              }}
              overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: 4, minWidth: 200 }}
              content={
                <div className={styles.presetMenu}>
                  <QuickAutoApproveRows
                    autoApproveSeconds={this.props.autoApproveSeconds}
                    planAutoApproveSeconds={this.props.planAutoApproveSeconds}
                    onAutoApproveChange={this.props.onAutoApproveChange}
                    onPlanAutoApproveChange={this.props.onPlanAutoApproveChange}
                    expandedKey={this.state.quickSettingsExpanded}
                    onToggle={(k) => this.setState({ quickSettingsExpanded: k })}
                    onHoverEnter={this._qmHover.enter}
                    onHoverLeave={this._qmHover.leave}
                  />
                  {/* AgentTeam 快捷指令（自工具栏独立按钮迁入，置于菜单底部）：AgentTeam 启动时
                      默认开启，展示自定义快捷方式 + 预设列表；仅当用户显式关闭
                      （export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0）时整组隐藏 */}
                  {this.state.agentTeamEnabled && (
                    <div
                      className={`${chrome.quickMenuGroup} ${this.state.quickSettingsExpanded === 'agentteam' ? chrome.quickMenuGroupOpen : ''}`}
                      onMouseEnter={() => this._qmHover.enter('agentteam')}
                      onMouseLeave={() => this._qmHover.leave('agentteam')}
                    >
                      <button
                        className={chrome.quickMenuRow}
                        onClick={() => this.setState(s => ({ quickSettingsExpanded: s.quickSettingsExpanded === 'agentteam' ? null : 'agentteam' }))}
                      >
                        <span className={chrome.quickMenuRowIcon}><AgentTeamIcon /></span>
                        <span className={chrome.quickMenuLabel}>{t('ui.terminal.agentTeam')}</span>
                        <span className={chrome.quickMenuCaret}>▸</span>
                      </button>
                      <div className={chrome.quickMenuSubWrap}>
                        <div className={chrome.quickMenuSub}>
                          <button className={`${styles.presetMenuItem} ${styles.presetMenuItemMuted}`} onClick={() => this.setState({ quickSettingsOpen: false, quickSettingsExpanded: null, presetModalVisible: true })}>
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
                      </div>
                    </div>
                  )}
                </div>
              }
            >
              <button
                className={`${styles.toolbarBtn} ${styles.quickSettingsBtn} ${this.state.quickSettingsOpen ? styles.quickSettingsBtnOpen : ''}`}
                title={t('ui.terminal.quickSettings')}
              >
                <span className={styles.quickSettingsIcon}><span className={styles.quickSettingsGlyph} style={SPARKLE_MASK_STYLE} aria-hidden="true" /></span>
              </button>
            </Popover>
            {this.state.agentTeamEnabled ? (
              <Popover
                trigger="click"
                placement="top"
                open={this.state.ultraplanOpen}
                onOpenChange={(v) => {
                  // customUltraplanEditOpen 守卫:编辑器(Antd Modal)通过 portal 挂 body,它的 mask 对本
                  // Popover 而言是"外部点击"。事件顺序保护住了我们:
                  //   rc-trigger 注册 capture-phase mousedown(useWinClick.js)→ 早于 rc-dialog 的 bubble
                  //   click → onOpenChange 触发时 mask click 还没冒泡到 editor.onCancel,
                  //   customUltraplanEditOpen 仍为 true,直接拦掉本次 Popover 关闭。
                  // (这个机制与 React 是否批量化 setState 无关,对 React 19 / concurrent 仍稳。)
                  // ultraplanManagerOpen(管理专家弹窗)同理:它也是 portal Modal,关闭它不应连带收起本 Popover。
                  if (!v && (this.state.lightbox || this.state.ultraplanLightbox || this.state.ultraplanConfirming || this.state.customUltraplanEditOpen || this.state.ultraplanManagerOpen)) return;
                  if (!v) this.setState({ ultraplanOpen: false });
                }}
                overlayClassName="ccv-ultraplan-popover"
                overlayInnerStyle={ultraplanOverlayInnerStyle(this.state.ultraplanPopoverSize)}
                content={
                  <UltraplanPanel
                    variant={this.state.ultraplanVariant}
                    prompt={this.state.ultraplanPrompt}
                    files={this.state.ultraplanFiles}
                    customExperts={this.state.customUltraplanExperts}
                    expertOrder={this.state.ultraplanExpertOrder}
                    expertHidden={this.state.ultraplanExpertHidden}
                    onVariantChange={(v) => this.setState({ ultraplanVariant: v })}
                    onPromptChange={(p) => this.setState({ ultraplanPrompt: p })}
                    onSend={this.handleUltraplanSend}
                    onUpload={this.handleUltraplanUpload}
                    onPaste={this.handleUltraplanPaste}
                    onRemoveFile={this.handleUltraplanRemoveFile}
                    onClose={() => this.setState({ ultraplanOpen: false })}
                    onOpenManager={() => this.setState({ ultraplanManagerOpen: true })}
                    onOpenCustomEditor={this.openCustomUltraplanEditor}
                    onPreviewImage={(lb) => this.setState({ ultraplanLightbox: lb })}
                    onConfirmingChange={(open) => this.setState({ ultraplanConfirming: open })}
                    onSizeChange={(size) => this.setState({ ultraplanPopoverSize: size })}
                  />
                }
              >
                <button className={`${styles.toolbarBtn} ${this.state.ultraplanOpen ? styles.ultraToggleActive : ''}`} onClick={() => this.setState({ ultraplanOpen: true })} title={t('ui.ultraplan')}>
                  <span className={styles.ultraToggleIcon} style={ULTRAPLAN_MASK_STYLE} aria-hidden="true" />
                  <span className={styles.ultraToggleLabel}>UltraPlan</span>
                </button>
              </Popover>
            ) : null}
            <button className={styles.toolbarBtn} onClick={() => this.fileInputRef.current?.click()} title={t('ui.terminal.upload')}>
              <UploadIcon />
            </button>
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
                  </button>
                </Popconfirm>
              );
            })()}
            </div>
            {/* 中段：血条 portal slot；左/右两端控件分别由 toolbarLeft / toolbarRight 包裹，
                slot 在中间用 flex-basis 200 + flex-shrink 1 自适应左右控件之间的空间，封顶 200px */}
            <div className={styles.ctxBarSlot} ref={this.props.setContextBarSlot} />
            <div className={styles.toolbarRight}>
            <button
              className={`${styles.toolbarBtn}${this.state.scratchOpen ? ` ${styles.toolbarBtnActive}` : ''}`}
              onClick={this.toggleScratch}
              aria-pressed={this.state.scratchOpen}
              aria-label={this.state.scratchOpen ? t('ui.terminal.scratchTerminalClose') : t('ui.terminal.scratchTerminalOpen')}
              title={this.state.scratchOpen ? t('ui.terminal.scratchTerminalClose') : t('ui.terminal.scratchTerminalOpen')}
            >
              <ScratchTerminalIcon />
            </button>
            </div>
          </div>
        )}
        {(!isMobile || isPad) && this.state.scratchOpen && (
          <>
            <div
              className={`${styles.scratchResizer}${this.state.isDraggingScratch ? ` ${styles.scratchResizerDragging}` : ''}`}
              onPointerDown={this.handleScratchResizerPointerDown}
              onPointerMove={this.handleScratchResizerPointerMove}
              onPointerUp={this.handleScratchResizerPointerUp}
              onPointerCancel={this.handleScratchResizerPointerUp}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('ui.terminal.scratchResizer')}
            />
            <div
              ref={this._scratchWrapRef}
              className={styles.scratchWrap}
            >
              <div className={styles.scratchTabs} role="tablist" aria-orientation="vertical">
                {this.state.scratchTabs.map((tab, idx) => {
                  const isActive = tab.id === this.state.activeScratchTabId;
                  const isLast = this.state.scratchTabs.length === 1;
                  // 同名 shell 重复时追加序号区分
                  // 占位 'zsh'：老版本 server 不发 shellBasename 时也展示符合 macOS 默认 shell 的名字；
                  // 新 server 的 WS state 消息携带真实 basename 后会覆盖（bash/fish 用户也对）
                  const baseLabel = this.state.scratchShellBasename || 'zsh';
                  const label = baseLabel + (this.state.scratchTabs.length > 1 ? ` ${idx + 1}` : '');
                  return (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      className={`${styles.scratchTab}${isActive ? ` ${styles.scratchTabActive}` : ''}`}
                      onClick={() => this.handleScratchTabClick(tab.id)}
                      title={label}
                    >
                      <span className={styles.scratchTabIcon}><ScratchTerminalIcon /></span>
                      <span className={styles.scratchTabLabel}>{label}</span>
                      {!isLast && (
                        <button
                          className={styles.scratchTabClose}
                          onClick={(e) => this.handleScratchTabClose(tab.id, e)}
                          title={t('ui.terminal.scratchTabClose')}
                          aria-label={t('ui.terminal.scratchTabClose')}
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  className={styles.scratchTabAdd}
                  onClick={this.handleScratchTabAdd}
                  disabled={this.state.scratchTabs.length >= SCRATCH_TAB_MAX}
                  title={t('ui.terminal.scratchTabAdd')}
                  aria-label={t('ui.terminal.scratchTabAdd')}
                >
                  <PlusIcon />
                </button>
              </div>
              <div className={`${styles.scratchPanes}${this.state.scratchFocused ? ` ${styles.scratchPanesFocused}` : ''}`}>
                {this.state.scratchTabs.map((tab) => {
                  const isActive = tab.id === this.state.activeScratchTabId;
                  return (
                    <div
                      key={tab.id}
                      className={`${styles.scratchPane}${isActive ? ` ${styles.scratchPaneActive}` : ''}`}
                      role="tabpanel"
                    >
                      <ScratchTerminal
                        ref={this._getScratchRef(tab.id)}
                        id={tab.id}
                        onFocusChange={(f) => this.handleScratchTabFocusChange(tab.id, f)}
                        onShellInfo={this.handleScratchShellInfo}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
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
            ) : null}
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
              rows={15}
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
        <UltraplanExpertManagerModal
          open={this.state.ultraplanManagerOpen}
          customExperts={this.state.customUltraplanExperts}
          order={this.state.ultraplanExpertOrder}
          hidden={this.state.ultraplanExpertHidden}
          onPersist={({ order, hidden }) => this._ultraplan.persistExpertLayout({ order, hidden })}
          onClose={() => this.setState({ ultraplanManagerOpen: false })}
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
