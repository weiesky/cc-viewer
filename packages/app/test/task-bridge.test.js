/**
 * task-bridge.test.js — covers server/lib/task-bridge.js
 *
 * Same spawn-the-bridge pattern as session-start-bridge.test.js: the bridge is
 * a one-shot CLI script (runs on import, always process.exit(0)), so we assert
 * observable behavior:
 *   - exits 0 with CCVIEWER_PORT unset (silent no-op, no request)
 *   - normalizes TaskCreated snake_case payloads to the camelCase envelope
 *   - normalizes PostToolUse(TaskUpdate) tool_input payloads
 *   - forwards X-CCViewer-Internal only when CCVIEWER_INTERNAL_TOKEN set
 *   - never pollutes stdout (PostToolUse stdout is decision-JSON channel;
 *     exit 2 would roll back task creation — the always-exit-0 contract)
 *   - tolerates non-JSON stdin (null fields, still notifies)
 *   - exits 0 on connection refusal
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'task-bridge.js');

function runBridge({ env = {}, stdin = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function captureServer() {
  const captured = { hit: false };
  let resolveHit;
  const hitPromise = new Promise((r) => { resolveHit = r; });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured.hit = true;
      captured.method = req.method;
      captured.url = req.url;
      captured.headers = req.headers;
      captured.body = body;
      resolveHit(captured);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return { server, captured, hitPromise };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const CREATED_PAYLOAD = {
  hook_event_name: 'TaskCreated',
  session_id: 'sess-uuid-1',
  transcript_path: '/Users/x/.claude/projects/p/sess-uuid-1.jsonl',
  cwd: '/Users/x/work/proj',
  task_id: '3',
  task_subject: 'Build the thing',
  task_description: 'With tests',
};

const UPDATE_PAYLOAD = {
  hook_event_name: 'PostToolUse',
  session_id: 'sess-uuid-1',
  transcript_path: '/Users/x/.claude/projects/p/sess-uuid-1.jsonl',
  cwd: '/Users/x/work/proj',
  tool_name: 'TaskUpdate',
  tool_input: { taskId: '3', status: 'in_progress', owner: 'worker-1', activeForm: 'Building the thing' },
  tool_use_id: 'toolu_abc',
};

describe('task-bridge.js', { concurrency: false }, () => {
  it('exits 0 and makes no request when CCVIEWER_PORT is unset', async () => {
    const { server, captured } = captureServer();
    await listen(server);
    try {
      const res = await runBridge({
        env: { CCVIEWER_PORT: '', CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify(CREATED_PAYLOAD),
      });
      assert.equal(res.code, 0, 'must always exit 0 (exit 2 rolls back task creation)');
      assert.equal(res.stdout, '', 'stdout must stay clean (PostToolUse decision channel)');
      assert.equal(captured.hit, false);
      assert.match(res.stderr, /CCVIEWER_PORT unset/);
    } finally {
      server.close();
    }
  });

  it('POSTs the normalized camelCase envelope for TaskCreated payloads', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: '' },
        stdin: JSON.stringify(CREATED_PAYLOAD),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      assert.equal(res.stdout, '', 'stdout stays clean on the notify path too');
      assert.equal(cap.method, 'POST');
      assert.equal(cap.url, '/api/task-event');
      const payload = JSON.parse(cap.body);
      assert.equal(payload.hookEventName, 'TaskCreated');
      assert.equal(payload.taskId, '3');
      assert.equal(payload.taskSubject, 'Build the thing');
      assert.equal(payload.taskDescription, 'With tests');
      assert.equal(payload.sessionId, 'sess-uuid-1');
      assert.equal(payload.transcriptPath, CREATED_PAYLOAD.transcript_path);
      assert.equal(payload.cwd, CREATED_PAYLOAD.cwd);
      assert.equal(payload.status, null, 'TaskCreated carries no status');
      assert.ok(typeof payload.ts === 'number' && payload.ts > 0);
      assert.equal(cap.headers['x-ccviewer-internal'], undefined, 'no token env → header absent');
    } finally {
      server.close();
    }
  });

  it('POSTs tool_input fields for PostToolUse(TaskUpdate) payloads', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: 'tok-9' },
        stdin: JSON.stringify(UPDATE_PAYLOAD),
      });
      const cap = await hitPromise;
      await runP;
      const payload = JSON.parse(cap.body);
      assert.equal(payload.hookEventName, 'PostToolUse');
      assert.equal(payload.toolName, 'TaskUpdate');
      assert.equal(payload.taskId, '3');
      assert.equal(payload.status, 'in_progress');
      assert.equal(payload.owner, 'worker-1');
      assert.equal(payload.activeForm, 'Building the thing');
      assert.equal(cap.headers['x-ccviewer-internal'], 'tok-9');
    } finally {
      server.close();
    }
  });

  it('forwards teammate_name / agent_id from lifecycle payloads (owner/teammate chip data source)', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: JSON.stringify({
          hook_event_name: 'TaskCompleted',
          session_id: 'sess-uuid-1',
          transcript_path: '/t.jsonl',
          cwd: '/p',
          task_id: '5',
          task_subject: 'Teammate job',
          teammate_name: 'worker-7',
          agent_id: 'agent-9',
        }),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.hookEventName, 'TaskCompleted');
      assert.equal(payload.taskId, '5');
      assert.equal(payload.teammateName, 'worker-7');
      assert.equal(payload.agentId, 'agent-9');
    } finally {
      server.close();
    }
  });

  it('tolerates non-JSON stdin: still notifies with null fields', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: 'not json at all',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.hookEventName, null);
      assert.equal(payload.taskId, null);
      assert.equal(payload.status, null);
    } finally {
      server.close();
    }
  });

  it('exits 0 on connection refusal', async () => {
    const tmp = http.createServer();
    const freePort = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    const res = await runBridge({
      env: { CCVIEWER_PORT: String(freePort), CCVIEWER_DEBUG: '1' },
      stdin: JSON.stringify(CREATED_PAYLOAD),
    });
    assert.equal(res.code, 0);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /POST error/);
  });
});
