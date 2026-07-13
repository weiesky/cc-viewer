import React from 'react';
import { createPortal } from 'react-dom';
import { Space, Tag, Button, Dropdown, Popover, Modal, Collapse, Drawer, Switch, Radio, Tabs, Spin, Input, Select, Segmented, Tooltip, message } from 'antd';
import { DISPLAY_SCALE_PRESETS } from '../../utils/displayScaleHelper';
import { hasNativeZoom, isMac } from '../../env';
import { MessageOutlined, FileTextOutlined, ImportOutlined, DashboardOutlined, ExportOutlined, DownloadOutlined, SettingOutlined, BarChartOutlined, CodeOutlined, CopyOutlined, ApiOutlined, SwapOutlined, EditOutlined, ThunderboltOutlined, QuestionCircleOutlined, PushpinOutlined, PushpinFilled } from '@ant-design/icons';
import { QRCodeCanvas } from 'qrcode.react';
import { formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats, readCalibrationModel, computeContextPercent, sumUsageInputTokens, sumUsageContextTokens } from '../../utils/helpers';
import { contextSeverityColor } from '../../utils/formatters';
import { PERM_AUTO_APPROVE_OPTIONS, PLAN_AUTO_APPROVE_OPTIONS, autoApproveSelectOptions } from '../../utils/autoApproveOptions';
import { classifyUserContent, isMainAgent, extractDisplayText } from '../../utils/contentFilter';
import { parseImOrigin } from '../../utils/imOrigin';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import { sortSkillsDefault } from '../../utils/skillsParser';
import { handleSkillToggle, handleSkillDelete } from '../../utils/skillModalController';
import { PINNED_KEY, parsePinned, serializePinned, togglePinned } from '../../utils/pinnedMenu';
import { classifyRequest } from '../../utils/requestType';
import { resolveTeammateNames } from '../../utils/contentFilter';
import { t, getLang, setLang, LANG_OPTIONS } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import * as SeqLoaders from '../../utils/seqResourceLoaders';
import { SettingsContext } from '../../contexts/SettingsContext';
import ConceptHelp from '../common/ConceptHelp';
import ToolsHelp from '../common/ToolsHelp';
import OpenFolderIcon from '../common/OpenFolderIcon';
import CachePopoverContent from './CachePopoverContent';
import LiveTagPopover from './LiveTagPopover';
import MemoryDetailModal from '../common/MemoryDetailModal';
import SkillsManagerModal from '../settings/SkillsManagerModal';
import ProjectPrefsManagerModal from '../settings/ProjectPrefsManagerModal';
import PluginModal from '../settings/PluginModal';
import ProcessModal from '../settings/ProcessModal';
import ProxyModal, { profileDisplayModel } from '../settings/ProxyModal';
import RetryConfigModal from '../settings/RetryConfigModal';
import SystemTextModal from '../settings/SystemTextModal';
import VoicePackSettings from '../settings/VoicePackSettings';
import ProjectAliasEditor from '../settings/ProjectAliasEditor';
import MessagingModal from '../settings/MessagingModal';
import ImConversationModal from '../settings/ImConversationModal';
import ImStatusChip from '../settings/ImStatusChip';
import { IM_PLATFORMS } from '../settings/imPlatforms';
import { useProjectAlias } from '../../hooks/useProjectAlias';
import appConfig from '../../config.json';
import { OPTIMISTIC_CLEAR_PERCENT } from '../../AppBase';
const CALIBRATION_MODELS = appConfig.calibrationModels;
// Legacy-value migration + validation now live in utils/helpers.readCalibrationModel,
// shared with Mobile so both shells apply identical migration semantics.
import styles from './AppHeader.module.css';
import sharedChrome from '../common/sharedChrome.module.css';


// 认证 state 的单一形状工厂 —— 初始态 / 401 降级 / 服务端回包归一化三处共用，避免字段漂移。
// 服务端权威生产者是 server/routes/auth.js 的 buildState(同样字段集)。
function makeAuthState(over = {}) {
  return {
    enabled: false,
    isAdmin: false,
    password: null,
    scope: 'global',
    hasProjectOverride: false,
    projectDir: null,
    global: { enabled: false, password: null },
    ...over,
  };
}

// countryToFlag 已随地理位置控件一起迁到 src/components/common/CountryFlag.jsx

// Bridges the useProjectAlias hook into AppHeader (class component). Renders
// `${liveMonitoringPrefix}${projectName}${alias ? ` (${alias})` : ''}` followed
// by the inline pencil editor (hidden when isLocalLog / no projectName).
function HeaderProjectLabel({ projectName, isLocalLog, instanceId }) {
  const alias = useProjectAlias(projectName);
  return (
    <span className={styles.headerProjectName}>
      {t('ui.liveMonitoring')}{projectName ? `:${projectName}` : ''}
      {instanceId ? `(${instanceId})` : ''}
      {alias ? ` (${alias})` : ''}
      <ProjectAliasEditor projectName={projectName} isLocalLog={isLocalLog} />
    </span>
  );
}

class AppHeader extends React.Component {
  static contextType = SettingsContext;

  constructor(props) {
    super(props);
    this.state = { countdownText: '', promptModalVisible: false, promptData: [], promptViewMode: 'original', settingsDrawerVisible: false, globalSettingsVisible: false, projectStatsVisible: false, projectStats: null, projectStatsLoading: false, localUrl: '', pluginModalVisible: false, processModalVisible: false, logoDropdownOpen: false, electronMenuOpen: false, electronMenuBar: null, cacheHighlightIdx: null, cacheHighlightFading: false, calibrationModel: readCalibrationModel(CALIBRATION_MODELS), proxyModalVisible: false, systemTextModalVisible: false, messagingModalVisible: false, messagingInitialTool: null, imRecordVisible: false, imRecordPlatform: null, logDirDraft: null, qrPopoverOpen: false, electronQrOpen: false, electronQrAnchor: null, projectPrefsModalOpen: false, _skillsModal: { open: false, loading: false, skills: [], error: null, toggling: new Set() },
      // 文件系统权威的 skill 列表（/api/skills 返回）；live-tail 下作为 popover chip 和管理弹窗的共享数据源。
      // null=未加载 / false=失败 / [] 或 Array=加载结果。workspace 切换由 componentDidUpdate + seq 控制。
      _fsSkills: null,
      // 当前项目「持久记忆」入口 MEMORY.md：null=未加载 / false=失败 / { exists, dir, indexPath, content }。
      // 与 _fsSkills 同样依赖 projectName 切换作废 + seq 防回包污染。
      _memory: null,
      // 用户主动点击"刷新记忆"按钮的 spin 状态。与 _memory===null 区分：
      // null 是 lazy-load 空态（按钮 disabled），_memoryRefreshing 是用户触发的显式刷新。
      _memoryRefreshing: false,
      // 点击记忆链接时拉起的明细 Modal 状态：null=关 / { name, content?, error?, loading? }
      _memoryDetail: null,
      // 从血条 Popover「官方工具」标题打开的「所有工具」目录 Modal 是否开启（用于守卫 Popover 不收起）
      _toolsCatalogOpen: false,
      // CLAUDE.md 候选清单：null=未加载 / false=拉取失败 / [] 隐藏整段 / [{id,scope,tail,...}]
      _claudeMd: null,
      // CLAUDE.md 明细 Modal：与 _memoryDetail 分槽，避免 memory 链接点击与 CLAUDE 链接点击交叉污染
      _claudeMdDetail: null,
      // 密码登录认证态：/api/auth/state 返回 effective + scope 信息。
      // isAdmin 仅本机(127.0.0.1)为 true，决定二维码下方是否显示管理区。
      // scope='project'|'global'(当前生效来源)；hasProjectOverride=本项目是否有专用配置；
      // global={enabled,password}=全局默认；projectDir=本 server 项目(非 CLI 为 null)。
      // 远程登录窗口期 fetch 可能 401 → catch 降级为非 admin、视为已开启，不破坏 header。
      authState: makeAuthState(),
      // 密码输入框临时编辑态（受控），与权威值区分；null=未进入编辑
      _authPasswordDraft: null,
      _authSaving: false,
      // 管理区当前选中的作用域 tab；null=跟随生效 scope。切换 tab 时清空草稿。
      _authScope: null,
      // 汉堡菜单「钉住」的菜单 key 列表（全局持久，跨项目共享；存 localStorage ccv_pinnedMenuKeys）。
      // 顺序=用户钉住先后；驱动行内钉按钮实心态、汉堡右侧快捷方式行、Electron header model 的 pins。
      pinnedKeys: parsePinned(typeof localStorage !== 'undefined' ? localStorage.getItem(PINNED_KEY) : null),
    };
    this._countdownTimer = null;
    this._expiredTimer = null;
    this._fsSkillsSeq = 0;
    this._memorySeq = 0;
    this._memoryDetailSeq = 0;
    // 与 _memorySeq 同语义：list-load 与 detail-load 共享一个 seq counter，保证 workspace
    // 切换/快速重开 popover 时旧回包不会污染新状态（参考 _memorySeq 模式）
    this._claudeMdSeq = 0;
    this._claudeMdDetailSeq = 0;
    this.updateCountdown = this.updateCountdown.bind(this);
  }

  // ===== Electron 原生 tab bar header 桥接（把部分控件迁移到最顶部 tab bar）=====
  _isElectronTab() {
    return typeof window !== 'undefined' && !!(window.tabBridge && window.tabBridge.setHeaderModel);
  }

  // 汉堡菜单的「纯描述符」单一数据源：{ key, icon, label, onClick, dividerAfter? }，不含 divider 节点。
  // 四处复用：下拉 antd items 构建(getMenuItems)、汉堡右侧快捷方式行、Electron header model(pins)、
  // Electron 点击回传派发(_handleHeaderAction case 'menuShortcut')。
  // onClick 全部是 bound class-field arrow / inline arrow，可脱离菜单上下文 standalone 调用。
  _getMenuDescriptors() {
    const { viewMode, onImportLocalLogs, isLocalLog } = this.props;
    return [
      { key: 'import-local', icon: <ImportOutlined />, label: t('ui.importLocalLogs'), onClick: onImportLocalLogs },
      { key: 'export-prompts', icon: <ExportOutlined />, label: t('ui.exportPrompts'), onClick: this.handleShowPrompts },
      { key: 'plugin-management', icon: <ApiOutlined />, label: t('ui.pluginManagement'), onClick: this.handleShowPlugins },
      { key: 'process-management', icon: <DashboardOutlined />, label: t('ui.processManagement'), onClick: this.handleShowProcesses },
      // 日志模式下 IM 无法正常配置/使用，隐藏 IM 配置入口
      ...(isLocalLog ? [] : [{ key: 'messaging', icon: <MessageOutlined />, label: t('ui.messaging.menu'), onClick: () => this.setState({ messagingModalVisible: true, messagingInitialTool: null }) }]),
      { key: 'proxy-switch', icon: <SwapOutlined />, label: t('ui.proxySwitch'), onClick: () => this.setState({ proxyModalVisible: true }) },
      { key: 'retry-config', icon: <ThunderboltOutlined />, label: t('ui.retryConfig.title'), onClick: () => this.setState({ retryConfigModalVisible: true }) },
      { key: 'edit-system-prompt', icon: <EditOutlined />, label: t('ui.expert.systemText'), onClick: () => this.setState({ systemTextModalVisible: true }), dividerAfter: true },
      { key: 'project-stats', icon: <BarChartOutlined />, label: t('ui.projectStats'), onClick: this.handleShowProjectStats },
      ...(viewMode === 'raw' ? [{ key: 'global-settings', icon: <SettingOutlined />, label: t('ui.globalSettings'), onClick: () => this.setState({ globalSettingsVisible: true }) }] : []),
      ...(viewMode === 'chat' ? [{ key: 'display-settings', icon: <SettingOutlined />, label: t('ui.settings'), onClick: () => this.setState({ settingsDrawerVisible: true }) }] : []),
    ];
  }

  // 切换某菜单项的钉住状态：更新 state + 写 localStorage(全局持久)。
  // componentDidUpdate 会自动 _pushHeaderModel()，Electron 侧无需在此显式推送。
  togglePin = (key) => {
    this.setState((s) => {
      const next = togglePinned(s.pinnedKeys, key);
      try { localStorage.setItem(PINNED_KEY, serializePinned(next)); } catch {}
      return { pinnedKeys: next };
    });
  };

