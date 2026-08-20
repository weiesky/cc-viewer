import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { skillToDisplayName, mergeActiveSkills } from '../src/utils/skillsParser.js';

describe('skillToDisplayName', () => {
  it('plugin with pluginName "short@marketplace" → "short:name"', () => {
    assert.equal(
      skillToDisplayName({ name: 'skill-creator', source: 'plugin', pluginName: 'skill-creator@claude-plugins-official' }),
      'skill-creator:skill-creator',
    );
  });

  it('plugin without @ in pluginName → falls back to bare name', () => {
    assert.equal(
      skillToDisplayName({ name: 'foo', source: 'plugin', pluginName: 'legacy-no-marketplace' }),
      'foo',
    );
  });

  it('plugin missing pluginName → falls back to bare name', () => {
    assert.equal(skillToDisplayName({ name: 'foo', source: 'plugin' }), 'foo');
  });

  it('source=user → bare name', () => {
    assert.equal(skillToDisplayName({ name: 'config-sync', source: 'user' }), 'config-sync');
  });

  it('source=project → bare name', () => {
    assert.equal(skillToDisplayName({ name: 'dev-lifecycle', source: 'project' }), 'dev-lifecycle');
  });

  it('null / missing name → empty string', () => {
    assert.equal(skillToDisplayName(null), '');
    assert.equal(skillToDisplayName({}), '');
    assert.equal(skillToDisplayName({ source: 'user' }), '');
  });
});

describe('mergeActiveSkills', () => {
  it('fsSkills=null → returns null (caller falls back)', () => {
    assert.equal(mergeActiveSkills(null, []), null);
    assert.equal(mergeActiveSkills(undefined, []), null);
  });

  it('empty fsSkills → empty array', () => {
    assert.deepEqual(mergeActiveSkills([], []), []);
  });

  it('filters out disabled skills', () => {
    const fs = [
      { name: 'a', source: 'user', enabled: true, description: 'da' },
      { name: 'b', source: 'user', enabled: false, description: 'db' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'a', description: 'da' }]);
  });

  it('filters out builtin source entries', () => {
    const fs = [
      { name: 'init', source: 'builtin', enabled: true, description: null },
      { name: 'x', source: 'user', enabled: true, description: 'dx' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'x', description: 'dx' }]);
  });

  it('filters out entries whose display name is in BUILTIN_SKILL_NAMES even when source claims user', () => {
    // 防御性：即使 listSkills 返回一个名叫 `init` 的 user skill（极端情况），也不显示。
    const fs = [
      { name: 'init', source: 'user', enabled: true, description: 'd' },
      { name: 'keep', source: 'user', enabled: true, description: 'dk' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'keep', description: 'dk' }]);
  });

  it('dedups user + project with same bare name (later entry wins)', () => {
    const fs = [
      { name: 'foo', source: 'user', enabled: true, description: 'user-desc' },
      { name: 'foo', source: 'project', enabled: true, description: 'project-desc' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'foo', description: 'project-desc' }]);
  });

  it('plugin + user with same bare name → kept separately (different display names)', () => {
    const fs = [
      { name: 'creator', source: 'user', enabled: true, description: 'u' },
      { name: 'creator', source: 'plugin', enabled: true, pluginName: 'creator@marketplace', description: 'p' },
    ];
    const result = mergeActiveSkills(fs, []);
    assert.equal(result.length, 2);
    assert.deepEqual(result.find(r => r.name === 'creator'), { name: 'creator', description: 'u' });
    assert.deepEqual(result.find(r => r.name === 'creator:creator'), { name: 'creator:creator', description: 'p' });
  });

  it('plugin fallback to bare name (missing @) + user same name → dedup, later wins', () => {
    // 防御性：pluginName 缺 @ 时 skillToDisplayName 退化到裸名，此时 plugin 和 user 会撞 key。
    // listSkills 输出顺序 user→project→plugin，所以 plugin 后到，应当覆盖 user。
    const fs = [
      { name: 'foo', source: 'user', enabled: true, description: 'user-d' },
      { name: 'foo', source: 'plugin', enabled: true, pluginName: 'no-marketplace', description: 'plugin-d' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'foo', description: 'plugin-d' }]);
  });

  it('description priority: fs → historical → empty', () => {
    const fs = [
      { name: 'a', source: 'user', enabled: true, description: 'from-fs' },
      { name: 'b', source: 'user', enabled: true, description: null },
      { name: 'c', source: 'user', enabled: true, description: '' },
    ];
    const historical = [
      { name: 'a', description: 'from-history' },
      { name: 'b', description: 'from-history-b' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, historical), [
      { name: 'a', description: 'from-fs' },
      { name: 'b', description: 'from-history-b' },
      { name: 'c', description: '' },
    ]);
  });

  it('plugin displayName uses historical desc via normalized name', () => {
    // 历史 system-reminder 里写的是 `creator:foo`，fs 条目里 SKILL.md 没 desc → 应当从历史取
    const fs = [
      { name: 'foo', source: 'plugin', enabled: true, pluginName: 'creator@mkt', description: null },
    ];
    const historical = [
      { name: 'creator:foo', description: 'hist-desc' },
    ];
    assert.deepEqual(mergeActiveSkills(fs, historical), [
      { name: 'creator:foo', description: 'hist-desc' },
    ]);
  });

  it('ignores null / malformed entries without crashing', () => {
    const fs = [null, undefined, { source: 'user', enabled: true }, { name: 'ok', source: 'user', enabled: true, description: 'd' }];
    assert.deepEqual(mergeActiveSkills(fs, []), [{ name: 'ok', description: 'd' }]);
  });
});
