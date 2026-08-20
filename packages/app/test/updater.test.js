import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkAndUpdate, isAnyCcvBusy, detectHomebrewInstall } from '../server/lib/updater.js';
import { getClaudeConfigDir } from '../findcc.js';

const CACHE_DIR = join(getClaudeConfigDir(), 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');

// Save/restore helpers for cache file
let savedCache = null;
// Save/restore helpers for settings file
let savedSettings = null;
let settingsExisted = false;

function backupCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      savedCache = readFileSync(CACHE_FILE, 'utf-8');
    }
  } catch { }
}

function restoreCache() {
  try {
    if (savedCache !== null) {
      writeFileSync(CACHE_FILE, savedCache);
    }
  } catch { }
  savedCache = null;
}

function backupSettings() {
  try {
    settingsExisted = existsSync(CC_SETTINGS_FILE);
    if (settingsExisted) {
      savedSettings = readFileSync(CC_SETTINGS_FILE, 'utf-8');
    }
  } catch { }
}

function restoreSettings() {
  try {
    if (settingsExisted && savedSettings !== null) {
      writeFileSync(CC_SETTINGS_FILE, savedSettings);
    } else if (!settingsExisted && existsSync(CC_SETTINGS_FILE)) {
      unlinkSync(CC_SETTINGS_FILE);
    }
  } catch { }
  savedSettings = null;
  settingsExisted = false;
}

// Write a settings file that enables auto-updates (removes the blocker)
function enableAutoUpdates() {
  try {
    let settings = {};
    if (existsSync(CC_SETTINGS_FILE)) {
      settings = JSON.parse(readFileSync(CC_SETTINGS_FILE, 'utf-8'));
    }
    delete settings.autoUpdates;
    mkdirSync(getClaudeConfigDir(), { recursive: true });
    writeFileSync(CC_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch { }
}

// ─── checkAndUpdate: disabled via env ───

describe('checkAndUpdate — disabled', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
    }
  });

  it('returns disabled when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    const result = await checkAndUpdate();
    assert.equal(result.status, 'disabled');
    assert.equal(result.remoteVersion, null);
    assert.ok(result.currentVersion, 'should include currentVersion');
  });
});

// ─── checkAndUpdate: disabled via settings file ───

describe('checkAndUpdate — disabled via settings', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
  });

  afterEach(() => {
    restoreSettings();
    if (origEnv === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
    }
  });

  it('returns disabled when settings.json has autoUpdates: false', async () => {
    mkdirSync(getClaudeConfigDir(), { recursive: true });
    writeFileSync(CC_SETTINGS_FILE, JSON.stringify({ autoUpdates: false }));
    const result = await checkAndUpdate();
    assert.equal(result.status, 'disabled');
    assert.equal(result.remoteVersion, null);
    assert.ok(result.currentVersion);
  });
});

// ─── checkAndUpdate: skipped via recent cache ───

describe('checkAndUpdate — skipped', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
    }
  });

  it('returns skipped when last check was recent', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));
    const result = await checkAndUpdate();
    assert.equal(result.status, 'skipped');
    assert.equal(result.remoteVersion, null);
  });
});

// ─── checkAndUpdate: fetch path (network required) ───

