// Log-file naming primitives — shared leaf extracted from log-management.js to
// break the static cycle log-management.js ↔ v2/adapter.js (v2 read/write paths
// need these primitives but must not import the v1 session listing, which itself
// imports the v2 adapter). Keep this module dependency-free.

export function isLogFileName(name) {
  return name.endsWith('.jsonl');
}

// 解析日志文件名里的时间戳 `YYYYMMDD_HHMMSS`（带不带 `<pid>__` 前缀都适用）。
// 用于「按时间排序 / 判最新」——文件名整串排序会把 `<pid>__` 前缀（'1' < 'c'）的最新文件排到最底，
// 必须按时间戳排。无法解析时返回 ''（排到最后）。v2 convert 消费，防漂移。
export function parseLogTs(name) {
  const m = name.match(/_(\d{8}_\d{6})\.jsonl$/);
  return m ? m[1] : '';
}

// A session whose journal moved within this window is treated as live and
// refused by deleteLogFiles (cross-process guard; the in-process guard is the
// caller's own writer state).
export const LIVE_SESSION_MTIME_MS = 5 * 60 * 1000;
