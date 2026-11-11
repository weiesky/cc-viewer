import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { PACKAGE_JSON } from '../_paths.js';
import { getClaudeConfigDir } from '../../findcc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function detectHomebrewInstall(dirOverride, realpathImpl = realpathSync) {
  const dir = dirOverride || __dirname;
  let real;
  try { real = realpathImpl(dir); } catch { real = dir; }
  const normalized = real.replace(/\\/g, '/');
  const idx = normalized.indexOf('/Cellar/cc-viewer/');
  if (idx === -1) return null;
  const afterCellar = normalized.slice(idx + '/Cellar/cc-viewer/'.length);
  if (!/^\d[\w.\-+]*\//.test(afterCellar)) return null;
  return normalized.slice(0, idx);
}

export function detectPnpmGlobalInstall(dirOverride, realpathImpl = realpathSync) {
  const dir = dirOverride || __dirname;
  let real;
  try { real = realpathImpl(dir); } catch { real = dir; }
  const normalized = real.replace(/\\/g, '/');
  const marker = '/.pnpm/cc-viewer@';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  if (!/^\d[\w.\-+]*\//.test(normalized.slice(idx + marker.length))) return null;
  const globalIdx = normalized.indexOf('/global/');
  if (globalIdx !== -1) return normalized.slice(0, globalIdx);
  const preMarker = normalized.slice(0, idx);
  return preMarker.endsWith('/node_modules') ? preMarker.slice(0, -'/node_modules'.length) : preMarker;
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const CACHE_DIR = join(getClaudeConfigDir(), 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');
export const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/;

export function getCurrentVersion() {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')).version;
}

function parseVersion(ver) {
  const [major, minor, patch] = ver.split('.').map(Number);
  return { major, minor, patch };
}

export function isNewer(remote, current) {
  if (!STABLE_VERSION_RE.test(remote) || !STABLE_VERSION_RE.test(current)) return false;
  const r = parseVersion(remote);
  const c = parseVersion(current);
  if (r.major !== c.major) return r.major > c.major;
  if (r.minor !== c.minor) return r.minor > c.minor;
  return r.patch > c.patch;
}

function isAutoUpdateEnabled() {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return false;
  try {
    if (!existsSync(CC_SETTINGS_FILE)) return true;
    if (JSON.parse(readFileSync(CC_SETTINGS_FILE, 'utf-8')).autoUpdates === false) return false;
  } catch { }
  return true;
}

function shouldCheck() {
  try {
    if (!existsSync(CACHE_FILE)) return true;
    return Date.now() - JSON.parse(readFileSync(CACHE_FILE, 'utf-8')).lastCheck > CHECK_INTERVAL;
  } catch { return true; }
}

function saveCheckTime() {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));
  } catch { }
}

export function isAnyCcvBusy({ currentPid, busy, portRange, lsofImpl } = {}) {
  if (busy) return true;
  const [start, end] = Array.isArray(portRange) && portRange.length === 2 ? portRange : [7008, 7099];
  const pid = typeof currentPid === 'number' ? currentPid : process.pid;
  const runLsof = lsofImpl || ((cmd) => execSync(cmd, { timeout: 2000, encoding: 'utf-8', windowsHide: true }));
  try {
    const out = String(runLsof(`lsof -iTCP:${start}-${end} -sTCP:LISTEN -P -n -Fp`));
    return out.replace(/\r/g, '').split('\n').filter(l => /^p\d+$/.test(l))
      .map(l => Number(l.slice(1))).filter(n => n > 0 && n !== pid).length > 0;
  } catch { return false; }
}

// A check never installs. Only an explicit, user-confirmed update job may do so.
export async function checkAndUpdate(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const currentVersion = getCurrentVersion();
  if (!isAutoUpdateEnabled()) return { status: 'disabled', currentVersion, remoteVersion: null };
  if (!options.force && !shouldCheck()) return { status: 'skipped', currentVersion, remoteVersion: null };
  if ((process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') && !options.fetchImpl) {
    return { status: 'skipped_test_context', currentVersion, remoteVersion: null };
  }
  try {
    const res = await fetchImpl('https://registry.npmjs.org/cc-viewer/latest', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const remoteVersion = data.version || data['dist-tags']?.latest;
    if (!STABLE_VERSION_RE.test(remoteVersion || '')) return { status: 'error', currentVersion, remoteVersion: null, error: 'No version found' };
    saveCheckTime();
    if (!isNewer(remoteVersion, currentVersion)) return { status: 'latest', currentVersion, remoteVersion };
    const brewPrefix = options.brewPrefix !== undefined ? options.brewPrefix : detectHomebrewInstall();
    const pnpmRoot = options.pnpmRoot !== undefined ? options.pnpmRoot : detectPnpmGlobalInstall();
    if (process.versions.electron) return { status: 'electron_managed', currentVersion, remoteVersion };
    if (brewPrefix) return { status: 'brew_managed', currentVersion, remoteVersion, brewPrefix };
    if (pnpmRoot) return { status: 'pnpm_managed', currentVersion, remoteVersion, pnpmRoot };
    if (!options.interactive && parseVersion(remoteVersion).major !== parseVersion(currentVersion).major) return { status: 'major_available', currentVersion, remoteVersion };
    if (!options.interactive && (options.busy === true || isAnyCcvBusy({ currentPid: process.pid, busy: false, portRange: options.portRange, lsofImpl: options.lsofImpl }))) {
      return { status: 'deferred_busy', currentVersion, remoteVersion };
    }
    return { status: 'available', currentVersion, remoteVersion, release: data };
  } catch (err) {
    saveCheckTime();
    return { status: 'error', currentVersion, remoteVersion: null, error: err.message };
  }
}
