import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// plugin-host.mjs is the child-process SDK; exercise it in a real child (reads CCV_PLUGIN_CONFIG,
// binds a port, writes a lock, handles signals). The spawned process is not detached and is
// killed at test end, so it does not trigger service-manager's detached long-running semantics.

let tmpRoot;
let child;
let lockPath;
let configPath;
const SECRET = 'test-secret-0123456789abcdef';
const NONCE = 'nonce-abc';

async function waitForLock(path, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { /* partial write */ }
    }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('lock file not written in time');
}

describe('plugin-host (real child process)', () => {
  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-phost-'));
    lockPath = join(tmpRoot, 'service.lock');
    configPath = join(tmpRoot, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'host-test',
      version: '0.1.0',
      prefix: '/plugins/host-test',
      pluginDir: tmpRoot,
      dataDir: tmpRoot,
      runtimeDir: tmpRoot,
      lockPath,
      secret: SECRET,
      nonce: NONCE,
      parentPid: process.pid,
      parentPort: null,
      parentBasePath: '',
    }));
    const entry = join(tmpRoot, 'svc-entry.mjs');
    writeFileSync(entry, `
      import { startPluginService } from ${JSON.stringify(new URL('../server/lib/plugin-host.mjs', import.meta.url).href)};
      const svc = await startPluginService({
        onRequest(req, res) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ path: req.url }));
        },
        health: () => ({ custom: 'yes', nonce: 'forged', ok: false }),
      });
    `);
    child = spawn(process.execPath, [entry], {
      env: { ...process.env, CCV_PLUGIN_CONFIG: configPath, CCV_PLUGIN_LOCK: lockPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', () => {});
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 3000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes lock, enforces secret, serves health with forced identity, handles requests', async () => {
    const lock = await waitForLock(lockPath);
    assert.equal(lock.name, 'host-test');
    assert.equal(lock.pid, child.pid);
    assert.equal(lock.nonce, NONCE);
    assert.ok(lock.port > 0);

    // No secret -> 401
    const r1 = await fetch(`http://127.0.0.1:${lock.port}/__ccv/health`);
    assert.equal(r1.status, 401);
    // Wrong secret -> 401
    const r2 = await fetch(`http://127.0.0.1:${lock.port}/__ccv/health`, { headers: { 'x-ccv-plugin-secret': 'wrong' } });
    assert.equal(r2.status, 401);
    // Correct secret -> 200 with forced identity fields (plugin nonce/ok overridden)
    const r3 = await fetch(`http://127.0.0.1:${lock.port}/__ccv/health`, { headers: { 'x-ccv-plugin-secret': SECRET } });
    assert.equal(r3.status, 200);
    const body = await r3.json();
    assert.equal(body.ok, true, '插件自定义 ok:false 必须被覆盖');
    assert.equal(body.nonce, NONCE, '插件自定义 nonce:forged 必须被覆盖');
    assert.equal(body.name, 'host-test');
    assert.equal(body.pid, child.pid);
    assert.equal(body.custom, 'yes', '自定义字段保留');

    // Business routes enforce the secret too
    const r4 = await fetch(`http://127.0.0.1:${lock.port}/hello?x=1`, { headers: { 'x-ccv-plugin-secret': SECRET } });
    assert.equal(r4.status, 200);
    const body4 = await r4.json();
    assert.equal(body4.path, '/hello?x=1');
    const r5 = await fetch(`http://127.0.0.1:${lock.port}/hello`);
    assert.equal(r5.status, 401);
  });

  it('removes lock and exits on SIGTERM', async () => {
    await waitForLock(lockPath);
    child.kill('SIGTERM');
    const [code] = await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 5000)).then(() => [null])]);
    assert.notEqual(code, null, 'child should exit after SIGTERM');
    assert.ok(!existsSync(lockPath), 'lock removed on graceful shutdown');
  });
});
