import React from 'react';
import { ConfigProvider, Layout, theme, Modal, Button, Checkbox, Spin, Alert, message, Tooltip } from 'antd';
import { UploadOutlined, DeleteOutlined, ReloadOutlined, FileZipOutlined } from '@ant-design/icons';
import AppBase, { styles } from './AppBase';
import { isMobile, isElectron, setViewMode } from './env';
import AppHeader from './components/dashboard/AppHeader';
import RequestList from './components/dashboard/RequestList';
import DetailPanel from './components/dashboard/DetailPanel';
import ChatView from './components/chat/ChatView';
import ApprovalModal from './components/approval/ApprovalModal';
import { TerminalWsProvider } from './components/terminal/TerminalWsContext';
import PanelResizer from './components/common/PanelResizer';
import OpenFolderIcon from './components/common/OpenFolderIcon';
import CountryFlag from './components/common/CountryFlag';
import UsageWindowPill from './components/dashboard/UsageWindowPill';
import { extractLatestPlanUsage } from './utils/rateLimitParser';
import { t } from './i18n';
import { filterRelevantRequests, visibleRequests, findPrevMainAgentTimestamp } from './utils/helpers';
import { isMainAgent } from './utils/contentFilter';
import { classifyRequest } from './utils/requestType';
import { apiUrl } from './utils/apiUrl';
import { BLUR_MASK_STYLE } from './utils/modalMask';

class App extends AppBase {
  constructor(props) {
    super(props);
    // Desktop-only state
    Object.assign(this.state, {
      leftPanelWidth: 380,
      terminalVisible: true,
      currentTab: 'context',
      pendingCacheHighlight: null,
      contextBarSlot: null, // DOM slot registered by TerminalPanel toolbar / ChatInputBar bottom button area; AppHeader renders the usage pill bar there via createPortal
      planUsage: null, // Plan usage snapshot (OAuth only): auto-follows the latest response, updates only when requests reference changes and the parsed value differs (see componentDidUpdate)
      installMethod: null, // 'electron' | 'brew' | 'npm': fetched on demand when opening the version-info modal, for precise upgrade command matching
    });
    this.appHeaderRef = React.createRef();
    this._getTokenStatsContent = (closeParent) => this.appHeaderRef.current?.renderTokenStats?.(closeParent) ?? null;
  }

  // Child components (TerminalPanel / ChatInputBar) register the usage-bar slot DOM via ref callback;
  // when terminalVisible toggles, old slot unregisters (ref(null)) → new slot registers (ref(el)),
  // and AppHeader responds to the prop change by relocating the portal.
  // Guards: 1) skip disconnected DOM nodes (defense against transient race); 2) skip setState when reference is unchanged (avoid render loop).
  setContextBarSlot = (el) => {
    if (el && !el.isConnected) return;
    if (el === this.state.contextBarSlot) return;
    this.setState({ contextBarSlot: el });
  };

