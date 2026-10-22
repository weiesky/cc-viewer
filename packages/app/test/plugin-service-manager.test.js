import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import {
  buildChildEnv,
  spawnServiceProcess,
  waitForServiceReady,
  stopServiceProcess,
  cleanupStaleServiceLocks,
  createRestartBackoff,
  serviceRuntimeDir,
  serviceDataDir,
  serviceLockPath,
} from '../server/lib/plugin-service-manager.js';

let tmpRoot;
function setup() {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-psm-'));
}
function teardown() {
  rmSync(tmpRoot, { recursive: true, force: true });
}

const desc = {
  name: 'hello-service',
  version: '1.0.0',
  entryPath: '/plugins/hello-service/service.mjs',
  pluginDir: '/plugins/hello-service',
  prefix: '/plugins/hello-service',
  env: { MODE: 'demo', CCV_EVIL: 'no' },
};

// ─── buildChildEnv ───

describe('buildChildEnv', () => {
  it('inherits only the OS allowlist (never secrets or CCV_/CCVIEWER_ vars)', () => {
    const base = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      LANG: 'en_US.UTF-8',
      LC_CTYPE: 'UTF-8',
      TERM: 'xterm-256color',
      CCV_PASSWORD: 'secret',
      CCV_LOG_DIR: '/logs',
      CCVIEWER_X: '1',
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    };
    const env = buildChildEnv({
      name: 'n', version: '1', pluginDir: '/p', configPath: '/c', lockPath: '/l',
      runtimeDir: '/r', dataDir: '/d', parentPort: 7008, parentBasePath: '',
      manifestEnv: { MODE: 'demo', CCV_EVIL: 'no' },
      base,
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.HOME, '/home/x');
    assert.equal(env.LANG, 'en_US.UTF-8');
    assert.equal(env.LC_CTYPE, 'UTF-8');
    assert.equal(env.TERM, 'xterm-256color');
    assert.equal(env.ANTHROPIC_API_KEY, undefined, 'secrets are not inherited');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined, 'auth tokens are not inherited');
    assert.equal(env.CCV_PASSWORD, undefined);
    assert.equal(env.CCVIEWER_X, undefined);
    assert.equal(env.CCV_LOG_DIR, undefined, 'log paths are not inherited');
    assert.equal(env.CCV_PLUGIN_NAME, 'n');
    assert.equal(env.CCV_PLUGIN_PARENT_PORT, '7008');
    assert.equal(env.MODE, 'demo');
    assert.equal(env.CCV_EVIL, undefined, 'manifest env cannot set reserved prefixes');
    assert.ok(env.CCV_PLUGIN_HOST.startsWith('file://'), 'host must be a file:// URL (Windows import safety)');
    assert.ok(!('CCV_PLUGIN_SECRET' in env), 'secret never enters env');
  });

  it('inherits Windows user-profile variables so os.homedir() works in children', () => {
    const base = {
      USERPROFILE: 'C:\\Users\\x',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\x',
      APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
      PROGRAMDATA: 'C:\\ProgramData',
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      SECRET_SAUCE: 'nope',
    };
    const env = buildChildEnv({
      name: 'n', version: '1', pluginDir: '/p', configPath: '/c', lockPath: '/l',
      runtimeDir: '/r', dataDir: '/d', parentPort: 1, parentBasePath: '',
      base,
    });
    assert.equal(env.USERPROFILE, 'C:\\Users\\x');
    assert.equal(env.HOMEDRIVE, 'C:');
    assert.equal(env.HOMEPATH, '\\Users\\x');
    assert.equal(env.APPDATA, 'C:\\Users\\x\\AppData\\Roaming');
    assert.equal(env.LOCALAPPDATA, 'C:\\Users\\x\\AppData\\Local');
    assert.equal(env.PROGRAMDATA, 'C:\\ProgramData');
    assert.equal(env.PROGRAMFILES, 'C:\\Program Files');
    assert.equal(env['PROGRAMFILES(X86)'], 'C:\\Program Files (x86)');
    assert.equal(env.SECRET_SAUCE, undefined, 'non-allowlisted vars stay out');
  });

  it('inherits CCV_PLUGIN_* from the parent environment', () => {
    const env = buildChildEnv({
      name: 'n', version: '1', pluginDir: '/p', configPath: '/c', lockPath: '/l',
      runtimeDir: '/r', dataDir: '/d', parentPort: 1, parentBasePath: '',
      base: { PATH: '/bin', CCV_PLUGIN_EXTRA: 'yes' },
    });
    assert.equal(env.CCV_PLUGIN_EXTRA, 'yes');
    assert.equal(env.CCV_PLUGIN_NAME, 'n');
  });
});

