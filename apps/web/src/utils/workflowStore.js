/**
 * Workflow live store
 *
 * 轻量模块级发布订阅，承接服务端 SSE `workflow_update` 事件，按 runId（及 taskId 别名）
 * 分发给对应的 WorkflowPanel。避免 AppBase→ChatView→ChatMessage→ToolResultView→Panel
 * 深层 prop 穿线。
 *
 * - publish(payload): AppBase 收到 workflow_update 时调用，payload = { runId, taskId, data, ... }。
 * - subscribe(key, cb): WorkflowPanel 按自身 runId 或 taskId 订阅，返回退订函数。
 * - getLatest(key): 取已缓存的最新 journal（panel 挂载时若已先到事件可即时用）。
 */

const _subs = new Map();          // key(runId|taskId) → Set<cb>
const _latest = new Map();        // key → normalized journal data
const _authoritative = new Set(); // keys that已收到 live===false 的权威完成快照

// 「活跃工作流」追踪：供右下角悬浮 HUD 常驻展示运行中的工作流。
const _active = new Map();         // runId → 最新 data（仅运行中/收尾中）
const _activeSubs = new Set();     // Set<cb(list)>

function _emit(key, data) {
  const set = _subs.get(key);
  if (!set) return;
  for (const cb of set) {
    try { cb(data); } catch {}
  }
}

function _emitActive() {
  const list = [..._active.values()];
  for (const cb of _activeSubs) {
    try { cb(list); } catch {}
  }
}

function _isActive(data) {
  return data.live === true || data.status === 'running' || data.status === 'finishing';
}

export function publish(payload) {
  if (!payload || typeof payload !== 'object') return;
  const data = payload.data;
  if (!data || typeof data !== 'object') return;
  const keys = [];
  if (payload.runId) keys.push(payload.runId);
  if (data.runId && data.runId !== payload.runId) keys.push(data.runId);
  if (payload.taskId) keys.push(payload.taskId);
  if (data.taskId && data.taskId !== payload.taskId) keys.push(data.taskId);
  // 权威完成快照（live!==true）一旦到达即锁定该 key：忽略其后乱序到达的运行中逐帧，
  // 否则尾随的 live 帧会把面板从「已完成」回退成「运行中」。
  const isLive = data.live === true;
  for (const k of keys) {
    if (isLive && _authoritative.has(k)) continue;
    if (!isLive) _authoritative.add(k);
    _latest.set(k, data);
    _emit(k, data);
  }

  // 维护活跃工作流集合（按 canonical runId 去重，避免 taskId 重复计数）
  const rk = data.runId || payload.runId;
  if (rk && !(isLive && _authoritative.has(rk))) {
    if (_isActive(data)) { _active.set(rk, data); _emitActive(); }
    else if (_active.delete(rk)) { _emitActive(); }
  }
}

/** 订阅活跃（运行中/收尾中）工作流列表变化；立即不回调，调用 getActiveWorkflows 取初值。 */
export function subscribeActive(cb) {
  if (typeof cb !== 'function') return () => {};
  _activeSubs.add(cb);
  return () => { _activeSubs.delete(cb); };
}

/** 取当前活跃工作流列表（最新 data 数组）。 */
export function getActiveWorkflows() {
  return [..._active.values()];
}

export function subscribe(key, cb) {
  if (!key || typeof cb !== 'function') return () => {};
  let set = _subs.get(key);
  if (!set) { set = new Set(); _subs.set(key, set); }
  set.add(cb);
  return () => {
    const s = _subs.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) _subs.delete(key);
  };
}

export function getLatest(key) {
  return key ? (_latest.get(key) || null) : null;
}
