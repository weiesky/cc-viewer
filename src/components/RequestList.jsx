import React from 'react';
import { List, Tag, Empty } from 'antd';
import { t } from '../i18n';
import { formatTokenCount, getModelShort } from '../utils/helpers';
import { classifyRequest, formatRequestTag } from '../utils/requestType';
import styles from './RequestList.module.css';

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
            const nextReq = index + 1 < requests.length ? requests[index + 1] : null;
            const { type: reqType, subType } = classifyRequest(req, nextReq);
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
                    {reqType === 'MainAgent'
                      ? <Tag color="orange" className={styles.tagNoMargin}>MainAgent</Tag>
                      : reqType === 'Plan'
                        ? <Tag className={styles.tagNoMargin} style={{ color: '#a33', borderColor: '#a33', backgroundColor: '#000' }}>{formatRequestTag(reqType, subType)}</Tag>
                        : reqType === 'Count' || reqType === 'Preflight'
                          ? <Tag className={styles.tagNoMargin} style={{ color: '#666', borderColor: '#444', backgroundColor: '#000' }}>{reqType}</Tag>
                          : <Tag className={styles.tagNoMargin}>{formatRequestTag(reqType, subType)}</Tag>
                    }
                    {model && <span className={styles.modelName} style={{ color: reqType === 'MainAgent' ? '#d4822d' : '#8c8c8c' }}>{model}</span>}
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
                      <div>token: output:{formatTokenCount(outputTokens) || 0}, input: {formatTokenCount(inputTokens) || 0}</div>
                      {(cacheRead > 0 || cacheCreate > 0) && (
                        <div>cache: {cacheRead > 0 ? `read:${formatTokenCount(cacheRead)}` : ''}{cacheRead > 0 && cacheCreate > 0 ? ', ' : ''}{cacheCreate > 0 ? `create:${formatTokenCount(cacheCreate)}` : ''}</div>
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
