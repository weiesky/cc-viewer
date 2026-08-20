// 针对 server/proxy.js 残余分支的覆盖补强（单跑口径 branch < 95）。
//
// 已有 test/proxy-server.test.js 覆盖了正常转发 / 错误响应直透 / 空 body / 502 catch /
// 默认 endpoint 等主路径；本文件专攻其遗漏的少数分支：
//   * 158-162: 错误响应分支里 response.text() 抛错 → 内层 catch（含 CCV_DEBUG 日志）
//   * 176-177: 流式分支里 pipeline 回调收到 truthy err（含 CCV_DEBUG 日志）
//   * 145 附近: !response.ok 且 text() 成功但走 CCV_DEBUG 关闭分支（补 if 反面）
//
// 手法：proxy.js 用裸 `fetch` 标识符调用上游，运行时解析到 globalThis.fetch；
// 在本（隔离）进程内临时替换 globalThis.fetch 即可精确构造任意上游响应，
// 全程无网络往返。每个用例 after 还原 fetch。
//
// 隔离：私有高位端口窗 + 私有 CCV_LOG_DIR/CLAUDE_CONFIG_DIR，均在 import proxy.js 之前设好。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-proxy-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
// 打开 CCV_DEBUG 以执行各 CCV_DEBUG 守卫内部的日志分支（159、175 的 truthy 侧）。
process.env.CCV_DEBUG = '1';
// 私有上游 base（不会真正被请求到，因为下面整体替换 globalThis.fetch）。
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';

let startProxy, proxyPort, proxyMod, interceptor;
const realFetch = globalThis.fetch;

function proxyReq(path, { method = 'POST', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body != null) headers['content-length'] = Buffer.byteLength(body);
    const r = request({ hostname: '127.0.0.1', port: proxyPort, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

before(async () => {
  proxyMod = await import('../server/proxy.js');
  ({ startProxy } = proxyMod);
  interceptor = await import('../server/interceptor.js');
  proxyPort = await startProxy();
  assert.ok(proxyPort > 0);
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startProxy 错误响应 text() 抛错的内层 catch 分支 (158-162)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('!ok 且 response.text() reject 时走 catch 不崩溃，最终仍 writeHead+流式 body', async () => {
    // 构造一个 ok=false 的响应：text() 必抛错以进入 158 的 catch；
    // 同时给一个可读 body，使 catch 之后落到 165 的 writeHead + 167 的流式分支。
    const fakeHeaders = new Map([['content-type', 'application/json']]);
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { entries: () => fakeHeaders.entries() },
      // 触发 149 的 await response.text() 抛错 → 进入 158 catch（159 CCV_DEBUG 日志）
      text: async () => { throw new Error('boom-text'); },
      // catch 之后继续：167 response.body 真值 → 走 pipeline 分支
      body: Readable.toWeb(Readable.from([Buffer.from('after-catch-body')])),
    });

    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 500, '内层 catch 不 return，落到 writeHead(response.status)');
    assert.match(res.body, /after-catch-body/, 'catch 后走流式分支把 body 透传给客户端');
  });
});

describe('startProxy 错误响应 text() 成功但 CCV_DEBUG 关闭分支 (147/150 if 反面)', () => {
  const savedDebug = process.env.CCV_DEBUG;
  after(() => {
    globalThis.fetch = realFetch;
    if (savedDebug === undefined) delete process.env.CCV_DEBUG;
    else process.env.CCV_DEBUG = savedDebug;
  });

  it('!ok 且 text() 成功 + CCV_DEBUG 未设 → 跳过日志，直接 writeHead+end(errorText) 并 return', async () => {
    delete process.env.CCV_DEBUG; // 走 150 的 if 假分支
    const fakeHeaders = new Map([['content-type', 'application/json']]);
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      headers: { entries: () => fakeHeaders.entries() },
      text: async () => '{"error":{"message":"forbidden"}}',
      body: null,
    });

    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 403);
    assert.match(res.body, /forbidden/, '错误 body 原样透传给客户端');
  });
});

