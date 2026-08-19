// AskUserQuestion 持久化存储：让 server 重启后仍能恢复 pending 状态。
//
// 设计原则：
// - 与 workspace-registry 同款 wx-lockfile + tmp-rename 原子写策略；无新依赖。
// - 单文件 JSON，schema 简单（pending 数极少，几乎不会有性能压力）；
//   未来需要换 SQLite 时只换实现，API 稳定。
// - load/save 在 server 持有内存 Map 的"边缘"调用：set/delete 后同步落盘，
//   保证内存 Map 是权威源、磁盘是镜像。crash 时只丢"未落盘窗口"内的变更。
// - 启动时 hydrate 出的 entry 的 res 字段为 null（旧连接已死），
//   等待新的 ask-bridge 重新 POST 同 toolUseId 时复用（已在 server.js:2727 实现）
//   或浏览器通过 /api/pending-asks 拉取展示。
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { renameSyncWithRetry } from './file-api.js';
import { withFileLockAsync } from './async-file-lock.js';
import { LOG_DIR } from '../../findcc.js';

const SCHEMA_VERSION = 1;

// 进程级一次性 warn 标志：磁盘满 / 权限错误 / SIGPIPE 等持久故障会让每次 ask 都打 warn 刷屏；
// 限制只 log 第一次，让用户能注意到但不至于淹没日志。reset 不暴露 —— 进程重启自然清零。
let _loggedPersistError = false;

function getStoreFile() { return join(LOG_DIR, 'ask-store.json'); }
function getLockFile() { return join(LOG_DIR, 'ask-store.lock'); }

function withLock(fn) {
  return withFileLockAsync(getLockFile(), fn, { ensureDir: LOG_DIR });
}

/**
 * Load all persisted entries from disk.
 * 返回 { [id]: { id, questions, createdAt, status, answers, answeredAt, cancelReason } }
 * status: 'pending' | 'answered' | 'cancelled'
 * 缺文件 / 解析失败均返空对象（容错）。
 */
