/**
 * resolveProfileModel + migrateProxyProfile 单测 —— proxy 热切换按家族映射模型 + 旧配置迁移。
 *
 * resolveProfileModel：按 body.model 家族（opus/sonnet/haiku）映射到 profile 对应字段，
 * fable/mythos/未识别 → ANTHROPIC_MODEL 兜底；无新字段但有 activeModel（旧数据）→ 整体替换回退。
 * 家族字段优先于 ANTHROPIC_MODEL；字段留空时回落到 ANTHROPIC_MODEL。
 * [1m] 后缀默认忽略（剥除后比较）。
 * 目标为空 / 等于旧值 / 入参非法 → null（不改写）。
 * migrate*：老 { models, activeModel } → ANTHROPIC_MODEL，幂等。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfileModel, migrateProxyProfile, migrateProxyProfileList } from '../server/lib/interceptor-core.js';

describe('resolveProfileModel', () => {
  const fam = {
    ANTHROPIC_MODEL: 'PRIMARY',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'OPUS-T',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'SONNET-T',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'HAIKU-T',
  };

  it('opus 家族 → OPUS 字段', () => {
    assert.equal(resolveProfileModel('claude-opus-4-8', fam), 'OPUS-T');
  });
  it('sonnet 家族 → SONNET 字段', () => {
    assert.equal(resolveProfileModel('claude-sonnet-4-6', fam), 'SONNET-T');
  });
  it('haiku 家族 → HAIKU 字段', () => {
    assert.equal(resolveProfileModel('claude-3-5-haiku-20241022', fam), 'HAIKU-T');
  });
  it('fable / mythos → ANTHROPIC_MODEL（显式家族）', () => {
    assert.equal(resolveProfileModel('claude-fable-5', fam), 'PRIMARY');
    assert.equal(resolveProfileModel('mythos-1', fam), 'PRIMARY');
  });
  it('未识别家族 → ANTHROPIC_MODEL 兜底（热切换开启时）', () => {
    assert.equal(resolveProfileModel('some-random-model', fam), 'PRIMARY');
    assert.equal(resolveProfileModel('gpt-4o', fam), 'PRIMARY');
    assert.equal(resolveProfileModel('K3', fam), 'PRIMARY'); // K3/kimi alias → PRIMARY
    assert.equal(resolveProfileModel('deepseek-v4', fam), 'PRIMARY');
  });
  it('未识别家族 + 无 ANTHROPIC_MODEL → null（无兜底目标）', () => {
    const noPrimary = { ANTHROPIC_DEFAULT_OPUS_MODEL: 'OPUS-T' };
    assert.equal(resolveProfileModel('some-random-model', noPrimary), null);
    assert.equal(resolveProfileModel('gpt-4o', noPrimary), null);
  });
  it('家族字段留空 → 回落到 ANTHROPIC_MODEL', () => {
    const partial = { ANTHROPIC_MODEL: 'PRIMARY', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'HAIKU-T' };
    assert.equal(resolveProfileModel('claude-opus-4-8', partial), 'PRIMARY');   // opus 空 → PRIMARY 兜底
    assert.equal(resolveProfileModel('claude-sonnet-4', partial), 'PRIMARY');   // sonnet 空 → PRIMARY 兜底
    assert.equal(resolveProfileModel('claude-3-5-haiku', partial), 'HAIKU-T');  // haiku 有专属字段
    assert.equal(resolveProfileModel('claude-fable-5', partial), 'PRIMARY');
  });
  it('ANTHROPIC_MODEL 留空 + 家族字段留空 → 该家族不替换（null）', () => {
    // Only HAIKU field set, no PRIMARY, opus/sonnet both empty → no fallback target
    const haikuOnly = { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'HAIKU-T' };
    assert.equal(resolveProfileModel('claude-opus-4-8', haikuOnly), null);
    assert.equal(resolveProfileModel('claude-sonnet-4', haikuOnly), null);
    assert.equal(resolveProfileModel('claude-3-5-haiku', haikuOnly), 'HAIKU-T');
  });
  it('[1m] suffix in profile fields is stripped before comparison', () => {
    const with1m = {
      ANTHROPIC_MODEL: 'claude-sonnet-5[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8[1m]',
    };
    assert.equal(resolveProfileModel('claude-fable-5', with1m), 'claude-sonnet-5');
    // opus field strips to 'claude-opus-4-8' which equals oldModel → null (no-op)
    assert.equal(resolveProfileModel('claude-opus-4-8', with1m), null);
  });
  it('[1m] suffix case-insensitive strip', () => {
    assert.equal(
      resolveProfileModel('claude-opus-4-8', { ANTHROPIC_DEFAULT_OPUS_MODEL: 'CLAUDE-OPUS-4[1M]' }),
      'CLAUDE-OPUS-4'
    );
  });
  it('K3[1m] → strips to K3', () => {
    assert.equal(
      resolveProfileModel('gpt-4o', { ANTHROPIC_MODEL: 'K3[1m]' }),
      'K3'
    );
  });
  it('target equals oldModel after [1m] strip → null (no-op)', () => {
    // Profile field carries [1m], oldModel doesn't → no-op
    assert.equal(resolveProfileModel('my-model', { ANTHROPIC_MODEL: 'my-model[1m]' }), null);
    // Both oldModel and profile field carry [1m] → symmetric strip → no-op
    assert.equal(resolveProfileModel('claude-opus-4-8[1m]', { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8[1m]' }), null);
    // oldModel carries [1m], profile field doesn't → no-op (oldModel also stripped before compare)
    assert.equal(resolveProfileModel('claude-opus-4-8[1m]', { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8' }), null);
  });
  it('目标等于旧值 → null（无需改写）', () => {
    // fable 命中 primary，且旧值已是 PRIMARY
    assert.equal(resolveProfileModel('PRIMARY', fam), null);
  });
  it('大小写不敏感家族匹配', () => {
    assert.equal(resolveProfileModel('Claude-OPUS-4', fam), 'OPUS-T');
  });
  it('优先级：opus 在 sonnet/haiku 之前判定（含 opus 即命中 opus）', () => {
    assert.equal(resolveProfileModel('claude-opus-4-8', fam), 'OPUS-T');
  });
  it('legacy 回退：无新字段但有 activeModel → 整体替换', () => {
    assert.equal(resolveProfileModel('claude-opus-4-8', { activeModel: 'LEGACY-T' }), 'LEGACY-T');
    assert.equal(resolveProfileModel('anything', { activeModel: 'LEGACY-T' }), 'LEGACY-T');
  });
  it('legacy activeModel 等于旧值 → null', () => {
    assert.equal(resolveProfileModel('LEGACY-T', { activeModel: 'LEGACY-T' }), null);
  });
  it('新字段存在时忽略 legacy activeModel', () => {
    const mixed = { ANTHROPIC_MODEL: 'PRIMARY', activeModel: 'LEGACY-T' };
    assert.equal(resolveProfileModel('claude-fable-5', mixed), 'PRIMARY');
    // opus 无字段 → PRIMARY 兜底（不回退到 legacy）
    assert.equal(resolveProfileModel('claude-opus-4-8', mixed), 'PRIMARY');
  });
  it('空 profile / 空 model / 非法入参 → null', () => {
    assert.equal(resolveProfileModel('claude-opus-4-8', {}), null);
    assert.equal(resolveProfileModel('', fam), null);
    assert.equal(resolveProfileModel(null, fam), null);
    assert.equal(resolveProfileModel('claude-opus-4-8', null), null);
  });
  it('字段值含前后空白 → trim 后使用', () => {
    assert.equal(resolveProfileModel('claude-opus-4-8', { ANTHROPIC_DEFAULT_OPUS_MODEL: '  OPUS-T  ' }), 'OPUS-T');
  });
});

describe('migrateProxyProfile / migrateProxyProfileList', () => {
  it('老 profile：activeModel 回填全部四个模型字段，丢弃 models/activeModel（保留整体替换语义）', () => {
    const { profile, changed } = migrateProxyProfile({ id: 'p1', name: 'x', baseURL: 'u', apiKey: 'k', models: ['m1'], activeModel: 'm1' });
    assert.equal(changed, true);
    assert.equal(profile.ANTHROPIC_MODEL, 'm1');
    assert.equal(profile.ANTHROPIC_DEFAULT_OPUS_MODEL, 'm1');
    assert.equal(profile.ANTHROPIC_DEFAULT_SONNET_MODEL, 'm1');
    assert.equal(profile.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'm1');
    assert.ok(!('models' in profile));
    assert.ok(!('activeModel' in profile));
    assert.equal(profile.id, 'p1');
    assert.equal(profile.baseURL, 'u');
  });
  it('迁移后整体替换语义仍成立：任意家族都命中 activeModel', () => {
    const { profile } = migrateProxyProfile({ id: 'p1', activeModel: 'ONE' });
    assert.equal(resolveProfileModel('claude-opus-4-8', profile), 'ONE');
    assert.equal(resolveProfileModel('claude-sonnet-4', profile), 'ONE');
    assert.equal(resolveProfileModel('claude-3-5-haiku', profile), 'ONE');
    assert.equal(resolveProfileModel('claude-fable-5', profile), 'ONE');
  });
  it('已有部分字段时不覆盖，仅回填空缺项', () => {
    const { profile, changed } = migrateProxyProfile({ id: 'p1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'KEEP', activeModel: 'OLD', models: [] });
    assert.equal(changed, true);
    assert.equal(profile.ANTHROPIC_DEFAULT_OPUS_MODEL, 'KEEP'); // 不被覆盖
    assert.equal(profile.ANTHROPIC_MODEL, 'OLD');               // 空缺回填
    assert.equal(profile.ANTHROPIC_DEFAULT_SONNET_MODEL, 'OLD');
    assert.equal(profile.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'OLD');
    assert.ok(!('activeModel' in profile));
  });
  it('只有 models（无 activeModel）→ 丢弃 models，不设 ANTHROPIC_MODEL', () => {
    const { profile, changed } = migrateProxyProfile({ id: 'p1', models: ['m1', 'm2'] });
    assert.equal(changed, true);
    assert.ok(!('models' in profile));
    assert.ok(!('ANTHROPIC_MODEL' in profile));
  });
  it('无遗留字段 → 原样返回、changed=false（幂等）', () => {
    const input = { id: 'p1', name: 'x', ANTHROPIC_MODEL: 'PRIMARY', ANTHROPIC_DEFAULT_OPUS_MODEL: 'O' };
    const { profile, changed } = migrateProxyProfile(input);
    assert.equal(changed, false);
    assert.equal(profile, input);
  });
  it('空 activeModel 字符串 → 不设 ANTHROPIC_MODEL', () => {
    const { profile } = migrateProxyProfile({ id: 'p1', activeModel: '   ' });
    assert.ok(!('ANTHROPIC_MODEL' in profile));
  });
  it('列表迁移：任一变更即 changed=true，max 保持不变', () => {
    const { profiles, changed } = migrateProxyProfileList([
      { id: 'max', name: 'Default' },
      { id: 'p1', activeModel: 'm1' },
    ]);
    assert.equal(changed, true);
    assert.deepEqual(profiles[0], { id: 'max', name: 'Default' });
    assert.equal(profiles[1].ANTHROPIC_MODEL, 'm1');
  });
  it('列表全为新格式 → changed=false', () => {
    const { changed } = migrateProxyProfileList([{ id: 'max', name: 'Default' }, { id: 'p1', ANTHROPIC_MODEL: 'x' }]);
    assert.equal(changed, false);
  });
  it('非数组入参 → 原样返回', () => {
    assert.deepEqual(migrateProxyProfileList(null), { profiles: null, changed: false });
  });
});
