// Plugin runtime: lifecycle orchestration for directory (service/panel) plugins.
// Owns the mount table used by the proxy routes, per-plugin service status, and the
// activate/deactivate/onError lifecycle on top of plugin-loader's scan results.
//
// Single-flight model: reload()/unloadPlugin()/restartPlugin() all serialize through one
// queue. Every callback (spawn/activate/exit) checks the runtime generation and the
// stopping flag so a late event from a previous generation can never resurrect a plugin.
//
// Layering: L1-lib. Everything this module needs from server.js (port, tokens, httpServer,
// isStopping...) arrives via the ctx object passed to onServerStarted — never imported.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadPlugins,
  getPluginEntries,
  registerEventDispatcherPlugin,
} from './plugin-loader.js';
import {
  spawnServiceProcess,
  waitForServiceReady,
  stopServiceProcess,
  cleanupStaleServiceLocks,
  createRestartBackoff,
} from './plugin-service-manager.js';
import { createProxyTracker, createPluginAgent, proxyHttpRequest, proxyUpgrade } from './plugin-proxy.js';
import { reportSwallowed } from './error-report.js';

const ACTIVATE_TIMEOUT_MS = 2000;
const DEACTIVATE_TIMEOUT_MS = 1500;
const START_GRACE_MS = 3000;
const BOOT_NONCE = randomBytes(8).toString('hex');

// Injectable service-process dependencies: the runtime's failure arms (blocked spawn,
// health timeout, crash/exit, stop during restart) are otherwise unreachable without
// spawning real children. Tests override these; production keeps the manager defaults.
const RUNTIME_DEP_DEFAULTS = Object.freeze({
  spawnServiceProcess,
  waitForServiceReady,
  stopServiceProcess,
  cleanupStaleServiceLocks,
  createRestartBackoff,
});
let _runtimeDeps = { ...RUNTIME_DEP_DEFAULTS };

export function _setRuntimeDepsForTest(overrides = {}) {
  _runtimeDeps = { ..._runtimeDeps, ...overrides };
}

let _started = false;
let _stopping = false;
let _stoppingPromise = null;
let _generation = 0;
let _ctx = null; // server-injected context (see onServerStarted)
let _queue = Promise.resolve(); // single-flight queue
const _plugins = new Map(); // name -> RuntimePlugin
const _tracker = createProxyTracker();