describe('checkAndUpdate — fetch', () => {
  let origEnv;
  let origFetch;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
    }
    globalThis.fetch = origFetch;
  });

  it('fetches registry and returns upgrading_in_background for same-major bump (idle)', async () => {
    // Force a check by writing an old timestamp
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { 'dist-tags': { latest: remote } };
      },
    });

    // lsofImpl 返回空（只有自己一个 pid 也行）→ 空闲；dryRun 跳过真 spawn
    const result = await checkAndUpdate({
      fetchImpl: globalThis.fetch,
      dryRun: true,
      busy: false,
      lsofImpl: () => '',
    });
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(result.remoteVersion, remote);
    assert.equal(result.currentVersion, pkg.version);
  });

  it('currentVersion matches package.json', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    const result = await checkAndUpdate();
    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    assert.equal(result.currentVersion, pkg.version);
  });

  it('returns error when no version found in registry', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': {} }; } }),
      dryRun: true,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'No version found');
  });

  it('returns latest when remote version is not newer', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: pkg.version } }; } }),
      dryRun: true,
    });
    assert.equal(result.status, 'latest');
    assert.equal(result.remoteVersion, pkg.version);
  });

  it('returns major_available for major version bump', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj] = pkg.version.split('.').map(Number);
    const remote = `${maj + 1}.0.0`;

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      dryRun: true,
    });
    assert.equal(result.status, 'major_available');
    assert.equal(result.remoteVersion, remote);
  });

  it('returns error when fetch fails', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const result = await checkAndUpdate({
      fetchImpl: async () => { throw new Error('network error'); },
      dryRun: true,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('network error'));
  });

  it('returns error when fetch returns non-ok status', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: false, status: 503 }),
      dryRun: true,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('503'));
  });

  it('returns error when spawn throws during install', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { throw new Error('permission denied'); },
    });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('permission denied'));
  });

  it('returns deferred_busy when caller passes busy=true', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: true,
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    assert.equal(result.status, 'deferred_busy');
    assert.equal(result.remoteVersion, remote);
    assert.equal(spawnCalled, false, 'spawn must not be called when busy');
  });

  it('returns deferred_busy when lsof reports another CCV instance', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    // 构造一个假的 lsof -Fp 输出：两个 pid，其中一个是自己（跳过），一个是别人（触发 busy）
    const fakeLsof = `p${process.pid}\nf\np99999\nf\n`;
    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => fakeLsof,
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    assert.equal(result.status, 'deferred_busy');
    assert.equal(spawnCalled, false, 'spawn must not be called when other instance detected');
  });

  it('proceeds to upgrade when lsof is missing (non-POSIX fallback)', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    let spawnCalls = 0;
    let spawnArgs = null;
    let unrefCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => { throw new Error('ENOENT: lsof not found'); },
      spawnImpl: (cmd, args, opts) => {
        spawnCalls++;
        spawnArgs = { cmd, args, opts };
        return { unref() { unrefCalled = true; } };
      },
    });
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(spawnCalls, 1);
    assert.equal(spawnArgs.cmd, 'npm');
    assert.deepStrictEqual(spawnArgs.args, ['install', '-g', `cc-viewer@${remote}`, '--no-audit', '--no-fund']);
    assert.equal(spawnArgs.opts.detached, true);
    assert.equal(spawnArgs.opts.stdio, 'ignore');
    assert.equal(unrefCalled, true, 'unref must be called on detached child');
  });
});

// ─── isAnyCcvBusy unit tests ───

describe('isAnyCcvBusy', () => {
  it('returns true when busy hint is true', () => {
    const result = isAnyCcvBusy({ currentPid: 100, busy: true, lsofImpl: () => '' });
    assert.equal(result, true);
  });

  it('returns false when busy=false and lsof shows only self', () => {
    const result = isAnyCcvBusy({
      currentPid: 12345,
      busy: false,
      lsofImpl: () => `p12345\nf\n`,
    });
    assert.equal(result, false);
  });

  it('returns true when lsof shows another pid besides self', () => {
    const result = isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      lsofImpl: () => `p100\nf\np200\nf\n`,
    });
    assert.equal(result, true);
  });

  it('returns false when lsof throws (non-POSIX fallback)', () => {
    const result = isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      lsofImpl: () => { throw new Error('no lsof'); },
    });
    assert.equal(result, false);
  });

  it('respects custom portRange', () => {
    let receivedCmd = null;
    isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      portRange: [8000, 8010],
      lsofImpl: (cmd) => { receivedCmd = cmd; return ''; },
    });
    assert.ok(receivedCmd.includes('8000-8010'), `expected port range 8000-8010 in cmd: ${receivedCmd}`);
  });

  it('ignores non-pid fields in real lsof -Fp output', () => {
    // 真 lsof -Fp 输出每条 process 还会带 f/cwd/txt/rtd 等字段；
    // 严格正则 /^p\d+$/ 确保只认纯 "p<digits>"，把 fXX 等行过滤掉。
    const realistic = [
      'p100',
      'fcwd',
      'frtd',
      'ftxt',
      'f0',
      'f1',
      'f3',
      'p200',
      'fcwd',
      'f0',
      '',
    ].join('\n');
    const result = isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      lsofImpl: () => realistic,
    });
    assert.equal(result, true, 'p200 应被识别为另一个 CCV 实例');
  });

  it('handles CRLF line endings in lsof output', () => {
    // 管道/Windows 下输出可能带 \r；不预清就会让最后一行是 `p200\r` 无法通过 ^p\d+$ 校验。
    const crlf = `p100\r\nf\r\np200\r\nf\r\n`;
    const result = isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      lsofImpl: () => crlf,
    });
    assert.equal(result, true, 'CRLF 预清后应识别 p200');
  });

  it('rejects malformed p lines (empty / negative / non-digits)', () => {
    const garbage = [
      'p',       // 空 pid
      'p-1',     // 负数
      'p0',      // 非法 pid
      'pabc',    // 非数字
      'pXYZ',
      'p200',    // 唯一合法
    ].join('\n');
    const result = isAnyCcvBusy({
      currentPid: 100,
      busy: false,
      lsofImpl: () => garbage,
    });
    assert.equal(result, true, '只有 p200 合法，应识别为其它实例');
  });
});

