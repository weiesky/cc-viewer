import React from 'react';
import { List, Tag, Empty } from 'antd';

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

  // Bash 工具相关：命令执行、文件路径提取、权限检查
  if (/Extract any file paths/i.test(sysText)) return 'Bash';
  if (/process Bash commands/i.test(sysText)) return 'Bash';

  // Task 工具相关：Explore 子代理
  if (/file search specialist/i.test(sysText)) return 'Task';

  // 从 user message 判断
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Empty description="等待请求..." />
        </div>
      );
    }

    return (
      <div style={{ overflow: 'auto', height: '100%' }}>
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
                style={{
                  cursor: 'pointer',
                  padding: '8px 12px',
                  background: isActive ? '#1a2332' : 'transparent',
                  borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent',
                  borderBottom: '1px solid #1f1f1f',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#151515';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ width: '100%', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                    {req.mainAgent
                      ? <Tag color="orange" style={{ margin: 0, fontSize: 12 }}>MainAgent</Tag>
                      : <Tag style={{ margin: 0, fontSize: 12 }}>SubAgent{subType ? ':' + subType : ''}</Tag>
                    }
                    {model && <span style={{ fontSize: 12, color: req.mainAgent ? '#d4822d' : '#8c8c8c' }}>{model}</span>}
                    <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>{time}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' }}>
                    <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={req.url}>{urlShort}</span>
                    {req.duration && <span style={{ color: '#6b7280', flexShrink: 0 }}>{req.duration}ms</span>}
                    {req.response && (
                      <span style={{ color: statusOk ? '#10b981' : statusErr ? '#ef4444' : '#9ca3af', flexShrink: 0 }}>
                        {req.response.status}
                      </span>
                    )}
                  </div>
                  {usage && (
                    <div style={{
                      background: '#111',
                      borderRadius: 4,
                      padding: '3px 6px',
                      marginTop: 4,
                      fontSize: 12,
                      color: '#6b7280',
                      lineHeight: 1.6,
                    }}>
                      <div>token: output:{formatTokens(outputTokens) || 0}, input: {formatTokens(inputTokens) || 0}</div>
                      {(cacheRead > 0 || cacheCreate > 0) && (
                        <div>cache: {cacheRead > 0 ? `read:${formatTokens(cacheRead)}` : ''}{cacheRead > 0 && cacheCreate > 0 ? ', ' : ''}{cacheCreate > 0 ? `write:${formatTokens(cacheCreate)}` : ''}</div>
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