function enqueue(fn) {
  const run = _queue.then(fn, fn);
  _queue = run.catch((err) => reportSwallowed('plugin-runtime.queue', err));
  return run;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

function emptyStatus() {
  return {
    state: 'pending', // pending|starting|ready|active|restarting|crashed|stopping|stopped|blocked|error
    pid: null,
    port: null,
    restarts: 0,
    lastError: null,
    startedAt: null,
  };
}

function getRuntimePlugin(name) {
  return _plugins.get(name) || null;
}

/** Live service object updated in place (the activate ctx holds this reference across restarts) */
class ServiceHandle {
  constructor(rt) {
    this._rt = rt;
    this.prefix = rt.entry?.service?.prefix ?? null;
  }
  get port() { return this._rt.status.port; }
  get pid() { return this._rt.status.pid; }
  get baseUrl() { return this._rt.status.port ? `http://127.0.0.1:${this._rt.status.port}` : null; }
  get secret() { return this._rt.child?.secret ?? null; }
  status() { return { ...this._rt.status }; }
  restart() { return restartPlugin(this._rt.name); }
}

function makeLogger(name) {
  const tag = `[plugin:${name}]`;
  return {
    debug: (...a) => { if (process.env.CCV_DEBUG_PLUGINS === '1') console.error(tag, ...a); },
    info: (...a) => console.log(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
  };
}

function callLifecycle(rt, hook, args, timeoutMs, phase) {
  const fn = rt.entry?.plugin?.[hook];
  if (typeof fn !== 'function') return Promise.resolve();
  return withTimeout(Promise.resolve().then(() => fn(...args)), timeoutMs, `${hook} of ${rt.name}`)
    .catch((err) => {
      notifyError(rt, err, { phase });
    });
}

function notifyError(rt, err, info) {
  rt.status.lastError = `${info.phase}: ${err && err.message || err}`;
  const fn = rt.entry?.plugin?.onError;
  if (typeof fn === 'function') {
    try {
      Promise.resolve(fn(err, info)).catch((e) => reportSwallowed('plugin-runtime.onerror', e));
    } catch (e) {
      reportSwallowed('plugin-runtime.onerror', e);
    }
  } else {
    reportSwallowed('plugin-runtime.error', err, { plugin: rt.name, phase: info.phase });
  }
}

function currentMountTarget(rt) {
  if (!rt.child || !rt.status.port) return null;
  // basePath always has a trailing slash (normalizeBasePath) - strip it before joining to avoid '//plugins/x'
  const basePath = (_ctx?.basePath || '').replace(/\/$/, '');
  const externalPrefix = `${basePath}${rt.entry.service.prefix}`;
  return {
    name: rt.name,
    port: rt.status.port,
    secret: rt.child.secret,
    externalPrefix,
    cookiePath: `${externalPrefix}/`,
    protocol: _ctx?.protocol || 'http',
    agent: rt.agent,
  };
}

// ---- mount table ----

function findMountByPath(pathname) {
  // pathname already has basePath stripped (handled at the top of handleRequest)
  if (!pathname.startsWith('/plugins/')) return null;
  const rest = pathname.slice('/plugins/'.length);
  const slash = rest.indexOf('/');
  const name = slash === -1 ? rest : rest.slice(0, slash);
  const rt = _plugins.get(name);
  if (!rt || !rt.entry?.service || !rt.entry.enabled) return null;
  const prefix = rt.entry.service.prefix; // '/plugins/<name>' (validated by the manifest)
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return rt;
}

export function hasAnyMountPrefix(pathname) {
  return findMountByPath(pathname) !== null;
}

// ---- HTTP proxy entry (called from routes/plugin-services.js) ----

export function tryProxyHttp(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const rt = findMountByPath(pathname);
  if (!rt) return false;
  const prefix = rt.entry.service.prefix;
  if (pathname === prefix) {
    // 308 to the trailing-slash form (Location carries basePath + query, no-store)
    const location = `${(_ctx?.basePath || '').replace(/\/$/, '')}${prefix}/${parsedUrl.search || ''}`;
    res.writeHead(308, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }
  if (rt.status.state === 'stopping' || rt.status.state === 'stopped') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `plugin "${rt.name}" is stopping` }));
    return true;
  }
  const target = currentMountTarget(rt);
  if (!target || rt.status.state !== 'ready') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `plugin "${rt.name}" is not ready`, state: rt.status.state, lastError: rt.status.lastError }));
    return true;
  }
  proxyHttpRequest(req, res, {
    target,
    match: { forwardPath: pathname.slice(prefix.length) || '/', search: parsedUrl.search || '' },
    tracker: _tracker,
  });
  return true;
}

export function tryProxyUpgrade(req, socket, head, parsedUrl) {
  const pathname = parsedUrl ? parsedUrl.pathname : new URL(req.url, 'http://localhost').pathname;
  const rt = findMountByPath(pathname);
  if (!rt) return false;
  // Attach client socket error/close synchronously before entering the async section
  socket.on('error', (err) => reportSwallowed('plugin-runtime.ws-client', err));
  const prefix = rt.entry.service.prefix;
  const target = currentMountTarget(rt);
  if (!target || rt.status.state !== 'ready') {
    try {
      socket.write(`HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify({ error: `plugin "${rt.name}" is not ready` })}`);
    } catch { /* noop */ }
    socket.destroy();
    return true;
  }
  proxyUpgrade(req, socket, head, {
    target,
    match: { forwardPath: pathname.slice(prefix.length) || '/', search: parsedUrl ? (parsedUrl.search || '') : '' },
    tracker: _tracker,
  });
  return true;
}

// Stop a child we spawned. stopServiceProcess only signals a PID when the lock proves
// ownership (PID-reuse safety); when it had to skip the signal we still hold the
// ChildProcess handle, whose identity cannot be a reused PID, so kill it directly to
// avoid leaking a detached orphan.
async function stopOwnedService(rt, spawned, timeoutMs = 1500) {
  const result = await _runtimeDeps.stopServiceProcess(rt.name, {
    lockPath: spawned.lockPath,
    configPath: spawned.configPath,
    pid: spawned.pid,
    nonce: spawned.nonce,
    timeoutMs,
  });
  if (result?.skippedSignal) {
    const child = spawned.child;
    if (child && typeof child.kill === 'function' && child.exitCode == null) {
      try { child.kill('SIGKILL'); } catch (err) { reportSwallowed('plugin-runtime.orphan-kill', err); }
    }
  }
  return result;
}