// --- spawnServiceProcess (fake spawn injected) ---

describe('spawnServiceProcess', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('blocked by test guard without CCV_TEST_ALLOW_PLUGIN_SPAWN', () => {
    const r = spawnServiceProcess(desc, { logDir: tmpRoot, serverPid: 1234 });
    assert.equal(r.blockedByTestGuard, true);
    assert.equal(r.pid, undefined);
  });

  it('spawns detached child with file stdio and writes 0600 config', () => {
    const calls = [];
    const fakeChild = new EventEmitter();
    fakeChild.pid = 4321;
    fakeChild.unref = () => {};
    const spawnImpl = (...args) => { calls.push(args); return fakeChild; };
    const r = spawnServiceProcess(desc, {
      logDir: tmpRoot, serverPid: 1234, parentPort: 7008, generation: 7,
    }, { spawnImpl });
    assert.equal(r.pid, 4321);
    const [executable, argv, opts] = calls[0];
    assert.deepEqual(argv, [desc.entryPath]);
    assert.equal(opts.cwd, desc.pluginDir);
    assert.equal(opts.detached, true);
    assert.equal(opts.windowsHide, true);
    assert.ok(Array.isArray(opts.stdio), 'stdio 应写文件不 pipe');
    assert.equal(opts.env.CCV_PLUGIN_NAME, 'hello-service');
    assert.ok(executable, 'node binary resolved');

    const config = JSON.parse(readFileSync(r.configPath, 'utf-8'));
    assert.equal(config.name, 'hello-service');
    assert.equal(config.generation, 7);
    assert.equal(config.parentPid, 1234);
    assert.ok(config.secret && config.nonce, 'secret/nonce live only in the config file');
    assert.ok(!('parentToken' in config), 'parent ACCESS_TOKEN must never be written to config');
    assert.equal(opts.env.CCV_PLUGIN_SECRET, undefined);
    assert.equal(opts.env.CCV_PLUGIN_PARENT_TOKEN, undefined);

    const stat = readFileSync(r.configPath);
    assert.ok(stat.length > 0);
    if (process.platform !== 'win32') {
      // The config carries the plugin secret: its mode must actually be 0600.
      assert.equal(statSync(r.configPath).mode & 0o777, 0o600, 'config must be 0600');
    }
    const runtimeFiles = readdirSync(r.runtimeDir);
    assert.deepEqual(runtimeFiles.filter(f => f.includes('.tmp-')), [], 'no atomic-write temp residue');
    assert.ok(existsSync(r.outLog), 'child stdio log file exists');
    assert.ok(existsSync(serviceDataDir(tmpRoot, desc.name)));
  });
});

// --- waitForServiceReady (fake probe injected) ---

