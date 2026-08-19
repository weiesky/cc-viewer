/**
 * Register AskUserQuestion and permission approval hooks into ~/.claude/settings.json.
 * Shared between cli.js and electron/tab-worker.js.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getClaudeConfigDir } from '../../findcc.js';
import { SERVER_LIB } from '../_paths.js';
import { renameSyncWithRetry } from './file-api.js';

// Marker stamped on hook command strings so a future `cc-viewer cleanup-hooks`
// CLI (or the user manually) can identify entries owned by cc-viewer and remove
// stale ones without touching third-party hooks. Round-3 P0 fix for the
// "npm uninstall leaves zombie paths" footgun — README documents the cleanup recipe.
const CCV_HOOK_MARKER = '# cc-viewer-managed';

// Claude Code 默认 PreToolUse hook 10min (TOOL_HOOK_EXECUTION_TIMEOUT_MS = 600_000)
// 强制 abort → ask-bridge 被 SIGTERM → 主进程走 canUseTool → TUI 接管 AskUserQuestion
// → GUI 端答案失效。Claude Code 单 hook 的 timeout (秒) 优先级最高，本地写 24h 等同无超时。
// 紧急回退：CCV_HOOK_TIMEOUT_S=0 不写 timeout 字段，恢复 10min 默认行为。
const HOOK_TIMEOUT_DEFAULT_S = 86400;
// 7 天硬上限：大值经过 hook.timeout * 1000 后超 Node setTimeout 2^31ms 会立即触发
// → 反而失效。整数 guard 防 0.5 → 500ms 这种半秒超时的反直觉失败。
const HOOK_TIMEOUT_MAX_S = 7 * 86400;
export const HOOK_TIMEOUT_S = (() => {
  const raw = process.env.CCV_HOOK_TIMEOUT_S;
  if (raw === undefined || raw === '') return HOOK_TIMEOUT_DEFAULT_S;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return HOOK_TIMEOUT_DEFAULT_S;
  return Math.min(n, HOOK_TIMEOUT_MAX_S);
})();
const HOOK_TIMEOUT_FIELD = HOOK_TIMEOUT_S > 0 ? { timeout: HOOK_TIMEOUT_S } : {};

// 构造与对比两件事必须同源，否则升级路径会漏字段。
// merge 而非 replace：用户/第三方给同一 hook 追加 if/shell/once/async/asyncRewake 等
// schema 合法字段时，rewrite 不能整对象覆盖把它们吞掉。
export function _buildHookObj(command) {
  return { type: 'command', command, ...HOOK_TIMEOUT_FIELD };
}
export function _hookObjEqual(existing, desired) {
  if (!existing) return false;
  if (existing.type !== desired.type) return false;
  if (existing.command !== desired.command) return false;
  // timeout 字段：未声明 = 视为 0；HOOK_TIMEOUT_S=0 时 desired 也无字段 → 都视为 0
  const a = Number(existing.timeout) || 0;
  const b = Number(desired.timeout) || 0;
  return a === b;
}
function _mergeHookObj(existing, desired) {
  // 保留 existing 中的非冲突字段（if/shell/once/...），desired 字段优先；
  // desired 不含 timeout 时（CCV_HOOK_TIMEOUT_S=0）必须显式 delete existing.timeout 让它消失。
  const merged = { ...(existing || {}), ...desired };
  if (!('timeout' in desired)) delete merged.timeout;
  return merged;
}

// 从 cc-viewer-managed command 字符串里抽出 `node "<path>"` 的目标 path。
// 用于 stale 检测 + uninstall 清理。返回 null 表示格式不匹配（保守不动）。
function _extractNodeTargetPath(cmd) {
  if (typeof cmd !== 'string') return null;
  const m = cmd.match(/node\s+"([^"]+)"/);
  return m ? m[1] : null;
}

// 识别那些含 cc-viewer-managed marker 但 command 路径已经 stale 的 entry —
// 用于升级路径（lib/ → server/lib/ 等）一次性主动清除老条目，避免 _hookObjEqual
// 字段级 merge 留下「半新半旧」状态。同 marker 的新 desired 会在主流程里重新插入。
//
// 策略：通用 existsSync(parsed path)。比硬编码 regex 鲁棒 —— 未来 server-side 再
// 怎么重组目录，只要老条目里的 path 不在了，就识别为 stale。无法解析 path 时保守跳过。
function _looksStaleManagedCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.includes(CCV_HOOK_MARKER)) return false;
  const target = _extractNodeTargetPath(cmd);
  if (!target) return false;
  return !existsSync(target);
}

function _purgeStaleManagedHooks(settings) {
  let removed = 0;
  for (const sectionKey of ['PreToolUse', 'Stop', 'SessionStart']) {
    const arr = settings.hooks?.[sectionKey];
    if (!Array.isArray(arr)) continue;
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = arr[i];
      const hooks = entry?.hooks;
      if (!Array.isArray(hooks)) continue;
      const stale = hooks.some(h => _looksStaleManagedCommand(h?.command));
      if (stale) {
        arr.splice(i, 1);
        removed += 1;
      }
    }
  }
  return removed;
}

// uninstall 专用：清除所有 cc-viewer-managed entry，不论 path 是否还存在。
// 调用方负责 atomic write-back。返回 removed 数量。
export function removeAllManagedHooks(settings) {
  let removed = 0;
  for (const sectionKey of ['PreToolUse', 'Stop', 'SessionStart']) {
    const arr = settings.hooks?.[sectionKey];
    if (!Array.isArray(arr)) continue;
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = arr[i];
      const hooks = entry?.hooks;
      if (!Array.isArray(hooks)) continue;
      const managed = hooks.some(h => typeof h?.command === 'string' && h.command.includes(CCV_HOOK_MARKER));
      if (managed) {
        arr.splice(i, 1);
        removed += 1;
      }
    }
  }
  return removed;
}

export function ensureHooks() {
  try {
    const claudeDir = getClaudeConfigDir();
    const settingsPath = resolve(claudeDir, 'settings.json');
    let settings = {};
    try { if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch {
      console.warn(`[CC Viewer] ${settingsPath} is malformed, skipping hook injection`);
      return;
    }

    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
    if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

    let changed = false;
    // 先一次性清掉「path 已 stale 但还带 cc-viewer-managed marker」的老条目，
    // 让下面的 push 流程直接插新条目，而不是走 _mergeHookObj 半新半旧的合并。
    if (_purgeStaleManagedHooks(settings) > 0) changed = true;

    // AskUserQuestion hook → ask-bridge.js
    // Guard: only execute when CCVIEWER_PORT is set (i.e. launched by cc-viewer)
    const askBridgePath = resolve(SERVER_LIB, 'ask-bridge.js');
    const askCmd = `[ -n "$CCVIEWER_PORT" ] && node "${askBridgePath}" || true ${CCV_HOOK_MARKER}`;
    const askDesired = _buildHookObj(askCmd);
    const askExisting = settings.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
    if (askExisting) {
      if (!_hookObjEqual(askExisting.hooks?.[0], askDesired)) {
        askExisting.hooks = [_mergeHookObj(askExisting.hooks?.[0], askDesired)];
        changed = true;
      }
    } else {
      settings.hooks.PreToolUse.push({
        matcher: 'AskUserQuestion',
        hooks: [askDesired]
      });
      changed = true;
    }

    // Permission approval hook → perm-bridge.js (matcher: "" = match all tools)
    // Guard: only execute when CCVIEWER_PORT is set (i.e. launched by cc-viewer)
    const permBridgePath = resolve(SERVER_LIB, 'perm-bridge.js');
    const permCmd = `[ -n "$CCVIEWER_PORT" ] && node "${permBridgePath}" || true ${CCV_HOOK_MARKER}`;
    const permMatcher = '';
    // Clean up legacy entries
    for (let i = settings.hooks.PreToolUse.length - 1; i >= 0; i--) {
      const h = settings.hooks.PreToolUse[i];
      const cmd = h.hooks?.[0]?.command || '';
      if (cmd.includes('perm-bridge.js') && h.matcher !== permMatcher) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      } else if ((h.matcher === null || h.matcher === undefined) && cmd.includes('perm-bridge.js')) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      } else if (h.matcher === 'Bash' && cmd.includes('grep') && /git|npm/.test(cmd)) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      }
    }
    const permDesired = _buildHookObj(permCmd);
    const permExisting = settings.hooks.PreToolUse.find(h => h.matcher === permMatcher);
    if (permExisting) {
      if (!_hookObjEqual(permExisting.hooks?.[0], permDesired)) {
        permExisting.hooks = [_mergeHookObj(permExisting.hooks?.[0], permDesired)];
        changed = true;
      }
    } else {
      settings.hooks.PreToolUse.push({
        matcher: permMatcher,
        hooks: [permDesired]
      });
      changed = true;
    }

    // Stop hook → turn-end-bridge.js. Fires when Claude finishes responding (real
    // end of a user-prompt turn), so the voice-pack `turnEnd` event can play at the
    // right moment — not after every individual API call like the SSE streaming
    // signal would. Same `CCVIEWER_PORT` guard pattern as the other bridges.
    const turnEndBridgePath = resolve(SERVER_LIB, 'turn-end-bridge.js');
    const turnEndCmd = `[ -n "$CCVIEWER_PORT" ] && node "${turnEndBridgePath}" || true ${CCV_HOOK_MARKER}`;
    // Stop hooks use matcher: '' (or unset) since there's no tool name to scope by.
    // Find any existing entry that already points at our bridge to update-in-place.
    const turnEndDesired = _buildHookObj(turnEndCmd);
    const turnEndExisting = settings.hooks.Stop.find(h => {
      const cmd = h.hooks?.[0]?.command || '';
      return cmd.includes('turn-end-bridge.js');
    });
    if (turnEndExisting) {
      if (!_hookObjEqual(turnEndExisting.hooks?.[0], turnEndDesired)) {
        turnEndExisting.hooks = [_mergeHookObj(turnEndExisting.hooks?.[0], turnEndDesired)];
        changed = true;
      }
    } else {
      settings.hooks.Stop.push({
        hooks: [turnEndDesired],
      });
      changed = true;
    }

    // SessionStart hook → session-start-bridge.js. Fires on startup/resume/
    // clear/compact; no matcher (= all sources) — the bridge forwards `source`
    // and the server gates on it. The `resume` source is the conversation-
    // switch signal the V2Writer needs to re-bind routing after an in-terminal
    // /resume (the wire session_id may not change, so no wire-level signal
    // exists). Same CCVIEWER_PORT guard pattern as the other bridges.
    const sessionStartBridgePath = resolve(SERVER_LIB, 'session-start-bridge.js');
    const sessionStartCmd = `[ -n "$CCVIEWER_PORT" ] && node "${sessionStartBridgePath}" || true ${CCV_HOOK_MARKER}`;
    const sessionStartDesired = _buildHookObj(sessionStartCmd);
    const sessionStartExisting = settings.hooks.SessionStart.find(h => {
      const cmd = h.hooks?.[0]?.command || '';
      return cmd.includes('session-start-bridge.js');
    });
    if (sessionStartExisting) {
      if (!_hookObjEqual(sessionStartExisting.hooks?.[0], sessionStartDesired)) {
        sessionStartExisting.hooks = [_mergeHookObj(sessionStartExisting.hooks?.[0], sessionStartDesired)];
        changed = true;
      }
    } else {
      settings.hooks.SessionStart.push({
        hooks: [sessionStartDesired],
      });
      changed = true;
    }

    if (changed) {
      mkdirSync(claudeDir, { recursive: true });
      // Atomic write(): write to a sibling temp file then rename. Concurrent
      // cc-viewer launches each had a read→mutate→write window where the second writer
      // would clobber the first writer's additions. rename(2) is atomic on POSIX/NTFS,
      // so the worst-case outcome is "last writer's snapshot wins as a whole" — never
      // a partially-applied mutation that loses a hook entry silently.
      const tmpPath = `${settingsPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
      try {
        writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
        // renameSyncWithRetry 而非裸 renameSync：Windows 上 claude.exe / 编辑器
        // 持 settings.json reader handle 时 rename 会抛 EBUSY 被 outer catch 吞掉
        // 静默丢失更新；retry 后再失败再 throw。
        renameSyncWithRetry(tmpPath, settingsPath);
        // 透明声明：修改用户全局 settings.json 是高风险操作，启动日志可见让用户能审计
        console.log(`[cc-viewer] updated ${settingsPath} (hook timeout=${HOOK_TIMEOUT_S}s)`);
      } catch (err) {
        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
      }
    }
  } catch (err) {
    console.warn('[CC Viewer] Failed to ensure hooks:', err.message);
  }
}