// ---- Lifecycle: start/stop of one service plugin ----
// Epoch scheme (prevents double children on restart/exit races): every start/stop/restart
// bumps rt.epoch; callbacks capture the epoch and spawned handle and are dropped on mismatch.

async function startServicePlugin(rt, generation) {
  // Refuse once shutdown has begun: onServerStopping sweeps `_plugins` in order, so a
  // spawn accepted after that sweep would never be visited and its child would leak.
  if (_stopping || !_started || rt.stopping || generation !== _generation) return false;
  const epoch = ++rt.epoch;
  const desc = {
    name: rt.name,
    version: rt.entry.manifest?.version,
    entryPath: rt.entry.service.entryPath,
    pluginDir: rt.entry.pluginDir,
    prefix: rt.entry.service.prefix,
    env: rt.entry.service.env,
  };
  rt.status.state = rt.status.restarts > 0 ? 'restarting' : 'starting';
  rt.status.lastError = null;

  const spawned = _runtimeDeps.spawnServiceProcess(desc, {
    logDir: _ctx.logDir,
    parentPort: _ctx.port,
    parentBasePath: _ctx.basePath,
    generation,
    serverPid: process.pid,
    bootNonce: BOOT_NONCE,
  });
  if (spawned.blockedByTestGuard) {
    rt.status.state = 'blocked';
    rt.status.lastError = 'blocked by test guard';
    return false;
  }
  rt.child = spawned;
  rt.backoff.markStarted();

  // The spawn may straddle a stop/reload: never leave a freshly spawned child behind.
  if (_stopping || !_started || rt.stopping || generation !== _generation || rt.epoch !== epoch) {
    await stopOwnedService(rt, spawned);
    if (rt.child === spawned) rt.child = null;
    return false;
  }

  let childDead = false;
  const child = spawned.child;
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      if (rt.epoch !== epoch || rt.child !== spawned) return; // stale event
      notifyError(rt, err, { phase: 'spawn', pid: spawned.pid });
    });
    child.on('exit', (code, signal) => {
      childDead = true;
      // Late exits (after stop/restart) must not trigger backoff restarts - prevents double children
      if (rt.epoch !== epoch || rt.child !== spawned) return;
      onServiceExit(rt, generation, code, signal).catch((err) => reportSwallowed('plugin-runtime.exit', err));
    });
  }

  const ready = await _runtimeDeps.waitForServiceReady(desc, {
    lockPath: spawned.lockPath,
    secret: spawned.secret,
    nonce: spawned.nonce,
    expectedPid: spawned.pid,
    isChildDead: () => childDead,
    timeoutMs: 10000,
  });
  if (generation !== _generation || _stopping || !_started || rt.stopping || rt.epoch !== epoch) {
    // Stopped/reloaded while the health probe was in flight — kill our own child here;
    // the shutdown sweep may already have moved past this runtime entry.
    await stopOwnedService(rt, spawned);
    if (rt.child === spawned) rt.child = null;
    return false;
  }
  if (!ready.ok) {
    notifyError(rt, new Error(ready.error), { phase: 'health', pid: spawned.pid });
    await stopOwnedService(rt, spawned);
    // Health-failure path: stopServiceProcess removed this generation's config (the
    // only place the secret lives) and lock; reset the child handle.
    if (rt.epoch === epoch && rt.child === spawned) rt.child = null;
    rt.status.state = 'error';
    return false;
  }

  rt.status.state = 'ready';
  rt.status.port = ready.port;
  rt.status.pid = ready.pid;
  rt.status.startedAt = new Date().toISOString();
  rt.agent = rt.agent || createPluginAgent();
  return true;
}

