// Workspace Registry - 工作区持久化管理
import { readdir, stat, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { mutateJson, readJsonSafe, writeJsonAtomic } from './lib/json-store.js';
import { dirSizeAsync } from './lib/v2/layout.js';
import { isDiscardableSession } from './lib/v2/session-select.js';
import { join, basename, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOG_DIR } from '../findcc.js';

// 与 stats-worker.js 的磁盘缓存对齐(2026-10-08):getWorkspaces 富化时优先读
// LOG_DIR/<project>/<project>.json 的 files["sessions/<sid>"],以 journalSize+lastModified
// 作新鲜度 key;命中即跳过 dirSizeSync。版本不一致或 key 缺失则回退到实时遍历。
// 版本号必须与 stats-worker.js 的 STATS_VERSION 保持一致,否则旧缓存被错误信任。
const STATS_CACHE_VERSION = 12;

// 动态获取（LOG_DIR 可能在运行时被 setLogDir 修改）
function getWorkspacesFile() { return join(LOG_DIR, 'workspaces.json'); }

export function loadWorkspaces() {
  const data = readJsonSafe(getWorkspacesFile(), {});
  return Array.isArray(data.workspaces) ? data.workspaces : [];
}

// Full-list rewrite on every mutation; non-secret so no 0600 (mode:false → umask).
// Atomicity + cross-process mutex come from mutateJson below.
function _saveWorkspaces(list) {
  return { workspaces: list };
}

// 失效 file-access-policy 的 allowlist roots 缓存。lazy import 避免循环依赖。
function _invalidatePolicyCache() {
  import('./lib/file-access-policy.js')
    .then(m => m.bumpWorkspacesVersion?.())
    .catch(() => { /* policy 模块可能在某些 entry 下未加载,无副作用即可 */ });
}

export async function registerWorkspace(absolutePath) {
  const result = await mutateJson(getWorkspacesFile(), (data) => {
    const resolvedPath = resolve(absolutePath);
    const projectName = basename(resolvedPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    let list = Array.isArray(data.workspaces) ? data.workspaces : [];
    // Windows NTFS 不分大小写——`C:\App` 跟 `c:\app` 是同目录但 `===` 视为不同。
    // 仅 Win 下小写化比较；POSIX 保持原样不引入回归。
    const pathEq = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const existing = list.find(w => pathEq(w.path, resolvedPath));
    if (existing) {
      existing.lastUsed = new Date().toISOString();
      existing.projectName = projectName;
      data.workspaces = list;
      return existing;
    }
    // Gentle self-heal (2026-10-05): a same-name entry whose path no longer
    // exists (moved/deleted checkout residue) is pruned on register — otherwise
    // the collision makes view-root's no-live-PTY branch 400. Same-name entries
    // whose path still exists are kept (never auto-delete user data).
    // Only ENOENT/ENOTDIR count as "gone": existsSync() also returns false on
    // EIO/EACCES/EPERM/a transiently unmounted volume, which must NOT prune a
    // legitimate workspace.
    const isGone = (p) => {
      try { statSync(p); return false; }
      catch (e) { return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'); }
    };
    list = list.filter(w =>
      w.projectName !== projectName || pathEq(w.path, resolvedPath) || !isGone(w.path));
    const now = new Date().toISOString();
    const entry = {
      id: randomBytes(6).toString('hex'),
      path: resolvedPath,
      projectName,
      lastUsed: now,
      createdAt: now,
    };
    list.push(entry);
    data.workspaces = list;
    return entry;
  }, { mode: false, fallback: {}, ensureDir: LOG_DIR });
  _invalidatePolicyCache();
  return result;
}

export async function removeWorkspace(id) {
  const result = await mutateJson(getWorkspacesFile(), (data) => {
    const list = Array.isArray(data.workspaces) ? data.workspaces : [];
    const filtered = list.filter(w => w.id !== id);
    if (filtered.length !== list.length) {
      data.workspaces = filtered;
      return true;
    }
    return false;
  }, { mode: false, fallback: {}, ensureDir: LOG_DIR });
  if (result) _invalidatePolicyCache();
  return result;
}

// Legacy sync save entry kept for any direct caller: writes the full list atomically via the
// kernel (non-secret → umask). mkdirSync is handled inside writeJsonAtomic.
export function saveWorkspaces(list) {
  try {
    writeJsonAtomic(getWorkspacesFile(), _saveWorkspaces(list), { mode: false });
  } catch (err) {
    console.error('[CC Viewer] Failed to save workspaces:', err.message);
  }
}

export async function getWorkspaces(opts = {}) {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : null;
  const list = loadWorkspaces();
  // 先按 lastUsed 降序(几乎免费,只是 8.5 KB JSON 的内存排序),再切片、再富化。
  // 不调换顺序的话:全量富化 40 个工作区 ≈ 3.3s;先切片后富化,limit=5 ≈ 200ms。
  const sorted = list.slice().sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
  const total = sorted.length;
  const toEnrich = limit ? sorted.slice(0, limit) : sorted;
  // 一次性读出涉及项目的 stats 磁盘缓存(每个项目一次读盘,富化期全部命中内存)。
  // Map + Promise.all 的 has/set 不防重:同一 projectName 的多个 entry 在 await 之前都通过 has 检查,
  // 导致重复读盘。先 Set 去重再读。
  const uniqueProjects = [...new Set(toEnrich.map((w) => w.projectName))];
  const cacheByProject = new Map();
  await Promise.all(uniqueProjects.map(async (projectName) => {
    cacheByProject.set(projectName, await _readStatsCache(projectName));
  }));
  const enriched = await Promise.all(toEnrich.map((w) => _enrichWorkspace(w, cacheByProject.get(w.projectName))));
  return { workspaces: enriched, total };
}

/**
 * 读一个工作区的 stats 磁盘缓存(若存在且版本匹配)。
 * 缓存 schema:LOG_DIR/<project>/<project>.json 的 files["sessions/<sid>"] = {
 *   size, journalSize, lastModified, ...
 * },以 (journalSize, lastModified) 作新鲜度 key —— session 文件一变动,journal.jsonl
 * 的 size/mtime 就变,缓存自然 miss 走实时遍历。
 * 返回 files 对象;失败/版本不匹配返回 null(调用方整体回退到实时遍历)。
 */
async function _readStatsCache(projectName) {
  // 防御:projectName 来自 workspaces.json(用户可手改),registerWorkspace 写入时只保证
  // basename 级别消毒。若 workspaces.json 被改成包含 '/' / '\\' / '..' 的 projectName,
  // 这里的 join 会越出 LOG_DIR。命中即拒,回退到实时遍历(性能降级但安全)。
  if (typeof projectName !== 'string'
      || projectName.includes('/')
      || projectName.includes('\\')
      || projectName.includes('..')) {
    return null;
  }
  try {
    const statsFile = join(LOG_DIR, projectName, `${projectName}.json`);
    const raw = await readFile(statsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed._v !== STATS_CACHE_VERSION || !parsed.files || typeof parsed.files !== 'object') return null;
    return parsed.files;
  } catch {
    return null; // 缓存不存在/损坏都算 miss,调用方走实时路径
  }
}

/**
 * 富化单个工作区的日志统计。命中 stats 缓存的 session 直接用缓存的 size;
 * 未命中的 session 用 dirSizeAsync 异步递归(不阻塞事件循环,SSE/PTY 不再被冻结)。
 * isDiscardableSession 仍是同步调用 —— 它只读 meta.json + 扫 journal 头几行,
 * 远比 dirSizeSync 便宜;完全异步化留作后续。
 */
async function _enrichWorkspace(w, statsCache) {
  // wire-v2 (1.7.0): logs live in per-session dirs under sessions/. The v1
  // *.jsonl glob is kept as unmigratedV1Count — the combined logCount must
  // stay non-zero for a declined-migration workspace, because the launcher's
  // `logCount > 0 → auto -c` heuristic hangs off it (WorkspaceList.jsx).
  let sessionCount = 0;
  let unmigratedV1Count = 0;
  let totalSize = 0;
  const logDir = join(LOG_DIR, w.projectName);
  try {
    const files = await readdir(logDir);
    for (const f of files) {
      if (f.endsWith('.jsonl') && !f.endsWith('_temp.jsonl')) {
        unmigratedV1Count++;
        try { totalSize += (await stat(join(logDir, f))).size; } catch { }
      }
    }
  } catch { }
  try {
    const sids = await readdir(join(logDir, 'sessions'), { withFileTypes: true });
    for (const e of sids) {
      if (!e.isDirectory()) continue;
      const sessionDir = join(logDir, 'sessions', e.name);
      const unitKey = `sessions/${e.name}`;
      try {
        const journalStat = await stat(join(sessionDir, 'journal.jsonl'));
        // 缓存命中条件与 stats-worker 相同:journalSize + lastModified 双 key。
        // 命中即非 discardable(stats-worker v11+ 的缓存条目写入前已过滤 probe-only session),
        // 所以命中路径可以跳过 isDiscardableSession 的同步读 —— 省 ~200ms(实测 1787 session 的
        // 热路径成本)。未命中再走原顺序:先判 probe,再递归 dirSizeAsync。
        const cached = statsCache?.[unitKey];
        const lastModified = journalStat.mtime.toISOString();
        if (cached && cached.journalSize === journalStat.size && cached.lastModified === lastModified && typeof cached.size === 'number') {
          totalSize += cached.size;
          sessionCount++;
          continue;
        }
        // Quota-probe orphans must not count: logCount>0 drives the
        // auto -c heuristic, and a probe-only workspace would auto-continue
        // into a conversation that does not exist (2026-07-16).
        if (isDiscardableSession(sessionDir)) continue;
        // Folder size, not journal size — conv/blob/response files carry
        // most of a session's bytes (journal alone undercounts ~12x).
        totalSize += await dirSizeAsync(sessionDir);
        sessionCount++;
      } catch { /* dir without a journal is not a session yet */ }
    }
  } catch { }
  return { ...w, logCount: sessionCount + unmigratedV1Count, sessionCount, unmigratedV1Count, totalSize };
}
