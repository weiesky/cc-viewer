import React, { memo, useMemo } from 'react';
import { Popover } from 'antd';
import { t } from '../../i18n';
import { pickHeadlineWindow } from '../../utils/rateLimitParser';
import styles from './UsageWindowPill.module.css';

// 与 LiveTagPopover 同款：静态 overlayInnerStyle 提到模块顶层,避免每次 render 新建字面量。
const POPOVER_OVERLAY_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8,
  padding: '8px 8px',
};

// 0~1 占比 → 百分比文本
function fmtPct(u) {
  return u == null ? '—' : `${Math.round(u * 100)}%`;
}

// resetAt(毫秒) → "Resets in 2h 13m" / "Resets in 45m" / "Resetting…"。无 resetAt 返回空串。
function resetText(resetAt) {
  if (resetAt == null) return '';
  const diff = resetAt - Date.now();
  if (diff <= 0) return t('ui.usage.resetting');
  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? t('ui.usage.resetsInHM', { h, m }) : t('ui.usage.resetsInM', { m });
}

function windowName(id) {
  return id === '7d' ? t('ui.usage.weekly') : t('ui.usage.fiveHour');
}

function windowShort(id) {
  return id === '7d' ? t('ui.usage.weeklyShort') : '5h';
}

function UsageWindowPill({ planUsage, authType }) {
  const headline = useMemo(() => pickHeadlineWindow(planUsage), [planUsage]);

  // 只保留填充条宽度(--usage-percent);颜色统一走 CSS 里的 --text-disabled，不再按阈值变色。
  const triggerStyle = useMemo(() => {
    const pct = headline && headline.utilization != null ? Math.round(headline.utilization * 100) : 0;
    return {
      '--usage-percent': `${Math.min(100, Math.max(0, pct))}%`,
    };
  }, [headline]);

  // 没有套餐限流数据时:OAuth(订阅)显示静默占位 pill,等待数据;其余(API Key / 未知)不渲染。
  if (!planUsage) {
    if (authType === 'OAuth') {
      return (
        <Popover
          content={<div className={styles.pop}>{t('ui.usage.waiting')}</div>}
          trigger="hover"
          placement="top"
          overlayInnerStyle={POPOVER_OVERLAY_STYLE}
        >
          <span className={`${styles.usagePill} ${styles.muted}`} role="button" tabIndex={0} aria-label={t('ui.usage.ariaLabel')}>
            <span className={styles.usageContent}>
              <span className={styles.usageText}>—</span>
            </span>
          </span>
        </Popover>
      );
    }
    return null;
  }

  // pill 文案:同时展示已有的两个窗口(5h / 周),例如 "5h 19% · 周 52%"。
  const pillLabel = planUsage.windows
    .filter((w) => w.utilization != null)
    // 简化:周窗口(7d)未超过 60% 时不在 footer pill 上展示(只在 hover 详情里看);5h 照常显示。
    .filter((w) => w.id !== '7d' || w.utilization > 0.6)
    .map((w) => `${windowShort(w.id)} ${fmtPct(w.utilization)}`)
    .join(' · ');

  const popContent = (
    <div className={styles.pop}>
      <div className={styles.popTitle}>{t('ui.usage.title')}</div>
      {/* 无边框 table 让「窗口名 / 血条 / 重置时间」三列对齐;百分比用 50px 血条 + 数字叠加展示。 */}
      <table className={styles.popTable}>
        <tbody>
          {planUsage.windows.map((w) => {
            const rt = resetText(w.resetAt);
            const pct = w.utilization != null ? Math.min(100, Math.max(0, Math.round(w.utilization * 100))) : 0;
            return (
              <tr key={w.id}>
                <td className={styles.tdName}>{windowName(w.id)}</td>
                <td className={styles.tdBar}>
                  <span className={styles.bar}>
                    <span className={styles.barFill} style={{ width: `${pct}%` }} />
                    <span className={styles.barText}>{fmtPct(w.utilization)}</span>
                  </span>
                </td>
                <td className={styles.tdReset}>{rt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <Popover
      content={popContent}
      trigger="hover"
      placement="topRight"
      overlayInnerStyle={POPOVER_OVERLAY_STYLE}
    >
      <span className={styles.usagePill} style={triggerStyle} role="button" tabIndex={0} aria-label={t('ui.usage.ariaLabel')}>
        <span className={styles.usageFill} />
        <span className={styles.usageContent}>
          <span className={styles.usageText}>{pillLabel}</span>
        </span>
      </span>
    </Popover>
  );
}

export default memo(UsageWindowPill);
