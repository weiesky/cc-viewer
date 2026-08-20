/**
 * branch-lib-turn-end-bridge.test.js — 分支补强 server/lib/turn-end-bridge.js
 *
 * turn-end-bridge.js 是一次性 CLI 脚本(import 即执行 + process.exit(0)),无法直接
 * import 到测试进程,因此全部用子进程 spawn 跑 canonical 文件,env 必须 spread
 * process.env(否则子进程丢失 NODE_V8_COVERAGE,覆盖不计入)。
 *
 * 已有 test/turn-end-bridge.test.js 覆盖了:端口未设静默退出、正常 POST、token 头、
 * 非 JSON / 空 stdin、连接拒绝、500ms 超时、https-over-http。
 *
 * 本文件补的是剩余未覆盖分支:
 *   - 行 59  buf.length > 64KB 的 true 臂(>64KB stdin 被切到 64KB,JSON 被截断)
 *   - 行 65/68  parsed?.session_id || null / parsed?.transcript_path || null 的
 *               「有效 JSON 但缺字段」回退臂,以及 parsed 为 null / 原始值时 ?. 短路
 *   - 行 121-124  外层 catch:httpClient.request() 同步抛错(token 含非法 header 字符)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'turn-end-bridge.js');

/** 以子进程跑 turn-end-bridge.js,完整透传 process.env(保覆盖记账)。 */
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

/** 一次性捕获服务器:命中后 resolve;listen(0) 私有端口,避免并行冲突。 */
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

describe('turn-end-bridge.js 分支补强', { concurrency: false }, () => {
  it('stdin 超过 64KB 时切到 64KB,截断后 JSON 解析失败 -> sessionId 为 null', async () => {
    // 行 59:buf.length > 64*1024 的 true 臂。构造有效 JSON 但整体 > 64KB,
    // slice(0,64KB) 会把 JSON 从中间截断,JSON.parse 抛错 -> catch -> 字段为 null。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const big = JSON.stringify({ session_id: 'big-sess', filler: 'a'.repeat(70 * 1024) });
      assert.ok(Buffer.byteLength(big) > 64 * 1024, '构造的 stdin 必须 > 64KB 才能命中切片臂');
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: '' },
        stdin: big,
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      // 截断破坏 JSON -> 解析失败 -> sessionId 回退 null(不是 'big-sess')
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
      assert.equal(typeof payload.ts, 'number');
    } finally {
      server.close();
    }
  });

  it('有效 JSON 但缺 session_id/transcript_path 时,两个字段回退为 null', async () => {
    // 行 65/68:parsed?.session_id || null 的 || null 回退臂(parsed 是有效对象,
    // 但属性不存在 -> undefined -> || null)。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: '{}',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
    } finally {
      server.close();
    }
  });

  it('有 session_id 但缺 transcript_path 时,transcriptPath 单独回退 null', async () => {
    // 行 68:确保 transcript_path 缺失时单独走 || null,而 session_id 正常透传。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: JSON.stringify({ session_id: 'only-s' }),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, 'only-s');
      assert.equal(payload.transcriptPath, null);
    } finally {
      server.close();
    }
  });

  it('stdin 为 JSON null 时 parsed?. 短路 -> 字段为 null', async () => {
    // 行 65/68:parsed 为 null,可选链 parsed?.session_id 短路为 undefined -> || null。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: 'null',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
    } finally {
      server.close();
    }
  });

  it('stdin 为 JSON 数字时 parsed?. 在原始值上短路 -> 字段为 null', async () => {
    // 行 65/68:parsed 为原始值(42),parsed?.session_id 短路。覆盖可选链非对象分支。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: '42',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
    } finally {
      server.close();
    }
  });

  it('stdin fd 不可读(只写 fd)时 readFileSync(0) 抛错 -> 行 60 catch,仍以 null 字段 POST', async () => {
    // 行 60:try { readFileSync(0) } 的 catch 臂。常规 spawn stdin 总是可读,
    // 这里把一个【只写】文件 fd 当作子进程 stdin -> readFileSync(0) 抛 EBADF,
    // 走 catch -> stdinData 仍为 '' -> 后续 JSON.parse('') 失败 -> 字段 null,照样 POST。
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    const tmpFile = join(os.tmpdir(), `ccv-branch-teb-${process.pid}-${Date.now()}.tmp`);
    let wfd;
    try {
      wfd = fs.openSync(tmpFile, 'w'); // 只写 fd,作为子进程 fd 0 时读取会抛错
      const child = spawn(process.execPath, [SCRIPT], {
        env: { ...process.env, CCVIEWER_PORT: String(port), CCVIEWER_DEBUG: '1' },
        stdio: [wfd, 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const closeP = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stderr }));
      });
      const cap = await hitPromise;
      const res = await closeP;
      assert.equal(res.code, 0, '读取 stdin 失败也必须 exit 0');
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
      assert.equal(typeof payload.ts, 'number');
    } finally {
      server.close();
      if (wfd !== undefined) { try { fs.closeSync(wfd); } catch { /* ignore */ } }
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('token 含非法 header 字符时 httpClient.request() 同步抛错 -> 外层 catch,exit 0', async () => {
    // 行 121-124:外层 catch。X-CCViewer-Internal 值含换行符 -> http.request 同步抛
    // 'Invalid character in header content' -> 走 finish('request() threw...')。
    // 无需真实服务器:抛错发生在发请求之前。用一个未监听的端口即可。
    const tmp = http.createServer();
    const port = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    const res = await runBridge({
      env: {
        CCVIEWER_PORT: String(port),
        CCVIEWER_INTERNAL_TOKEN: 'bad\nvalue',
        CCVIEWER_DEBUG: '1',
      },
      stdin: JSON.stringify({ session_id: 'x' }),
    });
    assert.equal(res.code, 0, '同步抛错也必须 exit 0,不能阻塞 hook 链');
    assert.match(res.stderr, /request\(\) threw/, '走外层 catch 的 request() threw 分支');
  });
});
