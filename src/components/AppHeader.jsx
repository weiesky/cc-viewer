import React from 'react';
import { Space, Tag, Button, Dropdown, Popover, Modal, Collapse, Drawer, Switch, Radio, Tabs, Spin, Input, Table, Select, Tooltip, Alert, message } from 'antd';
import { MessageOutlined, FileTextOutlined, ImportOutlined, DashboardOutlined, ExportOutlined, DownloadOutlined, SettingOutlined, BarChartOutlined, CodeOutlined, CopyOutlined, ApiOutlined, DeleteOutlined, ReloadOutlined, PlusOutlined, CloudDownloadOutlined, SwapOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { QRCodeCanvas } from 'qrcode.react';
import { formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats, getModelMaxTokens, getEffectiveModel, extractCachedContent, parseCachedTools, extractLoadedSkills } from '../utils/helpers';
import { BUILTIN_SKILL_NAMES, mergeActiveSkills } from '../utils/skillsParser';
import { isSystemText, classifyUserContent, isMainAgent } from '../utils/contentFilter';
import { classifyRequest } from '../utils/requestType';
import { resolveTeammateNames } from '../utils/contentFilter';
import { t, getLang, setLang } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import ConceptHelp from './ConceptHelp';
import OpenFolderIcon from './OpenFolderIcon';
import appConfig from '../config.json';
const CALIBRATION_MODELS = appConfig.calibrationModels;
import styles from './AppHeader.module.css';

const LANG_OPTIONS = [
  { value: 'zh', short: 'zh', label: '简体中文' },
  { value: 'en', short: 'en', label: 'English' },
  { value: 'zh-TW', short: 'zh-TW', label: '繁體中文' },
  { value: 'ko', short: 'ko', label: '한국어' },
  { value: 'ja', short: 'ja', label: '日本語' },
  { value: 'de', short: 'de', label: 'Deutsch' },
  { value: 'es', short: 'es', label: 'Español' },
  { value: 'fr', short: 'fr', label: 'Français' },
  { value: 'it', short: 'it', label: 'Italiano' },
  { value: 'da', short: 'da', label: 'Dansk' },
  { value: 'pl', short: 'pl', label: 'Polski' },
  { value: 'ru', short: 'ru', label: 'Русский' },
  { value: 'ar', short: 'ar', label: 'العربية' },
  { value: 'no', short: 'no', label: 'Norsk' },
  { value: 'pt-BR', short: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'th', short: 'th', label: 'ไทย' },
  { value: 'tr', short: 'tr', label: 'Türkçe' },
  { value: 'uk', short: 'uk', label: 'Українська' },
];


// countryToFlag 已随地理位置控件一起迁到 src/components/CountryFlag.jsx

class AppHeader extends React.Component {
  constructor(props) {
    super(props);
    this.state = { countdownText: '', promptModalVisible: false, promptData: [], promptViewMode: 'original', settingsDrawerVisible: false, globalSettingsVisible: false, projectStatsVisible: false, projectStats: null, projectStatsLoading: false, localUrl: '', pluginModalVisible: false, pluginsList: [], pluginsDir: '', deleteConfirmVisible: false, deleteTarget: null, processModalVisible: false, processList: [], processLoading: false, logoDropdownOpen: false, cacheHighlightIdx: null, cacheHighlightFading: false, cdnModalVisible: false, cdnUrl: '', cdnLoading: false, calibrationModel: (v => CALIBRATION_MODELS.some(m => m.value === v) ? v : 'auto')(localStorage.getItem('ccv_calibrationModel') || 'auto'), proxyModalVisible: false, editingProxy: null, editForm: { name: '', baseURL: '', apiKey: '', models: '', activeModel: '' }, logDirDraft: null, _skillsModal: { open: false, loading: false, skills: [], error: null, toggling: new Set() },
      // 文件系统权威的 skill 列表（/api/skills 返回）；live-tail 下作为 popover chip 和管理弹窗的共享数据源。
      // null=未加载 / false=失败 / [] 或 Array=加载结果。workspace 切换由 componentDidUpdate + seq 控制。
      _fsSkills: null };
    this._countdownTimer = null;
    this._expiredTimer = null;
    this._fsSkillsSeq = 0;
    this.updateCountdown = this.updateCountdown.bind(this);
  }

  componentDidMount() {
    this.startCountdown();
    fetch(apiUrl('/api/local-url')).then(r => r.json()).then(data => {
      if (data.url) this.setState({ localUrl: data.url });
    }).catch(() => {});
    fetch(apiUrl('/api/claude-settings')).then(r => r.json()).then(data => {
      if (data.model) this.setState({ settingsModel: data.model });
    }).catch(() => {});
    // 预热：live-tail 下提前拉一次文件系统 skill，首次打开 popover 就是权威视图而非闪一下历史。
    if (!this.props.isLocalLog) this.reloadFsSkills();
    // ipinfo.io 请求已移到 CountryFlag 组件里
  }

  componentDidUpdate(prevProps) {
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
    }
  }

  // 返回 { ok: true, skills } / { ok: false, reason: 'http:NNN' | 'network' | 'local_log' | 'stale' | <server msg> }。
  // caller 应用返回值做下一步决策（setState 异步；await 后 this.state 可能还没 flush）。
  // 失败时若已有过成功结果（_fsSkills 是数组）→ 保留不 clobber，避免 popover chip 从乐观态回退到历史态。
  reloadFsSkills = async () => {
    if (this.props.isLocalLog) return { ok: false, reason: 'local_log' };
    const seq = ++this._fsSkillsSeq;
    try {
      const r = await fetch(apiUrl('/api/skills'));
      const data = await r.json();
      if (seq !== this._fsSkillsSeq) return { ok: false, reason: 'stale' };
      if (!r.ok || !data.ok || !Array.isArray(data.skills)) {
        const reason = (data && data.error) || `http:${r.status}`;
        this.setState(prev => ({ _fsSkills: Array.isArray(prev._fsSkills) ? prev._fsSkills : false }));
        return { ok: false, reason };
      }
      this.setState({ _fsSkills: data.skills });
      return { ok: true, skills: data.skills };
    } catch (e) {
      if (seq === this._fsSkillsSeq) {
        this.setState(prev => ({ _fsSkills: Array.isArray(prev._fsSkills) ? prev._fsSkills : false }));
      }
      return { ok: false, reason: e.message || 'network' };
    }
  };

  // 把 reloadFsSkills 的 reason code 映射成用户可读文案。
  // 未知/服务端自带的文案（例如 data.error 原样透传）直接显示。
  getSkillsLoadErrorLabel(reason) {
    if (!reason || reason === 'stale' || reason === 'local_log') return '';
    const mHttp = /^http:(\d+)$/.exec(reason);
    if (mHttp) return t('ui.skillsLoadError.http', { status: mHttp[1] });
    if (reason === 'network') return t('ui.skillsLoadError.network');
    return reason;
  }

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
      nextProps.collapseToolResults !== this.props.collapseToolResults ||
      nextProps.expandThinking !== this.props.expandThinking ||
      nextProps.showFullToolContent !== this.props.showFullToolContent ||
      nextProps.expandDiff !== this.props.expandDiff ||
      nextProps.filterIrrelevant !== this.props.filterIrrelevant ||
      nextProps.logDir !== this.props.logDir ||
      nextProps.updateInfo !== this.props.updateInfo ||
      nextProps.cliMode !== this.props.cliMode ||
      nextProps.sdkMode !== this.props.sdkMode ||
      nextProps.terminalVisible !== this.props.terminalVisible ||
      nextProps.contextWindow !== this.props.contextWindow ||
      nextProps.serverCachedContent !== this.props.serverCachedContent ||
      nextProps.resumeAutoChoice !== this.props.resumeAutoChoice ||
      nextProps.themeColor !== this.props.themeColor ||
      nextProps.autoApproveSeconds !== this.props.autoApproveSeconds ||
      nextProps.proxyProfiles !== this.props.proxyProfiles ||
      nextProps.activeProxyId !== this.props.activeProxyId ||
      nextProps.defaultConfig !== this.props.defaultConfig ||
      nextState !== this.state
    );
  }

  componentWillUnmount() {
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (this._cacheFadeClearTimer) clearTimeout(this._cacheFadeClearTimer);
    if (this._cacheScrollSettleTimer) clearTimeout(this._cacheScrollSettleTimer);
    if (this._cacheAutoFadeTimer) clearTimeout(this._cacheAutoFadeTimer);
    if (this._cacheHighlightDelayTimer) clearTimeout(this._cacheHighlightDelayTimer);
    this._cacheUnbindScrollFade();
    // 让任何在途的 reloadFsSkills / fetch 回包 seq 校验失败 → 不会 setState 到已卸载组件。
    // React 18 下 setState-on-unmounted 本身是静默 no-op，但明确标记更稳妥。
    this._fsSkillsSeq++;
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
        const text = msg.content.trim();
        if (!text) continue;
        if (!isSystemText(text)) {
          if (/Implement the following plan:/i.test(text)) continue;
          userMsgs.push(text);
          fullTexts.push(text);
        }
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

  renderTokenStats() {
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
            <div key={model} className={models.length > 1 ? styles.modelCardSpaced : styles.modelCard}>
              <div className={styles.modelName}>
                {model}
              </div>
              <table className={styles.statsTable}>
                <tbody>
                  <tr>
                    <td className={styles.label}>Token</td>
                    <td className={styles.th}>input</td>
                    <td className={styles.th}>output</td>
                  </tr>
                  <tr className={styles.rowBorder}>
                    <td className={styles.label}></td>
                    <td className={styles.td}>{formatTokenCount(totalInput)}</td>
                    <td className={styles.td}>{formatTokenCount(s.output)}</td>
                  </tr>
                  <tr>
                    <td className={styles.label}>Cache</td>
                    <td className={styles.th}>create</td>
                    <td className={styles.th}>read</td>
                  </tr>
                  <tr className={styles.rowBorder}>
                    <td className={styles.label}></td>
                    <td className={styles.td}>{formatTokenCount(s.cacheCreation)}</td>
                    <td className={styles.td}>{formatTokenCount(s.cacheRead)}</td>
                  </tr>
                  <tr>
                    <td className={styles.label}>{t('ui.hitRate')}</td>
                    <td colSpan={2} className={styles.td}>{cacheHitRate}%</td>
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
        <div className={styles.modelCard}>
          <div className={styles.modelName}>{t('ui.toolUsageStats')}</div>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={`${styles.th} ${styles.thLeft}`}>Tool</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {toolStats.map(([name, count]) => (
                <tr key={name} className={styles.rowBorder}>
                  <td className={styles.label}>{name} <ConceptHelp doc={`Tool-${name}`} /></td>
                  <td className={styles.td}>{count}</td>
                </tr>
              ))}
              {toolStats.length > 1 && (
                <tr className={styles.rebuildTotalRow}>
                  <td className={styles.label}>Total</td>
                  <td className={styles.td}>{toolStats.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    ) : null;

    const skillColumn = skillStats.length > 0 ? (
      <div className={styles.toolStatsColumn}>
        <div className={styles.modelCard}>
          <div className={styles.modelName}>{t('ui.skillUsageStats')}</div>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={`${styles.th} ${styles.thLeft}`}>Skill</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {skillStats.map(([name, count]) => (
                <tr key={name} className={styles.rowBorder}>
                  <td className={styles.label}>{name}</td>
                  <td className={styles.td}>{count}</td>
                </tr>
              ))}
              {skillStats.length > 1 && (
                <tr className={styles.rebuildTotalRow}>
                  <td className={styles.label}>Total</td>
                  <td className={styles.td}>{skillStats.reduce((s, e) => s + e[1], 0)}</td>
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

  renderCacheContentPopover(contextPercent) {
    const { requests = [], serverCachedContent } = this.props;
    const cached = serverCachedContent || extractCachedContent(requests);

    // 记录最后一次有效的 token / ctx（原展示已移除，保留以便将来恢复）
    if (cached && (cached.cacheCreateTokens > 0 || cached.cacheReadTokens > 0)) {
      this._lastCachedTokens = { cacheCreateTokens: cached.cacheCreateTokens, cacheReadTokens: cached.cacheReadTokens };
    }
    if (contextPercent > 0) {
      this._lastContextPercent = contextPercent;
    }

    // 解析 tools 并缓存：tools 数组引用未变时复用上次解析结果，避免 200 条量级重复 split/regex。
    const toolsArr = Array.isArray(cached?.tools) ? cached.tools : null;
    let parsed;
    if (toolsArr === this._lastToolsRef && this._lastParsedTools) {
      parsed = this._lastParsedTools;
    } else {
      parsed = parseCachedTools(toolsArr);
      this._lastToolsRef = toolsArr;
      this._lastParsedTools = parsed;
    }
    const { builtin, mcpByServer } = parsed;
    const hasBuiltin = builtin.length > 0;
    const hasMcp = mcpByServer.size > 0;

    // skills 缓存：以「被选中的 MainAgent 请求引用」为 key（而非 requests 数组引用），
    // live-tail 追加新请求时，chosen 不变就不重扫。
    const chosenForSkills = (() => {
      if (!Array.isArray(requests) || requests.length === 0) return null;
      if (requests.length === 1) return requests[0];
      for (let i = requests.length - 1; i >= 0; i--) {
        const r = requests[i];
        if (r && r.type !== 'teammate' && r.type !== 'subAgent') return r;
      }
      return null;
    })();
    if (chosenForSkills !== this._lastChosenForSkills) {
      this._lastSkills = extractLoadedSkills(requests);
      this._lastChosenForSkills = chosenForSkills;
    }
    // Chip 数据源：优先走 /api/skills（文件系统权威，禁用立即生效；插件名带前缀符合 system-reminder 格式）。
    // `_fsSkills` 为 null / false（本地 log / fetch 失败）时，回退到历史 system-reminder 解析 —— 不回归旧行为。
    const historicalSkills = (this._lastSkills || []).filter(s => !BUILTIN_SKILL_NAMES.has(s.name));
    const mergedSkills = mergeActiveSkills(this.state._fsSkills, this._lastSkills || []);
    const skills = mergedSkills !== null ? mergedSkills : historicalSkills;
    const hasSkills = skills.length > 0;

    // 内置工具 chip：若有对应 Tool-<name>.md 文档（由 ConceptHelp 内部白名单校验），
    // 点击直接打开 md modal；无文档则退化为纯展示 chip（ConceptHelp children fallback）。
    // MCP 工具 chip：暂无对应文档，维持纯展示 + title hover 预览。
    const renderBuiltinChip = ({ name, description }) => {
      const title = [name, description].filter(Boolean).join('\n\n');
      const chip = <span className={styles.cacheToolChip} title={title}>{name}</span>;
      return <ConceptHelp key={name} doc={`Tool-${name}`}>{chip}</ConceptHelp>;
    };
    // MCP / Skill chip 改 hover 弹浮窗看 desc（原 click 弹 Modal 交互太重）。
    // Antd Popover 默认 trigger='hover' + mouseEnter/Leave delay；overlay maxWidth 480
    // 避免长描述拉爆视口；`.chipDetailBody` 复用原 Modal 样式（pre-wrap + maxHeight: 60vh 滚动）。
    const renderChipPopoverContent = (description) => (
      description
        ? <div className={styles.chipDetailBody}>{description}</div>
        : <div className={`${styles.chipDetailBody} ${styles.chipDetailEmpty}`}>{t('ui.noDescription')}</div>
    );
    const renderMcpChip = ({ name, fullName, description }) => (
      <Popover
        key={fullName}
        title={fullName}
        content={renderChipPopoverContent(description)}
        overlayStyle={{ maxWidth: 480 }}
        mouseEnterDelay={0.2}
      >
        <span className={styles.cacheToolChip}>{name}</span>
      </Popover>
    );
    const renderSkillChip = ({ name, description }) => (
      <Popover
        key={name}
        title={name}
        content={renderChipPopoverContent(description)}
        overlayStyle={{ maxWidth: 480 }}
        mouseEnterDelay={0.2}
      >
        <span className={styles.cacheToolChip}>{name}</span>
      </Popover>
    );

    const renderGroup = (sectionKey, titleKey, count, defaultCollapsed, body, rightAction = null) => {
      const state = (this.state._cacheSectionCollapsed || {})[sectionKey];
      const collapsed = state !== undefined ? !!state : defaultCollapsed;
      const toggle = () => this.setState(prev => ({
        _cacheSectionCollapsed: { ...(prev._cacheSectionCollapsed || {}), [sectionKey]: !collapsed },
      }));
      return (
        <div className={styles.cacheSection}>
          <div className={styles.cacheSectionHeader}>
            <button type="button" className={styles.cacheSectionTitle} onClick={toggle} aria-expanded={!collapsed}>
              <span className={styles.cacheSectionArrow}>{collapsed ? '▶' : '▼'}</span>
              {t(titleKey)} ({count})
            </button>
            {rightAction}
          </div>
          {!collapsed && body}
        </div>
      );
    };

    const builtinBody = (
      <div className={styles.toolChipGrid}>{builtin.map(renderBuiltinChip)}</div>
    );

    const mcpBody = (
      <div className={styles.toolChipGridVertical}>
        {Array.from(mcpByServer.entries()).map(([server, tools]) => (
          <div key={server} className={styles.mcpServerGroup}>
            <div className={styles.mcpServerName}>{server} ({tools.length})</div>
            <div className={styles.toolChipGrid}>{tools.map(renderMcpChip)}</div>
          </div>
        ))}
      </div>
    );

    const skillsBody = (
      <div className={styles.toolChipGrid}>{skills.map(renderSkillChip)}</div>
    );

    const skillsAction = (
      <Button
        type="primary"
        size="small"
        onClick={() => {
          // 打开 modal 同时关掉 popover（popover zIndex 1030 > Modal 1000 会盖住内容）
          this.handleOpenSkillsModal();
        }}
      >
        {t('ui.skillManage')}
      </Button>
    );

    const ctxColor = contextPercent >= 80 ? 'var(--color-error-light)' : contextPercent >= 60 ? 'var(--color-warning-light)' : 'var(--color-success)';
    return (
      <div className={styles.cachePopover}>
        <div className={styles.cachePopoverHeader}>
          <div className={styles.cachePopoverTitle}>
            <span className={styles.cachePercent} style={{ color: ctxColor }}>{contextPercent}%</span>
            <span className={styles.cacheCalibrationLabel}>{t('ui.calibrationModelLabel')}</span>
            <Select
              size="small"
              value={this.state.calibrationModel}
              onChange={this.handleCalibrationModelChange}
              options={CALIBRATION_MODELS}
              className={styles.calibrationSelect}
              popupMatchSelectWidth={false}
            />
          </div>
        </div>
        {(hasBuiltin || hasMcp || hasSkills) && (
          <div className={styles.cacheScrollArea}>
            {hasBuiltin && renderGroup('tools_builtin', 'ui.builtinTools', builtin.length, true, builtinBody)}
            {hasMcp && (
              // MCP 工具一进来就要看（常用且量不大），去掉折叠控件走静态标签 + 视觉分组框
              <div className={`${styles.cacheSection} ${styles.cacheSectionBordered}`}>
                <div className={styles.cacheSectionLabel}>
                  {t('ui.mcpTools')} ({Array.from(mcpByServer.values()).reduce((n, arr) => n + arr.length, 0)})
                </div>
                {mcpBody}
              </div>
            )}
            {hasSkills && (
              // 已载入 Skill 同样去折叠 + 加框；「管理」按钮放标题右侧（space-between + 蓝色 primary）。
              // skill 数量 >10 黄色提示"浪费 token 幻觉"、>20 红色提示"上下文污染"——插在 label 和 action 之间，
              // flex:1 填充中间空白。阈值只按展示 chip 数（已排除 builtin）来算，builtin 是系统自带不计。
              <div className={`${styles.cacheSection} ${styles.cacheSectionBordered}`}>
                <div className={styles.cacheSectionHeader}>
                  <div className={styles.cacheSectionLabel}>
                    {t('ui.loadedSkills')} ({skills.length})
                  </div>
                  {skills.length > 20 ? (
                    <Alert
                      type="error"
                      showIcon
                      banner
                      message={t('ui.skillsWarnPollution')}
                      style={{ marginRight: 'auto', padding: '2px 8px', fontSize: 11 }}
                    />
                  ) : skills.length > 10 ? (
                    <Alert
                      type="warning"
                      showIcon
                      banner
                      message={t('ui.skillsWarnOveruse')}
                      style={{ marginRight: 'auto', padding: '2px 8px', fontSize: 11 }}
                    />
                  ) : null}
                  {skillsAction}
                </div>
                {skillsBody}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

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
          <div className={(hasSubAgentStats || hasTeammateStats) ? styles.modelCardSpaced : styles.modelCard}>
            <div className={styles.modelName}>MainAgent<ConceptHelp doc="MainAgent" /> {t('ui.cacheRebuildStats')}<ConceptHelp doc="CacheRebuild" /></div>
            <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={`${styles.th} ${styles.thLeft}`}>{t('ui.cacheRebuild.reason')}</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
                <td className={styles.th}>{t('ui.cacheRebuild.cacheCreate')}</td>
              </tr>
            </thead>
            <tbody>
              {activeReasons.map(k => (
                <tr key={k} className={styles.rowBorder}>
                  <td className={styles.label}>{t(`ui.${i18nMap[k]}`)}</td>
                  <td className={styles.td}>{stats[k].count}</td>
                  <td className={styles.td}>{formatTokenCount(stats[k].cacheCreate)}</td>
                </tr>
              ))}
              {activeReasons.length > 1 && (
                <tr className={styles.rebuildTotalRow}>
                  <td className={styles.label}>Total</td>
                  <td className={styles.td}>{totalCount}</td>
                  <td className={styles.td}>{formatTokenCount(totalCache)}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
        {hasSubAgentStats && (
          <div className={hasTeammateStats ? styles.modelCardSpaced : styles.modelCard}>
            <div className={styles.modelName}>{t('ui.subAgentStats')}</div>
            <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={`${styles.th} ${styles.thLeft}`}>SubAgent</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {subAgentEntries.map(([name, count]) => (
                <tr key={name} className={styles.rowBorder}>
                  <td className={styles.label}>{name} <ConceptHelp doc={`SubAgent-${name}`} /></td>
                  <td className={styles.td}>{count}</td>
                </tr>
              ))}
              {subAgentEntries.length > 1 && (
                <tr className={styles.rebuildTotalRow}>
                  <td className={styles.label}>Total</td>
                  <td className={styles.td}>{subAgentEntries.reduce((s, e) => s + e[1], 0)}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
        {hasTeammateStats && (
          <div className={styles.modelCard}>
            <div className={styles.modelName}>Teammate<ConceptHelp doc="Teammate" /></div>
            <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={`${styles.th} ${styles.thLeft}`}>Name</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {teammateEntries.map(([name, count]) => (
                <tr key={name} className={styles.rowBorder}>
                  <td className={styles.label}>{name}</td>
                  <td className={styles.td}>{count}</td>
                </tr>
              ))}
              {teammateEntries.length > 1 && (
                <tr className={styles.rebuildTotalRow}>
                  <td className={styles.label}>Total</td>
                  <td className={styles.td}>{teammateEntries.reduce((s, e) => s + e[1], 0)}</td>
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

  fetchPlugins = () => {
    return fetch(apiUrl('/api/plugins')).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(data => {
      this.setState({ pluginsList: data.plugins || [], pluginsDir: data.pluginsDir || '' });
    }).catch(() => {});
  };

  handleShowPlugins = () => {
    this.setState({ pluginModalVisible: true });
    this.fetchPlugins();
  };

  handleTogglePlugin = (name, enabled) => {
    fetch(apiUrl('/api/preferences')).then(r => r.json()).then(prefs => {
      let disabledPlugins = Array.isArray(prefs.disabledPlugins) ? [...prefs.disabledPlugins] : [];
      if (enabled) {
        disabledPlugins = disabledPlugins.filter(n => n !== name);
      } else {
        if (!disabledPlugins.includes(name)) disabledPlugins.push(name);
      }
      return fetch(apiUrl('/api/preferences'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabledPlugins }),
      });
    }).then(() => {
      return fetch(apiUrl('/api/plugins/reload'), { method: 'POST' });
    }).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(data => {
      this.setState({ pluginsList: data.plugins || [], pluginsDir: data.pluginsDir || '' });
    }).catch(() => {});
  };

  handleDeletePlugin = (file, name) => {
    this.setState({ deleteConfirmVisible: true, deleteTarget: { file, name } });
  };

  handleDeletePluginConfirm = () => {
    const { file } = this.state.deleteTarget || {};
    if (!file) return;
    this.setState({ deleteConfirmVisible: false, deleteTarget: null });
    fetch(apiUrl(`/api/plugins?file=${encodeURIComponent(file)}`), { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(data => {
        if (data.plugins) {
          this.setState({ pluginsList: data.plugins, pluginsDir: data.pluginsDir || '' });
        }
      }).catch(() => {});
  };

  handleReloadPlugins = () => {
    fetch(apiUrl('/api/plugins/reload'), { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(data => {
        this.setState({ pluginsList: data.plugins || [], pluginsDir: data.pluginsDir || '' });
      }).catch(() => {});
  };

  handleAddPlugin = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.mjs';
    input.multiple = true;
    input.onchange = () => {
      const fileHandles = input.files;
      if (!fileHandles || fileHandles.length === 0) return;
      for (const f of fileHandles) {
        if (!f.name.endsWith('.js') && !f.name.endsWith('.mjs')) {
          message.error(t('ui.plugins.invalidFile'));
          return;
        }
      }
      // 用 FileReader 读取所有文件内容，以 JSON 发送
      const readPromises = Array.from(fileHandles).map(f => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: f.name, content: reader.result });
          reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
          reader.readAsText(f);
        });
      });
      Promise.all(readPromises).then(files => {
        return fetch(apiUrl('/api/plugins/upload'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        });
      }).then(r => {
        if (!r.ok) {
          return r.text().then(text => {
            try { const j = JSON.parse(text); return j; } catch { throw new Error(t('ui.plugins.serverError', { status: r.status })); }
          });
        }
        return r.json();
      }).then(data => {
        if (data.error) {
          message.error(t('ui.plugins.addFailed', { reason: data.error }));
        } else if (data.plugins) {
          this.setState({ pluginsList: data.plugins, pluginsDir: data.pluginsDir || '' });
          message.success(t('ui.plugins.addSuccess'));
        }
      }).catch(err => {
        message.error(err.message);
      });
    };
    input.click();
  };

  handleShowCdnModal = () => {
    this.setState({ cdnModalVisible: true, cdnUrl: '', cdnLoading: false });
  };

  handleCdnUrlChange = (e) => {
    this.setState({ cdnUrl: e.target.value });
  };

  handleCdnInstall = () => {
    const { cdnUrl } = this.state;
    if (!cdnUrl.trim()) {
      message.error(t('ui.plugins.cdnUrlRequired'));
      return;
    }
    try {
      new URL(cdnUrl);
    } catch {
      message.error(t('ui.plugins.cdnInvalidUrl'));
      return;
    }
    this.setState({ cdnLoading: true });
    fetch(apiUrl('/api/plugins/install-from-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cdnUrl.trim() }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          message.error(t('ui.plugins.cdnInstallFailed', { reason: data.error }));
        } else {
          message.success(t('ui.plugins.cdnInstallSuccess'));
          if (data.plugins) {
            this.setState({ pluginsList: data.plugins, pluginsDir: data.pluginsDir || '' });
          }
          this.setState({ cdnModalVisible: false, cdnUrl: '' });
        }
      })
      .catch((err) => {
        message.error(t('ui.plugins.cdnInstallFailed', { reason: err.message || 'Network error' }));
      })
      .finally(() => {
        this.setState({ cdnLoading: false });
      });
  };

  handleCdnCancel = () => {
    this.setState({ cdnModalVisible: false, cdnUrl: '', cdnLoading: false });
  };

  fetchProcesses = () => {
    this.setState({ processLoading: true });
    fetch(apiUrl('/api/ccv-processes'))
      .then(r => r.json())
      .then(data => {
        this.setState({ processList: data.processes || [], processLoading: false });
      })
      .catch(() => {
        this.setState({ processList: [], processLoading: false });
      });
  };

  handleShowProcesses = () => {
    this.setState({ processModalVisible: true });
    this.fetchProcesses();
  };

  handleKillProcess = (pid) => {
    Modal.confirm({
      title: t('ui.processManagement.killConfirm'),
      onOk: () => {
        fetch(apiUrl('/api/ccv-processes/kill'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.ok) {
              message.success(t('ui.processManagement.killed'));
              this.fetchProcesses();
            } else {
              message.error(data.error || t('ui.processManagement.killFailed'));
            }
          })
          .catch(() => {
            message.error(t('ui.processManagement.killFailed'));
          });
      },
    });
  };

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
            <div className={styles.projectStatLabel}>Input Tokens</div>
          </div>
          <div className={styles.projectStatCard}>
            <div className={styles.projectStatValue}>{formatTokenCount(summary?.output_tokens)}</div>
            <div className={styles.projectStatLabel}>Output Tokens</div>
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
                  <table className={styles.statsTable}>
                    <tbody>
                      <tr>
                        <td className={styles.label}>Token</td>
                        <td className={styles.th}>input</td>
                        <td className={styles.th}>output</td>
                      </tr>
                      <tr className={styles.rowBorder}>
                        <td className={styles.label}></td>
                        <td className={styles.td}>{formatTokenCount(totalInput)}</td>
                        <td className={styles.td}>{formatTokenCount(data.output)}</td>
                      </tr>
                      <tr>
                        <td className={styles.label}>Cache</td>
                        <td className={styles.th}>create</td>
                        <td className={styles.th}>read</td>
                      </tr>
                      <tr className={styles.rowBorder}>
                        <td className={styles.label}></td>
                        <td className={styles.td}>{formatTokenCount(data.cacheCreation)}</td>
                        <td className={styles.td}>{formatTokenCount(data.cacheRead)}</td>
                      </tr>
                      <tr>
                        <td className={styles.label}>{t('ui.hitRate')}</td>
                        <td colSpan={2} className={styles.td}>{cacheHitRate}%</td>
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

  render() {
    const { requestCount, requests = [], viewMode, cacheType, onToggleViewMode, onImportLocalLogs, onLangChange, isLocalLog, localLogFile, projectName, collapseToolResults, onCollapseToolResultsChange, expandThinking, onExpandThinkingChange, showFullToolContent, onShowFullToolContentChange, expandDiff, onExpandDiffChange, filterIrrelevant, onFilterIrrelevantChange, logDir, onLogDirChange, updateInfo, onDismissUpdate, cliMode, terminalVisible, onToggleTerminal, onReturnToWorkspaces, contextWindow, serverCachedContent, resumeAutoChoice, onResumeAutoChoiceToggle, onResumeAutoChoiceChange, themeColor, onThemeColorChange, autoApproveSeconds, onAutoApproveChange } = this.props;
    const { countdownText } = this.state;

    const menuItems = [
      {
        key: 'import-local',
        icon: <ImportOutlined />,
        label: t('ui.importLocalLogs'),
        onClick: onImportLocalLogs,
      },
      {
        key: 'export-prompts',
        icon: <ExportOutlined />,
        label: t('ui.exportPrompts'),
        onClick: this.handleShowPrompts,
      },
      {
        key: 'plugin-management',
        icon: <ApiOutlined />,
        label: t('ui.pluginManagement'),
        onClick: this.handleShowPlugins,
      },
      {
        key: 'switch-workspace',
        icon: <ImportOutlined className={styles.iconMirror} />,
        label: <span className={styles.disabledMenuItem}>{t('ui.switchWorkspace')}</span>,
        disabled: true,
      },
      {
        key: 'process-management',
        icon: <DashboardOutlined />,
        label: t('ui.processManagement'),
        onClick: this.handleShowProcesses,
      },
      {
        key: 'proxy-switch',
        icon: <SwapOutlined />,
        label: t('ui.proxySwitch'),
        onClick: () => this.setState({ proxyModalVisible: true }),
      },
      { type: 'divider' },
      {
        key: 'project-stats',
        icon: <BarChartOutlined />,
        label: t('ui.projectStats'),
        onClick: this.handleShowProjectStats,
      },
      ...(viewMode === 'raw' ? [{
        key: 'global-settings',
        icon: <SettingOutlined />,
        label: t('ui.globalSettings'),
        onClick: () => this.setState({ globalSettingsVisible: true }),
      }] : []),
      ...(viewMode === 'chat' ? [{
        key: 'display-settings',
        icon: <SettingOutlined />,
        label: t('ui.settings'),
        onClick: () => this.setState({ settingsDrawerVisible: true }),
      }] : []),
    ];

    return (
      <div className={styles.headerBar}>
        <Space size="middle">
          <Dropdown menu={{ items: menuItems, className: 'logo-dropdown-menu' }} trigger={['hover']} onOpenChange={(open) => this.setState({ logoDropdownOpen: open })} align={{ offset: [-4, 0] }}>
            <span className={`${styles.logoWrap}${this.state.logoDropdownOpen ? ` ${styles.logoWrapActive}` : ''}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${styles.logoImage}${this.state.logoDropdownOpen ? ` ${styles.logoImageActive}` : ''}`}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </span>
          </Dropdown>
          <Popover
            content={() => this.renderTokenStats()}
            trigger="hover"
            placement="bottomLeft"
            overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '8px 8px', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <Tag className={styles.tokenStatsTag}>
              <DashboardOutlined className={styles.tokenStatsIcon} />
              {t('ui.tokenStats')}
            </Tag>
          </Popover>
          {this.props.activeProxyId && this.props.activeProxyId !== 'max' && (() => {
            const p = (this.props.proxyProfiles || []).find(x => x.id === this.props.activeProxyId);
            return p ? (
              <Tag className={styles.proxyProfileTag} onClick={() => this.setState({ proxyModalVisible: true })}>
                <SwapOutlined className={styles.proxySwapIcon} />
                {p.name}{p.activeModel ? ` · ${p.activeModel}` : ''}
              </Tag>
            ) : null;
          })()}
          {(() => {
            // 计算上下文使用率：距离 auto-compact 触发点的进度
            // auto-compact 在 ~83.5% 时触发（扣除 16.5% buffer）
            // 将 used_percentage 映射到 0~83.5% → 0~100%
            let contextPercent = 0;
            const calibration = CALIBRATION_MODELS.find(m => m.value === this.state.calibrationModel);
            const calibrationTokens = calibration?.tokens; // undefined for 'auto'
            if (!isLocalLog) {
              if (calibrationTokens && contextWindow?.used_percentage != null) {
                // 校准模式 + 精确数据：用实际 token 数重新计算百分比
                const getTotal = (req) => {
                  const u = req.response?.body?.usage;
                  return (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0);
                };
                let total = 0;
                for (let i = requests.length - 1; i >= 0; i--) {
                  if (isMainAgent(requests[i]) && requests[i].response?.body?.usage) {
                    total = getTotal(requests[i]);
                    break;
                  }
                }
                if (total > 0) {
                  const usable = calibrationTokens * 0.835;
                  contextPercent = Math.min(100, Math.max(0, Math.round(total / usable * 100)));
                } else {
                  // 无 token 数据时，按比例缩放 used_percentage
                  const origMax = contextWindow.context_window_size || 200000;
                  contextPercent = Math.min(100, Math.max(0, Math.round(contextWindow.used_percentage * origMax / calibrationTokens / 83.5 * 100)));
                }
              } else if (contextWindow?.used_percentage != null) {
                // 精确模式：statusLine 推送的 used_percentage
                // 如果 settings.json 指定了模型且上下文大小与 statusLine 检测的不同，按比例修正
                const settingsTokens = this.state.settingsModel ? getModelMaxTokens(this.state.settingsModel) : 0;
                const detectedMax = contextWindow.context_window_size || 200000;
                if (settingsTokens && settingsTokens !== detectedMax) {
                  contextPercent = Math.min(100, Math.max(0, Math.round(contextWindow.used_percentage * detectedMax / settingsTokens / 83.5 * 100)));
                } else {
                  contextPercent = Math.min(100, Math.max(0, Math.round(contextWindow.used_percentage / 83.5 * 100)));
                }
              } else if (requests.length > 0) {
                // fallback：用最后一个 MainAgent 的 total input 估算
                const getTotal = (req) => {
                  const u = req.response?.body?.usage;
                  return (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0);
                };
                for (let i = requests.length - 1; i >= 0; i--) {
                  if (isMainAgent(requests[i]) && requests[i].response?.body?.usage) {
                    const total = getTotal(requests[i]);
                    const maxTokens = calibrationTokens || contextWindow?.context_window_size || getModelMaxTokens(getEffectiveModel(requests[i]) || this.state.settingsModel);
                    const usable = maxTokens * 0.835;
                    if (usable > 0 && total > 0) {
                      contextPercent = Math.min(100, Math.max(0, Math.round(total / usable * 100)));
                    }
                    break;
                  }
                }
              }
            }
            // 回退到最后一次有效值，避免闪烁
            if (contextPercent === 0 && this._lastContextPercent > 0) {
              contextPercent = this._lastContextPercent;
            }
            const ctxColor = contextPercent >= 80 ? 'var(--color-error-light)' : contextPercent >= 60 ? 'var(--color-warning-light)' : 'var(--color-success)';

            return isLocalLog ? (
              <Tag className={`${styles.liveTag} ${styles.liveTagHistory}`}>
                <span className={styles.liveTagText}>{t('ui.historyLog', { file: localLogFile })}</span>
              </Tag>
            ) : (
              <Popover
                content={this.state._cachePopoverOpen ? this.renderCacheContentPopover(contextPercent) : <div className={styles.cachePopoverPlaceholder} />}
                trigger="hover"
                placement="bottomLeft"
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '8px 8px' }}
                onOpenChange={(open) => {
                  this.setState({ _cachePopoverOpen: open });
                  if (!open) this._cacheScrollInited = false;
                  // 首次打开 + 未加载 + live-tail → 拉一次文件系统权威数据
                  if (open && this.state._fsSkills === null && !this.props.isLocalLog) this.reloadFsSkills();
                }}
              >
                <span className={styles.liveTag} style={{ borderColor: ctxColor, color: ctxColor }}>
                  <span className={styles.liveTagFill} style={{ width: `${contextPercent}%`, backgroundColor: ctxColor }} />
                  <span className={styles.liveTagContent}>
                    <span className={styles.liveTagText}>
                      {t('ui.liveMonitoring')}{projectName ? `:${projectName}` : ''}
                    </span>
                  </span>
                </span>
              </Popover>
            );
          })()}
          {updateInfo && (
            <Tag
              color="orange"
              closable
              onClose={() => onDismissUpdate && onDismissUpdate()}
            >
              {t('ui.update.majorAvailable', { version: updateInfo.version })}
            </Tag>
          )}
        </Space>

        <Space size={12} align="center" className={styles.headerRightRow}>
          {countdownText && viewMode === 'raw' && (
            <Tag className={styles.headerCountdownTag} style={{ color: countdownText === t('ui.cacheExpired') ? 'var(--color-error-light)' : 'var(--text-secondary)' }}>
              {t('ui.cacheCountdown', { type: cacheType ? `(${cacheType})` : '' })}
              <strong className={styles.countdownStrong}>{countdownText}</strong>
            </Tag>
          )}
          {viewMode === 'chat' && cliMode && !isLocalLog && this.state.localUrl && (
            <>
<Popover
              content={
                <div className={styles.qrcodePopover}>
                  <div className={styles.qrcodeTitle}>{t('ui.scanToCoding')} <ConceptHelp doc="QRCode" /></div>
                  <QRCodeCanvas value={this.state.localUrl} size={200} bgColor={themeColor === 'light' ? '#ffffff' : '#141414'} fgColor={themeColor === 'light' ? '#1a1a1a' : '#d9d9d9'} level="M" />
                  <Input
                    readOnly
                    value={this.state.localUrl}
                    className={styles.qrcodeUrlInput}
                    suffix={
                      <CopyOutlined
                        className={styles.qrcodeUrlCopy}
                        onClick={() => {
                          navigator.clipboard.writeText(this.state.localUrl).then(() => {
                            message.success(t('ui.copied'));
                          }).catch(() => {});
                        }}
                      />
                    }
                  />
                </div>
              }
              trigger={['hover', 'focus']}
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
              <button
                type="button"
                className={styles.themeToggle}
                data-theme={themeColor === 'light' ? 'light' : 'dark'}
                role="switch"
                aria-checked={themeColor === 'light'}
                title={themeColor === 'light' ? t('ui.themeColor.light') : t('ui.themeColor.dark')}
                onClick={() => onThemeColorChange && onThemeColorChange(themeColor === 'light' ? 'dark' : 'light')}
              >
                <span className={styles.themeToggleKnob}>
                  {themeColor === 'light' ? (
                    /* Sun: 中心圆 + 8 条呈十字斜向分布的光芒 */
                    <svg className={styles.themeToggleIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
                    /* Moon: 右向月牙 */
                    <svg className={styles.themeToggleIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8.4 2.5a5.9 5.9 0 1 0 5.1 8.55A4.8 4.8 0 0 1 8.4 2.5Z" fill="currentColor"/>
                    </svg>
                  )}
                </span>
              </button>
            </>
          )}
          {cliMode && viewMode === 'chat' && !isLocalLog && (
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
          <Button
            className={styles.compactBtn}
            type={viewMode === 'raw' ? 'primary' : 'default'}
            icon={viewMode === 'raw' ? <MessageOutlined /> : <FileTextOutlined />}
            onClick={onToggleViewMode}
          >
            {viewMode === 'raw' ? t('ui.chatMode') : t('ui.rawMode')}
          </Button>
        </Space>
        <Modal
          title={`${t('ui.userPrompt')} (${this.state.promptData.length}${t('ui.promptCountUnit')})`}
          open={this.state.promptModalVisible}
          onCancel={() => this.setState({ promptModalVisible: false })}
          footer={null}
          width={700}
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
          width={360}
          open={this.state.settingsDrawerVisible}
          onClose={() => this.setState({ settingsDrawerVisible: false })}
        >
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsGroupTitle}>{t('ui.chatDisplaySwitches')}</div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.collapseToolResults')}</span>
              <Switch
                checked={!!collapseToolResults}
                onChange={(checked) => onCollapseToolResultsChange && onCollapseToolResultsChange(checked)}
              />
            </div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.expandThinking')}</span>
              <Switch
                checked={!!expandThinking}
                onChange={(checked) => onExpandThinkingChange && onExpandThinkingChange(checked)}
              />
            </div>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.showFullToolContent')}</span>
              <Switch
                checked={!!showFullToolContent}
                onChange={(checked) => onShowFullToolContentChange && onShowFullToolContentChange(checked)}
              />
            </div>
          </div>
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsGroupTitle}>{t('ui.userPreferences')}</div>
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
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.permission.autoApprove.setting')}</span>
              <Select
                size="small"
                value={autoApproveSeconds || 0}
                onChange={(value) => onAutoApproveChange && onAutoApproveChange(value)}
                options={[
                  { label: t('ui.permission.autoApprove.off'), value: 0 },
                  { label: '3s', value: 3 },
                  { label: '5s', value: 5 },
                  { label: '10s', value: 10 },
                  { label: '15s', value: 15 },
                  { label: '20s', value: 20 },
                  { label: '30s', value: 30 },
                  { label: '60s', value: 60 },
                ]}
                style={{ width: 100 }}
              />
            </div>
          </div>
          <div className={styles.settingsGroupBox}>
            <div className={styles.settingsItem}>
              <span className={styles.settingsLabel}>{t('ui.themeColor')}</span>
              <Select
                size="small"
                value={themeColor || 'dark'}
                onChange={(value) => onThemeColorChange && onThemeColorChange(value)}
                options={[
                  { label: t('ui.themeColor.dark'), value: 'dark' },
                  { label: t('ui.themeColor.light'), value: 'light' },
                ]}
                style={{ width: 140 }}
              />
            </div>
          </div>
          <div className={styles.settingsGroupBox}>
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
        </Drawer>
        <Drawer
          title={<span>{t('ui.globalSettings')} <ConceptHelp doc="GlobalSettings" /></span>}
          placement="left"
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
              onChange={(checked) => onExpandDiffChange && onExpandDiffChange(checked)}
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
          title={<span><BarChartOutlined className={styles.titleIcon} />{t('ui.projectStats')}</span>}
          placement="left"
          width={400}
          open={this.state.projectStatsVisible}
          onClose={() => this.setState({ projectStatsVisible: false })}
        >
          {this.renderProjectStatsContent()}
        </Drawer>
        <Modal
          title={<span><ApiOutlined className={styles.titleIcon} />{t('ui.pluginManagement')}</span>}
          open={this.state.pluginModalVisible}
          onCancel={() => this.setState({ pluginModalVisible: false })}
          footer={
            <div className={styles.pluginModalFooter}>
              <div className={styles.pluginModalFooterLeft}>
                <Button icon={<PlusOutlined />} onClick={this.handleAddPlugin}>{t('ui.plugins.add')}</Button>
                <Button icon={<CloudDownloadOutlined />} onClick={this.handleShowCdnModal}>{t('ui.plugins.cdnInstall')}</Button>
              </div>
              <Button icon={<ReloadOutlined />} onClick={this.handleReloadPlugins}>{t('ui.plugins.reload')}</Button>
            </div>
          }
          width={560}
        >
          {this.state.pluginsDir && (
            <div className={styles.pluginDirHint}>
              <span className={styles.pluginDirLabel}>{t('ui.plugins.pluginsDir')}:</span>{' '}
              <code
                className={styles.pluginDirPath}
                onClick={() => {
                  navigator.clipboard.writeText(this.state.pluginsDir).then(() => {
                    message.success(t('ui.copied'));
                  }).catch(() => {});
                }}
              >
                {this.state.pluginsDir}
              </code>
            </div>
          )}
          {this.state.pluginsList.length === 0 ? (
            <div className={styles.pluginEmpty}>
              <div className={styles.pluginEmptyTitle}>{t('ui.plugins.empty')}</div>
              <div className={styles.pluginEmptyHint}>{t('ui.plugins.emptyHint')}</div>
            </div>
          ) : (
            <div className={styles.pluginList}>
              {this.state.pluginsList.map(p => (
                <div key={p.file} className={styles.pluginItem}>
                  <div className={styles.pluginInfo}>
                    <span className={styles.pluginName}>{p.name}</span>
                    <span className={styles.pluginFile}>{p.file}</span>
                    {p.hooks.length > 0 && (
                      <span className={styles.pluginHooks}>
                        {p.hooks.map(h => <span key={h} className={styles.pluginHookTag}>{h}</span>)}
                      </span>
                    )}
                  </div>
                  <div className={styles.pluginActions}>
                    <Switch
                      size="small"
                      checked={p.enabled}
                      onChange={(checked) => this.handleTogglePlugin(p.name, checked)}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => this.handleDeletePlugin(p.file, p.name)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
        <Modal
          title={t('ui.plugins.delete')}
          open={this.state.deleteConfirmVisible}
          onCancel={() => this.setState({ deleteConfirmVisible: false, deleteTarget: null })}
          onOk={this.handleDeletePluginConfirm}
          okType="danger"
          okText="OK"
          cancelText="Cancel"
        >
          <p>{this.state.deleteTarget ? t('ui.plugins.deleteConfirm', { name: this.state.deleteTarget.name }) : ''}</p>
        </Modal>
        <Modal
          title={<span><CloudDownloadOutlined className={styles.titleIcon} />{t('ui.plugins.cdnInstall')}</span>}
          open={this.state.cdnModalVisible}
          onCancel={this.handleCdnCancel}
          onOk={this.handleCdnInstall}
          confirmLoading={this.state.cdnLoading}
          okText={t('ui.plugins.cdnInstallBtn')}
          cancelText={t('ui.cancel')}
          width={480}
        >
          <div>
            <div className={styles.cdnUrlLabel}>{t('ui.plugins.cdnUrl')}</div>
            <Input
              placeholder={t('ui.plugins.cdnUrlPlaceholder')}
              value={this.state.cdnUrl}
              onChange={this.handleCdnUrlChange}
              onPressEnter={this.handleCdnInstall}
              className={styles.cdnInput}
            />
          </div>
        </Modal>
        <Modal
          title={<span><DashboardOutlined className={styles.titleIcon} />{t('ui.processManagement')}</span>}
          open={this.state.processModalVisible}
          onCancel={() => this.setState({ processModalVisible: false })}
          footer={
            <Button icon={<ReloadOutlined />} onClick={this.fetchProcesses} loading={this.state.processLoading}>
              {t('ui.processManagement.refresh')}
            </Button>
          }
          width={780}
        >
          <Table
            dataSource={this.state.processList}
            rowKey="pid"
            loading={this.state.processLoading}
            size="middle"
            pagination={false}
            columns={[
              { title: t('ui.processManagement.port'), dataIndex: 'port', width: 80, render: (text) => text ? <a href={`${window.location.protocol}//127.0.0.1:${text}`} target="_blank" rel="noopener noreferrer">{text}</a> : '' },
              { title: 'PID', dataIndex: 'pid', width: 80 },
              { title: t('ui.processManagement.command'), dataIndex: 'command', ellipsis: true },
              { title: t('ui.processManagement.startTime'), dataIndex: 'startTime', width: 200 },
              {
                title: t('ui.processManagement.action'),
                width: 100,
                render: (_, record) => record.isCurrent
                  ? <Button size="small" className={styles.currentProcessBtn}>{t('ui.processManagement.current')}</Button>
                  : <Button size="small" danger onClick={() => this.handleKillProcess(record.pid)}>{t('ui.processManagement.kill')}</Button>,
              },
            ]}
          />
        </Modal>

        {/* Proxy Profile Modal */}
        <Modal
          title={<span><OpenFolderIcon apiEndpoint={apiUrl('/api/open-profile-dir')} title={t('ui.proxy.openConfigDir')} size={16} /> {t('ui.proxySwitch')} <ConceptHelp doc="ProxySwitch" zIndex={1100} /></span>}
          open={this.state.proxyModalVisible}
          onCancel={() => this.setState({ proxyModalVisible: false, editingProxy: null })}
          footer={null}
          width={520}
        >
          {this.renderProxyProfileList()}
        </Modal>

        {/* Skills Manager Modal — 从 AppHeader popover「已载入 Skill」→「管理」按钮打开 */}
        {this.renderSkillsManagerModal()}
      </div>
    );
  }

  handleOpenSkillsModal = async () => {
    // 复用已缓存的 _fsSkills；null（还没拉过）或 false（上次失败）都重拉一次。
    // 不从 state 回读 reloadFsSkills 的结果 —— 用它的返回值（setState 异步、await 后 state 可能还没 flush）。
    const cached = this.state._fsSkills;
    const needFetch = !Array.isArray(cached);
    this.setState(prev => ({
      _skillsModal: {
        open: true,
        loading: needFetch,
        skills: Array.isArray(cached) ? cached : [],
        error: null,
        toggling: prev._skillsModal?.toggling || new Set(),
      },
      _cachePopoverOpen: false,
    }));
    if (needFetch) {
      const result = await this.reloadFsSkills();
      this.setState(prev => ({
        _skillsModal: {
          ...prev._skillsModal,
          loading: false,
          skills: result.ok ? result.skills : [],
          error: result.ok ? null : result.reason,
        },
      }));
    }
  };

  handleToggleSkill = async (skill) => {
    const key = `${skill.source}-${skill.name}`;
    if (this.state._skillsModal?.toggling?.has(key)) return;
    const enable = !skill.enabled;
    // 乐观更新：先翻 Switch 让视觉立刻响应；请求失败再回滚
    const flipEnabled = (target) => (s) =>
      (s.source === skill.source && s.name === skill.name) ? { ...s, enabled: target } : s;
    this.setState(prev => {
      const next = new Set(prev._skillsModal.toggling); next.add(key);
      return {
        _skillsModal: {
          ...prev._skillsModal,
          toggling: next,
          skills: prev._skillsModal.skills.map(flipEnabled(enable)),
        },
      };
    });
    try {
      const r = await fetch(apiUrl('/api/skills/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: skill.source, name: skill.name, enable }),
      });
      const data = await r.json();
      if (!r.ok) {
        // 回滚乐观更新
        this.setState(prev => ({
          _skillsModal: {
            ...prev._skillsModal,
            skills: prev._skillsModal.skills.map(flipEnabled(!enable)),
          },
        }));
        if (data.code === 'DEST_CONFLICT') {
          message.error(t('ui.skillToggleConflict', { name: skill.name }));
        } else {
          message.error(t('ui.skillToggleFailed', { reason: data.error || 'unknown' }));
        }
        return;
      }
      message.success(enable
        ? t('ui.skillEnabled', { name: skill.name })
        : t('ui.skillDisabled', { name: skill.name })
      );
      // 乐观翻 _fsSkills 里这条的 enabled —— 如果后面 reloadFsSkills 失败，chip 也能立即反映用户动作，
      // 不会退化到历史解析让用户以为操作没生效。reload 成功会用权威数据覆盖。
      this.setState(prev => ({
        _fsSkills: Array.isArray(prev._fsSkills)
          ? prev._fsSkills.map(s => (s.source === skill.source && s.name === skill.name) ? { ...s, enabled: enable } : s)
          : prev._fsSkills,
      }));
      // 重拉让 popover chip 和管理弹窗用权威数据一次性对齐。拉失败保留乐观值。
      const result = await this.reloadFsSkills();
      if (result.ok) {
        this.setState(prev => ({
          _skillsModal: { ...prev._skillsModal, skills: result.skills },
        }));
      }
    } catch (e) {
      // 网络异常也回滚
      this.setState(prev => ({
        _skillsModal: {
          ...prev._skillsModal,
          skills: prev._skillsModal.skills.map(flipEnabled(!enable)),
        },
      }));
      message.error(t('ui.skillToggleFailed', { reason: e.message }));
    } finally {
      this.setState(prev => {
        const next = new Set(prev._skillsModal.toggling); next.delete(key);
        return { _skillsModal: { ...prev._skillsModal, toggling: next } };
      });
    }
  };

  renderSkillsManagerModal() {
    const modal = this.state._skillsModal || {};
    const { open = false, loading = false, skills = [], error = null, toggling = new Set() } = modal;
    return (
      <Modal
        title={t('ui.skillManagerTitle')}
        open={open}
        onCancel={() => this.setState(prev => ({ _skillsModal: { ...prev._skillsModal, open: false } }))}
        footer={null}
        width="min(1200px, calc(100vw - 80px))"
        zIndex={1100}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 20px' } }}
      >
        {loading ? (
          <div className={styles.skillsEmpty}><Spin /></div>
        ) : error ? (
          <div className={styles.skillsEmpty}>{t('ui.skillsLoadFailed', { reason: this.getSkillsLoadErrorLabel(error) || error })}</div>
        ) : skills.length === 0 ? (
          <div className={styles.skillsEmpty}>{t('ui.noSkillsLoaded')}</div>
        ) : (
          <>
            {/* 只把 user / project（可切换）放 card 列表；plugin + builtin 折叠到底部 chip 行 */}
            {skills.filter(s => s.source === 'user' || s.source === 'project').length > 0 && (
              <div className={styles.skillsList}>
                {skills.filter(s => s.source === 'user' || s.source === 'project').map((s, i) => {
                  const key = `${s.source}-${s.name}`;
                  const isToggling = toggling.has(key);
                  return (
                    <div key={`${key}-${i}`} className={`${styles.skillCard} ${!s.enabled ? styles.skillCardDisabled : ''}`}>
                      <div className={styles.skillCardHeader}>
                        <div className={styles.skillCardTitleRow}>
                          <span className={`${styles.skillSourceBadge} ${styles['skillSource_' + s.source]}`}>
                            {t('ui.skillSource.' + s.source)}
                          </span>
                          <div className={styles.skillCardName}>{s.name}</div>
                        </div>
                        <div className={styles.skillCardActions}>
                          <Switch size="small" checked={s.enabled} loading={isToggling} onChange={() => this.handleToggleSkill(s)} />
                        </div>
                      </div>
                      {s.description && <div className={styles.skillCardDesc}>{s.description}</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Plugin：不可单独禁用（要走 `claude plugin disable <name>` CLI），折叠成 chip 行；每 chip tooltip 带 plugin 名 */}
            {skills.filter(s => s.source === 'plugin').length > 0 && (
              <div className={styles.skillsReadonlySection}>
                <div className={styles.skillsReadonlyLabel}>{t('ui.skillsPluginLabel')}</div>
                <div className={styles.toolChipGrid}>
                  {skills.filter(s => s.source === 'plugin').map((s, i) => {
                    // pluginName 现在返 "name@marketplace"（pluginKey），tooltip 显示时剥后缀
                    const pluginDisplay = (s.pluginName || '').split('@')[0];
                    return (
                      <Tooltip key={`plugin-${s.name}-${i}`} title={t('ui.skillCannotDisablePlugin', { plugin: pluginDisplay })}>
                        <span className={styles.cacheToolChip}>{s.name}</span>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Builtin：同样折叠为 chip 行，tooltip 解释"硬编码无法禁用" */}
            {skills.filter(s => s.source === 'builtin').length > 0 && (
              <div className={styles.skillsReadonlySection}>
                <div className={styles.skillsReadonlyLabel}>{t('ui.skillsBuiltinLabel')}</div>
                <div className={styles.toolChipGrid}>
                  {skills.filter(s => s.source === 'builtin').map(s => (
                    <Tooltip key={s.name} title={t('ui.skillCannotDisableBuiltin')}>
                      <span className={styles.cacheToolChip}>{s.name}</span>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    );
  }

  // ─── Proxy Profile Modal 内容 ───────────────────────────

  renderProxyProfileList() {
    const profiles = this.props.proxyProfiles || [];
    const activeId = this.props.activeProxyId || 'max';
    const { editingProxy, editForm } = this.state;

    return (
      <div>
        <div className={styles.proxyWarning}>⚠️ {t('ui.proxy.maxWarning')}</div>
        <div className={styles.proxyList}>
          {profiles.map(p => (
            <div key={p.id} className={`${styles.proxyItem} ${p.id === activeId ? styles.proxyItemActive : ''}`}>
              <div className={styles.proxyItemMain} onClick={() => {
                if (p.id !== activeId) {
                  const data = { active: p.id, profiles };
                  this.props.onProxyProfileChange(data);
                }
              }}>
                <Radio checked={p.id === activeId} style={{ marginRight: 8 }} />
                <div className={styles.proxyItemInfo}>
                  <div className={styles.proxyItemNameRow}>
                    <span className={styles.proxyItemName}>{p.name}</span>
                    {p.id === 'max' && <Tag className={styles.proxyBuiltinTag}>{t('ui.proxy.builtin')}</Tag>}
                  </div>
                  {p.id === 'max' && this.props.defaultConfig && (
                    <div className={styles.proxyItemDetail}>
                      {(() => { try { return new URL(this.props.defaultConfig.origin).host; } catch { return this.props.defaultConfig.origin; } })()}
                      {this.props.defaultConfig.authType ? ` · ${this.props.defaultConfig.authType}` : ''}
                      {this.props.defaultConfig.apiKey ? ` · ${this.props.defaultConfig.apiKey}` : ''}
                      {this.props.defaultConfig.model ? ` · ${this.props.defaultConfig.model}` : ''}
                    </div>
                  )}
                  {p.id !== 'max' && p.baseURL && (
                    <div className={styles.proxyItemDetail}>
                      {(() => { try { return new URL(p.baseURL).host; } catch { return p.baseURL; } })()}
                      {p.activeModel ? ` · ${p.activeModel}` : (p.models?.length ? ` · ${p.models[0]}` : '')}
                    </div>
                  )}
                </div>
              </div>
              {p.id !== 'max' && (
                <div className={styles.proxyItemActions}>
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => this.setState({
                    editingProxy: p.id,
                    editForm: { name: p.name || '', baseURL: p.baseURL || '', apiKey: p.apiKey || '', models: (p.models || []).join(', '), activeModel: p.activeModel || '' }
                  })} />
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => {
                    Modal.confirm({
                      title: t('ui.proxy.deleteProxy'),
                      content: t('ui.proxy.deleteConfirm', { name: p.name }),
                      okType: 'danger',
                      onOk: () => {
                        const newProfiles = profiles.filter(x => x.id !== p.id);
                        const newActive = activeId === p.id ? 'max' : activeId;
                        this.props.onProxyProfileChange({ active: newActive, profiles: newProfiles });
                      }
                    });
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 编辑/新增表单 */}
        {editingProxy && (
          <div className={styles.proxyEditForm}>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.name')} <span className={styles.proxyRequired}>*</span></label>
              <Input size="small" value={editForm.name} onChange={e => { const v = e.target.value; this.setState(prev => ({ editForm: { ...prev.editForm, name: v } })); }} />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.baseURL')} <span className={styles.proxyRequired}>*</span></label>
              <Input size="small" value={editForm.baseURL} onChange={e => { const v = e.target.value; this.setState(prev => ({ editForm: { ...prev.editForm, baseURL: v } })); }} placeholder="https://api.example.com" />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.apiKey')} <span className={styles.proxyRequired}>*</span></label>
              <Input.Password size="small" value={editForm.apiKey} onChange={e => { const v = e.target.value; this.setState(prev => ({ editForm: { ...prev.editForm, apiKey: v } })); }} placeholder="sk-..." />
            </div>
            <div className={styles.proxyEditDivider} />
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.models')}</label>
              <Input size="small" value={editForm.models} onChange={e => { const v = e.target.value; this.setState(prev => ({ editForm: { ...prev.editForm, models: v } })); }} placeholder="model-1, model-2" />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.activeModel')}</label>
              <Select size="small" className={styles.fullWidthSelect} value={editForm.activeModel || undefined} onChange={v => this.setState(prev => ({ editForm: { ...prev.editForm, activeModel: v } }))} placeholder={t('ui.proxy.activeModel')}>
                {(editForm.models || '').split(',').map(m => m.trim()).filter(Boolean).map(m => (
                  <Select.Option key={m} value={m}>{m}</Select.Option>
                ))}
              </Select>
            </div>
            <div className={styles.proxyEditBtns}>
              <Button size="small" icon={<CheckOutlined />} type="primary" onClick={() => {
                if (!editForm.name?.trim() || !editForm.baseURL?.trim() || !editForm.apiKey?.trim()) {
                  message.warning(t('ui.proxy.requiredFields'));
                  return;
                }
                const models = (editForm.models || '').split(',').map(m => m.trim()).filter(Boolean);
                const updated = {
                  id: editingProxy === '__new__' ? `proxy_${Date.now()}` : editingProxy,
                  name: editForm.name.trim(),
                  baseURL: editForm.baseURL.trim(),
                  apiKey: editForm.apiKey.trim(),
                  models,
                  activeModel: editForm.activeModel || models[0] || '',
                };
                let newProfiles;
                if (editingProxy === '__new__') {
                  newProfiles = [...profiles, updated];
                } else {
                  newProfiles = profiles.map(p => p.id === editingProxy ? { ...p, ...updated, id: p.id } : p);
                }
                this.props.onProxyProfileChange({ active: activeId, profiles: newProfiles });
                this.setState({ editingProxy: null });
              }}>{t('ui.proxy.save')}</Button>
              <Button size="small" icon={<CloseOutlined />} onClick={() => this.setState({ editingProxy: null })}>{t('ui.proxy.cancel')}</Button>
            </div>
          </div>
        )}

        {!editingProxy && (
          <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => this.setState({
            editingProxy: '__new__',
            editForm: { name: '', baseURL: '', apiKey: '', models: '', activeModel: '' }
          })}>
            {t('ui.proxy.addProxy')}
          </Button>
        )}
      </div>
    );
  }
}

export default AppHeader;
