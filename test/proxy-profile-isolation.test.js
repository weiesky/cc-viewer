import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeRoles, mergeActivePayload, resolveRoleProfile } from '../server/lib/interceptor-core.js';

/**
 * Proxy profile per-workspace active 隔离 + 角色分配（{ activeId, roles }）
 *
 * interceptor.js 的 _readWorkspaceActive/_writeWorkspaceActive 依赖模块顶层
 * _projectName/_logDir，直接 import 会引入 fetch 补丁等副作用；本测试的 fs 读写助手
 * 是其等价物，但 **payload 形状/合并/归一全部走 interceptor-core.js 的生产纯函数**
 * （normalizeRoles/mergeActivePayload），角色解析走 resolveRoleProfile —— 语义与生产同源。
 */

// ============================================================================
// fs 读写助手（与 interceptor.js 等价；payload 逻辑委托生产纯函数）
// ============================================================================

function getActiveProfileFilePath(logDir) {
  if (!logDir) return null;
  return join(logDir, 'active-profile.json');
}

function readWorkspaceActive(logDir) {
  const p = getActiveProfileFilePath(logDir);
  const empty = { activeId: null, roles: normalizeRoles(undefined) };
  if (!p) return empty;
  try {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return {
        activeId: typeof data?.activeId === 'string' ? data.activeId : null,
        roles: normalizeRoles(data?.roles),
      };
    }
  } catch { }
  return empty;
}

function readWorkspaceActiveId(logDir) {
  return readWorkspaceActive(logDir).activeId;
}

function writeWorkspaceActive(logDir, activeId, roles) {
  const p = getActiveProfileFilePath(logDir);
  if (!p) return false;
  try {
    mkdirSync(logDir, { recursive: true });
    let existing = null;
    try { if (existsSync(p)) existing = JSON.parse(readFileSync(p, 'utf-8')); } catch { }
    const payload = mergeActivePayload(existing, { activeId, roles });
    const tmp = `${p}.tmp-test`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(tmp, p);
    return true;
  } catch { return false; }
}

// main 角色解析优先级：workspace override > profile.json.active > null
// （_loadProxyProfile 的 main 分支等价物；角色解析不在此复制，直接用 resolveRoleProfile）
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