describe('waitForServiceReady', () => {
  beforeEach(setup);
  afterEach(teardown);

  function writeLock(name, overrides = {}) {
    const runtimeDir = serviceRuntimeDir(tmpRoot, name);
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    writeFileSync(lockPath, JSON.stringify({
      pid: 4321, port: 19001, parentPid: 1234, name, nonce: 'n1', ...overrides,
    }));
    return lockPath;
  }

  it('ready when lock+health identity match', async () => {
    const lockPath = writeLock('hello-service');
    const r = await waitForServiceReady(desc, {
      lockPath, secret: 's', nonce: 'n1', expectedPid: 4321,
      probeImpl: async () => ({ ok: true, body: { ok: true, name: 'hello-service', pid: 4321, nonce: 'n1' } }),
      timeoutMs: 500, pollMs: 10,
    });
    assert.equal(r.ok, true);
    assert.equal(r.port, 19001);
  });

  it('fails on nonce mismatch (stale/foreign service)', async () => {
    const lockPath = writeLock('hello-service');
    const r = await waitForServiceReady(desc, {
      lockPath, secret: 's', nonce: 'n2',
      probeImpl: async () => ({ ok: true, body: { ok: true, name: 'hello-service', pid: 4321, nonce: 'n1' } }),
      timeoutMs: 500, pollMs: 10,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /nonce/);
  });

  it('times out when health never passes', async () => {
    const lockPath = writeLock('hello-service');
    const r = await waitForServiceReady(desc, {
      lockPath, secret: 's',
      probeImpl: async () => ({ ok: false, error: 'ECONNREFUSED' }),
      timeoutMs: 120, pollMs: 10,
    });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'timeout');
  });

  it('detects child exit during boot', async () => {
    const lockPath = serviceLockPath(serviceRuntimeDir(tmpRoot, 'hello-service'), 1234);
    const r = await waitForServiceReady(desc, {
      lockPath, secret: 's', isChildDead: () => true,
      probeImpl: async () => ({ ok: false }),
      timeoutMs: 1000, pollMs: 10,
    });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'dead');
  });
});

// --- stopServiceProcess (fake kill/isAlive injected) ---

describe('stopServiceProcess', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('SIGTERM → poll → exits cleanly', async () => {
    const runtimeDir = serviceRuntimeDir(tmpRoot, 'hello-service');
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    writeFileSync(lockPath, JSON.stringify({ pid: 4321, port: 1, name: 'hello-service' }));
    const configPath = join(runtimeDir, 'config-1234-1.json');
    writeFileSync(configPath, '{}');

    const signals = [];
    let aliveChecks = 0;
    const r = await stopServiceProcess('hello-service', {
      lockPath, configPath,
      killImpl: (pid, sig) => signals.push(sig),
      isAlive: () => (++aliveChecks <= 2),
      timeoutMs: 1000, pollMs: 5,
    });
    assert.equal(r.stopped, true);
    assert.equal(r.forced, undefined);
    assert.deepEqual(signals, ['SIGTERM']);
    assert.ok(!existsSync(lockPath), 'lock removed');
    assert.ok(!existsSync(configPath), 'config removed');
  });

  it('escalates to SIGKILL on timeout', async () => {
    const runtimeDir = serviceRuntimeDir(tmpRoot, 'hello-service');
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    writeFileSync(lockPath, JSON.stringify({ pid: 4321, port: 1, name: 'hello-service' }));
    const signals = [];
    const r = await stopServiceProcess('hello-service', {
      lockPath,
      pid: 4321,
      killImpl: (pid, sig) => signals.push(sig),
      isAlive: () => true,
      timeoutMs: 30, pollMs: 5,
    });
    assert.equal(r.forced, true);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  });

  it('never signals a PID the lock does not own; only clears files', async () => {
    const runtimeDir = serviceRuntimeDir(tmpRoot, 'hello-service');
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    const configPath = join(runtimeDir, 'config-1234-1.json');
    // Lock belongs to pid 1111; caller passes a stale/reused pid 2222.
    writeFileSync(lockPath, JSON.stringify({ pid: 1111, port: 1, name: 'hello-service', nonce: 'n-old' }));
    writeFileSync(configPath, '{}');
    const signals = [];
    const r = await stopServiceProcess('hello-service', {
      lockPath, configPath, pid: 2222,
      killImpl: (pid, sig) => signals.push([pid, sig]),
      isAlive: () => true,
      timeoutMs: 20, pollMs: 5,
    });
    assert.deepEqual(signals, [], 'mismatched PID must not be signalled');
    assert.equal(r.skippedSignal, true);
    assert.ok(!existsSync(lockPath), 'lock cleared');
    assert.ok(!existsSync(configPath), 'config cleared');
  });

  it('never signals when no lock file proves ownership', async () => {
    const runtimeDir = serviceRuntimeDir(tmpRoot, 'hello-service');
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    const configPath = join(runtimeDir, 'config-1234-1.json');
    writeFileSync(configPath, '{}');
    const signals = [];
    await stopServiceProcess('hello-service', {
      lockPath, configPath, pid: 2222,
      killImpl: (pid, sig) => signals.push([pid, sig]),
      isAlive: () => true,
    });
    assert.deepEqual(signals, []);
    assert.ok(!existsSync(configPath));
  });

  it('never signals when the lock nonce belongs to another generation', async () => {
    const runtimeDir = serviceRuntimeDir(tmpRoot, 'hello-service');
    mkdirSync(runtimeDir, { recursive: true });
    const lockPath = serviceLockPath(runtimeDir, 1234);
    writeFileSync(lockPath, JSON.stringify({ pid: 4321, port: 1, name: 'hello-service', nonce: 'n-old' }));
    const signals = [];
    await stopServiceProcess('hello-service', {
      lockPath, pid: 4321, nonce: 'n-new',
      killImpl: (pid, sig) => signals.push([pid, sig]),
      isAlive: () => true,
    });
    assert.deepEqual(signals, []);
  });
});