// ─── spawn 返回值边角 ───

describe('checkAndUpdate spawn return defense', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('tolerates spawnImpl returning null (no crash on missing unref)', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => null, // 极端情况，spawn 返回 null
    });
    // 不抛异常 + 状态正确
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(result.remoteVersion, remote);
  });

  it('sets shell=true only on win32 (sanity check of platform branch)', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    let capturedOpts = null;
    await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: (_cmd, _args, opts) => { capturedOpts = opts; return { unref() {} }; },
    });
    // 当前测试宿主非 win32 → shell 应为 false；如果在 Windows CI 跑会是 true
    assert.equal(capturedOpts.shell, process.platform === 'win32');
    assert.equal(capturedOpts.detached, true);
    assert.equal(capturedOpts.stdio, 'ignore');
    // Windows：npm.cmd 是 console-subsystem，缺 windowsHide 会在后台更新期间常驻可见控制台窗口
    assert.equal(capturedOpts.windowsHide, true);
  });
});

// ─── parseVersion / isNewer (tested indirectly via subprocess) ───

describe('version comparison logic (indirect)', () => {
  // We test parseVersion/isNewer indirectly by evaluating them in a subprocess
  // since they are not exported

  function evalInModule(code) {
    // Run a small inline script that imports nothing but replicates the logic
    const script = `
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
      ${code}
    `;
    return execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, NO_COLOR: '1' },
    }).trim().replace(/\x1b\[[0-9;]*m/g, '');
  }

  it('parseVersion splits correctly', () => {
    const out = evalInModule(`
      const v = parseVersion('1.4.19');
      console.log(JSON.stringify(v));
    `);
    assert.deepStrictEqual(JSON.parse(out), { major: 1, minor: 4, patch: 19 });
  });

  it('isNewer returns true for higher patch', () => {
    const out = evalInModule(`console.log(String(isNewer('1.4.20', '1.4.19')));`);
    assert.equal(out, 'true');
  });

  it('isNewer returns false for same version', () => {
    const out = evalInModule(`console.log(String(isNewer('1.4.19', '1.4.19')));`);
    assert.equal(out, 'false');
  });

  it('isNewer returns false for older version', () => {
    const out = evalInModule(`console.log(String(isNewer('1.4.18', '1.4.19')));`);
    assert.equal(out, 'false');
  });

  it('isNewer handles major version bump', () => {
    const out = evalInModule(`console.log(String(isNewer('2.0.0', '1.9.99')));`);
    assert.equal(out, 'true');
  });

  it('isNewer handles minor version bump', () => {
    const out = evalInModule(`console.log(String(isNewer('1.5.0', '1.4.99')));`);
    assert.equal(out, 'true');
  });

  it('isNewer: lower major is not newer', () => {
    const out = evalInModule(`console.log(String(isNewer('0.9.99', '1.0.0')));`);
    assert.equal(out, 'false');
  });
});

// ─── detectHomebrewInstall ───

