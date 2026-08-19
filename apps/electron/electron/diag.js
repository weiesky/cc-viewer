// Electron 白屏诊断日志。
// JSON Lines / 2MB rename rotate / 单条 16KB cap / token + 用户路径 redact / 0600。
// 日志路径：${LOG_DIR}/electron-diag.log（默认 ~/.claude/cc-viewer/electron-diag.log）。
// category 命名 `层:事件`（如 workspace:did-fail-load），grep 即定位。
//
// 写入为异步队列：主进程禁止运行期同步 I/O —— appendFileSync 在杀软实时扫描/
// OneDrive 同步锁文件等场景下可阻塞主进程事件循环（Windows 整窗冻结候选根因），
// appendDiag 只做内存入队即返回，落盘由串行 drain 异步完成。

import { dirname, join } from 'path';
import { mkdir, stat, rename, appendFile } from 'fs/promises';

const DIAG_MAX_BYTES = 2 * 1024 * 1024;
const DIAG_LINE_CAP = 16 * 1024; // 单条 stack 可达 100KB+，截断防保留窗口被一条吃光
const DIAG_MODE = 0o600;         // 本机多用户场景下日志含 stack/路径，限制 owner-only
const DIAG_QUEUE_CAP = 256;      // 错误风暴上限：超出丢最旧，防内存膨胀

let _diagLogPath = null;
let _queue = [];
let _draining = null; // Promise | null —— 串行化写入；diagFlush 等它收敛

export function initDiag(logDir) {
  _diagLogPath = join(logDir, 'electron-diag.log');
}

// redact 两类敏感串：
//  1. `?token=` / `&token=` —— mgmt 端口访问凭证；
//  2. 主目录前缀 `/Users/<x>/` / `/home/<x>/` / `C:\Users\<x>\` → `~/`，避免泄露用户名。
// 出口统一在序列化/写入路径，URL / stack / preloadPath 都会被覆盖。
const HOME_RE = /(?:\/Users\/|\/home\/)[^/\s"'\\]+\//g;
const HOME_RE_WIN = /[A-Za-z]:\\Users\\[^\\/\s"']+\\/g;
export function diagRedactString(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/([?&]token=)[^&\s"']+/g, '$1<redacted>')
    .replace(HOME_RE, '~/')
    .replace(HOME_RE_WIN, '~\\');
}

// WeakSet 守卫递归循环——Electron details / Error.cause 链可能自引用，无守卫会栈溢出。
export function diagSerialize(p, seen) {
  if (p === undefined || p === null) return p === undefined ? null : null;
  if (typeof p === 'string') return diagRedactString(p);
  if (typeof p !== 'object') return p;
  if (!seen) seen = new WeakSet();
  if (seen.has(p)) return '[Circular]';
  seen.add(p);
  if (p instanceof Error) return { name: p.name, message: diagRedactString(p.message), stack: diagRedactString(p.stack) };
  if (Array.isArray(p)) return p.map(v => diagSerialize(v, seen));
  const out = {};
  for (const k of Object.keys(p)) out[k] = diagSerialize(p[k], seen);
  return out;
}

// 纯内存入队后立即返回，绝不阻塞调用方（uncaughtException 等热路径上被调用）。
export function appendDiag(category, payload) {
  if (!_diagLogPath) return; // initDiag 未调，no-op（不应发生，但防御）
  try {
    let line = JSON.stringify({ ts: new Date().toISOString(), cat: category, payload: diagSerialize(payload) });
    if (line.length > DIAG_LINE_CAP) line = line.slice(0, DIAG_LINE_CAP) + '…[truncated]';
    _queue.push(line + '\n');
    if (_queue.length > DIAG_QUEUE_CAP) _queue.splice(0, _queue.length - DIAG_QUEUE_CAP);
    if (!_draining) _draining = _drain();
  } catch { /* 日志写入失败本身不能再抛 */ }
}

async function _drain() {
  try {
    await mkdir(dirname(_diagLogPath), { recursive: true });
    while (_queue.length) {
      const batch = _queue.splice(0).join('');
      try {
        const st = await stat(_diagLogPath);
        // rename 优于 read+write：rotate 只动目录项，不复制 2MB 内容。
        if (st.size > DIAG_MAX_BYTES) await rename(_diagLogPath, _diagLogPath + '.1');
      } catch { /* 文件不存在 / stat 失败 — 忽略 */ }
      await appendFile(_diagLogPath, batch, { mode: DIAG_MODE });
    }
  } catch { /* 写盘失败：丢弃本批，绝不抛出 */ }
  finally {
    _draining = null;
    // drain 中途异常后若又有新条目，重启一轮；正常路径 while 已清空队列，这里是 no-op。
    if (_queue.length) _draining = _drain();
  }
}

// 等待队列落盘——单测断言与进程退出前 flush 用；运行期业务代码不应 await 它。
export function diagFlush() {
  return _draining || Promise.resolve();
}

// 三层 webContents（tabBar / workspace / tab）通用监听。
// did-fail-load 过滤 -3 (ABORTED, SPA nav cancel) / -1 (IO_PENDING) / 非主 frame。
// render-process-gone 反向黑名单：仅 clean-exit/abnormal-exit 视为噪声；Electron 升级新 reason 默认会被记录。
// preload-error 预展开 Error，防 JSON.stringify 丢非枚举的 message/stack。
export function attachDiagListeners(webContents, label, context = {}) {
  if (!webContents) return;
  webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3 || code === -1 || !isMainFrame) return;
    appendDiag(`${label}:did-fail-load`, { ...context, code, desc, url });
  });
  webContents.on('render-process-gone', (_e, details) => {
    if (['clean-exit', 'abnormal-exit'].includes(details && details.reason)) return;
    appendDiag(`${label}:render-process-gone`, { ...context, ...details });
  });
  webContents.on('preload-error', (_e, preloadPath, error) => {
    const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    appendDiag(`${label}:preload-error`, { ...context, preloadPath, error: err });
  });
}
