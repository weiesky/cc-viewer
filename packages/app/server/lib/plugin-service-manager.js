// Service-plugin child-process management (parent side).
// Spawns one detached child per (server process × service plugin): the child runs the
// plugin's service.mjs as its own HTTP server on 127.0.0.1:0, writes a lock file with
// its port, and the parent reverse-proxies /plugins/<name>/* to it (see plugin-proxy.js).
//
// Modeled on lib/im/im-process-manager.js: detached process group (group kill on stop),
// env prefix-stripping, lock-file handshake, liveness probing, test guard. Key
// differences: locks are per-server-PID (Electron runs several server processes over the
// same LOG_DIR, each gets its own plugin instance), identity includes a per-spawn nonce
// (prevents adopting a previous generation's child), and stale-lock cleanup verifies
// health identity before killing (a reused PID may belong to an unrelated process).
import { spawn as nodeSpawn, execSync, spawnSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { reportSwallowed } from './error-report.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLUGIN_HOST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'plugin-host.mjs');

/** Resolve the real node binary (under Electron, process.execPath is the Electron binary). */
export function resolveNodeBinary() {
  if (!process.versions.electron) return process.execPath;
  try {
    const out = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8', windowsHide: true });
    const p = process.platform === 'win32' ? out.split('\n')[0].trim() : out.trim();
    if (p) return p;
  } catch { /* fall through */ }
  // #129: packaged GUI environments may lack a shell PATH; fall back to Electron itself + ELECTRON_RUN_AS_NODE
  return null; // null -> spawn with process.execPath + ELECTRON_RUN_AS_NODE=1
}

export function serviceRuntimeDir(logDir, name) {
  return join(logDir, 'plugins-runtime', name);
}

export function serviceDataDir(logDir, name) {
  return join(logDir, 'plugin-data', name);
}

export function serviceLockPath(runtimeDir, serverPid) {
  return join(runtimeDir, `service-${serverPid}.lock`);
}

export function serviceConfigPath(runtimeDir, serverPid, generation) {
  return join(runtimeDir, `config-${serverPid}-${generation}.json`);
}

export function serviceLogPath(runtimeDir, serverPid) {
  return join(runtimeDir, `process-${serverPid}.log`);
}

// Inherited environment is an allowlist, not a denylist: ANTHROPIC_* / CCV_* secrets
// (auth tokens, passwords) must never reach a plugin child. /proc/<pid>/environ is
// readable by the same user, and argv/env leaks are not worth saving a config file read.
const CHILD_ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'TERM', 'SHELL', 'USER', 'LOGNAME',
  'HOSTNAME', 'NODE_ENV',
  // Windows user-profile dirs: Node's os.homedir() throws without USERPROFILE, and many
  // runtimes write caches under APPDATA/LOCALAPPDATA. None of these carry secrets.
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
]);

/**
 * Build the service child environment from an explicit allowlist.
 * Inherits only OS basics plus LC_* and CCV_PLUGIN_*; manifest.service.env is injected
 * explicitly below. The plugin secret/nonce live only in the 0600 config file.
 */
export function buildChildEnv({ name, version, pluginDir, configPath, lockPath, runtimeDir, dataDir, parentPort, parentBasePath, manifestEnv = {}, base = process.env }) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    const upper = k.toUpperCase();
    if (CHILD_ENV_ALLOWLIST.has(upper) || upper.startsWith('LC_') || k.startsWith('CCV_PLUGIN_')) {
      env[k] = v;
    }
  }
  env.CCV_PLUGIN_NAME = name;
  if (version) env.CCV_PLUGIN_VERSION = version;
  env.CCV_PLUGIN_DIR = pluginDir;
  env.CCV_PLUGIN_CONFIG = configPath;
  env.CCV_PLUGIN_HOST = pathToFileURL(PLUGIN_HOST_PATH).href; // file:// URL so Windows can import it too
  env.CCV_PLUGIN_LOCK = lockPath;
  env.CCV_PLUGIN_RUNTIME_DIR = runtimeDir;
  env.CCV_PLUGIN_DATA_DIR = dataDir;
  env.CCV_PLUGIN_PARENT_PORT = String(parentPort || '');
  env.CCV_PLUGIN_PARENT_BASE_PATH = parentBasePath || '';
  for (const [k, v] of Object.entries(manifestEnv)) {
    if (!k.startsWith('CCV_') && !k.startsWith('CCVIEWER_')) env[k] = v;
  }
  return env;
}

