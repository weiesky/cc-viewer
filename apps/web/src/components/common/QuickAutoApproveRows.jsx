import React from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import chrome from './sharedChrome.module.css';
import { ShieldCheckIcon, PlanClipboardIcon, AskAnswerIcon } from './quickMenuIcons';
import {
  PERM_AUTO_APPROVE_OPTIONS, PLAN_AUTO_APPROVE_OPTIONS, ASK_AUTO_ANSWER_OPTIONS,
  autoApproveValueLabel, askAutoAnswerValueLabel, askAutoAnswerUiValue,
} from '../../utils/autoApproveOptions';

// 四芒星快捷菜单的「权限自动审批 / Plan 自动审批 / 问答题自动托管」三行级联
// （终端工具栏与对话输入栏共用）。
// onAutoApproveChange / onPlanAutoApproveChange / onAskAutoAnswerChange 必须接 AppBase
// 的 handler：AppBase 把这些值镜像在自身 state 且仅挂载时 hydrate 一次，直接
// onUpdatePreferences 只持久化、不更新运行时倒计时行为。
// 级联子菜单由 expandedKey 驱动显隐而非 CSS :hover —— 选完档位要立即收起，
// 此时鼠标仍悬停在 group 上，纯 :hover 收不掉。hover-intent 由宿主经
// onHoverEnter/onHoverLeave 注入（见 utils/quickMenuHoverIntent）。
// 每行自带 formatLabel：ask 行是分钟语义（0=立即/null=不托管），与秒级档位文案不同。
// ask 行的 value 必须经 askAutoAnswerUiValue 转换 —— 持久化的 null（不托管）在
// `(row.value ?? 0) === v` 下会被误判成 0 分钟档。
function QuickAutoApproveRows({ autoApproveSeconds, planAutoApproveSeconds, askAutoAnswerMinutes, onAutoApproveChange, onPlanAutoApproveChange, onAskAutoAnswerChange, expandedKey, onToggle, onHoverEnter, onHoverLeave, middle }) {
  const rows = [
    { key: 'perm', icon: <ShieldCheckIcon />, label: t('ui.permission.autoApprove.setting'), value: autoApproveSeconds, options: PERM_AUTO_APPROVE_OPTIONS, onChange: onAutoApproveChange, formatLabel: autoApproveValueLabel },
    { key: 'plan', icon: <PlanClipboardIcon />, label: t('ui.approval.settings.planAutoApprove'), value: planAutoApproveSeconds, options: PLAN_AUTO_APPROVE_OPTIONS, onChange: onPlanAutoApproveChange, formatLabel: autoApproveValueLabel },
    { key: 'ask', icon: <AskAnswerIcon />, label: t('ui.askAutoAnswer.setting'), value: askAutoAnswerUiValue(askAutoAnswerMinutes), options: ASK_AUTO_ANSWER_OPTIONS, onChange: onAskAutoAnswerChange, formatLabel: askAutoAnswerValueLabel, help: t('ui.askAutoAnswer.help') },
  ];
  // `middle` (2026-10-06): an optional node rendered after the plan row — the
  // session-history entry (star-menu migration). Rendered as a sibling inside
  // the last fragment so the mapped children stay keyed and the order is
  // perm → plan → ask → middle.
  return rows.map((row, i) => {
    const expanded = expandedKey === row.key;
    const isLastRow = i === rows.length - 1;
    const formatLabel = row.formatLabel || autoApproveValueLabel;
    return (
      <React.Fragment key={row.key}>
        <div
          className={`${chrome.quickMenuGroup} ${expanded ? chrome.quickMenuGroupOpen : ''}`}
          onMouseEnter={() => onHoverEnter(row.key)}
          onMouseLeave={() => onHoverLeave(row.key)}
        >
          <button className={chrome.quickMenuRow} onClick={() => onToggle(expanded ? null : row.key)}>
            <span className={chrome.quickMenuRowIcon}>{row.icon}</span>
            <span className={chrome.quickMenuLabel}>{row.label}
              {row.help && (
                <Tooltip title={row.help} trigger="click" overlayStyle={{ maxWidth: 320 }} overlayInnerStyle={{ whiteSpace: 'pre-line' }}>
                  <span
                    className={chrome.helpIconBtn}
                    role="button"
                    tabIndex={0}
                    aria-label={row.help}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                  >
                    <QuestionCircleOutlined />
                  </span>
                </Tooltip>
              )}
            </span>
            <span className={chrome.quickMenuValue}>[{formatLabel(row.value, t)}]</span>
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
                  {formatLabel(v, t)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(isLastRow) && middle ? middle : null}
      </React.Fragment>
    );
  });
}

export default QuickAutoApproveRows;
