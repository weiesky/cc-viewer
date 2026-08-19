/**
 * Workflow Watcher
 *
 * 监视某 session 的 workflows 目录（<sessionDir>/workflows/），journal 文件被整体覆写
 * 时读全文件 → normalizeWorkflowJournal → 经 SSE 广播 `workflow_update` 事件，让前端
 * 工作流面板实时跟随。
 *
 * 设计：
 * - 复用 log-watcher 的 dir fs.watch + 防抖 + 安全网慢轮询模式；fs.watch 不可用/漏事件时
 *   由 SAFETY_POLL_MS 兜底。
 * - 惰性 arm：前端首次拉 journal（REST）时按 session 武装；同目录只 arm 一次（刷新 clients
 *   引用）。arm 时把现存 journal 记入 seen 基线（不广播，初值由 REST 返回），之后仅广播签名
 *   变化的文件，避免历史 journal 在 arm 瞬间洪泛。
 * - 测试缝：__setWatchImplForTests 注入假 fs.watch；__triggerScanForTests 手动触发扫描，
 *   规避真实 fs.watch/轮询时序在 CI 上的不确定性（仿 log-watcher.__setWatchFileImplForTests）。
 */

import { existsSync, watch, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sendEventToClients } from './log-watcher.js';
import { readNormalizedJournal } from './workflow-journal.js';
import { deriveLiveJournal } from './workflow-live.js';

const DEBOUNCE_MS = 120;
const SAFETY_POLL_MS = 5000;
const PRESENCE_POLL_MS = 1000;

const _armed = new Map();      // workflowsDir → state（完成快照）
const _armedLive = new Map();  // runDir → state（运行中逐帧）

let _watchImpl = watch;
/** 测试用：替换 fs.watch 实现。生产恒为 node:fs watch。 */
export function __setWatchImplForTests(fn) { _watchImpl = fn || watch; }

function _signature(p) {
  try { const st = statSync(p); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

function _isJournalFile(f) { return f.startsWith('wf_') && f.endsWith('.json'); }

function _scan(state) {
  const { workflowsDir, sessionId, project, clients, seen } = state;
  let files;
  try { files = readdirSync(workflowsDir); } catch { return; }
  for (const f of files) {
    if (!_isJournalFile(f)) continue;
    const p = join(workflowsDir, f);
    const sig = _signature(p);
    if (!sig) continue;
    if (seen.get(f) === sig) continue;  // 未变
    seen.set(f, sig);
    const data = readNormalizedJournal(p);
    if (!data) continue;
    sendEventToClients(clients, 'workflow_update', {
      sessionId,
      project: project || null,
      runId: data.runId,
      taskId: data.taskId,
      data,
    });
  }
}

function _scheduleScan(state) {
  if (state.debounceTimer) return;
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    _scan(state);
  }, DEBOUNCE_MS);
  state.debounceTimer.unref?.();
}

function _startWatch(state) {
  if (state.watcher || !existsSync(state.workflowsDir)) return false;
  try {
    state.watcher = _watchImpl(state.workflowsDir, () => _scheduleScan(state));
    state.watcher?.on?.('error', () => {
      try { state.watcher?.close?.(); } catch {}
      state.watcher = null;
    });
    return true;
  } catch {
    state.watcher = null;
    return false;
  }
}

function _baseline(state) {
  try {
    for (const f of readdirSync(state.workflowsDir)) {
      if (!_isJournalFile(f)) continue;
      const sig = _signature(join(state.workflowsDir, f));
      if (sig) state.seen.set(f, sig);
    }
  } catch {}
}

/**
 * 武装对某 workflows 目录的监视。同目录重复调用只刷新 clients 引用。
 * @param {{ workflowsDir: string, sessionId?: string, project?: string, clients: Array }} opts
 */
export function armWorkflowWatch({ workflowsDir, sessionId, project, clients } = {}) {
  if (!workflowsDir || !Array.isArray(clients)) return null;

  const existing = _armed.get(workflowsDir);
  if (existing) { existing.clients = clients; return existing; }

  const state = {
    workflowsDir, sessionId, project, clients,
    seen: new Map(), watcher: null,
    debounceTimer: null, safetyTimer: null, presenceTimer: null,
  };
  _armed.set(workflowsDir, state);

  _baseline(state);  // 现存 journal 记入基线，不广播（初值走 REST）

  if (!_startWatch(state)) {
    // 目录尚不存在：轮询等它出现再 watch
    state.presenceTimer = setInterval(() => {
      if (_startWatch(state)) {
        clearInterval(state.presenceTimer);
        state.presenceTimer = null;
        _scheduleScan(state);
      }
    }, PRESENCE_POLL_MS);
    state.presenceTimer.unref?.();
  }

  // 安全网慢轮询，兜 fs.watch 漏事件
  state.safetyTimer = setInterval(() => _scan(state), SAFETY_POLL_MS);
  state.safetyTimer.unref?.();

  return state;
}

/** 测试用：手动触发一次扫描（绕过防抖/真实 fs 事件时序）。 */
export function __triggerScanForTests(workflowsDir) {
  const state = _armed.get(workflowsDir);
  if (state) _scan(state);
}

