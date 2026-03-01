import React from 'react';
import { Space, Tag, Button, Badge, Typography, Dropdown, Popover, Modal, Collapse, Drawer, Switch, Tabs, Spin, Tooltip } from 'antd';
import { MessageOutlined, FileTextOutlined, ImportOutlined, DownOutlined, DashboardOutlined, ExportOutlined, DownloadOutlined, SettingOutlined, BarChartOutlined } from '@ant-design/icons';
import { formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats } from '../utils/helpers';
import { isSystemText, classifyUserContent, isMainAgent } from '../utils/contentFilter';
import { classifyRequest, formatRequestTag } from '../utils/requestType';
import { t, getLang, setLang } from '../i18n';
import ConceptHelp from './ConceptHelp';
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

const { Text } = Typography;

class AppHeader extends React.Component {
  constructor(props) {
    super(props);
    this.state = { countdownText: '', promptModalVisible: false, promptData: [], promptViewMode: 'original', settingsDrawerVisible: false, globalSettingsVisible: false, projectStatsVisible: false, projectStats: null, projectStatsLoading: false };
    this._rafId = null;
    this._expiredTimer = null;
    this.updateCountdown = this.updateCountdown.bind(this);
  }

  componentDidMount() {
    this.startCountdown();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.cacheExpireAt !== this.props.cacheExpireAt) {
      this.startCountdown();
    }
  }

  componentWillUnmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
  }

  startCountdown() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._expiredTimer) clearTimeout(this._expiredTimer);
    if (!this.props.cacheExpireAt) {
      this.setState({ countdownText: '' });
      return;
    }
    this._rafId = requestAnimationFrame(this.updateCountdown);
  }

  updateCountdown() {
    const { cacheExpireAt } = this.props;
    if (!cacheExpireAt) {
      this.setState({ countdownText: '' });
      return;
    }

    const remaining = Math.max(0, cacheExpireAt - Date.now());
    if (remaining <= 0) {
      this.setState({ countdownText: t('ui.cacheExpired') });
      this._expiredTimer = setTimeout(() => {
        this.setState({ countdownText: '' });
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
    this.setState({ countdownText: text });
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
          if (/^Implement the following plan:/i.test(text)) continue;
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
          if (/^Implement the following plan:/i.test((b.text || '').trim())) continue;
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
                <td className={styles.th} style={{ textAlign: 'left' }}>Tool</td>
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
                <td className={styles.th} style={{ textAlign: 'left' }}>Skill</td>
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

  renderCacheRebuildStats() {
    const { requests = [] } = this.props;
    const stats = computeCacheRebuildStats(requests);
    const reasonKeys = ['ttl', 'system_change', 'tools_change', 'model_change', 'msg_truncated', 'msg_modified', 'key_change'];
    const i18nMap = {
      ttl: 'ttl', system_change: 'systemChange', tools_change: 'toolsChange',
      model_change: 'modelChange', msg_truncated: 'msgTruncated', msg_modified: 'msgModified', key_change: 'keyChange',
    };
    const activeReasons = reasonKeys.filter(k => stats[k].count > 0);

    const totalCount = activeReasons.reduce((sum, k) => sum + stats[k].count, 0);
    const totalCache = activeReasons.reduce((sum, k) => sum + stats[k].cacheCreate, 0);

    // SubAgent 统计
    const subAgentCounts = {};
    for (let i = 0; i < requests.length; i++) {
      const cls = classifyRequest(requests[i], requests[i + 1]);
      if (cls.type === 'SubAgent') {
        const label = cls.subType || 'Other';
        subAgentCounts[label] = (subAgentCounts[label] || 0) + 1;
      }
    }
    const subAgentEntries = Object.entries(subAgentCounts).sort((a, b) => b[1] - a[1]);

    const hasCacheStats = activeReasons.length > 0;
    const hasSubAgentStats = subAgentEntries.length > 0;
    if (!hasCacheStats && !hasSubAgentStats) return null;

    return (
      <div className={styles.toolStatsColumn}>
        {hasCacheStats && (
          <div className={hasSubAgentStats ? styles.modelCardSpaced : styles.modelCard}>
            <div className={styles.modelName}>MainAgent<ConceptHelp doc="MainAgent" /> {t('ui.cacheRebuildStats')}<ConceptHelp doc="CacheRebuild" /></div>
            <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={styles.th} style={{ textAlign: 'left' }}>{t('ui.cacheRebuild.reason')}</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
                <td className={styles.th}>{t('ui.cacheRebuild.cacheCreate')}</td>
              </tr>
            </thead>
            <tbody>
              {activeReasons.map(k => (
                <tr key={k} className={styles.rowBorder}>
                  <td className={styles.label}>{t(`ui.cacheRebuild.${i18nMap[k]}`)}</td>
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
          <div className={styles.modelCard}>
            <div className={styles.modelName}>{t('ui.subAgentStats')}</div>
            <table className={styles.statsTable}>
            <thead>
              <tr>
                <td className={styles.th} style={{ textAlign: 'left' }}>SubAgent</td>
                <td className={styles.th}>{t('ui.cacheRebuild.count')}</td>
              </tr>
            </thead>
            <tbody>
              {subAgentEntries.map(([name, count]) => (
                <tr key={name} className={styles.rowBorder}>
                  <td className={styles.label}>{name}</td>
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
    fetch('/api/project-stats')
      .then(res => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(data => this.setState({ projectStats: data, projectStatsLoading: false }))
      .catch(() => this.setState({ projectStats: null, projectStatsLoading: false }));
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
            <div className={styles.projectStatValue}>{summary?.sessionCount ?? 0}</div>
            <div className={styles.projectStatLabel}>{t('ui.projectStats.sessionCount')}</div>
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
    const { requestCount, requests = [], viewMode, cacheType, onToggleViewMode, onImportLocalLogs, onLangChange, isLocalLog, localLogFile, projectName, collapseToolResults, onCollapseToolResultsChange, expandThinking, onExpandThinkingChange, expandDiff, onExpandDiffChange, filterIrrelevant, onFilterIrrelevantChange, updateInfo, onDismissUpdate } = this.props;
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
      { type: 'divider' },
      {
        key: 'project-stats',
        icon: <BarChartOutlined />,
        label: t('ui.projectStats'),
        onClick: this.handleShowProjectStats,
      },
      {
        key: 'global-settings',
        icon: <SettingOutlined />,
        label: t('ui.globalSettings'),
        onClick: () => this.setState({ globalSettingsVisible: true }),
      },
    ];

    return (
      <div className={styles.headerBar}>
        <Space size="middle">
          <Dropdown menu={{ items: menuItems }} trigger={['hover']}>
            <Text strong className={styles.titleText}>
              <img src="/favicon.ico" alt="Logo" className={styles.logoImage} />
              CC-Viewer <DownOutlined className={styles.titleArrow} />
            </Text>
          </Dropdown>
          <Popover
            content={this.renderTokenStats()}
            trigger="hover"
            placement="bottomLeft"
            overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #3a3a3a', borderRadius: 8, padding: '8px 8px' }}
          >
            <Tag className={styles.tokenStatsTag}>
              <DashboardOutlined className={styles.tokenStatsIcon} />
              {t('ui.tokenStats')}
            </Tag>
          </Popover>
          {(() => {
            const inflightReqs = isLocalLog ? [] : (requests || []).filter(r => !r.response);
            const hasInflight = inflightReqs.length > 0;
            const liveDot = !isLocalLog ? (
              hasInflight ? (
                <svg className={styles.liveSpinner} width="10" height="10" viewBox="0 0 10 10">
                  <line x1="5" y1="1" x2="5" y2="9" stroke="#52c41a" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="1" y1="5" x2="9" y2="5" stroke="#52c41a" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="2.2" y1="2.2" x2="7.8" y2="7.8" stroke="#52c41a" strokeWidth="1.5" strokeLinecap="round" className={styles.liveSpinnerDiag} />
                  <line x1="7.8" y1="2.2" x2="2.2" y2="7.8" stroke="#52c41a" strokeWidth="1.5" strokeLinecap="round" className={styles.liveSpinnerDiag} />
                </svg>
              ) : <Badge status="processing" color="green" />
            ) : null;
            const noInflightTip = !isLocalLog && !hasInflight;
            const dotEl = liveDot && (
              <span className={styles.liveDotWrap}>
                {noInflightTip
                  ? <Tooltip title={t('ui.noInflightRequests')} placement="bottom">{liveDot}</Tooltip>
                  : liveDot}
              </span>
            );
            const liveTag = (
              <Tag color={isLocalLog ? undefined : 'green'} className={`${styles.liveTag} ${isLocalLog ? styles.liveTagHistory : ''}`}>
                {dotEl}
                <span className={styles.liveTagText}>{isLocalLog ? t('ui.historyLog', { file: localLogFile }) : (t('ui.liveMonitoring') + (projectName ? `:${projectName}` : ''))}</span>
              </Tag>
            );
            if (hasInflight) {
              const popContent = (
                <div className={styles.inflightList}>
                  {inflightReqs.map((req, i) => {
                    const cls = classifyRequest(req);
                    const tag = formatRequestTag(cls.type, cls.subType);
                    const model = req.body?.model || '';
                    const modelShort = model.includes('-') ? model.split('-').slice(0, 2).join('-') : model;
                    const time = new Date(req.timestamp).toLocaleTimeString('zh-CN');
                    return (
                      <div key={i} className={styles.inflightItem}>
                        <span className={styles.inflightTag}>{tag}</span>
                        <span className={styles.inflightModel}>{modelShort}</span>
                        <span className={styles.inflightTime}>{time}</span>
                      </div>
                    );
                  })}
                </div>
              );
              return <Popover content={popContent} title={t('ui.inflightRequests')} placement="bottom">{liveTag}</Popover>;
            }
            return liveTag;
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
            <Tag color={countdownText === t('ui.cacheExpired') ? 'red' : 'green'}>
              {t('ui.cacheCountdown', { type: cacheType ? `(${cacheType})` : '' })}
              <strong className={styles.countdownStrong}>{countdownText}</strong>
            </Tag>
          )}
          {viewMode === 'chat' && (
            <span className={styles.settingsBtn} onClick={() => this.setState({ settingsDrawerVisible: true })}>
              <SettingOutlined /> {t('ui.settings')}
            </span>
          )}
          <Dropdown
            trigger={['hover']}
            placement="bottom"
            menu={{
              items: LANG_OPTIONS.map(o => ({
                key: o.value,
                label: o.label,
                style: o.value === getLang() ? { color: '#3b82f6' } : {},
              })),
              onClick: ({ key }) => { setLang(key); if (onLangChange) onLangChange(); },
            }}
          >
            <span className={styles.langSelector}>
              {LANG_OPTIONS.find(o => o.value === getLang())?.short || 'zh'}
            </span>
          </Dropdown>
          <Button
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
          placement="right"
          width={320}
          open={this.state.settingsDrawerVisible}
          onClose={() => this.setState({ settingsDrawerVisible: false })}
        >
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
          title={<span><BarChartOutlined style={{ marginRight: 8 }} />{t('ui.projectStats')}</span>}
          placement="left"
          width={400}
          open={this.state.projectStatsVisible}
          onClose={() => this.setState({ projectStatsVisible: false })}
        >
          {this.renderProjectStatsContent()}
        </Drawer>
      </div>
    );
  }
}

export default AppHeader;
