// Coverage target: server/routes/workspaces.js (workspacesRoutes array)
//
// Per-route coverage following the test/api-preferences.test.js pattern: each handler is
// (req, res, parsedUrl, isLocal, deps). req is an EventEmitter (emit data/end), res collects
// writeHead/end, deps is injected with the minimum the source touches.
//
// Isolation: CCV_LOG_DIR / CLAUDE_CONFIG_DIR point at a temp dir set BEFORE importing the routes
// (workspace-registry persists workspaces.json under LOG_DIR). CCV_PROXY_PORT is kept UNSET so the
// launch path skips the PTY spawn (real child process), and CCV_ELECTRON_MULTITAB toggles the two
// launch branches. wire-v2 (1.7.0): launch drives the live channel via deps.startLogWatch/
// stopLogWatch seams (no watchLogFile timers to unwatch), and the launch reload streams from
// getLiveLogSource() — an EMPTY stream for a fresh workspace (v1 log files are never reused).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-workspaces-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
delete process.env.CCV_PROXY_PORT; // 不起 PTY
delete process.env.CCV_ELECTRON_MULTITAB;
// 宿主 shell 若是 `ccv -c` 启动的(cli 通道①会设 CCV_CLAUDE_CONTINUE=1),
// isContinuedLaunch() 会在裸导入时即为真 → 本套件的 pristine 断言被环境耦合击穿。
delete process.env.CCV_CLAUDE_CONTINUE;

// 一个真实存在的目录，用作合法 workspace 路径
const wsDir = join(tmpDir, 'my-project');
mkdirSync(wsDir, { recursive: true });
// 一个文件（非目录），用于触发 "Invalid directory path"
const aFile = join(tmpDir, 'a-file.txt');
writeFileSync(aFile, 'x');

const { workspacesRoutes } = await import('../server/routes/workspaces.js');

function routeFor(method, path) {
  const r = workspacesRoutes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

/** 收集 SSE client 写入的事件文本 */
function makeClient() {
  const writes = [];
  return { write: (s) => { writes.push(s); return true; }, _writes: writes };
}

/** 基础 deps，单测按需覆盖字段 */
function baseDeps(overrides = {}) {
  const clients = overrides.clients || [];
  return {
    MAX_POST_BODY: 1024 * 1024,
    isWorkspaceMode: true,
    workspaceLaunched: false,
    clients,
    statsWorker: { running: true }, // 已启动，避免 startStatsWorker
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

describe('workspacesRoutes shape', () => {
  it('exports the five expected routes', () => {
    assert.equal(workspacesRoutes.length, 5);
    const sig = workspacesRoutes.map((r) => `${r.method} ${r.path} ${r.match}`);
    assert.deepEqual(sig, [
      'GET /api/workspaces exact',
      'POST /api/workspaces/launch exact',
      'POST /api/workspaces/add exact',
      'DELETE /api/workspaces/ prefix',
      'POST /api/workspaces/stop exact',
    ]);
  });
});

describe('GET /api/workspaces (list)', () => {

  function getList(deps) {
    return new Promise((resolve) => {
      const handler = routeFor('GET', '/api/workspaces');
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler({}, res, { pathname: '/api/workspaces' }, true, deps);
    });
  }

  it('returns an empty list with workspaceMode false when registry is empty and not in workspace mode', async () => {
    const { status, data } = await getList(baseDeps({ isWorkspaceMode: false }));
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.workspaces));
    assert.equal(data.workspaceMode, false);
  });

  it('workspaceMode is true when isWorkspaceMode && !workspaceLaunched', async () => {
    const { data } = await getList(baseDeps({ isWorkspaceMode: true, workspaceLaunched: false }));
    assert.equal(data.workspaceMode, true);
  });

  it('workspaceMode is false once a workspace has launched', async () => {
    const { data } = await getList(baseDeps({ isWorkspaceMode: true, workspaceLaunched: true }));
    assert.equal(data.workspaceMode, false);
  });
});

describe('POST /api/workspaces/add', () => {

  function postAdd(body, deps = baseDeps()) {
    return new Promise((resolve) => {
      const handler = routeFor('POST', '/api/workspaces/add');
      const req = new EventEmitter();
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler(req, res, { pathname: '/api/workspaces/add' }, true, deps);
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      req.emit('end');
    });
  }

  it('registers a valid directory and returns the workspace entry', async () => {
    const { status, data } = await postAdd({ path: wsDir });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.workspace.projectName, basename(wsDir));
    assert.equal(data.workspace.path, wsDir);
    assert.ok(data.workspace.id, 'entry has an id');
    // 实际写入 workspaces.json
    const persisted = JSON.parse(readFileSync(join(tmpDir, 'workspaces.json'), 'utf-8'));
    assert.ok(persisted.workspaces.some((w) => w.path === wsDir));
  });

  it('rejects a non-existent path with 400', async () => {
    const { status, data } = await postAdd({ path: join(tmpDir, 'does-not-exist') });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory path');
  });

  it('rejects a path that is a file (not a directory) with 400', async () => {
    const { status, data } = await postAdd({ path: aFile });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory path');
  });

  it('rejects missing path field with 400', async () => {
    const { status, data } = await postAdd({});
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory path');
  });

  it('returns 500 with the parse error on malformed JSON body', async () => {
    const { status, data } = await postAdd('{not json');
    assert.equal(status, 500);
    assert.ok(typeof data.error === 'string' && data.error.length > 0);
  });
});

