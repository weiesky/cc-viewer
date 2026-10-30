// Tests for the target-mode write routes (/api/target-*) that back the
// CLAUDE.md / skill file-browser modal's right-click menu. Isolation mirrors
// api-target-files.test.js: a throwaway HOME / CLAUDE_CONFIG_DIR / project so
// realpath + the write policy resolve against fixtures, not the developer's
// machine.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, realpathSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-target-fs-')));
const HOME = join(TMP, 'home');
const CONFIG = join(HOME, '.claude');
const PROJECT = join(TMP, 'project');
mkdirSync(join(PROJECT, '.git'), { recursive: true });
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

// Minimal POST request: an EventEmitter that replays the JSON body on 'data'
// then fires 'end'. `req.headers` drives the same-origin guard.
function postReq(body, headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function mockRes() {
  const res = { status: 0, body: '' };
  res.writeHead = (code) => { res.status = code; return res; };
  res.end = (chunk) => { res.body = chunk || ''; };
  res.json = () => JSON.parse(res.body);
  return res;
}

// Run a handler to completion: returns a promise resolving to the response.
function call(handler, { body, query = '', isLocal = true, admin = true, headers = {} }) {
  return new Promise((resolvePromise) => {
    const res = mockRes();
    const origEnd = res.end;
    res.end = (chunk) => { origEnd(chunk); resolvePromise(res); };
    const parsedUrl = new URL(`/api/target-x?${query}`, 'http://localhost');
    const req = postReq(body, headers);
    if (admin) req.ccvIsAdmin = true;
    handler(req, res, parsedUrl, isLocal, { MAX_POST_BODY: 10 * 1024 * 1024 });
  });
}

describe('/api/target-* write routes', { concurrency: false }, () => {
  let routes;
  let userSkill;
  const originalLogDir = process.env.CCV_LOG_DIR;

  const targetQ = () => `kind=skill&source=user&targetPath=${encodeURIComponent(userSkill)}`;

  before(async () => {
    userSkill = skillDir(join(CONFIG, 'skills'), 'write-skill');
    writeFileSync(join(userSkill, 'notes.txt'), 'notes');
    mkdirSync(join(userSkill, 'nested'));
    writeFileSync(join(userSkill, 'nested', 'child.txt'), 'child');
    symlinkSync(CONFIG, join(userSkill, 'escape'));
    routes = (await import('../server/routes/target-files-fs.js')).targetFilesFsRoutes;
    const { LOG_DIR } = await import('../findcc.js');
    process.env.CCV_LOG_DIR = LOG_DIR;
    const { saveWorkspaces } = await import('../server/workspace-registry.js');
    saveWorkspaces([{ path: PROJECT, projectName: 'project' }]);
    const policy = await import('../server/lib/file-access-policy.js');
    policy.bumpWorkspacesVersion();
  });

  after(() => {
    process.env.CCV_LOG_DIR = originalLogDir;
    rmSync(TMP, { recursive: true, force: true });
  });

  const route = (p) => routes.find(r => r.path === p)?.handler;

  it('registers seven POST-only target routes', () => {
    const paths = routes.map(r => r.path).sort();
    assert.deepEqual(paths, [
      '/api/target-create-dir', '/api/target-create-file', '/api/target-delete-file',
      '/api/target-open-terminal', '/api/target-rename-file', '/api/target-resolve-path',
      '/api/target-reveal-file',
    ]);
    for (const r of routes) assert.equal(r.method, 'POST', `${r.path} must be POST`);
  });

  it('rejects non-admin and cross-site callers before reading the body', async () => {
    // Not admin, not local.
    let res = await call(route('/api/target-delete-file'), { body: { path: 'notes.txt' }, query: targetQ(), isLocal: false, admin: false });
    assert.equal(res.status, 403);
    // Cross-site browser page.
    res = await call(route('/api/target-delete-file'), { body: { path: 'notes.txt' }, query: targetQ(), headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(res.status, 403);
    assert.ok(existsSync(join(userSkill, 'notes.txt')), 'rejected delete must not touch the file');
  });

  it('resolves a navigation-root-relative path to an absolute path', async () => {
    const res = await call(route('/api/target-resolve-path'), { body: { path: '.claude/skills/write-skill/notes.txt' }, query: targetQ() });
    assert.equal(res.status, 200);
    assert.equal(res.json().fullPath, join(HOME, '.claude/skills/write-skill/notes.txt'));
  });

  it('creates a file and a directory inside the target subtree', async () => {
    let res = await call(route('/api/target-create-file'), { body: { dirPath: '.claude/skills/write-skill', name: 'new.txt' }, query: targetQ() });
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json().path, '.claude/skills/write-skill/new.txt');
    assert.equal(readFileSync(join(userSkill, 'new.txt'), 'utf8'), '');

    res = await call(route('/api/target-create-dir'), { body: { dirPath: '.claude/skills/write-skill', name: 'subdir' }, query: targetQ() });
    assert.equal(res.status, 200, res.body);
    assert.ok(statSync(join(userSkill, 'subdir')).isDirectory());
  });

  it('rejects path traversal, absolute paths and control-char names', async () => {
    for (const bad of ['../x', '/etc', 'skills/../../x', 'skills//x']) {
      const res = await call(route('/api/target-create-file'), { body: { dirPath: bad, name: 'y.txt' }, query: targetQ() });
      assert.equal(res.status, 400, `dirPath ${bad} must be 400, got ${res.status}`);
    }
    for (const badName of ['a/b', 'a\\b', '..', '.git']) {
      const res = await call(route('/api/target-create-file'), { body: { dirPath: '.claude/skills/write-skill', name: badName }, query: targetQ() });
      assert.equal(res.status, 400, `name ${badName} must be 400, got ${res.status}`);
    }
  });

  it('renames a file and reports the new navigation-root-relative path', async () => {
    const res = await call(route('/api/target-rename-file'), { body: { oldPath: '.claude/skills/write-skill/notes.txt', newName: 'renamed.txt' }, query: targetQ() });
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json().newPath, '.claude/skills/write-skill/renamed.txt');
    assert.ok(existsSync(join(userSkill, 'renamed.txt')));
    assert.ok(!existsSync(join(userSkill, 'notes.txt')));
  });

  it('refuses to rename or delete the navigation root itself', async () => {
    let res = await call(route('/api/target-rename-file'), { body: { oldPath: '', newName: 'x' }, query: targetQ() });
    assert.equal(res.status, 400, 'empty oldPath must be rejected (missing path)');
    res = await call(route('/api/target-delete-file'), { body: { path: '' }, query: targetQ() });
    assert.equal(res.status, 400, 'empty path must be rejected');
  });

  it('rejects symlink mutation targets', async () => {
    const res = await call(route('/api/target-delete-file'), { body: { path: '.claude/skills/write-skill/escape' }, query: targetQ() });
    assert.equal(res.status, 400, res.body);
    assert.match(res.json().error, /symbolic link/i);
  });

  it('rejects rename of a sensitive source (denylist-bypass via rename)', async () => {
    // ~/.claude lives in the home navigation root. Renaming a sensitive file to a
    // benign name would make it readable via /api/file-content — the source path
    // must pass the write policy, not just the destination. Use a distinct name so
    // the sibling "create settings.json → 403" test (which writes settings.json)
    // does not collide on the shared fixture.
    writeFileSync(join(CONFIG, '.credentials.json'), '{"secret":1}');
    const res = await call(route('/api/target-rename-file'), { body: { oldPath: '.claude/.credentials.json', newName: 'creds.txt' }, query: targetQ() });
    assert.equal(res.status, 403, res.body);
    assert.ok(existsSync(join(CONFIG, '.credentials.json')), 'sensitive source must not be renamed');
    assert.ok(!existsSync(join(CONFIG, 'creds.txt')));
  });

  it('rejects rename of a symlink (must refuse the link, not rename its target)', async () => {
    const res = await call(route('/api/target-rename-file'), { body: { oldPath: '.claude/skills/write-skill/escape', newName: 'renamed-link' }, query: targetQ() });
    assert.equal(res.status, 400, res.body);
    assert.match(res.json().error, /symbolic link/i);
  });

  it('rejects create onto a dangling symlink (containment bypass)', async () => {
    // A dangling symlink inside the target pointing outside the navigation root:
    // realpath fails, but writeFileSync would follow it and create the target.
    const outside = join(TMP, 'outside-leak.txt');
    symlinkSync(outside, join(userSkill, 'dangling'));
    const res = await call(route('/api/target-create-file'), { body: { dirPath: '.claude/skills/write-skill', name: 'dangling' }, query: targetQ() });
    assert.equal(res.status, 403, res.body);
    assert.ok(!existsSync(outside), 'write must not follow a dangling symlink outside the root');
  });

  it('rejects renaming a directory whose subtree contains a protected file', async () => {
    // Renaming ~/.claude wholesale would move credentials/settings out from under
    // the live config-dir denylist (the read policy keys off getClaudeConfigDir),
    // exposing them. A directory rename must scan its subtree like delete does.
    writeFileSync(join(CONFIG, '.credentials.json'), '{"secret":1}');
    const res = await call(route('/api/target-rename-file'), { body: { oldPath: '.claude', newName: '.claude-old' }, query: targetQ() });
    assert.equal(res.status, 403, res.body);
    assert.ok(existsSync(join(CONFIG, '.credentials.json')), 'protected subtree must not be moved');
    assert.ok(!existsSync(join(HOME, '.claude-old')));
  });

  it('rejects delete of the LOG_DIR root and the ~/.claude config root', async () => {
    // LOG_DIR root itself (not just its children) must be undeletable.
    const { LOG_DIR } = await import('../findcc.js');
    // Point LOG_DIR under the fake HOME allowlist for this check.
    const { setLogDir } = await import('../findcc.js');
    const logUnderHome = join(HOME, '.claude', 'cc-viewer');
    mkdirSync(logUnderHome, { recursive: true });
    setLogDir(logUnderHome);
    try {
      const res = await call(route('/api/target-delete-file'), { body: { path: '.claude/cc-viewer' }, query: targetQ() });
      assert.equal(res.status, 403, res.body);
      assert.ok(existsSync(logUnderHome), 'LOG_DIR root must survive');
    } finally {
      setLogDir(LOG_DIR);
    }
  });

  it('refuses a recursive delete that would wipe protected descendants', async () => {
    // Deleting ~/.claude wholesale would remove settings.json/.credentials.json
    // (each individually write-denied). The recursive delete must scan the subtree
    // and refuse rather than bypass the per-file policy.
    writeFileSync(join(CONFIG, '.credentials.json'), '{"secret":1}');
    const res = await call(route('/api/target-delete-file'), { body: { path: '.claude' }, query: targetQ() });
    assert.equal(res.status, 403, res.body);
    assert.match(res.json().error, /protected path/i);
    assert.ok(existsSync(join(CONFIG, '.credentials.json')), 'protected descendants must survive');
  });

  it('protects node_modules / .git from recursive delete', async () => {
    mkdirSync(join(userSkill, 'node_modules', 'pkg'), { recursive: true });
    const res = await call(route('/api/target-delete-file'), { body: { path: '.claude/skills/write-skill/node_modules' }, query: targetQ() });
    assert.equal(res.status, 400, res.body);
    assert.match(res.json().error, /protected directory/i);
  });

  it('blocks writes to sensitive ~/.claude config files even under a home-rooted target', async () => {
    // Global CLAUDE.md lives at ~/.claude → navigation root is $HOME. Creating
    // settings.json inside .claude must be denied by the write policy.
    writeFileSync(join(CONFIG, 'CLAUDE.md'), '# global');
    // Resolve the claude-md target id via the discovery route.
    const filesContent = (await import('../server/routes/files-content.js')).filesContentRoutes;
    const claudeMd = filesContent.find(r => r.path === '/api/claude-md').handler;
    const listRes = mockRes();
    claudeMd({}, listRes, new URL('/api/claude-md', 'http://localhost'));
    const globalId = JSON.parse(listRes.body).entries.find(e => e.scope === 'global').id;
    const q = `kind=claude-md&id=${globalId}`;
    const res = await call(route('/api/target-create-file'), { body: { dirPath: '.claude', name: 'settings.json' }, query: q });
    assert.equal(res.status, 403, res.body);
  });

  it('deletes a regular file inside the target subtree', async () => {
    writeFileSync(join(userSkill, 'todelete.txt'), 'x');
    const res = await call(route('/api/target-delete-file'), { body: { path: '.claude/skills/write-skill/todelete.txt' }, query: targetQ() });
    assert.equal(res.status, 200, res.body);
    assert.ok(!existsSync(join(userSkill, 'todelete.txt')));
  });

  it('saves a NEW file via /api/file-content in target mode (regression: must not 403)', async () => {
    // Regression for the containment realpath: isPathContained realpaths its
    // target, which throws for a not-yet-existing file, so a legitimate
    // new-file save inside the navigation root used to 403 with
    // 'outside-view-root'. Containment must tolerate the missing leaf by
    // realpathing the nearest existing ancestor.
    const filesContent = (await import('../server/routes/files-content.js')).filesContentRoutes;
    const fileContentPost = filesContent.find(r => r.path === '/api/file-content' && r.method === 'POST').handler;
    const rel = '.claude/skills/write-skill/created-via-content.txt';
    const res = await call(fileContentPost, { body: { path: rel, content: 'fresh' }, query: targetQ() });
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json().ok, true);
    assert.equal(readFileSync(join(userSkill, 'created-via-content.txt'), 'utf-8'), 'fresh');
  });

  it('still 403s a new file that resolves OUTSIDE the target navigation root', async () => {
    // The tolerant-new-leaf containment must not open a hole: a relative path
    // that escapes the navigation root via ".." stays forbidden.
    const filesContent = (await import('../server/routes/files-content.js')).filesContentRoutes;
    const fileContentPost = filesContent.find(r => r.path === '/api/file-content' && r.method === 'POST').handler;
    const res = await call(fileContentPost, { body: { path: '../../escaped.txt', content: 'x' }, query: targetQ() });
    assert.equal(res.status, 403, res.body);
  });
});
