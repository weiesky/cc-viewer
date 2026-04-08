import React from 'react';
import { ConfigProvider, Spin, Button, Badge, Switch, Select } from 'antd';
import { BranchesOutlined, DownloadOutlined, DeleteOutlined, RollbackOutlined, ReloadOutlined } from '@ant-design/icons';
import AppBase, { styles } from './AppBase';
import { isIOS } from './env';
import { isMainAgent, isSystemText, classifyUserContent } from './utils/contentFilter';
import ChatView from './components/ChatView';
import TerminalPanel from './components/TerminalPanel';
import ToolApprovalPanel from './components/ToolApprovalPanel';
import MobileGitDiff from './components/MobileGitDiff';
import MobileStats from './components/MobileStats';
import OpenFolderIcon from './components/OpenFolderIcon';
import { t } from './i18n';
import { apiUrl } from './utils/apiUrl';

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
      mobilePromptVisible: false,
      mobileTerminalVisible: false,
      globalPermission: null,     // { permission, handlers } — 全局权限审批浮层
      globalPlanApproval: null,   // { plan, handlers } — 全局计划审批浮层
    });
  }

  componentDidMount() {
    super.componentDidMount();
    // iOS 虚拟键盘弹出时，Safari 会滚动整个文档将页面上推，
    // 导致导航栏消失在视口之外。通过 visualViewport 的 resize + scroll
    // 事件同步可见区域的高度和偏移，用 fixed 定位将布局锁定在可见区域内。
    if (isIOS && window.visualViewport) {
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
  }

  componentWillUnmount() {
    if (this._onVisualViewportChange && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._onVisualViewportChange);
      window.visualViewport.removeEventListener('scroll', this._onVisualViewportChange);
    }
    super.componentWillUnmount();
  }

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
        const text = msg.content.trim();
        if (!text) continue;
        if (!isSystemText(text)) {
          if (/Implement the following plan:/i.test(text)) continue;
          userMsgs.push(text);
          fullTexts.push(text);
        }
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

  render() {
    const { filteredRequests, fileLoading, fileLoadingCount, mainAgentSessions } = this.renderPrepare();

    // 工作区选择器模式
    if (this.state.workspaceMode) {
      return this.renderWorkspaceMode();
    }

    const mobileIsLocalLog = !!this._isLocalLog;

    return (
      <div className={styles.mobileCLIRoot} ref={this._layoutRef}>
        <div className={styles.mobileCLIHeader}>
          <div className={styles.mobileCLIHeaderLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => this.setState(prev => ({ mobileMenuVisible: !prev.mobileMenuVisible }))}
              aria-label={t('ui.mobileMenu')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <Badge status="processing" color="green" />
            <span className={styles.mobileCLIStatusLabel}>{mobileIsLocalLog ? t('ui.historyLog', { file: this._localLogFile }) : (t('ui.liveMonitoring') + (this.state.projectName ? `: ${this.state.projectName}` : ''))}</span>
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
            ) : (
              <Button
                type="text"
                size="small"
                icon={<BranchesOutlined />}
                onClick={() => this.setState(prev => ({ mobileGitDiffVisible: !prev.mobileGitDiffVisible, mobileChatVisible: false, mobileTerminalVisible: false, mobileStatsVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }))}
                style={{ color: this.state.mobileGitDiffVisible ? 'var(--color-primary)' : 'var(--text-tertiary)', fontSize: 12 }}
              >
                {this.state.mobileGitDiffVisible ? t('ui.mobileGitDiffExit') : t('ui.mobileGitDiffBrowse')}
              </Button>
            )}
            {!mobileIsLocalLog && (
              <Button
                type="text"
                size="small"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>}
                onClick={() => this.setState(prev => ({ mobileTerminalVisible: !prev.mobileTerminalVisible, mobileGitDiffVisible: false, mobileStatsVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }))}
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
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ mobileMenuVisible: false, mobileLogMgmtVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileTerminalVisible: false, mobileSettingsVisible: false, mobilePromptVisible: false }); this.handleImportLocalLogs(); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  {t('ui.logManagement')}
                </button>
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ mobileMenuVisible: false, mobileStatsVisible: true, mobileGitDiffVisible: false, mobileChatVisible: false, mobileTerminalVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false, mobilePromptVisible: false }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  {t('ui.tokenStats')}
                </button>
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ mobileMenuVisible: false, mobileSettingsVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileTerminalVisible: false, mobileLogMgmtVisible: false, mobilePromptVisible: false }); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t('ui.settings')}
                </button>
                <button
                  className={styles.mobileMenuItem}
                  onClick={() => { this.setState({ mobileMenuVisible: false, mobilePromptVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileTerminalVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }); }}
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
                  <div className={styles.mobileLoadingLabel}>{t('ui.loadingChat')}{fileLoadingCount > 0 ? ` (${fileLoadingCount})` : ''}</div>
                </div>
              )}
              <ConfigProvider theme={this.themeConfig}>
                <div className={styles.mobileChatInner}>
                  <ChatView
                    requests={filteredRequests}
                    mainAgentSessions={mainAgentSessions}
                    userProfile={this.state.userProfile}
                    collapseToolResults={this.state.collapseToolResults}
                    expandThinking={this.state.expandThinking}
                    showFullToolContent={this.state.showFullToolContent}
                    showThinkingSummaries={this.state.showThinkingSummaries}
                    onViewRequest={null}
                    scrollToTimestamp={null}
                    onScrollTsDone={() => {}}
                    cliMode={this.state.cliMode}
                    sdkMode={this.state.sdkMode}
                    terminalVisible={false}
                    mobileChatVisible={true}
                    fileLoading={this.state.fileLoading}
                    isStreaming={this.state.isStreaming}
                    hasMoreHistory={this.state.hasMoreHistory}
                    loadingMore={this.state.loadingMore}
                    onLoadMoreHistory={() => this.loadMoreHistory()}
                    loadingSessionId={this.state.loadingSessionId}
                    onLoadSession={(sid) => this.loadSession(sid)}
                    onPendingPermission={this.handlePendingPermission}
                    onPendingPlanApproval={this.handlePendingPlanApproval}
                  />
                </div>
              </ConfigProvider>
            </>
          )}
          {!mobileIsLocalLog && (
            <div className={`${styles.mobileChatOverlay} ${this.state.mobileTerminalVisible ? styles.mobileChatOverlayVisible : ''}`}>
              <TerminalPanel />
            </div>
          )}
          <div className={`${styles.mobileGitDiffOverlay} ${this.state.mobileGitDiffVisible ? styles.mobileGitDiffOverlayVisible : ''}`}>
            <div className={styles.mobileGitDiffInner}>
              <MobileGitDiff visible={this.state.mobileGitDiffVisible} />
            </div>
          </div>
          <div className={`${styles.mobileStatsOverlay} ${this.state.mobileStatsVisible ? styles.mobileStatsOverlayVisible : ''}`}>
            <div className={styles.mobileStatsInner}>
              <MobileStats
                requests={filteredRequests}
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
                type={this.state.selectedLogs.size >= 2 ? 'primary' : 'default'}
                disabled={this.state.selectedLogs.size < 2}
                onClick={this.handleMergeLogs}
                style={this.state.selectedLogs.size < 2 ? { color: 'var(--text-muted)', borderColor: 'var(--border-light)' } : undefined}
              >
                {t('ui.mergeLogs')}
              </Button>
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
                const currentLogs = this.state.localLogs[this.state.currentProject];
                if (!currentLogs || currentLogs.length === 0) {
                  return (
                    <div className={styles.emptyCenter}>
                      {t('ui.noLogs')}
                    </div>
                  );
                }
                return (
                  <ConfigProvider theme={this.themeConfig}>
                  <div className={styles.logListContainer}>
                    {this.renderLogTable(currentLogs, true)}
                  </div>
                  </ConfigProvider>
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
              <div className={styles.mobileSettingsSectionTitle}>{t('ui.chatDisplaySwitches')}</div>
              <div className={styles.mobileSettingsRow}>
                <span className={styles.mobileSettingsLabel}>{t('ui.collapseToolResults')}</span>
                <Switch
                  checked={!!this.state.collapseToolResults}
                  onChange={this.handleCollapseToolResultsChange}
                />
              </div>
              <div className={styles.mobileSettingsRow}>
                <span className={styles.mobileSettingsLabel}>{t('ui.expandThinking')}</span>
                <Switch
                  checked={!!this.state.expandThinking}
                  onChange={this.handleExpandThinkingChange}
                />
              </div>
              <div className={styles.mobileSettingsRow}>
                <span className={styles.mobileSettingsLabel}>{t('ui.showFullToolContent')}</span>
                <Switch
                  checked={!!this.state.showFullToolContent}
                  onChange={this.handleShowFullToolContentChange}
                />
              </div>
              <div className={styles.mobileSettingsSectionTitle}>{t('ui.themeColor')}</div>
              <div className={styles.mobileSettingsRow}>
                <Select
                  size="small"
                  value={this.state.themeColor || 'dark'}
                  onChange={this.handleThemeColorChange}
                  options={[
                    { label: t('ui.themeColor.dark'), value: 'dark' },
                    { label: t('ui.themeColor.light'), value: 'light' },
                  ]}
                  style={{ width: 140 }}
                />
              </div>
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
    );
  }
}

export default Mobile;