/**
 * Spawn one service child. Returns { pid, child, lockPath, configPath, outLog, secret, nonce }
 * or { blockedByTestGuard: true } (test guard).
 *
 * @param {object} desc  { name, version, entryPath, pluginDir, prefix, env }
 * @param {object} ctx   { logDir, parentPort, parentBasePath, generation, serverPid, bootNonce }
 * @param {object} opts  { spawnImpl?, nodeBinary? }  test injection points
 */
export function spawnServiceProcess(desc, ctx, opts = {}) {
  const runtimeDir = serviceRuntimeDir(ctx.logDir, desc.name);
  const serverPid = ctx.serverPid ?? process.pid;
  // ████████ test isolation guard (modeled on im-process-manager L4) ████████
  if (process.env.NODE_TEST_CONTEXT && !opts.spawnImpl && process.env.CCV_TEST_ALLOW_PLUGIN_SPAWN !== '1') {
    return { blockedByTestGuard: true, runtimeDir, pid: undefined };
  }
  // ████████████████████████████████████████████████████████████
  const spawnImpl = opts.spawnImpl || nodeSpawn;
  const dataDir = serviceDataDir(ctx.logDir, desc.name);
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const generation = ctx.generation ?? 1;
  const lockPath = serviceLockPath(runtimeDir, serverPid);
  const configPath = serviceConfigPath(runtimeDir, serverPid, generation);
  const outLog = serviceLogPath(runtimeDir, serverPid);
  const secret = randomBytes(24).toString('hex');
  const nonce = randomBytes(16).toString('hex');

  // 0600 config: the plugin secret/nonce live only here (atomic write). The parent
  // ACCESS_TOKEN is deliberately absent — loopback parent APIs need no token, and a
  // secret sitting in config (or a URL query) is needless exposure.
  const configBody = {
    name: desc.name,
    version: desc.version ?? null,
    prefix: desc.prefix,
    pluginDir: desc.pluginDir,
    dataDir,
    runtimeDir,
    lockPath,
    secret,
    nonce,
    generation,
    parentPid: serverPid,
    bootNonce: ctx.bootNonce ?? null, // lets cleanup detect a stale same-PID/different-boot lock
    parentPort: ctx.parentPort ?? null,
    parentBasePath: ctx.parentBasePath ?? '',
  };
  try {
    const tmpPath = `${configPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(configBody), { mode: 0o600 });
    renameSync(tmpPath, configPath);
  } catch (err) {
    reportSwallowed('plugin-service.config-write', err);
  }

  let stdio = 'ignore';
  let fd = null;
  try {
    fd = openSync(outLog, 'a');
    stdio = ['ignore', fd, fd];
  } catch { /* fall back to ignore when the log file cannot be opened */ }

  const nodeBinary = opts.nodeBinary !== undefined ? opts.nodeBinary : resolveNodeBinary();
  const spawnEnv = buildChildEnv({
    name: desc.name,
    version: desc.version,
    pluginDir: desc.pluginDir,
    configPath,
    lockPath,
    runtimeDir,
    dataDir,
    parentPort: ctx.parentPort,
    parentBasePath: ctx.parentBasePath,
    manifestEnv: desc.env,
  });
  let executable = nodeBinary || process.execPath;
  if (!nodeBinary && process.versions.electron) {
    // fall back to Electron itself as the node runtime
    spawnEnv.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete spawnEnv.ELECTRON_RUN_AS_NODE;
  }

  const child = spawnImpl(executable, [desc.entryPath], {
    cwd: desc.pluginDir,
    env: spawnEnv,
    stdio,
    detached: true,
    windowsHide: true,
  });
  // No unref: the parent must keep the event loop referenced while the child lives (detached
  // does not mean unsupervised; stopServiceProcess/process-group kill owns cleanup). unref
  // would let the parent exit while the child lives, and some runtimes harvest detached+unref children instantly (fake code=0 exit).
  if (fd !== null) { try { closeSync(fd); } catch { /* child already duped it */ } }
  return { pid: child?.pid, child, lockPath, configPath, outLog, secret, nonce, runtimeDir, dataDir };
}

export function readServiceLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * Wait for the child to become ready: poll lock (pid+name) -> GET /__ccv/health (secret + nonce).
 * @returns {{ ok:true, port, pid, lock } | { ok:false, error, state }}
 */
export async function waitForServiceReady(desc, opts = {}) {
  const lockPath = opts.lockPath;
  const secret = opts.secret;
  const nonce = opts.nonce;
  const expectedPid = opts.expectedPid;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pollMs = opts.pollMs ?? 50;
  const probe = opts.probeImpl || probeServiceHealth;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const lock = readServiceLock(lockPath);
    if (lock && lock.pid && lock.port && lock.name === desc.name) {
      if (expectedPid && lock.pid !== expectedPid) {
        // lock overwritten by another process/previous generation - keep waiting for ours
      } else {
        const health = await probe(lock.port, secret, { timeoutMs: 400 });
        if (health.ok && health.body && health.body.ok === true && health.body.name === desc.name) {
          if (nonce && health.body.nonce !== nonce) {
            return { ok: false, error: 'health nonce mismatch (stale or foreign service)', state: 'foreign' };
          }
          if (health.body.pid && health.body.pid !== lock.pid) {
            return { ok: false, error: 'health pid mismatch', state: 'foreign' };
          }
          return { ok: true, port: lock.port, pid: lock.pid, lock };
        }
        if (!health.ok && health.state === 'foreign') {
          return { ok: false, error: 'health identity mismatch', state: 'foreign' };
        }
      }
    }
    if (opts.isChildDead && opts.isChildDead()) {
      return { ok: false, error: 'child exited before becoming ready', state: 'dead' };
    }
    await sleep(pollMs);
  }
  return { ok: false, error: `service did not become ready within ${timeoutMs}ms`, state: 'timeout' };
}

/**
 * GET http://127.0.0.1:<port>/__ccv/health with secret header.
 * x-cc-viewer-internal:1 lets the interceptor's fetch patch pass through (otherwise loopback
 * requests are rewritten as API traffic to ANTHROPIC_BASE_URL - 2026-10-22 field incident:
 * in CLI mode every health probe hit the upstream and the service never became ready).
 * @returns {Promise<{ok:boolean, state?:string, body?:object}>}
 */
export async function probeServiceHealth(port, secret, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 400;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const res = await fetch(`http://127.0.0.1:${port}/__ccv/health`, {
      headers: { 'x-ccv-plugin-secret': secret, 'x-cc-viewer-internal': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) return { ok: false, state: 'foreign', body };
    return { ok: res.ok, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Default process-group kill (detached group leader); Windows uses taskkill /T /F; falls back to the single process. */
export function defaultKill(pid, signal) {
  if (process.platform === 'win32' && signal === 'SIGKILL') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 1000 });
      return;
    } catch { /* fall through */ }
  }
  try { process.kill(-pid, signal); return; } catch { /* not a group leader / windows */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
}

