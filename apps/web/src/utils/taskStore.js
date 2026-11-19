/**
 * Task checklist store
 *
 * 轻量模块级发布订阅，承接服务端 SSE `task_update` 事件（task-bridge.js →
 * /api/task-event → lib/task-state.js 的全量快照广播），供聊天输入框上方的
 * TaskProgressHud 直接订阅，避免 AppBase→ChatView 深层 prop 穿线。
 *
 * 快照语义：每次 publish 整体替换当前清单（服务端永远发全量，不是 delta），
 * 因此丢帧/乱序天然自愈。
 *
 * - publish(payload): payload = { sessionId, tasks: [...] }。
 * - subscribe(cb): 返回退订函数；初值用 getSnapshot() 读取。
 * - clearTasks(): 会话/工作区切换、冷加载重置时清空。
 *
 * Persistence (browser refresh):
 * - SDK-mode agent tasks are persisted to localStorage by sdkTaskTracker,
 *   keyed by sessionId so multiple concurrent sessions don't collide.
 * - An LRU index caps stored sessions at MAX_PERSISTED_SESSIONS to prevent
 *   unbounded growth.
 * - Restored snapshots are treated as seed-only: they never overwrite live
 *   authoritative data from the server.
 * - A TTL (MAX_SNAPSHOT_AGE_MS) bounds how long a persisted snapshot is
 *   considered restorable; older entries are ignored and evicted on read.
 */

const STORAGE_PREFIX = 'ccv_activeAgents:';
const LRU_INDEX_KEY = 'ccv_activeAgents_lru';
const MAX_PERSISTED_SESSIONS = 10;
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

let _snapshot = { sessionId: null, tasks: [] };
const _subs = new Set();

function _emit() {
  for (const cb of _subs) {
    try { cb(_snapshot); } catch {}
  }
}

function _storageKey(sessionId) {
  return sessionId ? STORAGE_PREFIX + sessionId : null;
}

function _readLruIndex() {
  try {
    const raw = localStorage.getItem(LRU_INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function _writeLruIndex(sessions) {
  try {
    localStorage.setItem(LRU_INDEX_KEY, JSON.stringify(sessions));
  } catch {}
}

function _removeFromLru(sessionId) {
  if (!sessionId) return;
  const sessions = _readLruIndex().filter(s => s !== sessionId);
  _writeLruIndex(sessions);
}

function _touchLru(sessionId) {
  if (!sessionId) return;
  const sessions = _readLruIndex().filter(s => s !== sessionId);
  sessions.unshift(sessionId);
  // Evict oldest sessions beyond the cap.
  while (sessions.length > MAX_PERSISTED_SESSIONS) {
    const evicted = sessions.pop();
    try { localStorage.removeItem(STORAGE_PREFIX + evicted); } catch {}
  }
  _writeLruIndex(sessions);
}

/**
 * Persist the current snapshot to localStorage, keyed by sessionId.
 * Only called by the SDK task tracker (sdkTaskTracker._publish), NOT by
 * the PTY hook path — this keeps the storage scoped to SDK-mode agent data
 * and prevents the boot-time SSE empty task_update from erasing checkpoints.
 */
export function persistSnapshot(ownerKey) {
  const sessionId = _snapshot.sessionId;
  if (!sessionId) return;
  const key = _storageKey(sessionId);
  if (!key) return;
  try {
    if (_snapshot.tasks.length === 0) {
      localStorage.removeItem(key);
      _removeFromLru(sessionId);
      return;
    }
    localStorage.setItem(key, JSON.stringify({
      sessionId,
      tasks: _snapshot.tasks,
      ownerKey: typeof ownerKey === 'string' ? ownerKey : null,
      ts: Date.now(),
    }));
    _touchLru(sessionId);
  } catch {}
}

/**
 * Restore a persisted snapshot for a given sessionId.
 * Returns the parsed entry or null (missing / malformed / wrong session / expired).
 */
export function restoreSnapshot(sessionId) {
  if (!sessionId) return null;
  const key = _storageKey(sessionId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(key);
      return null;
    }
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      localStorage.removeItem(key);
      return null;
    }
    // Session mismatch guard: the stored sessionId must match the requested one.
    if (parsed.sessionId !== sessionId) return null;
    // TTL guard: reject snapshots older than MAX_SNAPSHOT_AGE_MS.
    if (typeof parsed.ts === 'number' && Number.isFinite(parsed.ts)) {
      if (Date.now() - parsed.ts > MAX_SNAPSHOT_AGE_MS) {
        localStorage.removeItem(key);
        _removeFromLru(sessionId);
        return null;
      }
    }
    return {
      sessionId: parsed.sessionId,
      tasks: parsed.tasks,
      ownerKey: typeof parsed.ownerKey === 'string' ? parsed.ownerKey : null,
      ts: typeof parsed.ts === 'number' ? parsed.ts : null,
    };
  } catch {
    return null;
  }
}

/** Clear the persisted snapshot for a given sessionId. */
export function clearPersistedSnapshot(sessionId) {
  const key = _storageKey(sessionId);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
  _removeFromLru(sessionId);
}

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed']);

function _normalizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.taskId == null) return null;
  // The server removes `deleted` tasks before broadcast and always sends a
  // status; an unknown status here means the wire invariant broke — drop the
  // row rather than render a ghost "pending".
  if (t.status != null && !VALID_STATUSES.has(t.status)) return null;
  return {
    ...t,
    taskId: String(t.taskId),
    status: t.status || 'pending',
  };
}

export function publish(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (!Array.isArray(payload.tasks)) return;
  const tasks = [];
  for (const t of payload.tasks) {
    const n = _normalizeTask(t);
    if (n) tasks.push(n);
  }
  _snapshot = { sessionId: payload.sessionId || null, tasks };
  _emit();
}

export function subscribe(cb) {
  if (typeof cb !== 'function') return () => {};
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}

export function getSnapshot() {
  return _snapshot;
}

export function getTasks() {
  return _snapshot.tasks;
}

export function clearTasks() {
  if (_snapshot.tasks.length === 0 && _snapshot.sessionId === null) return;
  _snapshot = { sessionId: null, tasks: [] };
  _emit();
}

/** Test hook: restore pristine module state. */
export function __resetForTests() {
  _snapshot = { sessionId: null, tasks: [] };
  _subs.clear();
}
