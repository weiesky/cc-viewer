// pnpm-global install channel isolation for the self-updater (migration item A2.4).
//
// Goal: `pnpm add -g cc-viewer` users must NOT be upgraded via `npm install -g` — that would
// leave a second copy at the npm global prefix (dual-channel pollution). detectPnpmGlobalInstall
// mirrors detectHomebrewInstall: it returns the pnpm root (PNPM_HOME / custom global-dir) when
// the module's realpath flows through a pnpm virtual-store segment (`/.pnpm/cc-viewer@<version>/`),
// and checkAndUpdate() then reports `pnpm_managed` (brew_managed shape) instead of spawning npm.
//
// Isolation: CACHE_FILE / CC_SETTINGS_FILE are computed at module-import time from env, so this
// file locks CLAUDE_CONFIG_DIR / CCV_LOG_DIR into a process-private tmpdir BEFORE the dynamic
// import of updater.js (same discipline as branch-lib-updater.test.js). Fast tier: no
// CCV_TEST_CLI gate, no real network — every checkAndUpdate call injects fetchImpl (the L5
// guard early-returns skipped_test_context without one) and lsofImpl.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Isolation segment: must precede any project-module import ──
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-pnpm-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir; // CACHE_DIR / settings derive from this

// Only after locking the env may project modules be imported
const { checkAndUpdate, detectPnpmGlobalInstall, detectHomebrewInstall } =
  await import('../packages/app/server/lib/updater.js');
const { getClaudeConfigDir } = await import('../packages/app/findcc.js');

const CACHE_DIR = join(getClaudeConfigDir(), 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');

// Shared-file backup/restore (same mechanism as updater.test.js / branch-lib-updater.test.js)
let savedCache = null;
let cacheExisted = false;
let savedSettings = null;
let settingsExisted = false;

function backupCache() {
  try {
    cacheExisted = existsSync(CACHE_FILE);
    if (cacheExisted) savedCache = readFileSync(CACHE_FILE, 'utf-8');
  } catch { }
}

function restoreCache() {
  try {
    if (cacheExisted && savedCache !== null) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, savedCache);
    } else if (!cacheExisted && existsSync(CACHE_FILE)) {
      unlinkSync(CACHE_FILE);
    }
  } catch { }
  savedCache = null;
  cacheExisted = false;
}

function backupSettings() {
  try {
    settingsExisted = existsSync(CC_SETTINGS_FILE);
    if (settingsExisted) savedSettings = readFileSync(CC_SETTINGS_FILE, 'utf-8');
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

// Write settings that enable auto-updates (removes the autoUpdates blocker)
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

// Stale the check cache so shouldCheck() lets the fetch path run
function forceCheck() {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));
}

