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
 * Exit 1 = fallback (Claude Code proceeds with normal terminal UI)
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const port = process.env.CCVIEWER_PORT;
const isHttps = process.env.CCVIEWER_PROTOCOL === 'https';
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

// 硬拦截：git commit/push 和 npm publish 即使在 --d (bypass) 模式下也强制走 Web UI 审批
// 这是安全底线，不受 --dangerously-skip-permissions 影响
const isPublishCmd = toolName === 'Bash' && toolInput.command &&
  /git\s+(commit|push)|npm\s+publish/i.test(toolInput.command);

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

// These tools need explicit user approval via Web UI (mutating or external access).
const APPROVAL_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']);
if (!APPROVAL_TOOLS.has(toolName)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }) + '\n');
  process.exit(0);
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function postToViewer() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ toolName, input: toolInput });
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
