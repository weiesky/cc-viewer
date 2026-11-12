import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runRestartHelper } from '../server/lib/restart-helper.js';
import { launchRestart, restartFromHelper, waitForExit } from '../server/lib/restart.js';
import { RESTART_CONFIG_FILE, RESTART_READY_FILE } from '../server/lib/update-job.js';
import { getCurrentVersion } from '../server/lib/updater.js';

const VERSION = getCurrentVersion().split('.').map(Number).map((part, i) => i === 2 ? part + 1 : part).join('.');

describe('restart process', () => {
  it('launches a Node helper with validated original arguments and working directory', async (t) => {
    const child = spawn(process.execPath, ['-e', `import { readFileSync, writeFileSync } from 'node:fs'; const config = JSON.parse(readFileSync(process.argv[1], 'utf8')); writeFileSync(${JSON.stringify(RESTART_READY_FILE)}, JSON.stringify({ token: config.token }));`, RESTART_CONFIG_FILE]);
    t.after(() => { child.kill(); return Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })]); });
    const args = ['--no-open', '-c'];
    const result = await launchRestart({ args, cwd: '/tmp/project', version: VERSION, cliPath: '/tmp/cli.js', spawnImpl: () => child });
    assert.equal(result, child);
    const config = JSON.parse(await readFile(RESTART_CONFIG_FILE, 'utf8'));
    assert.deepEqual(config.args, args);
    assert.equal(config.cwd, '/tmp/project');
    assert.equal(config.cliPath, '/tmp/cli.js');
    await assert.rejects(() => launchRestart({ version: 'invalid' }), /Invalid restart configuration/);
  });
  it('rejects helper startup failures without shutting down the old service', async (t) => {
    t.after(() => Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })]));
    const spawnImpl = () => spawn(process.execPath, ['-e', 'process.exit(3)']);
    await assert.rejects(() => launchRestart({ args: [], cwd: '/tmp', version: VERSION, cliPath: '/tmp/cli.js', spawnImpl }), /exited before it was ready/);
    await assert.rejects(() => launchRestart({ args: [], cwd: '/tmp', version: VERSION, cliPath: '/tmp/cli.js', spawnImpl: () => spawn('/definitely/missing-node') }), /ENOENT/);
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
  it('records an install failure before restoring the previous CLI', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-failed-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const cli = join(dir, 'fake-cli.js');
    const state = join(dir, 'update-state.json');
    const tarball = join(dir, 'pending.tgz');
    await writeFile(cli, 'process.exit(7);');
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: VERSION, tarballPath: tarball, root: dir, pid: 99999999 }));
    const code = await runRestartHelper({ stateFile: state, config: { pid: 99999999, version: VERSION, cwd: dir, cliPath: cli, args: [] }, install: async () => { throw new Error('npm install failed (1)'); }, log: () => {} });
    assert.equal(code, 7);
    const failed = JSON.parse(await readFile(state, 'utf8'));
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /npm install failed/);
    assert.equal(failed.version, VERSION);
    await assert.rejects(() => readFile(tarball), { code: 'ENOENT' });
  });
});