const FOLLOW_ROLES = { subagent: 'follow', teammate: 'follow' };

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
      assert.equal(writeWorkspaceActive(ws, 'foxcode'), true);
      assert.equal(readWorkspaceActiveId(ws), 'foxcode');
    });

    it('missing file returns null + follow roles', () => {
      const ws = join(tempRoot, 'nonexistent');
      assert.equal(readWorkspaceActiveId(ws), null);
      assert.deepEqual(readWorkspaceActive(ws).roles, FOLLOW_ROLES);
    });

    it('empty logDir returns null without creating a file', () => {
      assert.equal(readWorkspaceActiveId(''), null);
      assert.equal(writeWorkspaceActive('', 'foxcode'), false);
    });

    it('overwrites existing activeId', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode');
      writeWorkspaceActive(ws, 'anyrouter');
      assert.equal(readWorkspaceActiveId(ws), 'anyrouter');
    });

    it('writes { activeId, roles } shape (roles default to follow)', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode');
      const parsed = JSON.parse(readFileSync(join(ws, 'active-profile.json'), 'utf-8'));
      assert.deepEqual(parsed, { activeId: 'foxcode', roles: FOLLOW_ROLES });
    });

    it('reads legacy { activeId }-only file: roles normalize to follow', () => {
      const ws = join(tempRoot, 'projA');
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(ws, 'active-profile.json'), JSON.stringify({ activeId: 'foxcode' }));
      const got = readWorkspaceActive(ws);
      assert.equal(got.activeId, 'foxcode');
      assert.deepEqual(got.roles, FOLLOW_ROLES);
    });

    it('coerces null/non-string activeId to "max" sentinel; undefined preserves stored', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, null);
      assert.equal(readWorkspaceActiveId(ws), 'max');
      writeWorkspaceActive(ws, 123);
      assert.equal(readWorkspaceActiveId(ws), 'max');
      // undefined = 保留现值（合并语义）
      writeWorkspaceActive(ws, 'foxcode');
      writeWorkspaceActive(ws, undefined);
      assert.equal(readWorkspaceActiveId(ws), 'foxcode');
    });

    it('corrupted JSON returns null + follow roles (no crash)', () => {
      const ws = join(tempRoot, 'projA');
      mkdirSync(ws, { recursive: true });
      writeFileSync(join(ws, 'active-profile.json'), 'not json {{{');
      const got = readWorkspaceActive(ws);
      assert.equal(got.activeId, null);
      assert.deepEqual(got.roles, FOLLOW_ROLES);
    });
  });

  describe('roles merge semantics', () => {
    it('writing activeId preserves stored roles', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode', { subagent: 'anyrouter', teammate: 'follow' });
      writeWorkspaceActive(ws, 'anyrouter'); // active-only write
      const got = readWorkspaceActive(ws);
      assert.equal(got.activeId, 'anyrouter');
      assert.deepEqual(got.roles, { subagent: 'anyrouter', teammate: 'follow' });
    });

    it('writing roles preserves stored activeId', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode');
      writeWorkspaceActive(ws, undefined, { subagent: 'anyrouter', teammate: 'max' });
      const got = readWorkspaceActive(ws);
      assert.equal(got.activeId, 'foxcode');
      assert.deepEqual(got.roles, { subagent: 'anyrouter', teammate: 'max' });
    });

    it('per-key role merge: partial roles write preserves the other key', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode', { subagent: 'anyrouter', teammate: 'max' });
      writeWorkspaceActive(ws, undefined, { subagent: 'follow' }); // teammate key absent
      const got = readWorkspaceActive(ws);
      assert.deepEqual(got.roles, { subagent: 'follow', teammate: 'max' });
    });

    it('roles-only write on a file-less workspace OMITS activeId (keeps global fallback alive)', () => {
      const ws = join(tempRoot, 'projFresh');
      // 从未写过 workspace 文件：roles-only 写入不应物化 activeId:'max'
      // （否则切断 profile.json.active 全局回落，把 workspace 静默钉到 Default）
      writeWorkspaceActive(ws, undefined, { subagent: 'anyrouter' });
      const parsed = JSON.parse(readFileSync(join(ws, 'active-profile.json'), 'utf-8'));
      assert.equal('activeId' in parsed, false, '无存储 activeId 时省略该键');
      assert.deepEqual(parsed.roles, { subagent: 'anyrouter', teammate: 'follow' });
      // 读取侧：activeId 缺键 → null → resolveActiveProfile 回落 profile.json.active
      assert.equal(readWorkspaceActiveId(ws), null);
      const legacyJson = { ...PROFILES_JSON, active: 'foxcode' };
      assert.equal(resolveActiveProfile(legacyJson, ws)?.id, 'foxcode', '全局回落仍然生效');
    });

    it('non-object / garbage roles normalize to follow without touching stored keys', () => {
      const ws = join(tempRoot, 'projA');
      writeWorkspaceActive(ws, 'foxcode', { subagent: 'anyrouter' });
      // garbage roles value in the incoming patch → treated as absent (per-key probe)
      writeWorkspaceActive(ws, undefined, 'garbage');
      const got = readWorkspaceActive(ws);
      assert.deepEqual(got.roles, { subagent: 'anyrouter', teammate: 'follow' });
      // unknown keys dropped, non-string values dropped
      writeWorkspaceActive(ws, undefined, { subagent: 42, main: 'x', teammate: 'max' });
      const got2 = readWorkspaceActive(ws);
      assert.deepEqual(got2.roles, { subagent: 'anyrouter', teammate: 'max' });
    });
  });

  describe('cross-workspace isolation (user\'s core ask)', () => {
    it('switching active in workspace A does NOT affect workspace B', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');

      writeWorkspaceActive(wsA, 'foxcode');
      writeWorkspaceActive(wsB, 'anyrouter');

      assert.equal(readWorkspaceActiveId(wsA), 'foxcode');
      assert.equal(readWorkspaceActiveId(wsB), 'anyrouter');

      writeWorkspaceActive(wsA, 'max');
      assert.equal(readWorkspaceActiveId(wsA), 'max');
      assert.equal(readWorkspaceActiveId(wsB), 'anyrouter');
    });

    it('role assignments are workspace-scoped too', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');
      writeWorkspaceActive(wsA, 'foxcode', { subagent: 'anyrouter' });
      writeWorkspaceActive(wsB, 'anyrouter');

      assert.deepEqual(readWorkspaceActive(wsA).roles, { subagent: 'anyrouter', teammate: 'follow' });
      assert.deepEqual(readWorkspaceActive(wsB).roles, FOLLOW_ROLES);
    });

    it('workspace A with override resolves to override, not profile.json.active', () => {
      const wsA = join(tempRoot, 'projA');
      writeWorkspaceActive(wsA, 'foxcode');

      const resolved = resolveActiveProfile(PROFILES_JSON, wsA);
      assert.equal(resolved?.id, 'foxcode');
      assert.equal(resolved?.baseURL, 'https://code.newcii.com/claude');
    });

    it('workspace B without override falls back to profile.json.active', () => {
      const wsB = join(tempRoot, 'projB');
      const resolved = resolveActiveProfile(PROFILES_JSON, wsB);
      assert.equal(resolved, null);
    });

    it('profile.json.active stays stable when A switches — B starting fresh still sees max default', () => {
      const wsA = join(tempRoot, 'projA');
      const wsB = join(tempRoot, 'projB');

      writeWorkspaceActive(wsA, 'foxcode');

      assert.equal(readWorkspaceActiveId(wsB), null);
      assert.equal(resolveActiveProfile(PROFILES_JSON, wsB), null);
    });
  });

  describe('role resolution (resolveRoleProfile, production import)', () => {
    const byId = new Map(PROFILES_JSON.profiles.map(p => [p.id, p]));
    const main = PROFILES_JSON.profiles[1]; // foxcode

    it('main role returns mainProfile', () => {
      assert.equal(resolveRoleProfile('main', FOLLOW_ROLES, byId, main), main);
      assert.equal(resolveRoleProfile('main', FOLLOW_ROLES, byId, null), null);
    });

    it('follow / missing key resolves to mainProfile', () => {
      assert.equal(resolveRoleProfile('subagent', FOLLOW_ROLES, byId, main), main);
      assert.equal(resolveRoleProfile('teammate', {}, byId, main), main);
    });

    it("'max' resolves to null (explicit Default = no rewrite)", () => {
      assert.equal(resolveRoleProfile('subagent', { subagent: 'max' }, byId, main), null);
    });

    it('explicit id resolves to that profile', () => {
      assert.equal(resolveRoleProfile('teammate', { teammate: 'anyrouter' }, byId, main)?.id, 'anyrouter');
    });

    it('dangling id (profile deleted) resolves to mainProfile (follow semantics)', () => {
      assert.equal(resolveRoleProfile('subagent', { subagent: 'deleted-id' }, byId, main), main);
    });
  });

  describe('backward compat with legacy profile.json.active', () => {
    it('legacy profile.json with active field still works for fresh workspace', () => {
      const legacyJson = { ...PROFILES_JSON, active: 'foxcode' };
      const wsA = join(tempRoot, 'projA');
      assert.equal(resolveActiveProfile(legacyJson, wsA)?.id, 'foxcode');
    });

    it('workspace override wins over legacy profile.json.active', () => {
      const legacyJson = { ...PROFILES_JSON, active: 'foxcode' };
      const wsA = join(tempRoot, 'projA');
      writeWorkspaceActive(wsA, 'anyrouter');
      assert.equal(resolveActiveProfile(legacyJson, wsA)?.id, 'anyrouter');
    });
  });

  // --------------------------------------------------------------------------
  // setActiveProfileForWorkspace 返回值语义（含 roles 合并；payload 走生产纯函数）
  // --------------------------------------------------------------------------
  describe('setActiveProfileForWorkspace return value { workspace, profile }', () => {
    // 与 interceptor.js::setActiveProfileForWorkspace 等价：双写落盘 + 返回两条路径成功与否。
    // activeId=undefined 时不写 profile.json（roles-only 调用不 bump 全局回退）。
    function setActiveForWorkspace({ logDir, profilePath }, activeId, roles) {
      const result = { workspace: false, profile: false };

      // (1) workspace 文件（合并写）
      result.workspace = writeWorkspaceActive(logDir, activeId, roles);

      // (2) profile.json.active 回落兜底（仅显式设置 main 时）
      if (activeId !== undefined) {
        const normalizedId = (activeId && typeof activeId === 'string') ? activeId : 'max';
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
      }

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

    it('roles-only write: workspace merges roles, profile.json untouched', () => {
      const logDir = join(tempRoot, 'projC');
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      setActiveForWorkspace({ logDir, profilePath }, 'foxcode');
      const result = setActiveForWorkspace({ logDir, profilePath }, undefined, { subagent: 'anyrouter' });
      assert.deepEqual(result, { workspace: true, profile: false });

      const got = readWorkspaceActive(logDir);
      assert.equal(got.activeId, 'foxcode'); // 保留
      assert.deepEqual(got.roles, { subagent: 'anyrouter', teammate: 'follow' });
      const saved = JSON.parse(readFileSync(profilePath, 'utf-8'));
      assert.equal(saved.active, 'foxcode'); // 未被 roles-only 调用改动
    });

    it('profile=true even when data.active already equals target (idempotent, no rewrite needed)', () => {
      const logDir = join(tempRoot, 'projD');
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      mkdirSync(join(tempRoot, '.claude'), { recursive: true });
      writeFileSync(profilePath, JSON.stringify({ active: 'foxcode', profiles: [] }));

      const result = setActiveForWorkspace({ logDir, profilePath }, 'foxcode');
      assert.deepEqual(result, { workspace: true, profile: true });
    });

    it('workspace=false when logDir is empty/invalid, profile path still succeeds', () => {
      const profilePath = join(tempRoot, '.claude', 'profile.json');
      const result = setActiveForWorkspace({ logDir: '', profilePath }, 'foxcode');
      assert.equal(result.workspace, false, 'workspace write should fail without logDir');
      assert.equal(result.profile, true, 'profile.json write should still succeed as fallback');

      const saved = JSON.parse(readFileSync(profilePath, 'utf-8'));
      assert.equal(saved.active, 'foxcode');
    });
  });
});
