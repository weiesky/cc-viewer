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

const port = process.env.CCVIEWER_PORT;
if (!port) {
  // cc-viewer not running — fall back to terminal UI silently (exit 0)
  // exit(1) causes Claude Code to log "hook error" on every AskUserQuestion call
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

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function postToViewer() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ questions });
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/ask-hook',
      method: 'POST',
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

try {
  const data = await postToViewer();
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
  // Server unreachable → fall back to terminal UI (not auto-allow)
  process.stderr.write(`ask-bridge: ${err.message} (falling back to terminal UI)\n`);
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }) + '\n');
  process.exit(0);
}
