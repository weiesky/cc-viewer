/**
 * 补 server/routes/dingtalk.js 的缺口（既有 test/api-dingtalk.test.js 覆盖了 status 本地/远程、
 * config 成功保存、config 远程 403、config 空白名单驱动 restart、test 成功，但下列分支没走到）：
 *   - line 62-65  : dingtalkConfigPost —— body 非法 JSON → 400 Invalid JSON
 *   - line 91-92  : dingtalkConfigPost —— restartProcess/stopProcess 抛错 → catch 打 console.error（仍 200）
 *   - line 100-103: dingtalkTestPost   —— 远程调用 !isLocal → 403 Loopback only
 *   - line 114-117: dingtalkTestPost   —— appKey/appSecret 缺失 → { ok:false, detail:'missing appKey/appSecret' }
 *
 * 全部用直接 handler 调用 + 假 req/res（不起 http server、不触网、不 spawn 子进程）。
 * config/test 的存储经 dingtalk-config.js 落 preferences.json：预先把 CCV_LOG_DIR /
 * CLAUDE_CONFIG_DIR 指向临时目录，避免写真实用户配置；after 清理。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-dingtalk-gap-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
const { saveDingTalkConfig } = await import('../packages/app/server/lib/dingtalk-config.js');

const routeOf = (method, path) => dingtalkRoutes.find((r) => r.method === method && r.path === path).handler;

// 假 req：在 data 上回放 body（可为非 JSON 文本），end 触发处理。
const fakeReq = (bodyStr) => ({
  on(ev, cb) {
    if (ev === 'data' && bodyStr != null) cb(Buffer.from(bodyStr));
    if (ev === 'end') cb();
    return this;
  },
});

// 假 res：捕获 writeHead 状态/headers 与 end body，end 后 resolve done（异步处理器用）。
function fakeRes() {
  let resolveEnd;
  const done = new Promise((r) => { resolveEnd = r; });
  const res = { statusCode: null, body: '', headers: null, done };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (chunk) => { res.body = chunk || ''; resolveEnd(); };
  return res;
}

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/dingtalk/config — 非法 JSON', () => {
  it('body 不是合法 JSON → 400 Invalid JSON（不调用进程管理器）', async () => {
    const handler = routeOf('POST', '/api/dingtalk/config');
    const res = fakeRes();
    let restartCalled = false, stopCalled = false;
    const deps = {
      MAX_POST_BODY: 1e6,
      dingtalk: { isWorker: false, restartProcess: async () => { restartCalled = true; }, stopProcess: async () => { stopCalled = true; } },
    };
    handler(fakeReq('{ not json '), res, { pathname: '/api/dingtalk/config' }, /* isLocal */ true, deps);
    await res.done;
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.headers, { 'Content-Type': 'application/json' });
    assert.match(res.body, /Invalid JSON/);
    assert.equal(restartCalled, false);
    assert.equal(stopCalled, false);
  });
});

describe('POST /api/dingtalk/config — restartProcess 抛错走 catch', () => {
  it('保存成功但 restartProcess reject → catch 打 console.error，仍返回 200', async () => {
    const handler = routeOf('POST', '/api/dingtalk/config');
    const res = fakeRes();
    const errCalls = [];
    const origErr = console.error;
    console.error = (...a) => { errCalls.push(a); };
    const deps = {
      MAX_POST_BODY: 1e6,
      dingtalk: { isWorker: false, restartProcess: async () => { throw new Error('restart-failed'); }, stopProcess: async () => {} },
    };
    try {
      handler(fakeReq(JSON.stringify({ enabled: true, appKey: 'k', appSecret: 's', allowStaffIds: ['u1'] })),
        res, { pathname: '/api/dingtalk/config' }, /* isLocal */ true, deps);
      await res.done;
    } finally {
      console.error = origErr;
    }
    assert.equal(res.statusCode, 200, 'config 保存仍成功（进程驱动失败不影响保存响应）');
    const d = JSON.parse(res.body);
    assert.equal(d.connection.running, true);
    assert.equal(d.connection.connected, false);
    // catch 内打了一条带 [CC Viewer] IM config apply failed 的日志
    assert.ok(errCalls.length >= 1, 'restart 抛错应触发 console.error');
    assert.ok(errCalls.some((a) => String(a[0]).includes('IM config apply failed')), 'console.error 文案应含 apply failed');
  });
});

describe('POST /api/dingtalk/test — 远程 403 与缺失凭据', () => {
  it('远程调用（!isLocal）→ 403 Loopback only（不调 testConnection）', async () => {
    const handler = routeOf('POST', '/api/dingtalk/test');
    let status = 0, payload = '';
    let tested = false;
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; } };
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { testConnection: async () => { tested = true; return { ok: true }; } } };
    handler({ on() {} }, res, { pathname: '/api/dingtalk/test' }, /* isLocal */ false, deps);
    assert.equal(status, 403);
    assert.match(payload, /Loopback only/);
    assert.equal(tested, false, '远程不得触达 testConnection');
  });

  it('appKey/appSecret 均缺失（且无已存配置）→ { ok:false, detail:"missing appKey/appSecret" }', async () => {
    // 清空已存配置，确保 stored 也无凭据 → 走 missing 分支而非 testConnection。
    saveDingTalkConfig({ enabled: false, appKey: '', appSecret: '', allowStaffIds: [] });
    const handler = routeOf('POST', '/api/dingtalk/test');
    const res = fakeRes();
    let tested = false;
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { testConnection: async () => { tested = true; return { ok: true }; } } };
    // 空 body：incoming = {}；stored 也空 → cfg.appKey/appSecret 均空。
    handler(fakeReq(''), res, { pathname: '/api/dingtalk/test' }, /* isLocal */ true, deps);
    await res.done;
    assert.equal(res.statusCode, 200);
    const d = JSON.parse(res.body);
    assert.equal(d.ok, false);
    assert.equal(d.detail, 'missing appKey/appSecret');
    assert.equal(tested, false, '缺凭据时不应调用 testConnection');
  });
});