/**
 * Stop a service child: SIGTERM → poll for exit → SIGKILL on timeout → remove lock/config.
 *
 * A PID alone proves nothing — a crashed child's PID can be reused by an unrelated
 * process, and killing it would be catastrophic. Signal only when the lock file confirms
 * this exact PID (and, when both sides carry one, the same per-spawn nonce). Otherwise
 * remove the stale files and leave the process alone.
 */
export async function stopServiceProcess(name, opts = {}) {
  const lockPath = opts.lockPath;
  const configPath = opts.configPath;
  const kill = opts.killImpl || defaultKill;
  const isAlive = opts.isAlive || isPidAlive;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const pollMs = opts.pollMs ?? 100;

  const lock = lockPath ? readServiceLock(lockPath) : null;
  const pid = opts.pid ?? lock?.pid;
  const removeFiles = () => {
    for (const p of [lockPath, configPath]) {
      if (p) { try { unlinkSync(p); } catch { /* already gone */ } }
    }
  };
  const lockMatchesPid = !!lock && !!pid && lock.pid === pid;
  const nonceMatches = !opts.nonce || !lock?.nonce || lock.nonce === opts.nonce;
  if (!pid || !lockMatchesPid || !nonceMatches || !isAlive(pid)) {
    removeFiles();
    return { stopped: true, alreadyDead: !isAlive(pid), skippedSignal: !lockMatchesPid || !nonceMatches };
  }

  kill(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (!isAlive(pid)) {
      removeFiles();
      return { stopped: true };
    }
  }
  kill(pid, 'SIGKILL');
  await sleep(pollMs);
  removeFiles();
  return { stopped: true, forced: true };
}

/**
 * Clean stale locks at startup:
 * - parentPid dead: verify health identity first (kill only on nonce/pid match - the PID may be reused);
 * - parentPid === this process but bootNonce differs: same-PID reboot; the old child is orphaned, treat as above;
 * - parentPid alive and not this process: another cc-viewer instance's plugin, keep it.
 *
 * @param {string} logDir
 * @param {{ bootNonce:string, isAlive?:Function, killImpl?:Function }} opts
 */
