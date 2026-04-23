import React from 'react';
import { Popover } from 'antd';
import styles from './CountryFlag.module.css';

// ISO-3166 alpha-2 → Unicode regional indicator emoji
// e.g. "US" → 🇺🇸
function countryToFlag(code) {
  if (!code || code.length !== 2) return '🇨🇳';
  return code.toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

/**
 * Footer 左下角的地理位置指示。
 * 自带 ipinfo.io 请求 + hover Popover。未拿到 data / country=CN 时不渲染。
 * 原本挂在 AppHeader 的右侧控件区，1.6.200 移到 App.jsx footer 左端，
 * 只显示紧凑的国旗，hover 才展开地区详情。
 */
export default class CountryFlag extends React.Component {
  constructor(props) {
    super(props);
    this.state = { flag: null, info: null };
    this._aborted = false;
  }

  componentDidMount() {
    fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then(data => {
        if (this._aborted) return;
        if (data && data.country) {
          this.setState({ flag: countryToFlag(data.country), info: data });
        }
      })
      .catch(() => { });
  }

  componentWillUnmount() {
    this._aborted = true;
  }

  render() {
    const { flag, info } = this.state;
    // 未知国家或 CN 不显示（和原先 AppHeader 行为保持一致）
    if (!flag || info?.country === 'CN') return null;

    const content = (
      <div className={styles.popover}>
        <div>{flag} {info.country}</div>
        {info.region && <div>{info.region}</div>}
        {info.city && <div>{info.city}</div>}
        {info.org && <div className={styles.meta}>{info.org}</div>}
        {info.ip && <div className={styles.meta}>{info.ip}</div>}
      </div>
    );

    return (
      <Popover
        content={content}
        trigger={['hover', 'focus']}
        placement="topLeft"
        overlayInnerStyle={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-hover)',
          borderRadius: 8,
          padding: '8px 12px',
        }}
      >
        <button type="button" className={styles.flag} aria-label={`${info.country}${info.region ? ' · ' + info.region : ''}`}>{flag}</button>
      </Popover>
    );
  }
}