// ─── cleanupStaleServiceLocks ───

describe('cleanupStaleServiceLocks', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('keeps locks whose parent is alive; cleans dead-parent locks with identity check', async () => {
    const root = join(tmpRoot, 'plugins-runtime', 'svc');
    mkdirSync(root, { recursive: true });
    // Lock A: parent alive (not this process) -> keep
    writeFileSync(join(root, 'service-9999.lock'), JSON.stringify({
      pid: 5001, port: 19002, parentPid: 9999, name: 'svc', nonce: 'a',
    }));
    // Lock B: parent dead -> child dead too -> clear
    writeFileSync(join(root, 'service-8888.lock'), JSON.stringify({
      pid: 5002, port: 19003, parentPid: 8888, name: 'svc', nonce: 'b',
    }));
    const alive = new Set([9999]);
    const r = await cleanupStaleServiceLocks(tmpRoot, {
      bootNonce: 'boot1',
      isAlive: (pid) => alive.has(pid),
    });
    assert.equal(r.kept >= 1, true);
    assert.equal(r.cleaned >= 1, true);
    assert.ok(existsSync(join(root, 'service-9999.lock')));
    assert.ok(!existsSync(join(root, 'service-8888.lock')));
  });

  it('treats same-PID-different-bootNonce lock as stale; never kills unconfirmed PID', async () => {
    const root = join(tmpRoot, 'plugins-runtime', 'svc');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `service-${process.pid}.lock`), JSON.stringify({
      pid: 999999, port: 19004, parentPid: process.pid, name: 'svc', nonce: 'x', bootNonce: 'old-boot',
    }));
    const killed = [];
    const r = await cleanupStaleServiceLocks(tmpRoot, {
      bootNonce: 'new-boot',
      isAlive: () => true,
      killImpl: (pid, sig) => killed.push([pid, sig]),
    });
    // Identity unconfirmed (no config/health) -> do not kill, clear the lock only
    assert.deepEqual(killed, []);
    assert.ok(!existsSync(join(root, `service-${process.pid}.lock`)));
  });
});

// ─── createRestartBackoff ───

describe('createRestartBackoff', () => {
  it('allows up to 5 restarts in 60s with growing delays', () => {
    const b = createRestartBackoff();
    const delays = [];
    for (let i = 0; i < 6; i++) {
      const r = b.next();
      if (!r.allowed) { delays.push('denied'); break; }
      delays.push(r.delayMs);
    }
    assert.deepEqual(delays, [0, 500, 1000, 2000, 5000, 'denied']);
  });

  it('resets crash count after stable run', async () => {
    const b = createRestartBackoff({ stableMs: 20 });
    b.markStarted();
    b.next();
    assert.equal(b.crashCount, 1);
    await new Promise(r => setTimeout(r, 30));
    b.markStarted();
    b.next();
    assert.equal(b.crashCount, 1, '稳定运行后计数清零');
  });
});
