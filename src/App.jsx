import React from 'react';
import { ConfigProvider, Layout, theme, Modal, Button, Checkbox, Spin, message } from 'antd';
import { UploadOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import AppBase, { styles } from './AppBase';
import { isMobile } from './env';
import { uploadFileAndGetPath } from './components/TerminalPanel';
import AppHeader from './components/AppHeader';
import RequestList from './components/RequestList';
import DetailPanel from './components/DetailPanel';
import ChatView from './components/ChatView';
import PanelResizer from './components/PanelResizer';
import OpenFolderIcon from './components/OpenFolderIcon';
import { t } from './i18n';
import { filterRelevantRequests, findPrevMainAgentTimestamp } from './utils/helpers';
import { isMainAgent } from './utils/contentFilter';
import { classifyRequest } from './utils/requestType';
import { apiUrl } from './utils/apiUrl';

class App extends AppBase {
  constructor(props) {
    super(props);
    // PC 专属 state
    Object.assign(this.state, {
      leftPanelWidth: 380,
      terminalVisible: true,
      currentTab: 'request',
      pendingCacheHighlight: null,
    });
  }

  // ─── PC 专属方法 ───────────────────────────────────────

  handleViewRequest = (index) => {
    this.setState({ viewMode: 'raw', selectedIndex: index, scrollCenter: true });
  };

  handleViewInChat = () => {
    this.setState(prev => {
      const filteredRequests = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
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
          const filtered = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
          return {
            viewMode: newMode,
            selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
            scrollCenter: true,
          };
        }
        return { viewMode: newMode, scrollCenter: true };
      }
      const filtered = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
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
    const filteredRequests = this.state.showAll ? this.state.requests : filterRelevantRequests(this.state.requests);
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

  _processJsonlFiles = (files) => {
    if (!files || files.length === 0) return;
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

  _isInternalDrag = (e) => e.dataTransfer.types.includes('text/x-preset-reorder');

  _onDragOver = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return;
    if (!this.state.isDragging) this.setState({ isDragging: true });
  };

  _onDragLeave = (e) => {
    const layout = this._layoutRef.current;
    if (layout && !layout.contains(e.relatedTarget)) {
      this.setState({ isDragging: false });
    }
  };

  _onDrop = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return;
    this.setState({ isDragging: false });
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    Promise.all(
      files.map(file =>
        uploadFileAndGetPath(file).then(path => ({ name: file.name, path }))
          .catch(err => { message.error(`${file.name}: ${err.message}`); return null; })
      )
    ).then(results => {
      const paths = results.filter(Boolean).map(r => `"${r.path}"`);
      if (paths.length > 0) {
        this.setState(prev => ({
          pendingUploadPaths: [...(prev.pendingUploadPaths || []), ...paths],
        }));
      }
    });
  };

  handleUploadPathsConsumed = () => {
    this.setState({ pendingUploadPaths: [] });
  };

  // ─── PC 渲染 ──────────────────────────────────────────

  render() {
    const { filteredRequests, selectedRequest, fileLoading, fileLoadingCount, mainAgentSessions, viewMode } = this.renderPrepare();
    const { selectedIndex, leftPanelWidth, currentTab } = this.state;

    // 工作区选择器模式
    if (this.state.workspaceMode) {
      return this.renderWorkspaceMode();
    }

    return (
      <ConfigProvider theme={this.themeConfig}>
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
          <Layout.Header className={styles.header}>
            <AppHeader
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
              collapseToolResults={this.state.collapseToolResults}
              onCollapseToolResultsChange={this.handleCollapseToolResultsChange}
              expandThinking={this.state.expandThinking}
              onExpandThinkingChange={this.handleExpandThinkingChange}
              showFullToolContent={this.state.showFullToolContent}
              onShowFullToolContentChange={this.handleShowFullToolContentChange}
              expandDiff={this.state.expandDiff}
              onExpandDiffChange={this.handleExpandDiffChange}
              filterIrrelevant={!this.state.showAll}
              onFilterIrrelevantChange={this.handleFilterIrrelevantChange}
              logDir={this.state.logDir}
              onLogDirChange={this.handleLogDirChange}
              updateInfo={this.state.updateInfo}
              onDismissUpdate={() => this.setState({ updateInfo: null })}
              cliMode={this.state.cliMode}
              sdkMode={this.state.sdkMode}
              terminalVisible={this.state.sdkMode ? false : this.state.terminalVisible}
              onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))}
              onReturnToWorkspaces={this.state.cliMode ? this.handleReturnToWorkspaces : null}
              contextWindow={this.state.contextWindow}
              onNavigateCacheMsg={this.handleNavigateCacheMsg}
              serverCachedContent={this.state.serverCachedContent || this._lastKvCacheContent}
              resumeAutoChoice={this.state.resumeAutoChoice}
              onResumeAutoChoiceToggle={this.handleResumeAutoChoiceToggle}
              onResumeAutoChoiceChange={this.handleResumeAutoChoiceChange}
              themeColor={this.state.themeColor}
              onThemeColorChange={this.handleThemeColorChange}
              proxyProfiles={this.state.proxyProfiles}
              activeProxyId={this.state.activeProxyId}
              defaultConfig={this.state.defaultConfig}
              onProxyProfileChange={this.handleProxyProfileChange}
            />
          </Layout.Header>

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
                    expandDiff={this.state.expandDiff}
                    pendingCacheHighlight={this.state.pendingCacheHighlight}
                    onCacheHighlightDone={this.handleCacheHighlightDone}
                  />
                </div>
              </div>
              )
            )}
            <div className={styles.chatViewWrapper} style={{ display: viewMode === 'chat' ? 'flex' : 'none' }}>
              <ChatView requests={filteredRequests} mainAgentSessions={mainAgentSessions} userProfile={this.state.userProfile} collapseToolResults={this.state.collapseToolResults} expandThinking={this.state.expandThinking} showFullToolContent={this.state.showFullToolContent} showThinkingSummaries={this.state.showThinkingSummaries} onViewRequest={this.handleViewRequest} scrollToTimestamp={this.state.chatScrollToTs} onScrollTsDone={this.handleScrollTsDone} cliMode={this._isLocalLog ? false : this.state.cliMode} sdkMode={this._isLocalLog ? false : this.state.sdkMode} terminalVisible={this._isLocalLog ? false : (this.state.sdkMode ? false : this.state.terminalVisible)} onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))} pendingUploadPaths={this.state.pendingUploadPaths} onUploadPathsConsumed={this.handleUploadPathsConsumed} fileLoading={this.state.fileLoading} isStreaming={this.state.isStreaming} hasMoreHistory={this.state.hasMoreHistory} loadingMore={this.state.loadingMore} onLoadMoreHistory={() => this.loadMoreHistory()} loadingSessionId={this.state.loadingSessionId} onLoadSession={(sid) => this.loadSession(sid)} lang={this.state.lang} />
            </div>
          </Layout.Content>
          <div className={styles.footer}>
            <div className={styles.footerRight}>
              <a href="https://github.com/weiesky/cc-viewer" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                <svg className={styles.footerIcon} viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                GitHub{this.state.githubStars != null ? ` ★ ${this.state.githubStars}` : ''}
              </a>
            </div>
          </div>
        </Layout>

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
          styles={{ body: { overflow: 'hidden' } }}
        >
          <div className={styles.modalActions}>
            <Button icon={<UploadOutlined />} onClick={this.handleLoadLocalJsonlFile}>
              {t('ui.loadLocalJsonl')}
            </Button>
            <Button
              size="small"
              type={this.state.selectedLogs.size > 1 ? 'primary' : 'default'}
              disabled={this.state.selectedLogs.size < 2}
              onClick={this.handleMergeLogs}
              className={styles.btnMarginLeft}
            >
              {t('ui.mergeLogs')}
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
      </ConfigProvider>
    );
  }
}

export default App;
