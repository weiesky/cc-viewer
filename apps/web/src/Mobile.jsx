import React from 'react';
import { ConfigProvider, Spin, Button, Badge, Switch, Select, Modal, message, Tooltip } from 'antd';
import { BranchesOutlined, DownloadOutlined, DeleteOutlined, RollbackOutlined, ReloadOutlined, UploadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import AppBase, { styles, OPTIMISTIC_CLEAR_PERCENT } from './AppBase';
import { isIOS, isPad, setViewMode } from './env';
import { isMainAgent, classifyUserContent, extractDisplayText } from '../../../packages/app/src/utils/contentFilter';
import { parseImOrigin } from './utils/imOrigin';
import { sortSkillsDefault } from './utils/skillsParser';
import { handleSkillToggle, handleSkillDelete } from './utils/skillModalController';
import { getEffectiveModel, readCalibrationModel, computeContextPercent, sumUsageInputTokens, sumUsageContextTokens } from './utils/helpers';
import { contextSeverityColor } from './utils/formatters';
import { PERM_AUTO_APPROVE_OPTIONS, PLAN_AUTO_APPROVE_OPTIONS, autoApproveSelectOptions } from './utils/autoApproveOptions';
import ChatView from './components/chat/ChatView';
import TerminalPanel from './components/terminal/TerminalPanel';
import { TerminalWsProvider } from './components/terminal/TerminalWsContext';
import ToolApprovalPanel from './components/approval/ToolApprovalPanel';
import ApprovalModal from './components/approval/ApprovalModal';
import MobileGitDiff from './components/mobile/MobileGitDiff';
import MobileFileExplorer from './components/mobile/MobileFileExplorer';
import MobileStats from './components/mobile/MobileStats';
import VoicePackSettings from './components/settings/VoicePackSettings';
import CachePopoverContent from './components/dashboard/CachePopoverContent';
import MemoryDetailModal from './components/common/MemoryDetailModal';
import SkillsManagerModal from './components/settings/SkillsManagerModal';
import ProjectPrefsManagerModal from './components/settings/ProjectPrefsManagerModal';
import PluginModal from './components/settings/PluginModal';
import ProcessModal from './components/settings/ProcessModal';
import ProxyModal from './components/settings/ProxyModal';
import OpenFolderIcon from './components/common/OpenFolderIcon';
import appConfig from './config.json';
import { t, getLang, setLang, LANG_OPTIONS } from './i18n';
import { useProjectAlias } from './hooks/useProjectAlias';
import { apiUrl } from './utils/apiUrl';
import * as SeqLoaders from './utils/seqResourceLoaders';

const CALIBRATION_MODELS = appConfig.calibrationModels;

// Bridge useProjectAlias into the mobile ctx label. Mobile-side is read-only
// for phase 1 — edit entry lives in AppHeader only because the mobile bar is
// tight and aliasing on mobile is less common. Cross-tab / same-tab updates
// still propagate here via the hook so a desktop alias edit reflects on
// mobile without reload.
function MobileCtxLabelText({ projectName }) {
  const alias = useProjectAlias(projectName);
  const base = `${t('ui.liveMonitoring')}${projectName ? `: ${projectName}` : ''}`;
  return <>{base}{alias ? ` (${alias})` : ''}</>;
}

class Mobile extends AppBase {
  constructor(props) {
    super(props);
    // 移动端专属 state
    Object.assign(this.state, {
      mobileMenuVisible: false,
      mobileStatsVisible: false,
      mobileGitDiffVisible: false,
      mobileChatVisible: false,
      mobileLogMgmtVisible: false,
      mobileSettingsVisible: false,
      projectPrefsModalOpen: false,
      mobilePromptVisible: false,
      mobileTerminalVisible: false,
      mobileFileExplorerVisible: false,
      mobileCachePanelVisible: false,  // 手机模式：点击血条划出的侧边抽屉
      globalPermission: null,     // { permission, handlers } — 全局权限审批浮层
      globalPlanApproval: null,   // { plan, handlers } — 全局计划审批浮层
      autoApproveSeconds: 0,
      hasGit: true,
      terminalPendingImages: [],  // 终端面板独立的 pending 图片/文件
      // ─── 血条 popover/抽屉用的状态（与 AppHeader 同语义）─────────
      // null=loading / false=失败 / 数组=加载结果。workspace 切换由 componentDidUpdate + seq 控制。
      _fsSkills: null,
      _memory: null,
      _memoryRefreshing: false,
      _memoryDetail: null,
      // CLAUDE.md 候选清单 + 明细（与 AppHeader 等价；分槽避免与 _memoryDetail 交叉）
      _claudeMd: null,
      _claudeMdDetail: null,
      // 与 PC 端对齐:插件管理 / CCV进程管理 / 代理热切换 modal 仅持 open 状态;
      // 实际数据 + handler 都在 PluginModal/ProcessModal/ProxyModal 内部
      pluginModalVisible: false,
      processModalVisible: false,
      proxyModalVisible: false,
      // 与 AppHeader._skillsModal 同结构；toggling 用 Set 跟踪正在切换的 skill key。
      _skillsModal: { open: false, loading: false, skills: [], error: null, toggling: new Set() },
      // Shared reader applies the legacy-value migration exactly like AppHeader
      // (mobile previously skipped migration and silently degraded to 'auto').
      calibrationModel: readCalibrationModel(CALIBRATION_MODELS),
    });
    this._lastContextPercent = 0;
    this._fsSkillsSeq = 0;
    this._memorySeq = 0;
    this._memoryDetailSeq = 0;
    this._claudeMdSeq = 0;
    this._claudeMdDetailSeq = 0;
  }

  // 关掉所有移动端互斥 overlay。每次打开任一 overlay 时先调用此方法，
  // 避免 9+ 处 setState 漏键导致两个 overlay 叠加（review 反馈：closeAll helper 比逐处加 key 安全）。
  _closeAllMobileOverlays() {
    return {
      mobileMenuVisible: false,
      mobileStatsVisible: false,
      mobileGitDiffVisible: false,
      mobileChatVisible: false,
      mobileLogMgmtVisible: false,
      mobileSettingsVisible: false,
      mobilePromptVisible: false,
      mobileTerminalVisible: false,
      mobileFileExplorerVisible: false,
      mobileCachePanelVisible: false,
      // PC-aligned modals: 也纳入互斥关闭, 避免点击其他菜单项时这 3 个仍残留
      pluginModalVisible: false,
      processModalVisible: false,
      proxyModalVisible: false,
    };
  }

  handleCalibrationModelChange = (value) => {
    this.setState({ calibrationModel: value });
    localStorage.setItem('ccv_calibrationModel', value);
  };

  reloadFsSkills = async () => SeqLoaders.loadFsSkills(this, { isLocalLog: this._isLocalLog });

  // 打开 skills 管理 modal。同时关闭 cache 抽屉避免两个 overlay 叠加。
  // 与 AppHeader.handleOpenSkillsModal 同语义；区别只在于关闭 cache UI 的字段名（mobileCachePanelVisible vs _cachePopoverOpen）。
  handleOpenSkillsModal = async () => {
    const cached = this.state._fsSkills;
    const needFetch = !Array.isArray(cached);
    this.setState(prev => ({
      _skillsModal: {
        open: true,
        loading: needFetch,
        // 默认排序只在「打开面板」时套用（项目级优先于用户级）；开关期间不重排，避免列表抖动
        skills: Array.isArray(cached) ? sortSkillsDefault(cached) : [],
        error: null,
        toggling: prev._skillsModal?.toggling || new Set(),
      },
      mobileCachePanelVisible: false,
    }), () => this._onCachePanelOpenChange(false));
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

  // 开关 / 永久删除逻辑抽到 src/utils/skillModalController.js（与 AppHeader 共用，避免镜像漂移）
  handleToggleSkill = (skill) => handleSkillToggle(this, skill);

  handleDeleteSkill = (skill) => handleSkillDelete(this, skill);

  loadMemory = async () => SeqLoaders.loadProjectMemory(this);

  // 与 AppHeader.handleRefreshMemory 同语义：用户主动刷新带 toast 反馈，
  // stale（workspace 中途切换）保持静默不误报失败。
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

  // 抽屉打开瞬间懒加载（iPad / 手机点击血条的 onClick 都会调用）。
  // 仅在 open=true 且数据未加载（null）时触发 fetch，与 AppHeader.onOpenChange 同语义。
  _onCachePanelOpenChange = (open) => {
    if (open && this.state._fsSkills === null && !this._isLocalLog) this.reloadFsSkills();
    if (open && this.state._memory === null) this.loadMemory();
    if (open && this.state._claudeMd === null) this.loadClaudeMdList();
  };

  loadClaudeMdList = async () => SeqLoaders.loadClaudeMdList(this);

  // 点击 chip → 拉明细到 _claudeMdDetail；标题用"<scope> · <tail>"组合。
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

  componentDidMount() {
    super.componentDidMount();
    // 检测项目是否有 git（优先多仓库 API，回退旧 API）
    fetch(apiUrl('/api/git-repos')).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (!data.repos?.length) this.setState({ hasGit: false, mobileGitDiffVisible: false });
    }).catch(() => {
      fetch(apiUrl('/api/git-status')).then(r => {
        if (!r.ok) this.setState({ hasGit: false, mobileGitDiffVisible: false });
      }).catch(() => this.setState({ hasGit: false, mobileGitDiffVisible: false }));
    });
    // iOS 虚拟键盘弹出时，Safari 会滚动整个文档将页面上推，
    // 导致导航栏消失在视口之外。通过 visualViewport 的 resize + scroll
    // 事件同步可见区域的高度和偏移，用 fixed 定位将布局锁定在可见区域内。
    if (isIOS && !isPad && window.visualViewport) {
      this._onVisualViewportChange = () => {
        const el = this._layoutRef.current;
        if (!el) return;
        const vv = window.visualViewport;
        el.style.position = 'fixed';
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.width = '100%';
        el.style.left = '0';
      };
      window.visualViewport.addEventListener('resize', this._onVisualViewportChange);
      window.visualViewport.addEventListener('scroll', this._onVisualViewportChange);
      this._onVisualViewportChange();
    }
    // iPad/侧边栏模式 → 全览(pc) 的切换。
    // Electron：只跟随右上角开关（device mode 状态），不随窗口宽度变化；挂载时按当前状态对齐。
    // 浏览器：窗口 ≥ 1400px 时弹框提示切换到全览模式（原行为不变）。
    if (isPad) {
      const inElectronTab = typeof window !== 'undefined' && !!window.tabBridge;
      this._modeSwitchDialog = null;
      if (inElectronTab) {
        this._onDeviceMode = (on) => {
          const target = on ? 'pad' : 'pc';
          if (localStorage.getItem('ccv_viewMode') !== target) setViewMode(target);
        };
        this._disposeDeviceMode = window.tabBridge.onDeviceModeChange?.(this._onDeviceMode);
        window.tabBridge.requestDeviceMode?.();
      } else {
        this._mqlWide = window.matchMedia('(min-width: 1400px)');
        this._onWideChange = (e) => {
          if (e.matches) {
            this._modeSwitchDialog = Modal.confirm({
              title: t('ui.modeSwitchTitle'),
              content: t('ui.modeSwitchToFullView'),
              okText: t('ui.ok'),
              onOk: () => { this._modeSwitchDialog = null; setViewMode('pc'); },
              onCancel: () => { this._modeSwitchDialog = null; },
            });
          } else if (this._modeSwitchDialog) {
            this._modeSwitchDialog.destroy();
            this._modeSwitchDialog = null;
          }
        };
        this._mqlWide.addEventListener('change', this._onWideChange);
      }
    }
  }

  componentWillUnmount() {
    if (this._onVisualViewportChange && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._onVisualViewportChange);
      window.visualViewport.removeEventListener('scroll', this._onVisualViewportChange);
    }
    if (this._disposeDeviceMode) { this._disposeDeviceMode(); this._disposeDeviceMode = null; }
    if (this._mqlWide) {
      this._mqlWide.removeEventListener('change', this._onWideChange);
    }
    if (this._modeSwitchDialog) {
      this._modeSwitchDialog.destroy();
      this._modeSwitchDialog = null;
    }
    // 与 AppHeader.componentWillUnmount 对齐：让在途 reloadFsSkills / loadMemory /
    // handleRefreshMemory / loadMemoryDetail 的回包 seq 校验失败 → 不会 setState 到
    // 已卸载组件，也不会触发 toast。
    this._fsSkillsSeq++;
    this._memorySeq++;
    this._memoryDetailSeq++;
    this._claudeMdSeq++;
    this._claudeMdDetailSeq++;
    super.componentWillUnmount();
  }

  componentDidUpdate(prevProps, prevState) {
    if (super.componentDidUpdate) super.componentDidUpdate(prevProps, prevState);
    // workspace 切换：projectName 变了 → 旧的 _fsSkills/_memory/_claudeMd 属于旧项目，作废 + 刷 seq
    if (prevState.projectName !== this.state.projectName) {
      this._fsSkillsSeq++;
      this._memorySeq++;
      this._claudeMdSeq++;
      this._claudeMdDetailSeq++;
      this.setState({
        _fsSkills: null,
        _memory: null,
        _memoryDetail: null,
        _memoryRefreshing: false,
        _claudeMd: null,
        _claudeMdDetail: null,
      });
    }
  }

  // ─── 对话中文件路径点击 → 打开移动端文件浏览器 ────────────
  _handleMobileOpenFile = (filePath, ancestors) => {
    // local log 模式下不打开文件浏览器
    if (this.state.localLogFile) return;
    this.setState({
      ...this._closeAllMobileOverlays(),
      mobileFileExplorerVisible: true,
      mobileFileExplorerTarget: { file: filePath, ancestors: ancestors || [] },
    });
  };

  // ─── Prompt 提取 ───────────────────────────────────────

  static COMMAND_TAGS = new Set([
    'command-name', 'command-message', 'command-args',
    'local-command-caveat', 'local-command-stdout',
  ]);

  static parseSegments(text) {
    const segments = [];
    const regex = /<([a-zA-Z_][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
      const tagName = match[1];
      lastIndex = match.index + match[0].length;
      if (Mobile.COMMAND_TAGS.has(tagName)) continue;
      const innerRegex = new RegExp(`^<${tagName}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tagName}>$`);
      const innerMatch = match[0].match(innerRegex);
      const content = innerMatch ? innerMatch[1].trim() : match[0].trim();
      segments.push({ type: 'system', content, label: tagName });
    }
    const after = text.slice(lastIndex).trim();
    if (after) segments.push({ type: 'text', content: after });
    return segments;
  }

  static extractUserTexts(messages) {
    const userMsgs = [];
    const fullTexts = [];
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
        if (commands.length > 0) {
          slashCmd = commands[commands.length - 1];
        }
        const userParts = [];
        for (const b of textBlocks) {
          if (/Implement the following plan:/i.test((b.text || '').trim())) continue;
          userParts.push(b.text.trim());
        }
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

  extractUserPrompts(requests) {
    const prompts = [];
    const seen = new Set();
    let prevSlashCmd = null;
    const mainAgentRequests = requests.filter(r => isMainAgent(r));

    for (let ri = 0; ri < mainAgentRequests.length; ri++) {
      const req = mainAgentRequests[ri];
      const messages = req.body?.messages || [];
      const timestamp = req.timestamp || '';
      const { userMsgs, fullTexts, slashCmd } = Mobile.extractUserTexts(messages);

      if (slashCmd && slashCmd !== '/compact' && slashCmd !== prevSlashCmd) {
        prompts.push({ type: 'prompt', segments: [{ type: 'text', content: slashCmd }], timestamp });
      }
      prevSlashCmd = slashCmd;

      for (let i = 0; i < userMsgs.length; i++) {
        const key = userMsgs[i];
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = fullTexts[i] || key;
        prompts.push({ type: 'prompt', segments: Mobile.parseSegments(raw), timestamp });
      }
    }
    return prompts;
  }

  renderOriginalPrompt(p) {
    const textSegments = p.segments.filter(seg => seg.type === 'text');
    if (textSegments.length === 0) return null;
    return (
      <div className={styles.mobilePromptCard}>
        {textSegments.map((seg, j) => (
          <pre key={j} className={styles.mobilePromptPreText}>{seg.content}</pre>
        ))}
      </div>
    );
  }

  handleExportPromptsTxt = (prompts) => {
    if (!prompts || prompts.length === 0) return;
    const blocks = [];
    for (const p of prompts) {
      const lines = [];
      const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
      if (ts) lines.push(`${ts}:\n`);
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
  };

  // ─── 移动端渲染 ────────────────────────────────────────

  handlePendingPermission = (data) => { this.setState({ globalPermission: data }); };
  handlePendingPlanApproval = (data) => { this.setState({ globalPlanApproval: data }); };

  handleAutoApproveChange = (seconds) => {
    this.setState({ autoApproveSeconds: seconds });
    this.context.updatePreferences({ autoApproveSeconds: seconds });
  };

  // 拖拽上传逻辑已上提到 AppBase；Mobile 仅 override 两个分发钩子：终端可见时落入
  // terminalPendingImages（图片队列），否则落入 pendingUploadPaths。toTerminal 在 drop
  // 时刻捕获（经基类 _onDrop 的 _captureDropContext），保证上传期间切换终端不改变目标。
  _captureDropContext() { return { toTerminal: this.state.mobileTerminalVisible }; }

  _dispatchUploadedFiles(results, ctx) {
    const uploaded = results.filter(Boolean);
    if (!uploaded.length) return;
    if (ctx?.toTerminal) {
      this.setState(prev => ({
        terminalPendingImages: [...prev.terminalPendingImages, ...uploaded.map(r => ({ path: r.path, source: 'drop' }))],
      }));
    } else {
      this.setState(prev => ({
        pendingUploadPaths: [...(prev.pendingUploadPaths || []), ...uploaded.map(r => `"${r.path}"`)],
      }));
    }
  }

  _handleTerminalFilePath = (path) => {
    this.setState(prev => ({
      terminalPendingImages: [...prev.terminalPendingImages, { path, source: 'terminal' }],
    }));
  };

  _handleRemoveTerminalImage = (idx) => {
    this.setState(prev => ({
      terminalPendingImages: prev.terminalPendingImages.filter((_, i) => i !== idx),
    }));
  };

  _handleClearTerminalImages = () => {
    this.setState({ terminalPendingImages: [] });
  };

  render() {
    const { filteredRequests, deepRequests, fileLoading, fileLoadingCount, mainAgentSessions } = this.renderPrepare();
    const prefs = this._prefValues();
    // 「仅展示当前会话」锁定：切到「以 pin 会话结尾」（与 App 同口径，见 _displaySessionsFor）。
    const { sessions: displaySessions, upperBoundTs: sessionUpperBoundTs } = this._displaySessionsFor(mainAgentSessions);

    // 工作区选择器模式
    if (this.state.workspaceMode) {
      return this.renderWorkspaceMode();
    }

    const mobileIsLocalLog = !!this._isLocalLog;
    let mobileModelName = null;
    for (let i = filteredRequests.length - 1; i >= 0; i--) {
      const effective = getEffectiveModel(filteredRequests[i]);
      if (isMainAgent(filteredRequests[i]) && effective) { mobileModelName = effective; break; }
    }

    // contextPercent 计算抽到 render 顶部：header 血条 + 抽屉里的 CachePopoverContent 都要用同一份。
    // 与原 IIFE 同语义；side effect（_lastContextPercent 更新）也搬上来一次性做完。
    // 反向找最后一条带 usage 的 MainAgent 一次，contextPercent 与 mobileContextTokens 共用
    // （以前 mobileContextTokens 单独扫 + fallback 分支再扫，是 2*O(N)）
    let mobileContextPercent = 0;
    let mobileContextTokens = 0;
    if (!mobileIsLocalLog) {
      const contextWindow = this.state.contextWindow;
      let lastMainAgent = null;
      let mobileInputTokens = 0; // 输入侧(不含 output),仅供自适应纠偏判定
      if (filteredRequests.length > 0) {
        for (let i = filteredRequests.length - 1; i >= 0; i--) {
          if (isMainAgent(filteredRequests[i]) && filteredRequests[i].response?.body?.usage) {
            lastMainAgent = filteredRequests[i];
            const u = lastMainAgent.response.body.usage;
            // 原始占用比口径(对齐 /context):分子含末轮 output,与桌面端 AppHeader 同源
            mobileContextTokens = sumUsageContextTokens(u);
            mobileInputTokens = sumUsageInputTokens(u);
            break;
          }
        }
      }
      // Calibration + percent math shared with the desktop header via
      // utils/helpers.computeContextPercent — mobile now honors the user's
      // calibration choice and rescales the server's used_percentage the same
      // way AppHeader does (it previously trusted used_percentage raw).
      mobileContextPercent = computeContextPercent({
        calibrationModel: this.state.calibrationModel,
        lastMainAgent,
        projectModelHint: this.state.claudeProjectModel,
        contextWindow,
        lastTotalTokens: mobileContextTokens,
        lastInputTokens: mobileInputTokens,
      });
      // /clear 后 contextBarLocked 强制血条 0K (0%)，直到用户发出非 /clear 消息（详见 AppBase）。
      if (this.state.contextBarLocked) {
        this._lastContextPercent = 0;
        mobileContextPercent = 0;
        mobileContextTokens = 0;
      } else {
        if (mobileContextPercent === 0 && this._lastContextPercent > 0) mobileContextPercent = this._lastContextPercent;
        else this._lastContextPercent = mobileContextPercent;
        if (this.state.contextBarOptimistic) mobileContextPercent = OPTIMISTIC_CLEAR_PERCENT;
      }
    }

    // 单条 /ws/terminal 的开启条件:与 App 同款,回退到「非本地日志 + 非 SDK 模式都连」,
    // 修 mobile 隐藏终端时 ChatView 的 hook bridge / PTY 提交失败回归(参看 App.jsx:305 注释)。
    const wsOpen = !mobileIsLocalLog && !this.state.sdkMode;

    return (
      <TerminalWsProvider open={wsOpen}>
      <ApprovalModal
        enabled={isPad && this.state.approvalPrefs.modalEnabled}
        soundEnabled={this.state.approvalPrefs.soundEnabled}
        voicePackPrefs={this.state.approvalPrefs.voicePack}
        approvalGlobal={this.state.approvalGlobal}
        dismissedIds={this.state.approvalDismissedIds}
        onDismiss={this.handleApprovalDismiss}
        onJumpTab={this.handleApprovalJumpTab}
        otherTabs={this.state.approvalOtherTabs}
      >
      <ConfigProvider theme={this.themeConfig}>
      <div className={styles.mobileCLIRoot} ref={this._layoutRef} onDragOver={this._onDragOver} onDragLeave={this._onDragLeave} onDrop={this._onDrop}>
        {this.state.isDragging && (
          <div className={styles.dragOverlay}>
            <div className={styles.dragOverlayContent}>
              <UploadOutlined className={styles.dragIcon} />
              <p>{t('ui.dragDropHint')}</p>
            </div>
          </div>
        )}
        <div className={styles.mobileCLIHeader}>
          <div className={styles.mobileCLIHeaderLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => this.setState(prev => ({ mobileMenuVisible: !prev.mobileMenuVisible }))}
              aria-label={t('ui.mobileMenu')}
              aria-expanded={this.state.mobileMenuVisible}
              aria-haspopup="menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {!mobileIsLocalLog ? (() => {
              // 移动端（含 iPad）：渲染与 PC 一致的上下文血条。contextPercent 已在 render 顶部计算。
              const contextPercent = mobileContextPercent;
              const ctxColor = contextSeverityColor(contextPercent);
              const ctxLabel = `${t('ui.liveMonitoring')}${this.state.projectName ? `: ${this.state.projectName}` : ''}`;
              // ctxLabel is also used in `title` (PC hover tooltip). Alias is
              // only rendered in the VISIBLE content via MobileCtxLabelText
              // (using useProjectAlias for cross-tab reactivity); the tooltip
              // can stay alias-less since mobile has no hover anyway.
              // 血条本体——iPad 与手机一致，作为按钮触发左侧抽屉（mobileCachePanelOverlay）。
              // mobileCachePanelVisible=true 时才 mount CachePopoverContent，维持 commit 0914cc5
              // 的"打开才解析 200 条"性能修复。
              const ctxTag = (
                <span
                  className={styles.mobileCtxTag}
                  style={{ borderColor: ctxColor, color: ctxColor, cursor: 'pointer' }}
                  title={ctxLabel}
                  role="button"
                  tabIndex={0}
                  aria-label={t('ui.openCachePanel')}
                  onClick={() => this.setState(prev => ({
                    ...this._closeAllMobileOverlays(),
                    mobileCachePanelVisible: !prev.mobileCachePanelVisible,
                  }), () => this._onCachePanelOpenChange(this.state.mobileCachePanelVisible))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      this.setState(prev => ({
                        ...this._closeAllMobileOverlays(),
                        mobileCachePanelVisible: !prev.mobileCachePanelVisible,
                      }), () => this._onCachePanelOpenChange(this.state.mobileCachePanelVisible));
                    }
                  }}
                >
                  <span className={styles.mobileCtxTagFill} style={{ width: `${contextPercent}%`, backgroundColor: ctxColor }} />
                  <span className={styles.mobileCtxTagContent}>
                    <MobileCtxLabelText projectName={this.state.projectName} />
                  </span>
                </span>
              );
              return ctxTag;
            })() : (
              <>
                <Badge status="processing" color="green" />
                <span className={styles.mobileCLIStatusLabel}>{t('ui.historyLog', { file: this._localLogFile })}</span>
              </>
            )}
          </div>
          <div className={styles.mobileCLIHeaderRight}>
            {mobileIsLocalLog ? (
              <Button
                type="text"
                size="small"
                icon={<RollbackOutlined />}
                onClick={() => history.back()}
                className={styles.mobileNavBtn}
              >
                {t('ui.mobileGoBack')}
              </Button>
            ) : this.state.hasGit ? (
              <Button
                type="text"
                size="small"
                icon={<BranchesOutlined />}
                onClick={() => this.setState(prev => ({ ...this._closeAllMobileOverlays(), mobileGitDiffVisible: !prev.mobileGitDiffVisible }))}
                style={{ color: this.state.mobileGitDiffVisible ? 'var(--color-primary)' : 'var(--text-tertiary)', fontSize: 12 }}
              >
                {this.state.mobileGitDiffVisible ? t('ui.mobileGitDiffExit') : t('ui.mobileGitDiffBrowse')}
              </Button>
            ) : null}
            {!mobileIsLocalLog && (
              <Button
                type="text"
                size="small"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>}
                onClick={() => this.setState(prev => ({ ...this._closeAllMobileOverlays(), mobileTerminalVisible: !prev.mobileTerminalVisible }))}
                style={{ color: this.state.mobileTerminalVisible ? 'var(--color-primary)' : 'var(--text-tertiary)', fontSize: 12 }}
              >
                {this.state.mobileTerminalVisible ? t('ui.mobileTerminalExit') : t('ui.mobileTerminalBrowse')}
              </Button>
            )}
          </div>
          {this.state.mobileMenuVisible && (
            <>
              <div className={styles.mobileMenuOverlay} onClick={() => this.setState({ mobileMenuVisible: false })} />
              <div className={styles.mobileMenuDropdown}>
                {/* 1. 项目文件夹 (mobile 独有, 置顶, 仅在非 local-log 模式可见) */}
                {!mobileIsLocalLog && (
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), mobileFileExplorerVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {t('ui.projectFolder')}
                </button>
                )}
                {/* 2. 日志管理 — 对应 PC 「日志管理工具」 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), mobileLogMgmtVisible: true }); this.handleImportLocalLogs(); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  {t('ui.logManagement')}
                </button>
                {/* 3. 用户 Prompt — 对应 PC 「查看用户 Prompt」 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), mobilePromptVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="12" y1="12" x2="9" y2="15" />
                    <line x1="12" y1="12" x2="15" y2="15" />
                  </svg>
                  {t('ui.userPrompt')}
                </button>
                {/* 4. 插件管理 — 与 PC AppHeader.jsx:1342 同 i18n key */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), pluginModalVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="6" rx="1" />
                    <rect x="2" y="9" width="6" height="6" rx="1" />
                    <rect x="16" y="9" width="6" height="6" rx="1" />
                    <rect x="9" y="16" width="6" height="6" rx="1" />
                  </svg>
                  {t('ui.pluginManagement')}
                </button>
                {/* 5. CCV 进程管理 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), processModalVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4" />
                    <path d="M12 18v4" />
                    <path d="m4.93 4.93 2.83 2.83" />
                    <path d="m16.24 16.24 2.83 2.83" />
                    <path d="M2 12h4" />
                    <path d="M18 12h4" />
                    <path d="m4.93 19.07 2.83-2.83" />
                    <path d="m16.24 7.76 2.83-2.83" />
                  </svg>
                  {t('ui.processManagement')}
                </button>
                {/* 6. 代理热切换 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), proxyModalVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                  {t('ui.proxySwitch')}
                </button>
                {/* 7-8 块前的 divider — 与 PC 「代理热切换」与「项目统计」之间分隔线一致 */}
                <div className={styles.mobileMenuDivider} />
                {/* 7. 数据统计 — 对应 PC 「项目统计」 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), mobileStatsVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  {t('ui.tokenStats')}
                </button>
                {/* 8. 偏好设置 — mobile 独有 drawer (mobileSettingsVisible),不引入 PC 的 viewMode 条件 */}
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ ...this._closeAllMobileOverlays(), mobileSettingsVisible: true }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t('ui.settings')}
                </button>
              </div>
            </>
          )}
        </div>
        <div className={styles.mobileCLIBody}>
          {!mobileIsLocalLog && (
            <>
              {fileLoading && (
                <div className={styles.mobileLoadingOverlay}>
                  <div className={styles.mobileLoadingSpinner} />
                  <div className={styles.mobileLoadingLabel}>{t('ui.loadingChat')} {this._loadingProgressText()}</div>
                </div>
              )}
                <div className={styles.mobileChatInner}>
                  <ChatView
                    {...this._settingsProps()}
                    requests={deepRequests}
                    mainAgentSessions={displaySessions}
                    sessionUpperBoundTs={sessionUpperBoundTs}
                    streamingLatest={this.state.streamingLatest}
                    userProfile={this.state.userProfile}
                    collapseToolResults={prefs.collapseToolResults}
                    expandThinking={prefs.expandThinking}
                    showFullToolContent={prefs.showFullToolContent}
                    onlyCurrentSession={!mobileIsLocalLog}
                    isLocalLog={mobileIsLocalLog}
                    showThinkingSummaries={prefs.showThinkingSummaries}
                    onViewRequest={null}
                    scrollToTimestamp={null}
                    onScrollTsDone={() => {}}
                    cliMode={this.state.cliMode}
                    sdkMode={this.state.sdkMode}
                    terminalVisible={this.state.mobileTerminalVisible}
                    mobileChatVisible={true}
                    fileLoading={this.state.fileLoading}
                    isStreaming={this.state.isStreaming}
                    onPendingPermission={this.handlePendingPermission}
                    onPendingPlanApproval={this.handlePendingPlanApproval}
                    onPendingAsk={this.handleApprovalAsk}
                    onPendingPtyPlan={this.handleApprovalPtyPlan}
                    autoApproveSeconds={this.state.autoApproveSeconds}
                    onAutoApproveChange={this.handleAutoApproveChange}
                    planAutoApproveSeconds={this.state.approvalPrefs?.planAutoApproveSeconds}
                    onPlanAutoApproveChange={this.handlePlanAutoApproveChange}
                    ownTabId={this.state.ownTabId}
                    projectName={this.state.projectName}
                    suppressInlineApprovalPanels={true}
                    pendingUploadPaths={this.state.pendingUploadPaths}
                    onUploadPathsConsumed={this.handleUploadPathsConsumed}
                    uploadingDrop={this.state.uploadingDrop}
                    onMobileOpenFile={this._handleMobileOpenFile}
                    onClearContextOptimistic={this.handleClearContextOptimistic}
                    onUserMessageSent={this.handleUserMessageSent}
                  />
                </div>
            </>
          )}
          {!mobileIsLocalLog && (
            <div className={`${styles.mobileChatOverlay} ${this.state.mobileTerminalVisible ? styles.mobileChatOverlayVisible : ''}`}>
              <TerminalPanel
                {...this._settingsProps()}
                modelName={mobileModelName}
                onFilePath={this._handleTerminalFilePath}
                pendingImages={this.state.terminalPendingImages}
                onRemovePendingImage={this._handleRemoveTerminalImage}
                onClearPendingImages={this._handleClearTerminalImages}
                onClearContextOptimistic={this.handleClearContextOptimistic}
                autoApproveSeconds={this.state.autoApproveSeconds}
                onAutoApproveChange={this.handleAutoApproveChange}
                planAutoApproveSeconds={this.state.approvalPrefs?.planAutoApproveSeconds}
                onPlanAutoApproveChange={this.handlePlanAutoApproveChange}
              />
            </div>
          )}
          <div className={`${styles.mobileGitDiffOverlay} ${this.state.mobileGitDiffVisible ? styles.mobileGitDiffOverlayVisible : ''}`}>
            <div className={styles.mobileGitDiffInner}>
              <MobileGitDiff visible={this.state.mobileGitDiffVisible} onClose={() => this.setState({ mobileGitDiffVisible: false })} />
            </div>
          </div>
          {/* 移动端（含 iPad）血条点击 → 从左侧划出的 cache popover 抽屉。
              内层 zoom 0.6 在 :global(html.pad-mode) 下被覆写为 1（见 App.module.css）。
              visible 时才 mount CachePopoverContent 以保留懒加载语义；关闭按钮放标题行右侧。 */}
          <div className={`${styles.mobileCachePanelOverlay} ${this.state.mobileCachePanelVisible ? styles.mobileCachePanelOverlayVisible : ''}`}>
            <div className={styles.mobileCachePanelInner}>
              <div className={styles.mobileCachePanelHeader}>
                <span className={styles.mobileCachePanelTitle}>{t('ui.contextManagement')}</span>
                <button
                  className={styles.mobileCachePanelClose}
                  onClick={() => this.setState({ mobileCachePanelVisible: false }, () => this._onCachePanelOpenChange(false))}
                  aria-label={t('ui.closeCachePanel')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className={styles.mobileCachePanelBody}>
                {this.state.mobileCachePanelVisible && (
                  <CachePopoverContent
                    inDrawer
                    requests={deepRequests}
                    serverCachedContent={this.state.serverCachedContent}
                    contextPercent={mobileContextPercent}
                    contextTokens={mobileContextTokens}
                    fsSkills={this.state._fsSkills}
                    onSkillImported={this.reloadFsSkills}
                    onOpenSkillsModal={this.handleOpenSkillsModal}
                    memory={this.state._memory}
                    memoryRefreshing={this.state._memoryRefreshing}
                    claudeMd={this.state._claudeMd}
                    calibrationModel={this.state.calibrationModel}
                    onCalibrationModelChange={this.handleCalibrationModelChange}
                    onOpenMemoryDetail={this.loadMemoryDetail}
                    onOpenClaudeMd={this.loadClaudeMdDetail}
                    onRefreshMemory={this.handleRefreshMemory}
                  />
                )}
              </div>
            </div>
          </div>
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
          <SkillsManagerModal
            open={this.state._skillsModal?.open || false}
            loading={this.state._skillsModal?.loading || false}
            error={this.state._skillsModal?.error || null}
            skills={this.state._skillsModal?.skills || []}
            toggling={this.state._skillsModal?.toggling}
            onToggle={(s) => this.handleToggleSkill(s)}
            onDelete={(s) => this.handleDeleteSkill(s)}
            onClose={() => this.setState(prev => ({ _skillsModal: { ...prev._skillsModal, open: false } }))}
          />
          <ProjectPrefsManagerModal
            open={this.state.projectPrefsModalOpen}
            onClose={() => this.setState({ projectPrefsModalOpen: false })}
            onChanged={this.refreshAllPrefs}
          />
          {/* PC 端对齐的 3 个 modal —— 与 AppHeader 共用同款 self-contained 组件。
              proxyProfiles / activeProxyId / defaultConfig / handleProxyProfileChange 由 AppBase 持有,
              Mobile 继承直接读到。 */}
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
            proxyProfiles={this.state.proxyProfiles}
            activeProxyId={this.state.activeProxyId}
            defaultConfig={this.state.defaultConfig}
            proxyRoles={this.state.proxyRoles}
            proxyOfficialDefault={this.state.proxyOfficialDefault}
            onProxyProfileChange={this.handleProxyProfileChange}
          />
          <div className={`${styles.mobileFileExplorerOverlay} ${this.state.mobileFileExplorerVisible ? styles.mobileFileExplorerOverlayVisible : ''}`}>
            <div className={styles.mobileFileExplorerInner}>
              <MobileFileExplorer visible={this.state.mobileFileExplorerVisible} onClose={() => this.setState({ mobileFileExplorerVisible: false, mobileFileExplorerTarget: null })} targetFile={this.state.mobileFileExplorerTarget} projectName={this.state.projectName} />
            </div>
          </div>
          <div className={`${styles.mobileStatsOverlay} ${this.state.mobileStatsVisible ? styles.mobileStatsOverlayVisible : ''}`}>
            <div className={styles.mobileStatsInner}>
              <MobileStats
                requests={deepRequests}
                visible={this.state.mobileStatsVisible}
                onClose={() => this.setState({ mobileStatsVisible: false })}
              />
            </div>
          </div>
          <div className={`${styles.mobileLogMgmtOverlay} ${this.state.mobileLogMgmtVisible ? styles.mobileLogMgmtOverlayVisible : ''}`}>
            <div className={styles.mobileLogMgmtHeader}>
              <span className={styles.mobileLogMgmtTitle}><OpenFolderIcon apiEndpoint={apiUrl('/api/open-log-dir')} title={t('ui.openLogDir')} size={14} />{t('ui.importLocalLogs')}</span>
              <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobileLogMgmtVisible: false, selectedLogs: new Set() })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.mobileLogMgmtActions}>
              <Button
                size="small"
                icon={<DeleteOutlined />}
                disabled={this.state.selectedLogs.size === 0}
                onClick={this.handleDeleteLogs}
                style={this.state.selectedLogs.size === 0 ? { color: 'var(--text-muted)', borderColor: 'var(--border-light)' } : { color: 'var(--color-error-light)', borderColor: 'var(--color-error-light)' }}
              >
                {t('ui.deleteLogs')}
              </Button>
              <Button
                size="small"
                icon={<ReloadOutlined spin={this.state.refreshingStats} />}
                loading={this.state.refreshingStats}
                onClick={this.handleRefreshStats}
              >
                {t('ui.refreshStats')}
              </Button>
            </div>
            <div className={styles.mobileLogMgmtBody}>
              {this.state.localLogsLoading ? (
                <div className={styles.spinCenter}><Spin /></div>
              ) : (() => {
                // v2 view: localLogs is the current page (flat array, server-paginated).
                const currentLogs = this.state.localLogs;
                if (!currentLogs || currentLogs.length === 0) {
                  return (
                    <div className={styles.emptyCenter}>
                      {t('ui.noLogs')}
                    </div>
                  );
                }
                return (
                  <div className={styles.logListContainer}>
                    {this.renderLogTable(currentLogs, true)}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={`${styles.mobileSettingsOverlay} ${this.state.mobileSettingsVisible ? styles.mobileSettingsOverlayVisible : ''}`}>
            <div className={styles.mobileLogMgmtHeader}>
              <span className={styles.mobileLogMgmtTitle}>{t('ui.settings')}</span>
              <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobileSettingsVisible: false })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.mobileSettingsBody}>
              <div className={styles.mobileSettingsGroup}>
                <div className={styles.mobileSettingsSectionTitle}>{t('ui.chatDisplay')}</div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.permission.autoApprove.setting')}</span>
                  <Select
                    size="small"
                    value={this.state.autoApproveSeconds || 0}
                    onChange={this.handleAutoApproveChange}
                    options={autoApproveSelectOptions(PERM_AUTO_APPROVE_OPTIONS, t)}
                    style={{ width: 100 }}
                  />
                </div>
                {this.state.approvalPrefs && (
                  <div className={styles.mobileSettingsRow}>
                    <span className={styles.mobileSettingsLabel}>
                      {t('ui.approval.settings.planAutoApprove')}
                      <Tooltip title={t('ui.approval.settings.planAutoApproveHelp')} trigger="click">
                        <QuestionCircleOutlined className={styles.mobileSettingsHelpIcon} />
                      </Tooltip>
                    </span>
                    <Select
                      size="small"
                      value={this.state.approvalPrefs.planAutoApproveSeconds || 0}
                      onChange={(value) => this.handleApprovalPrefsChange({ planAutoApproveSeconds: value })}
                      options={autoApproveSelectOptions(PLAN_AUTO_APPROVE_OPTIONS, t)}
                      style={{ width: 100 }}
                    />
                  </div>
                )}
                {isPad && this.state.approvalPrefs && (
                  <>
                    <div className={styles.mobileSettingsRow}>
                      <span className={styles.mobileSettingsLabel}>{t('ui.approval.settings.modalEnabled')}</span>
                      <Switch
                        checked={this.state.approvalPrefs.modalEnabled !== false}
                        onChange={(checked) => this.handleApprovalPrefsChange({ modalEnabled: checked })}
                      />
                    </div>
                    {/* notifyOnlyWhenHidden 依赖 electron main 进程的 OS Notification + 窗口聚焦判断,
                        纯 web 模式下 main.js 路径不存在,开关无效果 → 仅 electron 启动模式显示。 */}
                    {typeof window !== 'undefined' && window.tabBridge && (
                      <div className={styles.mobileSettingsRow}>
                        <span className={styles.mobileSettingsLabel}>{t('ui.approval.settings.notifyOnlyWhenHidden')}</span>
                        <Switch
                          checked={this.state.approvalPrefs.notifyOnlyWhenHidden !== false}
                          onChange={(checked) => this.handleApprovalPrefsChange({ notifyOnlyWhenHidden: checked })}
                        />
                      </div>
                    )}
                  </>
                )}
                {/* 「审批提示音」合并开关 — 暴露给 phone + iPad（phone 也需要 plan/ask/turnEnd 音频提示）。
                    OFF 时下方 VoicePackSettings 整组隐藏。 */}
                {this.state.approvalPrefs && (
                  <div className={styles.mobileSettingsRow}>
                    <span className={styles.mobileSettingsLabel}>{t('ui.approval.settings.soundEnabled')}</span>
                    <Switch
                      checked={!!this.state.approvalPrefs.soundEnabled}
                      onChange={(checked) => this.handleApprovalSoundToggle(checked)}
                    />
                  </div>
                )}
                {this.state.approvalPrefs && this.state.approvalPrefs.soundEnabled && (
                  <VoicePackSettings
                    prefs={this.state.approvalPrefs.voicePack}
                    onChange={this.handleVoicePackChange}
                    embedded
                  />
                )}
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.expandThinking')}</span>
                  <Switch
                    checked={prefs.expandThinking}
                    onChange={this.handleExpandThinkingChange}
                  />
                </div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.showFullToolContent')}</span>
                  <Switch
                    checked={prefs.showFullToolContent}
                    onChange={this.handleShowFullToolContentChange}
                  />
                </div>
                {prefs.showFullToolContent && (
                  <div className={styles.mobileSettingsRow}>
                    <span className={styles.mobileSettingsLabel}>{t('ui.collapseToolResults')}</span>
                    <Switch
                      checked={prefs.collapseToolResults}
                      onChange={this.handleCollapseToolResultsChange}
                    />
                  </div>
                )}
              </div>
              <div className={styles.mobileSettingsGroup}>
                <div className={styles.mobileSettingsSectionTitle}>{t('ui.themeStyle')}</div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.themeColor')}</span>
                  <Select
                    size="small"
                    value={this.state.themeColor || 'light'}
                    onChange={this.handleThemeColorChange}
                    options={[
                      { label: t('ui.themeColor.dark'), value: 'dark' },
                      { label: t('ui.themeColor.light'), value: 'light' },
                    ]}
                    style={{ width: 140 }}
                  />
                </div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.languageSettings')}</span>
                  <Select
                    size="small"
                    value={getLang()}
                    onChange={(value) => {
                      setLang(value);
                      this.handleLangChange();
                    }}
                    options={LANG_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
                    style={{ width: 140 }}
                  />
                </div>
              </div>
              {/* 项目独立配置：非本机(LAN)+有真实项目 → 开关；本机+有其他项目独立配置 → 管理入口（详见 AppHeader 抽屉同款逻辑） */}
              {(() => {
                const pp = (this.context && this.context.preferences) || {};
                const showToggle = !this._isLocalLog && !!pp._projectName && pp._isLocal === false;
                const forkKeys = Array.isArray(pp._projectPrefsKeys) ? pp._projectPrefsKeys : [];
                const showManage = pp._isLocal === true && forkKeys.length > 0;
                if (!showToggle && !showManage) return null;
                return (
                  <div className={styles.mobileSettingsGroup}>
                    <div className={styles.mobileSettingsSectionTitle}>{t('ui.projectScopedPrefs.group')}</div>
                    {showToggle && (
                      <div className={styles.mobileSettingsRow}>
                        <span className={styles.mobileSettingsLabel}>
                          {t('ui.projectScopedPrefs')}
                          <Tooltip title={t('ui.projectScopedPrefs.help')}>
                            <QuestionCircleOutlined className={styles.mobileSettingsHelpIcon} />
                          </Tooltip>
                        </span>
                        <Switch
                          aria-label={t('ui.projectScopedPrefs')}
                          checked={!!pp._projectScoped}
                          onChange={(checked) => this.handleToggleProjectScoped(checked)}
                        />
                      </div>
                    )}
                    {showManage && (
                      <div className={styles.mobileSettingsRow}>
                        <span className={styles.mobileSettingsLabel}>{t('ui.projectPrefsManage')}</span>
                        <Button size="small" onClick={() => this.setState({ projectPrefsModalOpen: true })}>
                          {t('ui.projectPrefsManage.open', { count: forkKeys.length })}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className={`${styles.mobilePromptOverlay} ${this.state.mobilePromptVisible ? styles.mobilePromptOverlayVisible : ''}`}>
            <div className={styles.mobileLogMgmtHeader}>
              <span className={styles.mobileLogMgmtTitle}>{t('ui.userPrompt')}</span>
              <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobilePromptVisible: false })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.mobilePromptBody}>
              {(() => {
                const prompts = this.extractUserPrompts(filteredRequests);
                if (prompts.length === 0) {
                  return (
                    <div className={styles.mobilePromptEmpty}>
                      {t('ui.noPrompt')}
                    </div>
                  );
                }
                return (
                  <>
                    <div className={styles.mobilePromptHeader}>
                      <span className={styles.mobilePromptCount}>
                        {prompts.length} {t('ui.promptCountUnit')}
                      </span>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => this.handleExportPromptsTxt(prompts)}
                      >
                        {t('ui.exportPromptsTxt')}
                      </Button>
                    </div>
                    <div className={styles.mobilePromptList}>
                      {prompts.map((p, i) => (
                        <div key={i} className={styles.mobilePromptItem}>
                          {p.timestamp && (
                            <div className={styles.mobilePromptTimestamp}>
                              {new Date(p.timestamp).toLocaleString()}
                            </div>
                          )}
                          {this.renderOriginalPrompt(p)}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        {/* 全局权限审批浮层 — 在 mobileCLIBody 之外渲染，避免 transform 影响 position: fixed */}
        {this.state.globalPermission && (
          <ToolApprovalPanel
            toolName={this.state.globalPermission.permission.toolName}
            toolInput={this.state.globalPermission.permission.input}
            requestId={this.state.globalPermission.permission.id}
            onAllow={this.state.globalPermission.handlers.allow}
            onAllowSession={this.state.globalPermission.handlers.allowSession}
            onDeny={this.state.globalPermission.handlers.deny}
            visible={true}
            global={true}
            autoApproveSeconds={this.state.autoApproveSeconds}
            onAutoApproveChange={this.handleAutoApproveChange}
          />
        )}
        {this.state.globalPlanApproval && (
          <ToolApprovalPanel
            toolName="ExitPlanMode"
            toolInput={this.state.globalPlanApproval.plan.input}
            requestId={this.state.globalPlanApproval.plan.id}
            onAllow={this.state.globalPlanApproval.handlers.approve}
            onDeny={(id) => this.state.globalPlanApproval.handlers.reject(id, '')}
            visible={true}
            global={true}
          />
        )}
      </div>
      </ConfigProvider>
      </ApprovalModal>
      </TerminalWsProvider>
    );
  }
}

export default Mobile;
