import React from 'react';
import { Tabs, Typography, Button, Tag, Empty, Space, Select, Popover, Tooltip, message } from 'antd';
import { CopyOutlined, FileTextOutlined, CodeOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import JsonViewer from './JsonViewer';
import ConceptHelp from './ConceptHelp';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { formatTokenCount, stripPrivateKeys, hasClaudeMdReminder, isClaudeMdReminder, hasSkillsReminder, isSkillsReminder, extractCachedContent } from '../utils/helpers';
import { classifyRequest } from '../utils/requestType';
import { isMainAgent, isSystemText } from '../utils/contentFilter';
import { restoreSlimmedEntry } from '../utils/entry-slim.js';
import AppHeader from './AppHeader';
import ContextTab from './ContextTab';
import styles from './DetailPanel.module.css';

const { Text, Paragraph } = Typography;

class DetailPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      bodyViewMode: { request: 'json', response: 'json', diff: 'json' },
      diffExpanded: false,
      requestHeadersExpanded: false,
      responseHeadersExpanded: false,
      reminderFilters: null,
      cacheHighlightIdx: null,
      cacheHighlightFading: false,
      cacheCollapsed: { tools: false, system: false, messages: false },
    };
  }

  _cacheUnbindScrollFade() {
    if (this._cacheOnScrollFade && this._cacheScrollEl) {
      this._cacheScrollEl.removeEventListener('scroll', this._cacheOnScrollFade);
      this._cacheOnScrollFade = null;
    }
  }

  _cacheClearAllTimers() {
    clearTimeout(this._cacheScrollSettleTimer);
    clearTimeout(this._cacheFadeClearTimer);
    clearTimeout(this._cacheAutoFadeTimer);
    clearTimeout(this._cacheHighlightDelayTimer);
    this._cacheUnbindScrollFade();
    if (this._cacheScrollEndHandler && this._cacheScrollEl) {
      this._cacheScrollEl.removeEventListener('scrollend', this._cacheScrollEndHandler);
      this._cacheScrollEndHandler = null;
    }
  }

  componentWillUnmount() {
    this._cacheClearAllTimers();
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
    // Auto-expand messages section if collapsed
    if (this.state.cacheCollapsed.messages) {
      this.setState(prev => ({ cacheCollapsed: { ...prev.cacheCollapsed, messages: false } }), () => this.scrollToCacheMsg(idx));
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

    this._cacheScrollEndHandler = () => {
      el.removeEventListener('scrollend', this._cacheScrollEndHandler);
      scrollDone = true;
      showHighlight();
    };
    el.addEventListener('scrollend', this._cacheScrollEndHandler, { once: true });
    this._cacheScrollSettleTimer = setTimeout(() => {
      el.removeEventListener('scrollend', this._cacheScrollEndHandler);
      scrollDone = true;
      showHighlight();
    }, 800);
    this._cacheHighlightDelayTimer = setTimeout(() => {
      minPassed = true;
      showHighlight();
    }, 500);

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (nextProps.request !== this.props.request) {
      const isMA = isMainAgent(nextProps.request);
      this.setState({ diffExpanded: isMA && !!nextProps.expandDiff, requestHeadersExpanded: false, responseHeadersExpanded: false, reminderFilters: null });
      // Clean up highlight timers when switching requests
      this._cacheClearAllTimers();
    }
    const onCacheTab = nextProps.currentTab === 'kv-cache-text';
    return (
      nextProps.request !== this.props.request ||
      nextProps.currentTab !== this.props.currentTab ||
      nextProps.onTabChange !== this.props.onTabChange ||
      nextProps.selectedIndex !== this.props.selectedIndex ||
      nextProps.expandDiff !== this.props.expandDiff ||
      nextProps.pendingCacheHighlight !== this.props.pendingCacheHighlight ||
      nextState.bodyViewMode !== this.state.bodyViewMode ||
      (onCacheTab && nextState.cacheHighlightIdx !== this.state.cacheHighlightIdx) ||
      (onCacheTab && nextState.cacheHighlightFading !== this.state.cacheHighlightFading) ||
      nextState.diffExpanded !== this.state.diffExpanded ||
      nextState.requestHeadersExpanded !== this.state.requestHeadersExpanded ||
      nextState.responseHeadersExpanded !== this.state.responseHeadersExpanded ||
      nextState.reminderFilters !== this.state.reminderFilters ||
      (onCacheTab && nextState.cacheCollapsed !== this.state.cacheCollapsed)
    );
  }

  componentDidUpdate(prevProps) {
    const pch = this.props.pendingCacheHighlight;
    if (pch && pch !== prevProps.pendingCacheHighlight) {
      // Wait for KV-Cache-Text tab to render and ref to bind
      setTimeout(() => {
        this.scrollToCacheMsg(pch.msgIdx);
        this.props.onCacheHighlightDone?.();
      }, 150);
    }
  }

  toggleBodyViewMode(type) {
    this.setState(prev => ({
      bodyViewMode: {
        ...prev.bodyViewMode,
        [type]: prev.bodyViewMode[type] === 'json' ? 'text' : 'json',
      },
    }));
  }

  copyBody(type) {
    const { request } = this.props;
    if (!request) return;
    let data;
    if (type === 'diff') {
      data = this._lastDiffResult;
    } else {
      data = type === 'request' ? request.body : request.response?.body;
    }
    if (data == null) return;
    const clean = typeof data === 'object' ? stripPrivateKeys(data) : data;
    const text = typeof clean === 'string' ? clean : JSON.stringify(clean, null, 2);
    navigator.clipboard.writeText(text).then(() => message.success(t('ui.copySuccess')));
  }

  renderHeaders(headers) {
    if (!headers || Object.keys(headers).length === 0) {
      return <Text type="secondary">{t('ui.noHeaders')}</Text>;
    }
    return (
      <div className={styles.headersContainer}>
        {Object.entries(headers).map(([key, value]) => (
          <div key={key} className={styles.headerRow}>
            <Text code className={styles.headerKey}>{key}</Text>
            {key === 'authorization' && <ConceptHelp doc="TranslateContextPollution" />}
            <Text type="secondary" className={styles.headerValue}>{String(value)}</Text>
          </div>
        ))}
      </div>
    );
  }

  getRequestExpandNode(data, type) {
    if (type !== 'request' || !data || typeof data !== 'object') return undefined;
    const { request, requests, selectedIndex } = this.props;
    if (!request) return undefined;
    const nextReq = requests && selectedIndex != null ? requests[selectedIndex + 1] : null;
    const { type: reqType } = classifyRequest(request, nextReq);

    // Build claudeMd expand set if active
    let claudeMdExpandSet = null;
    if (this.state.reminderFilters === 'claudeMd' && Array.isArray(data.messages)) {
      claudeMdExpandSet = new Set();
      claudeMdExpandSet.add(data.messages);
      for (const msg of data.messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = msg.content;
        if (typeof content === 'string') {
          if (isClaudeMdReminder(content)) {
            claudeMdExpandSet.add(msg);
          }
        } else if (Array.isArray(content)) {
          let hasMatch = false;
          for (const block of content) {
            if (block && block.type === 'text' && isClaudeMdReminder(block.text)) {
              claudeMdExpandSet.add(block);
              hasMatch = true;
            }
          }
          if (hasMatch) {
            claudeMdExpandSet.add(msg);
            claudeMdExpandSet.add(content);
          }
        }
      }
    }

    // Build skills expand set if active
    let skillsExpandSet = null;
    if (this.state.reminderFilters === 'skills' && Array.isArray(data.messages)) {
      skillsExpandSet = new Set();
      skillsExpandSet.add(data.messages);
      for (const msg of data.messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = msg.content;
        if (typeof content === 'string') {
          if (isSkillsReminder(content)) {
            skillsExpandSet.add(msg);
          }
        } else if (Array.isArray(content)) {
          let hasMatch = false;
          for (const block of content) {
            if (block && block.type === 'text' && isSkillsReminder(block.text)) {
              skillsExpandSet.add(block);
              hasMatch = true;
            }
          }
          if (hasMatch) {
            skillsExpandSet.add(msg);
            skillsExpandSet.add(content);
          }
        }
      }
    }

    const filterExpandSet = claudeMdExpandSet || skillsExpandSet;

    if (reqType === 'Preflight') {
      // Collect all object/array refs under messages and system[2] that should be expanded
      const expandRefs = new Set();
      const collectAll = (obj) => {
        if (obj && typeof obj === 'object') {
          expandRefs.add(obj);
          if (Array.isArray(obj)) obj.forEach(collectAll);
          else Object.values(obj).forEach(collectAll);
        }
      };
      if (Array.isArray(data.messages)) collectAll(data.messages);
      if (Array.isArray(data.system) && data.system.length >= 3) collectAll(data.system[2]);
      return (level, value, field) => {
        if (level < 2) return true;
        if (expandRefs.has(value)) return true;
        if (filterExpandSet && filterExpandSet.has(value)) return true;
        // expand system itself at root level so the 3rd item is visible
        if (level === 1 && field === 'system') return true;
        return false;
      };
    }

    if (reqType === 'MainAgent' && Array.isArray(data.messages) && data.messages.length === 1) {
      const msg = data.messages[0];
      const contentArr = msg && Array.isArray(msg.content) ? msg.content : null;
      const lastContent = contentArr && contentArr.length > 0 ? contentArr[contentArr.length - 1] : null;
      const expandRefs = new Set();
      const collectAll = (obj) => {
        if (obj && typeof obj === 'object') {
          expandRefs.add(obj);
          if (Array.isArray(obj)) obj.forEach(collectAll);
          else Object.values(obj).forEach(collectAll);
        }
      };
      if (lastContent) collectAll(lastContent);
      expandRefs.add(data.messages);
      if (msg && typeof msg === 'object') expandRefs.add(msg);
      if (contentArr) expandRefs.add(contentArr);
      return (level, value, field) => {
        if (level < 2) return true;
        if (expandRefs.has(value)) return true;
        if (filterExpandSet && filterExpandSet.has(value)) return true;
        return false;
      };
    }

    if (filterExpandSet) {
      return (level, value, field) => {
        if (level < 2) return true;
        if (filterExpandSet.has(value)) return true;
        return false;
      };
    }

    return undefined;
  }

  renderBody(data, type) {
    const { bodyViewMode } = this.state;
    if (data == null) return <Text type="secondary">{t('ui.noBody')}</Text>;

    if (typeof data === 'string' && data.includes('Streaming Response')) {
      return (
        <div className={styles.streamingBox}>
          <Text type="secondary">{t('ui.streamingResponse')}</Text>
        </div>
      );
    }

    const clean = typeof data === 'object' ? stripPrivateKeys(data) : data;
    const isJsonMode = bodyViewMode[type] === 'json';
    const expandNode = this.getRequestExpandNode(clean, type);

    return (
      <div>
        {isJsonMode ? (
          <JsonViewer
            data={clean}
            defaultExpand={type === 'response' ? 'all' : 'root'}
            expandNode={expandNode}
          />
        ) : (
          <pre className={styles.rawTextPre}>
            {typeof clean === 'string' ? clean : JSON.stringify(clean, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  getPrevMainAgentRequest() {
    const { requests, selectedIndex } = this.props;
    if (!requests || selectedIndex == null) return null;
    for (let i = selectedIndex - 1; i >= 0; i--) {
      if (isMainAgent(requests[i])) {
        const r = requests[i];
        return r._slimmed ? restoreSlimmedEntry(r, this.props.allRequests || requests) : r;
      }
    }
    return null;
  }

  computeDiff(prev, curr) {
    if (prev == null || curr == null) return null;
    if (typeof prev !== 'object' || typeof curr !== 'object') return null;
    const result = {};
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    for (const key of allKeys) {
      if (key.startsWith('_')) continue;
      if (!(key in prev)) {
        result[key] = curr[key];
      } else if (!(key in curr)) {
        continue; // removed keys not shown
      } else {
        const pStr = JSON.stringify(prev[key]);
        const cStr = JSON.stringify(curr[key]);
        if (pStr !== cStr) {
          if (key === 'messages' && Array.isArray(prev[key]) && Array.isArray(curr[key]) && curr[key].length > prev[key].length) {
            result[key] = curr[key].slice(prev[key].length);
          } else {
            result[key] = curr[key];
          }
        }
      }
    }
    return Object.keys(result).length ? result : null;
  }

  render() {
    let { request, currentTab, onTabChange } = this.props;

    if (!request) {
      return (
        <div className={styles.emptyState}>
          <Empty description="选择一个请求查看详情" />
        </div>
      );
    }

    // 按需还原被剪枝的老格式 entry 的 messages（不修改 state）
    if (request._slimmed) {
      request = restoreSlimmedEntry(request, this.props.allRequests || this.props.requests);
    }

    const time = new Date(request.timestamp).toLocaleString('zh-CN');
    const statusOk = request.response && request.response.status < 400;

    // Diff logic for mainAgent requests
    let diffBlock = null;
    if (isMainAgent(request)) {
      const prevRequest = this.getPrevMainAgentRequest();
      if (prevRequest) {
        const currSize = JSON.stringify(request.body).length;
        const prevSize = JSON.stringify(prevRequest.body).length;
        const isShrunk = currSize < prevSize;

        if (isShrunk) {
          diffBlock = (
            <div className={styles.diffSection}>
              <Text strong className={styles.diffToggle}
                onClick={() => this.setState(prev => ({ diffExpanded: !prev.diffExpanded }))}>
                Body Diff JSON <ConceptHelp doc="BodyDiffJSON" />{' '}{this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
              </Text>
              {this.state.diffExpanded && (
                <Text type="secondary">{t('ui.diffSessionChanged')}</Text>
              )}
            </div>
          );
        } else {
          const diffResult = stripPrivateKeys(this.computeDiff(prevRequest.body, request.body));
          if (diffResult) {
            this._lastDiffResult = diffResult;
            diffBlock = (
              <div className={styles.diffSection}>
                <div className={styles.diffHeaderRow}>
                  <Text strong className={styles.diffToggle}
                    onClick={() => this.setState(prev => ({ diffExpanded: !prev.diffExpanded }))}>
                    Body Diff JSON <ConceptHelp doc="BodyDiffJSON" />{' '}{this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
                  </Text>
                  {this.state.diffExpanded && (
                    <Space size="small" className={styles.diffSpaceRight}>
                      <Button
                        size="small"
                        icon={this.state.bodyViewMode.diff === 'json' ? <FileTextOutlined /> : <CodeOutlined />}
                        onClick={() => this.toggleBodyViewMode('diff')}
                      >
                        {this.state.bodyViewMode.diff === 'json' ? 'Text' : 'JSON'}
                      </Button>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => this.copyBody('diff')}
                      >
                        {t('ui.copy')}
                      </Button>
                    </Space>
                  )}
                </div>
              {this.state.diffExpanded && (
                <>
                  {this.state.bodyViewMode.diff === 'json' ? (
                    <JsonViewer data={diffResult} defaultExpand="all" />
                  ) : (
                    <pre className={styles.rawTextPre}>
                      {JSON.stringify(diffResult, null, 2)}
                    </pre>
                  )}
                </>
                )}
              </div>
            );
          }
        }
      }
    }

    const hasClaudeMd = hasClaudeMdReminder(request.body);
    const hasSkills = hasSkillsReminder(request.body);

    const tabItems = [
      {
        key: 'request',
        label: 'Request',
        children: (
          <div className={styles.tabContent}>
            <div className={styles.diffSection}>
              <Text strong className={styles.diffToggle}
                onClick={() => this.setState(prev => ({ requestHeadersExpanded: !prev.requestHeadersExpanded }))}>
                Headers {this.state.requestHeadersExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
              </Text>
              {this.state.requestHeadersExpanded && this.renderHeaders(request.headers)}
            </div>
            {diffBlock}
            <div>
              <div className={styles.bodyHeader}>
                <Text strong className={styles.bodyLabel}>Body<ConceptHelp doc="BodyFields" /></Text>
                <Space size="small">
                  {(hasClaudeMd || hasSkills) && (
                    <span className={styles.reminderFilterWrapper}>
                      <span className={styles.reminderLabel}>system-reminder:</span>
                      <Select
                        size="small"
                        className={styles.reminderSelect}
                        placeholder="filter"
                        value={this.state.reminderFilters || undefined}
                        onChange={val => this.setState({ reminderFilters: val || null })}
                        options={[
                          { label: 'CLAUDE.md', value: 'claudeMd', disabled: !hasClaudeMd },
                          { label: 'Skills', value: 'skills', disabled: !hasSkills },
                        ]}
                        popupMatchSelectWidth={false}
                        allowClear
                      />
                    </span>
                  )}
                  <Button
                    size="small"
                    icon={this.state.bodyViewMode.request === 'json' ? <FileTextOutlined /> : <CodeOutlined />}
                    onClick={() => this.toggleBodyViewMode('request')}
                  >
                    {this.state.bodyViewMode.request === 'json' ? 'Text' : 'JSON'}
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => this.copyBody('request')}
                  >
                    {t('ui.copy')}
                  </Button>
                </Space>
              </div>
              {this.renderBody(request.body, 'request')}
            </div>
          </div>
        ),
      },
      {
        key: 'response',
        label: 'Response',
        children: (
          <div className={styles.tabContent}>
            {request.response ? (
              <>
                <div className={styles.diffSection}>
                  <Text strong className={styles.diffToggle}
                    onClick={() => this.setState(prev => ({ responseHeadersExpanded: !prev.responseHeadersExpanded }))}>
                    Headers {this.state.responseHeadersExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
                  </Text>
                  {this.state.responseHeadersExpanded && this.renderHeaders(request.response.headers)}
                </div>
                <div>
                  <div className={styles.bodyHeader}>
                    <Text strong className={styles.bodyLabel}>Body<ConceptHelp doc="ResponseFields" /></Text>
                    <Space size="small">
                      <Button
                        size="small"
                        icon={this.state.bodyViewMode.response === 'json' ? <FileTextOutlined /> : <CodeOutlined />}
                        onClick={() => this.toggleBodyViewMode('response')}
                      >
                        {this.state.bodyViewMode.response === 'json' ? 'Text' : 'JSON'}
                      </Button>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => this.copyBody('response')}
                      >
                        {t('ui.copy')}
                      </Button>
                    </Space>
                  </div>
                  {this.renderBody(request.response.body, 'response')}
                </div>
              </>
            ) : (
              <Empty description={t('ui.responseNotCaptured')} />
            )}
          </div>
        ),
      },
      {
        key: 'kv-cache-text',
        label: <span>KV-Cache-Text <ConceptHelp doc="KVCacheContent" /></span>,
        children: (
          <div className={`${styles.tabContent} ${styles.cacheTabContent}`}>
            {(() => {
              const cached = extractCachedContent([request]);
              // 按请求 key 缓存最后一次有效的 token 值，避免同请求内闪烁且不串到别的请求
              const reqKey = request.timestamp + '|' + request.url;
              if (cached && (cached.cacheCreateTokens > 0 || cached.cacheReadTokens > 0)) {
                this._lastCachedTokensKey = reqKey;
                this._lastCachedTokens = { cacheCreateTokens: cached.cacheCreateTokens, cacheReadTokens: cached.cacheReadTokens };
              }
              if (!cached || (cached.system.length === 0 && cached.messages.length === 0 && cached.tools.length === 0)) {
                return <Empty description={t('ui.noCachedContent')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
              }
              const buildPlainText = () => {
                const parts = [];
                if (cached.tools.length > 0) { parts.push(`=== ${t('ui.tools')} ===`); cached.tools.forEach(t => parts.push(t)); }
                if (cached.system.length > 0) { parts.push(`\n=== ${t('ui.systemPrompt')} ===`); cached.system.forEach(t => parts.push(t)); }
                if (cached.messages.length > 0) { parts.push(`\n=== ${t('ui.messages')} ===`); cached.messages.forEach(t => parts.push(t)); }
                return parts.join('\n\n');
              };
              const userPrompts = cached.messages
                .map((text, i) => ({ text, msgIdx: i }))
                .filter(({ text }) => text.startsWith('[user]'))
                .map(({ text, msgIdx }) => {
                  const raw = text.replace(/^\[user\]\s*/, '').trim();
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
                <div className={styles.userPromptList}>
                  {userPrompts.map(({ cleaned, msgIdx }) => (
                    <div key={msgIdx} className={styles.userPromptItem}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-primary-bg-lighter)'; e.currentTarget.style.color = 'var(--text-white)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                      onClick={() => this.scrollToCacheMsg(msgIdx)}>
                      {cleaned}
                    </div>
                  ))}
                </div>
              ) : null;
              return (
                <div className={styles.cacheContent}>
                  {(() => {
                    const hasTokens = cached.cacheCreateTokens > 0 || cached.cacheReadTokens > 0;
                    const displayTokens = hasTokens ? cached : (this._lastCachedTokensKey === reqKey ? this._lastCachedTokens : null);
                    return (displayTokens || userPromptNavList) ? (
                    <div className={styles.cacheTokenBar}>
                      {displayTokens && <>
                        {t('ui.tokens')}: <span className={styles.cacheTokenWrite}>write {formatTokenCount(displayTokens.cacheCreateTokens)}</span>
                        {' / '}
                        <span className={styles.cacheTokenRead}>read {formatTokenCount(displayTokens.cacheReadTokens)}</span>
                        <Tooltip title={t('ui.copyAllCacheText')}>
                          <CopyOutlined
                            className={styles.cacheCopyIcon}
                            onClick={() => {
                              navigator.clipboard.writeText(buildPlainText()).then(() => {
                                message.success(t('ui.copied'));
                              }).catch(() => {});
                            }}
                          />
                        </Tooltip>
                      </>}
                      {userPromptNavList && (
                        <Popover content={userPromptNavList} trigger="hover" placement="left">
                          <span className={styles.userPromptNavBtn}>{t('ui.userPromptNav')}</span>
                        </Popover>
                      )}
                    </div>
                    ) : null;
                  })()}
                  <div className={styles.cacheScrollArea} ref={el => { this._cacheScrollEl = el; }}>
                    {cached.tools.length > 0 && (
                      <div className={styles.cacheSectionBlock}>
                        <div className={styles.cacheSectionHeader} onClick={() => this.setState(prev => ({ cacheCollapsed: { ...prev.cacheCollapsed, tools: !prev.cacheCollapsed.tools } }))}>
                          <span className={styles.cacheCollapseArrow} style={{ transform: this.state.cacheCollapsed.tools ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                          {t('ui.tools')} ({cached.tools.length})
                        </div>
                        {!this.state.cacheCollapsed.tools && cached.tools.map((text, i) => (
                          <pre key={i} className={styles.cachePre}>{text}</pre>
                        ))}
                      </div>
                    )}
                    {cached.system.length > 0 && (
                      <div className={styles.cacheSectionBlock}>
                        <div className={styles.cacheSectionHeader} onClick={() => this.setState(prev => ({ cacheCollapsed: { ...prev.cacheCollapsed, system: !prev.cacheCollapsed.system } }))}>
                          <span className={styles.cacheCollapseArrow} style={{ transform: this.state.cacheCollapsed.system ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                          {t('ui.systemPrompt')} ({cached.system.length})
                        </div>
                        {!this.state.cacheCollapsed.system && cached.system.map((text, i) => (
                          <pre key={i} className={styles.cachePreSystem}>{text}</pre>
                        ))}
                      </div>
                    )}
                    {cached.messages.length > 0 && (
                      <div className={styles.cacheSectionBlock}>
                        <div className={styles.cacheSectionHeader} onClick={() => this.setState(prev => ({ cacheCollapsed: { ...prev.cacheCollapsed, messages: !prev.cacheCollapsed.messages } }))}>
                          <span className={styles.cacheCollapseArrow} style={{ transform: this.state.cacheCollapsed.messages ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                          {t('ui.messages')} ({cached.messages.length})
                        </div>
                        {!this.state.cacheCollapsed.messages && cached.messages.map((text, i) => {
                          const isHl = i === this.state.cacheHighlightIdx;
                          const hlStyle = isHl
                            ? (this.state.cacheHighlightFading
                              ? { boxShadow: '0 0 10px rgba(22,104,220,0)', transition: 'box-shadow 3s ease-out', position: 'relative' }
                              : { boxShadow: '0 0 10px rgba(22,104,220,0.6)', transition: 'box-shadow 0.2s ease-in', position: 'relative' })
                            : {};
                          return (
                            <pre key={i} data-msg-idx={i} className={styles.cachePre} style={hlStyle}>
                              {isHl && (
                                <svg className={styles.cacheHighlightSvg} style={{ opacity: this.state.cacheHighlightFading ? 0 : 1, transition: this.state.cacheHighlightFading ? 'opacity 3s ease-out' : undefined }} preserveAspectRatio="none">
                                  <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="4" ry="4"
                                    fill="none" stroke="#1668dc" strokeWidth="1" strokeDasharray="6 4">
                                    <animate attributeName="stroke-dashoffset" from="0" to="-100" dur="4s" repeatCount="indefinite" />
                                  </rect>
                                </svg>
                              )}
                              {text}
                            </pre>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ),
      },
      {
        key: 'context',
        label: 'Context',
        children: (
          <div className={`${styles.tabContent} ${styles.cacheTabContent}`}>
            <ContextTab body={request.body} response={request.response?.body} />
          </div>
        ),
      },
    ];

    const usage = request.response?.body?.usage;
    const tokenStats = usage ? (() => {
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const totalInput = input + cacheCreate + cacheRead;
      const hitRate = totalInput > 0 ? ((cacheRead / totalInput) * 100).toFixed(1) : '0.0';
      return { input, output, cacheCreate, cacheRead, hitRate };
    })() : null;

    return (
      <div className={styles.container}>
        <div className={styles.urlSection}>
          <div className={styles.urlLeft}>
            <Paragraph
              className={styles.urlText}
              ellipsis={{ rows: 2, expandable: true }}
            >
              {request.url}
            </Paragraph>
            <Space size="small" wrap>
              <Tag color={request.method === 'POST' ? 'blue' : 'green'}>{request.method}</Tag>
              <Text type="secondary" className={styles.metaText}>🕐 {time}</Text>
              {request.duration && <Text type="secondary" className={styles.metaText}>⏱️ {request.duration}ms</Text>}
              {request.response && (
                <Tag color={statusOk ? 'success' : 'error'}>HTTP {request.response.status}</Tag>
              )}
            </Space>
          </div>
          {tokenStats && (
            <div className={styles.tokenStatsBox}>
              <div className={styles.tokenGrid}>
                <div className={styles.tokenRows}>
                  <div className={styles.tokenRow}>
                    <span className={styles.tokenLabel}>Token</span>
                    <span className={styles.tokenTd}>input: {formatTokenCount(tokenStats.input)}</span>
                    <span className={styles.tokenTd}>output: {formatTokenCount(tokenStats.output)}</span>
                  </div>
                  <div className={`${styles.tokenRow} ${styles.tokenRowBorder}`}>
                    <span className={styles.tokenLabel}>Cache</span>
                    <span className={styles.tokenTd}>create: {formatTokenCount(tokenStats.cacheCreate)}</span>
                    <span className={styles.tokenTd}>read: {formatTokenCount(tokenStats.cacheRead)}</span>
                  </div>
                </div>
                <div className={styles.tokenHitRate}>
                  <div>{tokenStats.hitRate}%</div>
                  <div className={styles.tokenHitRateLabel}>{t('ui.hitRate')}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <Tabs
          activeKey={currentTab}
          onChange={onTabChange}
          items={tabItems}
          size="small"
        />
      </div>
    );
  }
}

export default DetailPanel;