function _disposeState(state) {
  if (!state) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  if (state.safetyTimer) clearInterval(state.safetyTimer);
  if (state.presenceTimer) clearInterval(state.presenceTimer);
  try { state.watcher?.close?.(); } catch {}
}

/** 解除单个目录监视。 */
export function unwatchWorkflowDir(workflowsDir) {
  const state = _armed.get(workflowsDir);
  if (!state) return;
  _disposeState(state);
  _armed.delete(workflowsDir);
}

/** 解除单个完成快照目录的监视别名 + 运行中目录监视，详见各自实现。 */

// --- 运行中逐帧（watch <sessionDir>/subagents/workflows/<runId>/）---

function _liveSignature(data) {
  if (!data) return 'none';
  const states = data.agents.map(a => `${a.agentId}:${a.state}:${a.tokens}:${a.toolCalls}`).join('|');
  // 纳入 phases 摘要：edit-then-resume 改写脚本 meta.phases（agent 计数/态未变）时也能触发重播，
  // 否则 readPhasesCached 已按 mtime/size 失效重解析了新 phases，却因签名不变被这里抑制广播。
  const phases = (data.phases || []).map(p => p.title).join(',');
  return `${data.status}#${data.agentCount}#${data.totalTokens}#${data.totalToolCalls}#${phases}#${states}`;
}

// runDir = <sessionDir>/subagents/workflows/<runId> → 上溯三级到 sessionDir，查权威快照是否已落盘
function _authoritativeJournalExists(runDir, runId) {
  try {
    const sessionDir = dirname(dirname(dirname(runDir)));
    return existsSync(join(sessionDir, 'workflows', `${runId}.json`));
  } catch { return false; }
}

function _scanLive(state) {
  const { runDir, runId, sessionId, project, clients } = state;
  const data = deriveLiveJournal(runDir, runId);
  if (data) {
    const sig = _liveSignature(data);
    if (sig !== state.lastSig) {  // 有实质变化才广播
      state.lastSig = sig;
      sendEventToClients(clients, 'workflow_update', {
        sessionId,
        project: project || null,
        runId: data.runId,
        taskId: data.taskId || null,
        data,
      });
    }
  }
  // 权威完成快照已落盘 → 逐帧使命结束，自我拆除（最终态由 workflows 目录 watch 接管广播，
  // 且 workflowStore 权威锁会忽略其后乱序的 live 帧）。避免完成后 safetyTimer 永久空转重读。
  if (_authoritativeJournalExists(runDir, runId)) {
    unwatchWorkflowLive(runDir);
  }
}

function _scheduleLiveScan(state) {
  if (state.debounceTimer) return;
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    _scanLive(state);
  }, DEBOUNCE_MS);
  state.debounceTimer.unref?.();
}

function _startLiveWatch(state) {
  if (state.watcher || !existsSync(state.runDir)) return false;
  try {
    state.watcher = _watchImpl(state.runDir, () => _scheduleLiveScan(state));
    state.watcher?.on?.('error', () => {
      try { state.watcher?.close?.(); } catch {}
      state.watcher = null;
    });
    return true;
  } catch {
    state.watcher = null;
    return false;
  }
}

/**
 * 武装对某运行中 workflow 的逐帧监视（subagents/workflows/<runId> 目录）。
 * 同 runDir 重复调用只刷新 clients。arm 时立即广播一次当前推导态（闭合 REST/arm 竞态）。
 * @param {{ runDir: string, runId: string, sessionId?: string, project?: string, clients: Array }} opts
 */
export function armWorkflowLiveWatch({ runDir, runId, sessionId, project, clients } = {}) {
  if (!runDir || !runId || !Array.isArray(clients)) return null;

  const existing = _armedLive.get(runDir);
  if (existing) { existing.clients = clients; return existing; }

  const state = {
    runDir, runId, sessionId, project, clients,
    lastSig: null, watcher: null,
    debounceTimer: null, safetyTimer: null, presenceTimer: null,
  };
  _armedLive.set(runDir, state);

  if (!_startLiveWatch(state)) {
    state.presenceTimer = setInterval(() => {
      if (_startLiveWatch(state)) {
        clearInterval(state.presenceTimer);
        state.presenceTimer = null;
        _scheduleLiveScan(state);
      }
    }, PRESENCE_POLL_MS);
    state.presenceTimer.unref?.();
  } else {
    _scheduleLiveScan(state);
  }

  state.safetyTimer = setInterval(() => _scanLive(state), SAFETY_POLL_MS);
  state.safetyTimer.unref?.();

  return state;
}

/** 测试用：手动触发一次逐帧扫描。 */
export function __triggerLiveScanForTests(runDir) {
  const state = _armedLive.get(runDir);
  if (state) _scanLive(state);
}

/** 解除单个运行中目录监视。 */
export function unwatchWorkflowLive(runDir) {
  const state = _armedLive.get(runDir);
  if (!state) return;
  _disposeState(state);
  _armedLive.delete(runDir);
}

/** 解除所有 workflow 监视（workspace 切换/进程退出）。 */
export function unwatchAllWorkflows() {
  for (const state of _armed.values()) _disposeState(state);
  _armed.clear();
  for (const state of _armedLive.values()) _disposeState(state);
  _armedLive.clear();
}