export async function cleanupStaleServiceLocks(logDir, opts = {}) {
  const bootNonce = opts.bootNonce;
  const isAlive = opts.isAlive || isPidAlive;
  const kill = opts.killImpl || defaultKill;
  const runtimeRoot = join(logDir, 'plugins-runtime');
  let pluginDirs;
  try {
    pluginDirs = readdirSync(runtimeRoot, { withFileTypes: true });
  } catch {
    return { cleaned: 0, kept: 0 };
  }
  let cleaned = 0;
  let kept = 0;
  for (const dirent of pluginDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = join(runtimeRoot, dirent.name);
    let lockFiles;
    try {
      lockFiles = readdirSync(dir).filter(f => f.startsWith('service-') && f.endsWith('.lock'));
    } catch {
      continue;
    }
    for (const lockFile of lockFiles) {
      const lockPath = join(dir, lockFile);
      const lock = readServiceLock(lockPath);
      if (!lock || !lock.pid) {
        try { unlinkSync(lockPath); } catch { /* noop */ }
        continue;
      }
      const parentAlive = lock.parentPid && isAlive(lock.parentPid);
      const ownParent = lock.parentPid === process.pid;
      const bootMismatch = ownParent && bootNonce && lock.bootNonce && lock.bootNonce !== bootNonce;
      if (parentAlive && !bootMismatch) {
        kept++;
        continue;
      }
      // parent dead or boot mismatch: verify the child's identity before killing
      if (isAlive(lock.pid)) {
        let identityConfirmed = false;
        try {
          // pick the config with the same serverPid and highest numeric generation (lexical order puts -10 before -9)
          const lockServerPid = lockFile.slice('service-'.length, -'.lock'.length);
          const configFiles = readdirSync(dir)
            .filter(f => f.startsWith(`config-${lockServerPid}-`) && f.endsWith('.json'))
            .sort((a, b) => {
              const ga = Number(a.slice(`config-${lockServerPid}-`.length, -'.json'.length)) || 0;
              const gb = Number(b.slice(`config-${lockServerPid}-`.length, -'.json'.length)) || 0;
              return ga - gb;
            });
          const configPath = configFiles.length ? join(dir, configFiles[configFiles.length - 1]) : null;
          const config = configPath ? JSON.parse(readFileSync(configPath, 'utf-8')) : null;
          if (config && config.secret && lock.port) {
            const health = await probeServiceHealth(lock.port, config.secret, { timeoutMs: 400 });
            if (health.ok && health.body && health.body.pid === lock.pid) {
              identityConfirmed = true;
            }
          }
        } catch (err) {
          reportSwallowed('plugin-service.stale-probe', err);
        }
        if (!identityConfirmed) {
          // identity unconfirmed - the PID may be unrelated; clear the lock without killing
          kept++;
          try { unlinkSync(lockPath); } catch { /* noop */ }
          continue;
        }
        kill(lock.pid, 'SIGTERM');
        await sleep(300);
        if (isAlive(lock.pid)) kill(lock.pid, 'SIGKILL');
      }
      try { unlinkSync(lockPath); } catch { /* noop */ }
      // also clear configs for older generations of this serverPid (aborted startups and
      // previous generations can leave them behind; crash cleanup removes the current one)
      try {
        const lockServerPid = lockFile.slice('service-'.length, -'.lock'.length);
        for (const f of readdirSync(dir)) {
          if (f.startsWith(`config-${lockServerPid}-`) && f.endsWith('.json')) {
            try { unlinkSync(join(dir, f)); } catch { /* noop */ }
          }
        }
      } catch { /* noop */ }
      cleaned++;
    }
  }
  return { cleaned, kept };
}

/**
 * Restart backoff: at most 5 restarts per 60s window; the counter resets after 60s of stable uptime.
 */
export function createRestartBackoff(opts = {}) {
  const delays = opts.delays || [0, 500, 1000, 2000, 5000];
  const windowMs = opts.windowMs ?? 60000;
  const stableMs = opts.stableMs ?? 60000;
  let crashes = [];
  let lastStartAt = 0;
  return {
    markStarted() {
      const now = Date.now();
      if (lastStartAt && now - lastStartAt >= stableMs) crashes = [];
      lastStartAt = now;
    },
    /** @returns {{ allowed:boolean, delayMs:number }} */
    next() {
      const now = Date.now();
      crashes = crashes.filter(t => now - t < windowMs);
      if (crashes.length >= delays.length) return { allowed: false, delayMs: 0 };
      const delayMs = delays[crashes.length];
      crashes.push(now);
      return { allowed: true, delayMs };
    },
    reset() { crashes = []; },
    get crashCount() { return crashes.length; },
  };
}

export { PLUGIN_HOST_PATH };
