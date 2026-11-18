import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
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

  it('every entry carries size + mtimeMs (dirs null on size) and primary listing honors ?sort=', () => {
    // Default order: directories first, files by name asc.
    const def = get(`/api/target-files?${targetQuery()}`);
    assert.equal(def.status, 200);
    for (const entry of def.json().targetEntries) {
      assert.ok('size' in entry, `entry ${entry.name} must carry a size field`);
      assert.ok('mtimeMs' in entry, `entry ${entry.name} must carry an mtimeMs field`);
      if (entry.type === 'directory') assert.equal(entry.size, null);
      else assert.equal(typeof entry.size, 'number');
      assert.equal(typeof entry.mtimeMs, 'number');
    }
    // ?sort=size&order=desc flips the primary listing (files by size desc),
    // but ancestors stay in the default name/asc order so the tree stays stable.
    const sorted = get(`/api/target-files?${targetQuery()}&sort=size&order=desc`);
    assert.equal(sorted.status, 200);
    const fileSizes = sorted.json().targetEntries.filter(e => e.type === 'file').map(e => e.size);
    for (let i = 1; i < fileSizes.length; i++) {
      assert.ok(fileSizes[i - 1] >= fileSizes[i], `file sizes must be desc, got ${fileSizes}`);
    }
    // Ancestors chain is always name/asc — pick the same ancestor in both
    // responses and assert their orders match.
    const defAnc = def.json().ancestors.find(a => a.path === '.claude/skills');
    const sortedAnc = sorted.json().ancestors.find(a => a.path === '.claude/skills');
    assert.ok(defAnc && sortedAnc, 'expected .claude/skills ancestor in both responses');
    assert.deepEqual(sortedAnc.entries.map(e => e.name), defAnc.entries.map(e => e.name),
      'ancestors must stay in name/asc regardless of the requested grid sort');
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

  it('resolves kind=memory to the per-project memory directory (auto-created, anchored at the memory dir itself)', async () => {
    // Memory dir lives at <config>/projects/<encoded-cwd>/memory. The encoded
    // cwd strips trailing separators before encoding — match the live server
    // behavior so this test guards against the historical "raw bound cwd with
    // a trailing /" 404.
    const encoded = PROJECT.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryDir = join(CONFIG, 'projects', encoded, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'MEMORY.md'), '# memory');
    // A sibling inside <encoded>/ but outside memory/ must NOT be reachable
    // through the memory target's navigation (policy denylist only exempts
    // the memory subtree).
    mkdirSync(join(CONFIG, 'projects', encoded, 'transcripts'), { recursive: true });
    writeFileSync(join(CONFIG, 'projects', encoded, 'transcripts', 'session.jsonl'), '{}');

    const res = get('/api/target-files?kind=memory');
    assert.equal(res.status, 200, res.body);
    const data = res.json();
    assert.equal(data.rootKind, 'target');
    assert.equal(data.targetPath, '');
    assert.equal(data.targetKind, 'memory');
    // Entries are the memory dir's own children.
    assert.ok(data.entries.some(entry => entry.name === 'MEMORY.md'));
    // Sibling sensitive dirs under <encoded>/ are never shipped.
    assert.ok(!data.entries.some(entry => entry.name === 'transcripts'));
  });

  it('auto-creates a missing memory dir so a fresh project can open the browser', () => {
    // Regression: the legacy /api/open-memory-dir did mkdirSync(recursive)
    // before opening Finder. The in-app browser must keep that affordance —
    // otherwise projects that have never written memory land on a permanent
    // "load failed" state (and the /api/target-* write routes 404 too,
    // blocking first-MEMORY.md creation entirely).
    const encoded = OTHER.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryDir = join(CONFIG, 'projects', encoded, 'memory');
    rmSync(memoryDir, { recursive: true, force: true });
    const previous = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = OTHER;
    try {
      const res = get('/api/target-files?kind=memory');
      assert.equal(res.status, 200, res.body);
      assert.equal(res.json().rootKind, 'target');
      assert.equal(res.json().targetPath, '');
      // The directory was created as a side effect, mirroring openMemoryDir.
      assert.equal(existsSync(memoryDir), true);
    } finally {
      process.env.CCV_PROJECT_DIR = previous;
    }
  });

  it('registers the target and archive read routes', () => {
    assert.equal(routes.filter(route => route.path === '/api/target-files').length, 1);
    assert.equal(routes.find(route => route.path === '/api/target-files').method, 'GET');
    assert.equal(routes.length, 10);
  });
});
