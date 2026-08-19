// 共享：动态 chunk 加载失败时的自愈逻辑。
//
// 触发场景：服务端升级后，dist/ 里 chunk 哈希变了；浏览器旧标签页 / 缓存的入口 JS
// 还在请求被替换的旧文件名 → server.js 给 /assets/ 不存在的请求返回 404 →
// import() 抛 TypeError "Failed to fetch dynamically imported module"。
//
// 自愈策略：每个 chunk name 单独维护一个 sessionStorage timestamp，5 分钟外允许
// reload 一次；窗口内的二次失败抛出原 error 让上游处理（避免连续两次升级死循环）。
// sessionStorage 在 Safari Private / quota 满 / sandboxed iframe / 严格 CSP 下访问会抛
// SecurityError 或 QuotaExceededError，全部用 try/catch 静默吞掉 —— 拿不到上次时间戳
// 时优先 reload（次数过多比"永不刷"更可恢复）。
//
// 三个导出：
//   - shouldReloadStaleChunk(name) → boolean。仅判断 + 写时间戳，不做 reload。
//     用作底层 primitive，便于把"是否要刷"和"何时真刷"解耦。
//   - reloadOnStaleChunk(name) → boolean。立即 reload。给 main.jsx 这种没 UI 的地方用。
//   - handleStaleChunk(name, err, { onReload }) → Promise / throw。给 React.lazy 的 .catch
//     用：onReload 先跑（toast 之类），200ms 后才真 reload，让 UI 有机会画出来。
//     返回永不 resolve 的 Promise 把 React 卡在 Suspense fallback 里等 reload 接管。

const RELOAD_WINDOW_MS = 5 * 60 * 1000;
const RELOAD_GRACE_MS = 200; // 留给 toast / message 渲染一帧的时间

function safeStorage(key, value) {
  try {
    if (value === undefined) return Number(sessionStorage.getItem(key) || 0);
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode / quota / sandbox — 读返回 0（→ 触发一次 reload，比卡死好），写忽略 */
  }
  return 0;
}

export function shouldReloadStaleChunk(name) {
  const key = `_chunkReloadedAt:${name}`;
  const last = safeStorage(key);
  if (Date.now() - last <= RELOAD_WINDOW_MS) return false;
  safeStorage(key, String(Date.now()));
  return true;
}

export function reloadOnStaleChunk(name) {
  if (!shouldReloadStaleChunk(name)) return false;
  window.location.reload();
  return true;
}

export function handleStaleChunk(name, err, { onReload } = {}) {
  if (!shouldReloadStaleChunk(name)) throw err;
  try { onReload?.(); } catch { /* toast 抛错不能阻止 reload */ }
  setTimeout(() => window.location.reload(), RELOAD_GRACE_MS);
  return new Promise(() => {}); // 让 Suspense fallback 一直显示直到 reload 接管
}
