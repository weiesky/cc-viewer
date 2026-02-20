import React from 'react';
import { Tabs, Collapse, Typography, Button, Tag, Empty, Space, message } from 'antd';
import { CopyOutlined, FileTextOutlined, CodeOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import JsonViewer from './JsonViewer';
import { t } from '../i18n';
import styles from './DetailPanel.module.css';

const { Text, Paragraph } = Typography;

class DetailPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      bodyViewMode: { request: 'json', response: 'json' },
      diffExpanded: false,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (nextProps.request !== this.props.request) {
      this.setState({ diffExpanded: false });
    }
    return (
      nextProps.request !== this.props.request ||
      nextProps.currentTab !== this.props.currentTab ||
      nextProps.onTabChange !== this.props.onTabChange ||
      nextProps.requests !== this.props.requests ||
      nextProps.selectedIndex !== this.props.selectedIndex ||
      nextState.bodyViewMode !== this.state.bodyViewMode ||
      nextState.diffExpanded !== this.state.diffExpanded
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
    const data = type === 'request' ? request.body : request.response?.body;
    if (data == null) return;
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
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
            <Text type="secondary" className={styles.headerValue}>{String(value)}</Text>
          </div>
        ))}
      </div>
    );
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

    const isJsonMode = bodyViewMode[type] === 'json';

    return (
      <div>
        <div className={styles.bodyToolbar}>
          <Button
            size="small"
            icon={isJsonMode ? <FileTextOutlined /> : <CodeOutlined />}
            onClick={() => this.toggleBodyViewMode(type)}
          >
            {isJsonMode ? 'Text' : 'JSON'}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => this.copyBody(type)}
          >
            复制
          </Button>
        </div>
        {isJsonMode ? (
          <JsonViewer
            data={data}
            defaultExpand={type === 'response' ? 'all' : 'root'}
          />
        ) : (
          <pre className={styles.rawTextPre}>
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  getPrevMainAgentRequest() {
    const { requests, selectedIndex } = this.props;
    if (!requests || selectedIndex == null) return null;
    for (let i = selectedIndex - 1; i >= 0; i--) {
      if (requests[i].mainAgent) return requests[i];
    }
    return null;
  }

  computeDiff(prev, curr) {
    if (prev == null || curr == null) return null;
    if (typeof prev !== 'object' || typeof curr !== 'object') return null;
    const result = {};
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    for (const key of allKeys) {
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
    if (request.mainAgent) {
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
                Body Diff JSON {this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
              </Text>
              {this.state.diffExpanded && (
                <Text type="secondary">{t('ui.diffSessionChanged')}</Text>
              )}
            </div>
          );
        } else {
          const diffResult = this.computeDiff(prevRequest.body, request.body);
          if (diffResult) {
            diffBlock = (
              <div className={styles.diffSection}>
                <Text strong className={styles.diffToggle}
                  onClick={() => this.setState(prev => ({ diffExpanded: !prev.diffExpanded }))}>
                  Body Diff JSON {this.state.diffExpanded ? <DownOutlined className={styles.diffIcon} /> : <RightOutlined className={styles.diffIcon} />}
                </Text>
                {this.state.diffExpanded && (
                  <JsonViewer data={diffResult} defaultExpand="all" />
                )}
              </div>
            );
          }
        }
      }
    }

    const tabItems = [
      {
        key: 'request',
        label: 'Request',
        children: (
          <div className={styles.tabContent}>
            <Collapse
              ghost
              defaultActiveKey={[]}
              items={[{
                key: 'headers',
                label: 'Headers',
                children: this.renderHeaders(request.headers),
              }]}
              className={styles.collapseSpacing}
            />
            {diffBlock}
            <div>
              <Text strong className={styles.bodyLabel}>Body</Text>
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
                <Collapse
                  ghost
                  defaultActiveKey={[]}
                  items={[{
                    key: 'headers',
                    label: 'Headers',
                    children: this.renderHeaders(request.response.headers),
                  }]}
                  className={styles.collapseSpacing}
                />
                <div>
                  <Text strong className={styles.bodyLabel}>Body</Text>
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

    return (
      <div className={styles.container}>
        <div className={styles.urlSection}>
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
