import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'server', 'lib', 'ask', 'perm-request-bridge.js');

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

describe('perm-request-bridge.js', () => {
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

  it('exits 1 when stdin is empty', async () => {
    const { code } = await runBridge('', { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('exits 1 with stderr when CCVIEWER_PROTOCOL is invalid', async () => {
    const { code, stderr } = await runBridge('{}', { CCVIEWER_PORT: '9999', CCVIEWER_PROTOCOL: 'ftp' });
    assert.equal(code, 1);
    assert.match(stderr, /invalid CCVIEWER_PROTOCOL/);
  });

  it('exits 1 when toolName is missing', async () => {
    const input = JSON.stringify({ tool_input: { file_path: '/tmp/x' } });
    const { code } = await runBridge(input, { CCVIEWER_PORT: '9999' });
    assert.equal(code, 1);
  });

  it('falls back to terminal UI when server is unreachable', async () => {
    const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
    const { code, stdout, stderr } = await runBridge(input, { CCVIEWER_PORT: '19999' });
    assert.equal(code, 0);
    const output = JSON.parse(stdout.trim());
    assert.equal(output.continue, true);
    assert.match(stderr, /falling back to terminal UI/);
  });

  describe('with mock server', () => {
    let server;
    let serverPort;

    beforeEach(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: 'allow' }));
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

    it('returns allow with addDirectories for Read when server approves', async () => {
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/outside/dir/file.txt' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.hookEventName, 'PermissionRequest');
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.deepEqual(output.hookSpecificOutput.decision.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/dir'], destination: 'session' },
      ]);
    });

    it('returns allow with addDirectories for Glob when server approves', async () => {
      const input = JSON.stringify({ tool_name: 'Glob', tool_input: { pattern: '**/*.js', path: '/outside/dir' }, cwd: '/proj' });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.deepEqual(output.hookSpecificOutput.decision.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/dir'], destination: 'session' },
      ]);
    });

    it('returns allow with addDirectories for Grep when server approves', async () => {
      const input = JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'foo', path: '/outside/dir' }, cwd: '/proj' });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.deepEqual(output.hookSpecificOutput.decision.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/dir'], destination: 'session' },
      ]);
    });

    it('returns allow without updatedPermissions for over-trust directories', async () => {
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.equal(output.hookSpecificOutput.decision.updatedPermissions, undefined);
    });

    it('returns allow without updatedPermissions for home directory', async () => {
      const { homedir } = await import('node:os');
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: `${homedir()}/file.txt` } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.equal(output.hookSpecificOutput.decision.updatedPermissions, undefined);
    });

    it('returns allow without updatedPermissions for dot-directory', async () => {
      const { homedir } = await import('node:os');
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: `${homedir()}/.ssh/config` } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'allow');
      assert.equal(output.hookSpecificOutput.decision.updatedPermissions, undefined);
    });

    it('returns deny when server decision is deny', async () => {
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
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.decision.behavior, 'deny');
      assert.equal(output.hookSpecificOutput.decision.message, 'Denied by cc-viewer plugin');
    });

    it('returns continue for non-Read/Glob/Grep tools (they are not eligible for silent allow)', async () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
      assert.equal(output.suppressOutput, true);
    });

    it('returns continue when server decision is ask', async () => {
      server.close();
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: 'ask' }));
        });
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          resolve();
        });
      });
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
      assert.equal(output.suppressOutput, true);
    });

    it('falls back to terminal UI on server error', async () => {
      server.close();
      server = createServer((req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          resolve();
        });
      });
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } });
      const { code, stdout, stderr } = await runBridge(input, { CCVIEWER_PORT: String(serverPort) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
      assert.match(stderr, /HTTP 500/);
    });
  });
});