async function onServiceExit(rt, generation, code, signal) {
  if (generation !== _generation || _stopping || rt.stopping) return;
  // Capture this generation's identifiers ONCE. Every await below can overlap a
  // concurrent restart/reload (stopServicePlugin bumps rt.epoch and rt.child may be a
  // brand-new child by the time we resume); re-reading after an await would let this
  // cleanup kill the replacement child or deactivate it a second time.
  const exitEpoch = rt.epoch;
  const crashedChild = rt.child;
  rt.status.port = null;
  rt.status.pid = null;
  rt.status.state = 'restarting';
  if (rt.agent) { try { rt.agent.destroy(); } catch { /* noop */ } rt.agent = null; }
  notifyError(rt, new Error(`service exited (code=${code} signal=${signal})`), { phase: 'service-exit', exitCode: code, signal });

  // Tear down the crashed generation before scheduling a replacement:
  // - aborting the controller unsubscribes events.on so the reboot cannot double-deliver;
  // - deactivate balances the previous activate (subscriptions/resources rebuilt later);
  // - stopServiceProcess removes the stale lock and this generation's config, the only
  //   place the plugin secret lives (a child that died does not clean up after itself).
  rt.controller?.abort();
  rt.controller = null;
  const wasActivated = rt.activated;
  if (wasActivated) {
    // Close the double-deactivate window before awaiting: a concurrent restart must see
    // this generation as already deactivated.
    rt.activated = false;
    await callLifecycle(rt, 'deactivate', ['service-exit'], DEACTIVATE_TIMEOUT_MS, 'deactivate');
    // A restart/reload took over during deactivate and owns the runtime entry now.
    if (rt.epoch !== exitEpoch) return;
  }
  if (crashedChild && rt.child === crashedChild) {
    // The child is already dead, so the PID-identity guard in stopServiceProcess keeps
    // this to file cleanup — it never signals a reused PID.
    await stopOwnedService(rt, crashedChild);
    if (rt.child === crashedChild) rt.child = null;
  }

  // A concurrent stop/reload may have taken over while cleanup awaited.
  if (generation !== _generation || _stopping || rt.stopping || rt.epoch !== exitEpoch) return;
  const { allowed, delayMs } = rt.backoff.next();
  if (!allowed) {
    rt.status.state = 'crashed';
    return;
  }
  rt.restartTimer = setTimeout(() => {
    rt.restartTimer = null;
    if (generation !== _generation || _stopping || !_started || rt.stopping || rt.epoch !== exitEpoch) return;
    enqueue(async () => {
      if (generation !== _generation || _stopping || !_started || rt.stopping || rt.epoch !== exitEpoch) return;
      rt.status.restarts += 1;
      const ok = await startServicePlugin(rt, generation);
      // A successfully restarted service must re-run activate: the crash path called
      // deactivate, so the subscriptions/state torn down there have to be rebuilt.
      if (ok && wasActivated && typeof rt.entry?.plugin?.activate === 'function') {
        rt.activated = true;
        await callLifecycle(rt, 'activate', [buildPluginContext(rt)], ACTIVATE_TIMEOUT_MS, 'activate');
      }
    });
  }, delayMs);
  rt.restartTimer.unref?.();
}

async function stopServicePlugin(rt, reason) {
  rt.stopping = true;
  rt.status.state = 'stopping';
  rt.epoch += 1; // invalidate every late callback from this generation (restart/exit race guard)
  if (rt.restartTimer) { clearTimeout(rt.restartTimer); rt.restartTimer = null; }
  // Abort the signal first so event subscriptions unsubscribe (no events during deactivate)
  rt.controller?.abort();

  // P0-5 ordering: send SIGTERM synchronously, then run deactivate in parallel
  const child = rt.child;
  const sigtermPromise = (async () => {
    if (!child) return;
    await stopOwnedService(rt, child);
  })();

  const deactivatePromise = callLifecycle(rt, 'deactivate', [reason], DEACTIVATE_TIMEOUT_MS, 'deactivate');
  _tracker.destroyAll(rt.name);
  if (rt.agent) { try { rt.agent.destroy(); } catch { /* noop */ } rt.agent = null; }

  await Promise.allSettled([sigtermPromise, deactivatePromise]);
  rt.child = null;
  rt.status.port = null;
  rt.status.pid = null;
  rt.status.state = 'stopped';
  rt.controller = null;
  rt.activated = false;
}

// ---- Public runtime API ----

