#!/usr/bin/env node
/**
 * turn-end-bridge.js — Stop hook bridge for "Claude turn ended" signal.
 *
 * Called by Claude Code when the model finishes responding. Fires a one-shot
 * POST to cc-viewer's /api/turn-end-notify so the running cc-viewer server can
 * broadcast a `turn_end` SSE event to every connected client. The frontend uses
 * that signal to play the voice-pack `turnEnd` audio.
 *
 * Why this instead of isStreaming falling-edge on the SSE stream:
 *   `streamingState.active` resets after **each individual Claude API call**, not
 *   after the whole user-prompt response completes. Between tool calls
 *   isStreaming flips false then true; with slow tools (Bash > 2s, network, etc.)
 *   the 2s spinner debounce isn't long enough and we'd fire turnEnd mid-prompt.
 *   The Stop hook fires exactly once per real turn end, so it's the right signal.
 *
 * Hook config in ~/.claude/settings.json (injected by ensure-hooks.js, tagged
 * `# cc-viewer-managed`):
 *   "hooks": {
 *     "Stop": [{ "hooks": [{ "type": "command",
 *                            "command": "[ -n \"$CCVIEWER_PORT\" ] && node /path/to/turn-end-bridge.js || true # cc-viewer-managed" }] }]
 *   }
 *
 * Output contract: nothing on stdout (so we don't pollute other Stop hooks' decision
 * channel), optional stderr only when `CCVIEWER_DEBUG=1`. Always exit 0 so a failed
 * notify never blocks Claude Code's hook chain.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const debug = (msg) => {
  if (process.env.CCVIEWER_DEBUG === '1') {
    try { process.stderr.write(`[turn-end-bridge] ${msg}\n`); } catch { /* ignore */ }
  }
};

const port = process.env.CCVIEWER_PORT;
const rawProtocol = process.env.CCVIEWER_PROTOCOL;
const isHttps = rawProtocol === 'https';
const httpClient = isHttps ? https : http;

// cc-viewer not running — exit silently. We must NOT write `{ continue: true, ... }`
// to stdout: Claude Code interprets Stop hook stdout as decision-control JSON, and
// our payload would risk overriding another user-installed Stop hook's `decision`.
// Just exit 0 (round-3 defensive P1 — stdout pollution).
if (!port) {
  debug('CCVIEWER_PORT unset — exit silently');
  process.exit(0);
}

// Drain stdin best-effort. Claude Code passes a JSON payload with session_id /
// transcript_path; both session_id and transcript_path are forwarded. Capped to 64 KB to defang any
// malformed huge payload().
let stdinData = '';
try {
  const buf = readFileSync(0);
  stdinData = (buf.length > 64 * 1024 ? buf.slice(0, 64 * 1024) : buf).toString('utf-8');
} catch { /* stdin may not be piped — fine, still notify */ }
let sessionId = null;
let transcriptPath = null;
try {
  const parsed = JSON.parse(stdinData);
  sessionId = parsed?.session_id || null;
  // transcript_path lets the DingTalk bridge read the final assistant turn straight from
  // Claude's own JSONL (the clean source, free of ANSI noise / the log-dedup bug).
  transcriptPath = parsed?.transcript_path || null;
} catch { /* fine */ }

const internalToken = process.env.CCVIEWER_INTERNAL_TOKEN || '';
const body = JSON.stringify({ sessionId, transcriptPath, ts: Date.now() });
const reqOpts = {
  hostname: '127.0.0.1',
  port: parseInt(port, 10),
  path: '/api/turn-end-notify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // X-CCViewer-Internal: anti-CSRF / anti-spoof header — matched against the
    // server's INTERNAL_TOKEN (random per-startup, only env-leaked to claude
    // child via pty-manager). A loopback-resident attacker that doesn't know
    // the token still can't fake turn_end events into cc-viewer SSE.
    ...(internalToken ? { 'X-CCViewer-Internal': internalToken } : {}),
  },
  // Round-3 P2: keep timeout snappy so a stale cc-viewer doesn't block the
  // Claude Code hook chain for a noticeable beat before the user can type again.
  timeout: 500,
};
if (isHttps) {
  // Loopback HTTPS is typically self-signed; certificate validation would reject.
  // Round-3 P1 cross-bridge regression — same fix should land in ask/perm bridges.
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
  // Wrap the synchronous write/end so an immediate EPIPE doesn't bubble to
  // Claude Code's transcript as `Error: write EPIPE` (round-3 defensive P1).
  try {
    req.write(body);
    req.end();
  } catch (err) {
    finish(`req.write threw: ${err?.message}`);
  }
} catch (err) {
  // httpClient.request itself failed (invalid options, etc.) — give up cleanly.
  finish(`request() threw: ${err?.message}`);
}
