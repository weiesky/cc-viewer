import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const testConfigDir = await mkdtemp(join(tmpdir(), 'ccv-update-config-'));
process.env.CLAUDE_CONFIG_DIR = testConfigDir;
import { createHash, randomUUID } from 'node:crypto';
import { UpdateJob, buildNpmInstallCommand, downloadRelease, resolveNpmInstallRoot, verifyDigest, runInstallProcess, installStagedUpdate, UPDATE_STATE_FILE } from '../server/lib/update-job.js';

const VERSION = '1.9.25';
function release(content) {
  return { version: VERSION, dist: { tarball: 'https://registry.npmjs.org/cc-viewer/-/cc-viewer-1.9.25.tgz', integrity: `sha512-${createHash('sha512').update(content).digest('base64')}` } };
}
function response(content, total = true) {
  return { ok: true, status: 200, headers: { get: () => total ? String(content.length) : null }, body: (async function* () { yield content.subarray(0, 2); yield content.subarray(2); })() };
}
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ccv-update-job-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return await realpath(dir);
}
async function fakeRoot(t) {
  const root = await temp(t);
  await mkdir(join(root, 'cc-viewer'));
  await writeFile(join(root, 'cc-viewer', 'package.json'), JSON.stringify({ version: VERSION }));
  await writeFile(join(root, 'cc-viewer', 'cli.js'), '#!/usr/bin/env node\n');
  return root;
}

describe('update-job release verification', () => {
  it('verifies supported registry digests and rejects a mismatch', () => {
    const content = Buffer.from('package');
    assert.equal(verifyDigest(content, release(content).dist), true);
    assert.equal(verifyDigest(content, release(Buffer.from('other')).dist), false);
    assert.equal(verifyDigest(content, {}), false);
    assert.equal(verifyDigest(content, { integrity: 'sha1-abc' }), false);
  });
  it('streams real byte progress, supports unknown lengths, and verifies the file', async (t) => {
    const content = Buffer.from('package-content');
    const progress = [];
    const dir = await temp(t);
    const file = await downloadRelease({ release: release(content), directory: dir, fetchImpl: async () => response(content), onProgress: (p) => progress.push(p) });
    assert.equal(await readFile(file, 'utf8'), content.toString());
    assert.deepEqual(progress.at(-1), { downloaded: content.length, total: content.length });
    await assert.rejects(() => downloadRelease({ release: release(Buffer.from('bad')), directory: dir, fetchImpl: async () => response(content) }), { code: 'integrity_mismatch' });
    const noLength = await downloadRelease({ release: release(content), directory: dir, fetchImpl: async () => response(content, false) });
    assert.equal(await readFile(noLength, 'utf8'), content.toString());
  });
  it('rejects non-registry URLs before opening a file', async () => {
    await assert.rejects(() => downloadRelease({ release: { dist: { tarball: 'https://example.com/a.tgz' } }, directory: join(tmpdir(), randomUUID()) }), { code: 'invalid_release' });
  });
  it('uses fixed argv on POSIX and a literal command string on Windows', () => {
    const posix = buildNpmInstallCommand('/tmp/pkg.tgz', { platform: 'darwin' });
    assert.equal(posix.cmd, 'npm');
    assert.ok(posix.args.includes('/tmp/pkg.tgz'));
    assert.equal(posix.options.shell, undefined);
    const win = buildNpmInstallCommand('C:\\tmp\\a b\\pkg.tgz', { platform: 'win32', env: {} });
    assert.equal(win.cmd, 'cmd.exe');
    assert.equal(win.args[3].startsWith('""npm" "install"'), true);
    assert.equal(win.args[3].endsWith('"'), true);
    assert.equal(win.options.windowsVerbatimArguments, true);
  });
  it('only permits a package rooted in the active npm global directory', async (t) => {
    const root = await fakeRoot(t);
    assert.equal(await resolveNpmInstallRoot({ rootImpl: () => root, packageRoot: join(root, 'cc-viewer') }), await realpath(root));
    await assert.rejects(() => resolveNpmInstallRoot({ rootImpl: () => root, packageRoot: tmpdir() }), { code: 'unsupported_layout' });
  });
});

