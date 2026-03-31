import React from 'react';
import { Space, Tag, Button, Dropdown, Popover, Modal, Collapse, Drawer, Switch, Radio, Tabs, Spin, Input, Table, Select, message } from 'antd';
import { MessageOutlined, FileTextOutlined, ImportOutlined, DashboardOutlined, ExportOutlined, DownloadOutlined, SettingOutlined, BarChartOutlined, CodeOutlined, GlobalOutlined, CopyOutlined, ApiOutlined, DeleteOutlined, ReloadOutlined, PlusOutlined, CloudDownloadOutlined, SwapOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { QRCodeCanvas } from 'qrcode.react';
import { formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats, getModelMaxTokens, extractCachedContent } from '../utils/helpers';
import { isSystemText, classifyUserContent, isMainAgent } from '../utils/contentFilter';
import { classifyRequest } from '../utils/requestType';
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


const countryToFlag = (code) => {
  const toFlag = (c2) => c2.toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
  if (!code || code.length !== 2) return toFlag('CN');
  return toFlag(code);
};

class AppHeader extends React.Component {
  constructor(props) {
    super(props);
    this.state = { countdownText: '', countryFlag: null, countryInfo: null, promptModalVisible: false, promptData: [], promptViewMode: 'original', settingsDrawerVisible: false, globalSettingsVisible: false, projectStatsVisible: false, projectStats: null, projectStatsLoading: false, localUrl: '', pluginModalVisible: false, pluginsList: [], pluginsDir: '', deleteConfirmVisible: false, deleteTarget: null, processModalVisible: false, processList: [], processLoading: false, logoDropdownOpen: false, cacheHighlightIdx: null, cacheHighlightFading: false, cdnModalVisible: false, cdnUrl: '', cdnLoading: false, calibrationModel: (v => CALIBRATION_MODELS.some(m => m.value === v) ? v : 'auto')(localStorage.getItem('ccv_calibrationModel') || 'auto'), proxyModalVisible: false, editingProxy: null, editForm: { name: '', baseURL: '', apiKey: '', models: '', activeModel: '' } };
    this._rafId = null;
    this._expiredTimer = null;
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
    fetch('https://ipinfo.io/json').then(r => r.json()).then(data => {
      if (data.country) this.setState({ countryFlag: countryToFlag(data.country), countryInfo: data });
    }).catch(() => { this.setState({ countryFlag: countryToFlag('CN') }); });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.cacheExpireAt !== this.props.cacheExpireAt) {
      this.startCountdown();
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      nextProps.requests !== this.props.requests ||
      nextProps.requestCount !== this.props.requestCount ||
      nextProps.viewMode !== this.props.viewMode ||
      nextProps.cacheExpireAt !== this.props.cacheExpireAt ||
      nextProps.cacheType !== this.props.cacheType ||
      nextProps.isLocalLog !== this.props.isLocalLog ||
      nextProps.projectName !== this.props.projectName ||
      nextProps.collapseToolResults !== this.props.collapseToolResults ||
      nextProps.expandThinking !== this.props.expandThinking ||
      nextProps.expandDiff !== this.props.expandDiff ||
      nextProps.filterIrrelevant !== this.props.filterIrrelevant ||
      nextProps.cliMode !== this.props.cliMode ||
      nextProps.contextWindow !== this.props.contextWindow ||
      nextProps.serverCachedContent !== this.props.serverCachedContent ||
      nextProps.resumeAutoChoice !== this.props.resumeAutoChoice ||
      nextProps.proxyProfiles !== this.props.proxyProfiles ||
      nextProps.activeProxyId !== this.props.activeProxyId ||
      nextProps.defaultConfig !== this.props.defaultConfig ||
      nextState !== this.state
    );
  }

  componentWillUnmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (this._cacheFadeClearTimer) clearTimeout(this._cacheFadeClearTimer);
    this._cacheUnbindScrollFade();
  }

  startCountdown() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (!this.props.cacheExpireAt) {
      if (this.state.countdownText !== '') this.setState({ countdownText: '' });
      return;
    }
    this._rafId = requestAnimationFrame(this.updateCountdown);
  }

  updateCountdown() {
    const { cacheExpireAt } = this.props;
    if (!cacheExpireAt) {
      if (this.state.countdownText !== '') this.setState({ countdownText: '' });
      return;
    }

    const remaining = Math.max(0, cacheExpireAt - Date.now());
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
    this._rafId = requestAnimationFrame(this.updateCountdown);
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

    return (
      <div className={styles.tokenStatsContainer}>
        {tokenColumn}
        {cacheRebuildColumn}
        {toolColumn}
        {skillColumn}
      </div>
    );
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

    // 缓存最后一次有效的 token 显示值，避免闪烁
    if (cached && (cached.cacheCreateTokens > 0 || cached.cacheReadTokens > 0)) {
      this._lastCachedTokens = { cacheCreateTokens: cached.cacheCreateTokens, cacheReadTokens: cached.cacheReadTokens };
    }
    if (contextPercent > 0) {
      this._lastContextPercent = contextPercent;
    }

    if (!cached || (cached.system.length === 0 && cached.messages.length === 0 && cached.tools.length === 0)) {
      return <div className={styles.cachePopoverEmpty}>{t('ui.noCachedContent')}</div>;
    }

    const renderSection = (title, items, blockClass, sectionKey) => {
      if (items.length === 0) return null;
      const isMessages = title === t('ui.messages');
      const sectionState = (this.state._cacheSectionCollapsed || {})[sectionKey];
      const collapsed = sectionState !== undefined ? !!sectionState : sectionKey === 'tools';
      const toggleCollapse = () => this.setState(prev => ({
        _cacheSectionCollapsed: { ...(prev._cacheSectionCollapsed || {}), [sectionKey]: !collapsed },
      }));
      return (
        <div className={styles.cacheSection}>
          <button type="button" className={styles.cacheSectionTitle} onClick={toggleCollapse} aria-expanded={!collapsed}>
            <span className={styles.cacheSectionArrow}>{collapsed ? '▶' : '▼'}</span>
            {title} ({items.length})
          </button>
          {!collapsed && items.map((text, i) => {
            const extraProps = isMessages ? { 'data-msg-idx': i } : {};
            let cls = blockClass || styles.cacheCodeBlock;
            const isHl = isMessages && i === this.state.cacheHighlightIdx;
            if (isHl) {
              cls += ' ' + (this.state.cacheHighlightFading ? styles.cacheBlockHighlightFading : styles.cacheBlockHighlight);
            }
            return (
              <pre key={i} className={cls} {...extraProps} style={isHl ? { position: 'relative' } : undefined}>
                {isHl && (
                  <svg className={`${styles.cacheBorderSvg}${this.state.cacheHighlightFading ? ' ' + styles.cacheBorderSvgFading : ''}`} preserveAspectRatio="none">
                    <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="4" ry="4"
                      fill="none" stroke="#1668dc" strokeWidth="1" strokeDasharray="6 4"
                      className={styles.cacheBorderRect} />
                  </svg>
                )}
                {text}
              </pre>
            );
          })}
        </div>
      );
    };

    const buildPlainText = () => {
      const parts = [];
      if (cached.tools.length > 0) {
        parts.push(`=== ${t('ui.tools')} (${cached.tools.length}) ===`);
        cached.tools.forEach(text => parts.push(text));
      }
      if (cached.system.length > 0) {
        parts.push(`\n=== ${t('ui.systemPrompt')} (${cached.system.length}) ===`);
        cached.system.forEach(text => parts.push(text));
      }
      if (cached.messages.length > 0) {
        parts.push(`\n=== ${t('ui.messages')} (${cached.messages.length}) ===`);
        cached.messages.forEach(text => parts.push(text));
      }
      return parts.join('\n\n');
    };

    const userPrompts = cached.messages
      .map((text, i) => ({ text, msgIdx: i }))
      .filter(({ text }) => text.startsWith('[user]'))
      .map(({ text, msgIdx }) => {
        const raw = text.replace(/^\[user\]\s*/, '').trim();
        // 与 extractUserTexts 对齐：先对整体文本做 isSystemText 检查
        if (!raw || isSystemText(raw)) return { cleaned: '', msgIdx };
        const segments = AppHeader.parseSegments(raw);
        const cleaned = segments
          .filter(s => s.type === 'text')
          .map(s => s.content.trim())
          .filter(s => s && !isSystemText(s))
          .join(' ')
          .trim();
        return { cleaned, msgIdx };
      })
      .filter(({ cleaned }) => {
        if (!cleaned) return false;
        if (/Implement the following plan:/i.test(cleaned)) return false;
        return true;
      });

    const userPromptNavList = userPrompts.length > 0 ? (
      <div className={styles.cacheNavList}>
        {userPrompts.map(({ cleaned, msgIdx }) => (
          <div key={msgIdx} className={styles.cacheNavItem} onClick={() => this.scrollToCacheMsg(msgIdx)}>
            {cleaned}
          </div>
        ))}
      </div>
    ) : null;

    return (
      <div className={styles.cachePopover}>
        <div className={styles.cachePopoverHeader}>
          <div className={styles.cachePopoverTitle}>
            {t('ui.cachedContentTitle')}
            <ConceptHelp doc="KVCacheContent" />
            <CopyOutlined
              className={styles.cacheCopyBtn}
              onClick={() => {
                navigator.clipboard.writeText(buildPlainText()).then(() => {
                  message.success(t('ui.copied'));
                }).catch(() => {});
              }}
            />
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
        {(() => {
          const hasTokens = cached.cacheCreateTokens > 0 || cached.cacheReadTokens > 0;
          const displayTokens = hasTokens ? cached : this._lastCachedTokens;
          const displayCtx = contextPercent > 0 ? contextPercent : this._lastContextPercent || 0;
          return (displayTokens || userPromptNavList) ? (
          <div className={styles.cacheTokenInfo}>
            {displayTokens && <>
              {t('ui.tokens')}: <span className={styles.cacheWriteToken}>write {formatTokenCount(displayTokens.cacheCreateTokens)}</span>
              {' / '}
              <span className={styles.cacheReadToken}>read {formatTokenCount(displayTokens.cacheReadTokens)}</span>
              {displayCtx > 0 && <span className={styles.cacheCtxPercent}>(ctx:{displayCtx}%)</span>}
            </>}
            {userPromptNavList && (
              <Popover content={userPromptNavList} trigger="hover" placement="left">
                <span className={styles.cacheNavBtn}>{t('ui.userPromptNav')}</span>
              </Popover>
            )}
          </div>
          ) : null;
        })()}
        <div className={styles.cacheScrollArea} ref={el => {
          this._cacheScrollEl = el;
          if (el && !this._cacheScrollInited) {
            this._cacheScrollInited = true;
            requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
          }
        }}>
          {renderSection(t('ui.tools'), cached.tools, undefined, 'tools')}
          {renderSection(t('ui.systemPrompt'), cached.system, styles.cacheCodeBlockSystem, 'system')}
          {renderSection(t('ui.messages'), cached.messages, undefined, 'messages')}
        </div>
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
          <div className={hasSubAgentStats ? styles.modelCardSpaced : styles.modelCard}>
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
    const { requestCount, requests = [], viewMode, cacheType, onToggleViewMode, onImportLocalLogs, onLangChange, isLocalLog, localLogFile, projectName, collapseToolResults, onCollapseToolResultsChange, expandThinking, onExpandThinkingChange, expandDiff, onExpandDiffChange, filterIrrelevant, onFilterIrrelevantChange, updateInfo, onDismissUpdate, cliMode, terminalVisible, onToggleTerminal, onReturnToWorkspaces, contextWindow, serverCachedContent, resumeAutoChoice, onResumeAutoChoiceToggle, onResumeAutoChoiceChange } = this.props;
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
        label: <span style={{ color: '#555', cursor: 'not-allowed' }}>{t('ui.switchWorkspace')}</span>,
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
      {
        key: 'language',
        icon: <GlobalOutlined />,
        label: t('ui.languageSettings'),
        children: [{
          key: 'lang-grid-container',
          type: 'group',
          label: (
            <div className={styles.langGrid}>
              {LANG_OPTIONS.map(o => (
                <Button
                  key={o.value}
                  size="small"
                  type={o.value === getLang() ? 'primary' : 'default'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLang(o.value);
                    if (onLangChange) onLangChange();
                  }}
                  className={styles.langBtn}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          ),
        }],
      },
    ];

    return (
      <div className={styles.headerBar}>
        <Space size="middle">
          <Dropdown menu={{ items: menuItems, className: 'logo-dropdown-menu' }} trigger={['hover']} onOpenChange={(open) => this.setState({ logoDropdownOpen: open })} align={{ offset: [-4, 0] }}>
            <span className={`${styles.logoWrap}${this.state.logoDropdownOpen ? ` ${styles.logoWrapActive}` : ''}`}>
              <img src="/favicon.ico" alt="Logo" className={`${styles.logoImage}${this.state.logoDropdownOpen ? ` ${styles.logoImageActive}` : ''}`} />
            </span>
          </Dropdown>
          <Popover
            content={this.renderTokenStats()}
            trigger="hover"
            placement="bottomLeft"
            overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '8px 8px', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <Tag className={styles.tokenStatsTag}>
              <DashboardOutlined className={styles.tokenStatsIcon} />
              {t('ui.tokenStats')}
            </Tag>
          </Popover>
          {this.props.activeProxyId && this.props.activeProxyId !== 'max' && (() => {
            const p = (this.props.proxyProfiles || []).find(x => x.id === this.props.activeProxyId);
            return p ? (
              <Tag className={styles.proxyProfileTag} onClick={() => this.setState({ proxyModalVisible: true })} style={{ cursor: 'pointer' }}>
                <SwapOutlined style={{ marginRight: 4, fontSize: 11 }} />
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
                    const maxTokens = calibrationTokens || contextWindow?.context_window_size || getModelMaxTokens(requests[i].body?.model || this.state.settingsModel);
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
            const ctxColor = contextPercent >= 80 ? '#ff4d4f' : contextPercent >= 60 ? '#faad14' : '#52c41a';

            return isLocalLog ? (
              <Tag className={`${styles.liveTag} ${styles.liveTagHistory}`}>
                <span className={styles.liveTagText}>{t('ui.historyLog', { file: localLogFile })}</span>
              </Tag>
            ) : (
              <Popover
                content={this.state._cachePopoverOpen ? this.renderCacheContentPopover(contextPercent) : <div className={styles.cachePopoverPlaceholder} />}
                trigger="hover"
                placement="bottomLeft"
                overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '8px 8px' }}
                onOpenChange={(open) => { this.setState({ _cachePopoverOpen: open }); if (!open) this._cacheScrollInited = false; }}
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
              color={updateInfo.type === 'completed' ? 'green' : 'orange'}
              closable
              onClose={() => onDismissUpdate && onDismissUpdate()}
            >
              {updateInfo.type === 'completed'
                ? t('ui.update.completed', { version: updateInfo.version })
                : t('ui.update.majorAvailable', { version: updateInfo.version })}
            </Tag>
          )}
        </Space>

        <Space size="middle">
          {countdownText && (
            <Tag style={{ background: '#2a2a2a', border: '1px solid #3a3a3a', color: countdownText === t('ui.cacheExpired') ? '#ff6b6b' : '#ccc' }}>
              {t('ui.cacheCountdown', { type: cacheType ? `(${cacheType})` : '' })}
              <strong className={styles.countdownStrong}>{countdownText}</strong>
            </Tag>
          )}
          {viewMode === 'chat' && cliMode && !isLocalLog && this.state.localUrl && (
            <>
              {this.state.countryFlag && (
                <Popover
                  content={this.state.countryInfo ? (
                    <div className={styles.countryInfoPopover}>
                      <div>{this.state.countryFlag} {this.state.countryInfo.country}</div>
                      {this.state.countryInfo.region && <div>{this.state.countryInfo.region}</div>}
                      {this.state.countryInfo.city && <div>{this.state.countryInfo.city}</div>}
                      {this.state.countryInfo.org && <div className={styles.countryInfoMeta}>{this.state.countryInfo.org}</div>}
                      {this.state.countryInfo.ip && <div className={styles.countryInfoMeta}>{this.state.countryInfo.ip}</div>}
                    </div>
                  ) : null}
                  trigger="hover"
                  placement="bottomRight"
                  overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '8px 12px' }}
                >
                  <Button className={styles.compactBtnNoBorder} icon={<span className={styles.countryFlagIcon}>{this.state.countryFlag}</span>} />
                </Popover>
              )}
              <Popover
              content={
                <div className={styles.qrcodePopover}>
                  <div className={styles.qrcodeTitle}>{t('ui.scanToCoding')}</div>
                  <QRCodeCanvas value={this.state.localUrl} size={200} bgColor="#141414" fgColor="#d9d9d9" level="M" />
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
              trigger="hover"
              placement="bottomRight"
              overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '8px 8px' }}
            >
              <Button
                className={styles.compactBtnNoBorder}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.svgIcon}>
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12.01" y2="18"/>
                  </svg>
                }
              />
            </Popover>
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
          </div>
        </Drawer>
        <Drawer
          title={t('ui.globalSettings')}
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
                  ? <Button size="small" style={{ color: '#52c41a', borderColor: '#52c41a' }}>{t('ui.processManagement.current')}</Button>
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
      </div>
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
              <Select size="small" style={{ width: '100%' }} value={editForm.activeModel || undefined} onChange={v => this.setState(prev => ({ editForm: { ...prev.editForm, activeModel: v } }))} placeholder={t('ui.proxy.activeModel')}>
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
