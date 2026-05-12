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
