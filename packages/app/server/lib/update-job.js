import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn, execFile, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PACKAGE_ROOT } from '../_paths.js';
import { getClaudeConfigDir, buildNpmRootCommand, parseNpmRootOutput } from '../../findcc.js';
import { checkAndUpdate, detectHomebrewInstall, detectPnpmGlobalInstall, STABLE_VERSION_RE, isNewer, getCurrentVersion } from './updater.js';
import { reportSwallowed } from './error-report.js';
import { withFileLockAsync } from './async-file-lock.js';
import { isPidAlive } from './pid-alive.js';

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
export const UPDATE_STATE_FILE = join(getClaudeConfigDir(), 'cc-viewer', 'update-state.json');
const npmRoot = () => new Promise((resolveRoot, reject) => {
  const { cmd, args, windowsVerbatimArguments } = buildNpmRootCommand();
  execFile(cmd, args, { encoding: 'utf8', timeout: 10000, windowsHide: true, windowsVerbatimArguments }, (err, stdout) => {
    if (err) { reject(Object.assign(new Error('Unable to resolve the npm global directory'), { code: 'npm_unavailable' })); return; }
    const root = parseNpmRootOutput(stdout);
    if (!root) reject(Object.assign(new Error('Unable to resolve the npm global directory'), { code: 'npm_unavailable' }));
    else resolveRoot(root);
  });
});

function isStableRelease(release, version) {
  const url = typeof release?.dist?.tarball === 'string' ? new URL(release.dist.tarball) : null;
  return release?.version === version && STABLE_VERSION_RE.test(version)
    && url?.protocol === 'https:' && url.hostname === 'registry.npmjs.org'
    && Boolean(release.dist.integrity || release.dist.shasum);
}

export async function resolveNpmInstallRoot({ rootImpl = npmRoot, packageRoot = PACKAGE_ROOT, detectImpl = () => detectHomebrewInstall() || detectPnpmGlobalInstall() } = {}) {
  if (process.versions.electron) throw Object.assign(new Error('Electron uses its installer'), { code: 'unsupported_channel' });
  if (detectImpl()) throw Object.assign(new Error('Use the package manager that installed cc-viewer'), { code: 'unsupported_channel' });
  const [actualRoot, actualPackage] = await Promise.all([realpath(await rootImpl()), realpath(packageRoot)]);
  if (actualPackage !== resolve(actualRoot, 'cc-viewer')) {
    throw Object.assign(new Error('This is not a direct npm global installation'), { code: 'unsupported_layout' });
  }
  return actualRoot;
}