describe('UpdateJob state machine', () => {
  it('checks, reports byte progress and stages a verified download without mutating the live package', async (t) => {
    const content = Buffer.from('package');
    const root = await fakeRoot(t);
    const progress = [];
    const job = new UpdateJob({ disableRestore: true,
      checkImpl: async () => ({ status: 'available', currentVersion: '1.9.24', remoteVersion: VERSION, release: release(content) }),
      resolveRootImpl: async () => root,
      tempDir: await temp(t),
      downloadImpl: async ({ directory, onProgress }) => { await mkdir(directory, { recursive: true }); onProgress({ downloaded: 3, total: 7 }); await new Promise(resolve => setTimeout(resolve, 20)); onProgress({ downloaded: 7, total: 7 }); return join(directory, 'pkg.tgz'); },
      runProcessImpl: async () => {},
    });
    job.subscribe(s => progress.push(s.status));
    assert.equal((await job.check()).status, 'available');
    const concurrent = job.start();
    while (job.getState().status !== 'downloading') await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal((await job.start()).status, 'downloading');
    assert.equal((await concurrent).status, 'restart_required');
    assert.ok(!progress.includes('installing'));
    const staged = JSON.parse(await readFile(UPDATE_STATE_FILE, 'utf8'));
    assert.equal(staged.version, VERSION);
    assert.equal(staged.root, await realpath(root));
    assert.equal(job.getState().version, VERSION);
  });
  it('locks before asynchronous preparation and rejects duplicate starts', async (t) => {
    let resolveRoot;
    const pendingRoot = new Promise(resolve => { resolveRoot = resolve; });
    const job = new UpdateJob({ disableRestore: true, resolveRootImpl: () => pendingRoot, downloadImpl: async () => { const file = join(dirname(UPDATE_STATE_FILE), 'pending.tgz'); await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'package'); return file; }, runProcessImpl: async () => {} });
    job.setState({ status: 'available', version: VERSION, release: release(Buffer.from('x')) });
    const first = job.start();
    assert.equal((await job.start()).status, 'downloading');
    assert.equal(job.getState().status, 'downloading');
    const root = await fakeRoot(t);
    job.options.verifyRoot = join(root, 'cc-viewer');
    resolveRoot(root);
    assert.equal((await first).status, 'restart_required');
  });
  it('does not accept an npm exit alone as a successful update', async (t) => {
    const root = await fakeRoot(t);
    const file = join(dirname(UPDATE_STATE_FILE), 'test.tgz');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'package');
    await writeFile(join(root, 'cc-viewer', 'package.json'), JSON.stringify({ version: '1.9.24' }));
    await assert.rejects(() => installStagedUpdate({ version: VERSION, tarballPath: file, root, dist: { shasum: createHash('sha1').update('package').digest('hex') } }, { installImpl: async () => {} }), /Installed version could not be verified/);
  });
  it('restores a pending update but does not resurrect a completed one', async () => {
    const file = join(dirname(UPDATE_STATE_FILE), 'restore.tgz');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'package');
    await writeFile(UPDATE_STATE_FILE, JSON.stringify({ version: VERSION, tarballPath: file, root: dirname(file) }));
    assert.equal(new UpdateJob().getState().status, 'restart_required');
    await writeFile(UPDATE_STATE_FILE, JSON.stringify({ status: 'completed', version: VERSION }));
    assert.equal(new UpdateJob().getState().status, 'idle');
  });
  it('runs a real child and captures exit status, output, and timeouts', async () => {
    let log = '';
    await assert.rejects(() => runInstallProcess({ cmd: process.execPath, args: ['-e', 'process.stderr.write("diagnostic"); process.exit(9)'], options: {} }, { onLog: (text) => { log += text; } }), /npm install failed \(9\)/);
    assert.ok(log.includes('diagnostic'));
    let killed = false;
    await assert.rejects(() => runInstallProcess({ cmd: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], options: {} }, { timeoutMs: 20, killTreeImpl: (child) => { killed = true; child.kill('SIGKILL'); } }), /Installation timed out/);
    assert.equal(killed, true);
  });
  it('clears stale release metadata when a recheck finds no update', async () => {
    let result = { status: 'available', remoteVersion: VERSION, release: release(Buffer.from('x')) };
    const job = new UpdateJob({ disableRestore: true, checkImpl: async () => result });
    await job.check();
    result = { status: 'latest', remoteVersion: VERSION };
    await job.check();
    assert.equal(job.getState().status, 'latest');
    assert.equal(job.getState().version, null);
    assert.equal((await job.start()).status, 'latest');
  });
  it('exposes failures as retryable state and supports retry', async (t) => {
    const root = await fakeRoot(t);
    let attempts = 0;
    const job = new UpdateJob({ disableRestore: true, checkImpl: async () => ({ status: 'available', remoteVersion: VERSION, release: release(Buffer.from('x')) }), resolveRootImpl: async () => root, verifyRoot: join(root, 'cc-viewer'), downloadImpl: async () => { attempts++; throw new Error('offline'); } });
    await job.check();
    assert.equal((await job.start()).status, 'error');
    job.options.downloadImpl = async () => '/tmp/pkg.tgz';
    job.options.runProcessImpl = async () => {};
    assert.equal((await job.start()).status, 'restart_required');
    assert.equal(attempts, 1);
  });
});
