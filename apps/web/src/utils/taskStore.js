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
 */

let _snapshot = { sessionId: null, tasks: [] };
const _subs = new Set();

function _emit() {
  for (const cb of _subs) {
    try { cb(_snapshot); } catch {}
  }
}

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

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