describe('startProxy 流式 pipeline 回调收到 truthy err 分支 (174-177)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('ok 响应的 body 流中途报错 → pipeline 回调 err 真值（CCV_DEBUG 日志分支）不崩溃', async () => {
    process.env.CCV_DEBUG = '1';
    const fakeHeaders = new Map([['content-type', 'text/event-stream']]);
    // 一个会先吐一点数据、随后 destroy(error) 的可读流 → Readable.fromWeb 后
    // pipeline 把 error 传给回调 (174)，命中 175 的 err && CCV_DEBUG 真值分支。
    let pushed = false;
    const erroring = new Readable({
      read() {
        if (!pushed) {
          pushed = true;
          this.push(Buffer.from('partial'));
          // 下一 tick 触发流错误
          process.nextTick(() => this.destroy(new Error('mid-stream-fail')));
        }
      },
    });
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { entries: () => fakeHeaders.entries() },
      text: async () => '',
      body: Readable.toWeb(erroring),
    });

    // 客户端可能收到部分数据后连接被打断；无论 resolve 还是 error，关键是进程不崩、
    // pipeline 错误回调被执行。用 try/catch 容忍客户端侧的 socket 中断。
    let ok = true;
    try {
      const res = await proxyReq('/v1/messages', { body: '{}' });
      // 若拿到响应，状态应为 200（writeHead 在 pipeline 之前已发）
      assert.equal(res.status, 200);
    } catch (e) {
      // socket 被服务端 destroy 中断属预期，不算失败
      ok = e && (e.code === 'ECONNRESET' || /socket|aborted|terminated/i.test(String(e.message)));
      assert.ok(ok, `仅容忍连接中断类错误，实际: ${e && e.message}`);
    }
    assert.ok(ok);
  });
});

describe('startProxy 正常流式分支回归（pipeline 回调 err 假分支 174 反面）', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('ok 响应正常完成 → pipeline 回调 err 为空，body 完整透传', async () => {
    const fakeHeaders = new Map([
      ['content-type', 'text/event-stream'],
      ['content-encoding', 'gzip'],      // 应被 141 过滤
      ['transfer-encoding', 'chunked'],  // 应被 141 过滤
      ['content-length', '11'],          // 应被 141 过滤
      ['x-request-id', 'rid-1'],         // 应保留
    ]);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { entries: () => fakeHeaders.entries() },
      text: async () => '',
      body: Readable.toWeb(Readable.from([Buffer.from('data: hi\n\n')])),
    });

    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 200);
    assert.match(res.body, /data: hi/);
    // 上游的 content-encoding/content-length 被 141 过滤掉；transfer-encoding 即便上游
    // 声明了也会被 Node 按流式响应重新框定（chunked），故只断言被过滤的 content-encoding。
    assert.equal(res.headers['content-encoding'], undefined, 'content-encoding 被过滤');
    assert.equal(res.headers['x-request-id'], 'rid-1', '普通 header 保留');
  });
});

describe('startProxy 空 body 分支 (167 假分支 → 180 res.end)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('ok 响应 body 为 null → 走 else 的 res.end()', async () => {
    const fakeHeaders = new Map([['content-type', 'application/json']]);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { entries: () => fakeHeaders.entries() },
      text: async () => '',
      body: null,
    });

    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
  });
});

describe('startProxy 请求 body.length===0 分支 (118 假分支)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('GET 无 body → 不设置 fetchOptions.body，正常转发', async () => {
    let sawBody;
    const fakeHeaders = new Map([['content-type', 'text/plain']]);
    globalThis.fetch = async (_url, opts) => {
      sawBody = opts && opts.body;
      return {
        ok: true,
        status: 200,
        headers: { entries: () => fakeHeaders.entries() },
        text: async () => '',
        body: Readable.toWeb(Readable.from([Buffer.from('no-body-ok')])),
      };
    };

    const res = await proxyReq('/v1/models', { method: 'GET' });
    assert.equal(res.status, 200);
    assert.match(res.body, /no-body-ok/);
    assert.equal(sawBody, undefined, 'body 长度为 0 时不应设置 fetchOptions.body');
  });
});
