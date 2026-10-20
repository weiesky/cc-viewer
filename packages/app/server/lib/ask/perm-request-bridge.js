#!/usr/bin/env node
/**
 * perm-request-bridge.js — PermissionRequest hook bridge for permission prompts.
 *
 * Registered with matcher: 'Read|Glob|Grep' in ~/.claude/settings.json.
 * Called by Claude Code when a permission prompt is about to be shown, after
 * PreToolUse hooks have not resolved the decision. This catches cases where
 * PreToolUse allow is overridden by built-in ask rules / safety checks — most
 * notably Read/Glob/Grep outside the launch directory.
 *
 * Behavior:
 *   - If cc-viewer is not running (CCVIEWER_PORT unset): exit 0 with { continue: true }.
 *   - Query the cc-viewer server for the current project's autoApproveSeconds.
 *   - Only Read/Glob/Grep are eligible for silent allow; all other tools return
 *     { continue: true } so the normal prompt appears.
 *   - If auto-approve is enabled (instant -1 or countdown >0), return an allow
 *     decision plus updatedPermissions.addDirectories for the target directory.
 *   - Otherwise return { continue: true } so the normal terminal prompt appears.
 *
 * Exit 0 = success (stdout contains hookSpecificOutput or continue fallback)
 * Exit 1 = error (malformed/missing stdin or invalid env)
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { isOverTrustDir } from '../approval-policy.js';

const port = process.env.CCVIEWER_PORT;
const rawProtocol = process.env.CCVIEWER_PROTOCOL;
if (rawProtocol && rawProtocol !== 'http' && rawProtocol !== 'https') {
  process.stderr.write(`perm-request-bridge: invalid CCVIEWER_PROTOCOL "${rawProtocol}" (expected "http" or "https")\n`);
  process.exit(1);
}
const isHttps = rawProtocol === 'https';
const httpClient = isHttps ? https : http;
if (!port) {
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
const cwd = payload?.cwd;

if (!toolName) {
  process.exit(1);
}

// Only Read/Glob/Grep are eligible for silent allow via PermissionRequest. All other
// tools fall through to the normal prompt so user-configured ask rules and
// sensitive operations are never silently approved.
if (toolName !== 'Read' && toolName !== 'Glob' && toolName !== 'Grep') {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function postToViewer() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ toolName, input: toolInput, cwd });
    const req = httpClient.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/perm-request-hook',
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

function buildAllowOutput() {
  const decision = { behavior: 'allow' };
  // For path-based tools, add the target directory to session-level trusted
  // directories so subsequent accesses to the same directory do not prompt again.
  // Guard against over-trust: skip when the resolved parent is '/', the user's
  // home directory, or a top-level/dot directory (e.g. /etc, /Users, ~/.ssh).
  if (toolName === 'Read' && typeof toolInput?.file_path === 'string') {
    const dir = dirname(resolve(toolInput.file_path));
    if (!isOverTrustDir(dir)) {
      decision.updatedPermissions = [
        { type: 'addDirectories', directories: [dir], destination: 'session' },
      ];
    }
  } else if ((toolName === 'Glob' || toolName === 'Grep') && typeof toolInput?.pattern === 'string') {
    const base = toolInput.path ? resolve(toolInput.path) : (cwd ? resolve(cwd) : null);
    if (base && !isOverTrustDir(base)) {
      decision.updatedPermissions = [
        { type: 'addDirectories', directories: [base], destination: 'session' },
      ];
    }
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision,
    },
  };
}

try {
  const data = await postToViewer();
  if (data.decision === 'allow') {
    process.stdout.write(JSON.stringify(buildAllowOutput()) + '\n');
  } else if (data.decision === 'deny') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Denied by cc-viewer plugin' },
      },
    }) + '\n');
  } else {
    // 'ask' or anything else → let Claude Code show the normal prompt
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  }
  process.exit(0);
} catch (err) {
  // Server unreachable / timeout → fall back to normal prompt
  process.stderr.write(`perm-request-bridge: ${err.message} (falling back to terminal UI)\n`);
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}