// Next-patch remote version derived from the real package.json (matches updater.test.js)
function nextPatchRemote() {
  const pkgPath = join(import.meta.dirname, '..', 'packages', 'app', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  return `${maj}.${min}.${pat + 1}`;
}

// ─── detectPnpmGlobalInstall ───

describe('detectPnpmGlobalInstall', () => {
  // realpathImpl returns its input verbatim, bypassing real fs (tests do not touch disk)
  const identityRealpath = (p) => p;

  it('returns pnpm root for the macOS default PNPM_HOME layout', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/server/lib',
      identityRealpath
    );
    assert.equal(result, '/Users/sky/Library/pnpm');
  });

  it('returns pnpm root for the Linux default layout', () => {
    const result = detectPnpmGlobalInstall(
      '/home/u/.local/share/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/home/u/.local/share/pnpm');
  });

  it('returns normalized pnpm root for the Windows layout', () => {
    const result = detectPnpmGlobalInstall(
      'C:\\Users\\sky\\AppData\\Local\\pnpm\\global\\5\\node_modules\\.pnpm\\cc-viewer@1.7.22\\node_modules\\cc-viewer\\lib',
      identityRealpath
    );
    assert.equal(result, 'C:/Users/sky/AppData/Local/pnpm');
  });

  it('returns pnpm root for a custom global-dir (PNPM_HOME elsewhere)', () => {
    const result = detectPnpmGlobalInstall(
      '/data/pnpm-global/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/data/pnpm-global');
  });

  it('detects prerelease version segments in the virtual store', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22-beta.1/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/Users/sky/Library/pnpm');
  });

  it('detects the published package layout (server/lib directly under the package)', () => {
    // Published npm artifact has no packages/app/ segment — the marker is layout-agnostic
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/server/lib',
      identityRealpath
    );
    assert.equal(result, '/Users/sky/Library/pnpm');
  });

  it('returns the dlx-cache dir for pnpm dlx layouts (no /global/ segment)', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/Caches/pnpm/dlx/abc123/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, '/Users/sky/Library/Caches/pnpm/dlx/abc123');
  });

  it('returns null for a normal npm-global path', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/.npm-global/lib/node_modules/cc-viewer/server/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('returns null for a brew Cellar path (brew channel is handled separately)', () => {
    const result = detectPnpmGlobalInstall(
      '/opt/homebrew/Cellar/cc-viewer/1.6.224/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('returns null for a pnpm tree of a different package', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/some-other-pkg@1.0.0/node_modules/some-other-pkg/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects a terminal .pnpm/cc-viewer segment without a version subdir', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects tag-style segments like cc-viewer@nightly (defensive, mirror of brew HEAD caveat)', () => {
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@nightly/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('rejects dev-clone paths that merely contain the literal marker text', () => {
    // A checkout of a repo whose path happens to include node_modules/.pnpm/cc-viewer@...
    // but with a non-version continuation must not be treated as a pnpm install
    const result = detectPnpmGlobalInstall(
      '/Users/x/projects/node_modules/.pnpm/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('does NOT misfire on npm installs whose --prefix points into the PNPM_HOME dir', () => {
    // npm layout under ~/Library/pnpm (lib/node_modules, no .pnpm virtual store) — the case a
    // naive `/pnpm/`-segment heuristic would wrongly route to `pnpm add -g`
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/lib/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null);
  });

  it('follows symlinks via realpath (bin shim case)', () => {
    // bin shim $PNPM_HOME/bin/ccv chains into the virtual store
    const fakeRealpath = (p) =>
      p === '/Users/sky/Library/pnpm/bin/ccv'
        ? '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/bin/ccv'
        : p;
    const result = detectPnpmGlobalInstall('/Users/sky/Library/pnpm/bin/ccv', fakeRealpath);
    assert.equal(result, '/Users/sky/Library/pnpm');
  });

  it('falls back to the raw path when realpath throws (broken symlink)', () => {
    const throwingRealpath = () => { throw new Error('ELOOP'); };
    // Raw path already carries the pnpm marker → still detected
    const result = detectPnpmGlobalInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/lib',
      throwingRealpath
    );
    assert.equal(result, '/Users/sky/Library/pnpm');
  });

  it('uses the module __dirname when dirOverride is falsy (default arm)', () => {
    // No dirOverride → dir = __dirname; this checkout is an npm-global install, not pnpm → null
    const result = detectPnpmGlobalInstall();
    assert.equal(result, null, '当前测试环境非 pnpm 安装，应返回 null');
  });

  it('empty-string dirOverride also takes the default arm (falsy → __dirname)', () => {
    const result = detectPnpmGlobalInstall('');
    assert.equal(result, null);
  });

  it('cross-check: detectHomebrewInstall stays silent on pnpm paths', () => {
    const identityRealpath = (p) => p;
    const result = detectHomebrewInstall(
      '/Users/sky/Library/pnpm/global/5/node_modules/.pnpm/cc-viewer@1.7.22/node_modules/cc-viewer/lib',
      identityRealpath
    );
    assert.equal(result, null, 'brew detector must not fire on pnpm paths');
  });
});

// ─── checkAndUpdate pnpm_managed 集成 ───

describe('checkAndUpdate — pnpm_managed', () => {
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

  it('returns pnpm_managed and skips spawn when pnpmRoot is set + same-major newer', async () => {
    forceCheck();
    const remote = nextPatchRemote();

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
      pnpmRoot: '/Users/sky/Library/pnpm',
    });
    assert.equal(result.status, 'pnpm_managed');
    assert.equal(result.remoteVersion, remote);
    assert.equal(result.pnpmRoot, '/Users/sky/Library/pnpm');
    assert.equal(spawnCalled, false, 'spawn must not be called for pnpm global installs');
  });

  it('major bump on pnpm install returns pnpm_managed (pnpm check wins over major_available)', async () => {
    // Mirror of the brew assertion: the managed-externally branch must precede major_available,
    // otherwise a pnpm user on a major bump would be told to run `npm i -g cc-viewer@latest`
    // and create the second copy at the npm prefix — the dual-channel pollution this guards.
    forceCheck();
    const pkgPath = join(import.meta.dirname, '..', 'packages', 'app', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj] = pkg.version.split('.').map(Number);
    const remote = `${maj + 1}.0.0`;

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      pnpmRoot: '/Users/sky/Library/pnpm',
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    assert.equal(result.status, 'pnpm_managed');
    assert.equal(result.remoteVersion, remote);
    assert.equal(result.pnpmRoot, '/Users/sky/Library/pnpm');
    assert.equal(spawnCalled, false, 'must not run npm install for pnpm installs, even on major bump');
  });

  it('latest (no upgrade) on pnpm install returns latest, not pnpm_managed', async () => {
    forceCheck();
    const pkgPath = join(import.meta.dirname, '..', 'packages', 'app', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: pkg.version } }; } }),
      pnpmRoot: '/Users/sky/Library/pnpm',
    });
    assert.equal(result.status, 'latest');
  });

  it('brew check wins when both brewPrefix and pnpmRoot are set', async () => {
    forceCheck();
    const remote = nextPatchRemote();

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
      brewPrefix: '/opt/homebrew',
      pnpmRoot: '/Users/sky/Library/pnpm',
    });
    assert.equal(result.status, 'brew_managed');
    assert.equal(result.brewPrefix, '/opt/homebrew');
    assert.equal(spawnCalled, false);
  });

  it('pnpmRoot=null (explicit) takes the npm upgrade path normally', async () => {
    forceCheck();
    const remote = nextPatchRemote();

    let spawnCalled = false;
    let spawnArgs = null;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: (cmd, args, opts) => { spawnCalled = true; spawnArgs = { cmd, args, opts }; return { unref() {} }; },
      pnpmRoot: null, // explicit "not pnpm-managed", bypasses real detection
    });
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(spawnCalled, true);
    assert.equal(spawnArgs.cmd, 'npm');
    assert.deepStrictEqual(spawnArgs.args, ['install', '-g', `cc-viewer@${remote}`, '--no-audit', '--no-fund']);
  });

  it('pnpmRoot="" (explicit falsy) is treated as not pnpm-managed, like brewPrefix', async () => {
    forceCheck();
    const remote = nextPatchRemote();

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
      pnpmRoot: '',
    });
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(spawnCalled, true);
  });

  it('genuine npm installs (no pnpmRoot) keep the npm upgrade path', async () => {
    forceCheck();
    const remote = nextPatchRemote();

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    // No pnpmRoot option → real detection ran against this npm-global checkout → null → npm path
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(spawnCalled, true);
  });
});
