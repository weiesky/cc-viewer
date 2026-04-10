import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'lib', 'ask-bridge.js');

function runBridge(stdin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, ...env },
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

describe('ask-bridge.js', () => {
  it('exits 0 silently when CCVIEWER_PORT is not set', async () => {
    const { code, stdout } = await runBridge('{}', { CCVIEWER_PORT: '' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.continue, true);
    assert.equal(output.suppressOutput, true);
  });

  it('exits 1 when stdin is invalid JSON', async () => {
    const { code } = await runBridge('not-json', { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('exits 1 when questions are missing', async () => {
    const input = JSON.stringify({ tool_input: {} });
    const { code } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('exits 1 when questions array is empty', async () => {
    const input = JSON.stringify({ tool_input: { questions: [] } });
    const { code } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('falls back to terminal UI when server is unreachable', async () => {
    const input = JSON.stringify({
      tool_input: {
        questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }],
      },
    });
    const { code, stdout, stderr } = await runBridge(input, { CCVIEWER_PORT: '19999' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.continue, true);
    assert.ok(stderr.includes('ask-bridge'));
  });

  describe('with mock server', () => {
    let server;
    let port;

    beforeEach(async () => {
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('exits 0 and outputs correct JSON when server returns answers', async () => {
      const questions = [
        { question: 'Which?', header: 'Q', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false },
      ];
      const answers = { 'Which?': 'A' };

      server.on('request', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const data = JSON.parse(body);
          assert.deepEqual(data.questions, questions);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ answers }));
        });
      });

      const input = JSON.stringify({ tool_input: { questions } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });

      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      assert.deepEqual(output.hookSpecificOutput.updatedInput.answers, answers);
      assert.deepEqual(output.hookSpecificOutput.updatedInput.questions, questions);
    });

    it('falls back to terminal UI when server returns non-200', async () => {
      server.on('request', (_req, res) => {
        res.writeHead(500);
        res.end('error');
      });

      const input = JSON.stringify({
        tool_input: {
          questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }],
        },
      });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
    });

    it('falls back to terminal UI when server returns no answers', async () => {
      server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ noAnswers: true }));
      });

      const input = JSON.stringify({
        tool_input: {
          questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }],
        },
      });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
    });
  });
});
