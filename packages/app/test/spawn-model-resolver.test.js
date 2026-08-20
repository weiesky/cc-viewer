// resolveSpawnModel（server/lib/spawn-model-resolver.js）：spawn 时「当前生效配置」模型解析。
// 全部数据根经 opts 注入 mkdtemp 临时目录 + fake env，绝不读真实用户数据。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'ccv-spawn-model-'));
process.env.CCV_LOG_DIR = tmp; // 防御性：本文件全程走 opts 注入，此行只是双保险

let resolveSpawnModel;
before(async () => {
  ({ resolveSpawnModel } = await import('../server/lib/spawn-model-resolver.js'));
});
after(() => { rmSync(tmp, { recursive: true, force: true }); });

// 每用例独立数据根，避免跨用例文件串扰。
let seq = 0;
function mkRoots() {
  const root = join(tmp, `case-${seq++}`);
  const logDir = join(root, 'log');
  const configDir = join(root, 'config');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  return { logDir, configDir, opts: { logDir, configDir } };
}
function writeSettings(configDir, obj) {
  writeFileSync(join(configDir, 'settings.json'), JSON.stringify(obj));
}
function writeProfiles(logDir, obj) {
  writeFileSync(join(logDir, 'profile.json'), JSON.stringify(obj));
}
function writeWorkspaceActive(logDir, spawnDir, activeId) {
  // 与 resolver/interceptor 相同的清洗规则
  const projectName = spawnDir.split('/').pop().replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(logDir, projectName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'active-profile.json'), JSON.stringify({ activeId }));
}

describe('resolveSpawnModel: base model 优先级', () => {
  it('env.CLAUDE_MODEL > env.ANTHROPIC_MODEL > settings.env.ANTHROPIC_MODEL > settings.model', () => {
    const { configDir, opts } = mkRoots();
    writeSettings(configDir, { model: 'm-settings', env: { ANTHROPIC_MODEL: 'm-settings-env' } });
    assert.equal(resolveSpawnModel('/ws', { CLAUDE_MODEL: 'm-claude', ANTHROPIC_MODEL: 'm-anthropic' }, opts), 'm-claude');
    assert.equal(resolveSpawnModel('/ws', { ANTHROPIC_MODEL: 'm-anthropic' }, opts), 'm-anthropic');
    assert.equal(resolveSpawnModel('/ws', {}, opts), 'm-settings-env', 'settings.env 压过顶层 model');
  });

  it('settings.json 只有顶层 model 时用它；无任何信号 → null', () => {
    const { configDir, opts } = mkRoots();
    writeSettings(configDir, { model: 'claude-fable-5[1m]' });
    assert.equal(resolveSpawnModel('/ws', {}, opts), 'claude-fable-5[1m]');
    const bare = mkRoots(); // 无 settings.json / profile.json
    assert.equal(resolveSpawnModel('/ws', {}, bare.opts), null);
  });

  it("别名 'default'（任意大小写）不作为信号；损坏的 settings.json → 无信号", () => {
    const { configDir, opts } = mkRoots();
    writeSettings(configDir, { model: 'Default' });
    assert.equal(resolveSpawnModel('/ws', {}, opts), null);
    const bad = mkRoots();
    writeFileSync(join(bad.configDir, 'settings.json'), '{not json');
    assert.equal(resolveSpawnModel('/ws', {}, bad.opts), null);
  });
});