export async function onServerStarted(ctx) {
  _ctx = {
    logDir: ctx.logDir,
    port: ctx.port,
    host: ctx.host,
    basePath: ctx.basePath || '',
    protocol: ctx.protocol || 'http',
    token: ctx.token,
    internalToken: ctx.internalToken,
    httpServer: ctx.httpServer,
    pty: ctx.pty ?? null,
    interactions: ctx.interactions ?? null,
    isStopping: ctx.isStopping || (() => false),
  };
  _stopping = false;
  _started = true;
  _generation += 1;
  const generation = _generation;
  ensureEventDispatcherRegistered();

  await _runtimeDeps.cleanupStaleServiceLocks(ctx.logDir, { bootNonce: BOOT_NONCE });

  // Reload while the main process is already running: entries come from the last loadPlugins
  await activateAll(generation, { graceMs: START_GRACE_MS });
}

function buildPluginContext(rt) {
  const manifest = rt.entry.manifest;
  const serviceHandle = rt.entry.service ? new ServiceHandle(rt) : null;
  const controller = new AbortController();
  const signal = controller.signal;
  rt.controller = controller;
  const config = { ...(manifest?.configDefaults || {}) };
  const dataDir = rt.dataDir;
  return {
    name: rt.name,
    version: manifest?.version ?? null,
    pluginDir: rt.entry.pluginDir,
    dataDir,
    basePath: _ctx.basePath,
    server: {
      port: _ctx.port,
      host: _ctx.host,
      protocol: _ctx.protocol,
      url: `${_ctx.protocol}://127.0.0.1:${_ctx.port}${_ctx.basePath}`,
      ip: null,
      token: _ctx.token,
      internalToken: _ctx.internalToken,
      httpServer: _ctx.httpServer,
      // Read through getters: server.js fills pty/interactions via _enrichContext after activate
      get pty() { return _ctx.pty; },
      get interactions() { return _ctx.interactions; },
    },
    service: serviceHandle,
    panel: rt.entry.panel ? { url: `/plugin-panels/${rt.name}/`, title: rt.entry.panel.title || rt.name } : null,
    config,
    logger: makeLogger(rt.name),
    events: {
      on(event, cb) {
        // Subscriptions go into the runtime dispatcher table (injected into the loader pipeline via
        // getEventDispatcherPlugin); abort on deactivate/unload unsubscribes. No second event bus.
        const hookName = event === 'new_entry' ? 'onNewEntry' : event === 'stream_chunk' ? 'onStreamChunk' : null;
        if (!hookName || typeof cb !== 'function') return () => {};
        const wrapper = (payload) => { if (!signal.aborted) cb(payload); };
        _eventSubs[hookName].add(wrapper);
        const unsubscribe = () => { _eventSubs[hookName].delete(wrapper); };
        if (signal.aborted) unsubscribe();
        else signal.addEventListener('abort', unsubscribe, { once: true });
        return unsubscribe;
      },
    },
    signal,
    isStopping: () => _stopping || rt.stopping || _ctx.isStopping(),
  };
}

// Events dispatcher: the subscription table lives in the runtime; getEventDispatcherPlugin()
// returns the plugin object that bridges into the loader hook pipeline (no second event bus).
const _eventDispatcher = {
  name: 'ccv-plugin-events',
  hooks: {
    onNewEntry(payload) { dispatchEvent('onNewEntry', payload); },
    onStreamChunk(payload) { dispatchEvent('onStreamChunk', payload); },
  },
};
const _eventSubs = { onNewEntry: new Set(), onStreamChunk: new Set() };
function dispatchEvent(hookName, payload) {
  for (const fn of _eventSubs[hookName]) {
    try { fn(payload); } catch (err) { reportSwallowed('plugin-runtime.event', err); }
  }
}
let _dispatcherRegistered = false;
export function getEventDispatcherPlugin() {
  _dispatcherRegistered = true;
  return _eventDispatcher;
}
export function isEventDispatcherRegistered() {
  return _dispatcherRegistered;
}

// Register the dispatcher into the loader hook pipeline (_plugins is rebuilt by every
// loadPlugins; the loader re-attaches it at the end of each scan). Call once on server start.
function ensureEventDispatcherRegistered() {
  registerEventDispatcherPlugin(_eventDispatcher);
  _dispatcherRegistered = true;
}

