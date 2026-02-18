import React from 'react';
import { Space, Tag, Button, Badge, Typography } from 'antd';
import { MessageOutlined, FileTextOutlined } from '@ant-design/icons';

const { Text } = Typography;

class AppHeader extends React.Component {
  constructor(props) {
    super(props);
    this.state = { countdownText: '' };
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
      this.setState({ countdownText: '已失效' });
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
      text = `${m}分${String(s).padStart(2, '0')}秒`;
    } else {
      text = `${totalSec}秒`;
    }
    this.setState({ countdownText: text });
    this._rafId = requestAnimationFrame(this.updateCountdown);
  }

  render() {
    const { requestCount, viewMode, cacheType, onToggleViewMode } = this.props;
    const { countdownText } = this.state;

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
      }}>
        <Space size="middle">
          <Text strong style={{ color: '#fff', fontSize: 18 }}>Claude Code Viewer</Text>
          <Tag color="green" style={{ borderRadius: 12 }}>
            <Badge status="processing" color="green" />
            <span style={{ marginLeft: 4 }}>实时监控中</span>
          </Tag>
        </Space>

        <Space size="middle">
          {countdownText && (
            <Tag color={countdownText === '已失效' ? 'red' : 'green'}>
              MainAgent缓存{cacheType ? `(${cacheType})` : ''}失效倒计时：
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{countdownText}</strong>
            </Tag>
          )}
          <Button
            size="small"
            icon={viewMode === 'raw' ? <MessageOutlined /> : <FileTextOutlined />}
            onClick={onToggleViewMode}
          >
            {viewMode === 'raw' ? '对话模式' : '原文模式'}
          </Button>
        </Space>
      </div>
    );
  }
}

export default AppHeader;
