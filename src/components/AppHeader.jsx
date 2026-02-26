import React from 'react';
import { Space, Tag, Button, Badge, Typography, Dropdown, Popover, Modal, Collapse, Drawer, Switch, Tabs } from 'antd';
import { MessageOutlined, FileTextOutlined, ImportOutlined, DownOutlined, DashboardOutlined, SaveOutlined, ExportOutlined, DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import { isSystemText, formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats } from '../utils/helpers';
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
    this.state = { countdownText: '', promptModalVisible: false, promptData: [], promptViewMode: 'original', settingsDrawerVisible: false, globalSettingsVisible: false };
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


  // 从文本中提取斜杠命令名（如 <command-name>/context</command-name> → /context）
  static extractSlashCommand(text) {
    const m = text.match(/<command-name>([\s\S]*?)<\/command-name>/i);
    if (!m) return null;
    const cmd = m[1].trim();
    return cmd.startsWith('/') ? cmd : `/${cmd}`;
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
        } else {
          const cmd = AppHeader.extractSlashCommand(text);
          if (cmd) slashCmd = cmd;
        }
      } else if (Array.isArray(msg.content)) {
        // 检测是否为 skill/command 展开的消息（含 <command-message> 标签）
        const hasCommand = msg.content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));
        // 分别收集纯用户文本和完整文本
        const userParts = [];
        const allParts = [];
        for (const b of msg.content) {
          if (b.type !== 'text' || !b.text?.trim()) continue;
          const text = b.text.trim();
          allParts.push(text);
          if (!isSystemText(text)) {
            if (/^Implement the following plan:/i.test(text)) continue;
            // skill 展开内容不作为用户 prompt
            if (hasCommand) continue;
            userParts.push(text);
          } else {
            const cmd = AppHeader.extractSlashCommand(text);
            if (cmd) slashCmd = cmd;
          }
        }
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
    const mainAgentRequests = requests.filter(r => r.mainAgent);
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
        {this.renderCacheRebuildStats()}
      </div>
    );

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
    if (activeReasons.length === 0) return null;

    const totalCount = activeReasons.reduce((sum, k) => sum + stats[k].count, 0);
    const totalCache = activeReasons.reduce((sum, k) => sum + stats[k].cacheCreate, 0);

    return (
      <div className={styles.rebuildCard}>
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

  render() {
    const { requestCount, viewMode, cacheType, onToggleViewMode, onImportLocalLogs, onLangChange, isLocalLog, localLogFile, projectName, collapseToolResults, onCollapseToolResultsChange, expandThinking, onExpandThinkingChange, expandDiff, onExpandDiffChange, filterIrrelevant, onFilterIrrelevantChange } = this.props;
    const { countdownText } = this.state;

    const menuItems = [
      {
        key: 'import-local',
        icon: <ImportOutlined />,
        label: t('ui.importLocalLogs'),
        onClick: onImportLocalLogs,
      },
      {
        key: 'save-log',
        icon: <SaveOutlined />,
        label: t('ui.saveLog'),
        onClick: () => {
          const a = document.createElement('a');
          a.href = '/api/download-log';
          a.download = '';
          a.click();
        },
      },
      {
        key: 'export-prompts',
        icon: <ExportOutlined />,
        label: t('ui.exportPrompts'),
        onClick: this.handleShowPrompts,
      },
      { type: 'divider' },
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
              <img src="https://mdn.alipayobjects.com/huamei_ffzdjp/afts/img/A*dCbiQqbv9FoAAAAAQgAAAAgAevJ6AQ/original" alt="Logo" className={styles.logoImage} />
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
          <Tag color={isLocalLog ? undefined : 'green'} className={`${styles.liveTag} ${isLocalLog ? styles.liveTagHistory : ''}`}>
            {!isLocalLog && <Badge status="processing" color="green" />}
            <span className={styles.liveTagText}>{isLocalLog ? t('ui.historyLog', { file: localLogFile }) : (t('ui.liveMonitoring') + (projectName ? `:${projectName}` : ''))}</span>
          </Tag>
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
        <Modal
          title={t('ui.globalSettings')}
          open={this.state.globalSettingsVisible}
          onCancel={() => this.setState({ globalSettingsVisible: false })}
          footer={null}
          width={400}
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
        </Modal>
      </div>
    );
  }
}

export default AppHeader;
