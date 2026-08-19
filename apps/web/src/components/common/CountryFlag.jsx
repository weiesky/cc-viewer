import React from 'react';
import { Popover } from 'antd';
import styles from './CountryFlag.module.css';

// ISO-3166 alpha-2 → Unicode regional indicator emoji
// e.g. "US" → 🇺🇸
function countryToFlag(code) {
  if (!code || code.length !== 2) return '🇨🇳';
  return code.toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

// 多源兜底：ipinfo.io 免 token 有限流、部分网络不可达，单一源易请求失败。
// 按序逐个尝试，先成功者生效；各源字段不一致，normalize 统一为 ipinfo 形状
// { ip, country(ISO-3166 alpha-2), region, city, org } 供 render 直接消费。
const GEO_SOURCES = [
  {
    url: 'https://ipinfo.io/json',
    normalize: d => ({ ip: d.ip, country: d.country, region: d.region, city: d.city, org: d.org }),
  },
  {
    url: 'https://ipwho.is/',
    normalize: d => (d.success === false ? null : {
      ip: d.ip, country: d.country_code, region: d.region, city: d.city,
      org: d.connection?.org || d.connection?.isp,
    }),
  },
  {
    url: 'https://ipapi.co/json/',
    normalize: d => ({ ip: d.ip, country: d.country_code || d.country, region: d.region, city: d.city, org: d.org }),
  },
];

async function fetchGeoInfo() {
  for (const src of GEO_SOURCES) {
    try {
      const r = await fetch(src.url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const info = src.normalize(await r.json());
      if (info?.country?.length === 2) return info;
    } catch { /* 超时/网络错误/JSON 解析失败 → 下一个源 */ }
  }
  return null;
}

/**
 * Footer 左下角的地理位置指示。
 * 自带 IP 地理请求（多源兜底，见 GEO_SOURCES）+ hover Popover。未拿到 data / country=CN 时不渲染。
 * 原本挂在 AppHeader 的右侧控件区，1.6.200 移到 App.jsx footer 左端，
 * 只显示紧凑的国旗，hover 才展开地区详情。
 */
export default class CountryFlag extends React.Component {
  constructor(props) {
    super(props);
    this.state = { flag: null, info: null, popoverOpen: false };
    this._aborted = false;
  }

  componentDidMount() {
    fetchGeoInfo().then(info => {
      if (this._aborted || !info) return;
      this.setState({ flag: countryToFlag(info.country), info });
    });
  }

  componentWillUnmount() {
    this._aborted = true;
  }

  render() {
    const { flag, info } = this.state;
    // 未知国家或 CN 不显示（和原先 AppHeader 行为保持一致）
    if (!flag || info?.country === 'CN') return null;

    // stopPropagation 防止 popover 内点击冒泡到外层 click 触发 onOpenChange(false);
    // 与 AppHeader 二维码 popover 同款修复(原 trigger=['hover','focus'] 移动端 tap 即关)。
    const content = (
      <div className={styles.popover} onClick={e => e.stopPropagation()}>
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
        // 移动端 hover/focus 不可靠(tap → focus → 立即触发外部 click 关闭),改 click 受控。
        trigger={['click']}
        open={this.state.popoverOpen}
        onOpenChange={(o) => this.setState({ popoverOpen: o })}
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
