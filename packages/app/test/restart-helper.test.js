import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { launchRestart, restartFromHelper, RESTART_HELPER_PATH as helperPath, waitForExit } from '../server/lib/restart.js';

describe('restart process', () => {
  it('launches a Node helper with validated original arguments and working directory', () => {
    let call;
    launchRestart({ args: ['--no-open', '-c'], cwd: '/tmp/project', version: '1.9.25', cliPath: '/tmp/cli.js', spawnImpl: (...args) => { call = args; return { unref() {}, on() {} }; } });
    const config = JSON.parse(call[1][2]);
    assert.equal(call[0], process.execPath);
    assert.equal(call[1][0], helperPath);
    assert.deepEqual(config.args, ['--no-open', '-c']);
    assert.equal(config.cwd, '/tmp/project');
    assert.equal(call[2].detached, true);
    assert.throws(() => launchRestart({ version: 'invalid' }));
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
  it('runs the real helper with a fake CLI, restoring cwd/argv and exit code', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'ccv-restart-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const output = join(dir, 'result.json');
    const cli = join(dir, 'fake-cli.js');
    await writeFile(cli, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) })); process.exit(7);`);
    await mkdir(join(dir, 'cc-viewer'));
    await writeFile(join(dir, 'cc-viewer', 'package.json'), JSON.stringify({ version: '1.9.25' }));
    await writeFile(join(dir, 'cc-viewer', 'cli.js'), '#!/usr/bin/env node\n');
    const state = join(dir, 'cc-viewer', 'update-state.json');
    const tarball = join(dir, 'cc-viewer', 'pending.tgz');
    await mkdir(join(dir, 'cc-viewer'), { recursive: true });
    await writeFile(tarball, 'package');
    await writeFile(state, JSON.stringify({ version: '1.9.25', tarballPath: tarball, root: dir, pid: 99999999, dist: { shasum: createHash('sha1').update('package').digest('hex') } }));
    const binDir = join(dir, 'bin');
    await mkdir(binDir);
    const npmLog = join(dir, 'npm-args.txt');
    await writeFile(join(binDir, 'npm'), `#!/bin/sh\nprintf '%s' "$@" > ${JSON.stringify(npmLog)}\n`);
    await chmod(join(binDir, 'npm'), 0o755);
    const child = spawn(process.execPath, [helperPath, state, JSON.stringify({ pid: 99999999, version: '1.9.25', cwd: dir, cliPath: cli, args: ['--no-open', 'argument with spaces'] })], { stdio: 'inherit', env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, NODE_ENV: 'test' } });
    const [code] = await once(child, 'exit');
    assert.equal(code, 7, 'the helper installs the staged file and launches the replacement CLI');
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.args[1], 'argument with spaces');
    assert.equal(result.cwd, await realpath(dir));
  });
});
