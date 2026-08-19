#!/usr/bin/env node
/**
 * session-start-bridge.js — SessionStart hook bridge for conversation-switch
 * signals (in-terminal /resume, and future /clear / compact interest).
 *
 * Called by Claude Code whenever a session (re)starts: source is one of
 * "startup" | "resume" | "clear" | "compact". The one that matters today is
 * `resume` — an in-terminal /resume switches the running process to a PAST
 * conversation while the wire session_id may stay the same, so without this
 * signal cc-viewer keeps writing the resumed conversation into the OLD
 * session dir and the [对话] panel never switches. The bridge forwards the
 * hook payload to cc-viewer's /api/session-start-notify; the server gates on
 * source and tells the V2Writer to re-bind routing (see v2-writer.js
 * beginResumeSwitch).
 *
 * Hook config in ~/.claude/settings.json (injected by ensure-hooks.js, tagged
 * `# cc-viewer-managed`):
 *   "hooks": {
 *     "SessionStart": [{ "hooks": [{ "type": "command",
 *       "command": "[ -n \"$CCVIEWER_PORT\" ] && node /path/to/session-start-bridge.js || true # cc-viewer-managed" }] }]
 *   }
 *
 * Output contract (same as turn-end-bridge.js): NOTHING on stdout — Claude
 * Code interprets SessionStart hook stdout as context-injection JSON
 * (hookSpecificOutput.additionalContext), and any stray bytes would pollute
 * the conversation. Optional stderr only when CCVIEWER_DEBUG=1. Always exit 0
 * so a failed notify never blocks Claude Code's hook chain.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const debug = (msg) => {
  if (process.env.CCVIEWER_DEBUG === '1') {
    try { process.stderr.write(`[session-start-bridge] ${msg}\n`); } catch { /* ignore */ }
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

// Drain stdin best-effort. Claude Code passes the hook JSON payload
// ({session_id, transcript_path, source, cwd, ...}); capped to 64 KB to
// defang any malformed huge payload.
let stdinData = '';
try {
  const buf = readFileSync(0);
  stdinData = (buf.length > 64 * 1024 ? buf.slice(0, 64 * 1024) : buf).toString('utf-8');
} catch { /* stdin may not be piped — fine, still notify */ }
let sessionId = null;
let transcriptPath = null;
let source = null;
let cwd = null;
try {
  const parsed = JSON.parse(stdinData);
  sessionId = parsed?.session_id || null;
  transcriptPath = parsed?.transcript_path || null;
  source = parsed?.source || null;
  cwd = parsed?.cwd || null;
} catch { /* fine — the server tolerates missing fields */ }
debug(`payload source=${source} session_id=${sessionId} transcript=${transcriptPath}`);

const internalToken = process.env.CCVIEWER_INTERNAL_TOKEN || '';
const body = JSON.stringify({ source, sessionId, transcriptPath, cwd, ts: Date.now() });
const reqOpts = {
  hostname: '127.0.0.1',
  port: parseInt(port, 10),
  path: '/api/session-start-notify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // Same anti-spoof header as turn-end-bridge: matched against the server's
    // per-startup INTERNAL_TOKEN, env-leaked only to the claude child.
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
  // Claude Code's transcript (same defensive shape as turn-end-bridge).
  try {
    req.write(body);
    req.end();
  } catch (err) {
    finish(`req.write threw: ${err?.message}`);
  }
} catch (err) {
  finish(`request() threw: ${err?.message}`);
}
