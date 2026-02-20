import React from 'react';
import { List, Tag, Empty } from 'antd';
import { t } from '../i18n';
import styles from './RequestList.module.css';

function formatTokens(n) {
  if (n == null || n === 0) return null;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function getModelShort(model) {
  if (!model) return null;
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8,}$/, '');
}

function getSubAgentType(req) {
  const body = req.body || {};
  const system = body.system;
  let sysText = '';
  if (typeof system === 'string') {
    sysText = system;
  } else if (Array.isArray(system)) {
    for (const s of system) {
      if (s && s.text) { sysText += s.text; }
    }
  }

  if (/Extract any file paths/i.test(sysText)) return 'Bash';
  if (/process Bash commands/i.test(sysText)) return 'Bash';
  if (/file search specialist/i.test(sysText)) return 'Task';

  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue;
    const c = msgs[i].content;
    let text = '';
    if (typeof c === 'string') { text = c; }
    else if (Array.isArray(c)) {
      for (const b of c) { if (b.type === 'text') { text = b.text || ''; break; } }
    }
    if (/^Command:/m.test(text)) return 'Bash';
    break;
  }

  return null;
}

class RequestList extends React.Component {
  render() {
    const { requests, selectedIndex, onSelect } = this.props;

    if (requests.length === 0) {
      return (
        <div className={styles.centerEmpty}>
          <Empty description={t('ui.waitingRequests')} />
        </div>
      );
    }

    return (
      <div className={styles.scrollContainer}>
        <List
          dataSource={requests}
          size="small"
          split={false}
          renderItem={(req, index) => {
            const time = new Date(req.timestamp).toLocaleTimeString('zh-CN');
            const isActive = index === selectedIndex;
            const statusOk = req.response && req.response.status < 400;
            const statusErr = req.response && req.response.status >= 400;

            const model = getModelShort(req.body?.model);
            const subType = !req.mainAgent ? getSubAgentType(req) : null;
            const usage = req.response?.body?.usage;
            const inputTokens = usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : null;
            const outputTokens = usage?.output_tokens || null;
            const cacheRead = usage?.cache_read_input_tokens || 0;
            const cacheCreate = usage?.cache_creation_input_tokens || 0;

            let urlShort = req.url;
            try {
              const u = new URL(req.url);
              urlShort = u.host + u.pathname;
            } catch {}

            return (
              <List.Item
                onClick={() => onSelect(index)}
                className={`${styles.listItem} ${isActive ? styles.listItemActive : ''}`}
              >
                <div className={styles.itemContent}>
                  <div className={styles.itemHeader}>
                    {req.mainAgent
                      ? <Tag color="orange" className={styles.tagNoMargin}>MainAgent</Tag>
                      : <Tag className={styles.tagNoMargin}>SubAgent{subType ? ':' + subType : ''}</Tag>
                    }
                    {model && <span className={styles.modelName} style={{ color: req.mainAgent ? '#d4822d' : '#8c8c8c' }}>{model}</span>}
                    <span className={styles.time}>{time}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.urlText} title={req.url}>{urlShort}</span>
                    {req.duration && <span className={styles.duration}>{req.duration}ms</span>}
                    {req.response && (
                      <span className={statusOk ? styles.statusOk : statusErr ? styles.statusErr : styles.statusDefault}>
                        {req.response.status}
                      </span>
                    )}
                  </div>
                  {usage && (
                    <div className={styles.usageBox}>
                      <div>token: output:{formatTokens(outputTokens) || 0}, input: {formatTokens(inputTokens) || 0}</div>
                      {(cacheRead > 0 || cacheCreate > 0) && (
                        <div>cache: {cacheRead > 0 ? `read:${formatTokens(cacheRead)}` : ''}{cacheRead > 0 && cacheCreate > 0 ? ', ' : ''}{cacheCreate > 0 ? `create:${formatTokens(cacheCreate)}` : ''}</div>
                      )}
                    </div>
                  )}
                </div>
              </List.Item>
            );
          }}
        />
      </div>
    );
  }
}

export default RequestList;