async function activateAll(generation, { graceMs = 0 } = {}) {
  const entries = getPluginEntries();
  const tasks = [];
  for (const entry of entries) {
    if (!entry.enabled || entry.loadError) continue;
    if (entry.shape !== 'dir') {
      // Single-file hook plugins may also implement activate/deactivate/onError
      if (entry.plugin && (typeof entry.plugin.activate === 'function')) {
        const rt = ensureRuntimePlugin(entry);
        tasks.push(activatePlugin(rt, generation));
      }
      continue;
    }
    // Only create a runtime for directory plugins with a service or a lifecycle (panel-only/
    // hook-only plugins must not carry a forever-pending runtime status)
    const hasLifecycle = entry.plugin && (
      typeof entry.plugin.activate === 'function' ||
      typeof entry.plugin.deactivate === 'function' ||
      typeof entry.plugin.onError === 'function'
    );
    if (!entry.service && !hasLifecycle) continue;
    const rt = ensureRuntimePlugin(entry);
    tasks.push(activatePlugin(rt, generation));
  }
  const all = Promise.allSettled(tasks);
  if (graceMs > 0) {
    // Start grace period: after the timeout keep going in the background without blocking the main service (unref timer)
    let timer;
    await Promise.race([all, new Promise(r => { timer = setTimeout(r, graceMs); timer.unref?.(); })]);
    clearTimeout(timer);
  } else {
    await all;
  }
}

function ensureRuntimePlugin(entry) {
  let rt = _plugins.get(entry.name);
  if (!rt) {
    rt = {
      name: entry.name,
      entry,
      status: emptyStatus(),
      child: null,
      agent: null,
      backoff: _runtimeDeps.createRestartBackoff(),
      stopping: false,
      activated: false,
      restartTimer: null,
      controller: null,
      dataDir: null,
      epoch: 0, // restart/exit race guard: start/stop bump it; callbacks capture and compare
    };
    _plugins.set(entry.name, rt);
  }
  rt.entry = entry;
  rt.stopping = false;
  return rt;
}

async function activatePlugin(rt, generation) {
  if (generation !== _generation || _stopping) return;
  try {
    // dataDir is created for every directory plugin (panel/hook-only plugins need persistent data too)
    if (rt.entry.shape === 'dir') {
      rt.dataDir = join(_ctx.logDir, 'plugin-data', rt.name);
      mkdirSync(rt.dataDir, { recursive: true, mode: 0o700 });
    }
    // Service plugin: spawn the child first, then activate
    if (rt.entry.service) {
      if (process.env.CCV_IM_PLATFORM) {
        rt.status.state = 'blocked';
        rt.status.lastError = 'skipped in IM worker process';
        return;
      }
      const ok = await startServicePlugin(rt, generation);
      if (!ok) return;
    }
    if (rt.entry.plugin && typeof rt.entry.plugin.activate === 'function') {
      const ctx = buildPluginContext(rt);
      rt.activated = true;
      await callLifecycle(rt, 'activate', [ctx], ACTIVATE_TIMEOUT_MS, 'activate');
    }
    // Lifecycle-only directory plugins have no service and no panel state to report;
    // mark them active instead of leaving a misleading forever-'pending' status.
    if (!rt.entry.service) rt.status.state = 'active';
  } catch (err) {
    notifyError(rt, err, { phase: 'activate' });
  }
}

export async function onServerStopping() {
  if (_stoppingPromise) return _stoppingPromise;
  _stopping = true;
  _stoppingPromise = (async () => {
    const generation = _generation;
    const tasks = [];
    for (const rt of _plugins.values()) {
      if (rt.activated || rt.child) {
        tasks.push(stopServicePlugin(rt, 'serverStopping'));
      }
    }
    await Promise.allSettled(tasks);
    _plugins.clear();
    _started = false;
    _generation = generation + 1;
  })();
  try {
    await _stoppingPromise;
  } finally {
    _stoppingPromise = null;
  }
}

/**
 * reload (the single-flight entry): deactivate everything -> stop children -> loadPlugins ->
 * spawn + activate. Degrades to a plain loadPlugins when the server is not started.
 * opts.reason: 'reload' (default) | 'disable' - disable is a semantic label only (disable
 * goes through preferences + reload; deactivate's reason should reflect user intent).
 */
