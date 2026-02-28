import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { t } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_DIR = join(homedir(), '.claude', 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
  return pkg.version;
}

function parseVersion(ver) {
  const [major, minor, patch] = ver.split('.').map(Number);
  return { major, minor, patch };
}

function isNewer(remote, current) {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  if (r.major !== c.major) return r.major > c.major;
  if (r.minor !== c.minor) return r.minor > c.minor;
  return r.patch > c.patch;
}

// 读取 Claude Code 全局配置，判断是否允许自更新
function isAutoUpdateEnabled() {
  // 环境变量禁用
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return false;

  try {
    if (!existsSync(CC_SETTINGS_FILE)) return true; // 默认启用
    const settings = JSON.parse(readFileSync(CC_SETTINGS_FILE, 'utf-8'));
    // Claude Code 用 autoUpdates: false 显式禁用
    if (settings.autoUpdates === false) return false;
  } catch { }

  return true; // 默认启用
}

function shouldCheck() {
  try {
    if (!existsSync(CACHE_FILE)) return true;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return Date.now() - data.lastCheck > CHECK_INTERVAL;
  } catch {
    return true;
  }
}

function saveCheckTime() {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));
  } catch { }
}

export async function checkAndUpdate() {
  const currentVersion = getCurrentVersion();

  // 跟随 Claude Code 全局配置
  if (!isAutoUpdateEnabled()) {
    return { status: 'disabled', currentVersion, remoteVersion: null };
  }

  if (!shouldCheck()) {
    return { status: 'skipped', currentVersion, remoteVersion: null };
  }

  try {
    const res = await fetch('https://registry.npmjs.org/cc-viewer');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const remoteVersion = data['dist-tags']?.latest;

    saveCheckTime();

    if (!remoteVersion) {
      return { status: 'error', currentVersion, remoteVersion: null, error: 'No version found' };
    }

    if (!isNewer(remoteVersion, currentVersion)) {
      return { status: 'latest', currentVersion, remoteVersion };
    }

    const remote = parseVersion(remoteVersion);
    const current = parseVersion(currentVersion);

    // 跨大版本：仅提示
    if (remote.major !== current.major) {
      console.error(`[CC Viewer] ${t('update.majorAvailable', { version: remoteVersion })}`);
      return { status: 'major_available', currentVersion, remoteVersion };
    }

    // 同大版本：自动更新
    console.error(`[CC Viewer] ${t('update.updating', { version: remoteVersion })}`);
    try {
      execSync(`npm install -g cc-viewer@${remoteVersion}`, { stdio: 'pipe', timeout: 60000 });
      console.error(`[CC Viewer] ${t('update.completed', { version: remoteVersion })}`);
      return { status: 'updated', currentVersion, remoteVersion };
    } catch (err) {
      console.error(`[CC Viewer] ${t('update.failed', { error: err.message })}`);
      return { status: 'error', currentVersion, remoteVersion, error: err.message };
    }
  } catch (err) {
    saveCheckTime();
    return { status: 'error', currentVersion, remoteVersion: null, error: err.message };
  }
}
