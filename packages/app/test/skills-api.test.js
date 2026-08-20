import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateSkillName, listSkills, moveSkill, deleteSkill, readEnabledPluginInstalls } from '../server/lib/skills-api.js';
import { writeSkillFiles } from '../server/routes/skills.js';

describe('validateSkillName', () => {
  it('accepts simple alphanumeric + hyphen', () => {
    assert.equal(validateSkillName('foo-bar'), true);
    assert.equal(validateSkillName('dev-lifecycle'), true);
    assert.equal(validateSkillName('foo.v2'), true);
  });

  it('accepts plugin: prefix with colon', () => {
    assert.equal(validateSkillName('plugin:foo'), true);
    assert.equal(validateSkillName('skill-creator:skill-creator'), true);
  });

  it('rejects leading dot (prevents .git / .ssh)', () => {
    assert.equal(validateSkillName('.git'), false);
    assert.equal(validateSkillName('.ssh'), false);
    assert.equal(validateSkillName('.hidden'), false);
  });

  it('rejects path traversal', () => {
    assert.equal(validateSkillName('..'), false);
    assert.equal(validateSkillName('../etc'), false);
    assert.equal(validateSkillName('foo/bar'), false);
    assert.equal(validateSkillName('foo\\bar'), false);
  });

  it('rejects null byte', () => {
    assert.equal(validateSkillName('foo\0bar'), false);
  });

  it('rejects empty / non-string', () => {
    assert.equal(validateSkillName(''), false);
    assert.equal(validateSkillName(null), false);
    assert.equal(validateSkillName(undefined), false);
    assert.equal(validateSkillName(123), false);
  });

  it('rejects overly long names', () => {
    assert.equal(validateSkillName('a'.repeat(201)), false);
    assert.equal(validateSkillName('a'.repeat(200)), true);
  });

  it('rejects names with spaces or special chars', () => {
    assert.equal(validateSkillName('foo bar'), false);
    assert.equal(validateSkillName('foo@bar'), false);
    assert.equal(validateSkillName('foo#bar'), false);
  });
});

