import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runRestartHelper } from '../server/lib/restart-helper.js';
import { launchRestart, restartFromHelper, waitForExit } from '../server/lib/restart.js';
import { RESTART_CONFIG_FILE, RESTART_READY_FILE } from '../server/lib/update-job.js';
import { getCurrentVersion } from '../server/lib/updater.js';

// Hygiene: the restart code reads/writes the CCV_ACCESS_TOKEN handoff env — clear any
// ambient value so the spawn-env assertions below are deterministic.
delete process.env.CCV_ACCESS_TOKEN;

const VERSION = getCurrentVersion().split('.').map(Number).map((part, i) => i === 2 ? part + 1 : part).join('.');
const VALID_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('restart process', () => {
  it('launches a Node helper with validated original arguments and working directory', async (t) => {
    const child = spawn(process.execPath, ['-e', `import { readFileSync, writeFileSync } from 'node:fs'; const config = JSON.parse(readFileSync(process.argv[1], 'utf8')); writeFileSync(${JSON.stringify(RESTART_READY_FILE)}, JSON.stringify({ token: config.token }));`, RESTART_CONFIG_FILE]);
    t.after(() => { child.kill(); return Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })]); });
    const args = ['--no-open', '-c'];
    const result = await launchRestart({ args, cwd: '/tmp/project', version: VERSION, cliPath: '/tmp/cli.js', accessToken: VALID_TOKEN, spawnImpl: () => child });
    assert.equal(result, child);
    const config = JSON.parse(await readFile(RESTART_CONFIG_FILE, 'utf8'));
    assert.deepEqual(config.args, args);
    assert.equal(config.cwd, '/tmp/project');
    assert.equal(config.cliPath, '/tmp/cli.js');
    assert.equal(config.accessToken, VALID_TOKEN, 'a valid accessToken must be written into the config');
    assert.ok(config.token && config.token !== VALID_TOKEN, 'the readiness handshake token stays a separate UUID');
    if (process.platform !== 'win32') {
      assert.equal((await stat(RESTART_CONFIG_FILE)).mode & 0o777, 0o600, 'config holds the live token → must be mode 0600');
    }
    await assert.rejects(() => launchRestart({ version: 'invalid' }), /Invalid restart configuration/);
  });
  it('rejects helper startup failures without shutting down the old service', async (t) => {
    t.after(() => Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })]));
    const spawnImpl = () => spawn(process.execPath, ['-e', 'process.exit(3)']);
    await assert.rejects(() => launchRestart({ args: [], cwd: '/tmp', version: VERSION, cliPath: '/tmp/cli.js', accessToken: VALID_TOKEN, spawnImpl }), /exited before it was ready/);
    await assert.rejects(() => launchRestart({ args: [], cwd: '/tmp', version: VERSION, cliPath: '/tmp/cli.js', accessToken: VALID_TOKEN, spawnImpl: () => spawn('/definitely/missing-node') }), /ENOENT/);
    // A failed launch must not leave the config (now carrying the live token) behind.
    await assert.rejects(() => readFile(RESTART_CONFIG_FILE), { code: 'ENOENT' });
    await assert.rejects(() => readFile(RESTART_READY_FILE), { code: 'ENOENT' });
  });
  it('omits a malformed accessToken from the written config', async (t) => {
    const child = spawn(process.execPath, ['-e', `import { readFileSync, writeFileSync } from 'node:fs'; const config = JSON.parse(readFileSync(process.argv[1], 'utf8')); writeFileSync(${JSON.stringify(RESTART_READY_FILE)}, JSON.stringify({ token: config.token }));`, RESTART_CONFIG_FILE]);
    t.after(() => { child.kill(); return Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })]); });
    await launchRestart({ args: [], cwd: '/tmp', version: VERSION, cliPath: '/tmp/cli.js', accessToken: 'NOT-A-TOKEN', spawnImpl: () => child });
    const config = JSON.parse(await readFile(RESTART_CONFIG_FILE, 'utf8'));
    assert.equal('accessToken' in config, false, 'a malformed accessToken must be dropped, never written');
  });
  it('waits for the old process to die before starting the replacement', async () => {
    const calls = [];
    const result = await restartFromHelper({ pid: 123, cliPath: '/tmp/cli.js', cwd: '/tmp/project', args: ['--no-open'] }, {
      wait: async () => calls.push('wait'),
      spawnImpl: (...args) => { calls.push(args); return { once(name, fn) { if (name === 'exit') queueMicrotask(() => fn(0)); } }; },
    });
    assert.equal(result, 0);
    assert.equal(calls[0], 'wait');
    assert.equal(calls[1][1][0], '/tmp/cli.js');
    assert.equal(calls[1][2].cwd, '/tmp/project');
    assert.equal(calls[1][2].env.CCV_NO_OPEN, '1');
    assert.equal('CCV_ACCESS_TOKEN' in calls[1][2].env, false, 'no accessToken in config → no handoff env');
  });
  it('forwards a valid accessToken to the replacement env', async () => {
    const calls = [];
    await restartFromHelper({ pid: 123, cliPath: '/tmp/cli.js', cwd: '/tmp/project', args: [], accessToken: VALID_TOKEN }, {
      wait: async () => {},
      spawnImpl: (...args) => { calls.push(args); return { once(name, fn) { if (name === 'exit') queueMicrotask(() => fn(0)); } }; },
    });
    assert.equal(calls[0][2].env.CCV_ACCESS_TOKEN, VALID_TOKEN, 'a valid config accessToken must reach the child env');
    assert.equal(calls[0][2].env.CCV_NO_OPEN, '1');
  });
  it('has a bounded wait and handles missing executables', async () => {
    await assert.rejects(() => waitForExit(1, { alive: () => true, sleep: async () => {}, timeoutMs: -1 }), /Timed out/);
    await assert.rejects(() => restartFromHelper({ pid: 1, cliPath: '/tmp/cli.js', cwd: '/tmp', args: [] }, { wait: async () => {}, spawnImpl: () => ({ once(name, fn) { if (name === 'error') queueMicrotask(() => fn(new Error('ENOENT'))); } }) }), /ENOENT/);
  });
  it('runs the helper workflow with a fake CLI, restoring cwd/argv and exit code', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'result.json');
    const cli = join(dir, 'fake-cli.js');
    const state = join(dir, 'update-state.json');
    const tarball = join(dir, 'pending.tgz');
    await writeFile(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) })); process.exit(7);`);
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: VERSION, tarballPath: tarball, root: dir, pid: 99999999 }));
    const code = await runRestartHelper({ stateFile: state, config: { pid: 99999999, version: VERSION, cwd: dir, cliPath: cli, args: ['--no-open', 'argument with spaces'] }, install: async (staged) => { assert.equal(staged.version, VERSION); }, log: () => {} });
    assert.equal(code, 7);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.args[1], 'argument with spaces');
    assert.equal(result.cwd, await realpath(dir));
    await assert.rejects(() => readFile(state), { code: 'ENOENT' });
    await assert.rejects(() => readFile(tarball), { code: 'ENOENT' });
  });
  it('erases restart-config.json before the replacement starts, then forwards its token end-to-end', async (t) => {
    // Production path: config comes from the FILE (readRestartConfig), so this one test
    // proves file read + erasure-before-spawn + env forwarding together. The fake CLI
    // reports both the inherited env token and whether the config file still exists at
    // spawn time. Never assert inside the restart/install callbacks — runRestartHelper
    // wraps them in a broad try/catch that would swallow a failing assertion.
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-e2e-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'result.json');
    const cli = join(dir, 'fake-cli.js');
    const state = join(dir, 'update-state.json');
    const configFile = join(dir, 'restart-config.json');
    const tarball = join(dir, 'pending.tgz');
    await writeFile(cli, `import { writeFileSync, existsSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ token: process.env.CCV_ACCESS_TOKEN || null, configExists: existsSync(${JSON.stringify(configFile)}) })); process.exit(0);`);
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: VERSION, tarballPath: tarball, root: dir, pid: 99999999 }));
    // Include the readiness `token` field so the fixture matches the real config shape.
    await writeFile(configFile, JSON.stringify({ pid: 99999999, version: VERSION, cwd: dir, cliPath: cli, args: [], token: 'uuid-fixture', accessToken: VALID_TOKEN }));
    t.after(() => rm(RESTART_READY_FILE, { force: true }));
    // Probe the erasure timing across the whole helper flow: the config (holding the live
    // token) must be gone the moment it is read into memory — before install AND before the
    // replacement spawn. Captured into a local, asserted after the call (never inside a
    // SUT-caught callback). A regression moving the rm to just before restart() would still
    // pass the spawn-time check but is caught here at install time.
    let configGoneBeforeInstall = null;
    const code = await runRestartHelper({
      stateFile: state,
      configFile,
      install: async () => { configGoneBeforeInstall = await readFile(configFile).then(() => false, () => true); },
      log: () => {},
    });
    assert.equal(code, 0, 'helper must exit with the replacement code');
    assert.equal(configGoneBeforeInstall, true, 'config must be erased before install (the live-token window)');
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.token, VALID_TOKEN, 'the replacement must receive the config accessToken via CCV_ACCESS_TOKEN');
    assert.equal(result.configExists, false, 'the live-token config file must be erased before the replacement starts');
    await assert.rejects(() => readFile(configFile), { code: 'ENOENT' });
  });
  it('forwards a valid config accessToken via an in-memory config (no configFile)', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-env-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'result.json');
    const cli = join(dir, 'fake-cli.js');
    const state = join(dir, 'update-state.json');
    const tarball = join(dir, 'pending.tgz');
    await writeFile(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ token: process.env.CCV_ACCESS_TOKEN || null })); process.exit(0);`);
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: VERSION, tarballPath: tarball, root: dir, pid: 99999999 }));
    const code = await runRestartHelper({ stateFile: state, config: { pid: 99999999, version: VERSION, cwd: dir, cliPath: cli, args: [], accessToken: VALID_TOKEN }, install: async () => {}, log: () => {} });
    assert.equal(code, 0);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.token, VALID_TOKEN, 'the replacement must receive the config accessToken via CCV_ACCESS_TOKEN');
  });
  it('strips a stale ambient CCV_ACCESS_TOKEN when the config carries none', async (t) => {
    // Exercises restartFromHelper's `else delete env[ACCESS_TOKEN_ENV]` defense branch:
    // the helper's own env must not leak a stale handoff into the replacement. The
    // module-top `delete process.env.CCV_ACCESS_TOKEN` makes this unobservable unless a
    // test deliberately re-sets it here (and restores after).
    process.env.CCV_ACCESS_TOKEN = VALID_TOKEN;
    t.after(() => { delete process.env.CCV_ACCESS_TOKEN; });
    const calls = [];
    await restartFromHelper({ pid: 123, cliPath: '/tmp/cli.js', cwd: '/tmp', args: [] }, {
      wait: async () => {},
      spawnImpl: (...args) => { calls.push(args); return { once(name, fn) { if (name === 'exit') queueMicrotask(() => fn(0)); } }; },
    });
    assert.equal('CCV_ACCESS_TOKEN' in calls[0][2].env, false, 'no config token → stale ambient handoff must be purged');
  });
  it('records an install failure before restoring the previous CLI (token still forwarded via in-memory config)', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-failed-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'result.json');
    const cli = join(dir, 'fake-cli.js');
    const state = join(dir, 'update-state.json');
    const tarball = join(dir, 'pending.tgz');
    // The config file is erased before install, so the in-memory `config` is the ONLY carrier
    // of the accessToken into the restore spawn. A regression that re-reads the file on the
    // failure path (or drops the field) would break token preservation exactly when an update
    // fails — and return 1, skipping the restart. The fake CLI records the inherited env.
    await writeFile(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ token: process.env.CCV_ACCESS_TOKEN || null })); process.exit(7);`);
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: VERSION, tarballPath: tarball, root: dir, pid: 99999999 }));
    const code = await runRestartHelper({ stateFile: state, config: { pid: 99999999, version: VERSION, cwd: dir, cliPath: cli, args: [], accessToken: VALID_TOKEN }, install: async () => { throw new Error('npm install failed (1)'); }, log: () => {} });
    assert.equal(code, 7, 'restore spawn must propagate the previous CLI exit code');
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.token, VALID_TOKEN, 'the restore spawn must still receive the accessToken from the in-memory config');
    const failed = JSON.parse(await readFile(state, 'utf8'));
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /npm install failed/);
    assert.equal(failed.version, VERSION);
    await assert.rejects(() => readFile(tarball), { code: 'ENOENT' });
  });
});
