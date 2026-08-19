import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'packages', 'app', 'server', 'lib', 'ask-bridge.js');

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
      // 真实 Claude Code 调用都带 description（schema 必填）；这里也带上避免 normalize 改写 payload
      const questions = [
        { question: 'Which?', header: 'Q', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false },
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

    it('normalizes options[].description to "" when missing before forwarding', async () => {
      // 防御 upstream schema 修了 / hook 移到 validation 前的兜底场景
      const questions = [
        { question: 'Q?', header: 'H', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: false },
      ];
      const answers = { 'Q?': 'X' };

      let received;
      server.on('request', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          received = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ answers }));
        });
      });

      const input = JSON.stringify({ tool_input: { questions } });
      const { code } = await runBridge(input, { CCVIEWER_PORT: String(port) });

      assert.equal(code, 0);
      assert.equal(received.questions[0].options[0].description, '');
      assert.equal(received.questions[0].options[1].description, '');
      assert.equal(received.questions[0].options[0].label, 'X');
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

    it('outputs PreToolUse deny when server returns cancelled=true (web user cancelled the ask)', async () => {
      // 用户在 cc-viewer web UI 点 Cancel 或在输入框打字打断 → server.js ask-cancel handler
      // 给 hook res 回 200 + { cancelled: true, reason }。ask-bridge 必须把这个翻成 PreToolUse
      // hook deny，让 Claude Code 走兜底链：toolExecution.ts 把 deny.message 包装成
      // tool_result.is_error=true，配对完整后下一轮 API 不会 400。
      server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cancelled: true, reason: 'User aborted' }));
      });

      const input = JSON.stringify({
        tool_input: {
          questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }],
        },
      });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
      // [cc-viewer:cancel] 前缀是协议级 sentinel，toolResultBuilder 用它区分 cancelled vs rejected
      assert.equal(output.hookSpecificOutput.permissionDecisionReason, '[cc-viewer:cancel] User aborted');
    });

    it('cancelled=true with no reason falls back to default reason text', async () => {
      // server 端 reason 字段缺失 / 空 → 用默认文案 "User aborted by cc-viewer"
      server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cancelled: true }));
      });

      const input = JSON.stringify({
        tool_input: {
          questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }],
        },
      });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /^\[cc-viewer:cancel\]/);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /cc-viewer/i);
    });

    describe('Phase 3 short-poll protocol (X-Ask-Poll-Mode: short)', () => {
      const Q = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }];
      const STDIN = JSON.stringify({ tool_input: { questions: Q } });

      it('POST returns short-poll ack → GET 200 with answers → allow', async () => {
        let postSeen = false;
        let getCount = 0;
        server.on('request', (req, res) => {
          if (req.method === 'POST' && req.url === '/api/ask-hook') {
            postSeen = true;
            assert.equal(req.headers['x-ask-poll-mode'], 'short', 'ask-bridge 必须发 X-Ask-Poll-Mode: short');
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'test-id', capability: 'short-poll' }));
            });
          } else if (req.method === 'GET' && req.url.startsWith('/api/ask-hook/test-id/result')) {
            getCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
          } else {
            res.writeHead(404); res.end();
          }
        });

        const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
        assert.equal(code, 0);
        assert.ok(postSeen, 'POST 必须发出');
        assert.equal(getCount, 1, 'GET 在拿到 200 后必须只发一次');
        const output = JSON.parse(stdout.trim());
        assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
        assert.deepEqual(output.hookSpecificOutput.updatedInput.answers, { 'Q?': 'A' });
      });

      it('GET 204 triggers immediate re-request until 200', async () => {
        let getCount = 0;
        server.on('request', (req, res) => {
          if (req.method === 'POST') {
            let body = ''; req.on('data', (c) => { body += c; });
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'wait-id', capability: 'short-poll' }));
            });
          } else if (req.method === 'GET') {
            getCount++;
            if (getCount < 3) {
              res.writeHead(204); res.end();
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
            }
          }
        });

        const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
        assert.equal(code, 0);
        assert.equal(getCount, 3, '204 必须立即重发 GET，第 3 次才拿到 200');
        const output = JSON.parse(stdout.trim());
        assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      });

      it('GET 404 triggers re-POST exactly once; new id matches → continue polling', async () => {
        let postCount = 0;
        let getCount = 0;
        server.on('request', (req, res) => {
          if (req.method === 'POST') {
            postCount++;
            let body = ''; req.on('data', (c) => { body += c; });
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              // 两次 POST 都返同一个 id —— re-POST id mismatch 保护通过
              res.end(JSON.stringify({ id: 'stable-id', capability: 'short-poll' }));
            });
          } else if (req.method === 'GET') {
            getCount++;
            if (getCount === 1) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'gone' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
            }
          }
        });

        const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
        assert.equal(code, 0);
        assert.equal(postCount, 2, '404 必须触发一次 re-POST');
        assert.equal(getCount, 2, 'GET 拿到 200 后停止');
        const output = JSON.parse(stdout.trim());
        assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      });

      it('GET 404 → re-POST returns mismatched id → fall back to terminal (no infinite loop)', async () => {
        let postCount = 0;
        server.on('request', (req, res) => {
          if (req.method === 'POST') {
            postCount++;
            let body = ''; req.on('data', (c) => { body += c; });
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              // 第一次 POST 返 id-1，第二次返 id-2 → bridge 必须直接 fallback
              res.end(JSON.stringify({ id: postCount === 1 ? 'id-1' : 'id-2', capability: 'short-poll' }));
            });
          } else if (req.method === 'GET') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'gone' }));
          }
        });

        const { code, stdout, stderr } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
        assert.equal(code, 0);
        assert.equal(postCount, 2, '只 re-POST 一次（postRetried gate），不会无限循环');
        const output = JSON.parse(stdout.trim());
        assert.equal(output.continue, true, 'id mismatch 必须 fallback terminal UI');
        assert.ok(stderr.includes('mismatch') || stderr.includes('ask-bridge'), 'stderr 应有 fallback 痕迹');
      });

      it('GET 5xx retries up to 3 times then falls back (does not block for ~5min like network errors)', async () => {
        let postCount = 0;
        let getCount = 0;
        const start = Date.now();
        server.on('request', (req, res) => {
          if (req.method === 'POST') {
            postCount++;
            let body = ''; req.on('data', (c) => { body += c; });
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'sick-server', capability: 'short-poll' }));
            });
          } else if (req.method === 'GET') {
            getCount++;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'sick' }));
          }
        });

        const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
        const elapsed = Date.now() - start;
        assert.equal(code, 0);
        // 5xx 独立短重试：MAX_SERVER_5XX_RETRIES = 3 → 第 1 次 + 3 次重试 = 共 4 次 GET 后 fallback
        assert.ok(getCount >= 3 && getCount <= 5, `5xx 应在 3-5 次 GET 后 fallback，实测 ${getCount}`);
        // 总耗时上限：500ms + 1000ms + 2000ms ≈ 3.5s（远小于 5min 网络重试上限）
        assert.ok(elapsed < 10000, `5xx fallback 应远低于 5min 网络抖动上限，实测 ${elapsed}ms`);
        const output = JSON.parse(stdout.trim());
        assert.equal(output.continue, true);
        assert.equal(postCount, 1, '5xx 不触发 re-POST');
      });
    });
  });

  describe('CCV_DISABLE_ASK_HOOK opt-out', () => {
    let server;
    let port;
    let requestCount;

    beforeEach(async () => {
      requestCount = 0;
      server = createServer((req, res) => {
        requestCount++;
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
        });
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    const STDIN = JSON.stringify({
      tool_input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }] },
    });

    it('falls through (continue:true) WITHOUT contacting the server when set to "1"', async () => {
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port), CCV_DISABLE_ASK_HOOK: '1' });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.continue, true);
      assert.equal(output.suppressOutput, true);
      // The whole point: the prompt is handed to the terminal / a downstream PermissionRequest
      // hook, so cc-viewer's ask endpoint must never be hit.
      assert.equal(requestCount, 0, 'disabled ask hook must not reach the server');
    });

    it('keeps intercepting (contacts server, returns answers) when the flag is unset', async () => {
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port), CCV_DISABLE_ASK_HOOK: '' });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      assert.ok(requestCount >= 1, 'unset flag preserves the existing interception behavior');
    });

    it('treats values other than "1" as unset (still intercepts)', async () => {
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port), CCV_DISABLE_ASK_HOOK: 'true' });
      assert.equal(code, 0);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      assert.ok(requestCount >= 1, 'only the exact value "1" disables — mirrors CCV_BYPASS_PERMISSIONS');
    });
  });
});

