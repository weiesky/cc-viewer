// 锁定 slashCommandMenu 纯函数的契约:
//  - getSlashMenuContext 的触发/关闭规则(光标在命令 token 内、无前置空白)
//  - normalizeSdkCommands 的安全过滤(去 /、去非法/重复名、保留 aliases)
//  - buildSlashMenuModel 的分组优先级(/api/skills source 映射 > 内置名集合 > 个人兜底)
//  - composeOutgoingText 让 slash 命令始终位于消息开头
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSlashMenuContext,
  normalizeSdkCommands,
  fsSkillsToMenuItems,
  buildSlashMenuModel,
  composeOutgoingText,
  PERSONAL_SKILL_GROUP_KEY,
  BUILTIN_SKILL_GROUP_KEY,
} from '../src/utils/slashCommandMenu.js';

describe('getSlashMenuContext', () => {
  it('opens on a bare leading slash', () => {
    assert.deepEqual(getSlashMenuContext('/', 1), { query: '' });
  });

  it('returns the query up to the caret', () => {
    assert.deepEqual(getSlashMenuContext('/rev', 4), { query: 'rev' });
    // caret mid-token → only the text before the caret is the query
    assert.deepEqual(getSlashMenuContext('/review', 4), { query: 'rev' });
  });

  it('closes when caret is at position 0', () => {
    assert.equal(getSlashMenuContext('/review', 0), null);
  });

  it('closes when text does not start with /', () => {
    assert.equal(getSlashMenuContext('review', 6), null);
    assert.equal(getSlashMenuContext('x/review', 8), null);
  });

  it('closes once whitespace appears before the caret (token ended)', () => {
    assert.equal(getSlashMenuContext('/review arg', 8), null);
    assert.equal(getSlashMenuContext('/review ', 8), null);
  });

  it('closes on any linebreak / tab before the caret', () => {
    assert.equal(getSlashMenuContext('/rev\n', 5), null);
    assert.equal(getSlashMenuContext('/rev\t', 5), null);
    assert.equal(getSlashMenuContext('/rev ', 5), null);
    assert.equal(getSlashMenuContext('/rev ', 5), null);
  });

  it('defaults caret to end of string when omitted', () => {
    assert.deepEqual(getSlashMenuContext('/abc'), { query: 'abc' });
  });

  it('returns null for non-string input', () => {
    assert.equal(getSlashMenuContext(null), null);
    assert.equal(getSlashMenuContext(undefined), null);
    assert.equal(getSlashMenuContext(123), null);
  });
});

