/**
 * server/routes/plugins.js 分支覆盖补全。
 *
 * 既有 test/server-plugins.test.js 经 HTTP 黑盒覆盖了大部分成功/错误臂，但单跑口径 branch
 * 只到 ~81%；未走到的分支主要是：
 *   - pluginsReload 的 catch（line 46-48，loadPlugins 抛错 → 500）
 *   - pluginsDelete 的 catch 经由「unlink 后 loadPlugins 抛错」一臂
 *   - pluginsUpload / pluginsInstallFromUrl 的 body.length > MAX_POST_BODY → req.destroy 一臂
 *   - upload/install catch 的 `err.statusCode || 500` 两侧（有/无 statusCode）
 *   - pluginsDelete 文件名校验 `!file || .. || / || \\` 各短路臂
 *
 * 手法：用 Node 24 module.registerHooks 把 ../lib/plugin-loader.js 与 ../lib/plugin-manager.js
 * 替换为读 globalThis.__ccvPluginStub 的可控 stub，再【按 canonical URL】import 路由模块
 * （绝不加 query-string，避免覆盖记到 phantom URL）。纯内存改写，不 spawn、不改磁盘、不触网。
 *
 * node:test 每文件独立进程 + 本文件只在自身进程内 registerHooks，故 stub 不会污染其他测试文件。
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOADER_URL  = new URL('../server/lib/plugin-loader.js', import.meta.url).href;
const MANAGER_URL = new URL('../server/lib/plugin-manager.js', import.meta.url).href;

// 可控 stub：route 模块 import 期绑定下列导出，运行期读 globalThis.__ccvPluginStub。
const LOADER_SRC = `
const ctl = () => globalThis.__ccvPluginStub;
export function getPluginsDir() { return ctl().pluginsDir; }
export async function loadPlugins() { if (ctl().loadPluginsThrows) throw new Error(ctl().loadPluginsThrows); ctl().loadCalled = true; return ctl().plugins; }
export function getPluginsInfo() { return ctl().plugins; }
export async function runWaterfallHook() { return undefined; }
export async function runParallelHook() { return undefined; }
`;
const MANAGER_SRC = `
const ctl = () => globalThis.__ccvPluginStub;
export function uploadPlugins() {
  if (ctl().uploadThrows) { const e = new Error(ctl().uploadThrows); if (ctl().uploadStatus) e.statusCode = ctl().uploadStatus; throw e; }
  ctl().uploadCalled = true;
}
export async function installPluginFromUrl() {
  if (ctl().installThrows) { const e = new Error(ctl().installThrows); if (ctl().installStatus) e.statusCode = ctl().installStatus; throw e; }
  ctl().installCalled = true;
}
`;

let hookRegistered = false;
function installHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url === LOADER_URL)  return { format: 'module', shortCircuit: true, source: LOADER_SRC };
      if (url === MANAGER_URL) return { format: 'module', shortCircuit: true, source: MANAGER_SRC };
      return nextLoad(url, context);
    },
  });
}

// 假 res：捕获状态码 / headers / body，并暴露一个 Promise 在 end() 时 resolve（供异步处理器等待）。
function fakeRes() {
  const res = { statusCode: null, body: '', headers: null };
  let resolveDone;
  res.done = new Promise((r) => { resolveDone = r; });
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (chunk) => { res.body = chunk || ''; resolveDone(); };
  return res;
}

// 假 req：按需在 data/end 上回放 body。可分多块回放以触发 body.length 累加。
function fakeReq(chunks) {
  const list = chunks == null ? [] : (Array.isArray(chunks) ? chunks : [chunks]);
  return {
    destroyed: false,
    destroy() { this.destroyed = true; },
    on(ev, cb) {
      if (ev === 'data') { for (const c of list) cb(Buffer.from(c)); }
      if (ev === 'end') cb();
      return this;
    },
  };
}

describe('server/routes/plugins.js — 分支补全', () => {
  let routes;
  let dir;

  before(async () => {
    installHook();
    dir = mkdtempSync(join(tmpdir(), 'ccv-branch-plugins-'));
    // canonical import，覆盖正确记账到 server/routes/plugins.js
    const mod = await import('../server/routes/plugins.js');
    routes = mod.pluginsRoutes;
  });

  beforeEach(() => {
    globalThis.__ccvPluginStub = {
      pluginsDir: dir,
      plugins: [{ file: 'p.js', enabled: true }],
      loadPluginsThrows: null,
      installThrows: null,
      installStatus: null,
      uploadThrows: null,
      uploadStatus: null,
      installCalled: false,
      uploadCalled: false,
      loadCalled: false,
    };
  });

  const routeOf = (method, path) => routes.find((r) => r.method === method && r.path === path).handler;
  const parsed = (qs) => ({ searchParams: new URLSearchParams(qs) });

  // ---------- pluginsList ----------
  it('GET /api/plugins：返回 plugins + pluginsDir', () => {
    const handler = routeOf('GET', '/api/plugins');
    const res = fakeRes();
    handler(fakeReq(), res, parsed(''));
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.deepEqual(data.plugins, [{ file: 'p.js', enabled: true }]);
    assert.equal(data.pluginsDir, dir);
  });

  // ---------- pluginsDelete：文件名校验各短路臂 ----------
  it('DELETE /api/plugins：file 缺失（!file 臂）→ 400', async () => {
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed(''));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Invalid file name');
  });

  it("DELETE /api/plugins：含 '..' → 400", async () => {
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=a..b'));
    assert.equal(res.statusCode, 400);
  });

  it("DELETE /api/plugins：含 '/' → 400", async () => {
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=' + encodeURIComponent('a/b.js')));
    assert.equal(res.statusCode, 400);
  });

  it("DELETE /api/plugins：含反斜杠 → 400", async () => {
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=' + encodeURIComponent('a\\b.js')));
    assert.equal(res.statusCode, 400);
  });

  it('DELETE /api/plugins：文件不存在（existsSync false）→ 404', async () => {
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=nope-' + Date.now() + '.js'));
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'File not found');
  });

  it('DELETE /api/plugins：unlink 成功 + loadPlugins 成功 → 200（成功臂）', async () => {
    const file = 'del-ok-' + Date.now() + '.js';
    writeFileSync(join(dir, file), 'export default {};');
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=' + file));
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(existsSync(join(dir, file)), false);
    assert.equal(globalThis.__ccvPluginStub.loadCalled, true);
  });

  it('DELETE /api/plugins：unlink 后 loadPlugins 抛错 → 500（catch 臂）', async () => {
    const file = 'del-boom-' + Date.now() + '.js';
    writeFileSync(join(dir, file), 'export default {};');
    globalThis.__ccvPluginStub.loadPluginsThrows = 'load-after-delete-failed';
    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    await handler(fakeReq(), res, parsed('file=' + file));
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'load-after-delete-failed');
    assert.equal(existsSync(join(dir, file)), false);
  });

  // ---------- pluginsReload：成功 + catch（line 46-48）----------
  it('POST /api/plugins/reload：成功 → 200', async () => {
    const handler = routeOf('POST', '/api/plugins/reload');
    const res = fakeRes();
    await handler(fakeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).ok, true);
  });

  it('POST /api/plugins/reload：loadPlugins 抛错 → 500（catch 臂 line 46-48）', async () => {
    globalThis.__ccvPluginStub.loadPluginsThrows = 'reload-boom';
    const handler = routeOf('POST', '/api/plugins/reload');
    const res = fakeRes();
    await handler(fakeReq(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'reload-boom');
  });

  // ---------- pluginsUpload ----------
  it('POST /api/plugins/upload：成功 → 200', async () => {
    const handler = routeOf('POST', '/api/plugins/upload');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ files: [{ name: 'a.js', content: 'x' }] })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).ok, true);
    assert.equal(globalThis.__ccvPluginStub.uploadCalled, true);
  });

  it('POST /api/plugins/upload：body 超 MAX_POST_BODY → req.destroy（over-limit 臂）', async () => {
    const handler = routeOf('POST', '/api/plugins/upload');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 2 };
    const req = fakeReq(['abcdef']); // 6 bytes > 2
    handler(req, res, {}, true, deps);
    await res.done;
    assert.equal(req.destroyed, true, 'body 超限应触发 req.destroy()');
  });

  it('POST /api/plugins/upload：uploadPlugins 抛带 statusCode 错 → 该 statusCode（err.statusCode 真臂）', async () => {
    globalThis.__ccvPluginStub.uploadThrows = 'bad file type';
    globalThis.__ccvPluginStub.uploadStatus = 400;
    const handler = routeOf('POST', '/api/plugins/upload');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ files: [] })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'bad file type');
  });

  it('POST /api/plugins/upload：uploadPlugins 抛无 statusCode 错 → 500（err.statusCode 假臂 || 500）', async () => {
    globalThis.__ccvPluginStub.uploadThrows = 'plain error';
    const handler = routeOf('POST', '/api/plugins/upload');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ files: [] })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'plain error');
  });

  // ---------- pluginsInstallFromUrl ----------
  it('POST /api/plugins/install-from-url：成功 → 200', async () => {
    const handler = routeOf('POST', '/api/plugins/install-from-url');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ url: 'https://example.com/p.js' })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(data.pluginsDir, dir);
    assert.equal(globalThis.__ccvPluginStub.installCalled, true);
  });

  it('POST /api/plugins/install-from-url：body 超 MAX_POST_BODY → req.destroy（over-limit 臂）', async () => {
    const handler = routeOf('POST', '/api/plugins/install-from-url');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 2 };
    const req = fakeReq(['abcdef']);
    handler(req, res, {}, true, deps);
    await res.done;
    assert.equal(req.destroyed, true);
  });

  it('POST /api/plugins/install-from-url：install 抛带 statusCode 错 → 该 statusCode（err.statusCode 真臂）', async () => {
    globalThis.__ccvPluginStub.installThrows = 'Invalid URL';
    globalThis.__ccvPluginStub.installStatus = 400;
    const handler = routeOf('POST', '/api/plugins/install-from-url');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ url: 'not-a-url' })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Invalid URL');
  });

  it('POST /api/plugins/install-from-url：install 抛无 statusCode 错 → 500（err.statusCode 假臂 || 500）', async () => {
    globalThis.__ccvPluginStub.installThrows = 'Failed to fetch';
    const handler = routeOf('POST', '/api/plugins/install-from-url');
    const res = fakeRes();
    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ url: 'https://127.0.0.1:1/x.js' })), res, {}, true, deps);
    await res.done;
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'Failed to fetch');
  });
});
