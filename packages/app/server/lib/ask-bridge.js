#!/usr/bin/env node
/**
 * ask-bridge.js — PreToolUse hook bridge for AskUserQuestion.
 *
 * Called by Claude Code when AskUserQuestion tool is about to execute.
 * Reads hook payload from stdin, forwards questions to cc-viewer server
 * via long-poll HTTP, waits for user answers, then outputs updatedInput
 * with answers to bypass the terminal UI.
 *
 * Exit 0 = success (stdout contains hookSpecificOutput with updatedInput)
 * Exit 1 = fallback (Claude Code proceeds with normal terminal UI)
 *
 * Hook config in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "AskUserQuestion",
 *       "hooks": [{ "type": "command", "command": "node /path/to/ask-bridge.js" }]
 *     }]
 *   }
 * }
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const port = process.env.CCVIEWER_PORT;
const rawProtocol = process.env.CCVIEWER_PROTOCOL;
if (rawProtocol && rawProtocol !== 'http' && rawProtocol !== 'https') {
  process.stderr.write(`ask-bridge: invalid CCVIEWER_PROTOCOL "${rawProtocol}" (expected "http" or "https")\n`);
  process.exit(1);
}
const isHttps = rawProtocol === 'https';
const httpClient = isHttps ? https : http;
if (!port) {
  // cc-viewer not running — fall back to terminal UI silently (exit 0)
  // exit(1) causes Claude Code to log "hook error" on every AskUserQuestion call
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}

// Opt-out: skip cc-viewer's web AskUserQuestion interception and let the prompt fall
// through to the terminal TUI / any downstream PreToolUse|PermissionRequest hooks
// (e.g. a desktop notifier that renders the options elsewhere). Runtime env gate,
// mirroring CCV_BYPASS_PERMISSIONS in perm-bridge.js — the hook stays registered, so
// this toggles per-launch with no settings.json churn. Emitting continue:true (rather
// than exit 1) avoids Claude Code logging a "hook error" on every AskUserQuestion call.
if (process.env.CCV_DISABLE_ASK_HOOK === '1') {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}

let stdinData;
try {
  stdinData = readFileSync(0, 'utf-8');
} catch {
  process.stderr.write('ask-bridge: failed to read stdin\n');
  process.exit(1);
}

if (!stdinData || !stdinData.trim()) {
  process.stderr.write('ask-bridge: empty stdin\n');
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(stdinData);
} catch {
  process.exit(1);
}

const questions = payload?.tool_input?.questions;
if (!Array.isArray(questions) || questions.length === 0) {
  process.exit(1);
}

// 防御性 normalize：claude-code 当前版本会在 PreToolUse hook 之前做 Zod safeParse，所以 hook
// 缺必填字段时根本不会被调用——但为防上游修了 emit→model 的 schema 又把 hook 时序前移，
// 这里把 questions[].options[].description 缺失时补 ""，避免下游 server.js / 前端意外异常。
// 不动 label/question/header（缺这些更可能是上游 bug 而不是合法可补的可选字段）。
for (const q of questions) {
  if (!q || typeof q !== 'object') continue;
  if (!Array.isArray(q.options)) continue;
  for (const opt of q.options) {
    if (opt && typeof opt === 'object' && opt.description === undefined) {
      opt.description = '';
    }
  }
}

// Claude Code 的 PreToolUse hook payload 含 tool_use_id —— 跟 assistant message 里
// AskUserQuestion 那个 tool_use 块的 id 是同一个值。把这个 id 透传给 server 当 Map key，
// 前端 ChatMessage 渲染 inline form 时用同样的 toolId 做严格匹配，portal 才能绑到 modal askSlot。
// 缺失时 server 会 fallback 到自生成 ask_${ts}_${rand}（向后兼容老 Claude Code 版本）。
const toolUseId = payload?.tool_use_id || null;

// 故意不设客户端 req.setTimeout：cc-viewer 走 127.0.0.1 长连接，
// 无反代/CDN 介入，由 server 端 entry res.on('close') + ASK_HOOK_TIMEOUT
// 主动结束响应。用户在 GUI 里的等待时长不再受 ask-bridge 60min 硬上限限制。
//
// 新协议（Phase 3 短轮询）：
//   POST /api/ask-hook with `X-Ask-Poll-Mode: short`
//     新 server → 立即返 { id, capability: 'short-poll' }；client 转 GET 循环
//     旧 server → 忽略 header 仍走 long-poll，最终返 { answers } 或 { cancelled }
//   GET /api/ask-hook/:id/result?wait=30000
//     200 + { answers } → 完成
//     200 + { cancelled, reason } → server 通知 cancel
//     204 → 重发 GET
//     404 → entry 真消失（disk 也丢了）→ 重试 POST 一次（重建 entry）
//     5xx / 网络错误 → 指数退避重试
//
// 这样 server 重启 + 网络抖动场景下 ask-bridge 不再直接 fallback terminal，
// 而是续 GET 等回答（最长 24h，与 server 端 ASK_HOOK_TIMEOUT 同步）。
// 25s 给反代留 5s buffer：nginx proxy_read_timeout 默认 60s / CloudFlare 100s /
// AWS ALB 60s — 30s 是边界值激进配置会切。25s 在常见配置下安全且效率仍接近 30s。
const POLL_WAIT_MS = 25000;
const MAX_NETWORK_RETRIES = 60; // ~5 min of exponential backoff before giving up
// 5xx 持久故障（server 真坏）不应该被当作"网络抖动"等 5 分钟 —— hook 进程挂死 5min 会
// 阻塞 Claude Code 主进程（ensure-hooks 注的 24h timeout 在外侧）。给 5xx 一个独立的小重试
// 上限：3 次 + 短退避（500ms / 1s / 2s），失败后立即 fallback 让用户走 TUI 而不是干等。
const MAX_SERVER_5XX_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function postToViewer() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ questions, toolUseId });
    const req = httpClient.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/ask-hook',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Ask-Poll-Mode': 'short',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid response JSON'));
          }
        } else {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getPollResult(id, waitMs) {
  return new Promise((resolve, reject) => {
    const req = httpClient.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: `/api/ask-hook/${encodeURIComponent(id)}/result?wait=${waitMs}`,
      method: 'GET',
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve({ status: 200, body: JSON.parse(data) }); }
          catch { reject(new Error('Invalid GET response JSON')); }
        } else if (res.statusCode === 204) {
          resolve({ status: 204, body: null });
        } else if (res.statusCode === 404) {
          resolve({ status: 404, body: null });
        } else {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fatal(message) {
  const e = new Error(message);
  e.fatal = true; // 标记不可恢复，catch 不走任何重试逻辑直接 fallback terminal
  return e;
}

// Best-effort cancel notification when Claude Code kills this hook process
// (user declined the AskUserQuestion at the CLI → SIGTERM). Without it the
// server-side entry stays `pending` until the waiter-liveness reaper catches it
// (~90s); with it the modal closes and the store resolves immediately.
// SIGKILL is uncatchable — the reaper remains the backstop.
// Nothing is written to stdout here: Claude Code has already abandoned the hook,
// and the normal answer/deny output contract stays byte-identical on live paths.
let activeAskId = null;

function postCancelBestEffort(id, reason) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const body = JSON.stringify({ reason });
      const creq = httpClient.request({
        hostname: '127.0.0.1',
        port: Number(port),
        path: `/api/ask-hook/${encodeURIComponent(id)}/cancel`,
        method: 'POST',
        rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => { res.resume(); res.on('end', done); res.on('error', done); });
      // Hard bound: this process is dying — never hang on a wedged socket.
      const t = setTimeout(() => { try { creq.destroy(); } catch {} done(); }, 800);
      if (typeof t.unref === 'function') t.unref();
      creq.on('error', done);
      creq.on('close', done);
      creq.write(body);
      creq.end();
    } catch { done(); }
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    if (activeAskId) {
      await postCancelBestEffort(activeAskId, 'hook process exited');
    }
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

async function pollUntilAnswered(askId) {
  let networkRetries = 0;
  let server5xxRetries = 0;
  let postRetried = false;
  while (true) {
    try {
      const { status, body } = await getPollResult(askId, POLL_WAIT_MS);
      if (status === 200) return body;                  // { answers } 或 { cancelled }
      if (status === 204) {                              // 无答案，立即重发
        networkRetries = 0;
        server5xxRetries = 0;
        continue;
      }
      if (status === 404) {
        // entry 真消失（server 重启 + disk pruned）→ 重 POST 一次重建
        if (postRetried) throw fatal('Ask entry gone (404 after retry)');
        postRetried = true;
        const originalId = askId;
        const reInit = await postToViewer();
        if (reInit?.capability === 'short-poll' && reInit?.id) {
          // server fallback id（toolUseId 校验失败时自生成）会让浏览器持有的 askId 与 hook 端
          // 持有的 askId 分裂 —— 浏览器答的 ws ask-hook-answer 找不到对应 entry，UX 上等同失联。
          // 不一致直接 fallback TUI 比绕一圈安全。fatal flag 跳过外层重试逻辑。
          if (reInit.id !== originalId) {
            throw fatal(`Re-init id mismatch (${originalId} → ${reInit.id})`);
          }
          askId = reInit.id;
          networkRetries = 0;
          server5xxRetries = 0;
          continue;
        }
        if (reInit?.answers || reInit?.cancelled) {
          // 重 POST 时 server 已经把答案带回来（罕见但合法 long-poll 路径）
          return reInit;
        }
        throw fatal('Re-init returned unexpected payload');
      }
      throw new Error(`Unexpected status ${status}`);
    } catch (err) {
      // 不可恢复错误（id mismatch / postRetried 后再 404 / 异常 payload）→ 立即放弃。
      // 否则会被下方网络重试逻辑反复重 GET，每次还是同样错误，60 次后才退出 ~5min。
      if (err?.fatal) throw err;
      // 5xx 走独立短重试上限，不与网络抖动共用 60 次配额。
      const is5xx = typeof err?.statusCode === 'number' && err.statusCode >= 500 && err.statusCode < 600;
      if (is5xx) {
        if (++server5xxRetries > MAX_SERVER_5XX_RETRIES) throw err;
        await sleep(Math.min(2000, 500 * Math.pow(2, server5xxRetries - 1)));
        continue;
      }
      if (++networkRetries > MAX_NETWORK_RETRIES) throw err;
      // 指数退避：100ms → 200 → 400 → ... 上限 5s
      await sleep(Math.min(5000, 100 * Math.pow(2, networkRetries - 1)));
    }
  }
}

try {
  let data = await postToViewer();
  // Phase 3: server 看到 X-Ask-Poll-Mode 立即返 ack；旧 server 忽略 header 仍走 long-poll。
  // capability='short-poll' → 进入 GET 循环；否则按 long-poll 返回值（answers / cancelled）直接处理。
  if (data?.capability === 'short-poll' && data?.id) {
    activeAskId = data.id; // arm the SIGTERM/SIGINT best-effort cancel
    data = await pollUntilAnswered(data.id);
    activeAskId = null; // final answer/cancel obtained — nothing left to cancel
  }
  // 用户在 cc-viewer web UI 主动取消（点 Cancel 按钮 / 在输入框打字打断 pending ask）。
  // server.js 的 ask-cancel handler 会给 hook res 回 200 + { cancelled: true, reason }。
  // 输出 PreToolUse hook deny 让 Claude Code 走兜底链：toolExecution.ts 把 deny.message 包装
  // 成 tool_result.is_error=true，配对完整后下一轮 API 不会 400，主循环就绪接收新 prompt。
  if (data.cancelled === true) {
    const reason = typeof data.reason === 'string' && data.reason.length > 0 ? data.reason : 'User aborted by cc-viewer';
    // 加 [cc-viewer:cancel] 前缀作为协议级 sentinel — toolResultBuilder.js 用前缀匹配
    // 区分 cancelled vs rejected，避免靠自然语言模糊匹配（SDK 升级换文案就会失效）。
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[cc-viewer:cancel] ' + reason,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
  }
  if (!data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
    // No valid answers → fall back to terminal UI
    process.stderr.write('ask-bridge: No answers in response (falling back to terminal UI)\n');
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        questions,
        answers: data.answers,
      },
    },
  };

  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(0);
} catch (err) {
  // Server unreachable / saturated → fall back to terminal UI (not auto-allow).
  // 429 is distinct: cc-viewer's pendingAskHooks Map hit ASK_HOOK_MAP_MAX cap and the oldest
  // entry was evicted. Log specifically so users / ops can tell capacity issues from outages.
  if (err.statusCode === 429) {
    process.stderr.write('ask-bridge: cc-viewer ask-hook capacity saturated (HTTP 429), falling back to terminal UI\n');
  } else {
    process.stderr.write(`ask-bridge: ${err.message} (falling back to terminal UI)\n`);
  }
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}