  // Render upgrade guidance by install channel: electron uses GitHub Releases steps, brew / npm show the corresponding command.
  renderUpdateInstructions = (method) => {
    const codeStyle = { display: 'block', background: 'var(--bg-code)', padding: '8px 12px', borderRadius: 6, fontSize: 13 };
    if (method === 'electron') {
      return (<>
        <p style={{ marginTop: 12 }}><strong>{t('ui.update.electron')}</strong></p>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('ui.update.electronDesc')}</p>
        <ol style={{ color: 'var(--text-tertiary)', fontSize: 13, paddingLeft: 20, margin: '6px 0' }}>
          <li>{t('ui.update.step1')}</li>
          <li>{t('ui.update.step2')}</li>
          <li>{t('ui.update.step3')}</li>
        </ol>
      </>);
    }
    if (method === 'brew') {
      return (<>
        <p style={{ marginTop: 12 }}><strong>{t('ui.update.brew')}</strong></p>
        <code style={codeStyle}>brew upgrade cc-viewer</code>
      </>);
    }
    return (<>
      <p style={{ marginTop: 12 }}><strong>{t('ui.update.npm')}</strong></p>
      <code style={codeStyle}>npm install -g cc-viewer --registry=https://registry.npmjs.org</code>
    </>);
  };

  // 打开版本信息弹窗：按需拉取安装渠道（electron / brew / npm），用于精准匹配升级命令。
  // 渲染端 isElectron 为权威信号；非 electron 时才用后端探测区分 brew / npm。已拉取过则不重复请求。
  openUpdateModal = () => {
    this.setState({ updateModalVisible: true });
    if (this.state.installMethod != null) return;
    fetch(apiUrl('/api/version-info'))
      .then(r => r.json())
      .then(d => { if (d && d.installMethod) this.setState({ installMethod: d.installMethod }); })
      .catch(() => { /* 拉取失败 → 保持 null，渲染端按 npm 默认兜底 */ });
  };

  // 套餐用量:额度搭车在常规 Claude 响应头(anthropic-ratelimit-unified-*)上，SSE 已把最新响应
  // 喂进 requests，故无需独立请求/手动刷新——pill 自动跟随最新响应。仅在「有新响应」(requests 引用变化)
  // 时重算;解析值未变则不 setState，避免流式期间多余重渲染。
  // 注意:开关以「响应里是否解析出套餐用量」为准,不再用首请求的 authType 卡死——unified 头本身即证明是订阅账号,
  // 避免第一条请求碰巧未带 Authorization(走 x-api-key/Unknown) 时永久压住 pill。
  componentDidUpdate(prevProps, prevState) {
    if (super.componentDidUpdate) super.componentDidUpdate(prevProps, prevState);
    if (this._isLocalLog) return;
    const reqs = this.state.requests;
    if (!reqs || reqs.length === 0) return;
    // 无新响应且已有快照 → 跳过(extractLatestPlanUsage 从尾部命中，通常 O(1))。
    if (prevState && prevState.requests === reqs && this.state.planUsage) return;
    const pu = extractLatestPlanUsage(reqs);
    if (!pu) return;
    const sig = JSON.stringify(pu);
    if (sig === this._planUsageSig) return; // 值未变，避免重复 setState/重渲染
    this._planUsageSig = sig;
    this.setState({ planUsage: pu });
  }

  componentDidMount() {
    super.componentDidMount();
    // Electron：模式切换只跟随右上角开关（device mode 状态），不随窗口宽度变化；挂载时按当前状态对齐。
    // 浏览器：窗口 < 600px 时弹框提示切换到侧边栏(pad)模式。
    const inElectronTab = typeof window !== 'undefined' && !!window.tabBridge;
    if (inElectronTab) {
      this._onDeviceMode = (on) => {
        const target = on ? 'pad' : 'pc';
        if (localStorage.getItem('ccv_viewMode') !== target) setViewMode(target);
      };
      this._disposeDeviceMode = window.tabBridge.onDeviceModeChange?.(this._onDeviceMode);
      window.tabBridge.requestDeviceMode?.();
      return;
    }
    this._mqlNarrow = window.matchMedia('(max-width: 600px)');
    this._modeSwitchDialog = null;
    this._onNarrowChange = (e) => {
      if (e.matches) {
        this._modeSwitchDialog = Modal.confirm({
          title: t('ui.modeSwitchTitle'),
          content: t('ui.modeSwitchToSidebar'),
          okText: t('ui.ok'),
          onOk: () => { this._modeSwitchDialog = null; setViewMode('pad'); },
          onCancel: () => { this._modeSwitchDialog = null; },
        });
      } else if (this._modeSwitchDialog) {
        this._modeSwitchDialog.destroy();
        this._modeSwitchDialog = null;
      }
    };
    this._mqlNarrow.addEventListener('change', this._onNarrowChange);
  }

  componentWillUnmount() {
    if (this._disposeDeviceMode) { this._disposeDeviceMode(); this._disposeDeviceMode = null; }
    if (this._mqlNarrow) {
      this._mqlNarrow.removeEventListener('change', this._onNarrowChange);
    }
    if (this._modeSwitchDialog) {
      this._modeSwitchDialog.destroy();
      this._modeSwitchDialog = null;
    }
    super.componentWillUnmount();
  }

  // ─── PC 专属方法 ───────────────────────────────────────

  handleViewRequest = (index) => {
    this.setState({ viewMode: 'raw', selectedIndex: index, scrollCenter: true });
  };

  handleViewInChat = () => {
    this.setState(prev => {
      const filteredRequests = visibleRequests(prev.requests, prev.showAll);
      const selectedReq = filteredRequests[prev.selectedIndex];
      if (!selectedReq) return null;
      let targetTs = null;
      if (isMainAgent(selectedReq) && selectedReq.timestamp) {
        targetTs = selectedReq.timestamp;
      } else {
        const cls = classifyRequest(selectedReq);
        if ((cls.type === 'SubAgent' || cls.type === 'Teammate') && selectedReq.timestamp) {
          targetTs = selectedReq.timestamp;
        } else {
          const idx = prev.requests.indexOf(selectedReq);
          if (idx >= 0) {
            targetTs = findPrevMainAgentTimestamp(prev.requests, idx);
          }
        }
        if (!targetTs) {
          message.info(t('ui.cannotMap'));
        }
      }
      return { viewMode: 'chat', chatScrollToTs: targetTs };
    });
  };

  handleToggleViewMode = () => {
    this.setState(prev => {
      const newMode = prev.viewMode === 'raw' ? 'chat' : 'raw';
      if (newMode === 'raw') {
        if (prev.selectedIndex === null) {
          const filtered = visibleRequests(prev.requests, prev.showAll);
          return {
            viewMode: newMode,
            selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
            scrollCenter: true,
          };
        }
        return { viewMode: newMode, scrollCenter: true };
      }
      const filtered = visibleRequests(prev.requests, prev.showAll);
      const selectedReq = prev.selectedIndex != null ? filtered[prev.selectedIndex] : null;
      if (selectedReq) {
        let targetTs = null;
        if (isMainAgent(selectedReq) && selectedReq.timestamp) {
          targetTs = selectedReq.timestamp;
        } else {
          const cls = classifyRequest(selectedReq);
          if ((cls.type === 'SubAgent' || cls.type === 'Teammate') && selectedReq.timestamp) {
            targetTs = selectedReq.timestamp;
          } else {
            const idx = prev.requests.indexOf(selectedReq);
            if (idx >= 0) {
              targetTs = findPrevMainAgentTimestamp(prev.requests, idx);
            }
            if (!targetTs) {
              message.info(t('ui.cannotMap'));
            }
          }
        }
        return { viewMode: newMode, chatScrollToTs: targetTs };
      }
      return { viewMode: newMode, chatScrollToTs: null };
    }, () => {
      if (this.state.viewMode === 'chat' && this.state.terminalVisible && this.state.cliMode && !isMobile) {
        requestAnimationFrame(() => {
          const ta = document.querySelector('.xterm-helper-textarea');
          if (ta) ta.focus();
        });
      }
    });
  };

  handleTabChange = (key) => {
    this.setState({ currentTab: key });
  };

  handleCacheHighlightDone = () => { this.setState({ pendingCacheHighlight: null }); };

  handleNavigateCacheMsg = (msgIdx) => {
    const filteredRequests = visibleRequests(this.state.requests, this.state.showAll);
    let targetIdx = -1;
    for (let i = filteredRequests.length - 1; i >= 0; i--) {
      if (isMainAgent(filteredRequests[i])) { targetIdx = i; break; }
    }
    if (targetIdx < 0) return;
    this.setState({ selectedIndex: targetIdx, scrollCenter: true, currentTab: 'kv-cache-text', pendingCacheHighlight: { msgIdx, key: Date.now() } });
  };

  handleResize = (clientX) => {
    const container = this.mainContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const newWidth = clientX - rect.left;
    if (newWidth >= 250 && newWidth <= 800) {
      this.setState({ leftPanelWidth: newWidth });
    }
  };

  // ─── 文件处理 & 拖拽 ────────────────────────────────────

  handleLoadLocalJsonlFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jsonl';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      const totalSize = files.reduce((s, f) => s + f.size, 0);
      if (totalSize > 500 * 1024 * 1024) {
        message.error(t('ui.fileTooLarge'));
        return;
      }
      this.setState({ fileLoading: true, fileLoadingCount: 0 });
      let readCount = 0;
      const allEntries = [];
      const fileNames = [];
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const content = ev.target.result;
            const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
              try { return JSON.parse(entry); } catch { return null; }
            }).filter(Boolean);
            allEntries.push(...entries);
            fileNames.push(file.name);
          } catch {}
          readCount++;
          if (readCount === files.length) {
            this._finishLocalLoad(allEntries, fileNames);
          }
        };
        reader.readAsText(file);
      });
    };
    input.click();
  };

  // 拖拽上传（_isInternalDrag/_onDragOver/_onDragLeave/_onDrop/handleUploadPathsConsumed）
  // 与默认分发逻辑已上提到 AppBase；App 用基类默认行为（全落 pendingUploadPaths），无需 override。

  // ─── PC 渲染 ──────────────────────────────────────────

  render() {
    const { filteredRequests, selectedRequest, fileLoading, fileLoadingCount, mainAgentSessions, viewMode } = this.renderPrepare();
    // 「仅展示当前会话」锁定：把传给 ChatView 的会话切到「以 pin 会话结尾」，
    // 让 pin 会话从 ChatView 视角即最后一个会话（LR 卡片 / 审批 modal 等既有逻辑原样可用）。
    const { sessions: displaySessions, upperBoundTs: sessionUpperBoundTs } = this._displaySessionsFor(mainAgentSessions);
    const { selectedIndex, leftPanelWidth, currentTab } = this.state;
    const prefs = this._prefValues();

    // 工作区选择器模式
    if (this.state.workspaceMode) {
      return this.renderWorkspaceMode();
    }

    // 单条 /ws/terminal 的开启条件:非本地日志查看且非 SDK 模式即开。
    // (历史:合并前 ChatView 的 _inputWs 始终连;v1.6.226 一度绑到 cliMode || terminalVisible,
    // 在 mobile 隐藏终端 / web-only 浏览等场景下 hook bridge / PTY 提交全失败,触发"请求未送达"toast。
    // 回退到与合并前 _inputWs 始终连等价的语义。SDK 模式 ws 缺失是 latent issue,本次不处理。)
    const wsOpen = !this._isLocalLog && !this.state.sdkMode;

    return (
      <ConfigProvider theme={this.themeConfig}>
        <TerminalWsProvider open={wsOpen}>
        <ApprovalModal
          enabled={this.state.approvalPrefs.modalEnabled}
          soundEnabled={this.state.approvalPrefs.soundEnabled}
          voicePackPrefs={this.state.approvalPrefs.voicePack}
          approvalGlobal={this.state.approvalGlobal}
          dismissedIds={this.state.approvalDismissedIds}
          onDismiss={this.handleApprovalDismiss}
          onJumpTab={this.handleApprovalJumpTab}
          otherTabs={this.state.approvalOtherTabs}
        >
        {fileLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingText}>Loading...({fileLoadingCount})</div>
          </div>
        )}
        {this.state.isDragging && (
          <div className={styles.dragOverlay}>
            <div className={styles.dragOverlayContent}>
              <UploadOutlined className={styles.dragIcon} />
              <p>{t('ui.dragDropHint')}</p>
            </div>
          </div>
        )}
        <Layout className={styles.layout} ref={this._layoutRef} onDragOver={this._onDragOver} onDragLeave={this._onDragLeave} onDrop={this._onDrop}>
          <Layout.Header className={styles.header} inert={(typeof window !== 'undefined' && window.tabBridge) ? '' : undefined} style={(typeof window !== 'undefined' && window.tabBridge) ? { height: 0, minHeight: 0, padding: 0, overflow: 'hidden', border: 'none', lineHeight: 0 } : undefined}>
            <AppHeader
              ref={this.appHeaderRef}
              requestCount={filteredRequests.length}
              requests={filteredRequests}
              viewMode={viewMode}
              cacheExpireAt={this.state.cacheExpireAt}
              cacheType={this.state.cacheType}
              onToggleViewMode={this.handleToggleViewMode}
              onLangChange={this.handleLangChange}
              onImportLocalLogs={this.handleImportLocalLogs}
              isLocalLog={!!this._isLocalLog}
              localLogFile={this._localLogFile}
              projectName={this.state.projectName}
              instanceId={this.state.instanceId}
              filterIrrelevant={!this.state.showAll}
              onFilterIrrelevantChange={this.handleFilterIrrelevantChange}
              logDir={this.state.logDir}
              onLogDirChange={this.handleLogDirChange}
              cliMode={this.state.cliMode}
              sdkMode={this.state.sdkMode}
              terminalVisible={this.state.sdkMode ? false : this.state.terminalVisible}
              onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))}
              onReturnToWorkspaces={this.state.cliMode ? this.handleReturnToWorkspaces : null}
              contextWindow={this.state.contextWindow}
              contextBarOptimistic={this.state.contextBarOptimistic}
              contextBarLocked={this.state.contextBarLocked}
              onNavigateCacheMsg={this.handleNavigateCacheMsg}
              serverCachedContent={this.state.serverCachedContent || this._lastKvCacheContent}
              resumeAutoChoice={this.state.resumeAutoChoice}
              onResumeAutoChoiceToggle={this.handleResumeAutoChoiceToggle}
              onResumeAutoChoiceChange={this.handleResumeAutoChoiceChange}
              themeColor={this.state.themeColor}
              onThemeColorChange={this.handleThemeColorChange}
              displayScale={this.state.displayScale}
              onDisplayScaleChange={this.handleDisplayScaleChange}
              autoApproveSeconds={this.state.autoApproveSeconds}
              onAutoApproveChange={this.handleAutoApproveChange}
              approvalPrefs={this.state.approvalPrefs}
              onApprovalPrefsChange={this.handleApprovalPrefsChange}
              preferences={this.context?.preferences}
              onToggleProjectScoped={this.handleToggleProjectScoped}
              onRefreshProjectPrefs={this.refreshAllPrefs}
              onVoicePackChange={this.handleVoicePackChange}
              onApprovalSoundToggle={this.handleApprovalSoundToggle}
              approvalGlobal={this.state.approvalGlobal}
              approvalDismissedIds={this.state.approvalDismissedIds}
              approvalOwnPending={this.state.approvalOwnPending}
              onApprovalReopen={this.handleApprovalReopen}
              proxyProfiles={this.state.proxyProfiles}
              activeProxyId={this.state.activeProxyId}
              defaultConfig={this.state.defaultConfig}
              onProxyProfileChange={this.handleProxyProfileChange}
              retryConfig={this.state.retryConfig}
              retryDefaults={this.state.retryDefaults}
              onRetryConfigChange={this.handleRetryConfigChange}
              contextBarSlot={this.state.contextBarSlot}
              claudeProjectModel={this.state.claudeProjectModel}
            />
          </Layout.Header>
          {this.state.claudeMissing && (
            <Alert
              type="warning"
              showIcon
              banner
              message={t('ui.claudeMissing.title')}
              description={<span>{t('ui.claudeMissing.desc')}<br /><code style={{ background: 'var(--bg-code)', padding: '2px 6px', borderRadius: 3 }}>npm install -g @anthropic-ai/claude-code</code> <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>{t('ui.claudeMissing.or')}</span> <a href="https://claude.ai/download" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary-light)' }}>{t('ui.claudeMissing.native')}</a></span>}
            />
          )}
          <Layout.Content className={styles.content}>
            {viewMode === 'raw' && (
              filteredRequests.length === 0 ? (
                <div className={styles.guideContainer}>
                  <div className={styles.guideContent}>
                    <h2 className={styles.guideTitle}>{t('ui.guide.title')}</h2>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>1</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step1')}</p>
                        <code className={styles.guideCode}>{t('ui.guide.exampleQuestion')}</code>
                      </div>
                    </div>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>2</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step2')}</p>
                        <code className={styles.guideCode}>{t('ui.guide.troubleshootCmd')}</code>
                      </div>
                    </div>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>3</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step3')}</p>
                        <code className={styles.guideCode}>npm install -g @anthropic-ai/claude-code</code>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
              <div
                ref={this.mainContainerRef}
                className={styles.mainContainer}
              >
                <div className={styles.leftPanel} style={{ width: leftPanelWidth }}>
                  <div className={styles.leftPanelHeader}>
                    <span>{t('ui.requestList')}</span>
                    <span className={styles.leftPanelCount}>{t('ui.totalRequests', { count: filteredRequests.length })}</span>
                  </div>
                  <div className={styles.leftPanelBody}>
                    <RequestList
                      requests={filteredRequests}
                      selectedIndex={selectedIndex}
                      scrollCenter={this.state.scrollCenter}
                      onSelect={this.handleSelectRequest}
                      onScrollDone={this.handleScrollDone}
                      cacheLossMap={this._cacheLossMap}
                    />
                  </div>
                </div>

                <PanelResizer onResize={this.handleResize} />

                <div className={styles.rightPanel}>
                  <DetailPanel
                    request={selectedRequest}
                    requests={filteredRequests}
                    allRequests={this.state.requests}
                    selectedIndex={selectedIndex}
                    currentTab={currentTab}
                    onTabChange={this.handleTabChange}
                    onViewInChat={this.handleViewInChat}
                    expandDiff={prefs.expandDiff}
                    pendingCacheHighlight={this.state.pendingCacheHighlight}
                    onCacheHighlightDone={this.handleCacheHighlightDone}
                  />
                </div>
              </div>
              )
            )}
            <div className={styles.chatViewWrapper} style={{ display: viewMode === 'chat' ? 'flex' : 'none' }}>
              <ChatView {...this._settingsProps()} getTokenStatsContent={this._getTokenStatsContent} requests={filteredRequests} mainAgentSessions={displaySessions} sessionUpperBoundTs={sessionUpperBoundTs} streamingLatest={this.state.streamingLatest} userProfile={this.state.userProfile} collapseToolResults={prefs.collapseToolResults} expandThinking={prefs.expandThinking} showFullToolContent={prefs.showFullToolContent} onlyCurrentSession={this._isLocalLog ? false : prefs.onlyCurrentSession} isLocalLog={!!this._isLocalLog} showThinkingSummaries={prefs.showThinkingSummaries} onViewRequest={this.handleViewRequest} scrollToTimestamp={this.state.chatScrollToTs} onScrollTsDone={this.handleScrollTsDone} cliMode={this._isLocalLog ? false : this.state.cliMode} sdkMode={this._isLocalLog ? false : this.state.sdkMode} terminalVisible={this._isLocalLog ? false : (this.state.sdkMode ? false : this.state.terminalVisible)} onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))} pendingUploadPaths={this.state.pendingUploadPaths} onUploadPathsConsumed={this.handleUploadPathsConsumed} uploadingDrop={this.state.uploadingDrop} fileLoading={this.state.fileLoading} isStreaming={this.state.isStreaming} hasMoreHistory={this.state.hasMoreHistory} loadingMore={this.state.loadingMore} onLoadMoreHistory={() => this.loadMoreHistory()} loadingSessionId={this.state.loadingSessionId} onLoadSession={(sid) => this.loadSession(sid)} lang={this.state.lang} autoApproveSeconds={this.state.autoApproveSeconds} onAutoApproveChange={this.handleAutoApproveChange} planAutoApproveSeconds={this.state.approvalPrefs?.planAutoApproveSeconds} onPlanAutoApproveChange={this.handlePlanAutoApproveChange} onClearContextOptimistic={this.handleClearContextOptimistic} onUserMessageSent={this.handleUserMessageSent} onPendingAsk={this.handleApprovalAsk} onPendingPtyPlan={this.handleApprovalPtyPlan} ownTabId={this.state.ownTabId} projectName={this.state.projectName} setContextBarSlot={this.setContextBarSlot} />
            </div>
          </Layout.Content>
          <div className={styles.footer}>
            <CountryFlag />
            {/* 套餐用量:额度搭车在常规响应头上，自动跟随最新响应更新(仅有新响应时重算)。
                开关以「已解析出套餐用量」为准,authType==='OAuth' 仅作无数据时的占位兜底。 */}
            {!this._isLocalLog && (this.state.planUsage || this.state.defaultConfig?.authType === 'OAuth') && (
              <UsageWindowPill
                planUsage={this.state.planUsage}
                authType={this.state.defaultConfig?.authType}
              />
            )}
            <div className={styles.footerRight}>
              <a href="https://github.com/weiesky/cc-viewer" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                <svg className={styles.footerIcon} viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                GitHub{this.state.githubStars != null ? ` ★ ${this.state.githubStars}` : ''}
              </a>
              <span className={styles.footerSep}>|</span>
              <span className={styles.footerVersion} onClick={this.openUpdateModal} style={{ cursor: 'pointer' }}>
                v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''}
              </span>
              {this.state.updateInfo && (
                <Tooltip title={t('ui.update.majorAvailable', { version: this.state.updateInfo.version })} placement="top">
                  <span
                    className={styles.newBadgeText}
                    onClick={this.openUpdateModal}
                  >
                    {t('ui.update.newBadge')}
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        </Layout>

        <Modal
          title={t('ui.update.title')}
          open={this.state.updateModalVisible}
          onCancel={() => this.setState({ updateModalVisible: false })}
          footer={null}
          width={560}
        >
          <div style={{ lineHeight: 1.8 }}>
            <p><strong>{t('ui.update.current')}:</strong> v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''}</p>
            {this.state.updateInfo && <p><strong>{t('ui.update.latest')}:</strong> v{this.state.updateInfo.version}</p>}
            {/* 安装渠道：renderer 的 isElectron 为权威；否则用后端探测结果，拉取前/失败时按 npm 兜底 */}
            {this.renderUpdateInstructions(isElectron ? 'electron' : (this.state.installMethod || 'npm'))}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button type="primary" href="https://github.com/weiesky/cc-viewer/releases" target="_blank" rel="noopener noreferrer">
                {t('ui.update.goReleases')}
              </Button>
            </div>
          </div>
        </Modal>
        <Modal
          title={t('ui.resume.title')}
          open={this.state.resumeModalVisible}
          closable={false}
          maskClosable={false}
          keyboard={false}
          footer={
            <div>
              <div className={styles.resumeFooterRight}>
                <Button key="continue" type="primary" onClick={() => this.handleResumeChoice('continue')} className={styles.btnMarginRight}>
                  {t('ui.resume.continue')}
                </Button>
                <Button key="new" onClick={() => this.handleResumeChoice('new')}>
                  {t('ui.resume.new')}
                </Button>
              </div>
              <div className={styles.resumeFooterLeft}>
                <Checkbox
                  checked={this.state.resumeRememberChoice}
                  onChange={(e) => this.setState({ resumeRememberChoice: e.target.checked })}
                  className={styles.resumeCheckboxOpacity}
                >
                  <span className={styles.resumeCheckboxOpacity}>{t('ui.resume.remember')}</span>
                </Checkbox>
              </div>
            </div>
          }
        >
          <p>{t('ui.resume.message', { file: this.state.resumeFileName })}</p>
        </Modal>

        <Modal
          title={<span className={styles.modalTitleInline}><OpenFolderIcon apiEndpoint={apiUrl('/api/open-log-dir')} title={t('ui.openLogDir')} size={16} />{t('ui.importLocalLogs')}</span>}
          open={this.state.importModalVisible}
          onCancel={this.handleCloseImportModal}
          footer={null}
          width={1000}
          styles={{ body: { overflow: 'hidden' }, mask: BLUR_MASK_STYLE }}
        >
          <div className={styles.modalActions}>
            <Button size="small" icon={<UploadOutlined />} onClick={this.handleLoadLocalJsonlFile}>
              {t('ui.loadLocalJsonl')}
            </Button>
            <Button
              size="small"
              type={this.state.selectedLogs.size > 1 && ![...this.state.selectedLogs].some(f => f.endsWith('.jsonl.zip')) ? 'primary' : 'default'}
              disabled={this.state.selectedLogs.size < 2 || [...this.state.selectedLogs].some(f => f.endsWith('.jsonl.zip'))}
              onClick={this.handleMergeLogs}
              className={styles.btnMarginLeft}
            >
              {t('ui.mergeLogs')}
            </Button>
            <Button
              size="small"
              icon={<FileZipOutlined />}
              disabled={![...this.state.selectedLogs].some(f => f.endsWith('.jsonl'))}
              onClick={this.handleArchiveLogs}
              className={styles.btnMarginLeft}
            >
              {t('ui.archiveLogs')}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={this.state.selectedLogs.size === 0}
              onClick={this.handleDeleteLogs}
              className={styles.btnMarginLeft}
            >
              {t('ui.deleteLogs')}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined spin={this.state.refreshingStats} />}
              loading={this.state.refreshingStats}
              onClick={this.handleRefreshStats}
              className={styles.btnMarginLeft}
            >
              {t('ui.refreshStats')}
            </Button>
            <Checkbox
              className={styles.btnMarginLeft}
              checked={this.state.logShowAllInstances}
              onChange={this.handleToggleShowAllLogs}
            >
              {t('ui.showAllInstanceLogs')}
            </Checkbox>
          </div>
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
              <div className={styles.logListContainer}>
                {this.renderLogTable(currentLogs, false)}
              </div>
            );
          })()}
        </Modal>
        </ApprovalModal>
        </TerminalWsProvider>
      </ConfigProvider>
    );
  }
}

export default App;
