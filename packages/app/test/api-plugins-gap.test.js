/**
 * 补 server/routes/plugins.js 的缺口（既有 test/server-plugins.test.js 经 HTTP 覆盖了
 * 列表/上传/reload-成功/delete-非法名/delete-404/delete-成功/install-from-url 的各错误分支，
 * 但下列三段没走到）：
 *   - line 34-36 : pluginsDelete 的 catch（unlinkSync / loadPlugins 抛错 → 500）
 *   - line 46-48 : pluginsReload 的 catch（loadPlugins 抛错 → 500）
 *   - line 78-81 : pluginsInstallFromUrl 的【成功】路径（installPluginFromUrl resolve → 200）
 *
 * 这些都需要让底层 plugin-loader / plugin-manager 的函数「按指令抛错或成功」，HTTP 黑盒做不到。
 * 手法：用 Node 24 module.registerHooks 把 ../lib/plugin-loader.js 与 ../lib/plugin-manager.js
 * 替换成读 globalThis.__ccvPluginStub 的可控 stub，再 import 路由模块（绑定这些 stub）。
 * 纯内存改写，不 spawn 子进程、不改磁盘、不触网。每个用例前重置 stub 控制对象。
 *
 * 注意：route 模块还 import existsSync/unlinkSync(node:fs)、join(node:path)、SERVER_LIB(_paths)，
 * 这些不 stub（pluginsDelete 用 existsSync 判存在）。pluginsDelete 的 filePath = join(dir, file)，
 * dir 来自 stub 的 getPluginsDir()，指向真实临时目录，存在性可控。
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOADER_URL  = new URL('../server/lib/plugin-loader.js', import.meta.url).href;
const MANAGER_URL = new URL('../server/lib/plugin-manager.js', import.meta.url).href;

// 可控 stub：route 模块经 import 绑定下面的导出，运行期读 globalThis.__ccvPluginStub。
const LOADER_SRC = `
const ctl = () => globalThis.__ccvPluginStub;
export function getPluginsDir() { return ctl().pluginsDir; }
export async function loadPlugins() { if (ctl().loadPluginsThrows) throw new Error(ctl().loadPluginsThrows); return ctl().plugins; }
export function getPluginsInfo() { return ctl().plugins; }
export async function runWaterfallHook() { return undefined; }
export async function runParallelHook() { return undefined; }
`;
const MANAGER_SRC = `
const ctl = () => globalThis.__ccvPluginStub;
export function uploadPlugins() { /* not used here */ }
export async function installPluginFromUrl() { if (ctl().installThrows) throw new Error(ctl().installThrows); ctl().installCalled = true; }
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

// 假 res：捕获状态码 / headers / body。
function fakeRes() {
  const res = { statusCode: null, body: '', headers: null };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
}

// 假 req：按需在 data/end 上回放一段 body（用于 POST 处理器）。
function fakeReq(bodyStr) {
  return {
    on(ev, cb) {
      if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr));
      if (ev === 'end') cb();
      return this;
    },
  };
}

describe('server/routes/plugins.js — 错误分支与 install 成功路径', () => {
  let routes;
  let dir;

  before(async () => {
    installHook();
    dir = mkdtempSync(join(tmpdir(), 'ccv-plugins-gap-'));
    const mod = await import('../server/routes/plugins.js?gapcase=1');
    routes = mod.pluginsRoutes;
  });

  beforeEach(() => {
    globalThis.__ccvPluginStub = {
      pluginsDir: dir,
      plugins: [{ file: 'p.js', enabled: true }],
      loadPluginsThrows: null,
      installThrows: null,
      installCalled: false,
    };
  });

  const routeOf = (method, path) => routes.find((r) => r.method === method && r.path === path).handler;

  it('DELETE /api/plugins：unlinkSync 后 loadPlugins 抛错 → 500 + { error }', async () => {
    // 准备一个真实存在的文件让 existsSync 通过、unlinkSync 成功，随后 loadPlugins 抛错进 catch。
    const file = 'delme.js';
    writeFileSync(join(dir, file), 'export default {};');
    globalThis.__ccvPluginStub.loadPluginsThrows = 'load-after-delete-failed';

    const handler = routeOf('DELETE', '/api/plugins');
    const res = fakeRes();
    const parsedUrl = { searchParams: new URLSearchParams(`file=${file}`) };
    await handler(fakeReq(), res, parsedUrl);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.headers, { 'Content-Type': 'application/json' });
    assert.equal(JSON.parse(res.body).error, 'load-after-delete-failed');
    // 文件应已被 unlinkSync 删除（异常发生在 unlink 之后）
    assert.equal(existsSync(join(dir, file)), false, 'unlinkSync 应已先删除文件');
  });

  it('POST /api/plugins/reload：loadPlugins 抛错 → 500 + { error }', async () => {
    globalThis.__ccvPluginStub.loadPluginsThrows = 'reload-boom';
    const handler = routeOf('POST', '/api/plugins/reload');
    const res = fakeRes();
    await handler(fakeReq(), res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.headers, { 'Content-Type': 'application/json' });
    assert.equal(JSON.parse(res.body).error, 'reload-boom');
  });

  it('POST /api/plugins/install-from-url：installPluginFromUrl 成功 → 200 + ok/plugins/pluginsDir', async () => {
    const handler = routeOf('POST', '/api/plugins/install-from-url');
    const res = fakeRes();
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const origEnd = res.end;
    res.end = (chunk) => { origEnd(chunk); resolveDone(); };

    const deps = { MAX_POST_BODY: 1e6 };
    handler(fakeReq(JSON.stringify({ url: 'https://example.com/p.js' })), res, {}, true, deps);
    await done;

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.headers, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.deepEqual(data.plugins, [{ file: 'p.js', enabled: true }]);
    assert.equal(data.pluginsDir, dir);
    assert.equal(globalThis.__ccvPluginStub.installCalled, true, 'installPluginFromUrl 应被调用');
  });
});
