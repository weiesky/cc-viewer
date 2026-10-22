import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import { setLogDir } from '../findcc.js';
import { loadPlugins, _resetModuleCacheForTest, runParallelHook } from '../server/lib/plugin-loader.js';
import {
  onServerStarted,
  onServerStopping,
  reloadRuntime,
  unloadPlugin,
  restartPlugin,
  getRuntimePluginsInfo,
  getRuntimePluginStatus,
  isRuntimeStarted,
  _resetRuntimeForTest,
  _setRuntimeDepsForTest,
} from '../server/lib/plugin-runtime.js';
import { createRestartBackoff } from '../server/lib/plugin-service-manager.js';

let tmpRoot;
let pluginsDir;
let ctx;
const events = [];

function setup() {
  tmpRoot = mkdtempSync(join(homedir(), '.ccv-prt-'));
  pluginsDir = join(tmpRoot, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  setLogDir(tmpRoot);
  _resetModuleCacheForTest();
  _resetRuntimeForTest();
  events.length = 0;
  ctx = {
    logDir: tmpRoot,
    port: 17008,
    host: '127.0.0.1',
    basePath: '',
    protocol: 'http',
    token: 'tok',
    internalToken: 'itok',
    httpServer: null,
    pty: null,
    interactions: null,
    isStopping: () => false,
  };
}

function teardown() {
  _resetRuntimeForTest();
  _resetModuleCacheForTest();
  rmSync(tmpRoot, { recursive: true, force: true });
  setLogDir('tmp');
}

function writeDirPlugin(dirName, files) {
  const dir = join(pluginsDir, dirName);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function lifecycleMain(name) {
  return `
    export default {
      hooks: { serverStarted() { ${JSON.stringify(events)}.push ? null : null; } },
      async activate(ctx) { globalThis.__ccvEvents.push(['activate', ${JSON.stringify(name)}, !!ctx.service]); },
      async deactivate(reason) { globalThis.__ccvEvents.push(['deactivate', ${JSON.stringify(name)}, reason]); },
      async onError(err, info) { globalThis.__ccvEvents.push(['onError', ${JSON.stringify(name)}, info.phase]); },
    };
  `;
}

describe('plugin-runtime lifecycle (no spawn)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('server not started: reloadRuntime degrades to pure loadPlugins', async () => {
    writeDirPlugin('svc', {
      'plugin.json': JSON.stringify({ name: 'svc', service: { entry: 's.mjs' } }),
      's.mjs': '',
    });
    const r = await reloadRuntime();
    assert.equal(r.ok, true);
    assert.equal(r.started, false, '未启动时应退化，不 spawn');
    assert.equal(isRuntimeStarted(), false);
  });

  it('activate/deactivate called for lifecycle plugins on start/stop', async () => {
    globalThis.__ccvEvents = events;
    writeDirPlugin('lc', {
      'plugin.json': JSON.stringify({ name: 'lc', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('lc'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    assert.deepEqual(events.filter(e => e[0] === 'activate').map(e => e[1]), ['lc']);
    assert.equal(events[0][2], false, '无 service 的插件 ctx.service 为 null');
    await onServerStopping();
    assert.deepEqual(events.filter(e => e[0] === 'deactivate').map(e => [e[1], e[2]]), [['lc', 'serverStopping']]);
  });

  it('reload sequence: deactivate old → reload → activate new; per-plugin failure isolated', async () => {
    globalThis.__ccvEvents = events;
    writeDirPlugin('good', {
      'plugin.json': JSON.stringify({ name: 'good', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('good'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    assert.deepEqual(events.map(e => [e[0], e[1]]), [['activate', 'good']]);

    // Add a broken plugin and change good's marker (fingerprint change triggers reimport)
    writeDirPlugin('bad', {
      'plugin.json': JSON.stringify({ name: 'bad', main: 'main.mjs' }),
      'main.mjs': 'throw new Error("broken on import");',
    });
    const r = await reloadRuntime();
    assert.equal(r.ok, true);
    assert.deepEqual(events.map(e => [e[0], e[1]]), [
      ['activate', 'good'],
      ['deactivate', 'good'],
      ['activate', 'good'],
    ], 'reload 应先 deactivate 再 activate');
    const badStatus = getRuntimePluginStatus('bad');
    assert.equal(badStatus, null, 'import 失败的插件不进 runtime（loadError 域）');
    const entries = (await import('../server/lib/plugin-loader.js')).getPluginEntries();
    const badEntry = entries.find(e => e.name === 'bad');
    assert.match(badEntry.loadError, /broken on import/);
  });

  it('single-flight: concurrent reload calls serialize', async () => {
    globalThis.__ccvEvents = events;
    writeDirPlugin('lc', {
      'plugin.json': JSON.stringify({ name: 'lc', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('lc'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    const [r1, r2] = await Promise.all([reloadRuntime(), reloadRuntime()]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    const activates = events.filter(e => e[0] === 'activate').length;
    const deactivates = events.filter(e => e[0] === 'deactivate').length;
    assert.equal(activates, deactivates + 1, '每代 activate/deactivate 配对（串行不交错）');
  });

  it('unloadPlugin stops lifecycle and removes from runtime', async () => {
    globalThis.__ccvEvents = events;
    writeDirPlugin('u', {
      'plugin.json': JSON.stringify({ name: 'u', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('u'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    const r = await unloadPlugin('u', 'delete');
    assert.equal(r.unloaded, true);
    assert.deepEqual(events.filter(e => e[0] === 'deactivate').map(e => [e[1], e[2]]), [['u', 'delete']]);
    assert.equal(getRuntimePluginStatus('u'), null);
  });

  it('events.on subscribes to onNewEntry via dispatcher and unsubscribes on deactivate', async () => {
    writeDirPlugin('ev', {
      'plugin.json': JSON.stringify({ name: 'ev', main: 'main.mjs' }),
      'main.mjs': `
        export default {
          async activate(ctx) {
            ctx.events.on('new_entry', (e) => globalThis.__ccvEvents.push(['entry', e.uuid]));
          },
          async deactivate() {},
        };
      `,
    });
    globalThis.__ccvEvents = events;
    await loadPlugins();
    // Production path: log-watcher broadcasts via runParallelHook('onNewEntry'); the dispatcher must be in the pipeline
    const { runParallelHook } = await import('../server/lib/plugin-loader.js');
    await onServerStarted(ctx);
    await runParallelHook('onNewEntry', { uuid: 'e1' });
    assert.deepEqual(events, [['entry', 'e1']]);
    await unloadPlugin('ev', 'disable');
    await runParallelHook('onNewEntry', { uuid: 'e2' });
    assert.deepEqual(events, [['entry', 'e1']], 'deactivate 后订阅已退订');
  });

  it('restartPlugin on non-service plugin returns error', async () => {
    writeDirPlugin('plain', {
      'plugin.json': JSON.stringify({ name: 'plain', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('plain'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    const r = await restartPlugin('plain');
    assert.equal(r.ok, false);
  });

  it('onError fires when activate throws; lifecycle continues for others', async () => {
    globalThis.__ccvEvents = events;
    writeDirPlugin('thrower', {
      'plugin.json': JSON.stringify({ name: 'thrower', main: 'main.mjs' }),
      'main.mjs': `
        export default {
          async activate() { throw new Error('activate boom'); },
          async onError(err, info) { globalThis.__ccvEvents.push(['onError', 'thrower', info.phase]); },
        };
      `,
    });
    writeDirPlugin('fine', {
      'plugin.json': JSON.stringify({ name: 'fine', main: 'main.mjs' }),
      'main.mjs': lifecycleMain('fine'),
    });
    await loadPlugins();
    await onServerStarted(ctx);
    assert.deepEqual(events.filter(e => e[0] === 'onError'), [['onError', 'thrower', 'activate']]);
    assert.deepEqual(events.filter(e => e[0] === 'activate').map(e => e[1]), ['fine']);
  });
});

// ---- Service failure paths (spawn/probe/stop injected via _setRuntimeDepsForTest) ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs = 3000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function serviceMain(name) {
  return `
    export default {
      async activate(ctx) {
        globalThis.__ccvEvents.push(['activate', ${JSON.stringify(name)}, !!ctx.service]);
        ctx.events.on('new_entry', (e) => globalThis.__ccvEvents.push(['entry', ${JSON.stringify(name)}, e.uuid]));
      },
      async deactivate(reason) { globalThis.__ccvEvents.push(['deactivate', ${JSON.stringify(name)}, reason]); },
      async onError(err, info) { globalThis.__ccvEvents.push(['onError', ${JSON.stringify(name)}, info.phase]); },
    };
  `;
}

function writeServicePlugin(name = 'svc') {
  writeDirPlugin(name, {
    'plugin.json': JSON.stringify({ name, service: { entry: 's.mjs' }, main: 'main.mjs' }),
    's.mjs': '',
    'main.mjs': serviceMain(name),
  });
}

// Fake service manager: each spawn yields a fresh EventEmitter child + unique pid/paths.
function makeFakeDeps({ readyResult } = {}) {
  const spawns = [];
  const stops = [];
  let nextPid = 5000;
  const spawnServiceProcess = () => {
    nextPid += 1;
    const child = new EventEmitter();
    child.pid = nextPid;
    child.exitCode = null;
    child.kill = () => {
      if (child.exitCode === null) { child.exitCode = 0; child.emit('exit', 0, null); }
    };
    const rec = {
      pid: nextPid,
      child,
      lockPath: join(tmpRoot, 'runtime', `service-${nextPid}.lock`),
      configPath: join(tmpRoot, 'runtime', `config-${nextPid}.json`),
      secret: `secret-${nextPid}`,
      nonce: `nonce-${nextPid}`,
      runtimeDir: join(tmpRoot, 'runtime'),
      dataDir: join(tmpRoot, 'data'),
    };
    spawns.push(rec);
    return rec;
  };
  const stopServiceProcess = async (name, opts) => { stops.push(opts); return { stopped: true }; };
  const waitForServiceReady = async () => {
    const spawned = spawns[spawns.length - 1];
    if (typeof readyResult === 'function') return readyResult(spawned);
    if (readyResult) return readyResult;
    return { ok: true, port: 19000 + spawned.pid, pid: spawned.pid };
  };
  _setRuntimeDepsForTest({ spawnServiceProcess, waitForServiceReady, stopServiceProcess });
  return { spawns, stops };
}

describe('plugin-runtime service failure paths', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('marks a plugin blocked when the spawn test guard fires', async () => {
    globalThis.__ccvEvents = events;
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    const status = getRuntimePluginStatus('svc');
    assert.equal(status.state, 'blocked');
    assert.match(status.lastError, /test guard/);
  });

  it('health timeout stops the child and reports state=error', async () => {
    makeFakeDeps({ readyResult: { ok: false, state: 'timeout', error: 'service did not become ready' } });
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    const status = getRuntimePluginStatus('svc');
    assert.equal(status.state, 'error');
    assert.match(status.lastError, /health: service did not become ready/);
    assert.equal(status.pid, null);
  });

  it('health timeout calls stopServiceProcess with this child lock/config paths', async () => {
    const deps = makeFakeDeps({ readyResult: { ok: false, state: 'timeout', error: 'nope' } });
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    assert.equal(deps.stops.length, 1);
    assert.equal(deps.stops[0].lockPath, deps.spawns[0].lockPath);
    assert.equal(deps.stops[0].configPath, deps.spawns[0].configPath);
    assert.equal(deps.stops[0].nonce, deps.spawns[0].nonce);
  });

  it('child error surfaces lastError without restarting', async () => {
    const deps = makeFakeDeps();
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    deps.spawns[0].child.emit('error', new Error('spawn boom'));
    assert.match(getRuntimePluginStatus('svc').lastError, /spawn: spawn boom/);
    assert.equal(deps.spawns.length, 1);
  });

  it('crash restarts with cleanup, a new pid, and exactly one event subscription', async () => {
    globalThis.__ccvEvents = events;
    const deps = makeFakeDeps();
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    const firstPid = getRuntimePluginStatus('svc').pid;
    assert.equal(firstPid, deps.spawns[0].pid);
    assert.deepEqual(events.filter(e => e[0] === 'activate').length, 1);

    deps.spawns[0].child.emit('exit', 1, null);
    await waitUntil(() => {
      const st = getRuntimePluginStatus('svc');
      return st && st.state === 'ready' && st.pid === deps.spawns[1]?.pid;
    }, 3000, 'restart to ready');

    const status = getRuntimePluginStatus('svc');
    assert.notEqual(status.pid, firstPid, 'restart must use a new child pid');
    assert.equal(status.restarts, 1);
    assert.deepEqual(deps.stops[0].lockPath, deps.spawns[0].lockPath, 'crashed generation files cleaned');
    assert.deepEqual(events.filter(e => e[0] === 'deactivate').map(e => e[2]), ['service-exit']);
    assert.equal(events.filter(e => e[0] === 'activate').length, 2, 'activate re-runs after restart');

    await runParallelHook('onNewEntry', { uuid: 'e1' });
    assert.deepEqual(events.filter(e => e[0] === 'entry').map(e => e[2]), ['e1'], 'no duplicate subscription after restart');
  });

  it('crash cleanup overlapping restartPlugin never kills the replacement child (B2)', async () => {
    globalThis.__ccvEvents = events;
    let releaseDeactivate;
    globalThis.__ccvDeactivateGate = new Promise((resolve) => { releaseDeactivate = resolve; });
    writeDirPlugin('svc', {
      'plugin.json': JSON.stringify({ name: 'svc', service: { entry: 's.mjs' }, main: 'main.mjs' }),
      's.mjs': '',
      'main.mjs': `
        export default {
          async activate() { globalThis.__ccvEvents.push(['activate', 'svc']); },
          async deactivate(reason) {
            globalThis.__ccvEvents.push(['deactivate', 'svc', reason]);
            const gate = globalThis.__ccvDeactivateGate;
            globalThis.__ccvDeactivateGate = null;
            if (gate) await gate;
          },
        };
      `,
    });
    const deps = makeFakeDeps();
    await loadPlugins();
    await onServerStarted(ctx);
    const firstPid = getRuntimePluginStatus('svc').pid;

    // Crash: onServiceExit starts deactivating the crashed generation and parks on the gate.
    deps.spawns[0].child.emit('exit', 1, null);
    await waitUntil(
      () => events.some((e) => e[0] === 'deactivate' && e[2] === 'service-exit'),
      2000,
      'crash deactivate entered',
    );

    // A restart lands while the crash cleanup is still awaiting.
    const restart = await restartPlugin('svc');
    assert.equal(restart.ok, true);
    assert.equal(restart.status.state, 'ready');
    assert.equal(deps.spawns.length, 2, 'restart must not spawn extra children');
    const secondPid = deps.spawns[1].pid;
    assert.equal(getRuntimePluginStatus('svc').pid, secondPid);

    releaseDeactivate();
    await sleep(50); // let the stale crash cleanup resume

    const status = getRuntimePluginStatus('svc');
    assert.equal(status.state, 'ready', 'stale crash cleanup must not disturb the replacement');
    assert.equal(status.pid, secondPid);
    assert.notEqual(status.pid, firstPid);
    assert.equal(deps.spawns.length, 2, 'no extra spawn from the stale crash path');
    assert.ok(
      deps.stops.every((s) => s.lockPath !== deps.spawns[1].lockPath),
      'the replacement child must never be stopped by the stale cleanup',
    );
    assert.equal(
      events.filter((e) => e[0] === 'deactivate' && e[2] === 'service-exit').length,
      1,
      'no second service-exit deactivate',
    );
    assert.equal(events.filter((e) => e[0] === 'activate').length, 2);
    assert.equal(status.restarts, 0, 'the stale crash path must not schedule a backoff restart');
  });

  it('marks crashed when the backoff window is exhausted', async () => {
    const deps = makeFakeDeps();
    _setRuntimeDepsForTest({ createRestartBackoff: () => createRestartBackoff({ delays: [0] }) });
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);

    deps.spawns[0].child.emit('exit', 1, null);
    await waitUntil(() => deps.spawns.length === 2 && getRuntimePluginStatus('svc').state === 'ready', 3000, 'first restart');
    deps.spawns[1].child.emit('exit', 1, null);
    await waitUntil(() => getRuntimePluginStatus('svc').state === 'crashed', 3000, 'crashed state');
    assert.equal(getRuntimePluginStatus('svc').restarts, 1, 'only the allowed restart was counted');
  });

  it('restartPlugin restarts the child and re-runs activate', async () => {
    globalThis.__ccvEvents = events;
    const deps = makeFakeDeps();
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    const r = await restartPlugin('svc');
    assert.equal(r.ok, true);
    assert.equal(r.status.state, 'ready');
    assert.equal(deps.spawns.length, 2);
    assert.deepEqual(events.filter(e => e[0] === 'deactivate').map(e => e[2]), ['restart']);
    assert.equal(events.filter(e => e[0] === 'activate').length, 2);
  });

  it('refuses restart/unload/reload during the stopping window', async () => {
    makeFakeDeps();
    writeServicePlugin();
    await loadPlugins();
    await onServerStarted(ctx);
    const stopping = onServerStopping();
    const restart = await restartPlugin('svc');
    const unload = await unloadPlugin('svc', 'delete');
    const reload = await reloadRuntime();
    assert.equal(restart.ok, false);
    assert.match(restart.error, /stopping|not started/);
    assert.equal(unload.ok, false);
    assert.equal(reload.ok, false);
    await stopping;
  });

  it('kills a child spawned while shutdown was already in progress', async () => {
    writeServicePlugin();
    const stops = [];
    let spawned = null;
    _setRuntimeDepsForTest({
      spawnServiceProcess: () => {
        spawned = {
          pid: 6001,
          child: new EventEmitter(),
          lockPath: join(tmpRoot, 'runtime', 'service-6001.lock'),
          configPath: join(tmpRoot, 'runtime', 'config-6001.json'),
          secret: 's',
          nonce: 'n',
          runtimeDir: tmpRoot,
          dataDir: tmpRoot,
        };
        // Shutdown starts between spawn and the post-spawn validity check.
        onServerStopping();
        return spawned;
      },
      waitForServiceReady: async () => ({ ok: true, port: 19001, pid: 6001 }),
      stopServiceProcess: async (name, opts) => { stops.push(opts); return { stopped: true }; },
    });
    await loadPlugins();
    await onServerStarted(ctx);
    assert.equal(stops.length, 1, 'the freshly spawned child must be killed');
    assert.equal(stops[0].lockPath, spawned.lockPath);
  });
});