describe('SIGTERM/SIGINT best-effort cancel notification', () => {
  const Q = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }];
  const STDIN = JSON.stringify({ tool_input: { questions: Q } });

  function spawnBridge(port) {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, CCVIEWER_PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const closed = new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout })));
    child.stdin.write(STDIN);
    child.stdin.end();
    return { child, closed };
  }

  async function runSignalCase(signal, expectedExit) {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    let cancelBody = null;
    let cancelSeen;
    const cancelArrived = new Promise((resolve) => { cancelSeen = resolve; });
    let firstGet;
    const firstGetArrived = new Promise((resolve) => { firstGet = resolve; });
    server.on('request', (req, res) => {
      if (req.method === 'POST' && req.url === '/api/ask-hook') {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'sig-id', capability: 'short-poll' }));
        });
      } else if (req.method === 'GET' && req.url.startsWith('/api/ask-hook/sig-id/result')) {
        firstGet();
        // hang: never answer — the bridge is parked waiting, like a real pending ask
      } else if (req.method === 'POST' && req.url === '/api/ask-hook/sig-id/cancel') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          cancelBody = body;
          res.writeHead(204);
          res.end();
          cancelSeen();
        });
      } else {
        res.writeHead(404); res.end();
      }
    });

    const { child, closed } = spawnBridge(port);
    await firstGetArrived;
    child.kill(signal);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('cancel POST never arrived')), 2000));
    await Promise.race([cancelArrived, timeout]);
    const { code, stdout } = await closed;
    await new Promise((resolve) => server.close(resolve));
    return { code, stdout, cancelBody };
  }

  it('SIGTERM after the ask is armed → POSTs /cancel with reason, exits 143, nothing on stdout', async () => {
    const { code, stdout, cancelBody } = await runSignalCase('SIGTERM', 143);
    assert.equal(code, 143);
    assert.equal(stdout.trim(), '', 'signal path must not write to stdout');
    assert.equal(JSON.parse(cancelBody).reason, 'hook process exited');
  });

  it('SIGINT after the ask is armed → POSTs /cancel, exits 130', async () => {
    const { code } = await runSignalCase('SIGINT', 130);
    assert.equal(code, 130);
  });
});
