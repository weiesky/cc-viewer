import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'lib', 'perm-bridge.js');

function runBridge(stdin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, CCV_BYPASS_PERMISSIONS: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

describe('perm-bridge.js', () => {
  it('exits 1 when CCVIEWER_PORT is not set', async () => {
    const { code } = await runBridge('{}', { CCVIEWER_PORT: '' });
    assert.equal(code, 1);
  });

  it('exits 1 when stdin is invalid JSON', async () => {
    const { code } = await runBridge('not-json', { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('exits 1 when stdin is empty', async () => {
    const { code } = await runBridge('', { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('auto-allows when CCV_BYPASS_PERMISSIONS is set', async () => {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: '9999', CCV_BYPASS_PERMISSIONS: '1' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
  });

  it('exits 1 when toolName is missing', async () => {
    const input = JSON.stringify({ tool_input: { command: 'ls' } });
    const { code } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('exits 1 when toolInput is missing', async () => {
    const input = JSON.stringify({ tool_name: 'Bash' });
    const { code } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('returns no-decision for AskUserQuestion', async () => {
    const input = JSON.stringify({
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Q?' }] },
    });
    const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  });

  it('returns explicit allow for Read (not in APPROVAL_TOOLS)', async () => {
    const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
    const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
  });

  for (const tool of ['Glob', 'Grep', 'Agent', 'TaskCreate', 'TaskUpdate',
    'TaskList', 'TaskGet', 'CronCreate', 'CronDelete', 'CronList', 'SendMessage',
    'EnterPlanMode', 'ExitPlanMode', 'Skill', 'EnterWorktree', 'ExitWorktree']) {
    it(`returns explicit allow for ${tool} (not in APPROVAL_TOOLS)`, async () => {
      const input = JSON.stringify({ tool_name: tool, tool_input: { x: 1 } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: '9999' });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
    });
  }

  for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']) {
    it(`forwards ${tool} to server for approval (exits 1 when server unreachable)`, async () => {
      const input = JSON.stringify({ tool_name: tool, tool_input: { command: 'test' } });
      const { code } = await runBridge(input, { CCVIEWER_PORT: '19999' });
      // Server unreachable → catch block → exit 1 (fallback to Claude Code UI)
      assert.equal(code, 1);
    });
  }

  // git commit/push/npm publish 不再直接 deny，和其他 Bash 命令一样走 Web UI 审批
  for (const cmd of ['git commit -m "test"', 'git push origin main', 'npm publish']) {
    it(`forwards "${cmd}" to server for approval (no auto-deny)`, async () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });
      const { code } = await runBridge(input, { CCVIEWER_PORT: '19999' });
      // Forwards to server → unreachable → exit 1 (same as any other Bash command)
      assert.equal(code, 1);
    });
  }

  describe('with mock server', () => {
    let server;
    let serverPort;

    beforeEach(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const data = JSON.parse(body);
          // Always approve
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: 'allow', toolName: data.toolName }));
        });
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          resolve();
        });
      });
    });

    afterEach(() => {
      server.close();
    });

    it('returns allow decision for Bash when server approves', async () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
    });

    it('returns deny decision when server denies', async () => {
      server.close();
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: 'deny' }));
        });
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          resolve();
        });
      });
      const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/x', content: 'y' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason);
    });
  });
});
