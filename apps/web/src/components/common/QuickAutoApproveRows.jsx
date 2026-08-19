import React from 'react';
import { t } from '../../i18n';
import chrome from './sharedChrome.module.css';
import { ShieldCheckIcon, PlanClipboardIcon } from './quickMenuIcons';
import { PERM_AUTO_APPROVE_OPTIONS, PLAN_AUTO_APPROVE_OPTIONS, autoApproveValueLabel } from '../../utils/autoApproveOptions';

// 四芒星快捷菜单的「权限自动审批 / Plan 自动审批」两行级联（终端工具栏与对话输入栏共用）。
// onAutoApproveChange / onPlanAutoApproveChange 必须接 AppBase 的 handler：AppBase 把
// 这两个值镜像在自身 state 且仅挂载时 hydrate 一次，直接 onUpdatePreferences 只持久化、
// 不更新运行时倒计时行为。
// 级联子菜单由 expandedKey 驱动显隐而非 CSS :hover —— 选完档位要立即收起，
// 此时鼠标仍悬停在 group 上，纯 :hover 收不掉。hover-intent 由宿主经
// onHoverEnter/onHoverLeave 注入（见 utils/quickMenuHoverIntent）。
function QuickAutoApproveRows({ autoApproveSeconds, planAutoApproveSeconds, onAutoApproveChange, onPlanAutoApproveChange, expandedKey, onToggle, onHoverEnter, onHoverLeave }) {
  const rows = [
    { key: 'perm', icon: <ShieldCheckIcon />, label: t('ui.permission.autoApprove.setting'), value: autoApproveSeconds, options: PERM_AUTO_APPROVE_OPTIONS, onChange: onAutoApproveChange },
    { key: 'plan', icon: <PlanClipboardIcon />, label: t('ui.approval.settings.planAutoApprove'), value: planAutoApproveSeconds, options: PLAN_AUTO_APPROVE_OPTIONS, onChange: onPlanAutoApproveChange },
  ];
  return rows.map(row => {
    const expanded = expandedKey === row.key;
    return (
      <div
        key={row.key}
        className={`${chrome.quickMenuGroup} ${expanded ? chrome.quickMenuGroupOpen : ''}`}
        onMouseEnter={() => onHoverEnter(row.key)}
        onMouseLeave={() => onHoverLeave(row.key)}
      >
        <button className={chrome.quickMenuRow} onClick={() => onToggle(expanded ? null : row.key)}>
          <span className={chrome.quickMenuRowIcon}>{row.icon}</span>
          <span className={chrome.quickMenuLabel}>{row.label}</span>
          <span className={chrome.quickMenuValue}>[{autoApproveValueLabel(row.value, t)}]</span>
          <span className={chrome.quickMenuCaret}>▸</span>
        </button>
        <div className={chrome.quickMenuSubWrap}>
          <div className={chrome.quickMenuSub}>
            {row.options.map(v => (
              <button
                key={v}
                className={`${chrome.quickMenuOption} ${(row.value ?? 0) === v ? chrome.quickMenuOptionActive : ''}`}
                onClick={() => { row.onChange?.(v); onToggle(null); }}
              >
                {autoApproveValueLabel(v, t)}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  });
}

export default QuickAutoApproveRows;
