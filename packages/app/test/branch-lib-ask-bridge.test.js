import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'server', 'lib', 'ask', 'ask-bridge.js');

// ask-bridge.js 是个 PreToolUse hook 脚本（模块加载即执行，读 stdin + 走 HTTP），
// 唯一可观测面是 stdin/env 入 + stdout/stderr/exitcode 出，因此整文件用子进程黑盒驱动。
// env 必须 spread process.env，否则 node:test 注入的 NODE_V8_COVERAGE 丢失、子进程覆盖不计入。
function runBridge(stdin, env = {}, { closeStdin = true } = {}) {
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
    if (closeStdin) child.stdin.end();
  });
}

describe('ask-bridge.js 分支补充', () => {
  describe('模块加载期 env 分支', () => {
    it('CCVIEWER_PROTOCOL 非法值 → stderr 报错 + exit 1（行 30-33）', async () => {
      // rawProtocol 真值但既不是 http 也不是 https → 进 invalid 分支
      const { code, stderr } = await runBridge('{}', {
        CCVIEWER_PORT: '9999',
        CCVIEWER_PROTOCOL: 'ftp',
      });
      assert.equal(code, 1);
      assert.match(stderr, /invalid CCVIEWER_PROTOCOL/);
      assert.match(stderr, /ftp/);
    });

    it('CCVIEWER_PROTOCOL=http 合法 → 不报 protocol 错（isHttps=false 分支）', async () => {
      // 合法 http 不进 invalid 分支；port 未设 → 静默 exit 0
      const { code, stdout, stderr } = await runBridge('{}', {
        CCVIEWER_PORT: '',
        CCVIEWER_PROTOCOL: 'http',
      });
      assert.equal(code, 0);
      assert.doesNotMatch(stderr, /invalid CCVIEWER_PROTOCOL/);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
    });
  });

  describe('stdin 读取失败 catch（行 56-60）', () => {
    let woDir;
    let woFd;

    beforeEach(() => {
      // 私有临时目录，避免与并发测试争抢共享路径
      woDir = fs.mkdtempSync(join(os.tmpdir(), 'ccv-branch-askbridge-'));
    });

    afterEach(() => {
      if (woFd !== undefined) {
        try { fs.closeSync(woFd); } catch { /* already closed */ }
        woFd = undefined;
      }
      try { fs.rmSync(woDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('把只写 fd 当 stdin → readFileSync(0) 抛 EBADF → failed to read stdin + exit 1', async () => {
      // readFileSync(0) 从只写句柄读会抛 → 命中 line 57-60 的 catch 分支（正常 spawn 难触发）。
      const woPath = join(woDir, 'write-only.txt');
      woFd = fs.openSync(woPath, 'w');
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, [bridgePath], {
          env: { ...process.env, CCVIEWER_PORT: '9999' },
          stdio: [woFd, 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (code) => resolve({ code, stderr }));
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /failed to read stdin/);
    });
  });

  describe('stdin 校验分支', () => {
    it('stdin 为纯空白 → empty stdin + exit 1（行 62-65）', async () => {
      // port 已设（绕过 line 36 早退），stdin 是空白 → !stdinData.trim() 为真
      const { code, stderr } = await runBridge('   \n  \t ', { CCVIEWER_PORT: '9999' });
      assert.equal(code, 1);
      assert.match(stderr, /empty stdin/);
    });

    it('stdin 为空字符串 → empty stdin + exit 1（!stdinData 左臂）', async () => {
      const { code, stderr } = await runBridge('', { CCVIEWER_PORT: '9999' });
      assert.equal(code, 1);
      assert.match(stderr, /empty stdin/);
    });
  });

  describe('HTTPS 协议路径', () => {
    let server;
    let port;

    beforeEach(async () => {
      // https 模块路径：isHttps=true → httpClient=https。用 unreachable https 端口触发
      // req.on('error') 网络错误链路即可覆盖 isHttps=true 分支（无需真 TLS 证书）。
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('CCVIEWER_PROTOCOL=https 走 https 客户端，对 http server 握手失败 → fallback terminal', async () => {
      const input = JSON.stringify({
        tool_input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }] },
      });
      const { code, stdout } = await runBridge(input, {
        CCVIEWER_PORT: String(port),
        CCVIEWER_PROTOCOL: 'https',
      });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
    });
  });

  describe('POST 响应体非法 JSON（行 145-150）', () => {
    let server;
    let port;

    beforeEach(async () => {
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('POST 返 200 但 body 不是 JSON → Invalid response JSON → fallback', async () => {
      server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('this-is-not-json{{{');
      });
      const input = JSON.stringify({
        tool_input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }] },
      });
      const { code, stdout, stderr } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
      assert.match(stderr, /Invalid response JSON/);
    });
  });

  describe('429 容量饱和分支（行 306-307）', () => {
    let server;
    let port;

    beforeEach(async () => {
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('POST 返 429 → 专属 capacity saturated 日志 + fallback terminal', async () => {
      // 429 不是 5xx，不进 GET 循环重试；postToViewer reject 带 statusCode=429，
      // 顶层 catch 走 err.statusCode === 429 专属分支。
      server.on('request', (_req, res) => {
        res.writeHead(429);
        res.end('rate limited');
      });
      const input = JSON.stringify({
        tool_input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }] },
      });
      const { code, stdout, stderr } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
      assert.match(stderr, /capacity saturated/);
      assert.match(stderr, /HTTP 429/);
    });
  });

  describe('短轮询 404 re-POST 的 long-poll 返回值分支（行 232-237）', () => {
    let server;
    let port;
    const Q = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }];
    const STDIN = JSON.stringify({ tool_input: { questions: Q } });

    beforeEach(async () => {
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('GET 返 200 但 body 非法 JSON → Invalid GET response JSON reject → 网络重试后成功（行 177-178）', async () => {
      // getPollResult 对 200 + 坏 body 会 reject('Invalid GET response JSON')，
      // 该 reject 在 pollUntilAnswered catch 里非 fatal 非 5xx → networkRetries 退避重试。
      let getCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'badjson-id', capability: 'short-poll' }));
          });
        } else if (req.method === 'GET') {
          getCount++;
          if (getCount === 1) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('not-valid-json{{{');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
          }
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.ok(getCount >= 2, `坏 JSON 应触发重试，实测 GET=${getCount}`);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    });

    it('连续两次 GET 404（re-POST 后又 404）→ fatal "Ask entry gone (404 after retry)" → fallback（行 215-216）', async () => {
      // 第一次 404 触发 re-POST（postRetried=true），re-POST 返同 id 继续轮询；
      // 第二次 GET 又 404 → postRetried 已为真 → throw fatal → 立即 fallback，不再 re-POST。
      let postCount = 0;
      let getCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'gone-stable', capability: 'short-poll' }));
          });
        } else if (req.method === 'GET') {
          getCount++;
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
        }
      });
      const { code, stdout, stderr } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(postCount, 2, '只 re-POST 一次（postRetried gate）');
      assert.equal(getCount, 2, '第二次 404 直接 fatal，不再继续轮询');
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true, '404-after-retry 必须 fallback terminal');
      assert.ok(stderr.includes('ask-bridge'));
    });

    it('GET 404 → re-POST 直接带回 { answers }（罕见但合法 long-poll）→ allow（行 232-234）', async () => {
      let postCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (postCount === 1) {
              // 第一次 POST：short-poll ack，进 GET 循环
              res.end(JSON.stringify({ id: 'lp-id', capability: 'short-poll' }));
            } else {
              // re-POST：旧 server 忽略 header，直接 long-poll 返答案（无 capability）
              res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
            }
          });
        } else if (req.method === 'GET') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(postCount, 2, '404 触发一次 re-POST');
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
      assert.deepEqual(out.hookSpecificOutput.updatedInput.answers, { 'Q?': 'A' });
    });

    it('GET 404 → re-POST 直接带回 { cancelled }（long-poll 取消）→ deny（行 232-234 + 268）', async () => {
      let postCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (postCount === 1) {
              res.end(JSON.stringify({ id: 'lp-cancel-id', capability: 'short-poll' }));
            } else {
              res.end(JSON.stringify({ cancelled: true, reason: 'LP user aborted' }));
            }
          });
        } else if (req.method === 'GET') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(postCount, 2);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, '[cc-viewer:cancel] LP user aborted');
    });

    it('GET 404 → re-POST 返回意外 payload（无 id/answers/cancelled）→ fatal → fallback（行 236-237）', async () => {
      let postCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (postCount === 1) {
              res.end(JSON.stringify({ id: 'unexp-id', capability: 'short-poll' }));
            } else {
              // re-POST 返回既无 short-poll capability+id，也无 answers/cancelled → 落到 fatal
              res.end(JSON.stringify({ junk: true }));
            }
          });
        } else if (req.method === 'GET') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
        }
      });
      const { code, stdout, stderr } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(postCount, 2, '只 re-POST 一次');
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true, '意外 payload 必须 fallback terminal');
      assert.ok(stderr.includes('ask-bridge'));
    });

    it('re-POST 返回 short-poll ack 但缺 id（capability 真 id 假）→ 不进 continue 分支 → fatal payload', async () => {
      // 覆盖 line 220 的 reInit?.id 右臂为假：capability=short-poll 但 id 缺失，
      // 不满足 line 220 整体条件 → 跳过 continue，落到 line 232 answers/cancelled 都假 → fatal。
      let postCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (postCount === 1) {
              res.end(JSON.stringify({ id: 'noid-init', capability: 'short-poll' }));
            } else {
              res.end(JSON.stringify({ capability: 'short-poll' })); // 缺 id
            }
          });
        } else if (req.method === 'GET') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(postCount, 2);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
    });
  });

  describe('answers 类型校验三臂（行 282）', () => {
    let server;
    let port;
    let responder;

    beforeEach(async () => {
      responder = null;
      server = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responder));
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

    it('answers 是字符串（typeof !== object 中臂）→ fallback terminal', async () => {
      // !data.answers 为假（非空串真值），但 typeof 不是 object → 第二臂为真 → fallback
      responder = { answers: 'oops-a-string' };
      const { code, stdout, stderr } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
      assert.match(stderr, /No answers in response/);
    });

    it('answers 是数组（Array.isArray 右臂）→ fallback terminal', async () => {
      // !data.answers 假、typeof object（数组也是 object）→ 落到 Array.isArray 第三臂为真
      responder = { answers: ['not', 'an', 'object'] };
      const { code, stdout, stderr } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.continue, true);
      assert.match(stderr, /No answers in response/);
    });
  });

  describe('防御性 normalize 循环各 continue 分支（行 83-91）', () => {
    let server;
    let port;
    let received;

    beforeEach(async () => {
      received = undefined;
      server = createServer((req, res) => {
        let body = ''; req.on('data', (c) => { body += c; });
        req.on('end', () => {
          received = JSON.parse(body);
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

    it('questions 含 null 元素 / options 非数组 / option 非对象 → 各 continue 分支被覆盖且不崩', async () => {
      // 至少一个合法 question 让 questions 通过 line 75 非空校验；其余元素分别命中：
      //  - null question → line 84 !q 左臂 continue
      //  - typeof !== 'object'（数字）→ line 84 右臂 continue
      //  - options 非数组（字符串）→ line 85 continue
      //  - options 内含 null / 字符串元素 → line 87 !opt / typeof !== object 短路
      const questions = [
        { question: 'Q?', header: 'H', options: [{ label: 'A' }, null, 'plain-string', { label: 'B' }], multiSelect: false },
        null,
        42,
        { question: 'Q2', header: 'H2', options: 'not-an-array' },
        { question: 'Q3', header: 'H3', options: [{ label: 'C', description: 'keep-me' }] },
      ];
      const input = JSON.stringify({ tool_input: { questions } });
      const { code, stdout } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
      // 第一个 question 的对象型 option 缺 description → 补 ""；已存在 description 保留
      assert.equal(received.questions[0].options[0].description, '');
      assert.equal(received.questions[0].options[3].description, '');
      assert.equal(received.questions[4].options[0].description, 'keep-me');
      // null / 字符串 option 原样保留（未被写入 description）
      assert.equal(received.questions[0].options[1], null);
      assert.equal(received.questions[0].options[2], 'plain-string');
    });

    it('透传 tool_use_id（line 97 左臂为真）', async () => {
      const questions = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }];
      const input = JSON.stringify({ tool_use_id: 'tu_123', tool_input: { questions } });
      const { code } = await runBridge(input, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.equal(received.toolUseId, 'tu_123');
    });
  });

  describe('网络错误重试退避路径（行 239-253）', () => {
    let server;
    let port;
    const Q = [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '' }], multiSelect: false }];
    const STDIN = JSON.stringify({ tool_input: { questions: Q } });

    beforeEach(async () => {
      server = createServer();
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('GET 返回未知状态码（如 418，非 200/204/404/5xx）→ Unexpected status throw → 重试后成功（行 238）', async () => {
      // getPollResult 对非 200/204/404/5xx 状态会 resolve 出非法 status 让 pollUntilAnswered 抛
      // "Unexpected status"。注意 getPollResult 里 418 会走 else 分支带 statusCode reject，
      // 但 statusCode<500 所以不是 5xx → 落网络重试。这里用 418 触发后再成功验证不崩。
      let getCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'unknown-status-id', capability: 'short-poll' }));
          });
        } else if (req.method === 'GET') {
          getCount++;
          if (getCount === 1) {
            res.writeHead(418, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ teapot: true }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
          }
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.ok(getCount >= 2, `应至少 2 次 GET，实测 ${getCount}`);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    });

    it('GET 连接被重置数次（网络抖动）后再成功 → networkRetries 退避路径覆盖，最终 allow（行 250-252）', async () => {
      // 进入短轮询循环后，前两次 GET 直接 destroy socket（触发 req.on('error') 网络错误，
      // 非 5xx）→ 走 networkRetries 退避 100ms/200ms；第三次 GET 正常返答案。
      let postCount = 0;
      let getCount = 0;
      server.on('request', (req, res) => {
        if (req.method === 'POST') {
          postCount++;
          let body = ''; req.on('data', (c) => { body += c; });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'flaky-id', capability: 'short-poll' }));
          });
        } else if (req.method === 'GET') {
          getCount++;
          if (getCount <= 2) {
            // 直接销毁底层 socket → client 端 req 'error'（ECONNRESET），非 HTTP 状态码
            req.socket.destroy();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: { 'Q?': 'A' } }));
          }
        }
      });
      const { code, stdout } = await runBridge(STDIN, { CCVIEWER_PORT: String(port) });
      assert.equal(code, 0);
      assert.ok(getCount >= 3, `应至少 3 次 GET（2 次网络错误重试 + 1 次成功），实测 ${getCount}`);
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    });
  });
});