describe('GET /api/workspaces reflects added entries', () => {

  it('lists the previously added workspace with logCount/totalSize enrichment', async () => {
    const handler = routeFor('GET', '/api/workspaces');
    const { data } = await new Promise((resolve) => {
      const res = { writeHead() {}, end(b) { resolve({ data: JSON.parse(b || '{}') }); } };
      handler({}, res, { pathname: '/api/workspaces' }, true, baseDeps());
    });
    const found = data.workspaces.find((w) => w.path === wsDir);
    assert.ok(found, 'added workspace appears in the list');
    assert.equal(typeof found.logCount, 'number');
    assert.equal(typeof found.totalSize, 'number');
  });
});

describe('DELETE /api/workspaces/:id', () => {

  function del(id) {
    return new Promise((resolve) => {
      const handler = routeFor('DELETE', '/api/workspaces/');
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler({}, res, { pathname: `/api/workspaces/${id}` }, true, baseDeps());
    });
  }

  it('removes an existing workspace and returns ok:true', async () => {
    // 先加一个拿到 id
    const addHandler = routeFor('POST', '/api/workspaces/add');
    const subDir = join(tmpDir, 'to-delete');
    mkdirSync(subDir, { recursive: true });
    const entry = await new Promise((resolve) => {
      const req = new EventEmitter();
      const res = { writeHead() {}, end(b) { resolve(JSON.parse(b).workspace); } };
      addHandler(req, res, { pathname: '/api/workspaces/add' }, true, baseDeps());
      req.emit('data', JSON.stringify({ path: subDir }));
      req.emit('end');
    });

    const { status, data } = await del(entry.id);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    const persisted = JSON.parse(readFileSync(join(tmpDir, 'workspaces.json'), 'utf-8'));
    assert.equal(persisted.workspaces.some((w) => w.id === entry.id), false);
  });

  it('returns ok:false when the id does not exist', async () => {
    const { status, data } = await del('nonexistent-id-xyz');
    assert.equal(status, 200);
    assert.equal(data.ok, false);
  });
});