export function loadAskStore() {
  try {
    if (!existsSync(getStoreFile())) return {};
    const raw = readFileSync(getStoreFile(), 'utf-8');
    if (!raw.trim()) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    if (data.version !== SCHEMA_VERSION) return {};
    const out = {};
    for (const [id, entry] of Object.entries(data.entries || {})) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof id !== 'string' || id.length === 0) continue;
      if (!Array.isArray(entry.questions)) continue;
      const status = entry.status === 'answered' || entry.status === 'cancelled' ? entry.status : 'pending';
      out[id] = {
        id,
        questions: entry.questions,
        createdAt: Number(entry.createdAt) || Date.now(),
        status,
        answers: (status === 'answered' && entry.answers && typeof entry.answers === 'object') ? entry.answers : null,
        answeredAt: Number(entry.answeredAt) || null,
        cancelReason: (status === 'cancelled' && typeof entry.cancelReason === 'string') ? entry.cancelReason : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Save the full entries map (atomic).
 * Callers should pass the same shape returned by loadAskStore — extra fields are stripped.
 */
export function saveAskStore(entries) {
  const cleaned = {};
  for (const [id, entry] of Object.entries(entries || {})) {
    if (!entry || typeof id !== 'string') continue;
    if (!Array.isArray(entry.questions)) continue;
    const status = entry.status === 'answered' || entry.status === 'cancelled' ? entry.status : 'pending';
    cleaned[id] = {
      id,
      questions: entry.questions,
      createdAt: Number(entry.createdAt) || Date.now(),
      status,
      answers: status === 'answered' ? (entry.answers || null) : null,
      answeredAt: status === 'answered' ? (Number(entry.answeredAt) || Date.now()) : null,
      cancelReason: status === 'cancelled' ? (entry.cancelReason || '') : null,
    };
  }
  const tmpFile = `${getStoreFile()}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const body = JSON.stringify({ version: SCHEMA_VERSION, entries: cleaned });
    writeFileSync(tmpFile, body);
    renameSyncWithRetry(tmpFile, getStoreFile());
  } catch (err) {
    try { unlinkSync(tmpFile); } catch {}
    // 持久化失败 ≠ 业务失败：server 主流程不能因此卡住。
    // 调用方（server.js setEntry/deleteEntry）会吞这个错（落盘是 best-effort）。
    // 但用户视角 server 重启后 /api/pending-asks 永远空 → 找不到原因。
    // 进程级首次失败 console.warn 一次方便排查（磁盘满 / 权限 / SIGPIPE）。
    if (!_loggedPersistError) {
      _loggedPersistError = true;
      try {
        console.warn(`[cc-viewer] ask-store persistence failed (will retry silently): ${err?.message || err}`);
      } catch {}
    }
    throw err;
  }
}

/**
 * Mark an entry as answered. If the entry doesn't exist on disk yet, create it with
 * minimal shape (questions=[]) so ask-bridge short-poll can still pick it up after
 * a server restart that lost the in-memory placeholder.
 *
 * First-write-wins: 若 disk 已 answered/cancelled，本调用 noop —— 防止两浏览器同答时
 * last-write-wins 覆盖错乱（A 选 X 落盘 → B 选 Y 又落 → ask-bridge 最终拿 Y 而 A UI 显 X）。
 * Returns true if this call wrote, false if noop'd by existing terminal state.
 */
export async function markAnswered(id, answers) {
  if (!id || typeof id !== 'string') return false;
  if (!answers || typeof answers !== 'object') return false;
  try {
    return await withLock(() => {
      const all = loadAskStore();
      const existing = all[id];
      if (existing && (existing.status === 'answered' || existing.status === 'cancelled')) {
        return false;
      }
      const base = existing || { id, questions: [], createdAt: Date.now() };
      all[id] = {
        ...base,
        status: 'answered',
        answers,
        answeredAt: Date.now(),
        cancelReason: null,
      };
      saveAskStore(all);
      return true;
    });
  } catch { return false; }
}

export async function markCancelled(id, reason) {
  if (!id || typeof id !== 'string') return false;
  try {
    return await withLock(() => {
      const all = loadAskStore();
      const existing = all[id];
      if (existing && (existing.status === 'answered' || existing.status === 'cancelled')) {
        return false;
      }
      const base = existing || { id, questions: [], createdAt: Date.now() };
      all[id] = {
        ...base,
        status: 'cancelled',
        answers: null,
        answeredAt: null,
        cancelReason: typeof reason === 'string' ? reason : '',
      };
      saveAskStore(all);
      return true;
    });
  } catch { return false; }
}

/**
 * Atomic conditional consume: read entry; if status === 'answered' or 'cancelled',
 * delete and return it (one-shot consumption); otherwise return the entry without
 * deleting (caller can decide to wait/retry).
 *
 * 替代旧的 "无条件 consume + setEntry 写回" 双 withLock 模式 —— 那种模式的两次锁
 * 中间窗口会被 markAnswered 命中 → setEntry 把答案覆盖回 pending。
 */
export async function consumeIfFinal(id) {
  if (!id || typeof id !== 'string') return null;
  try {
    return await withLock(() => {
      const all = loadAskStore();
      const entry = all[id];
      if (!entry) return null;
      if (entry.status === 'answered' || entry.status === 'cancelled') {
        delete all[id];
        saveAskStore(all);
      }
      return entry;
    });
  } catch {
    return null;
  }
}

/**
 * Legacy unconditional consume (kept for backward compat with callers that
 * truly want "read + delete regardless of status"). New short-poll GET handler
 * uses consumeIfFinal instead — see server.js GET /api/ask-hook/:id/result.
 */
export async function consume(id) {
  if (!id || typeof id !== 'string') return null;
  try {
    return await withLock(() => {
      const all = loadAskStore();
      const entry = all[id];
      if (!entry) return null;
      delete all[id];
      saveAskStore(all);
      return entry;
    });
  } catch {
    return null;
  }
}

/**
 * Atomic upsert: load → mutate → save under file lock.
 * fields 必须含 questions: []；其余字段（status、createdAt）由本函数兜底。
 *
 * Status guard: 若 disk 已 answered/cancelled（markAnswered/markCancelled 落过），
 * setEntry 不能把 status 倒回 pending —— 否则 setImmediate 排队的延迟 _persistAskEntry
 * 或重 POST 的 placeholder 会覆盖真实终态，导致 ask-bridge 短轮询永远拿不到答案。
 */
export async function setEntry(id, fields) {
  if (!id || typeof id !== 'string') return;
  if (!fields || !Array.isArray(fields.questions)) return;
  try {
    await withLock(() => {
      const all = loadAskStore();
      const existing = all[id];
      if (existing && (existing.status === 'answered' || existing.status === 'cancelled')) {
        return; // 已是终态，setEntry 视作 noop（幂等）
      }
      all[id] = {
        id,
        questions: fields.questions,
        createdAt: Number(fields.createdAt) || Date.now(),
        status: 'pending',
      };
      saveAskStore(all);
    });
  } catch {
    // best-effort：磁盘失败不影响内存 Map 主流程
  }
}

export async function deleteEntry(id) {
  if (!id || typeof id !== 'string') return;
  try {
    await withLock(() => {
      const all = loadAskStore();
      if (!(id in all)) return;
      delete all[id];
      saveAskStore(all);
    });
  } catch {}
}

/**
 * Replace the entire store atomically. Used on server startup to drop entries
 * older than maxAgeMs (24h-class staleness sweep) without N round-trips.
 */
export async function replaceAll(entries) {
  try {
    await withLock(() => saveAskStore(entries));
  } catch {}
}

/**
 * Clean up entries older than maxAgeMs. Returns the surviving entries.
 * Called at server startup to drop truly stale entries (>24h, equivalent to old HOOK_TIMEOUT).
 *
 * Stale 判定用 max(createdAt, answeredAt)：刚 answered 的老 entry（createdAt 旧但
 * answeredAt 新）必须保留，否则 ask-bridge 短轮询拿不到答案。
 */
export async function pruneStale(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    return await withLock(() => {
      const all = loadAskStore();
      const cutoff = Date.now() - maxAgeMs;
      const survivors = {};
      for (const [id, entry] of Object.entries(all)) {
        const lastTouched = Math.max(Number(entry.createdAt) || 0, Number(entry.answeredAt) || 0);
        if (lastTouched >= cutoff) survivors[id] = entry;
      }
      saveAskStore(survivors);
      return survivors;
    });
  } catch {
    return {};
  }
}
