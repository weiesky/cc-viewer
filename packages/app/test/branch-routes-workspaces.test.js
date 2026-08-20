// 分支补强: server/routes/workspaces.js
//
// 现有 test/api-workspaces.test.js 已覆盖 happy path + 400/500（body 解析）分支。
// 本文件专补 single-run 口径下仍缺的分支:
//   - workspacesList   catch (15-16)  : getWorkspaces().then 成功回调里 res 抛错 → 进 .catch
//   - workspacesLaunch PTY  (61-64)   : CCV_PROXY_PORT 已设 → 走 spawnClaude 分支（注入假 pty）
//   - workspacesLaunch mergedArgs     : extraArgs 非数组 → 强制 [] 分支
//   - workspacesDelete catch (128-129): removeWorkspace().then 成功回调里 res 抛错 → 进 .catch
//   - workspacesStop   catch (157-158): Promise.all().then 成功回调里 res 抛错 → 进 .catch
//
// 隔离: 在 import 目标模块前用私有 mkdtemp 设 CCV_LOG_DIR/CLAUDE_CONFIG_DIR；PTY 用
// _setPtyImportForTests 注入假模块，绝不 spawn 真进程。

import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-workspaces-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
delete process.env.CCV_PROXY_PORT;
delete process.env.CCV_ELECTRON_MULTITAB;

// 合法 workspace 目录
const wsDir = join(tmpDir, 'branch-proj');
mkdirSync(wsDir, { recursive: true });
// 一个“假 claude”脚本路径（实际不会被执行，spawn 被假 pty 拦截）
const fakeClaudePath = join(tmpDir, 'fake-claude.js');
writeFileSync(fakeClaudePath, '// noop\n');

const { workspacesRoutes } = await import('../server/routes/workspaces.js');
const ptyMgr = await import('../server/pty-manager.js');