describe('resolveSpawnModel: 三方 profile', () => {
  const PROFILES = {
    active: 'ds',
    profiles: [
      { id: 'max', name: 'Default' },
      { id: 'ds', name: 'DeepSeek', ANTHROPIC_MODEL: 'deepseek-v4-pro', ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-opus-slot' },
    ],
  };

  it('base 属 fable 家族 → 映射到 profile 主模型 ANTHROPIC_MODEL', () => {
    const { logDir, configDir, opts } = mkRoots();
    writeProfiles(logDir, PROFILES);
    writeSettings(configDir, { model: 'claude-fable-5[1m]' });
    assert.equal(resolveSpawnModel('/ws', {}, opts), 'deepseek-v4-pro');
  });

  it('base 属 opus 家族 → 映射到 opus 槽位；家族槽位留空 → ANTHROPIC_MODEL 兜底', () => {
    const { logDir, opts } = mkRoots();
    writeProfiles(logDir, PROFILES);
    assert.equal(resolveSpawnModel('/ws', { ANTHROPIC_MODEL: 'claude-opus-4-8' }, opts), 'deepseek-v4-opus-slot');
    // sonnet 槽位未配置 → ANTHROPIC_MODEL(deepseek-v4-pro) 兜底
    assert.equal(resolveSpawnModel('/ws', { ANTHROPIC_MODEL: 'claude-sonnet-5' }, opts), 'deepseek-v4-pro');
  });

  it('base 无信号 + profile 激活 → 用 profile 主模型；主模型空则回退旧 activeModel', () => {
    const { logDir, opts } = mkRoots();
    writeProfiles(logDir, PROFILES);
    assert.equal(resolveSpawnModel('/ws', {}, opts), 'deepseek-v4-pro');
    const legacy = mkRoots();
    writeProfiles(legacy.logDir, { active: 'old', profiles: [{ id: 'old', name: 'Legacy', activeModel: 'glm-5.2' }] });
    assert.equal(resolveSpawnModel('/ws', {}, legacy.opts), 'glm-5.2');
  });

  it("active='max' / 指向不存在的 id / profile.json 损坏 → 视为无 profile", () => {
    const a = mkRoots();
    writeProfiles(a.logDir, { active: 'max', profiles: PROFILES.profiles });
    assert.equal(resolveSpawnModel('/ws', { ANTHROPIC_MODEL: 'claude-fable-5' }, a.opts), 'claude-fable-5');
    const b = mkRoots();
    writeProfiles(b.logDir, { active: 'ghost', profiles: PROFILES.profiles });
    assert.equal(resolveSpawnModel('/ws', {}, b.opts), null, '指向已删除的 profile id → 无 profile 无 base → null');
    const c = mkRoots();
    writeFileSync(join(c.logDir, 'profile.json'), '{broken');
    assert.equal(resolveSpawnModel('/ws', {}, c.opts), null);
  });

  it('profiles 缺失/非数组 → 视为无 profile；spawnDir 为空 → 跳过 workspace 查找走全局 active', () => {
    const a = mkRoots();
    writeProfiles(a.logDir, { active: 'ds', profiles: 'not-an-array' });
    assert.equal(resolveSpawnModel('/ws', { ANTHROPIC_MODEL: 'claude-fable-5' }, a.opts), 'claude-fable-5');
    const b = mkRoots();
    writeProfiles(b.logDir, { active: 'ds', profiles: [{ id: 'ds', name: 'DeepSeek', ANTHROPIC_MODEL: 'deepseek-v4-pro' }] });
    assert.equal(resolveSpawnModel(undefined, {}, b.opts), 'deepseek-v4-pro', '无 spawnDir 时仍按全局 active 解析');
  });

  it('workspace active-profile.json 覆盖全局 active；basename 清洗与 interceptor 一致', () => {
    const { logDir, opts } = mkRoots();
    writeProfiles(logDir, {
      active: 'max',
      profiles: [{ id: 'max', name: 'Default' }, { id: 'ds', name: 'DeepSeek', ANTHROPIC_MODEL: 'deepseek-v4-pro' }],
    });
    // spawnDir 带需清洗的字符（空格→_），workspace 文件按清洗后的目录名落位
    const spawnDir = '/Users/x/my project';
    writeWorkspaceActive(logDir, spawnDir, 'ds');
    assert.equal(resolveSpawnModel(spawnDir, {}, opts), 'deepseek-v4-pro', 'workspace override 生效');
    assert.equal(resolveSpawnModel('/Users/x/other', {}, opts), null, '其他 workspace 仍走全局 max → 无 profile');
  });

  it('新 shape { activeId, roles }：roles 字段不影响 main 角色读取（pin）', () => {
    const { logDir, opts } = mkRoots();
    writeProfiles(logDir, {
      active: 'max',
      profiles: [{ id: 'max', name: 'Default' }, { id: 'ds', name: 'DeepSeek', ANTHROPIC_MODEL: 'deepseek-v4-pro' }],
    });
    const spawnDir = '/Users/x/role proj';
    // 直接写新格式文件（含 roles）——spawn 解析只认 activeId（main 角色），roles 必须被忽略
    const projectName = spawnDir.split('/').pop().replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const dir = join(logDir, projectName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'active-profile.json'), JSON.stringify({
      activeId: 'ds',
      roles: { subagent: 'whatever', teammate: 'max' },
    }));
    assert.equal(resolveSpawnModel(spawnDir, {}, opts), 'deepseek-v4-pro', 'spawn 注入恒走 main 角色，roles 不参与');
  });
});
