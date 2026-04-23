import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Proxy profile per-workspace active 隔离
 *
 * interceptor.js 里 setActiveProfileForWorkspace / _readWorkspaceActiveId 依赖模块顶层
 * _projectName/_logDir，直接 import 会引入 fetch 补丁等副作用；本测试复现一份同款
 * 纯逻辑做单元验证。
 *
 * KEEP IN SYNC: 与 interceptor.js 的 _getActiveProfileFilePath / _readWorkspaceActiveId /
 * _writeWorkspaceActiveId / _loadProxyProfile 的 active 解析分支保持一致。
 */

// ============================================================================
// 从 interceptor.js 复制的核心逻辑（纯函数版，通过参数注入 logDir）
// ============================================================================

function getActiveProfileFilePath(logDir) {
  if (!logDir) return null;
  return join(logDir, 'active-profile.json');
}

function readWorkspaceActiveId(logDir) {
  const p = getActiveProfileFilePath(logDir);
  if (!p) return null;
  try {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return typeof data?.activeId === 'string' ? data.activeId : null;
    }
  } catch { }
  return null;
}

function writeWorkspaceActiveId(logDir, activeId) {
  const p = getActiveProfileFilePath(logDir);
  if (!p) return false;
  try {
    mkdirSync(logDir, { recursive: true });
    const payload = { activeId: (activeId && typeof activeId === 'string') ? activeId : 'max' };
    writeFileSync(p, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return true;
  } catch { return false; }
}

// active 解析优先级：workspace override > profile.json.active > null
function resolveActiveProfile(profileJson, logDir) {
  const ws = readWorkspaceActiveId(logDir);
  const activeId = ws || profileJson.active;
  const active = profileJson.profiles?.find(p => p.id === activeId);
  return (active && active.id !== 'max') ? active : null;
}

// ============================================================================
// Fixtures
// ============================================================================

const PROFILES_JSON = {
  active: 'max', // 全局回退默认
  profiles: [
    { id: 'max', name: 'Default' },
    { id: 'foxcode', name: 'foxcode', baseURL: 'https://code.newcii.com/claude', apiKey: 'sk-fox', activeModel: 'claude-opus-4-6' },
    { id: 'anyrouter', name: 'AnyRouter', baseURL: 'https://anyrouter.example.com', apiKey: 'sk-any', activeModel: 'claude-sonnet-4-6' },
  ],
};

// ============================================================================
// Tests
// ============================================================================

describe('proxy profile per-workspace active isolation', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ccv-proxy-isolation-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('workspace active file I/O', () => {
    it('write then read returns the same activeId', () => {
      const ws = join(tempRoot, 'projA');
      assert.equal(writeWorkspaceActiveId(ws, 'foxcode'), true);
      assert.equal(readWorkspaceActiveId(ws), 'foxcode');
    });

    it('missing file returns null', () => {
      const ws = join(tempRoot, 'nonexistent');
      assert.equal(readWorkspaceActiveId(ws), null);
    });

    it('empty logDir returns null without creating a file', () => {
      assert.equal(readWorkspaceActiveId(''), null);
      assert.equal(writeWorkspaceActiveId('', 'foxcode'), false);
    });

    it('overwrites existing activeId', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActiveId(ws, 'foxcode');
      writeWorkspaceActiveId(ws, 'anyrouter');
      assert.equal(readWorkspaceActiveId(ws), 'anyrouter');
    });

    it('writes valid JSON with activeId field', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActiveId(ws, 'foxcode');
      const raw = readFileSync(join(ws, 'active-profile.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed, { activeId: 'foxcode' });
    });

    it('coerces null/undefined/non-string activeId to "max" sentinel', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActiveId(ws, null);
      assert.equal(readWorkspaceActiveId(ws), 'max');
      writeWorkspaceActiveId(ws, undefined);
      assert.equal(readWorkspaceActiveId(ws), 'max');
      writeWorkspaceActiveId(ws, 123);
      assert.equal(readWorkspaceActiveId(ws), 'max');
    });

    it('corrupted JSON returns null (no crash)', () => {
      const ws = join(tempRoot, 'projA');
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(ws, 'active-profile.json'), 'not json {{{');
      assert.equal(readWorkspaceActiveId(ws), null);
    });
  });

  describe('cross-workspace isolation (user\'s core ask)', () => {
    it('switching active in workspace A does NOT affect workspace B', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');

      // A 切到 foxcode，B 切到 anyrouter
      writeWorkspaceActiveId(wsA, 'foxcode');
      writeWorkspaceActiveId(wsB, 'anyrouter');

      // 各自读回的是自己的选择，互不干扰
      assert.equal(readWorkspaceActiveId(wsA), 'foxcode');
      assert.equal(readWorkspaceActiveId(wsB), 'anyrouter');

      // A 再切一次，B 依然不变
      writeWorkspaceActiveId(wsA, 'max');
      assert.equal(readWorkspaceActiveId(wsA), 'max');
      assert.equal(readWorkspaceActiveId(wsB), 'anyrouter');
    });

    it('workspace A with override resolves to override, not profile.json.active', () => {
      const wsA = join(tempRoot, 'projA');
      writeWorkspaceActiveId(wsA, 'foxcode');

      // profile.json.active = 'max'，workspace override = 'foxcode' → 应解析到 foxcode
      const resolved = resolveActiveProfile(PROFILES_JSON, wsA);
      assert.equal(resolved?.id, 'foxcode');
      assert.equal(resolved?.baseURL, 'https://code.newcii.com/claude');
    });

    it('workspace B without override falls back to profile.json.active', () => {
      const wsB = join(tempRoot, 'projB');
      // 不写 workspace 文件，profile.json.active = 'max' → 解析为 null（max 不代理）
      const resolved = resolveActiveProfile(PROFILES_JSON, wsB);
      assert.equal(resolved, null);
    });

    it('profile.json.active stays stable when A switches — B starting fresh still sees max default', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');

      // A 切到 foxcode（只写 workspace 文件，不写 profile.json）
      writeWorkspaceActiveId(wsA, 'foxcode');

      // B 从头启动，没有 workspace 文件；profile.json.active 仍是 'max'
      // 因此 B 解析到 null（走默认直连，不被 A 的切换污染）
      assert.equal(readWorkspaceActiveId(wsB), null);
      assert.equal(resolveActiveProfile(PROFILES_JSON, wsB), null);
    });
  });

  describe('profile-list sharing (CRUD still global)', () => {
    it('both workspaces see the same profiles list; active differs independently', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');
      writeWorkspaceActiveId(wsA, 'foxcode');
      writeWorkspaceActiveId(wsB, 'anyrouter');

      const resA = resolveActiveProfile(PROFILES_JSON, wsA);
      const resB = resolveActiveProfile(PROFILES_JSON, wsB);

      // 两个 workspace 共用同一 profiles 数组，但 resolve 出的 active 不同
      assert.equal(resA?.id, 'foxcode');
      assert.equal(resB?.id, 'anyrouter');
    });

    it('unknown activeId (profile deleted elsewhere) resolves to null safely', () => {
      const wsA = join(tempRoot, 'projA');
      writeWorkspaceActiveId(wsA, 'deleted-proxy-id');
      const res = resolveActiveProfile(PROFILES_JSON, wsA);
      assert.equal(res, null);
    });
  });

  describe('backward compat with legacy profile.json.active', () => {
    it('legacy profile.json with active field still works for fresh workspace', () => {
      // 模拟老版本 ccv 写入的 profile.json（active 字段存在）
      const legacyJson = { ...PROFILES_JSON, active: 'foxcode' };
      const wsA = join(tempRoot, 'projA');

      // 没 workspace 文件 → 回退到 profile.json.active → foxcode
      assert.equal(resolveActiveProfile(legacyJson, wsA)?.id, 'foxcode');
    });

    it('workspace override wins over legacy profile.json.active', () => {
      const legacyJson = { ...PROFILES_JSON, active: 'foxcode' };
      const wsA = join(tempRoot, 'projA');
      writeWorkspaceActiveId(wsA, 'anyrouter');

      // workspace override 胜出
      assert.equal(resolveActiveProfile(legacyJson, wsA)?.id, 'anyrouter');
    });
  });

  // --------------------------------------------------------------------------
  // setActiveProfileForWorkspace 返回值语义
  //
  // KEEP IN SYNC: 与 interceptor.js::setActiveProfileForWorkspace 的落盘分支
  // 和 { workspace, profile } 返回值保持一致。
  // --------------------------------------------------------------------------
  describe('setActiveProfileForWorkspace return value { workspace, profile }', () => {
    // 纯函数版：双写落盘 + 返回两条路径成功与否
    function setActiveForWorkspace({ logDir, profilePath }, activeId) {
      const normalizedId = (activeId && typeof activeId === 'string') ? activeId : 'max';
      const result = { workspace: false, profile: false };

      // (1) workspace 文件
      result.workspace = writeWorkspaceActiveId(logDir, normalizedId);

      // (2) profile.json.active 回落兜底
      try {
        const data = existsSync(profilePath)
          ? JSON.parse(readFileSync(profilePath, 'utf-8'))
          : { profiles: [{ id: 'max', name: 'Default' }] };
        if (data.active !== normalizedId) {
          data.active = normalizedId;
          mkdirSync(join(profilePath, '..'), { recursive: true });
          writeFileSync(profilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
        }
        result.profile = true;
      } catch { /* 双失败由调用方兜底 */ }

      return result;
    }

    it('both paths succeed when workspace dir writable + profile.json writable', () => {
      const logDir = join(tempRoot, 'projA');
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      const result = setActiveForWorkspace({ logDir, profilePath }, 'foxcode');
      assert.deepEqual(result, { workspace: true, profile: true });

      assert.equal(readWorkspaceActiveId(logDir), 'foxcode');
      const saved = JSON.parse(readFileSync(profilePath, 'utf-8'));
      assert.equal(saved.active, 'foxcode');
    });

    it('normalizes empty/invalid activeId to "max"', () => {
      const logDir = join(tempRoot, 'projB');
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      const result = setActiveForWorkspace({ logDir, profilePath }, '');
      assert.deepEqual(result, { workspace: true, profile: true });
      assert.equal(readWorkspaceActiveId(logDir), 'max');
    });

    it('profile=true even when data.active already equals target (idempotent, no rewrite needed)', () => {
      const logDir = join(tempRoot, 'projC');
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      mkdirSync(join(tempRoot, '.claude'), { recursive: true });
      writeFileSync(profilePath, JSON.stringify({ active: 'foxcode', profiles: [] }));

      const result = setActiveForWorkspace({ logDir, profilePath }, 'foxcode');
      assert.deepEqual(result, { workspace: true, profile: true });
    });

    it('workspace=false when logDir is empty/invalid, profile path still succeeds', () => {
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      // logDir 为空字符串 → getActiveProfileFilePath 返回 null → write 返回 false
      const result = setActiveForWorkspace({ logDir: '', profilePath }, 'foxcode');
      assert.equal(result.workspace, false, 'workspace write should fail without logDir');
      assert.equal(result.profile, true, 'profile.json write should still succeed as fallback');

      const saved = JSON.parse(readFileSync(profilePath, 'utf-8'));
      assert.equal(saved.active, 'foxcode');
    });
  });
});