export function buildNpmInstallCommand(tarballPath, { platform = process.platform, env = process.env, root } = {}) {
  const quote = (s) => `"${String(s).replaceAll('"', '""')}"`;
  const args = ['install', '-g', tarballPath, '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'];
  if (root) args.push(`--prefix=${platform === 'win32' ? resolve(root, '..') : resolve(root, '..', '..')}`);
  if (platform === 'win32') {
    return { cmd: env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${['npm', ...args].map(quote).join(' ')}"`], options: { windowsHide: true, windowsVerbatimArguments: true } };
  }
  return { cmd: 'npm', args, options: { windowsHide: true } };
}

export function verifyDigest(buffer, dist) {
  if (dist?.integrity) {
    const [algorithm, expected] = dist.integrity.split('-');
    if (['sha256', 'sha384', 'sha512'].includes(algorithm) && /^[A-Za-z0-9+/]+={0,2}$/.test(expected || '')) {
      if (createHash(algorithm).update(buffer).digest('base64') === expected) return true;
    }
    return false;
  }
  if (/^[a-f0-9]{40}$/i.test(dist?.shasum || '')) return createHash('sha1').update(buffer).digest('hex') === dist.shasum.toLowerCase();
  return false;
}

export async function downloadRelease({ release, directory, fetchImpl = fetch, onProgress = () => {}, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  if (!isStableRelease(release, release?.version)) throw Object.assign(new Error('Invalid package download metadata'), { code: 'invalid_release' });
  const url = release.dist.tarball;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `cc-viewer-${randomUUID()}.tgz`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let outputError;
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || null;
    let downloaded = 0;
    const output = createWriteStream(file, { mode: 0o600 });
    output.on('error', (err) => { outputError = err; });
    try {
      for await (const chunk of response.body) {
        if (outputError) throw outputError;
        downloaded += chunk.length;
        if (!output.write(chunk)) await once(output, 'drain');
        onProgress({ downloaded, total });
      }
      output.end();
      await once(output, 'finish');
    } catch (err) {
      output.destroy();
      throw err;
    }
    if (!verifyDigest(await readFile(file), release.dist)) throw Object.assign(new Error('Package integrity check failed'), { code: 'integrity_mismatch' });
    return file;
  } finally { clearTimeout(timeout); }
}

export function runInstallProcess(command, { spawnImpl = spawn, timeoutMs = INSTALL_TIMEOUT_MS, onLog = () => {}, killTreeImpl } = {}) {
  return new Promise((resolvePromise, reject) => {
    let child;
    try { child = spawnImpl(command.cmd, command.args, { ...command.options, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) { reject(err); return; }
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (killTreeImpl) killTreeImpl(child);
        else if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 2000, windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch (err) { reportSwallowed('update-job.kill', err); try { child.kill('SIGKILL'); } catch { } }
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (err) => finish(reject, err));
    child.stdout?.on('data', (buf) => onLog(String(buf).slice(-4000)));
    child.stderr?.on('data', (buf) => onLog(String(buf).slice(-4000)));
    child.on('close', (code, signal) => {
      if (timedOut) { finish(reject, Object.assign(new Error('Installation timed out'), { code: 'install_timeout' })); return; }
      if (code === 0) finish(resolvePromise);
      else finish(reject, Object.assign(new Error(`npm install failed (${code ?? signal})`), { code: 'install_failed' }));
    });
  });
}

export async function installStagedUpdate(config, { installImpl = runInstallProcess, log = console.error, stateFile = UPDATE_STATE_FILE, ownerPid } = {}) {
  const file = config?.tarballPath;
  if (!file || typeof config.root !== 'string' || !STABLE_VERSION_RE.test(config.version || '')) throw new Error('Invalid staged update');
  const root = await realpath(config.root);
  const filePath = await realpath(file);
  if (dirname(filePath) !== await realpath(dirname(stateFile))) throw new Error('Staged package is outside the update directory');
  if (ownerPid !== undefined && config.pid !== ownerPid && isPidAlive(config.pid)) throw new Error('Staged update belongs to a different live process');
  if (!isNewer(config.version, getCurrentVersion())) throw new Error('Staged update is not newer than the installed version');
  const command = buildNpmInstallCommand(filePath, { root });
  let logTail = '';
  await withFileLockAsync(join(dirname(stateFile), 'update-install.lock'), async () => {
    try {
      if (!verifyDigest(await readFile(filePath), config.dist)) throw new Error('Staged package integrity check failed');
      await installImpl(command, { onLog: (text) => { logTail = (logTail + text).slice(-12000); } });
      const installed = JSON.parse(await readFile(join(root, 'cc-viewer', 'package.json'), 'utf8'));
      if (installed.version !== config.version || !(await stat(join(root, 'cc-viewer', 'cli.js'))).isFile()) throw new Error('Installed version could not be verified');
    } catch (err) {
      err.message = `${err.message}${logTail ? `\n${logTail}` : ''}`;
      throw err;
    }
  }, { ensureDir: dirname(stateFile), deadline: INSTALL_TIMEOUT_MS + 30000 });
  log(`[CC Viewer] Installed v${config.version}`);
}

export class UpdateJob {
  constructor(options = {}) {
    this.options = options;
    this.listeners = new Set();
    this.lastBroadcastAt = 0;
    this.state = { status: 'idle', currentVersion: null, version: null, downloaded: 0, total: null, error: null, updatedAt: Date.now() };
    if (!options.disableRestore) {
      try {
        const pending = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf8'));
        if (pending.status === 'failed' && pending.error) this.state = { ...this.state, status: 'error', error: pending.error, version: pending.version || null };
        else if (pending.status !== 'completed' && pending.status !== 'installing' && STABLE_VERSION_RE.test(pending.version || '') && pending.tarballPath && pending.root && isNewer(pending.version, getCurrentVersion())) this.state = { ...this.state, status: 'restart_required', version: pending.version };
      } catch { /* No staged update exists. */ }
    }
  }
  getState() { const { release, log, ...state } = this.state; return state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  setState(patch) { this.state = { ...this.state, ...patch, updatedAt: Date.now() }; for (const listener of this.listeners) { try { listener(this.getState()); } catch (err) { reportSwallowed('update-job.listener', err); } } }
  async check() {
    if (['checking', 'downloading', 'installing', 'restarting', 'restart_required'].includes(this.state.status)) return this.getState();
    this.setState({ status: 'checking', error: null, version: null, release: null });
    try {
      const result = await (this.options.checkImpl || checkAndUpdate)({ force: true, interactive: true });
      const release = result.release || null;
      if (result.status === 'error') throw new Error(result.error);
      if (result.status === 'disabled') throw Object.assign(new Error('Update checks are disabled by Claude settings'), { code: 'disabled' });
      this.setState({ status: result.status, currentVersion: result.currentVersion, version: result.status === 'latest' ? null : result.remoteVersion, release, error: null, checkedAt: Date.now() });
    } catch (err) { this.setState({ status: 'error', error: err.message, errorCode: err.code || 'check_failed', version: null, release: null }); }
    return this.getState();
  }
  async restart(handler) {
    if (this.state.status === 'restarting') return this.getState();
    if (this.state.status !== 'restart_required') throw new Error('No verified update is ready');
    this.setState({ status: 'restarting' });
    try { await handler(this.state.version); }
    catch (err) { this.setState({ status: 'restart_required', error: err.message }); throw err; }
  }
  async start() {
    if (['checking', 'downloading', 'installing', 'restarting', 'restart_required'].includes(this.state.status)) return this.getState();
    if (!this.state.version || !this.state.release) {
      const state = await this.check();
      if (state.status !== 'available') return state;
    }
    let { version, release } = this.state;
    if (!isStableRelease(release, version)) {
      const state = await this.check();
      if (state.status !== 'available') return state;
      ({ version, release } = this.state);
      if (!isStableRelease(release, version)) return this.getState();
    }
    this.setState({ status: 'downloading', error: null, downloaded: 0, total: null });
    const directory = dirname(UPDATE_STATE_FILE);
    let file;
    try {
      const root = await (this.options.resolveRootImpl || resolveNpmInstallRoot)();
      const actualRoot = await realpath(root);
      await withFileLockAsync(join(dirname(UPDATE_STATE_FILE), 'update-install.lock'), async () => {
        file = await (this.options.downloadImpl || downloadRelease)({ release, directory, fetchImpl: this.options.fetchImpl, onProgress: (p) => {
        const now = Date.now();
        if (p.downloaded === p.total || now - this.lastBroadcastAt >= 100) {
          this.lastBroadcastAt = now;
          this.setState({ status: 'downloading', ...p });
        }
      } });
      await writeFile(UPDATE_STATE_FILE, JSON.stringify({ version, tarballPath: file, root: actualRoot, pid: process.pid, dist: release.dist }), { mode: 0o600 });
      this.setState({ status: 'restart_required', error: null, errorCode: null });
    }, { ensureDir: directory, deadline: DOWNLOAD_TIMEOUT_MS + 30000 });
    } catch (err) {
      await rm(file, { force: true }).catch((rmErr) => reportSwallowed('update-job.cleanup', rmErr));
      this.setState({ status: 'error', error: err.message, errorCode: err.code || 'update_failed' });
    }
    return this.getState();
  }
}
