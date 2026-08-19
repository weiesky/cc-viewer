/**
 * Workflow 面板共享格式化工具（WorkflowPanel 与 WorkflowLiveHud 共用，纯函数无 CSS 依赖）。
 */

export const TERMINAL_STATES = new Set(['done', 'completed', 'failed', 'error', 'cancelled', 'skipped']);

// 工作流状态 → i18n key（缺失时调用方回退到原始 status 字符串）。
export const STATUS_KEYS = {
  running: 'ui.workflow.status.running',
  finishing: 'ui.workflow.status.finishing',
  completed: 'ui.workflow.status.completed',
  failed: 'ui.workflow.status.failed',
  paused: 'ui.workflow.status.paused',
  cancelled: 'ui.workflow.status.cancelled',
};

export function fmtDuration(ms) {
  if (typeof ms !== 'number' || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export function fmtTokens(n) {
  if (typeof n !== 'number' || n <= 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function isRunning(state) {
  return !TERMINAL_STATES.has(state);
}

export function stateGlyph(state) {
  if (state === 'done' || state === 'completed') return '✓';
  if (state === 'failed' || state === 'error') return '✗';
  if (state === 'queued') return '○';
  return '●';
}

// 甘特完成条按阶段着色：柔和、明暗主题皆可读的循环色相调色板。
// 失败/运行中/排队仍走语义色（红/主色脉冲/灰），不取这里的值。
const PHASE_HUES = [206, 265, 150, 32, 322, 188, 96, 0];

export function phaseColor(phaseIndex) {
  const n = PHASE_HUES.length;
  const i = typeof phaseIndex === 'number' && phaseIndex >= 0 ? phaseIndex : 0;
  const h = PHASE_HUES[i % n];
  return `hsl(${h}, 48%, 50%)`;
}
