import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { buildShellCandidates, getGlobalNodeModulesDir, findPackagedBinary, findPlatformBinary, detectPlatformKey, hasClaude2xWrapper } from '../findcc.js';

// Test resolveLogDir by spawning a subprocess with different CCV_LOG_DIR values.
// This avoids module cache busting which dilutes coverage.
// production:true 剥掉 NODE_TEST_CONTEXT——L1c 铁闸在测试上下文里会拒绝非 tmp 的显式目录
// (2026-07-12 数据丢失修复)，断言生产解析语义的用例必须模拟生产环境。
function getLogDirWithEnv(envVal, { production = false } = {}) {
  const env = { ...process.env, CCV_LOG_DIR: envVal };
  if (production) delete env.NODE_TEST_CONTEXT;
  const result = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { LOG_DIR } from './findcc.js'; process.stdout.write(LOG_DIR);`,
  ], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf-8',
    env,
    timeout: 5000,
  });
  return result;
}

describe('findcc: resolveLogDir', () => {
  it('uses "tmp" keyword to resolve to system tmpdir', () => {
    const logDir = getLogDirWithEnv('tmp');
    assert.ok(logDir.startsWith(tmpdir()), `expected ${logDir} to start with ${tmpdir()}`);
    assert.ok(logDir.includes('cc-viewer-test'));
  });

  it('uses "temp" keyword to resolve to system tmpdir', () => {
    const logDir = getLogDirWithEnv('temp');
    assert.ok(logDir.startsWith(tmpdir()));
    assert.ok(logDir.includes('cc-viewer-test'));
  });

  it('expands ~/ prefix to homedir (production semantics — L1c rejects non-tmp dirs in tests)', () => {
    const logDir = getLogDirWithEnv('~/my-logs', { production: true });
    assert.equal(logDir, join(homedir(), 'my-logs'));
  });

  it('L1c: the same non-tmp explicit dir is forced to the guard dir under NODE_TEST_CONTEXT', () => {
    const logDir = getLogDirWithEnv('~/my-logs'); // NODE_TEST_CONTEXT inherited from the runner
    assert.notEqual(logDir, join(homedir(), 'my-logs'));
    assert.ok(logDir.startsWith(join(tmpdir(), 'cc-viewer-test')), logDir);
  });

  it('resolves absolute path as-is', () => {
    const logDir = getLogDirWithEnv('/tmp/custom-ccv-logs');
    assert.equal(logDir, '/tmp/custom-ccv-logs');
  });

  // 注意(2026-06-06 事故后):以下两个用例断言的是【生产环境】默认解析。findcc 的 L1/L1b
  // 测试铁闸会在 NODE_TEST_CONTEXT 存在时强制私有目录(防止测试触碰真实 ~/.claude)——
  // 因此子进程 env 必须剥掉 NODE_TEST_CONTEXT 才能模拟生产语义。铁闸自身行为由
  // test/logdir-test-guard.test.js 专门钉死,两边互补,谁都不许删。
  it('defaults to ~/.claude/cc-viewer when env is empty', () => {
    const { CLAUDE_CONFIG_DIR: _, CCV_LOG_DIR: __, NODE_TEST_CONTEXT: ___, ...cleanEnv } = process.env;
    const result = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { LOG_DIR } from './findcc.js'; process.stdout.write(LOG_DIR);`,
    ], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
      env: { ...cleanEnv, CCV_LOG_DIR: '' },
      timeout: 5000,
    });
    assert.equal(result, join(homedir(), '.claude', 'cc-viewer'));
  });

  it('respects CLAUDE_CONFIG_DIR for default LOG_DIR', () => {
    const { NODE_TEST_CONTEXT: _, ...prodEnv } = process.env;
    const result = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { LOG_DIR } from './findcc.js'; process.stdout.write(LOG_DIR);`,
    ], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
      env: { ...prodEnv, CCV_LOG_DIR: '', CLAUDE_CONFIG_DIR: '/tmp/custom-claude' },
      timeout: 5000,
    });
    assert.equal(result, '/tmp/custom-claude/cc-viewer');
  });
});

describe('findcc: buildShellCandidates', () => {
  it('returns a string with quoted paths', () => {
    const result = buildShellCandidates();
    assert.equal(typeof result, 'string');
    if (result.length > 0) {
      const parts = result.split(' ').filter(Boolean);
      for (const p of parts) {
        assert.ok(p.startsWith('"') && p.endsWith('"'), `expected quoted path: ${p}`);
      }
    }
  });
});

describe('findcc: getGlobalNodeModulesDir', () => {
  it('returns a string or null', () => {
    const result = getGlobalNodeModulesDir();
    assert.ok(result === null || typeof result === 'string');
  });
});

describe('findcc: findPackagedBinary', () => {
  it('returns null for null/empty root', () => {
    assert.equal(findPackagedBinary(null), null);
    assert.equal(findPackagedBinary(''), null);
  });

  it('returns null when no matching package exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-empty-'));
    try {
      assert.equal(findPackagedBinary(root), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds bin/claude.exe inside @anthropic-ai/claude-code (2.x layout)', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-exe-'));
    try {
      const binDir = join(root, '@anthropic-ai', 'claude-code', 'bin');
      mkdirSync(binDir, { recursive: true });
      const binPath = join(binDir, 'claude.exe');
      writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
      chmodSync(binPath, 0o755);
      assert.equal(findPackagedBinary(root), binPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds bin/claude (unix name) as a secondary option', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-nix-'));
    try {
      const binDir = join(root, '@anthropic-ai', 'claude-code', 'bin');
      mkdirSync(binDir, { recursive: true });
      const binPath = join(binDir, 'claude');
      writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
      chmodSync(binPath, 0o755);
      assert.equal(findPackagedBinary(root), binPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers the primary (@anthropic-ai) package over the fallback (@ali)', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-both-'));
    try {
      for (const pkg of ['@anthropic-ai/claude-code', '@ali/claude-code']) {
        const binDir = join(root, pkg, 'bin');
        mkdirSync(binDir, { recursive: true });
        writeFileSync(join(binDir, 'claude.exe'), '#!/bin/sh\nexit 0\n');
      }
      const found = findPackagedBinary(root);
      assert.ok(found.includes('@anthropic-ai'), `expected @anthropic-ai win, got ${found}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Subprocess helper: run resolveNativePath() with a controlled PATH and an
// NPM_CONFIG_PREFIX pointing at a nonexistent location so the platform-binary
// lookup (step 1 of resolveNativePath) misses and execution falls through to
// the which/command -v path (step 2), which is what these tests exercise.
function runResolveNativePath({ shimDir, realTarget }) {
  return execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { resolveNativePath } from './findcc.js'; process.stdout.write(String(resolveNativePath()));`,
  ], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf-8',
    env: {
      PATH: `${shimDir}:/usr/bin:/bin`,
      HOME: '/nonexistent-home-for-test',
      NPM_CONFIG_PREFIX: '/tmp/findcc-test-fake-prefix-' + Date.now(),
    },
    timeout: 5000,
  });
}

describe('findcc: hasClaude2xWrapper', () => {
  it('returns false for null/empty root', () => {
    assert.equal(hasClaude2xWrapper(null), false);
    assert.equal(hasClaude2xWrapper(''), false);
  });

  it('returns false when wrapper package does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-wrap-missing-'));
    try {
      assert.equal(hasClaude2xWrapper(root), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns true when install.cjs is present in @anthropic-ai/claude-code', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-wrap-present-'));
    try {
      const pkgDir = join(root, '@anthropic-ai', 'claude-code');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'install.cjs'), '// postinstall stub\n');
      assert.equal(hasClaude2xWrapper(root), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns false when only package.json exists (1.x layout, no install.cjs)', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-wrap-1x-'));
    try {
      const pkgDir = join(root, '@anthropic-ai', 'claude-code');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'package.json'), '{}');
      writeFileSync(join(pkgDir, 'cli.js'), '// cli.js present, 1.x layout\n');
      assert.equal(hasClaude2xWrapper(root), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findcc: detectPlatformKey', () => {
  it('returns a known platform key for the current platform', () => {
    const key = detectPlatformKey();
    if (process.platform === 'darwin') {
      assert.match(key, /^darwin-(arm64|x64)$/);
    } else if (process.platform === 'linux') {
      assert.match(key, /^linux-(x64|arm64)(-musl)?$/);
    } else if (process.platform === 'win32') {
      assert.match(key, /^win32-(x64|arm64)$/);
    } else {
      // Unsupported platform — key may be null
      assert.ok(key === null || typeof key === 'string');
    }
  });
});

describe('findcc: findPlatformBinary', () => {
  it('returns null for null/empty root', () => {
    assert.equal(findPlatformBinary(null), null);
    assert.equal(findPlatformBinary(''), null);
  });

  it('returns null when platform-specific package does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-plat-missing-'));
    try {
      assert.equal(findPlatformBinary(root), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds binary in the flat (hoisted) optional-dep layout', () => {
    const key = detectPlatformKey();
    if (!key) return;
    const root = mkdtempSync(join(tmpdir(), 'findcc-plat-flat-'));
    try {
      const pkgDir = join(root, `@anthropic-ai/claude-code-${key}`);
      mkdirSync(pkgDir, { recursive: true });
      const binName = process.platform === 'win32' ? 'claude.exe' : 'claude';
      const binPath = join(pkgDir, binName);
      writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
      chmodSync(binPath, 0o755);
      assert.equal(findPlatformBinary(root), binPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds binary in the nested (per-package) optional-dep layout', () => {
    const key = detectPlatformKey();
    if (!key) return;
    const root = mkdtempSync(join(tmpdir(), 'findcc-plat-nested-'));
    try {
      const pkgDir = join(root, '@anthropic-ai', 'claude-code', 'node_modules', `@anthropic-ai/claude-code-${key}`);
      mkdirSync(pkgDir, { recursive: true });
      const binName = process.platform === 'win32' ? 'claude.exe' : 'claude';
      const binPath = join(pkgDir, binName);
      writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
      chmodSync(binPath, 0o755);
      assert.equal(findPlatformBinary(root), binPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Subprocess helper: runs resolveNativePath with CLAUDE_CONFIG_DIR pointing at
// a fake dir; the test verifies `~/.claude/local/claude` in NATIVE_CANDIDATES is
// rewritten through getClaudeConfigDir() while `~/.local/` stays on homedir().
function runResolveNativePathWithConfigDir({ claudeConfigDir, fakeHome, shimDir }) {
  return execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { resolveNativePath } from './findcc.js'; process.stdout.write(String(resolveNativePath()));`,
  ], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf-8',
    env: {
      PATH: `${shimDir || '/nonexistent'}:/usr/bin:/bin`,
      HOME: fakeHome,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      // 让 step 1 和 step 4 的 getGlobalNodeModulesDir() 指向空目录
      NPM_CONFIG_PREFIX: '/tmp/findcc-test-fake-prefix-' + Date.now(),
    },
    timeout: 5000,
  });
}