describe('normalizeSdkCommands', () => {
  it('strips a leading slash and keeps description/argumentHint/aliases', () => {
    const out = normalizeSdkCommands([
      { name: '/review', description: 'Review a PR', argumentHint: '<pr>', aliases: ['/code-review'] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'review');
    assert.equal(out[0].description, 'Review a PR');
    assert.equal(out[0].argumentHint, '<pr>');
    assert.deepEqual(out[0].aliases, ['code-review']);
  });

  it('drops empty, non-string, and unsafe names', () => {
    const out = normalizeSdkCommands([
      { name: '' },
      { name: 123 },
      { name: 'bad name' },
      { name: 'bad\nname' },
      { name: 'good-one' },
      {},
      null,
    ]);
    assert.deepEqual(out.map(c => c.name), ['good-one']);
  });

  it('dedupes by name, first occurrence wins', () => {
    const out = normalizeSdkCommands([
      { name: 'review', description: 'first' },
      { name: 'review', description: 'second' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].description, 'first');
  });

  it('returns [] for non-array input', () => {
    assert.deepEqual(normalizeSdkCommands(null), []);
    assert.deepEqual(normalizeSdkCommands('x'), []);
  });
});

describe('fsSkillsToMenuItems', () => {
  it('maps user/project/plugin to personal and builtin to builtin', () => {
    const out = fsSkillsToMenuItems([
      { name: 'my-skill', source: 'user', enabled: true, description: 'mine' },
      { name: 'proj-skill', source: 'project', enabled: true, description: 'proj' },
      { name: 'plug', source: 'plugin', pluginName: 'acme@market', enabled: true, description: 'p' },
      { name: 'review', source: 'builtin', enabled: true, description: null },
    ]);
    const byName = Object.fromEntries(out.map(i => [i.name, i]));
    assert.equal(byName['my-skill'].group, PERSONAL_SKILL_GROUP_KEY);
    assert.equal(byName['proj-skill'].group, PERSONAL_SKILL_GROUP_KEY);
    assert.equal(byName['acme:plug'].group, PERSONAL_SKILL_GROUP_KEY);
    assert.equal(byName['review'].group, BUILTIN_SKILL_GROUP_KEY);
  });

  it('skips disabled skills', () => {
    const out = fsSkillsToMenuItems([{ name: 'off', source: 'user', enabled: false }]);
    assert.equal(out.length, 0);
  });

  it('fills builtin description from the local table when server ships null', () => {
    const out = fsSkillsToMenuItems([{ name: 'review', source: 'builtin', enabled: true, description: null }]);
    assert.ok(out[0].description.length > 0);
  });
});

describe('buildSlashMenuModel', () => {
  const fsSkills = [
    { name: 'my-skill', source: 'user', enabled: true, description: 'my own' },
    { name: 'review', source: 'builtin', enabled: true, description: null },
  ];

  it('uses SDK order when sdkReady, groups personal before builtin, flatIndex continuous', () => {
    const sdkCommands = normalizeSdkCommands([
      { name: 'review', description: 'builtin review' },
      { name: 'my-skill', description: 'mine' },
      { name: 'zzz-custom', description: 'zzz' },
    ]);
    const model = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills, query: '' });
    assert.equal(model.source, 'sdk');
    assert.equal(model.groups[0].key, PERSONAL_SKILL_GROUP_KEY);
    assert.equal(model.groups[1].key, BUILTIN_SKILL_GROUP_KEY);
    // flatIndex continuous across groups
    model.flatItems.forEach((item, i) => assert.equal(item.flatIndex, i));
    // personal group contains my-skill + zzz-custom; builtin contains review
    const personalNames = model.groups[0].items.map(i => i.name);
    assert.ok(personalNames.includes('my-skill'));
    assert.ok(personalNames.includes('zzz-custom'));
    assert.deepEqual(model.groups[1].items.map(i => i.name), ['review']);
  });

  it('fs source mapping wins: a builtin-named SDK command with a personal fs entry stays personal', () => {
    // user defined their own `review` skill at user level
    const fs = [{ name: 'review', source: 'user', enabled: true, description: 'my review' }];
    const sdkCommands = normalizeSdkCommands([{ name: 'review', description: 'x' }]);
    const model = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: fs, query: '' });
    assert.equal(model.flatItems[0].group, PERSONAL_SKILL_GROUP_KEY);
  });

  it('falls back to builtin name set when not in fs index', () => {
    const sdkCommands = normalizeSdkCommands([{ name: 'loop', description: 'loop it' }]);
    const model = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: [], query: '' });
    assert.equal(model.flatItems[0].group, BUILTIN_SKILL_GROUP_KEY);
  });

  it('uses fs list when not sdkReady, filters disabled, fills builtin description', () => {
    const fs = [
      { name: 'b-skill', source: 'user', enabled: true, description: 'b' },
      { name: 'a-skill', source: 'user', enabled: true, description: 'a' },
      { name: 'off', source: 'user', enabled: false },
      { name: 'review', source: 'builtin', enabled: true, description: null },
    ];
    const model = buildSlashMenuModel({ sdkReady: false, sdkCommands: [], fsSkills: fs, query: '' });
    assert.equal(model.source, 'fs');
    // personal sorted by name: a-skill, b-skill
    const personal = model.groups.find(g => g.key === PERSONAL_SKILL_GROUP_KEY);
    assert.deepEqual(personal.items.map(i => i.name), ['a-skill', 'b-skill']);
    const builtin = model.groups.find(g => g.key === BUILTIN_SKILL_GROUP_KEY);
    assert.equal(builtin.items[0].name, 'review');
    assert.ok(builtin.items[0].description.length > 0);
  });

  it('filters by case-insensitive prefix on name and alias', () => {
    const sdkCommands = normalizeSdkCommands([
      { name: 'review', aliases: ['/code-review'] },
      { name: 'remember' },
      { name: 'init' },
    ]);
    const byRe = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: [], query: 're' });
    assert.deepEqual(byRe.flatItems.map(i => i.name).sort(), ['remember', 'review']);
    const byAlias = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: [], query: 'code' });
    assert.deepEqual(byAlias.flatItems.map(i => i.name), ['review']);
    const byUpper = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: [], query: 'RE' });
    assert.ok(byUpper.flatItems.length >= 2);
  });

  it('omits empty groups', () => {
    const sdkCommands = normalizeSdkCommands([{ name: 'review' }]);
    const model = buildSlashMenuModel({ sdkReady: true, sdkCommands, fsSkills: [], query: '' });
    // only builtin present → no personal group
    assert.equal(model.groups.length, 1);
    assert.equal(model.groups[0].key, BUILTIN_SKILL_GROUP_KEY);
  });
});

describe('composeOutgoingText', () => {
  it('keeps a slash command at the message start, images after', () => {
    assert.equal(composeOutgoingText('/review', '/tmp/a.png'), '/review /tmp/a.png');
    assert.equal(composeOutgoingText('  /review x', '/tmp/a.png'), '  /review x /tmp/a.png');
  });

  it('keeps images first for ordinary text (legacy behavior)', () => {
    assert.equal(composeOutgoingText('hello', '/tmp/a.png'), '/tmp/a.png hello');
  });

  it('handles empty sides', () => {
    assert.equal(composeOutgoingText('', '/tmp/a.png'), '/tmp/a.png');
    assert.equal(composeOutgoingText('hello', ''), 'hello');
  });
});
