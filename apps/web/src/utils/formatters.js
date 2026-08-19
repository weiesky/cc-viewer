// 共享展示格式化工具。
// formatSize 用 4 档 (B/KB/MB/GB) — 与 WorkspaceList 旧版语义一致，覆盖原 LogTable 的 3 档版本。
// formatTimestamp 接 cc-viewer 日志 ts 字符串 (YYYYMMDD_HHMMSS...)；mobile=true 时省略年份。
export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatTimestamp(ts, mobile) {
  if (!ts || ts.length < 15) return ts;
  if (mobile) return `${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
}

// 共享时钟格式化原语（本地时区，零填充）。formatPromptNavTime（Prompt 导航）与
// ChatMessage.formatTime（气泡时间）复用同一实现，使「HH:MM:SS」/「MM-DD HH:MM:SS」格式
// 单一来源、无需再手工同步两处。入参为已构造的 Date。
const _pad2 = (n) => String(n).padStart(2, '0');
export function formatHms(d) {
  return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}:${_pad2(d.getSeconds())}`;
}
export function formatMonthDayTime(d) {
  return `${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())} ${formatHms(d)}`;
}

// formatPromptNavTime 接 ISO 8601 / Date-可解析字符串（消息的 _timestamp，如 ChatView 用户 Prompt
// 导航传入的 props.timestamp），输出本地时区的 "MM-DD HH:MM:SS"。缺失/非法 → ''。
export function formatPromptNavTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return formatMonthDayTime(d);
  } catch { return ''; }
}

// Single source of truth for the context-fullness severity color, shared by the
// desktop header bar, the mobile header tag, and the cache popover so all three
// surfaces always agree for the same percentage.
// Thresholds 75/55: keeps a felt buffer before the auto-compact trigger (~83.5%)
// under the raw-occupancy interpretation of the percentage.
export function contextSeverityColor(percent) {
  return percent >= 75 ? 'var(--color-error-light)' : percent >= 55 ? 'var(--color-warning-light)' : 'var(--color-success)';
}