  // 由描述符构建 antd Dropdown items：按 dividerAfter 插入分隔线；每行 label 包成
  // flex 节点，右侧挂一个「钉」按钮(hover 显形 / 钉住后实心常驻，样式见 global.css [data-pin-trigger])。
  // 钉按钮 onClick 必须 stopPropagation，否则冒泡触发菜单项动作并关闭下拉。
  getMenuItems() {
    const pinned = new Set(this.state.pinnedKeys);
    const items = [];
    for (const d of this._getMenuDescriptors()) {
      const isPinned = pinned.has(d.key);
      const pinTitle = isPinned ? t('ui.menuUnpin') : t('ui.menuPin');
      items.push({
        key: d.key,
        icon: d.icon,
        onClick: d.onClick,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{d.label}</span>
            <span
              data-pin-trigger
              data-pinned={isPinned ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              aria-label={pinTitle}
              title={pinTitle}
              style={{ display: 'inline-flex', alignItems: 'center' }}
              onClick={(e) => { e.stopPropagation(); this.togglePin(d.key); }}
            >
              {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
            </span>
          </span>
        ),
      });
      if (d.dividerAfter) items.push({ type: 'divider' });
    }
    return items;
  }

  // 审批 bell 的数量/标题：header 右侧 render 与 tab bar 模型共用，避免重复计算。
  _buildApprovalInfo() {
    const ag = this.props.approvalGlobal;
    const adi = this.props.approvalDismissedIds;
    const own = this.props.approvalOwnPending || { ask: 0, ptyPlan: 0 };
    if (!ag || !this.props.onApprovalReopen) return null;
    let dismissedActive = 0;
    if (ag.ask?.ask?.id != null && adi instanceof Set && adi.has(`ask:${ag.ask.ask.id}`)) dismissedActive++;
    if (ag.ptyPlan?.ptyPlan?.id != null && adi instanceof Set && adi.has(`ptyPlan:${ag.ptyPlan.ptyPlan.id}`)) dismissedActive++;
    const localEmpty = !ag.ask?.ask && !ag.ptyPlan?.ptyPlan;
    const orphanCount = localEmpty ? ((own.ask || 0) + (own.ptyPlan || 0)) : 0;
    const total = dismissedActive + orphanCount;
    if (total === 0) return null;
    const titleKey = dismissedActive > 0 ? 'ui.approval.bell.reopen' : 'ui.approval.bell.orphan';
    const titleFallback = dismissedActive > 0 ? 'Reopen approval modal' : 'Server has pending approvals';
    const _tr = (k, p, f) => { try { const r = t(k, p); return (r && r !== k) ? r : f; } catch { return f; } };
    return { count: total, title: _tr(titleKey, null, titleFallback) };
  }

  // 迁移到 tab bar 的控件模型（label 已本地化；不含汉堡菜单项——菜单在 React 内弹出，避免被 50px tab bar 裁切）。
  _imStatus = {};
  _onImStatus = (id, info) => {
    const prev = this._imStatus[id];
    if (prev && prev.enabled === info.enabled && prev.connected === info.connected && prev.state === info.state) return;
    this._imStatus[id] = info;
    this._pushHeaderModel();
  };

  _buildHeaderModel() {
    const { viewMode, themeColor, terminalVisible, cliMode, isLocalLog, activeProxyId, proxyProfiles } = this.props;
    let proxy = null;
    if (activeProxyId && activeProxyId !== 'max') {
      const p = (proxyProfiles || []).find(x => x.id === activeProxyId);
      if (p) proxy = { label: `${p.name}${profileDisplayModel(p) ? ` · ${profileDisplayModel(p)}` : ''}` };
    }
    const showThemeBlock = viewMode === 'chat' && cliMode && !isLocalLog && !!this.state.localUrl;
    const im = IM_PLATFORMS
      .filter(p => this._imStatus[p.id] && this._imStatus[p.id].enabled)
      .map(p => {
        const nm = t(p.labelKey);
        return {
          id: p.id,
          connected: !!this._imStatus[p.id].connected,
          state: this._imStatus[p.id].state || null, // tri-state for tab-bar consumers; older tab bars ignore it
          name: (nm && nm !== p.labelKey) ? nm : (p.fallback || p.id),
        };
      });
    // 钉住的快捷方式：原生 tab bar 渲染所需。基于当前(已按 viewMode 过滤的)描述符过滤，
    // 顺序=用户钉住先后(稳定)，避免 _lastHeaderModelJson 抖动。name=菜单标签(已本地化)，作 title/aria。
    const descByKey = new Map(this._getMenuDescriptors().map(d => [d.key, d]));
    const pins = this.state.pinnedKeys
      .map(k => descByKey.get(k))
      .filter(Boolean)
      .map(d => ({ key: d.key, name: d.label }));
    const cd = this.state.countdownText;
    const countdown = (viewMode === 'raw' && cd)
      ? { text: `${t('ui.cacheCountdown', { type: this.props.cacheType ? `(${this.props.cacheType})` : '' })} ${cd}` }
      : null;
    return {
      // menu / iPad 开关的 tooltip 在 tab bar 渲染，但 tab bar 无 i18n，故标题从这里（有 t()）下发本地化文案。
      menu: { title: t('ui.menu') },
      deviceMode: { toIpad: t('ui.deviceMode.toIpad'), toPc: t('ui.deviceMode.toPc') },
      proxy,
      approval: this._buildApprovalInfo(),
      theme: showThemeBlock ? { mode: themeColor === 'light' ? 'light' : 'dark', title: themeColor === 'light' ? t('ui.themeColor.light') : t('ui.themeColor.dark') } : null,
      terminal: (cliMode && viewMode === 'chat' && !isLocalLog) ? { active: !!terminalVisible, label: t('ui.terminal') } : null,
      viewMode: { mode: viewMode, label: viewMode === 'raw' ? t('ui.chatMode') : t('ui.rawMode') },
      im,
      pins,
      countdown,
      qr: showThemeBlock ? { title: t('ui.scanToCoding') } : null,
    };
  }

  _pushHeaderModel() {
    if (!this._isElectronTab()) return;
    try {
      const model = this._buildHeaderModel();
      const json = JSON.stringify(model);
      if (json === this._lastHeaderModelJson) return;
      this._lastHeaderModelJson = json;
      window.tabBridge.setHeaderModel(model);
    } catch {}
  }

  _setupHeaderBridge() {
    if (!this._isElectronTab()) return;
    if (this._headerActionDispose) { try { this._headerActionDispose(); } catch {} this._headerActionDispose = null; }
    try {
      this._headerActionDispose = window.tabBridge.onHeaderAction((payload) => this._handleHeaderAction(payload));
    } catch {}
    this._pushHeaderModel();
  }

  // 把「菜单栏下拉是否打开」回报给 tab bar(经 main 转发):打开期间 hover 相邻顶级菜单即切换。
  _syncMenuBarState = () => {
    try { window.tabBridge?.menuBarState?.(!!this.state.electronMenuBar); } catch {}
  };

  _closeMenuBar = () => this.setState({ electronMenuBar: null }, this._syncMenuBarState);

  _handleHeaderAction(payload) {
    if (!payload || !payload.type) return;
    const { themeColor, onThemeColorChange, onToggleTerminal, onToggleViewMode, onApprovalReopen } = this.props;
    switch (payload.type) {
      case 'menuOpen': this.setState((s) => ({ electronMenuOpen: !s.electronMenuOpen })); break;
      // win32 自定义标题栏的 File/Edit/View/Window:tab bar 只放按钮,下拉在这里(全高内容视图)
      // 渲染才能跟随皮肤且不被 50px tab bar 裁切。payload 带 main 翻译好的 menus + 按钮横坐标 x。
      case 'menuBarOpen': this.setState((s) => {
        const cur = s.electronMenuBar;
        const next = (cur && cur.menuId === payload.menuId)
          ? null // 再点同一菜单按钮 → toggle 收起
          : { menuId: payload.menuId, x: payload.x || 0, menus: payload.menus || (cur && cur.menus) || [] };
        return { electronMenuBar: next };
      }, this._syncMenuBarState); break;
      case 'theme': if (onThemeColorChange) onThemeColorChange(themeColor === 'light' ? 'dark' : 'light'); break;
      case 'terminal': if (onToggleTerminal) onToggleTerminal(); break;
      case 'viewMode': if (onToggleViewMode) onToggleViewMode(); break;
      case 'approval': if (onApprovalReopen) onApprovalReopen(); break;
      case 'proxy': this.setState({ proxyModalVisible: true }); break;
      case 'im': this.setState({ imRecordVisible: true, imRecordPlatform: payload.id }); break;
      case 'menuShortcut': { const d = this._getMenuDescriptors().find(x => x.key === payload.key); if (d && d.onClick) d.onClick(); break; }
      case 'qrOpen': this.setState((s) => ({
        electronQrOpen: !s.electronQrOpen,
        // 锚点坐标仅在拿到有限数值时更新(Number.isFinite 同时挡掉 undefined/null/NaN);
        // 关闭/异常路径保留上次值,避免误用 0/NaN 导致弹层错位。
        electronQrAnchor: Number.isFinite(payload.rightOffset) ? payload.rightOffset : s.electronQrAnchor,
      })); break;
      default: break;
    }
  }

  // Electron「显示大小」用原生 webFrame.setZoomFactor 缩放 React 内容视图(tab bar 视图不缩放,
  // 见 electron/tab-content-preload.js + main.js 防双重缩放注释)。tab bar 报来的按钮坐标是窗口
  // 像素,需除以本视图缩放系数才能换算成 React CSS 像素。
  _displayZoom() {
    let zoom = 1;
    try {
      const n = Number(localStorage.getItem('ccv_displayScale'));
      if (Number.isFinite(n) && n >= 50 && n <= 200) zoom = n / 100;
    } catch {}
    return zoom;
  }

  // 二维码弹层(Electron):点页面空白处 / 按 Esc 关闭。原生扫码图标在独立的 tab bar 视图,其点击
  // 经 IPC 走 qrOpen toggle,不会在本文档产生 DOM 事件,故与此监听无「开即关」竞态。guard 在
  // electronQrOpen 上,仅 Electron 生效,不影响 Web 版(qrPopoverOpen,trigger=['click'] 自带关闭)。
  _onQrOutsidePointer = (e) => {
    if (!this.state.electronQrOpen) return;
    const tgt = e && e.target;
    if (tgt && typeof tgt.closest === 'function' && tgt.closest('.ant-popover')) return; // 点在弹层内(含内嵌 ConceptHelp)不关
    this.setState({ electronQrOpen: false });
  };
  _onQrKeyDown = (e) => {
    if (e && e.key === 'Escape' && this.state.electronQrOpen) this.setState({ electronQrOpen: false });
  };

  componentDidMount() {
    this.startCountdown();
    fetch(apiUrl('/api/local-url')).then(r => r.json()).then(data => {
      if (data.url) this.setState({ localUrl: data.url });
    }).catch(() => {});
    // 认证态：非 2xx(远程登录窗口期会 401) 或网络错误 → 降级为非 admin、视为已开启，
    // 既不暴露管理区也不破坏 header。本机(admin)会拿到真实 { enabled, isAdmin:true, password }。
    fetch(apiUrl('/api/auth/state')).then(r => {
      if (!r.ok) throw new Error('auth-state ' + r.status);
      return r.json();
    }).then(data => {
      this._applyAuthState(data);
    }).catch(() => {
      this.setState({ authState: makeAuthState({ enabled: true, global: { enabled: true, password: null } }) });
    });
    // claude-settings 由 SettingsProvider 集中 fetch,这里只订阅 Promise 拿 model 字段
    this.context._claudeSettingsReady.then(data => {
      if (data && data.model) this.setState({ settingsModel: data.model });
    });
    // 预热：live-tail 下提前拉一次文件系统 skill，首次打开 popover 就是权威视图而非闪一下历史。
    if (!this.props.isLocalLog) this.reloadFsSkills();
    // ipinfo.io 请求已移到 CountryFlag 组件里
    this._setupHeaderBridge();
    // 二维码弹层(Electron):空白处点击 / Esc 关闭。监听内部 guard 在 electronQrOpen 上。
    document.addEventListener('mousedown', this._onQrOutsidePointer);
    document.addEventListener('keydown', this._onQrKeyDown);
  }

  componentDidUpdate(prevProps) {
    this._pushHeaderModel();
    if (prevProps.cacheExpireAt !== this.props.cacheExpireAt) {
      this.startCountdown();
    }
    // Workspace 切换：projectName 变了 → 旧的 _fsSkills 属于旧项目，直接作废。
    // 递增 seq 防止正在途中的 reload 回包把脏数据塞回 state。
    if (prevProps.projectName !== this.props.projectName) {
      // seq++ 杀掉任何在途的 reloadFsSkills（即使下面不再重启新的 fetch，也要确保旧回包不会写脏数据）
      this._fsSkillsSeq++;
      this.setState({ _fsSkills: null });
      if (!this.props.isLocalLog && this.props.projectName) this.reloadFsSkills();
      // _memory 同样作废 —— 沿用 _fsSkills 的失效策略，下次 popover 打开时按需重拉。
      this._memorySeq++;
      this.setState({ _memory: null, _memoryDetail: null, _memoryRefreshing: false });
      // _claudeMd 候选随项目变化（cwd 父链不同），同步作废
      this._claudeMdSeq++;
      this._claudeMdDetailSeq++;
      this.setState({ _claudeMd: null, _claudeMdDetail: null });
    }
  }

  reloadFsSkills = async () => SeqLoaders.loadFsSkills(this, { isLocalLog: this.props.isLocalLog });

  // 把服务端返回的认证 state 写入本地(含 scope 信息),并清空编辑草稿。
  _applyAuthState(data) {
    this.setState({
      authState: makeAuthState({
        enabled: !!data.enabled,
        isAdmin: !!data.isAdmin,
        password: data.password ?? null,
        scope: data.scope === 'project' ? 'project' : 'global',
        hasProjectOverride: !!data.hasProjectOverride,
        projectDir: data.projectDir || null,
        global: data.global && typeof data.global === 'object' ? data.global : { enabled: false, password: null },
      }),
      _authPasswordDraft: null,
    });
  }

  // 提交认证配置变更(admin-only)。body = { scope?, enabled?, password?, clearOverride? }；
  // 成功后用服务端回的权威 state 覆盖本地。失败 → message.error 不改 state。
  postAuthConfig = async (body, opts = {}) => {
    if (this.state._authSaving) return;
    this.setState({ _authSaving: true });
    try {
      const post = async (b) => {
        const r = await fetch(apiUrl('/api/auth/config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        });
        if (!r.ok) throw new Error('auth-config ' + r.status);
        return r.json();
      };
      let data = await post(body);
      // 切到「全局」且全局原本未启用时：先启用全局(上一步生成共享密码)，再清除本项目覆盖→继承全局。
      // 两步合一,只弹一次提示、_authSaving 全程为真防重入。
      if (opts.thenClearOverride) data = await post({ clearOverride: true });
      this._applyAuthState(data);
      message.success(t('ui.auth.saved'));
    } catch {
      message.error(t('ui.auth.saveFailed'));
    } finally {
      this.setState({ _authSaving: false });
    }
  };

  // 二维码 / URL 输入框要展示的分享地址。
  // 密码保护开启时,远程用户不再需要 token —— 空密码模式直接放行,非空密码则进登录页用密码进入;
  // 故去掉 ?token= 给出更干净、可长期收藏/扫码的 URL。关闭时仍需 token,保留原始地址。
  // authState.enabled 变化会触发 re-render,二维码随之重绘。
  shareUrl() {
    const { localUrl, authState } = this.state;
    if (!localUrl || !authState.enabled) return localUrl;
    const i = localUrl.indexOf('?');
    return i === -1 ? localUrl : localUrl.slice(0, i);
  }

  // 二维码下方的密码管理区（仅 admin 渲染）。项目中心模型：整块表示「当前项目」的防护——
  // 顶部开关 = 本项目是否受保护(关 = 既不用自有也不用全局，即豁免)；
  // tab(仅开启时显示) = 本项目密码来源(本项目自有 / 继承全局)。无项目上下文时退化为单一全局维度。
  renderPasswordSection() {
    const { authState, _authScope, _authSaving } = this.state;
    const hasProject = !!authState.projectDir;

    // 无项目上下文：只有「全局」一个维度，开关 + 密码框 / 开启按钮，不显示 tab。
    if (!hasProject) {
      if (!authState.enabled) {
        return (
          <div className={styles.authSection}>
            <Button size="small" type="primary" loading={_authSaving} onClick={() => this.postAuthConfig({ scope: 'global', enabled: true })}>
              {t('ui.auth.enableBtn')}
            </Button>
          </div>
        );
      }
      return (
        <div className={styles.authSection}>
          <div className={styles.authHeaderRow}>
            <span className={styles.authTitle}>{t('ui.auth.title')}</span>
            <Switch size="small" checked={true} loading={_authSaving} title={t('ui.auth.disable')} onChange={() => this.postAuthConfig({ scope: 'global', enabled: false })} />
          </div>
          {this.renderPasswordInput('global', { enabled: authState.enabled, password: authState.password })}
        </div>
      );
    }

    // 项目上下文。protectedNow = 本项目当前是否受保护(effective)。
    const protectedNow = authState.enabled;
    // 密码来源 tab：跟随用户切换，默认落在当前生效来源(有覆盖=本项目，否则=全局)。
    const sourceTab = _authScope || authState.scope || 'project';
    // 当前来源对应的密码配置(用于密码框回显)。
    const cfg = sourceTab === 'global'
      ? (authState.global || { enabled: false, password: null })
      : { enabled: authState.enabled, password: authState.password };

    return (
      <div className={styles.authSection}>
        <div className={styles.authHeaderRow}>
          <span className={styles.authTitle}>{t('ui.auth.title')}</span>
          <Switch
            size="small"
            checked={protectedNow}
            loading={_authSaving}
            title={protectedNow ? t('ui.auth.disable') : t('ui.auth.enableBtn')}
            onChange={(on) => {
              if (on) {
                // 打开：默认落「本项目」自有密码(无覆盖→后端生成；禁用覆盖→沿用原密码重新启用)。
                this.setState({ _authScope: 'project' });
                this.postAuthConfig({ scope: 'project', enabled: true });
              } else {
                // 关闭：本项目显式豁免——写入禁用的项目覆盖以遮蔽全局(既不用自有也不用全局)。
                this.postAuthConfig({ scope: 'project', enabled: false });
              }
            }}
          />
        </div>
        {protectedNow && (
          <>
            <Segmented
              size="small"
              block
              value={sourceTab}
              onChange={(v) => {
                this.setState({ _authScope: v, _authPasswordDraft: null });
                if (v === 'global') {
                  // 继承全局：删除本项目覆盖。全局未启用时先启用全局(生成共享密码)再清覆盖，
                  // 保证切换后本项目仍受保护、开关不抖、tab 不消失。
                  if (authState.global && authState.global.enabled) {
                    this.postAuthConfig({ clearOverride: true });
                  } else {
                    this.postAuthConfig({ scope: 'global', enabled: true }, { thenClearOverride: true });
                  }
                } else {
                  // 本项目自有：建立/启用项目覆盖(无密码→后端生成)。
                  this.postAuthConfig({ scope: 'project', enabled: true });
                }
              }}
              options={[
                { label: t('ui.auth.scopeProject'), value: 'project' },
                { label: t('ui.auth.scopeGlobal'), value: 'global' },
              ]}
            />
            {this.renderPasswordInput(sourceTab, cfg)}
          </>
        )}
      </div>
    );
  }

  // 某作用域的密码框（复制 + 保存 + 空密码警告）。「本项目 / 全局」两 tab 共用。
  // 密码统一以大写展示(登录侧忽略大小写,见 routes/auth.js)；输入也强制大写,所见即所存。
  renderPasswordInput(scope, cfg) {
    const { _authPasswordDraft, _authSaving } = this.state;
    const pw = (cfg.password ?? '').toUpperCase();
    const draft = _authPasswordDraft == null ? pw : _authPasswordDraft;
    const dirty = _authPasswordDraft != null && _authPasswordDraft !== pw;
    return (
      <>
        <Input
          value={draft}
          className={styles.authPasswordInput}
          onChange={e => this.setState({ _authPasswordDraft: e.target.value.toUpperCase() })}
          onPressEnter={() => dirty && this.postAuthConfig({ scope, password: draft })}
          suffix={
            <CopyOutlined
              className={styles.qrcodeUrlCopy}
              title={t('ui.auth.copy')}
              onClick={() => {
                // 复制已保存的密码(pw),而非未保存的草稿(draft) —— 否则编辑未保存时复制会分享出
                // 一个尚未生效的密码,远程登录会失败。
                navigator.clipboard.writeText(pw).then(() => message.success(t('ui.auth.copied'))).catch(() => {});
              }}
            />
          }
        />
        {dirty && (
          <Button size="small" type="primary" loading={_authSaving} className={styles.authSaveBtn} onClick={() => this.postAuthConfig({ scope, password: draft })}>
            {t('ui.auth.save')}
          </Button>
        )}
        {draft === '' && <div className={styles.authEmptyWarn}>{t('ui.auth.emptyWarning')}</div>}
      </>
    );
  }

  loadMemory = async () => SeqLoaders.loadProjectMemory(this);

  // 用户主动点击"刷新记忆"按钮：自管 seq 三态（ok/stale/fail）以决定 toast。
  // 与 loadMemory 区分的原因：lazy-load 失败不打扰用户，只在 popover 内显示 memoryLoadError；
  // 主动刷新失败要 message.error 明确反馈。stale（workspace 中途切换）保持静默，避免误报。
  handleRefreshMemory = async () => {
    if (this.state._memoryRefreshing) return;
    this.setState({ _memoryRefreshing: true });
    const seq = ++this._memorySeq;
    let ok = false;
    let stale = false;
    try {
      const r = await fetch(apiUrl('/api/project-memory'));
      const data = await r.json();
      if (seq !== this._memorySeq) { stale = true; }
      else if (!r.ok) { this.setState({ _memory: false }); }
      else { this.setState({ _memory: data }); ok = true; }
    } catch {
      if (seq !== this._memorySeq) stale = true;
      else this.setState({ _memory: false });
    } finally {
      if (!stale) this.setState({ _memoryRefreshing: false });
    }
    if (stale) return;
    if (ok) message.success(t('ui.memoryRefreshSuccess'));
    else message.error(t('ui.memoryRefreshFailed'), 5);
  };

  // 血条 Popover 开关:打开时按需拉 _fsSkills / _memory / _claudeMd(避免页面初始化就发请求)。
  // 提取为 class field 后引用稳定,LiveTagPopover memo 不会因 callback 引用变化而失效。
  // 由 popover 内部打开的明细 Modal(CLAUDE.md / 记忆条目 / Skill 管理)是否处于打开态。
  _isCacheDetailModalOpen = () => !!(
    this.state._memoryDetail || this.state._claudeMdDetail || this.state._toolsCatalogOpen || (this.state._skillsModal && this.state._skillsModal.open)
  );

  // 稳定引用,避免内联箭头破坏 LiveTagPopover 的 memo（与其它 popover 回调一致）。
  _setToolsCatalogOpen = (o) => this.setState({ _toolsCatalogOpen: o });

  handleCachePopoverOpenChange = (open) => {
    // 这些明细 Modal 打开时，鼠标移到 Modal 上会让 hover 触发的血条 Popover 收到 mouseleave→close。
    // 此时忽略关闭，保持背后的血条面板不消失（Popover 已受控于 _cachePopoverOpen）。
    if (!open && this._isCacheDetailModalOpen()) return;
    this.setState({ _cachePopoverOpen: open });
    if (!open) this._cacheScrollInited = false;
    if (open && this.state._fsSkills === null && !this.props.isLocalLog) this.reloadFsSkills();
    if (open && this.state._memory === null) this.loadMemory();
    if (open && this.state._claudeMd === null) this.loadClaudeMdList();
  };

  loadClaudeMdList = async () => SeqLoaders.loadClaudeMdList(this);

  // 点击 CLAUDE.md chip 触发: 拉取明细到 _claudeMdDetail, MemoryDetailModal(linkMode=passthrough) 渲染。
  // tail / scope 提前注入到 detail.name 用作 Modal 标题, 避免等 server 回包再拼。
  loadClaudeMdDetail = async (id, tail, scope) => {
    const seq = ++this._claudeMdDetailSeq;
    const scopeLabel = scope === 'global' ? t('ui.claudeMdScopeGlobal') : t('ui.claudeMdScopeProject');
    const title = `${scopeLabel} · ${tail}`;
    this.setState({ _claudeMdDetail: { name: title, loading: true } });
    try {
      const r = await fetch(apiUrl(`/api/claude-md?id=${encodeURIComponent(id)}`));
      const data = await r.json();
      if (seq !== this._claudeMdDetailSeq) return;
      if (!r.ok) {
        this.setState({ _claudeMdDetail: { name: title, error: data.error || `http:${r.status}` } });
        return;
      }
      this.setState({ _claudeMdDetail: { name: title, content: data.content || '' } });
    } catch (e) {
      if (seq === this._claudeMdDetailSeq) {
        this.setState({ _claudeMdDetail: { name: title, error: e.message || 'network' } });
      }
    }
  };

  // 加载明细文件：name 必须是单段 .md basename（前端先校验，server 再校验一遍）。
  // seq 防快速连点：用户连点两个不同明细时，慢的回包不应覆盖快的（否则用户最后看到的是错的内容）。
  loadMemoryDetail = async (name) => {
    const seq = ++this._memoryDetailSeq;
    this.setState({ _memoryDetail: { name, loading: true } });
    try {
      const r = await fetch(apiUrl(`/api/project-memory?file=${encodeURIComponent(name)}`));
      const data = await r.json();
      if (seq !== this._memoryDetailSeq) return;
      if (!r.ok) {
        this.setState({ _memoryDetail: { name, error: data.error || `http:${r.status}` } });
        return;
      }
      this.setState({ _memoryDetail: { name, content: data.content || '' } });
    } catch (e) {
      if (seq === this._memoryDetailSeq) {
        this.setState({ _memoryDetail: { name, error: e.message || 'network' } });
      }
    }
  };

  // 白名单式 SCU：render() 里读到的每个 props 字段都必须在此列出，否则父组件 setState
  // 不会触发 AppHeader 重渲染（症状：受控控件的 checked/value 卡住不更新）。
  // 新增传给 AppHeader 的 prop 时，记得同步加进这里。
  shouldComponentUpdate(nextProps, nextState) {
    return (
      nextProps.requests !== this.props.requests ||
      nextProps.requestCount !== this.props.requestCount ||
      nextProps.viewMode !== this.props.viewMode ||
      nextProps.cacheExpireAt !== this.props.cacheExpireAt ||
      nextProps.cacheType !== this.props.cacheType ||
      nextProps.isLocalLog !== this.props.isLocalLog ||
      nextProps.localLogFile !== this.props.localLogFile ||
      nextProps.projectName !== this.props.projectName ||
      nextProps.instanceId !== this.props.instanceId ||
      nextProps.filterIrrelevant !== this.props.filterIrrelevant ||
      nextProps.logDir !== this.props.logDir ||
      nextProps.cliMode !== this.props.cliMode ||
      nextProps.sdkMode !== this.props.sdkMode ||
      nextProps.terminalVisible !== this.props.terminalVisible ||
      nextProps.contextWindow !== this.props.contextWindow ||
      nextProps.contextBarOptimistic !== this.props.contextBarOptimistic ||
      nextProps.contextBarLocked !== this.props.contextBarLocked ||
      nextProps.contextBarSlot !== this.props.contextBarSlot ||
      nextProps.serverCachedContent !== this.props.serverCachedContent ||
      nextProps.resumeAutoChoice !== this.props.resumeAutoChoice ||
      nextProps.themeColor !== this.props.themeColor ||
      nextProps.displayScale !== this.props.displayScale ||
      nextProps.autoApproveSeconds !== this.props.autoApproveSeconds ||
      nextProps.proxyProfiles !== this.props.proxyProfiles ||
      nextProps.activeProxyId !== this.props.activeProxyId ||
      nextProps.defaultConfig !== this.props.defaultConfig ||
      nextProps.retryConfig !== this.props.retryConfig ||
      nextProps.retryDefaults !== this.props.retryDefaults ||
      nextProps.approvalPrefs !== this.props.approvalPrefs ||
      nextProps.approvalGlobal !== this.props.approvalGlobal ||
      nextProps.approvalDismissedIds !== this.props.approvalDismissedIds ||
      nextProps.approvalOwnPending !== this.props.approvalOwnPending ||
      nextState !== this.state
    );
  }

  componentWillUnmount() {
    if (this._headerActionDispose) { try { this._headerActionDispose(); } catch {} this._headerActionDispose = null; }
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (this._cacheFadeClearTimer) clearTimeout(this._cacheFadeClearTimer);
    if (this._cacheScrollSettleTimer) clearTimeout(this._cacheScrollSettleTimer);
    if (this._cacheAutoFadeTimer) clearTimeout(this._cacheAutoFadeTimer);
    if (this._cacheHighlightDelayTimer) clearTimeout(this._cacheHighlightDelayTimer);
    this._cacheUnbindScrollFade();
    document.removeEventListener('mousedown', this._onQrOutsidePointer);
    document.removeEventListener('keydown', this._onQrKeyDown);
    // 让任何在途的 reloadFsSkills / loadMemory / loadMemoryDetail 回包 seq 校验失败
    // → 不会 setState 到已卸载组件。React 18 下 setState-on-unmounted 本身是静默 no-op，
    // 但明确标记更稳妥（也保证三个 seq 处理一致，code review 一致性诉求）。
    this._fsSkillsSeq++;
    this._memorySeq++;
    this._memoryDetailSeq++;
    this._claudeMdSeq++;
    this._claudeMdDetailSeq++;
  }

  startCountdown() {
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (!this.props.cacheExpireAt) {
      if (this.state.countdownText !== '') this.setState({ countdownText: '' });
      return;
    }
    this.updateCountdown();
  }

  // 秒级倒计时：改用 setTimeout 对齐下一秒边界，替代原 rAF 60fps 递归。
  // 旧实现每 16ms 跑一次 Date.now() + math + compare 虽然大多数帧不 setState，
  // 但仍占大量调度开销（profile 中 ~1934 samples）。新实现每秒至多一次 tick，
  // 保留 "text 未变不 setState" 守卫避免多余 render。
  updateCountdown() {
    const { cacheExpireAt } = this.props;
    if (!cacheExpireAt) {
      if (this.state.countdownText !== '') this.setState({ countdownText: '' });
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, cacheExpireAt - now);
    if (remaining <= 0) {
      const expired = t('ui.cacheExpired');
      if (this.state.countdownText !== expired) this.setState({ countdownText: expired });
      this._expiredTimer = setTimeout(() => {
        if (this.state.countdownText !== '') this.setState({ countdownText: '' });
      }, 5000);
      return;
    }

    const totalSec = Math.ceil(remaining / 1000);
    let text;
    if (totalSec >= 60) {
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      text = t('ui.minuteSecond', { m: m, s: String(s).padStart(2, '0') });
    } else {
      text = t('ui.second', { s: totalSec });
    }
    if (text !== this.state.countdownText) this.setState({ countdownText: text });
    const delay = 1000 - (now % 1000);
    this._countdownTimer = setTimeout(this.updateCountdown, delay);
  }

  // 命令相关的标签集合，已作为独立 prompt 输出，在 segments 中直接丢弃
  static COMMAND_TAGS = new Set([
    'command-name', 'command-message', 'command-args',
    'local-command-caveat', 'local-command-stdout',
  ]);

  // 将一段文本拆分为普通文本和 XML 标签片段（可折叠）
  static parseSegments(text) {
    const segments = [];
    // 匹配所有成对的 XML 标签: <tag-name ...>...</tag-name>
    const regex = /<([a-zA-Z_][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
      const tagName = match[1];
      lastIndex = match.index + match[0].length;
      // 命令相关标签直接跳过
      if (AppHeader.COMMAND_TAGS.has(tagName)) continue;
      // 提取标签内的内容（去掉外层开闭标签）
      const innerRegex = new RegExp(`^<${tagName}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tagName}>$`);
      const innerMatch = match[0].match(innerRegex);
      const content = innerMatch ? innerMatch[1].trim() : match[0].trim();
      segments.push({ type: 'system', content, label: tagName });
    }
    const after = text.slice(lastIndex).trim();
    if (after) segments.push({ type: 'text', content: after });
    return segments;
  }


  // 从消息列表中提取用户文本
  static extractUserTexts(messages) {
    const userMsgs = [];   // 纯用户文本（不含系统标签），用于去重
    const fullTexts = [];  // 完整文本（含系统标签），用于展示
    let slashCmd = null;
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      if (typeof msg.content === 'string') {
        const text = extractDisplayText(parseImOrigin(msg.content).text);
        if (!text) continue;
        if (/Implement the following plan:/i.test(text)) continue;
        userMsgs.push(text);
        fullTexts.push(text);
      } else if (Array.isArray(msg.content)) {
        const { commands, textBlocks } = classifyUserContent(msg.content);
        // 取最后一个 slash command（与之前行为一致）
        if (commands.length > 0) {
          slashCmd = commands[commands.length - 1];
        }
        // 过滤掉 plan prompt
        const userParts = [];
        for (const b of textBlocks) {
          if (/Implement the following plan:/i.test((b.text || '').trim())) continue;
          userParts.push(b.text.trim());
        }
        // 收集完整文本用于 context 视图
        const allParts = msg.content
          .filter(b => b.type === 'text' && b.text?.trim())
          .map(b => b.text.trim());
        if (userParts.length > 0) {
          userMsgs.push(userParts.join('\n'));
          fullTexts.push(allParts.join('\n'));
        }
      }
    }
    return { userMsgs, fullTexts, slashCmd };
  }

  extractUserPrompts() {
    const { requests = [] } = this.props;
    const prompts = [];
    const seen = new Set();
    let prevSlashCmd = null;
    const mainAgentRequests = requests.filter(r => isMainAgent(r));
    for (let ri = 0; ri < mainAgentRequests.length; ri++) {
      const req = mainAgentRequests[ri];
      const messages = req.body?.messages || [];
      const timestamp = req.timestamp || '';
      const { userMsgs, fullTexts, slashCmd } = AppHeader.extractUserTexts(messages);

      // 斜杠命令去重
      if (slashCmd && slashCmd !== '/compact' && slashCmd !== prevSlashCmd) {
        prompts.push({ type: 'prompt', segments: [{ type: 'text', content: slashCmd }], timestamp });
      }
      prevSlashCmd = slashCmd;

      // 逐条检查用户消息，用内容哈希去重
      for (let i = 0; i < userMsgs.length; i++) {
        const key = userMsgs[i];
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = fullTexts[i] || key;
        prompts.push({ type: 'prompt', segments: AppHeader.parseSegments(raw), timestamp });
      }
    }
    return prompts;
  }

  handleShowPrompts = () => {
    this.setState({
      promptModalVisible: true,
      promptData: this.extractUserPrompts(),
    });
  }

  handleExportPromptsTxt = () => {
    const prompts = this.state.promptData;
    if (!prompts || prompts.length === 0) return;
    const blocks = [];
    for (const p of prompts) {
      const lines = [];
      const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
      if (ts) lines.push(`${ts}:\n`);
      // 只输出纯文本 segments，跳过 system 标签
      const textParts = (p.segments || [])
        .filter(seg => seg.type === 'text')
        .map(seg => seg.content);
      if (textParts.length > 0) lines.push(textParts.join('\n'));
      blocks.push(lines.join('\n'));
    }
    if (blocks.length === 0) return;
    const blob = new Blob([blocks.join('\n\n\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-prompts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  renderTokenStats(closeParent) {
    const { requests = [] } = this.props;
    const { cacheHighlightIdx, cacheHighlightFading } = this.state;
    // Popover 打开期间 AppHeader 可能因 contextWindow / serverCachedContent 等其他
    // prop 变化而重渲，此时 requests 未变但会重跑 3 份 O(N) 聚合 + 大 JSX 构造。
    // 按 requests 引用 + 2 个高亮 state 做 === memo，典型场景命中率 >80%。
    if (
      this._tokenStatsCache &&
      this._tokenStatsCacheReq === requests &&
      this._tokenStatsCacheHl === cacheHighlightIdx &&
      this._tokenStatsCacheFade === cacheHighlightFading
    ) {
      return this._tokenStatsCache;
    }
    const byModel = computeTokenStats(requests);
    const models = Object.keys(byModel);
    const toolStats = computeToolUsageStats(requests);
    const skillStats = computeSkillUsageStats(requests);

    if (models.length === 0 && toolStats.length === 0) {
      return (
        <div className={styles.tokenStatsEmpty}>
          暂无 token 数据
        </div>
      );
    }

    const tokenColumn = (
      <div className={styles.tokenStatsColumn}>
        {models.map((model) => {
          const s = byModel[model];
          const totalInput = s.input + s.cacheCreation + s.cacheRead;
          const cacheHitRate = totalInput > 0 ? ((s.cacheRead / totalInput) * 100).toFixed(1) : '0.0';
          return (
            <div key={model} className={models.length > 1 ? styles.modelCardSpaced : sharedChrome.modelCard}>
              <div className={sharedChrome.modelName}>
                {model}
              </div>
              <table className={sharedChrome.statsTable}>
                <tbody>
                  <tr>
                    <td className={sharedChrome.label}>{t('ui.stats.token')}</td>
                    <td className={sharedChrome.th}>{t('ui.stats.input')}</td>
                    <td className={sharedChrome.th}>{t('ui.stats.output')}</td>
                  </tr>
                  <tr className={sharedChrome.rowBorder}>
                    <td className={sharedChrome.label}></td>
                    <td className={sharedChrome.td}>{formatTokenCount(totalInput)}</td>
                    <td className={sharedChrome.td}>{formatTokenCount(s.output)}</td>
                  </tr>
                  <tr>
                    <td className={sharedChrome.label}>{t('ui.stats.cache')}</td>
                    <td className={sharedChrome.th}>{t('ui.stats.create')}</td>
                    <td className={sharedChrome.th}>{t('ui.stats.read')}</td>
                  </tr>
                  <tr className={sharedChrome.rowBorder}>
                    <td className={sharedChrome.label}></td>
                    <td className={sharedChrome.td}>{formatTokenCount(s.cacheCreation)}</td>
                    <td className={sharedChrome.td}>{formatTokenCount(s.cacheRead)}</td>
                  </tr>
                  <tr>
                    <td className={sharedChrome.label}>{t('ui.hitRate')}</td>
                    <td colSpan={2} className={sharedChrome.td}>{cacheHitRate}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );

    const cacheRebuildColumn = this.renderCacheRebuildStats();

    const toolColumn = toolStats.length > 0 ? (
      <div className={styles.toolStatsColumn}>
        <div className={sharedChrome.modelCard}>
          <div className={sharedChrome.modelName}>{t('ui.toolUsageStats')} <ToolsHelp closeParent={closeParent} /></div>
          <table className={sharedChrome.statsTable}>
            <thead>
              <tr>
                <td className={`${sharedChrome.th} ${styles.thLeft}`}>{t('ui.stats.tool')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {toolStats.map(([name, count]) => (
                <tr key={name} className={sharedChrome.rowBorder}>
                  <td className={sharedChrome.label}>{name} <ConceptHelp doc={`Tool-${name}`} /></td>
                  <td className={sharedChrome.td}>{count}</td>
                </tr>
              ))}
              {toolStats.length > 1 && (
                <tr className={sharedChrome.rebuildTotalRow}>
                  <td className={sharedChrome.label}>{t('ui.stats.total')}</td>
                  <td className={sharedChrome.td}>{toolStats.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    ) : null;

    const skillColumn = skillStats.length > 0 ? (
      <div className={styles.toolStatsColumn}>
        <div className={sharedChrome.modelCard}>
          <div className={sharedChrome.modelName}>{t('ui.skillUsageStats')}</div>
          <table className={sharedChrome.statsTable}>
            <thead>
              <tr>
                <td className={`${sharedChrome.th} ${styles.thLeft}`}>{t('ui.stats.skill')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {skillStats.map(([name, count]) => (
                <tr key={name} className={sharedChrome.rowBorder}>
                  <td className={sharedChrome.label}>{name}</td>
                  <td className={sharedChrome.td}>{count}</td>
                </tr>
              ))}
              {skillStats.length > 1 && (
                <tr className={sharedChrome.rebuildTotalRow}>
                  <td className={sharedChrome.label}>{t('ui.stats.total')}</td>
                  <td className={sharedChrome.td}>{skillStats.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    ) : null;

    const result = (
      <div className={styles.tokenStatsContainer}>
        {tokenColumn}
        {cacheRebuildColumn}
        {toolColumn}
        {skillColumn}
      </div>
    );
    this._tokenStatsCache = result;
    this._tokenStatsCacheReq = requests;
    this._tokenStatsCacheHl = cacheHighlightIdx;
    this._tokenStatsCacheFade = cacheHighlightFading;
    return result;
  }

  _cacheUnbindScrollFade() {
    if (this._cacheOnScrollFade && this._cacheScrollEl) {
      this._cacheScrollEl.removeEventListener('scroll', this._cacheOnScrollFade);
      this._cacheOnScrollFade = null;
    }
  }

  _cacheBindScrollFade() {
    this._cacheUnbindScrollFade();
    const el = this._cacheScrollEl;
    if (!el) return;
    this._cacheOnScrollFade = () => {
      clearTimeout(this._cacheAutoFadeTimer);
      this.setState({ cacheHighlightFading: true });
      this._cacheFadeClearTimer = setTimeout(() => {
        this.setState({ cacheHighlightIdx: null, cacheHighlightFading: false });
      }, 3000);
      this._cacheUnbindScrollFade();
    };
    el.addEventListener('scroll', this._cacheOnScrollFade, { passive: true });
  }

  scrollToCacheMsg(idx) {
    // In raw mode, also navigate to the request in DetailPanel
    if (this.props.viewMode === 'raw' && this.props.onNavigateCacheMsg) {
      this.props.onNavigateCacheMsg(idx);
    }
    // Auto-expand messages section if collapsed
    if ((this.state._cacheSectionCollapsed || {}).messages) {
      this.setState(prev => ({
        _cacheSectionCollapsed: { ...(prev._cacheSectionCollapsed || {}), messages: false },
      }), () => this.scrollToCacheMsg(idx));
      return;
    }
    const el = this._cacheScrollEl;
    if (!el) return;
    const target = el.querySelector(`[data-msg-idx="${idx}"]`);
    if (!target) return;
    clearTimeout(this._cacheScrollSettleTimer);
    clearTimeout(this._cacheFadeClearTimer);
    clearTimeout(this._cacheAutoFadeTimer);
    clearTimeout(this._cacheHighlightDelayTimer);
    this._cacheUnbindScrollFade();
    if (this._cacheScrollEndHandler) {
      el.removeEventListener('scrollend', this._cacheScrollEndHandler);
    }
    this.setState({ cacheHighlightIdx: null, cacheHighlightFading: false });

    let scrollDone = false, minPassed = false;
    const showHighlight = () => {
      if (!scrollDone || !minPassed) return;
      this.setState({ cacheHighlightIdx: idx, cacheHighlightFading: false });
      this._cacheScrollSettleTimer = setTimeout(() => this._cacheBindScrollFade(), 200);
      this._cacheAutoFadeTimer = setTimeout(() => {
        if (this.state.cacheHighlightIdx === idx && !this.state.cacheHighlightFading) {
          this.setState({ cacheHighlightFading: true });
          this._cacheFadeClearTimer = setTimeout(() => {
            this.setState({ cacheHighlightIdx: null, cacheHighlightFading: false });
          }, 3000);
          this._cacheUnbindScrollFade();
        }
      }, 3000);
    };

    // Detect actual scroll completion
    this._cacheScrollEndHandler = () => {
      el.removeEventListener('scrollend', this._cacheScrollEndHandler);
      scrollDone = true;
      showHighlight();
    };
    el.addEventListener('scrollend', this._cacheScrollEndHandler, { once: true });
    // Fallback if scrollend doesn't fire (element already in view)
    this._cacheScrollSettleTimer = setTimeout(() => {
      el.removeEventListener('scrollend', this._cacheScrollEndHandler);
      scrollDone = true;
      showHighlight();
    }, 800);
    // Minimum 500ms delay
    this._cacheHighlightDelayTimer = setTimeout(() => {
      minPassed = true;
      showHighlight();
    }, 500);

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  handleCalibrationModelChange = (value) => {
    this.setState({ calibrationModel: value });
    localStorage.setItem('ccv_calibrationModel', value);
  };


  renderCacheRebuildStats() {
    const { requests = [] } = this.props;
    const stats = computeCacheRebuildStats(requests);
    const reasonKeys = ['ttl', 'system_change', 'tools_change', 'model_change', 'msg_truncated', 'msg_modified', 'key_change'];
    const i18nMap = {
      ttl: 'cacheLoss.ttl', system_change: 'cacheLoss.systemChange', tools_change: 'cacheLoss.toolsChange',
      model_change: 'cacheLoss.modelChange', msg_truncated: 'cacheLoss.msgTruncated', msg_modified: 'cacheLoss.msgModified', key_change: 'cacheLoss.keyChange',
    };
    const activeReasons = reasonKeys.filter(k => stats[k].count > 0);

    const totalCount = activeReasons.reduce((sum, k) => sum + stats[k].count, 0);
    const totalCache = activeReasons.reduce((sum, k) => sum + stats[k].cacheCreate, 0);

    // SubAgent 统计
    resolveTeammateNames(requests);
    const subAgentCounts = {};
    const teammateCounts = {};
    for (let i = 0; i < requests.length; i++) {
      const cls = classifyRequest(requests[i], requests[i + 1]);
      if (cls.type === 'SubAgent') {
        const label = cls.subType || 'Other';
        subAgentCounts[label] = (subAgentCounts[label] || 0) + 1;
      } else if (cls.type === 'Teammate') {
        const label = cls.subType || 'Teammate';
        teammateCounts[label] = (teammateCounts[label] || 0) + 1;
      }
    }
    const subAgentEntries = Object.entries(subAgentCounts).sort((a, b) => b[1] - a[1]);
    const teammateEntries = Object.entries(teammateCounts).sort((a, b) => b[1] - a[1]);

    const hasCacheStats = activeReasons.length > 0;
    const hasSubAgentStats = subAgentEntries.length > 0;
    const hasTeammateStats = teammateEntries.length > 0;
    if (!hasCacheStats && !hasSubAgentStats && !hasTeammateStats) return null;

    return (
      <div className={styles.toolStatsColumn}>
        {hasCacheStats && (
          <div className={(hasSubAgentStats || hasTeammateStats) ? styles.modelCardSpaced : sharedChrome.modelCard}>
            <div className={sharedChrome.modelName}>{t('ui.stats.mainAgent')}<ConceptHelp doc="MainAgent" /> {t('ui.cacheRebuildStats')}<ConceptHelp doc="CacheRebuild" /></div>
            <table className={sharedChrome.statsTable}>
            <thead>
              <tr>
                <td className={`${sharedChrome.th} ${styles.thLeft}`}>{t('ui.cacheRebuild.reason')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.count')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.cacheCreate')}</td>
              </tr>
            </thead>
            <tbody>
              {activeReasons.map(k => (
                <tr key={k} className={sharedChrome.rowBorder}>
                  <td className={sharedChrome.label}>{t(`ui.${i18nMap[k]}`)}</td>
                  <td className={sharedChrome.td}>{stats[k].count}</td>
                  <td className={sharedChrome.td}>{formatTokenCount(stats[k].cacheCreate)}</td>
                </tr>
              ))}
              {activeReasons.length > 1 && (
                <tr className={sharedChrome.rebuildTotalRow}>
                  <td className={sharedChrome.label}>{t('ui.stats.total')}</td>
                  <td className={sharedChrome.td}>{totalCount}</td>
                  <td className={sharedChrome.td}>{formatTokenCount(totalCache)}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
        {hasSubAgentStats && (
          <div className={hasTeammateStats ? styles.modelCardSpaced : sharedChrome.modelCard}>
            <div className={sharedChrome.modelName}>{t('ui.subAgentStats')}</div>
            <table className={sharedChrome.statsTable}>
            <thead>
              <tr>
                <td className={`${sharedChrome.th} ${styles.thLeft}`}>{t('ui.stats.subAgent')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {subAgentEntries.map(([name, count]) => (
                <tr key={name} className={sharedChrome.rowBorder}>
                  <td className={sharedChrome.label}>{name} <ConceptHelp doc={`SubAgent-${name}`} /></td>
                  <td className={sharedChrome.td}>{count}</td>
                </tr>
              ))}
              {subAgentEntries.length > 1 && (
                <tr className={sharedChrome.rebuildTotalRow}>
                  <td className={sharedChrome.label}>{t('ui.stats.total')}</td>
                  <td className={sharedChrome.td}>{subAgentEntries.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
        {hasTeammateStats && (
          <div className={sharedChrome.modelCard}>
            <div className={sharedChrome.modelName}>{t('ui.teammateStats.title')}<ConceptHelp doc="Teammate" /></div>
            <table className={sharedChrome.statsTable}>
            <thead>
              <tr>
                <td className={`${sharedChrome.th} ${styles.thLeft}`}>{t('ui.teammateStats.name')}</td>
                <td className={sharedChrome.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {teammateEntries.map(([name, count]) => (
                <tr key={name} className={sharedChrome.rowBorder}>
                  <td className={sharedChrome.label}>{name}</td>
                  <td className={sharedChrome.td}>{count}</td>
                </tr>
              ))}
              {teammateEntries.length > 1 && (
                <tr className={sharedChrome.rebuildTotalRow}>
                  <td className={sharedChrome.label}>{t('ui.stats.total')}</td>
                  <td className={sharedChrome.td}>{teammateEntries.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  renderTextPrompt(p) {
    return (
      <div className={styles.textPromptCard}>
        {p.segments.map((seg, j) => {
          if (seg.type === 'text') {
            return (
              <pre key={j} className={styles.preText}>{seg.content}</pre>
            );
          }
          return (
            <Collapse
              key={j}
              size="small"
              className={styles.systemCollapse}
              items={[{
                key: `sys-${j}`,
                label: <span className={styles.systemLabel}>{seg.label}</span>,
                children: (
                  <pre className={styles.preSys}>{seg.content}</pre>
                ),
              }]}
            />
          );
        })}
      </div>
    );
  }

  renderOriginalPrompt(p) {
    const textSegments = p.segments.filter(seg => seg.type === 'text');
    if (textSegments.length === 0) return null;
    return (
      <div className={styles.textPromptCard}>
        {textSegments.map((seg, j) => (
          <pre key={j} className={styles.preText}>{seg.content}</pre>
        ))}
      </div>
    );
  }

  buildTextModeContent() {
    const { promptData } = this.state;
    const blocks = [];
    for (const p of promptData) {
      const textParts = (p.segments || [])
        .filter(seg => seg.type === 'text')
        .map(seg => seg.content);
      if (textParts.length > 0) blocks.push(textParts.join('\n'));
    }
    return blocks.join('\n\n\n');
  }

  handleShowProjectStats = () => {
    this.setState({ projectStatsVisible: true, projectStatsLoading: true });
    fetch(apiUrl('/api/project-stats'))
      .then(res => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(data => this.setState({ projectStats: data, projectStatsLoading: false }))
      .catch(() => this.setState({ projectStats: null, projectStatsLoading: false }));
  };

  // plugin / process / proxy 三个 modal 已抽到独立组件 (PluginModal/ProcessModal/ProxyModal)
  // 自持 fetch + state + handlers; AppHeader 仅保留 *ModalVisible boolean 控制 open/close

  // 菜单 item onClick 简化:打开 modal,组件内部 useEffect 自动 fetch
  handleShowPlugins = () => this.setState({ pluginModalVisible: true });
  handleShowProcesses = () => this.setState({ processModalVisible: true });

  renderProjectStatsContent() {
    const { projectStats, projectStatsLoading } = this.state;

    if (projectStatsLoading) {
      return <div className={styles.projectStatsCenter}><Spin /></div>;
    }

    if (!projectStats) {
      return <div className={styles.projectStatsEmpty}>{t('ui.projectStats.noData')}</div>;
    }

    const { summary, models, updatedAt } = projectStats;
    const modelEntries = models ? Object.entries(models).sort((a, b) => b[1] - a[1]) : [];

    // 从 files 中汇总每个模型的 token 详情
    const modelTokens = {};
    if (projectStats.files) {
      for (const fStats of Object.values(projectStats.files)) {
        if (!fStats.models) continue;
        for (const [model, data] of Object.entries(fStats.models)) {
          if (!modelTokens[model]) modelTokens[model] = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, count: 0 };
          modelTokens[model].input += data.input_tokens || 0;
          modelTokens[model].output += data.output_tokens || 0;
          modelTokens[model].cacheRead += data.cache_read_input_tokens || 0;
          modelTokens[model].cacheCreation += data.cache_creation_input_tokens || 0;
          modelTokens[model].count += data.count || 0;
        }
      }
    }
    const modelTokenEntries = Object.entries(modelTokens).sort((a, b) => b[1].count - a[1].count);

    return (
      <div className={styles.projectStatsContent}>
        {updatedAt && (
          <div className={styles.projectStatsUpdated}>
            {t('ui.projectStats.updatedAt', { time: new Date(updatedAt).toLocaleString() })}
          </div>
        )}

        <div className={styles.projectStatsSummary}>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{summary?.requestCount ?? 0}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.totalRequests')}</div>
          </div>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{summary?.turnCount ?? summary?.sessionCount ?? 0}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.turnCount')}</div>
          </div>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{summary?.fileCount ?? 0}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.totalFiles')}</div>
          </div>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{formatTokenCount(summary?.input_tokens)}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.inputTokens')}</div>
          </div>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{formatTokenCount(summary?.output_tokens)}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.outputTokens')}</div>
          </div>
        </div>

        {modelTokenEntries.length > 0 && (
          <div className={styles.projectStatsSection}>
            <div className={styles.projectStatsSectionTitle}>{t('ui.projectStats.modelUsage')}</div>
            {modelTokenEntries.map(([model, data]) => {
              const totalInput = data.input + data.cacheRead + data.cacheCreation;
              const cacheHitRate = totalInput > 0 ? ((data.cacheRead / totalInput) * 100).toFixed(1) : '0.0';
              return (
                <div key={model} className={styles.projectStatsModelCard}>
                  <div className={styles.projectStatsModelHeader}>
                    <span className={styles.projectStatsModelName}>{model}</span>
                    <span className={styles.projectStatsModelCount}>{data.count} reqs</span>
                  </div>
                  <table className={sharedChrome.statsTable}>
                    <tbody>
                      <tr>
                        <td className={sharedChrome.label}>{t('ui.stats.token')}</td>
                        <td className={sharedChrome.th}>{t('ui.stats.input')}</td>
                        <td className={sharedChrome.th}>{t('ui.stats.output')}</td>
                      </tr>
                      <tr className={sharedChrome.rowBorder}>
                        <td className={sharedChrome.label}></td>
                        <td className={sharedChrome.td}>{formatTokenCount(totalInput)}</td>
                        <td className={sharedChrome.td}>{formatTokenCount(data.output)}</td>
                      </tr>
                      <tr>
                        <td className={sharedChrome.label}>{t('ui.stats.cache')}</td>
                        <td className={sharedChrome.th}>{t('ui.stats.create')}</td>
                        <td className={sharedChrome.th}>{t('ui.stats.read')}</td>
                      </tr>
                      <tr className={sharedChrome.rowBorder}>
                        <td className={sharedChrome.label}></td>
                        <td className={sharedChrome.td}>{formatTokenCount(data.cacheCreation)}</td>
                        <td className={sharedChrome.td}>{formatTokenCount(data.cacheRead)}</td>
                      </tr>
                      <tr>
                        <td className={sharedChrome.label}>{t('ui.hitRate')}</td>
                        <td colSpan={2} className={sharedChrome.td}>{cacheHitRate}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 把 LiveTagPopover（血条 + popover trigger）通过 createPortal 渲染到
  // TerminalPanel 工具栏（终端开启时）或 ChatInputBar 底部按钮区（终端关闭时）
  // 提供的 slot DOM 节点。slot 由 App.jsx 集中持有；缺席时返回 null（raw 模式等）。
  // 状态/数据所有权仍在 AppHeader（_cachePopoverOpen / _fsSkills / _memory /
  // _lastContextPercent），portal 仅迁移 DOM 位置，不影响 React 子树重建。
  renderContextBarPortal() {
    const slot = this.props.contextBarSlot;
    if (!slot) return null;

    const { requests = [], isLocalLog, localLogFile, projectName, contextWindow, contextBarOptimistic, contextBarLocked, serverCachedContent, claudeProjectModel } = this.props;

    // 计算上下文使用率:原始占用比(used / 窗口全量),与 Claude Code /context 口径一致。
    // 分子 sumUsageContextTokens = input + cache_creation(嵌套容错) + cache_read + output
    // ——含末轮 output 是因为它已进入下一轮上下文;百分比与 popover 显示的 token 数同源。
    // 反向找最后一条带 usage 的 MainAgent 一次，contextPercent 与 contextTokens 共用
    // AUTO 校准也依赖它的 model 名，所以必须在 calibrationTokens 求值之前完成
    let lastMainAgent = null;
    let lastTotalTokens = 0;
    let lastInputTokens = 0; // 输入侧(不含 output),仅供自适应纠偏判定
    if (!isLocalLog && requests.length > 0) {
      for (let i = requests.length - 1; i >= 0; i--) {
        if (isMainAgent(requests[i]) && requests[i].response?.body?.usage) {
          lastMainAgent = requests[i];
          const u = lastMainAgent.response.body.usage;
          lastTotalTokens = sumUsageContextTokens(u);
          lastInputTokens = sumUsageInputTokens(u);
          break;
        }
      }
    }
    // Calibration + percent math lives in utils/helpers.computeContextPercent,
    // shared verbatim with Mobile so the two shells can never drift again.
    let contextPercent = isLocalLog ? 0 : computeContextPercent({
      calibrationModel: this.state.calibrationModel,
      lastMainAgent,
      projectModelHint: claudeProjectModel,
      contextWindow,
      lastTotalTokens,
      lastInputTokens,
    });
    // contextBarLocked：/clear 触发后强制血条 0K (0%)，忽略 SSE 与 requests[] 残留的 pre-clear 数据，
    // 直到用户发出一条非 /clear 消息（AppBase.handleUserMessageSent 解锁）。
    // 锁定期间同步把 _lastContextPercent 记忆清零，避免解锁瞬间通过 memo 弹回旧值。
    if (contextBarLocked) {
      this._lastContextPercent = 0;
      contextPercent = 0;
    } else {
      if (contextPercent > 0) this._lastContextPercent = contextPercent;
      if (contextPercent === 0 && this._lastContextPercent > 0) {
        contextPercent = this._lastContextPercent;
      }
      // /clear 后立即把血条压到乐观水位；下一次 SSE context_window 推送会取消这个覆盖
      if (contextBarOptimistic) contextPercent = OPTIMISTIC_CLEAR_PERCENT;
    }
    const ctxColor = contextSeverityColor(contextPercent);
    const contextTokens = contextBarLocked ? 0 : lastTotalTokens;

    return createPortal(
      <LiveTagPopover
        isLocalLog={isLocalLog}
        localLogFile={localLogFile}
        cachePopoverOpen={this.state._cachePopoverOpen}
        onOpenChange={this.handleCachePopoverOpenChange}
        requests={requests}
        serverCachedContent={serverCachedContent}
        contextPercent={contextPercent}
        contextTokens={contextTokens}
        ctxColor={ctxColor}
        onSkillImported={this.reloadFsSkills}
        fsSkills={this.state._fsSkills}
        memory={this.state._memory}
        memoryRefreshing={this.state._memoryRefreshing}
        claudeMd={this.state._claudeMd}
        calibrationModel={this.state.calibrationModel}
        onCalibrationModelChange={this.handleCalibrationModelChange}
        onOpenMemoryDetail={this.loadMemoryDetail}
        onOpenClaudeMd={this.loadClaudeMdDetail}
        onOpenSkillsModal={this.handleOpenSkillsModal}
        onRefreshMemory={this.handleRefreshMemory}
        onToolsCatalogOpenChange={this._setToolsCatalogOpen}
        projectName={projectName}
      />,
      slot
    );
  }

  render() {
    const { requestCount, requests = [], viewMode, cacheType, onToggleViewMode, onImportLocalLogs, onLangChange, isLocalLog, localLogFile, projectName, filterIrrelevant, onFilterIrrelevantChange, logDir, onLogDirChange, cliMode, terminalVisible, onToggleTerminal, onReturnToWorkspaces, contextWindow, contextBarOptimistic, serverCachedContent, resumeAutoChoice, onResumeAutoChoiceToggle, onResumeAutoChoiceChange, themeColor, onThemeColorChange, displayScale, onDisplayScaleChange, autoApproveSeconds, onAutoApproveChange } = this.props;
    const { countdownText } = this.state;
    // 这 4 个偏好的唯一真相源是 SettingsContext（P0③）。AppHeader 已绑 SettingsContext，
    // 直接派生消费 + 调 updatePreferences，不再经 App 的 prop drilling。默认值与 AppBase._prefValues() 一致。
    const _prefs = (this.context && this.context.preferences) || {};
    const collapseToolResults = _prefs.collapseToolResults ?? true;
    const expandThinking = !!_prefs.expandThinking;
    const expandDiff = !!_prefs.expandDiff;
    const showFullToolContent = !!_prefs.showFullToolContent;
    const onlyCurrentSession = !!_prefs.onlyCurrentSession;

    const menuItems = this.getMenuItems();
    const isElectronTab = this._isElectronTab();

    return (
      <div className={styles.headerBar}>
        <Space size="middle" align="center">
          {!isElectronTab && (
          <Dropdown menu={{ items: menuItems, className: 'logo-dropdown-menu' }} trigger={['hover']} onOpenChange={(open) => this.setState({ logoDropdownOpen: open })} align={{ offset: [-4, 0] }}>
            <span className={`${styles.logoWrap}${this.state.logoDropdownOpen ? ` ${styles.logoWrapActive}` : ''}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${styles.logoImage}${this.state.logoDropdownOpen ? ` ${styles.logoImageActive}` : ''}`}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </span>
          </Dropdown>
          )}
          {isElectronTab && (
            <Dropdown
              menu={{ items: menuItems, className: 'logo-dropdown-menu' }}
              open={!!this.state.electronMenuOpen}
              onOpenChange={(open) => this.setState({ electronMenuOpen: open })}
              trigger={['click']}
              placement="bottomLeft"
              getPopupContainer={() => document.body}
            >
              <span aria-hidden="true" style={{ position: 'fixed', top: 4, left: 74, width: 1, height: 1, pointerEvents: 'none' }} />
            </Dropdown>
          )}
          {/* win32 自定义标题栏的 File/Edit/View/Window 下拉:按钮在 tab bar(50px view 放不下下拉),
              下拉锚在这里跟随皮肤。x 是 tab bar 报来的窗口坐标,本视图可能被原生缩放,需除以缩放系数。 */}
          {isElectronTab && this.state.electronMenuBar && (() => {
            const mb = this.state.electronMenuBar;
            const menu = (mb.menus || []).find((m) => m.id === mb.menuId);
            if (!menu) return null;
            const zoom = this._displayZoom();
            const items = (menu.items || []).map((it, i) => (it.type === 'separator'
              ? { type: 'divider', key: `sep-${i}` }
              : {
                key: it.id,
                label: (
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
                    <span>{it.label}</span>
                    {it.accel ? <span style={{ opacity: 0.55, fontSize: 12 }}>{it.accel}</span> : null}
                  </span>
                ),
              }));
            return (
              <Dropdown
                menu={{
                  items,
                  className: 'logo-dropdown-menu',
                  onClick: ({ key }) => {
                    try { window.tabBridge?.menuCommand?.(key); } catch {}
                    this._closeMenuBar();
                  },
                }}
                open
                onOpenChange={(open) => { if (!open) this._closeMenuBar(); }}
                trigger={['click']}
                placement="bottomLeft"
                getPopupContainer={() => document.body}
              >
                <span aria-hidden="true" style={{ position: 'fixed', top: 4, left: Math.round((mb.x || 0) / zoom), width: 1, height: 1, pointerEvents: 'none' }} />
              </Dropdown>
            );
          })()}
          {!isElectronTab && (() => {
            // 钉住的快捷方式：汉堡右侧的常驻入口。按描述符过滤(mode-gated 项当前不存在则跳过渲染，
            // 但保留在 localStorage，切回对应模式自动恢复)。Electron 下走原生 tab bar(见 _buildHeaderModel.pins)。
            const descByKey = new Map(this._getMenuDescriptors().map(d => [d.key, d]));
            const pins = this.state.pinnedKeys.map(k => descByKey.get(k)).filter(Boolean);
            if (pins.length === 0) return null;
            return pins.map((d) => (
              <Tooltip key={d.key} title={d.label}>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={d.label}
                  className={styles.pinnedShortcut}
                  onClick={d.onClick}
                >
                  {d.icon}
                </span>
              </Tooltip>
            ));
          })()}
          {/* 日志模式下 IM 无法正常配置/使用，不暴露入口 */}
          {!isLocalLog && IM_PLATFORMS.map((p) => (
            <ImStatusChip key={p.id} descriptor={p} onStatus={this._onImStatus} onClick={() => this.setState({ imRecordVisible: true, imRecordPlatform: p.id })} />
          ))}
          {isElectronTab && (() => {
            // 锚点 right = 「图标右缘到窗口右缘的距离」÷ 本视图缩放系数(rightOffset 由 tab bar 点击时
            // 实测回传,自动覆盖按钮增减 / win32 右侧 140px overlay-spacer / 显示缩放)。首次未拿到坐标回退 90。
            const anchorRight = this.state.electronQrAnchor != null
              ? Math.round(this.state.electronQrAnchor / this._displayZoom())
              : 90;
            return (
            <Popover
              content={
                <div className={styles.qrcodePopover} onClick={e => e.stopPropagation()}>
                  <div className={styles.qrcodeTitle}>{t('ui.scanToCoding')} <ConceptHelp doc="QRCode" /></div>
                  <QRCodeCanvas value={this.shareUrl()} size={200} bgColor={themeColor === 'light' ? '#ffffff' : '#141414'} fgColor={themeColor === 'light' ? '#1a1a1a' : '#d9d9d9'} level="M" />
                  <Input
                    readOnly
                    value={this.shareUrl()}
                    className={styles.qrcodeUrlInput}
                    suffix={
                      <CopyOutlined
                        className={styles.qrcodeUrlCopy}
                        onClick={() => { navigator.clipboard.writeText(this.shareUrl()).then(() => { message.success(t('ui.copied')); }).catch(() => {}); }}
                      />
                    }
                  />
                  {this.state.authState.isAdmin && this.renderPasswordSection()}
                </div>
              }
              trigger={[]}
              open={!!this.state.electronQrOpen}
              onOpenChange={(o) => this.setState({ electronQrOpen: o })}
              placement="bottomRight"
              getPopupContainer={() => document.body}
              overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '8px 8px' }}
            >
              <span aria-hidden="true" style={{ position: 'fixed', top: 4, right: anchorRight, width: 1, height: 1, pointerEvents: 'none' }} />
            </Popover>
            );
          })()}
          {!isElectronTab && this.props.activeProxyId && this.props.activeProxyId !== 'max' && (() => {
            const p = (this.props.proxyProfiles || []).find(x => x.id === this.props.activeProxyId);
            return p ? (
              <Tag className={styles.proxyProfileTag} onClick={() => this.setState({ proxyModalVisible: true })}>
                <SwapOutlined className={styles.proxySwapIcon} />
                {p.name}{profileDisplayModel(p) ? ` · ${profileDisplayModel(p)}` : ''}
              </Tag>
            ) : null;
          })()}
          <HeaderProjectLabel projectName={projectName} isLocalLog={isLocalLog} instanceId={this.props.instanceId} />
          {this.renderContextBarPortal()}
        </Space>

        <Space size={12} align="center" className={styles.headerRightRow}>
          {(() => {
            // 持久 bell：当存在被 ESC/点遮罩 minimised 的 pending（dismissedIds 命中 approvalGlobal 中的 id），
            // 或本 tab 在 main 端有 ownPending 但本地 approvalGlobal 为空（WS 重连/丢状态边缘），
            // 渲染一个 bell 按钮供用户主动唤起 modal。点击 → onApprovalReopen 清 dismissedIds，
            // ApprovalModal 的 visibleKinds 由此重新命中显示。
            if (isElectronTab) return null; // Electron 下 bell 在 tab bar 渲染
            const info = this._buildApprovalInfo();
            if (!info) return null;
            return (
              <button
                type="button"
                className={styles.approvalBell}
                aria-label={info.title}
                title={info.title}
                onClick={() => this.props.onApprovalReopen && this.props.onApprovalReopen()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2a6 6 0 0 0-6 6v3.5L4.5 14a1 1 0 0 0 .8 1.6h13.4a1 1 0 0 0 .8-1.6L18 11.5V8a6 6 0 0 0-6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none"/>
                  <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                </svg>
                {info.count > 0 && <span className={styles.approvalBellBadge}>{info.count}</span>}
              </button>
            );
          })()}
          {countdownText && viewMode === 'raw' && (
            <Tag className={styles.headerCountdownTag} style={{ color: countdownText === t('ui.cacheExpired') ? 'var(--color-error-light)' : 'var(--text-secondary)' }}>
              {t('ui.cacheCountdown', { type: cacheType ? `(${cacheType})` : '' })}
              <strong className={styles.countdownStrong}>{countdownText}</strong>
            </Tag>
          )}
          {!isElectronTab && viewMode === 'chat' && cliMode && !isLocalLog && this.state.localUrl && (
            <>
<Popover
              content={
                /* stopPropagation 防止 popover 内部点击(QR canvas / Input / Copy 图标)冒泡到外层 click 触发 onOpenChange(false)。
                   单独触发关闭只通过 trigger 元素自身或外部空白处。 */
                <div className={styles.qrcodePopover} onClick={e => e.stopPropagation()}>
                  <div className={styles.qrcodeTitle}>{t('ui.scanToCoding')} <ConceptHelp doc="QRCode" /></div>
                  <QRCodeCanvas value={this.shareUrl()} size={200} bgColor={themeColor === 'light' ? '#ffffff' : '#141414'} fgColor={themeColor === 'light' ? '#1a1a1a' : '#d9d9d9'} level="M" />
                  <Input
                    readOnly
                    value={this.shareUrl()}
                    className={styles.qrcodeUrlInput}
                    suffix={
                      <CopyOutlined
                        className={styles.qrcodeUrlCopy}
                        onClick={() => {
                          navigator.clipboard.writeText(this.shareUrl()).then(() => {
                            message.success(t('ui.copied'));
                          }).catch(() => {});
                        }}
                      />
                    }
                  />
                  {this.state.authState.isAdmin && this.renderPasswordSection()}
                </div>
              }
              /* 移动端 hover/focus 不可靠(tap → focus → 立即触发外部 click 关闭),改 click 受控:
                 单击触发体打开 / 再次单击或外部空白处关闭。stopPropagation 确保 popover 内点击不关。 */
              trigger={['click']}
              open={this.state.qrPopoverOpen}
              onOpenChange={(o) => this.setState({ qrPopoverOpen: o })}
              placement="bottomRight"
              overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '8px 8px' }}
            >
              {/* 去掉 antd Button 外框，button 直接作为 Popover 触发体；键盘 Tab 可聚焦。
                  和 themeToggle / compactBtn 一样走 flex center，高度 30px 与同行对齐。 */}
              <button
                type="button"
                className={styles.qrcodeIcon}
                aria-label={t('ui.scanToCoding')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  {/* Three QR finder patterns (10×10 outer, 6×6 hollow, 4×4 inner dot) rendered
                      as a single evenodd path so the rings stay crisp at 18px, plus a 5-dot X
                      data pattern in the bottom-right quadrant (3×3 modules = 2.25px each). */}
                  <path fillRule="evenodd" d="M0 0h10v10H0zM2 2v6h6V2zM3 3h4v4H3zM14 0h10v10H14zM16 2v6h6V2zM17 3h4v4H17zM0 14h10v10H0zM2 16v6h6v-6zM3 17h4v4H3zM14 14h3v3h-3zM20 14h3v3h-3zM17 17h3v3h-3zM14 20h3v3h-3zM20 20h3v3h-3z"/>
                </svg>
              </button>
            </Popover>
              {!isElectronTab && (
              <button
                type="button"
                className={styles.themeToggle}
                title={themeColor === 'light' ? t('ui.themeColor.light') : t('ui.themeColor.dark')}
                aria-label={themeColor === 'light' ? t('ui.themeColor.light') : t('ui.themeColor.dark')}
                onClick={() => onThemeColorChange && onThemeColorChange(themeColor === 'light' ? 'dark' : 'light')}
              >
                {themeColor === 'light' ? (
                  /* Sun: 中心圆 + 8 条呈十字斜向分布的光芒（亮色态显示太阳） */
                  <svg className={styles.themeToggleIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="2.8" fill="currentColor"/>
                    <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                      <line x1="8" y1="1" x2="8" y2="2.6"/>
                      <line x1="8" y1="13.4" x2="8" y2="15"/>
                      <line x1="1" y1="8" x2="2.6" y2="8"/>
                      <line x1="13.4" y1="8" x2="15" y2="8"/>
                      <line x1="2.95" y1="2.95" x2="4.1" y2="4.1"/>
                      <line x1="11.9" y1="11.9" x2="13.05" y2="13.05"/>
                      <line x1="2.95" y1="13.05" x2="4.1" y2="11.9"/>
                      <line x1="11.9" y1="4.1" x2="13.05" y2="2.95"/>
                    </g>
                  </svg>
                ) : (
                  /* Moon: 右向月牙（暗色态显示月亮） */
                  <svg className={styles.themeToggleIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8.4 2.5a5.9 5.9 0 1 0 5.1 8.55A4.8 4.8 0 0 1 8.4 2.5Z" fill="currentColor"/>
                  </svg>
                )}
              </button>
              )}
            </>
          )}
          {!isElectronTab && cliMode && viewMode === 'chat' && !isLocalLog && (
            <Button
              className={styles.compactBtn}
              type={terminalVisible ? 'primary' : 'default'}
              ghost={terminalVisible}
              icon={<CodeOutlined />}
              onClick={onToggleTerminal}
            >
              {t('ui.terminal')}
            </Button>
          )}
          {!isElectronTab && (
          <Button
            className={styles.compactBtn}
            type={viewMode === 'raw' ? 'primary' : 'default'}
            icon={viewMode === 'raw' ? <MessageOutlined /> : <FileTextOutlined />}
            onClick={onToggleViewMode}
          >
            {viewMode === 'raw' ? t('ui.chatMode') : t('ui.rawMode')}
          </Button>
          )}
        </Space>
        <MemoryDetailModal
          detail={this.state._memoryDetail}
          onClose={() => this.setState({ _memoryDetail: null })}
          onOpenMemoryDetail={this.loadMemoryDetail}
        />
        <MemoryDetailModal
          detail={this.state._claudeMdDetail}
          onClose={() => this.setState({ _claudeMdDetail: null })}
          linkMode="passthrough"
        />
        <Modal
          title={`${t('ui.userPrompt')} (${this.state.promptData.length}${t('ui.promptCountUnit')})`}
          open={this.state.promptModalVisible}
          onCancel={() => this.setState({ promptModalVisible: false })}
          footer={null}
          width={700}
          styles={{ mask: BLUR_MASK_STYLE }}
        >
          <div className={styles.promptExportBar}>
            <Button icon={<DownloadOutlined />} onClick={this.handleExportPromptsTxt}>
              {t('ui.exportPromptsTxt')}
            </Button>
          </div>
          <Tabs
            activeKey={this.state.promptViewMode}
            onChange={(key) => this.setState({ promptViewMode: key })}
            size="small"
            items={[
              { key: 'original', label: t('ui.promptModeOriginal') },
              { key: 'context', label: t('ui.promptModeContext') },
              { key: 'text', label: t('ui.promptModeText') },
            ]}
          />
          {this.state.promptViewMode === 'text' ? (
            <textarea
              readOnly
              className={styles.promptTextarea}
              value={this.buildTextModeContent()}
            />
          ) : (
            <div className={styles.promptScrollArea}>
              {this.state.promptData.length === 0 && (
                <div className={styles.promptEmpty}>{t('ui.noPrompt')}</div>
              )}
              {this.state.promptData.map((p, i) => {
                const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : t('ui.unknownTime');
                return (
                  <div key={i}>
                    <div className={styles.promptTimestamp}>
                      {ts}:
                    </div>
                    {this.state.promptViewMode === 'original'
                      ? this.renderOriginalPrompt(p)
                      : this.renderTextPrompt(p)}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
        <Drawer
          title={t('ui.settings')}
          placement="left"
          rootClassName="ccvSideDrawer"
          width={420}
          open={this.state.settingsDrawerVisible}
          onClose={() => this.setState({ settingsDrawerVisible: false })}
        >
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsGroupTitle}>{t('ui.chatDisplay')}</div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>
                {t('ui.permission.autoApprove.setting')}
                <Tooltip title={t('ui.permission.autoApprove.help')}>
                  <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                </Tooltip>
              </span>
              <Select
                size="small"
                value={autoApproveSeconds || 0}
                onChange={(value) => onAutoApproveChange && onAutoApproveChange(value)}
                options={autoApproveSelectOptions(PERM_AUTO_APPROVE_OPTIONS, t)}
                style={{ width: 100 }}
              />
            </div>
            {this.props.approvalPrefs && this.props.onApprovalPrefsChange && (
              <>
                <div className={styles.settingsItem}>
                  <span className={styles.settingsLabel}>
                    {t('ui.approval.settings.planAutoApprove')}
                    <Tooltip title={t('ui.approval.settings.planAutoApproveHelp')}>
                      <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                    </Tooltip>
                  </span>
                  <Select
                    size="small"
                    value={this.props.approvalPrefs.planAutoApproveSeconds || 0}
                    onChange={(value) => this.props.onApprovalPrefsChange({ planAutoApproveSeconds: value })}
                    options={autoApproveSelectOptions(PLAN_AUTO_APPROVE_OPTIONS, t)}
                    style={{ width: 100 }}
                  />
                </div>
                <div className={styles.settingsItem}>
                  <span className={styles.settingsLabel}>
                    {t('ui.approval.settings.modalEnabled')}
                    <Tooltip title={t('ui.approval.settings.modalEnabled.help')}>
                      <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                    </Tooltip>
                  </span>
                  <Switch
                    checked={this.props.approvalPrefs.modalEnabled !== false}
                    onChange={(checked) => this.props.onApprovalPrefsChange({ modalEnabled: checked })}
                  />
                </div>
                <div className={styles.settingsItem}>
                  <span className={styles.settingsLabel}>
                    {t('ui.approval.settings.soundEnabled')}
                    <Tooltip title={t('ui.approval.settings.soundEnabled.help')}>
                      <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                    </Tooltip>
                  </span>
                  <Switch
                    checked={!!this.props.approvalPrefs.soundEnabled}
                    onChange={(checked) => this.props.onApprovalSoundToggle && this.props.onApprovalSoundToggle(checked)}
                  />
                </div>
                {/* notifyOnlyWhenHidden 依赖 electron main 进程的 OS Notification + 窗口聚焦判断,
                    纯 web 模式下 main.js 路径不存在,开关无效果 → 仅 electron 启动模式显示。 */}
                {typeof window !== 'undefined' && window.tabBridge && (
                  <div className={styles.settingsItem}>
                    <span className={styles.settingsLabel}>{t('ui.approval.settings.notifyOnlyWhenHidden')}</span>
                    <Switch
                      checked={this.props.approvalPrefs.notifyOnlyWhenHidden !== false}
                      onChange={(checked) => this.props.onApprovalPrefsChange({ notifyOnlyWhenHidden: checked })}
                    />
                  </div>
                )}
                {this.props.approvalPrefs.soundEnabled && this.props.onVoicePackChange && (
                  <VoicePackSettings
                    prefs={this.props.approvalPrefs.voicePack}
                    onChange={this.props.onVoicePackChange}
                    embedded
                  />
                )}
              </>
            )}
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>
                {t('ui.expandThinking')}
                <Tooltip title={t('ui.expandThinking.help')}>
                  <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                </Tooltip>
              </span>
              <Switch
                checked={!!expandThinking}
                onChange={(checked) => this.context.updatePreferences({ expandThinking: checked })}
              />
            </div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>
                {t('ui.showFullToolContent')}
                <Tooltip title={t('ui.showFullToolContent.help')}>
                  <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                </Tooltip>
              </span>
              <Switch
                checked={!!showFullToolContent}
                onChange={(checked) => this.context.updatePreferences({ showFullToolContent: checked })}
              />
            </div>
            {showFullToolContent && (
              <div className={styles.settingsItem}>
                <span className={styles.settingsLabel}>{t('ui.collapseToolResults')}</span>
                <Switch
                  checked={!!collapseToolResults}
                  onChange={(checked) => this.context.updatePreferences({ collapseToolResults: checked })}
                />
              </div>
            )}
            {/* logfile 只读模式强制全量展示所有 session，隐藏该开关 */}
            {!this.props.isLocalLog && (
              <div className={styles.settingsItem}>
                <span className={styles.settingsLabel}>
                  {t('ui.onlyCurrentSession')}
                  <Tooltip title={t('ui.onlyCurrentSession.help')}>
                    <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                  </Tooltip>
                </span>
                <Switch
                  checked={!!onlyCurrentSession}
                  onChange={(checked) => this.context.updatePreferences({ onlyCurrentSession: checked })}
                />
              </div>
            )}
          </div>
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsGroupTitle}>{t('ui.logSettings')}</div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.resumeAutoChoice')}</span>
              <Switch
                checked={!!resumeAutoChoice}
                onChange={(checked) => onResumeAutoChoiceToggle && onResumeAutoChoiceToggle(checked)}
              />
            </div>
            {resumeAutoChoice && (
              <div className={styles.settingsItem}>
                <Radio.Group
                  value={resumeAutoChoice}
                  onChange={(e) => onResumeAutoChoiceChange && onResumeAutoChoiceChange(e.target.value)}
                  size="small"
                >
                  <Radio value="continue">{t('ui.resumeAutoChoice.continue')}</Radio>
                  <Radio value="new">{t('ui.resumeAutoChoice.new')}</Radio>
                </Radio.Group>
              </div>
            )}
          </div>
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsGroupTitle}>{t('ui.themeStyle')}</div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.themeColor')}</span>
              <Select
                size="small"
                value={themeColor || 'light'}
                onChange={(value) => onThemeColorChange && onThemeColorChange(value)}
                options={[
                  { label: t('ui.themeColor.dark'), value: 'dark' },
                  { label: t('ui.themeColor.light'), value: 'light' },
                ]}
                style={{ width: 140 }}
              />
            </div>
            <div className={styles.settingsItem}>
              {hasNativeZoom ? (
                // Electron 桌面:label 带「缩放整个界面」tooltip + 预设下拉 → webFrame.setZoomFactor 原生缩放。
                <>
                  <Tooltip title={t('ui.displayScale.hint')}>
                    <span className={styles.settingsLabel}>{t('ui.displayScale')}</span>
                  </Tooltip>
                  <Select
                    size="small"
                    value={displayScale || 100}
                    onChange={(value) => onDisplayScaleChange && onDisplayScaleChange(value)}
                    options={DISPLAY_SCALE_PRESETS.map(p => ({ label: `${p}%`, value: p }))}
                    style={{ width: 140 }}
                  />
                </>
              ) : (
                // 纯浏览器(仅桌面渲染本行):无法用 JS 设原生缩放,label 不再挂会误导的 hint,
                // 改用 (?) 提示用户按浏览器自带快捷键缩放(按平台区分 ⌘ / Ctrl)。
                <>
                  <span className={styles.settingsLabel}>{t('ui.displayScale')}</span>
                  <Tooltip title={t('ui.displayScale.browserHint', { mod: isMac ? '⌘' : 'Ctrl' })}>
                    <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                  </Tooltip>
                </>
              )}
            </div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.languageSettings')}</span>
              <Select
                size="small"
                value={getLang()}
                onChange={(value) => {
                  setLang(value);
                  if (onLangChange) onLangChange();
                }}
                options={LANG_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
                style={{ width: 140 }}
              />
            </div>
          </div>
          {/* 项目独立配置（多人共用一台 server，按项目隔离偏好）：
              - 非本机(LAN) + 有真实项目 + 非日志模式 → 显示「启动项目独立配置」开关；
              - 本机(127.0.0.1) 且已存在其他项目的独立配置 → 显示「配置管理」入口。
              两者互斥（LAN vs 本机），无任一条件时整组隐藏。 */}
          {(() => {
            const pp = this.props.preferences || {};
            const showToggle = !isLocalLog && !!pp._projectName && pp._isLocal === false;
            const forkKeys = Array.isArray(pp._projectPrefsKeys) ? pp._projectPrefsKeys : [];
            const showManage = pp._isLocal === true && forkKeys.length > 0;
            if (!showToggle && !showManage) return null;
            return (
              <div className={styles.settingsGroupBox}>
                <div className={styles.settingsGroupTitle}>{t('ui.projectScopedPrefs.group')}</div>
                {showToggle && (
                  <div className={styles.settingsItem}>
                    <span className={styles.settingsLabel}>
                      {t('ui.projectScopedPrefs')}
                      <Tooltip title={t('ui.projectScopedPrefs.help')}>
                        <QuestionCircleOutlined className={styles.settingsHelpIcon} />
                      </Tooltip>
                    </span>
                    <Switch
                      aria-label={t('ui.projectScopedPrefs')}
                      checked={!!pp._projectScoped}
                      onChange={(checked) => this.props.onToggleProjectScoped && this.props.onToggleProjectScoped(checked)}
                    />
                  </div>
                )}
                {showManage && (
                  <div className={styles.settingsItem}>
                    <span className={styles.settingsLabel}>{t('ui.projectPrefsManage')}</span>
                    <Button size="small" onClick={() => this.setState({ projectPrefsModalOpen: true })}>
                      {t('ui.projectPrefsManage.open', { count: forkKeys.length })}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </Drawer>
        <Drawer
          title={<span>{t('ui.globalSettings')} <ConceptHelp doc="GlobalSettings" /></span>}
          placement="left"
          rootClassName="ccvSideDrawer"
          width={400}
          open={this.state.globalSettingsVisible}
          onClose={() => this.setState({ globalSettingsVisible: false })}
        >
          <div className={styles.settingsItem}>
            <span className={styles.settingsLabel}>{t('ui.filterIrrelevant')}</span>
            <Switch
              checked={!!filterIrrelevant}
              onChange={(checked) => onFilterIrrelevantChange && onFilterIrrelevantChange(checked)}
            />
          </div>
          <div className={styles.settingsItem}>
            <span className={styles.settingsLabel}>{t('ui.expandDiff')}</span>
            <Switch
              checked={!!expandDiff}
              onChange={(checked) => this.context.updatePreferences({ expandDiff: checked })}
            />
          </div>
          <div className={styles.settingsDivider} />
          <div className={styles.settingsLabel}>{t('ui.logDirTitle')}</div>
          <Input
            className={styles.logDirInput}
            value={this.state.logDirDraft ?? logDir}
            onChange={(e) => this.setState({ logDirDraft: e.target.value })}
            onBlur={() => {
              const val = this.state.logDirDraft;
              if (val != null && val !== logDir) onLogDirChange?.(val);
              this.setState({ logDirDraft: null });
            }}
            onPressEnter={() => {
              const val = this.state.logDirDraft;
              if (val != null && val !== logDir) onLogDirChange?.(val);
              this.setState({ logDirDraft: null });
            }}
            placeholder="~/.claude/cc-viewer"
          />
        </Drawer>
        <Drawer
          title={<span><BarChartOutlined className={sharedChrome.titleIcon} />{t('ui.projectStats')}</span>}
          placement="left"
          rootClassName="ccvSideDrawer"
          width={400}
          open={this.state.projectStatsVisible}
          onClose={() => this.setState({ projectStatsVisible: false })}
        >
          {this.renderProjectStatsContent()}
        </Drawer>
        {/* 插件 / 进程 / 代理三个 modal 已抽到独立组件，详见 PluginModal/ProcessModal/ProxyModal */}
        <PluginModal
          open={this.state.pluginModalVisible}
          onClose={() => this.setState({ pluginModalVisible: false })}
        />
        <ProcessModal
          open={this.state.processModalVisible}
          onClose={() => this.setState({ processModalVisible: false })}
        />
        <ProxyModal
          open={this.state.proxyModalVisible}
          onClose={() => this.setState({ proxyModalVisible: false })}
          proxyProfiles={this.props.proxyProfiles}
          activeProxyId={this.props.activeProxyId}
          defaultConfig={this.props.defaultConfig}
          onProxyProfileChange={this.props.onProxyProfileChange}
        />
        <RetryConfigModal
          open={this.state.retryConfigModalVisible}
          onClose={() => this.setState({ retryConfigModalVisible: false })}
          config={this.props.retryConfig}
          defaults={this.props.retryDefaults}
          onConfigChange={this.props.onRetryConfigChange}
        />
        <SystemTextModal
          open={this.state.systemTextModalVisible}
          onClose={() => this.setState({ systemTextModalVisible: false })}
        />
        <MessagingModal
          open={this.state.messagingModalVisible}
          initialTool={this.state.messagingInitialTool}
          onClose={() => this.setState({ messagingModalVisible: false })}
        />
        <ImConversationModal
          open={this.state.imRecordVisible}
          platform={this.state.imRecordPlatform}
          onClose={() => this.setState({ imRecordVisible: false })}
          onOpenConfig={(platform) => this.setState({ messagingModalVisible: true, messagingInitialTool: platform })}
        />

        {/* Skills Manager Modal — 从 AppHeader popover「已载入 Skill」→「管理」按钮打开 */}
        {this.renderSkillsManagerModal()}

        {/* 项目独立配置管理（本机）：偏好抽屉底部「配置管理」入口打开 */}
        <ProjectPrefsManagerModal
          open={this.state.projectPrefsModalOpen}
          onClose={() => this.setState({ projectPrefsModalOpen: false })}
          onChanged={this.props.onRefreshProjectPrefs}
        />
      </div>
    );
  }

  handleOpenSkillsModal = async () => {
    // 复用已缓存的 _fsSkills；null（还没拉过）或 false（上次失败）都重拉一次。
    // 不从 state 回读 reloadFsSkills 的结果 —— 用它的返回值（setState 异步、await 后 state 可能还没 flush）。
    const cached = this.state._fsSkills;
    const needFetch = !Array.isArray(cached);
    // 不再关闭血条 Popover：Skill 管理 Modal 打开期间，受控 Popover + handleCachePopoverOpenChange
    // 的明细 Modal 守卫会让背后的血条面板保持显示（与 CLAUDE.md / 记忆条目明细一致）。
    this.setState(prev => ({
      _skillsModal: {
        open: true,
        loading: needFetch,
        // 默认排序只在「打开面板」时套用（项目级优先于用户级）；开关期间不重排，避免列表抖动
        skills: Array.isArray(cached) ? sortSkillsDefault(cached) : [],
        error: null,
        toggling: prev._skillsModal?.toggling || new Set(),
      },
    }));
    if (needFetch) {
      const result = await this.reloadFsSkills();
      this.setState(prev => ({
        _skillsModal: {
          ...prev._skillsModal,
          loading: false,
          skills: result.ok ? sortSkillsDefault(result.skills) : [],
          error: result.ok ? null : result.reason,
        },
      }));
    }
  };

  // 开关 / 永久删除逻辑抽到 src/utils/skillModalController.js（AppHeader 与 Mobile 共用，避免镜像漂移）
  handleToggleSkill = (skill) => handleSkillToggle(this, skill);

  handleDeleteSkill = (skill) => handleSkillDelete(this, skill);

  renderSkillsManagerModal() {
    const modal = this.state._skillsModal || {};
    return (
      <SkillsManagerModal
        open={modal.open || false}
        loading={modal.loading || false}
        error={modal.error || null}
        skills={modal.skills || []}
        toggling={modal.toggling}
        onToggle={(s) => this.handleToggleSkill(s)}
        onDelete={(s) => this.handleDeleteSkill(s)}
        onClose={() => this.setState(prev => ({ _skillsModal: { ...prev._skillsModal, open: false } }))}
      />
    );
  }
}

export default AppHeader;
