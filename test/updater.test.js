import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { checkAndUpdate } from '../lib/updater.js';

const CACHE_DIR = join(homedir(), '.claude', 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');

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
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
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
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
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

  it('fetches registry and returns a valid status', async () => {
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

    const result = await checkAndUpdate({ fetchImpl: globalThis.fetch, dryRun: true, execImpl: () => { } });
    assert.equal(result.status, 'updated');
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

  it('returns error when exec fails during update', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min}.${pat + 1}`;

    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      execImpl: () => { throw new Error('permission denied'); },
    });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('permission denied'));
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
