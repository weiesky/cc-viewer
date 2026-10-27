#!/usr/bin/env node
/**
 * perm-bridge.js — PreToolUse hook bridge for tool permission approval.
 *
 * Registered with matcher: "" (empty = match all tools) in ~/.claude/settings.json.
 * Called by Claude Code before any tool executes. Reads hook payload from stdin,
 * forwards to cc-viewer server via long-poll HTTP, waits for user decision
 * (allow/deny) in the web UI, then outputs hookSpecificOutput.
 *
 * Exit 0 = success (stdout contains hookSpecificOutput with permissionDecision)
 * Exit 1 = error (malformed/missing stdin or invalid env); makes Claude Code log a hook error. Graceful fallback (cc-viewer not running / no decision) instead exits 0 with { continue: true } so the terminal UI proceeds without an error log.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { resolve, sep } from 'node:path';
import { evaluateImDeny } from '../im-deny.js';
import { APPROVAL_TOOLS, isPublishCommand } from '../approval-policy.js';

const port = process.env.CCVIEWER_PORT;
const rawProtocol = process.env.CCVIEWER_PROTOCOL;
if (rawProtocol && rawProtocol !== 'http' && rawProtocol !== 'https') {
  process.stderr.write(`perm-bridge: invalid CCVIEWER_PROTOCOL "${rawProtocol}" (expected "http" or "https")\n`);
  process.exit(1);
}
const isHttps = rawProtocol === 'https';
const httpClient = isHttps ? https : http;
if (!port) {
  // cc-viewer not running — fall back to terminal UI silently (exit 0)
  // exit(1) causes Claude Code to log "hook error" on every tool call
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}

let stdinData;
try {
  stdinData = readFileSync(0, 'utf-8');
} catch {
  process.exit(1);
}

if (!stdinData || !stdinData.trim()) {
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(stdinData);
} catch {
  process.exit(1);
}

const toolName = payload?.tool_name;
const toolInput = payload?.tool_input;

if (!toolName || !toolInput) {
  process.exit(1);
}

// 硬拦截：npm publish 即使在 --d (bypass) 模式下也强制走 Web UI 审批
// 这是安全底线，不受 --dangerously-skip-permissions 影响
// 注：git commit / git push 不在硬拦截范围内 —— 提交可重写、push 可 force-push 回退,
// 真正不可撤销的对外发布(npm publish)才走硬闸。谓词共享自 approval-policy.js(SDK 链路同用)。
const isPublishCmd = isPublishCommand(toolName, toolInput);

// IM worker (skip-permissions) 硬拦截 —— 必须在下面的 bypass auto-allow 之前求值，
// 否则 CCV_BYPASS_PERMISSIONS=1 会把一切先放行（见 plan §安全 2）。仅对 IM worker 生效。
if (process.env.CCV_IM_DENY === '1') {
  const verdict = evaluateImDeny(toolName, toolInput);
  if (verdict.deny) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `cc-viewer IM guard: ${verdict.reason}. 该操作在 IM 机器人(--dangerously-skip-permissions)下被禁止；请改用更安全的方式，或在回复中说明并请用户手动执行。`,
      },
    }) + '\n');
    process.exit(0);
  }
}

// Bypass mode: auto-allow all tools except publish commands
// 使用显式 allow 而非 exit(1) fallback，避免 Claude Code 记录 hook error 日志
if (process.env.CCV_BYPASS_PERMISSIONS === '1' && !isPublishCmd) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
}

// AskUserQuestion has its own dedicated hook (ask-bridge.js)
if (toolName === 'AskUserQuestion') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse' } }) + '\n');
  process.exit(0);
}

// ExitPlanMode is intentionally left as an explicit allow in PTY mode. Routing it to
// the generic permission panel would conflict with the existing inline plan-approval
// card (which uses PTY arrow-key detection) and would let the generic auto-approve
// countdown/instant bypass the independent planAutoApproveSeconds setting. SDK mode
// handles ExitPlanMode through its own dedicated branch in sdk-manager.js.
if (toolName === 'ExitPlanMode') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
} else if (toolName === 'Read' && typeof toolInput?.file_path === 'string') {
  // Read inside the session cwd is safe to auto-allow; outside the session cwd
  // Claude Code's own ask rules would override a PreToolUse allow and still prompt.
  // Let those fall through to the PermissionRequest hook (perm-request-bridge.js)
  // which can approve them silently with an updatedDirectories session grant.
  // Use the hook payload's cwd (the actual session cwd) rather than the server env
  // so multi-workspace sessions classify inside/outside correctly.
  const sessionCwd = payload?.cwd || process.env.CCV_PROJECT_DIR;
  if (sessionCwd) {
    const filePath = resolve(toolInput.file_path);
    const root = resolve(sessionCwd);
    if (filePath === root || filePath.startsWith(root + sep)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      }) + '\n');
      process.exit(0);
    }
    // Outside session cwd → fall through to PermissionRequest hook
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
    process.exit(0);
  }
  // No session cwd → fall back to default behavior (explicit allow)
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
} else if ((toolName === 'Glob' || toolName === 'Grep') && typeof toolInput?.pattern === 'string') {
  // Glob/Grep carry { pattern, path? }; the path field (not file_path) determines the
  // base directory. When omitted, Claude Code resolves against the session cwd.
  const sessionCwd = payload?.cwd || process.env.CCV_PROJECT_DIR;
  if (sessionCwd) {
    const baseDir = toolInput.path ? resolve(toolInput.path) : resolve(sessionCwd);
    const root = resolve(sessionCwd);
    if (baseDir === root || baseDir.startsWith(root + sep)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      }) + '\n');
      process.exit(0);
    }
    // Outside session cwd → fall through to PermissionRequest hook
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
    process.exit(0);
  }
  // No session cwd → fall back to default behavior (explicit allow)
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
} else if (!APPROVAL_TOOLS.has(toolName)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function postToViewer() {
  return new Promise((resolve, reject) => {
    // Forward the session cwd so the server can resolve the project-forked
    // autoApproveSeconds for the right workspace (falls back to the server's
    // current project key when absent — backward compatible).
    const body = JSON.stringify({ toolName, input: toolInput, cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined });
    const req = httpClient.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/perm-hook',
      method: 'POST',
      rejectUnauthorized: false, // allow self-signed certs
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
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
        } else if (res.statusCode === 409) {
          // Superseded by another concurrent request (legacy server behavior)
          // Treat as "no decision" so Claude Code falls back to normal prompt
          resolve({ decision: '_superseded' });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

try {
  const data = await postToViewer();
  const decision = data.decision === 'allow' ? 'allow' : 'deny';

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
    },
  };

  // If denied, add a reason message
  if (decision === 'deny') {
    output.hookSpecificOutput.permissionDecisionReason = 'User denied via cc-viewer';
  }

  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(0);
} catch (err) {
  // Server unreachable → fall back to terminal UI (not auto-allow)
  // continue: true means "this hook has no decision, let Claude Code handle it normally"
  process.stderr.write(`perm-bridge: ${err.message} (falling back to terminal UI)\n`);
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}