export function reloadRuntime(opts = {}) {
  return enqueue(async () => {
    // Write operations must not enqueue during the shutdown teardown window.
    if (_stopping) return { ok: false, error: 'server is stopping', generation: _generation, started: _started, plugins: getRuntimePluginsInfo() };
    const reason = opts.reason === 'disable' ? 'disable' : 'reload';
    if (!_started) {
      const r = await loadPlugins(opts);
      return { ok: true, generation: r.generation, started: false, plugins: getRuntimePluginsInfo() };
    }
    const generation = _generation + 1;
    // 1) Stop the previous generation
    const stopTasks = [];
    for (const rt of _plugins.values()) {
      if (rt.activated || rt.child) {
        stopTasks.push(stopServicePlugin(rt, reason));
      }
    }
    await Promise.allSettled(stopTasks);
    _plugins.clear();
    _generation = generation;
    // 2) Re-scan/import (fingerprint cache-bust)
    await loadPlugins(opts);
    // 3) Activate the new generation
    await activateAll(generation);
    return { ok: true, generation: _generation, started: true, plugins: getRuntimePluginsInfo() };
  });
}

export function unloadPlugin(name, reason = 'delete') {
  return enqueue(async () => {
    if (_stopping) return { ok: false, error: 'server is stopping' };
    const rt = _plugins.get(name);
    if (!rt) return { ok: true, unloaded: false };
    await stopServicePlugin(rt, reason);
    _plugins.delete(name);
    return { ok: true, unloaded: true };
  });
}

export function restartPlugin(name) {
  return enqueue(async () => {
    // A restart accepted inside the stop window would spawn a child after the shutdown
    // sweep has already passed this runtime entry (orphan process + permanent lock).
    if (_stopping || !_started) return { ok: false, error: _stopping ? 'server is stopping' : 'plugin runtime is not started' };
    const rt = _plugins.get(name);
    if (!rt || !rt.entry?.service) return { ok: false, error: 'not a service plugin' };
    await stopServicePlugin(rt, 'restart');
    rt.stopping = false;
    rt.backoff.reset();
    const ok = await startServicePlugin(rt, _generation);
    if (!ok) return { ok: false, status: { ...rt.status } };
    // Re-run activate after restart: event subscriptions/signal/resources torn down in deactivate
    // must be rebuilt (otherwise restart only reboots the child and leaves a half-dead plugin context).
    if (rt.entry.plugin && typeof rt.entry.plugin.activate === 'function') {
      rt.activated = true;
      await callLifecycle(rt, 'activate', [buildPluginContext(rt)], ACTIVATE_TIMEOUT_MS, 'activate');
    }
    return { ok: true, status: { ...rt.status } };
  });
}

// ---- Status queries (read by routes) ----

export function getRuntimePluginsInfo() {
  const out = [];
  for (const rt of _plugins.values()) {
    out.push({
      name: rt.name,
      status: { ...rt.status },
      hasService: !!rt.entry?.service,
      hasPanel: !!rt.entry?.panel,
    });
  }
  return out;
}

export function getRuntimePluginStatus(name) {
  const rt = getRuntimePlugin(name);
  return rt ? { ...rt.status } : null;
}

export function isRuntimeStarted() {
  return _started;
}

export function isRuntimeStopping() {
  return _stopping;
}

export function getRuntimeContext() {
  return _ctx;
}

/**
 * Called by server.js after ptyApi/interactions are built: fills in ctx references (fields
 * are by-reference; they are null when buildPluginContext runs before enrichment).
 */
export function _enrichContext({ pty, interactions }) {
  if (!_ctx) return;
  if (pty !== undefined) _ctx.pty = pty;
  if (interactions !== undefined) _ctx.interactions = interactions;
}

// Test-only: reset all module state
export function _resetRuntimeForTest() {
  _plugins.clear();
  _tracker.destroyAll('*');
  _started = false;
  _stopping = false;
  _stoppingPromise = null;
  _generation = 0;
  _ctx = null;
  _queue = Promise.resolve();
  _runtimeDeps = { ...RUNTIME_DEP_DEFAULTS };
  for (const subs of Object.values(_eventSubs)) subs.clear();
  _dispatcherRegistered = false;
}