describe('POST /api/workspaces/launch — Electron multi-tab branch', () => {
  let prevMultitab;
  before(() => { prevMultitab = process.env.CCV_ELECTRON_MULTITAB; process.env.CCV_ELECTRON_MULTITAB = '1'; });
  after(() => {
    if (prevMultitab === undefined) delete process.env.CCV_ELECTRON_MULTITAB;
    else process.env.CCV_ELECTRON_MULTITAB = prevMultitab;
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

  it('invokes launchCallback, sets launched, and returns projectName without touching logs', async () => {
    let cbArgs = null;
    let launchedSet = null;
    const deps = baseDeps({
      launchCallback: (p, extra) => { cbArgs = { p, extra }; },
      setWorkspaceLaunched: (v) => { launchedSet = v; },
    });
    const { status, data } = await launch({ path: wsDir, extraArgs: ['--foo'] }, deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.projectName, basename(wsDir));
    assert.deepEqual(cbArgs, { p: wsDir, extra: ['--foo'] });
    assert.equal(launchedSet, true);
  });

  it('coerces non-array extraArgs to [] when calling launchCallback', async () => {
    let cbArgs = null;
    const deps = baseDeps({ launchCallback: (p, extra) => { cbArgs = { p, extra }; } });
    await launch({ path: wsDir, extraArgs: 'not-an-array' }, deps);
    assert.deepEqual(cbArgs.extra, []);
  });

  it('rejects an invalid path with 400', async () => {
    const { status, data } = await launch({ path: join(tmpDir, 'nope') }, baseDeps());
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory path');
  });

  it('returns 500 on malformed JSON', async () => {
    const { status, data } = await launch('{bad', baseDeps());
    assert.equal(status, 500);
    assert.ok(data.error);
  });
});

describe('POST /api/workspaces/launch — web/CLI branch (no PTY)', () => {
  let prevMultitab;
  before(() => { prevMultitab = process.env.CCV_ELECTRON_MULTITAB; delete process.env.CCV_ELECTRON_MULTITAB; });
  after(() => {
    if (prevMultitab !== undefined) process.env.CCV_ELECTRON_MULTITAB = prevMultitab;
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

  it('initializes the workspace, watches logs, starts stats, broadcasts SSE, and returns projectName', async () => {
    const client = makeClient();
    let launchedSet = null;
    let statsStarted = false;
    let streamingTimerStarted = false;
    const deps = baseDeps({
      clients: [client],
      statsWorker: null, // 未启动 → 应触发 startStatsWorker
      startStatsWorker: () => { statsStarted = true; },
      startStreamingStatusTimer: () => { streamingTimerStarted = true; },
      setWorkspaceLaunched: (v) => { launchedSet = v; },
    });

    const { status, data } = await launch({ path: wsDir, extraArgs: ['--x'] }, deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.projectName, basename(wsDir));
    assert.equal(launchedSet, true);
    assert.equal(statsStarted, true, 'startStatsWorker called when statsWorker was falsy');
    assert.equal(streamingTimerStarted, true);
    // env 被设为工作区目录
    assert.equal(process.env.CCV_PROJECT_DIR, wsDir);

    // SSE 广播：workspace_started + load_start + load_end（空日志无 load_chunk）
    const joined = client._writes.join('');
    assert.match(joined, /event: workspace_started/);
    assert.match(joined, /event: load_start/);
    assert.match(joined, /event: load_end/);
  });

  it('never reuses a legacy v1 log file — the launch reload is an empty stream (wire-v2)', async () => {
    // Seed a project dir + a recent v1 .jsonl: 1.7.0 launch streams from
    // getLiveLogSource() (no v2 session yet for a fresh workspace), so the
    // legacy file is IGNORED — load_start total 0, no load_chunk.
    const seededWs = join(tmpDir, 'seeded-proj');
    mkdirSync(seededWs, { recursive: true });
    const logSubdir = join(tmpDir, basename(seededWs));
    mkdirSync(logSubdir, { recursive: true });
    const entry = JSON.stringify({ timestamp: new Date().toISOString(), url: 'https://api.anthropic.com/v1/messages', mainAgent: true });
    writeFileSync(join(logSubdir, `${basename(seededWs)}_20990101_000000.jsonl`), entry);

    const client = makeClient();
    const deps = baseDeps({ clients: [client] });
    const { status } = await launch({ path: seededWs }, deps);
    assert.equal(status, 200);
    const joined = client._writes.join('');
    assert.match(joined, /event: workspace_started/);
    assert.match(joined, /event: load_start\ndata: \{"total":0/);
    assert.match(joined, /event: load_end/);
    assert.doesNotMatch(joined, /event: load_chunk/, 'v1 log file must not be replayed');
    // P2: pending v1 logs in the switched-into project → migrate_prompt broadcast
    // to already-connected clients.
    assert.match(joined, /event: migrate_prompt/);
    assert.match(joined, /"files":1/);
  });

  it('scans launch args for -c/--continue and marks the launch as continued (P2 channel ②)', async () => {
    const { isContinuedLaunch } = await import('../server/interceptor.js');
    // NOTE: markContinuedLaunch is sticky for the process — this test must run
    // AFTER any assertions that need isContinuedLaunch() === false.
    assert.equal(isContinuedLaunch(), false, 'pristine before the -c launch');
    const contWs = join(tmpDir, 'cont-proj');
    mkdirSync(contWs, { recursive: true });
    const { status } = await launch({ path: contWs, extraArgs: ['-c'] }, baseDeps());
    assert.equal(status, 200);
    assert.equal(isContinuedLaunch(), true, 'workspace-injected -c detected without a PTY');
  });

  it('does not call startStatsWorker again when one is already running', async () => {
    let statsCalls = 0;
    const deps = baseDeps({
      statsWorker: { running: true },
      startStatsWorker: () => { statsCalls++; },
    });
    await launch({ path: wsDir }, deps);
    assert.equal(statsCalls, 0);
  });

  it('rejects an invalid path with 400 (web branch)', async () => {
    const { status, data } = await launch({ path: aFile }, baseDeps());
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory path');
  });
});

describe('POST /api/workspaces/stop', () => {

  function stop(deps) {
    return new Promise((resolve) => {
      const handler = routeFor('POST', '/api/workspaces/stop');
      const req = new EventEmitter();
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      handler(req, res, { pathname: '/api/workspaces/stop' }, true, deps);
    });
  }

  it('kills PTYs, unwatches, resets, broadcasts workspace_stopped, returns ok:true', async () => {
    const client = makeClient();
    let launchedSet = null;
    const deps = baseDeps({ clients: [client], setWorkspaceLaunched: (v) => { launchedSet = v; } });
    const { status, data } = await stop(deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(launchedSet, false);
    assert.match(client._writes.join(''), /event: workspace_stopped/);
  });

  it('tolerates a client whose write throws (SSE broadcast is best-effort)', async () => {
    const throwingClient = { write() { throw new Error('boom'); } };
    const deps = baseDeps({ clients: [throwingClient] });
    const { status, data } = await stop(deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
