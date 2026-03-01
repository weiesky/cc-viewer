import React from 'react';
import { Tabs, Typography, Button, Tag, Empty, Space, Tooltip, Select, message } from 'antd';
import { CopyOutlined, FileTextOutlined, CodeOutlined, RightOutlined, DownOutlined, CloseOutlined } from '@ant-design/icons';
import JsonViewer from './JsonViewer';
import ConceptHelp from './ConceptHelp';
import { t } from '../i18n';
import { formatTokenCount, stripPrivateKeys, hasClaudeMdReminder, isClaudeMdReminder, hasSkillsReminder, isSkillsReminder } from '../utils/helpers';
import { classifyRequest } from '../utils/requestType';
import { isMainAgent } from '../utils/contentFilter';
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
      diffTooltipDismissed: false,
      reminderFilters: null,
    };
  }

  componentDidMount() {
    fetch('/api/preferences').then(r => r.json()).then(prefs => {
      if (prefs.diffTooltipDismissed) this.setState({ diffTooltipDismissed: true });
    }).catch(() => {});
  }

  dismissDiffTooltip() {
    this.setState({ diffTooltipDismissed: true });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diffTooltipDismissed: true }),
    }).catch(() => {});
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (nextProps.request !== this.props.request) {
      const isMA = isMainAgent(nextProps.request);
      this.setState({ diffExpanded: isMA && !!nextProps.expandDiff, requestHeadersExpanded: false, responseHeadersExpanded: false, reminderFilters: null });
    }
    return (
      nextProps.request !== this.props.request ||
      nextProps.currentTab !== this.props.currentTab ||
      nextProps.onTabChange !== this.props.onTabChange ||
      nextProps.selectedIndex !== this.props.selectedIndex ||
      nextProps.expandDiff !== this.props.expandDiff ||
      nextState.bodyViewMode !== this.state.bodyViewMode ||
      nextState.diffExpanded !== this.state.diffExpanded ||
      nextState.requestHeadersExpanded !== this.state.requestHeadersExpanded ||
      nextState.responseHeadersExpanded !== this.state.responseHeadersExpanded ||
      nextState.diffTooltipDismissed !== this.state.diffTooltipDismissed ||
      nextState.reminderFilters !== this.state.reminderFilters
    );
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
      if (isMainAgent(requests[i])) return requests[i];
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
    const { request, currentTab, onTabChange } = this.props;

    if (!request) {
      return (
        <div className={styles.emptyState}>
          <Empty description="选择一个请求查看详情" />
        </div>
      );
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
              <Tooltip
                title={!this.state.diffTooltipDismissed ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ flex: 1 }}>{t('ui.diffTooltip')}</span>
                    <CloseOutlined style={{ cursor: 'pointer', fontSize: 10, marginTop: 2, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); this.dismissDiffTooltip(); }} />
                  </div>
                ) : null}
                placement="top" color="#000"
                overlayStyle={{ maxWidth: 340 }}
                overlayInnerStyle={{ fontSize: 12, color: '#999' }}
              >                <Text strong className={styles.diffToggle}
                  onClick={() => this.setState(prev => ({ diffExpanded: !prev.diffExpanded }))}>
                  Body Diff JSON <ConceptHelp doc="BodyDiffJSON" />{' '}{this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
                </Text>
              </Tooltip>
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
              <Tooltip
                title={!this.state.diffTooltipDismissed ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ flex: 1 }}>{t('ui.diffTooltip')}</span>
                    <CloseOutlined style={{ cursor: 'pointer', fontSize: 10, marginTop: 2, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); this.dismissDiffTooltip(); }} />
                  </div>
                ) : null}
                placement="top" color="#000"
                overlayStyle={{ maxWidth: 340 }}
                overlayInnerStyle={{ fontSize: 12, color: '#999' }}
              >                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong className={styles.diffToggle}
                    onClick={() => this.setState(prev => ({ diffExpanded: !prev.diffExpanded }))}>
                    Body Diff JSON <ConceptHelp doc="BodyDiffJSON" />{' '}{this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
                  </Text>
                  {this.state.diffExpanded && (
                    <Space size="small" style={{ marginLeft: 'auto' }}>
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
              </Tooltip>
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
        key: 'context',
        label: 'Context',
        children: (
          <div className={styles.tabContent} style={{ height: 'calc(100vh - 220px)', minHeight: 400 }}>
            <ContextTab body={request.body} />
          </div>
        ),
      },
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
                <Text strong className={styles.bodyLabel}>Body</Text>
                <Space size="small">
                  {(hasClaudeMd || hasSkills) && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#888', fontSize: 12, fontFamily: 'monospace' }}>system-reminder:</span>
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
                    <Text strong className={styles.bodyLabel}>Body</Text>
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
          tabBarExtraContent={
            this.props.onViewInChat && (
              <button
                className={styles.viewInChatBtn}
                onClick={this.props.onViewInChat}
              >
                {t('ui.viewInChat')}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 4 }}>
                  <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )
          }
        />
      </div>
    );
  }
}

export default DetailPanel;
