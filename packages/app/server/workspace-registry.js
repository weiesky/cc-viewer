// Workspace Registry - 工作区持久化管理
import { readdir, stat } from 'node:fs/promises';
import { mutateJson, readJsonSafe, writeJsonAtomic } from './lib/json-store.js';
import { dirSizeSync } from './lib/v2/layout.js';
import { isDiscardableSession } from './lib/v2/session-select.js';
import { join, basename, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOG_DIR } from '../findcc.js';

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
    const list = Array.isArray(data.workspaces) ? data.workspaces : [];
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

export async function getWorkspaces() {
  const list = loadWorkspaces();
  const enriched = await Promise.all(list.map(async (w) => {
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
        try {
          await stat(join(sessionDir, 'journal.jsonl'));
          // Quota-probe orphans must not count: logCount>0 drives the
          // auto -c heuristic, and a probe-only workspace would auto-continue
          // into a conversation that does not exist (2026-07-16).
          if (isDiscardableSession(sessionDir)) continue;
          // Folder size, not journal size — conv/blob/response files carry
          // most of a session's bytes (journal alone undercounts ~12x).
          totalSize += dirSizeSync(sessionDir);
          sessionCount++;
        } catch { /* dir without a journal is not a session yet */ }
      }
    } catch { }
    return { ...w, logCount: sessionCount + unmigratedV1Count, sessionCount, unmigratedV1Count, totalSize };
  }));
  return enriched.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
}