describe('findcc: resolveNativePath ~/.claude/ CLAUDE_CONFIG_DIR rewrite', () => {
  it('expands ~/.claude/local/claude through CLAUDE_CONFIG_DIR when set', () => {
    const base = mkdtempSync(join(tmpdir(), 'findcc-ccdir-'));
    const fakeHome = join(base, 'home');
    const customDir = join(base, 'custom-claude');
    const localDir = join(customDir, 'local');
    mkdirSync(fakeHome, { recursive: true });
    mkdirSync(localDir, { recursive: true });
    const binPath = join(localDir, 'claude');
    writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
    chmodSync(binPath, 0o755);
    try {
      const out = runResolveNativePathWithConfigDir({
        claudeConfigDir: customDir,
        fakeHome,
      });
      assert.equal(out, binPath,
        `expected ${binPath} under CLAUDE_CONFIG_DIR, got ${out}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns null when CLAUDE_CONFIG_DIR is set but no claude under it', () => {
    const base = mkdtempSync(join(tmpdir(), 'findcc-ccdir-empty-'));
    const fakeHome = join(base, 'home');
    const customDir = join(base, 'custom-claude');  // empty dir, no local/claude
    mkdirSync(fakeHome, { recursive: true });
    mkdirSync(customDir, { recursive: true });
    try {
      const out = runResolveNativePathWithConfigDir({
        claudeConfigDir: customDir,
        fakeHome,
      });
      // May be null, or may pick up a real-host /usr/local/bin/claude etc.
      // The invariant this test guards: NOT the fake customDir path.
      assert.ok(!out.startsWith(customDir),
        `should not have found claude under empty ${customDir}, got ${out}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('findcc: resolveNativePath rejection rules (the actual bug fix)', () => {
  it('ACCEPTS a non-.js binary whose realpath is under node_modules (Claude Code 2.x layout)', () => {
    const base = mkdtempSync(join(tmpdir(), 'findcc-native-ok-'));
    const shimDir = join(base, 'shim');
    const realDir = join(base, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(realDir, { recursive: true });
    const realBin = join(realDir, 'claude.exe');
    writeFileSync(realBin, '#!/bin/sh\nexit 0\n');
    chmodSync(realBin, 0o755);
    const shim = join(shimDir, 'claude');
    symlinkSync(realBin, shim);
    try {
      const out = runResolveNativePath({ shimDir, realTarget: realBin });
      assert.equal(out, shim, `expected shim path returned, got ${out}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('REJECTS a .js file under node_modules (legacy cli.js path, handled by resolveNpmClaudePath instead)', () => {
    const base = mkdtempSync(join(tmpdir(), 'findcc-native-skip-'));
    const shimDir = join(base, 'shim');
    const realDir = join(base, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(realDir, { recursive: true });
    const cliJs = join(realDir, 'cli.js');
    writeFileSync(cliJs, '#!/usr/bin/env node\n');
    chmodSync(cliJs, 0o755);
    const shim = join(shimDir, 'claude');
    symlinkSync(cliJs, shim);
    try {
      const out = runResolveNativePath({ shimDir, realTarget: cliJs });
      // 期望 resolveNativePath 跳过该 shim；没有其他 fallback 命中时返回 "null"
      assert.notEqual(out, shim, `.js shim should be skipped, but it was returned: ${out}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