describe('listSkills + moveSkill', () => {
  let tmpHome, tmpProject;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'ccv-home-'));
    tmpProject = mkdtempSync(join(tmpdir(), 'ccv-project-'));
    // 构造 ~/.claude/skills/foo 和 project/.claude/skills/bar
    mkdirSync(join(tmpHome, '.claude', 'skills', 'user-foo'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'skills', 'user-foo', 'SKILL.md'),
      '---\nname: user-foo\ndescription: hello user foo\n---\n');
    mkdirSync(join(tmpProject, '.claude', 'skills', 'proj-bar'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'proj-bar', 'SKILL.md'),
      '---\ndescription: "proj bar desc"\n---\n');
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpProject, { recursive: true, force: true }); } catch {}
  });

  it('listSkills finds both user and project skills + 10 builtins', () => {
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const user = list.filter(s => s.source === 'user');
    const project = list.filter(s => s.source === 'project');
    const builtin = list.filter(s => s.source === 'builtin');
    assert.equal(user.length, 1);
    assert.equal(user[0].name, 'user-foo');
    assert.equal(user[0].description, 'hello user foo');
    assert.equal(user[0].enabled, true);
    assert.equal(project.length, 1);
    assert.equal(project[0].name, 'proj-bar');
    assert.equal(project[0].description, 'proj bar desc');  // 引号应被剥
    assert.equal(builtin.length, 10);
    assert.ok(builtin.some(s => s.name === 'simplify'));
    assert.ok(!builtin.some(s => s.name === 'skill-creator')); // 不应出现
  });

  it('listSkills handles YAML block scalar description: |', () => {
    mkdirSync(join(tmpProject, '.claude', 'skills', 'proj-block'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'proj-block', 'SKILL.md'),
      '---\nname: proj-block\ndescription: |\n  line one.\n  line two.\n  line three.\ntags:\n  - x\n---\n\n# content\n');
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const block = list.find(s => s.name === 'proj-block');
    assert.ok(block);
    assert.equal(block.description, 'line one.\nline two.\nline three.');
  });

  it('listSkills handles YAML folded scalar description: >', () => {
    mkdirSync(join(tmpProject, '.claude', 'skills', 'proj-fold'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'proj-fold', 'SKILL.md'),
      '---\ndescription: >\n  folded\n  desc\n  here\n---\n');
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const fold = list.find(s => s.name === 'proj-fold');
    assert.ok(fold);
    assert.equal(fold.description, 'folded desc here');
  });

  it('listSkills returns disabled entries from skills-skip', () => {
    mkdirSync(join(tmpProject, '.claude', 'skills-skip', 'proj-gone'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills-skip', 'proj-gone', 'SKILL.md'),
      '---\ndescription: disabled skill\n---\n');
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const disabled = list.find(s => s.name === 'proj-gone');
    assert.ok(disabled);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.source, 'project');
  });

  it('moveSkill disable (enable=false) moves from skills/ to skills-skip/', () => {
    moveSkill({ source: 'project', name: 'proj-bar', enable: false, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills', 'proj-bar')), false);
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar', 'SKILL.md')), true);
  });

  it('moveSkill enable (enable=true) moves back', () => {
    moveSkill({ source: 'project', name: 'proj-bar', enable: false, projectDir: tmpProject, homeDir: tmpHome });
    moveSkill({ source: 'project', name: 'proj-bar', enable: true, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills', 'proj-bar', 'SKILL.md')), true);
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar')), false);
  });

  it('moveSkill throws DUPLICATE when same name exists in both skills/ and skills-skip/', () => {
    // 同名 skill 在 skills/（beforeEach 建的 proj-bar）与 skills-skip/ 各有一份 → 重复态
    mkdirSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar'), { recursive: true });
    // 禁用向（skills/ → skills-skip/）撞上已存在的禁用副本
    assert.throws(
      () => moveSkill({ source: 'project', name: 'proj-bar', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'DUPLICATE',
    );
    // 启用向（skills-skip/ → skills/）撞上已存在的启用副本，同样 DUPLICATE
    assert.throws(
      () => moveSkill({ source: 'project', name: 'proj-bar', enable: true, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'DUPLICATE',
    );
  });

  it('listSkills marks duplicate=true for same name in both skills/ and skills-skip/', () => {
    // proj-bar 在 skills/（beforeEach），再在 skills-skip/ 放一份同名 → 两条都应被标 duplicate
    mkdirSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar', 'SKILL.md'),
      '---\ndescription: disabled dup\n---\n');
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const bars = list.filter(s => s.source === 'project' && s.name === 'proj-bar');
    assert.equal(bars.length, 2);
    assert.ok(bars.every(s => s.duplicate === true));
    // 非重复条目不应带 duplicate 标记
    const foo = list.find(s => s.source === 'user' && s.name === 'user-foo');
    assert.ok(foo);
    assert.equal(foo.duplicate, undefined);
  });

  it('listSkills does NOT mark cross-scope same-name as duplicate (user vs project 不同 scope)', () => {
    // user 与 project 各有一个同名 same-foo（均启用）——scope 不同，不算重复
    mkdirSync(join(tmpHome, '.claude', 'skills', 'same-foo'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'skills', 'same-foo', 'SKILL.md'), '---\ndescription: u\n---\n');
    mkdirSync(join(tmpProject, '.claude', 'skills', 'same-foo'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills', 'same-foo', 'SKILL.md'), '---\ndescription: p\n---\n');
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const sameNames = list.filter(s => s.name === 'same-foo');
    assert.equal(sameNames.length, 2);
    assert.ok(sameNames.every(s => !s.duplicate), 'cross-scope 同名不应被标 duplicate');
  });

  it('deleteSkill removes an enabled skill (skills/) permanently', () => {
    deleteSkill({ source: 'project', name: 'proj-bar', enabled: true, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills', 'proj-bar')), false);
  });

  it('deleteSkill removes a disabled skill (skills-skip/) permanently', () => {
    mkdirSync(join(tmpProject, '.claude', 'skills-skip', 'proj-off'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills-skip', 'proj-off', 'SKILL.md'), '---\ndescription: off\n---\n');
    deleteSkill({ source: 'project', name: 'proj-off', enabled: false, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip', 'proj-off')), false);
  });

  it('deleteSkill tolerates a stale enabled flag (deletes the only existing copy)', () => {
    // proj-bar 只在 skills/（启用），客户端误传 enabled:false → 仍删掉那唯一一份
    deleteSkill({ source: 'project', name: 'proj-bar', enabled: false, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills', 'proj-bar')), false);
  });

  it('deleteSkill on duplicate state removes only the clicked copy (enabled:true → skills/)', () => {
    mkdirSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar'), { recursive: true });
    writeFileSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar', 'SKILL.md'), '---\ndescription: dup\n---\n');
    deleteSkill({ source: 'project', name: 'proj-bar', enabled: true, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills', 'proj-bar')), false);
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar', 'SKILL.md')), true);
  });

  it('deleteSkill throws NOT_FOUND when neither dir has the skill', () => {
    assert.throws(
      () => deleteSkill({ source: 'project', name: 'ghost', enabled: true, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'NOT_FOUND',
    );
  });

  it('deleteSkill throws INVALID_NAME / INVALID_SOURCE', () => {
    assert.throws(
      () => deleteSkill({ source: 'project', name: '..', enabled: true, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_NAME',
    );
    assert.throws(
      () => deleteSkill({ source: 'builtin', name: 'simplify', enabled: true, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_SOURCE',
    );
  });

  it('deleteSkill rejects a symlink target (SYMLINK)', () => {
    const target = join(tmpProject, '.claude', 'skills', 'proj-bar');
    rmSync(target, { recursive: true, force: true });
    symlinkSync('/tmp', target);
    assert.throws(
      () => deleteSkill({ source: 'project', name: 'proj-bar', enabled: true, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'SYMLINK',
    );
  });

  it('deleteSkill PATH_ESCAPE when skills/ is a symlink pointing outside base (不越权删除)', () => {
    const escapeProject = mkdtempSync(join(tmpdir(), 'ccv-escape-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'ccv-outside-'));
    mkdirSync(join(escapeProject, '.claude'), { recursive: true });
    symlinkSync(outsideDir, join(escapeProject, '.claude', 'skills'));
    mkdirSync(join(outsideDir, 'victim'));
    writeFileSync(join(outsideDir, 'victim', 'SKILL.md'), '---\ndescription: x\n---\n');
    try {
      assert.throws(
        () => deleteSkill({ source: 'project', name: 'victim', enabled: true, projectDir: escapeProject, homeDir: tmpHome }),
        (err) => err.code === 'PATH_ESCAPE',
      );
      assert.equal(existsSync(join(outsideDir, 'victim', 'SKILL.md')), true); // 越权目标未被删
    } finally {
      rmSync(escapeProject, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('moveSkill throws SOURCE_MISSING when source does not exist', () => {
    assert.throws(
      () => moveSkill({ source: 'project', name: 'nonexistent', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'SOURCE_MISSING',
    );
  });

  it('moveSkill throws INVALID_NAME for path traversal attempt', () => {
    assert.throws(
      () => moveSkill({ source: 'project', name: '..', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_NAME',
    );
    assert.throws(
      () => moveSkill({ source: 'project', name: 'foo/bar', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_NAME',
    );
  });

  it('moveSkill throws INVALID_SOURCE for plugin/builtin', () => {
    assert.throws(
      () => moveSkill({ source: 'plugin', name: 'foo', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_SOURCE',
    );
    assert.throws(
      () => moveSkill({ source: 'builtin', name: 'simplify', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'INVALID_SOURCE',
    );
  });

  it('moveSkill user source operates under ~/.claude', () => {
    moveSkill({ source: 'user', name: 'user-foo', enable: false, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpHome, '.claude', 'skills', 'user-foo')), false);
    assert.equal(existsSync(join(tmpHome, '.claude', 'skills-skip', 'user-foo', 'SKILL.md')), true);
  });

  it('moveSkill creates skills-skip dir on first disable', () => {
    // skills-skip 不存在
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip')), false);
    moveSkill({ source: 'project', name: 'proj-bar', enable: false, projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(existsSync(join(tmpProject, '.claude', 'skills-skip', 'proj-bar')), true);
  });

  it('moveSkill 拒绝 symlink 源（防 .claude 被指向系统目录的攻击）', () => {
    // 把 proj-bar 替换成一个指向 /tmp 的 symlink
    const from = join(tmpProject, '.claude', 'skills', 'proj-bar');
    rmSync(from, { recursive: true, force: true });
    symlinkSync('/tmp', from);
    assert.throws(
      () => moveSkill({ source: 'project', name: 'proj-bar', enable: false, projectDir: tmpProject, homeDir: tmpHome }),
      (err) => err.code === 'SYMLINK',
    );
  });

  it('moveSkill PATH_ESCAPE：skills 目录本身是 symlink 指向 base 外', () => {
    // 构造一个全新的 project，让它的 .claude/skills 整个是 symlink 指到 /tmp/outside
    const escapeProject = mkdtempSync(join(tmpdir(), 'ccv-escape-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'ccv-outside-'));
    mkdirSync(join(escapeProject, '.claude'), { recursive: true });
    symlinkSync(outsideDir, join(escapeProject, '.claude', 'skills'));
    // outside 里放一个 skill
    mkdirSync(join(outsideDir, 'victim'));
    writeFileSync(join(outsideDir, 'victim', 'SKILL.md'), '---\ndescription: x\n---\n');
    try {
      assert.throws(
        () => moveSkill({ source: 'project', name: 'victim', enable: false, projectDir: escapeProject, homeDir: tmpHome }),
        (err) => err.code === 'PATH_ESCAPE',
      );
    } finally {
      rmSync(escapeProject, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('readEnabledPluginInstalls — installPath 边界校验（防 installed_plugins.json 篡改）', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'ccv-home-'));
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  });

  function writePluginFixtures(homeDir, { enabledMap, installedMap }) {
    const claudeDir = join(homeDir, '.claude');
    const pluginsDir = join(claudeDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: enabledMap }));
    writeFileSync(join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: installedMap }));
  }

  it('拒绝 installPath 指向 ~/.claude/plugins 之外（如 /etc/skills、/tmp）', () => {
    const goodInstall = join(tmpHome, '.claude', 'plugins', 'cache', 'ok', 'v1');
    writePluginFixtures(tmpHome, {
      enabledMap: { 'ok@m': true, 'evil@m': true, 'tmp@m': true },
      installedMap: {
        'ok@m': [{ installPath: goodInstall }],
        'evil@m': [{ installPath: '/etc/skills' }],  // 绝对路径篡改
        'tmp@m': [{ installPath: '/tmp/fake-plugin' }],
      },
    });
    const installs = readEnabledPluginInstalls({ homeDir: tmpHome });
    // 只有 ok@m 的 installPath 在 ~/.claude/plugins/ 下，通过；evil/tmp 被过滤
    assert.equal(installs.length, 1);
    assert.equal(installs[0].pluginKey, 'ok@m');
  });

  it('拒绝含 ../ 的 installPath 绕过（normalize 后不在 plugins 下即拒）', () => {
    const evilPath = join(tmpHome, '.claude', 'plugins', '..', '..', 'etc');
    writePluginFixtures(tmpHome, {
      enabledMap: { 'evil@m': true },
      installedMap: { 'evil@m': [{ installPath: evilPath }] },
    });
    const installs = readEnabledPluginInstalls({ homeDir: tmpHome });
    assert.equal(installs.length, 0);
  });

  it('拒绝相对路径 installPath（必须绝对路径）', () => {
    writePluginFixtures(tmpHome, {
      enabledMap: { 'rel@m': true },
      installedMap: { 'rel@m': [{ installPath: '.claude/plugins/foo' }] },
    });
    assert.equal(readEnabledPluginInstalls({ homeDir: tmpHome }).length, 0);
  });
});

describe('readEnabledPluginInstalls + plugin skill filtering', () => {
  let tmpHome, tmpProject;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'ccv-home-'));
    tmpProject = mkdtempSync(join(tmpdir(), 'ccv-project-'));
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpProject, { recursive: true, force: true }); } catch {}
  });

  function writePluginFixtures(homeDir, { enabledMap, installedMap }) {
    const claudeDir = join(homeDir, '.claude');
    const pluginsDir = join(claudeDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: enabledMap }));
    writeFileSync(join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: installedMap }));
  }

  function writeSkill(skillsDir, skillName, description) {
    mkdirSync(join(skillsDir, skillName), { recursive: true });
    writeFileSync(join(skillsDir, skillName, 'SKILL.md'),
      `---\ndescription: ${description}\n---\n`);
  }

  it('readEnabledPluginInstalls returns empty when settings missing', () => {
    assert.deepEqual(readEnabledPluginInstalls({ homeDir: tmpHome }), []);
  });

  it('readEnabledPluginInstalls ignores plugins with enabled !== true', () => {
    const fooInstall = join(tmpHome, '.claude', 'plugins', 'cache', 'foo', 'v1');
    const barInstall = join(tmpHome, '.claude', 'plugins', 'cache', 'bar', 'v1');
    writePluginFixtures(tmpHome, {
      enabledMap: { 'foo@m': true, 'bar@m': false },
      installedMap: {
        'foo@m': [{ installPath: fooInstall }],
        'bar@m': [{ installPath: barInstall }],
      },
    });
    const installs = readEnabledPluginInstalls({ homeDir: tmpHome });
    assert.equal(installs.length, 1);
    assert.equal(installs[0].pluginKey, 'foo@m');
  });

  it('readEnabledPluginInstalls returns multiple installs for same plugin', () => {
    const pathA = join(tmpHome, '.claude', 'plugins', 'a');
    const pathB = join(tmpHome, '.claude', 'plugins', 'b');
    writePluginFixtures(tmpHome, {
      enabledMap: { 'foo@m': true },
      installedMap: {
        'foo@m': [{ installPath: pathA }, { installPath: pathB }],
      },
    });
    const installs = readEnabledPluginInstalls({ homeDir: tmpHome });
    assert.equal(installs.length, 2);
  });

  it('readEnabledPluginInstalls tolerates malformed JSON', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'settings.json'), 'not-json');
    assert.deepEqual(readEnabledPluginInstalls({ homeDir: tmpHome }), []);
  });

  it('listSkills includes only skills from enabled plugins (不扫 marketplaces/cache 噪音)', () => {
    // 启用 foo，未启用 bar
    const fooInstall = join(tmpHome, '.claude', 'plugins', 'cache', 'm', 'foo', 'unknown');
    const barInstall = join(tmpHome, '.claude', 'plugins', 'cache', 'm', 'bar', 'unknown');
    // noise：marketplaces 下未安装的插件 skill、cache 下历史残留
    const marketplaceDir = join(tmpHome, '.claude', 'plugins', 'marketplaces', 'm', 'plugins', 'ghost');
    const staleCacheDir = join(tmpHome, '.claude', 'plugins', 'cache', 'm', 'foo', 'STALE-HASH');
    writeSkill(join(fooInstall, 'skills'), 'foo-skill', 'enabled plugin skill');
    writeSkill(join(barInstall, 'skills'), 'bar-skill', 'should not appear (disabled plugin)');
    writeSkill(join(marketplaceDir, 'skills'), 'ghost-skill', 'should not appear (not installed)');
    writeSkill(join(staleCacheDir, 'skills'), 'foo-skill', 'should not appear (old cache version)');
    writePluginFixtures(tmpHome, {
      enabledMap: { 'foo@m': true, 'bar@m': false },
      installedMap: {
        'foo@m': [{ installPath: fooInstall }],
        'bar@m': [{ installPath: barInstall }],
      },
    });
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    const plugins = list.filter(s => s.source === 'plugin');
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'foo-skill');
    assert.equal(plugins[0].pluginName, 'foo@m'); // 现在是 pluginKey 而非 basename
    assert.equal(plugins[0].description, 'enabled plugin skill');
  });

  it('listSkills 空 enabledPlugins 时不出现 plugin 条目', () => {
    // 即使 marketplaces 和 cache 都有 skill，也不应出现在列表
    writeSkill(
      join(tmpHome, '.claude', 'plugins', 'marketplaces', 'm', 'plugins', 'ghost', 'skills'),
      'ghost', 'noise');
    writePluginFixtures(tmpHome, { enabledMap: {}, installedMap: {} });
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(list.filter(s => s.source === 'plugin').length, 0);
  });

  it('listSkills skips plugin install with missing skills/ dir', () => {
    const install = join(tmpHome, '.claude', 'plugins', 'cache', 'm', 'noskills', 'v1');
    mkdirSync(install, { recursive: true }); // 没 skills 子目录
    writePluginFixtures(tmpHome, {
      enabledMap: { 'noskills@m': true },
      installedMap: { 'noskills@m': [{ installPath: install }] },
    });
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(list.filter(s => s.source === 'plugin').length, 0);
  });

  it('listSkills skips skill dirs missing SKILL.md', () => {
    const install = join(tmpHome, '.claude', 'plugins', 'cache', 'm', 'foo', 'v1');
    mkdirSync(join(install, 'skills', 'bogus'), { recursive: true });
    // 没 SKILL.md
    writePluginFixtures(tmpHome, {
      enabledMap: { 'foo@m': true },
      installedMap: { 'foo@m': [{ installPath: install }] },
    });
    const list = listSkills({ projectDir: tmpProject, homeDir: tmpHome });
    assert.equal(list.filter(s => s.source === 'plugin').length, 0);
  });
});

describe('writeSkillFiles — 根因防护：禁用态同名阻止再导入', () => {
  let tmpHome;
  beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), 'ccv-home-')); });
  afterEach(() => { try { rmSync(tmpHome, { recursive: true, force: true }); } catch {} });

  it('rejects import when same name already lives in sibling skills-skip/', () => {
    const skillsRoot = join(tmpHome, '.claude', 'skills');
    // 禁用态：skills-skip/dup 已存在（import 只查 skills/ 会漏掉它）
    mkdirSync(join(tmpHome, '.claude', 'skills-skip', 'dup'), { recursive: true });
    assert.throws(
      () => writeSkillFiles(skillsRoot, 'dup', [{ relPath: 'SKILL.md', data: Buffer.from('---\ndescription: x\n---\n') }]),
      (err) => err.code === 'EXISTS' && err.status === 409,
    );
    // 不应把第二份写进 skills/，否则之后开关必撞 DUPLICATE
    assert.equal(existsSync(join(skillsRoot, 'dup')), false);
  });

  it('writes normally when no same-named skill exists in either dir', () => {
    const skillsRoot = join(tmpHome, '.claude', 'skills');
    writeSkillFiles(skillsRoot, 'fresh', [{ relPath: 'SKILL.md', data: Buffer.from('---\ndescription: y\n---\n') }]);
    assert.equal(existsSync(join(skillsRoot, 'fresh', 'SKILL.md')), true);
  });
});
