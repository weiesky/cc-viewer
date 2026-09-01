#!/usr/bin/env node
/**
 * task-bridge.js — hook bridge for Claude Code's task-checklist events.
 *
 * Feeds the GUI task-progress HUD: forwards every task mutation to cc-viewer's
 * /api/task-event, where server/lib/task-state.js maintains the checklist and
 * broadcasts it over SSE (`task_update`).
 *
 * Hook config in ~/.claude/settings.json (injected by ensure-hooks.js, tagged
 * `# cc-viewer-managed`):
 *   "hooks": {
 *     "TaskCreated":  [{ "hooks": [{ "type": "command", "command": "... task-bridge.js ..." }] }],
 *     "TaskCompleted":[{ "hooks": [{ "type": "command", "command": "... task-bridge.js ..." }] }],
 *     "PostToolUse":  [{ "matcher": "TaskUpdate", "hooks": [{ "type": "command", ... }] }]
 *   }
 *
 * Payload shapes (CC 2.1.x):
 *   TaskCreated/TaskCompleted: { hook_event_name, session_id, transcript_path,
 *     cwd, task_id, task_subject, task_description?, teammate_name?, agent_id? }
 *   PostToolUse(TaskUpdate):   { hook_event_name: "PostToolUse", session_id, ...,
 *     tool_name: "TaskUpdate", tool_input: { taskId, status?, owner?,
 *     subject?, description?, activeForm? } }
 *
 * Output contract (same as session-start-bridge.js): NOTHING on stdout —
 * PostToolUse interprets stdout starting with "{" as decision JSON, and any
 * stray bytes pollute the hook chain. Optional stderr only when
 * CCVIEWER_DEBUG=1. ALWAYS exit 0: exit code 2 on TaskCreated/TaskCompleted
 * rolls back task creation / prevents completion, so a failed notify must
 * never surface as a non-zero exit.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const debug = (msg) => {
  if (process.env.CCVIEWER_DEBUG === '1') {
    try { process.stderr.write(`[task-bridge] ${msg}\n`); } catch { /* ignore */ }
  }
};

const port = process.env.CCVIEWER_PORT;
const rawProtocol = process.env.CCVIEWER_PROTOCOL;
const isHttps = rawProtocol === 'https';
const httpClient = isHttps ? https : http;

// cc-viewer not running — exit silently (stdout must stay clean, see header).
if (!port) {
  debug('CCVIEWER_PORT unset — exit silently');
  process.exit(0);
}

// Drain stdin best-effort; capped to 64 KB to defang malformed huge payloads.
let stdinData = '';
try {
  const buf = readFileSync(0);
  stdinData = (buf.length > 64 * 1024 ? buf.slice(0, 64 * 1024) : buf).toString('utf-8');
} catch { /* stdin may not be piped — fine, still notify */ }

let parsed = null;
try {
  parsed = JSON.parse(stdinData);
} catch { /* fine — the server tolerates missing fields */ }

// Normalize to one canonical camelCase envelope regardless of hook event.
// TaskCreated/TaskCompleted carry snake_case task fields at the top level;
// PostToolUse carries a camelCase tool_input. Read both aliases defensively.
const hookEventName = parsed?.hook_event_name || null;
const toolInput = (parsed?.tool_input && typeof parsed.tool_input === 'object') ? parsed.tool_input : {};
const body = JSON.stringify({
  hookEventName,
  toolName: parsed?.tool_name || null,
  sessionId: parsed?.session_id || null,
  transcriptPath: parsed?.transcript_path || null,
  cwd: parsed?.cwd || null,
  teammateName: parsed?.teammate_name || null,
  agentId: parsed?.agent_id || null,
  taskId: parsed?.task_id ?? toolInput.taskId ?? null,
  taskSubject: parsed?.task_subject ?? toolInput.subject ?? null,
  taskDescription: parsed?.task_description ?? toolInput.description ?? null,
  status: toolInput.status ?? null,
  owner: toolInput.owner ?? null,
  activeForm: toolInput.activeForm ?? null,
  ts: Date.now(),
});
debug(`payload event=${hookEventName} tool=${parsed?.tool_name} taskId=${parsed?.task_id ?? toolInput.taskId}`);

const internalToken = process.env.CCVIEWER_INTERNAL_TOKEN || '';
const reqOpts = {
  hostname: '127.0.0.1',
  port: parseInt(port, 10),
  path: '/api/task-event',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // Same anti-spoof header as the other bridges: matched against the
    // server's per-startup INTERNAL_TOKEN, env-leaked only to the claude child.
    ...(internalToken ? { 'X-CCViewer-Internal': internalToken } : {}),
  },
  // Keep the timeout snappy so a stale cc-viewer never blocks the Claude Code
  // hook chain for a noticeable beat.
  timeout: 500,
};
if (isHttps) {
  // Loopback HTTPS is typically self-signed; validation would reject.
  reqOpts.rejectUnauthorized = false;
}

let exited = false;
const finish = (reason) => {
  if (exited) return;
  exited = true;
  if (reason) debug(reason);
  process.exit(0);
};

let req;
try {
  req = httpClient.request(reqOpts, (res) => {
    res.resume();
    res.on('end', () => finish(`POST done (status=${res.statusCode})`));
  });
  req.on('error', (err) => finish(`POST error: ${err?.message}`));
  req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } finish('POST timeout'); });
  // Wrap the synchronous write/end so an immediate EPIPE never bubbles into
  // Claude Code's transcript (same defensive shape as the other bridges).
  try {
    req.write(body);
    req.end();
  } catch (err) {
    finish(`req.write threw: ${err?.message}`);
  }
} catch (err) {
  finish(`request() threw: ${err?.message}`);
}