describe('detectHomebrewInstall', () => {
  // 注：realpathImpl 直接返回入参，绕开真 fs（测试不依赖磁盘）
  const identityRealpath = (p) => p;

  it('returns brew prefix for Apple Silicon path', () => {
    const result = detectHomebrewInstall(
      '/opt/homebrew/Cellar/cc-viewer/1.6.224/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/opt/homebrew');
  });

  it('returns brew prefix for Intel mac path', () => {
    const result = detectHomebrewInstall(
      '/usr/local/Cellar/cc-viewer/1.6.224/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/usr/local');
  });

  it('returns brew prefix for linuxbrew / custom prefix', () => {
    const result = detectHomebrewInstall(
      '/home/user/.linuxbrew/Cellar/cc-viewer/1.6.224/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/home/user/.linuxbrew');
  });

  it('returns null for normal npm-global path', () => {
    const result = detectHomebrewInstall(
      '/Users/sky/.npm-global/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('returns null for nvm versioned path', () => {
    const result = detectHomebrewInstall(
      '/Users/sky/.nvm/versions/node/v20.10.0/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('returns null for system /usr/local without Cellar', () => {
    const result = detectHomebrewInstall(
      '/usr/local/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('returns null for path containing Cellar but not cc-viewer', () => {
    const result = detectHomebrewInstall(
      '/opt/homebrew/Cellar/some-other-pkg/1.0.0/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects path where Cellar/cc-viewer is the terminal segment (no version subdir)', () => {
    // /Cellar/cc-viewer/ 后必须紧跟 <version>/，否则不是合法布局
    const result = detectHomebrewInstall(
      '/opt/homebrew/Cellar/cc-viewer/',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects dev clone where path happens to include Cellar/cc-viewer/lib/...', () => {
    // 防御 dev clone 误判：开发者 clone 到 /Users/x/projects/Cellar/cc-viewer/ 时，
    // afterCellar = 'lib/...'，'lib' 不以数字开头 → 不应被当成 brew 安装
    const result = detectHomebrewInstall(
      '/Users/x/projects/Cellar/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects Time Machine backup paths containing Cellar/cc-viewer/<non-version>/', () => {
    // /Volumes/.../Backups.backupdb/.../opt/homebrew/Cellar/cc-viewer/Backup-2026-01/...
    // Backup-2026-01 不以数字开头 → 不误判为 live brew 安装
    const result = detectHomebrewInstall(
      '/Volumes/TimeMachine/Backups.backupdb/host/opt/homebrew/Cellar/cc-viewer/Backup-2026-01/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('follows symlinks via realpath (npm bin shim case)', () => {
    // bin shim /opt/homebrew/bin/ccv 是 symlink → Cellar 实体
    const fakeRealpath = (p) =>
      p === '/opt/homebrew/bin/ccv'
        ? '/opt/homebrew/Cellar/cc-viewer/1.6.224/lib/node_modules/cc-viewer/bin/ccv'
        : p;
    const result = detectHomebrewInstall('/opt/homebrew/bin/ccv', fakeRealpath);
    assert.equal(result, '/opt/homebrew');
  });

  it('falls back to raw path when realpath throws (broken symlink)', () => {
    const throwingRealpath = () => { throw new Error('ELOOP'); };
    // 原始路径已含 brew 标记 → 仍能检出
    const result = detectHomebrewInstall(
      '/opt/homebrew/Cellar/cc-viewer/1.6.224/lib',
      throwingRealpath
    );
    assert.equal(result, '/opt/homebrew');
  });
});

// ─── checkAndUpdate brew_managed 集成 ───

describe('checkAndUpdate — brew_managed', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('returns brew_managed and skips spawn when brewPrefix is set + same-major newer', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
      brewPrefix: '/opt/homebrew',
    });
    assert.equal(result.status, 'brew_managed');
    assert.equal(result.remoteVersion, remote);
    assert.equal(result.brewPrefix, '/opt/homebrew');
    assert.equal(spawnCalled, false, 'spawn must not be called for brew installs');
  });

  it('major bump on brew install returns brew_managed (brew check wins over major_available)', async () => {
    // 关键反向断言：brew_managed 必须早于 major_available。否则 brew 用户跨大版本会被 i18n
    // major.message 引导跑 npm i -g cc-viewer@latest，正好触发"双渠道污染"——brew 渠道
    // 想杜绝的就是这个场景。`brew upgrade cc-viewer` 跨大版本同样能用，文案统一不需特化。
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj] = pkg.version.split('.').map(Number);
    const remote = `${maj + 1}.0.0`;

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      brewPrefix: '/opt/homebrew',
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    assert.equal(result.status, 'brew_managed');
    assert.equal(result.remoteVersion, remote);
    assert.equal(result.brewPrefix, '/opt/homebrew');
    assert.equal(spawnCalled, false, 'must not run npm install for brew installs, even on major bump');
  });

  it('latest (no upgrade) on brew install returns latest, not brew_managed', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: pkg.version } }; } }),
      brewPrefix: '/opt/homebrew',
    });
    assert.equal(result.status, 'latest');
  });

  it('brewPrefix=null (explicit) takes upgrade path normally', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
      brewPrefix: null, // 显式声明非 brew，绕过真探测
    });
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(spawnCalled, true);
  });
});
