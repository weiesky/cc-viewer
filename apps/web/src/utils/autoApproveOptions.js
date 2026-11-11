// 自动审批档位唯一事实源 —— 全部消费点共用同一组档位,防止各处字面量发散:
//   1. TerminalPanel 终端工具栏四芒星快捷菜单（权限/Plan 两行级联档位）
//   2. ChatInputBar 对话输入框四芒星快捷菜单（隐藏终端时,同款两行）
//   3. AppHeader 设置抽屉的权限/Plan 两个 Select
//   4. Mobile 设置面板的权限/Plan 两个 Select
// 三态语义(持久化于 preferences.autoApproveSeconds / approvalModal.planAutoApproveSeconds):
//   0   = 关闭(手动审批)
//   > 0 = 倒计时该秒数后自动批准
//   -1  = 免审批(AUTO_APPROVE_INSTANT):请求到达即放行,从源头绕过审批面板
// 本模块不依赖 helpers.js(它带 .svg?raw 等 Vite 专属 import),保持 node --test 可直接引用。
export const AUTO_APPROVE_INSTANT = -1;

export const PERM_AUTO_APPROVE_OPTIONS = [0, 3, 5, 10, AUTO_APPROVE_INSTANT];
export const PLAN_AUTO_APPROVE_OPTIONS = [0, 10, 30, 60, AUTO_APPROVE_INSTANT];

// 单个档位值 -> 显示文案;t 由调用方注入,避免本模块依赖前端 i18n。
// 档位之外的历史值(如 Plan 旧 3/5)同样落在 `${v}s` 分支正常显示。
export function autoApproveValueLabel(v, t) {
  if (v === AUTO_APPROVE_INSTANT) return t('ui.permission.autoApprove.instant');
  if (!v) return t('ui.permission.autoApprove.off');
  return `${v}s`;
}

// 档位数组 -> antd Select options
export function autoApproveSelectOptions(values, t) {
  return values.map(v => ({ value: v, label: autoApproveValueLabel(v, t) }));
}

// ── 问答题自动托管(AskUserQuestion auto-answer / hosting) ─────────────────────
// 与上方秒级档位不同的一套数值契约(持久化于 approvalModal.askAutoAnswerMinutes):
//   null/缺省 = 不托管(默认) —— 持久化边界上由 ASK_AUTO_ANSWER_OFF 转换而来
//   0         = 0 分钟,立即回答(无人值守流程)
//   10/20/30  = 分钟数倒计时,到点服务端自动回答
// ASK_AUTO_ANSWER_OFF 只是 UI 层 sentinel(antd Select / 级联菜单需要数值键),
// 绝不写入 preferences.json —— 落盘一律 null。
export const ASK_AUTO_ANSWER_OFF = -1;
export const ASK_AUTO_ANSWER_OPTIONS = [0, 10, 20, 30, ASK_AUTO_ANSWER_OFF];

// 单个档位值 -> 显示文案;t 由调用方注入。
export function askAutoAnswerValueLabel(v, t) {
  if (v == null || v === ASK_AUTO_ANSWER_OFF) return t('ui.askAutoAnswer.off');
  if (v === 0) return t('ui.askAutoAnswer.instant');
  return t('ui.askAutoAnswer.minutes', { n: v });
}

export function askAutoAnswerSelectOptions(t) {
  return ASK_AUTO_ANSWER_OPTIONS.map(v => ({ value: v, label: askAutoAnswerValueLabel(v, t) }));
}

// 持久化值(number|null|undefined) -> UI sentinel。历史脏数据(字符串/NaN/Infinity等)一律归 off。
export function askAutoAnswerUiValue(prefMinutes) {
  return (typeof prefMinutes === 'number' && Number.isFinite(prefMinutes)) ? prefMinutes : ASK_AUTO_ANSWER_OFF;
}

// UI sentinel -> 持久化值。OFF 落 null;有限数字原样透传;其余(含 undefined/NaN)一律 null,
// 防 JSON.stringify 丢键让服务端保留旧值、UI 显示「不托管」却仍在托管。
export function askAutoAnswerPrefValue(uiValue) {
  if (uiValue === ASK_AUTO_ANSWER_OFF) return null;
  return (typeof uiValue === 'number' && Number.isFinite(uiValue)) ? uiValue : null;
}
