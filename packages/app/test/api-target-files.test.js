import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-target-files-')));
const HOME = join(TMP, 'home');
const CONFIG = join(HOME, '.claude');
const PROJECT = join(TMP, 'project');
const OTHER = join(TMP, 'other');
mkdirSync(join(PROJECT, '.git'), { recursive: true });
mkdirSync(OTHER, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.CLAUDE_CONFIG_DIR = CONFIG;
process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_LOG_DIR = join(TMP, 'logs');

function skillDir(base, name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n`);
  return dir;
}

describe('GET /api/target-files', { concurrency: false }, () => {
  let routes;
  let targetFiles;
  let claudeMd;
  let userSkill;
  let projectSkill;
  let pluginSkill;
  const originalLogDir = process.env.CCV_LOG_DIR;

  function get(path) {
    const parsedUrl = new URL(path, 'http://localhost');
    let status = 0;
    let body = '';
    const res = {
      writeHead(code) { status = code; },
      end(chunk) { body = chunk || ''; },
    };
    targetFiles({}, res, parsedUrl, true, { IGNORED_PATTERNS: new Set(['.git']) });
    return { status, body, json: () => JSON.parse(body) };
  }

  before(async () => {
    userSkill = skillDir(join(CONFIG, 'skills'), 'user-skill');
    projectSkill = skillDir(join(PROJECT, '.claude', 'skills-skip'), 'project-skill');
    const install = join(CONFIG, 'plugins', 'installed', 'demo');
    pluginSkill = skillDir(join(install, 'skills'), 'plugin-skill');
    writeFileSync(join(CONFIG, 'settings.json'), JSON.stringify({ enabledPlugins: { 'demo@local': true } }));
    writeFileSync(join(CONFIG, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'demo@local': [{ installPath: install }] } }));
    writeFileSync(join(PROJECT, 'CLAUDE.md'), '# project');
    mkdirSync(join(PROJECT, 'src'));
    writeFileSync(join(PROJECT, 'src', 'index.js'), 'export {};');
    writeFileSync(join(CONFIG, 'CLAUDE.md'), '# global');
    writeFileSync(join(CONFIG, 'settings.local.json'), '{"secret":true}');
    writeFileSync(join(CONFIG, '.credentials.json'), '{"secret":true}');
    writeFileSync(join(userSkill, 'notes.txt'), 'notes');
    writeFileSync(join(userSkill, '.env'), 'SECRET=1');
    mkdirSync(join(userSkill, 'nested'));
    writeFileSync(join(userSkill, 'nested', 'child.txt'), 'child');
    symlinkSync(CONFIG, join(userSkill, 'escape'));
    routes = (await import('../server/routes/files-content.js')).filesContentRoutes;
    targetFiles = routes.find(route => route.path === '/api/target-files').handler;
    claudeMd = routes.find(route => route.path === '/api/claude-md').handler;
    const { LOG_DIR } = await import('../findcc.js');
    process.env.CCV_LOG_DIR = LOG_DIR;
    const { saveWorkspaces } = await import('../server/workspace-registry.js');
    saveWorkspaces([{ path: PROJECT, projectName: 'project' }, { path: OTHER, projectName: 'other' }]);
    const policy = await import('../server/lib/file-access-policy.js');
    policy.bumpWorkspacesVersion();
  });

  after(() => {
    process.env.CCV_LOG_DIR = originalLogDir;
    rmSync(TMP, { recursive: true, force: true });
  });

  function claudeId(scope) {
    let body = '';
    const res = { writeHead() {}, end(chunk) { body = chunk; } };
    claudeMd({}, res, new URL('/api/claude-md', 'http://localhost'));
    return JSON.parse(body).entries.find(entry => entry.scope === scope).id;
  }

  function targetQuery(path) {
    return `kind=skill&source=user&targetPath=${encodeURIComponent(userSkill)}${path ? `&path=${encodeURIComponent(path)}` : ''}`;
  }

  it('lists a skill directory read-only, with sorted entries and sensitive/escaping entries omitted', () => {
    const res = get(`/api/target-files?${targetQuery()}`);
    assert.equal(res.status, 200, res.body);
    assert.deepEqual(res.json().targetEntries.map(entry => entry.name), ['nested', 'notes.txt', 'SKILL.md']);
    assert.equal(res.json().targetEntries[0].type, 'directory');
    assert.equal(res.json().targetEntries[1].absPath, realpathSync(join(userSkill, 'notes.txt')));
    assert.equal(res.json().rootKind, 'home');
    assert.equal(res.json().targetPath, '.claude/skills/user-skill');
    assert.ok(!res.body.includes('allowedRoots'));
  });

  it('lists nested content but rejects traversal and absolute subpaths', () => {
    const nested = get(`/api/target-files?${targetQuery('.claude/skills/user-skill/nested')}`);
    assert.equal(nested.status, 200);
    assert.deepEqual(nested.json().entries.map(entry => entry.name), ['child.txt']);
    assert.equal(nested.json().rootKind, 'home');
    assert.equal(nested.json().targetPath, '.claude/skills/user-skill/nested');
    const parent = get(`/api/target-files?${targetQuery('.claude/skills')}`);
    assert.equal(parent.status, 200);
    assert.ok(parent.json().entries.some(entry => entry.name === 'user-skill'));
    const home = get(`/api/target-files?${targetQuery()}`);
    assert.equal(home.status, 200);
    assert.ok(home.json().entries.some(entry => entry.name === '.claude'));
    assert.ok(home.json().ancestors.some(ancestor => ancestor.path === '' && ancestor.entries.some(entry => entry.name === '.claude')));
    assert.ok(home.json().ancestors.some(ancestor => ancestor.path === '.claude/skills'));
    const outside = get(`/api/target-files?${targetQuery('other')}`);
    assert.equal(outside.status, 404);
    assert.ok(!outside.body.includes('allowedRoots'));
    const sibling = get(`/api/target-files?${targetQuery('.claude/plugins')}`);
    assert.equal(sibling.status, 200);
    assert.ok(sibling.json().entries.some(entry => entry.name === 'installed'));
    for (const path of ['..', '.claude/skills/user-skill/../../..', '/etc', '.claude\\skills', '.claude//skills', '.claude/./skills']) {
      const res = get(`/api/target-files?${targetQuery(path)}`);
      assert.equal(res.status, 400, path);
    }
  });

  it('accepts only currently discovered user, project and plugin paths', () => {
    for (const [source, path] of [['user', userSkill], ['project', projectSkill], ['plugin', pluginSkill]]) {
      const res = get(`/api/target-files?kind=skill&source=${source}&targetPath=${encodeURIComponent(path)}`);
      assert.equal(res.status, 200, `${source}: ${res.body}`);
      assert.ok(res.json().targetEntries.some(entry => entry.name === 'SKILL.md'), `${source}: ${res.body}`);
      assert.equal(res.json().rootKind, source === 'project' ? 'project' : 'home');
      assert.equal(res.json().targetPath, source === 'project' ? '.claude/skills-skip/project-skill' : res.json().targetPath);
    }
    for (const [source, path] of [['builtin', 'null'], ['user', PROJECT], ['plugin', userSkill], ['project', userSkill], ['user', '/etc']]) {
      const res = get(`/api/target-files?kind=skill&source=${source}&targetPath=${encodeURIComponent(path)}`);
      assert.ok([400, 404].includes(res.status), `${source}/${path}: ${res.status}`);
    }
  });

  it('opens project and global CLAUDE.md directories while filtering sensitive global files', () => {
    for (const scope of ['project', 'global']) {
      const id = claudeId(scope);
      const res = get(`/api/target-files?kind=claude-md&id=${id}`);
      assert.equal(res.status, 200, res.body);
      assert.ok(res.json().targetEntries.some(entry => entry.name === 'CLAUDE.md'));
      assert.equal(res.json().rootKind, scope === 'project' ? 'project' : 'home');
      assert.equal(res.json().targetPath, scope === 'project' ? '' : '.claude');
      if (scope === 'project') {
        const child = get(`/api/target-files?kind=claude-md&id=${id}&path=src`);
        assert.equal(child.status, 200, child.body);
        assert.equal(child.json().targetPath, 'src');
        assert.deepEqual(child.json().entries.map(entry => entry.name), ['index.js']);
        const root = get(`/api/target-files?kind=claude-md&id=${id}&path=`);
        assert.equal(root.status, 200, root.body);
        assert.equal(root.json().targetPath, '');
        assert.ok(root.json().entries.some(entry => entry.name === 'src'));
      }
      if (scope === 'global') {
        const names = res.json().targetEntries.map(entry => entry.name);
        assert.ok(!names.includes('settings.json'));
        assert.ok(!names.includes('settings.local.json'));
        assert.ok(!names.includes('.credentials.json'));
      }
    }
  });

  it('rejects invalid, stale and cross-view targets', () => {
    for (const query of ['kind=unknown', 'kind=claude-md&id=nope', `kind=claude-md&id=${'a'.repeat(12)}`, 'kind=skill&source=user&targetPath=']) {
      const res = get(`/api/target-files?${query}`);
      assert.ok([400, 404].includes(res.status), query);
    }
    mkdirSync(join(OTHER, '.git'));
    const otherProjectSkill = skillDir(join(OTHER, '.claude', 'skills'), 'other-skill');
    process.env.CCV_PROJECT_DIR = OTHER;
    const res = get(`/api/target-files?kind=skill&source=project&targetPath=${encodeURIComponent(otherProjectSkill)}`);
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json().rootKind, 'project');
    assert.equal(res.json().targetPath, '.claude/skills/other-skill');
    process.env.CCV_PROJECT_DIR = PROJECT;
    const wrongScope = get(`/api/target-files?kind=skill&source=project&targetPath=${encodeURIComponent(otherProjectSkill)}`);
    assert.equal(wrongScope.status, 404);
  });

  it('supports custom config roots and intermediate navigation directories', async () => {
    const custom = join(TMP, 'custom-config');
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, 'CLAUDE.md'), '# custom');
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = custom;
    try {
      const { _resetCacheForTests } = await import('../server/lib/file-access-policy.js');
      _resetCacheForTests();
      const id = claudeId('global');
      const res = get(`/api/target-files?kind=claude-md&id=${id}`);
      assert.equal(res.status, 200, res.body);
      assert.equal(res.json().rootKind, 'config');
      assert.equal(res.json().targetPath, 'custom-config');
      assert.ok(res.json().targetEntries.some(entry => entry.name === 'CLAUDE.md'));
    } finally {
      process.env.CLAUDE_CONFIG_DIR = previous;
      const { _resetCacheForTests } = await import('../server/lib/file-access-policy.js');
      _resetCacheForTests();
    }
  });

  it('registers one GET-only route and keeps the original route count plus one', () => {
    assert.equal(routes.filter(route => route.path === '/api/target-files').length, 1);
    assert.equal(routes.find(route => route.path === '/api/target-files').method, 'GET');
    assert.equal(routes.length, 8);
  });
});