function routeFor(method, path) {
  const r = workspacesRoutes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

function makeClient() {
  const writes = [];
  return { write: (s) => { writes.push(s); return true; }, _writes: writes };
}

function baseDeps(overrides = {}) {
  const clients = overrides.clients || [];
  return {
    MAX_POST_BODY: 1024 * 1024,
    isWorkspaceMode: true,
    workspaceLaunched: false,
    clients,
    statsWorker: { running: true },
    startStatsWorker: () => {},
    startStreamingStatusTimer: () => {},
    logWatcherOpts: (logFile) => ({
      logFile,
      clients,
      getClaudePid: () => 0,
      runParallelHook: async () => {},
      notifyStatsWorker: () => {},
      getLogFile: () => logFile,
    }),
    // 1.7.0 S6b: the routes drive the live channel through these seams.
    startLogWatch: () => {},
    stopLogWatch: () => {},
    workspaceClaudeArgs: [],
    workspaceClaudePath: null,
    workspaceIsNpmVersion: false,
    actualPort: 0,
    protocol: 'http',
    INTERNAL_TOKEN: 't',
    launchCallback: () => {},
    setWorkspaceLaunched: () => {},
    ...overrides,
  };
}

/**
 * 一个 res：第一次调用 .end() 抛错（模拟 SSE/socket 写失败），之后正常。
 * 用于触发 .then 成功回调内异常 → 进入路由的 .catch 分支。
 */
function throwOnceRes(resolve) {
  let threw = false;
  let status = 0;
  return {
    writeHead(c) { status = c; },
    end(b) {
      if (!threw) { threw = true; throw new Error('first-end-boom'); }
      resolve({ status, data: JSON.parse(b || '{}') });
    },
  };
}

describe('workspacesList — getWorkspaces 成功回调内 res 抛错 → catch 分支 (15-16)', () => {

  it('返回 500 + error 文本', async () => {
    const handler = routeFor('GET', '/api/workspaces');
    const { status, data } = await new Promise((resolve) => {
      const res = throwOnceRes(resolve);
      handler({}, res, { pathname: '/api/workspaces' }, true, baseDeps());
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'first-end-boom');
  });
});

describe('workspacesDelete — removeWorkspace 成功回调内 res 抛错 → catch 分支 (128-129)', () => {

  it('返回 500 + error 文本', async () => {
    const handler = routeFor('DELETE', '/api/workspaces/');
    const { status, data } = await new Promise((resolve) => {
      const res = throwOnceRes(resolve);
      // 任意 id（不存在亦可，removeWorkspace 仍 resolve，then 回调里第一次 end 抛错）
      handler({}, res, { pathname: '/api/workspaces/some-id-xyz' }, true, baseDeps());
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'first-end-boom');
  });
});

describe('workspacesStop — Promise.all 成功回调内 res 抛错 → catch 分支 (157-158)', () => {

  it('返回 500 + error 文本', async () => {
    const handler = routeFor('POST', '/api/workspaces/stop');
    const { status, data } = await new Promise((resolve) => {
      const res = throwOnceRes(resolve);
      handler(new EventEmitter(), res, { pathname: '/api/workspaces/stop' }, true, baseDeps());
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'first-end-boom');
  });
});

describe('workspacesLaunch — CCV_PROXY_PORT 已设 → spawnClaude PTY 分支 (61-64)', () => {
  let prevProxy;
  let prevMultitab;
  let spawnArgs = null;

  before(() => {
    prevProxy = process.env.CCV_PROXY_PORT;
    prevMultitab = process.env.CCV_ELECTRON_MULTITAB;
    process.env.CCV_PROXY_PORT = '54321';
    delete process.env.CCV_ELECTRON_MULTITAB; // 走非 Electron（web/CLI）完整逻辑
    // 注入假 node-pty，避免 spawn 真进程
    ptyMgr._setPtyImportForTests(() => ({
      spawn: (command, args) => {
        spawnArgs = { command, args };
        return {
          onData() {},
          onExit() {},
          kill() {},
          resize() {},
          write() {},
          pid: 12345,
        };
      },
    }));
  });

  after(() => {
    ptyMgr._setPtyImportForTests(null);
    if (prevProxy === undefined) delete process.env.CCV_PROXY_PORT; else process.env.CCV_PROXY_PORT = prevProxy;
    if (prevMultitab === undefined) delete process.env.CCV_ELECTRON_MULTITAB; else process.env.CCV_ELECTRON_MULTITAB = prevMultitab;
    ptyMgr.killPty();
  });

  function launch(body, deps) {
    return new Promise((resolve) => {
      const handler = routeFor('POST', '/api/workspaces/launch');
      const req = new EventEmitter();
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler(req, res, { pathname: '/api/workspaces/launch' }, true, deps);
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      req.emit('end');
    });
  }

  it('数组 extraArgs：合并 workspaceClaudeArgs 后传入 spawnClaude，返回 200', async () => {
    spawnArgs = null;
    const client = makeClient();
    let launchedSet = null;
    const deps = baseDeps({
      clients: [client],
      workspaceClaudePath: fakeClaudePath,
      workspaceClaudeArgs: ['--base'],
      setWorkspaceLaunched: (v) => { launchedSet = v; },
    });
    const { status, data } = await launch({ path: wsDir, extraArgs: ['--extra'] }, deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.projectName, basename(wsDir));
    assert.equal(launchedSet, true);
    assert.ok(spawnArgs, 'fake pty.spawn 被调用，证明走了 PTY 分支');
    // mergedArgs = [...workspaceClaudeArgs, ...extraArgs] 应同时含 --base 与 --extra
    const flat = spawnArgs.args.join(' ');
    assert.match(flat, /--base/);
    assert.match(flat, /--extra/);
  });

  it('非数组 extraArgs：launchExtraArgs 强制为 [] 分支，仅含 workspaceClaudeArgs', async () => {
    spawnArgs = null;
    const deps = baseDeps({
      workspaceClaudePath: fakeClaudePath,
      workspaceClaudeArgs: ['--only-base'],
    });
    const { status } = await launch({ path: wsDir, extraArgs: 'not-an-array' }, deps);
    assert.equal(status, 200);
    assert.ok(spawnArgs);
    const flat = spawnArgs.args.join(' ');
    assert.match(flat, /--only-base/);
    assert.doesNotMatch(flat, /not-an-array/);
  });
});

describe('workspacesLaunch / workspacesAdd — body 超 MAX_POST_BODY → req.destroy() 分支 (22, 100)', () => {

  // body 累积超过阈值时调 req.destroy()，连接被毁，'end' 不会触发 → handler 不 end res。
  // 用一个会记录 destroy 调用的 fake req 验证 destroy 被调用即可。
  function makeReq() {
    const req = new EventEmitter();
    req._destroyed = false;
    req.destroy = () => { req._destroyed = true; };
    return req;
  }

  it('launch: 超大 body 触发 req.destroy()', async () => {
    const handler = routeFor('POST', '/api/workspaces/launch');
    const req = makeReq();
    const res = { writeHead() {}, end() {} };
    handler(req, res, { pathname: '/api/workspaces/launch' }, true, baseDeps({ MAX_POST_BODY: 4 }));
    req.emit('data', 'xxxxxxxxxx'); // 10 > 4
    assert.equal(req._destroyed, true);
  });

  it('add: 超大 body 触发 req.destroy()', async () => {
    const handler = routeFor('POST', '/api/workspaces/add');
    const req = makeReq();
    const res = { writeHead() {}, end() {} };
    handler(req, res, { pathname: '/api/workspaces/add' }, true, baseDeps({ MAX_POST_BODY: 4 }));
    req.emit('data', 'xxxxxxxxxx');
    assert.equal(req._destroyed, true);
  });
});

describe('workspacesLaunch — 广播时 client.write 抛错被各 catch {} 吞掉 (72/78/82/86)', () => {
  let prevMultitab;
  before(() => { prevMultitab = process.env.CCV_ELECTRON_MULTITAB; delete process.env.CCV_ELECTRON_MULTITAB; });
  after(() => {
    if (prevMultitab === undefined) delete process.env.CCV_ELECTRON_MULTITAB; else process.env.CCV_ELECTRON_MULTITAB = prevMultitab;
  });

  it('每个 SSE 阶段(workspace_started/load_start/load_end)的 write 都抛错，handler 仍返回 200', async () => {
    // wire-v2: a fresh workspace launch reload streams getLiveLogSource() — an
    // empty stream (no v2 session yet), so only the workspace_started /
    // load_start / load_end write catches are reachable here.
    const seededWs = join(tmpDir, 'seeded-throw');
    mkdirSync(seededWs, { recursive: true });

    // 所有 write 都抛错 → 命中全部可达 catch {}
    const throwingClient = { write() { throw new Error('client-down'); } };
    const deps = baseDeps({ clients: [throwingClient] });

    const handler = routeFor('POST', '/api/workspaces/launch');
    const { status, data } = await new Promise((resolve) => {
      const req = new EventEmitter();
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler(req, res, { pathname: '/api/workspaces/launch' }, true, deps);
      req.emit('data', JSON.stringify({ path: seededWs }));
      req.emit('end');
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
