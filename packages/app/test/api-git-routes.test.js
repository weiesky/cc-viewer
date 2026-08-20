/**
 * server/routes/git.js — gitRoutes handler 行为测试
 *
 * 覆盖目标：gitRepos / gitRestore / gitStatus / gitDiff / gitLogUnpushed 五个 handler。
 *
 * 手法：不启 http server，直接 import { gitRoutes } 取 handler 并注入 deps。
 *   - req：GET 用普通对象即可；POST（gitRestore）用 EventEmitter 模拟 data/end 流。
 *   - res：收集 writeHead(status) + end(body)。
 *   - deps：注入真实 promisify(execFile) 作 execFileAsync、绑定到临时仓库的 resolveRepoCwd、
 *           真实 gitRestoreLocks Map、MAX_POST_BODY。
 *   - fixtures：每个 case 在临时目录 git init 造真实小仓库（staged/unstaged/untracked/deleted）。
 *
 * env 必须在 import server/routes/git.js（间接 import git-diff.js / file-access-policy）之前设好，
 * 否则顶层 STARTUP_CWD/LOG_DIR 锁定到真实目录。
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync, existsSync, readFileSync, symlinkSync,
} from 'node:fs';
import { join, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ---- env 隔离（在任何目标模块 import 之前）----
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'ccv-api-git-routes-'));
process.env.CCV_LOG_DIR = process.env.CCV_LOG_DIR || join(TMP_ROOT, 'logs');
process.env.CLAUDE_CONFIG_DIR = join(TMP_ROOT, 'claude');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const execFileAsync = promisify(execFile);

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' });
  // 关掉 GPG 签名 / 默认分支噪音
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function commit(dir, file, content, msg) {
  writeFileSync(join(dir, file), content);
  execSync(`git add ${file}`, { cwd: dir, stdio: 'pipe' });
  execSync(`git commit -m "${msg}"`, { cwd: dir, stdio: 'pipe' });
}

/**
 * 构造一个 deps，resolveRepoCwd 把 repo 参数解析到 projectDir 下的子目录（或自身）。
 * 复刻 server.js resolveRepoCwd 的安全语义（拒绝含 / \ .. 的参数、必须是含 .git 的目录）。
 */
function makeDeps(projectDir) {
  return {
    MAX_POST_BODY: 1024 * 1024,
    execFileAsync,
    gitRestoreLocks: new Map(),
    resolveRepoCwd(repoParam) {
      if (!repoParam || repoParam === '.') return projectDir;
      if (repoParam.includes('/') || repoParam.includes('..') || repoParam.includes('\\')) return null;
      const candidate = join(projectDir, repoParam);
      if (!existsSync(candidate)) return null;
      if (!existsSync(join(candidate, '.git'))) return null;
      return candidate;
    },
  };
}

/** 取某个 route 的 handler */
let routes;
before(async () => {
  ({ gitRoutes: routes } = await import('../server/routes/git.js'));
});
function handlerFor(path, method) {
  const r = routes.find(x => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

/** 同步收集 res 的回包；GET handler 是 async，调用方 await 返回的 promise 解析后再读 */
function makeRes() {
  const out = { status: 0, headers: null, body: '' };
  return {
    out,
    res: {
      writeHead(code, headers) { out.status = code; out.headers = headers; },
      end(b) { out.body = b == null ? '' : b; },
    },
    json() { return JSON.parse(out.body || '{}'); },
  };
}

/** 驱动一个 GET handler（可能 async），返回 { status, json } */
async function callGet(handler, url, deps) {
  const cap = makeRes();
  const parsedUrl = new URL(url, 'http://x');
  await handler({}, cap.res, parsedUrl, true, deps);
  return { status: cap.out.status, json: () => JSON.parse(cap.out.body || '{}'), body: cap.out.body };
}

/** 驱动 POST handler（gitRestore）：req 流式 emit body */
function callPost(handler, url, body, deps) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.destroy = () => { req.emit('end'); };
    const res = {
      writeHead(code) { resolve.__status = code; },
      end(b) { resolve({ status: resolve.__status, json: () => JSON.parse(b || '{}'), body: b || '' }); },
    };
    handler(req, res, new URL(url, 'http://x'), true, deps);
    // 异步 emit，模拟真实流
    setImmediate(() => {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      req.emit('end');
    });
  });
}

// ====================================================================
// gitRepos
// ====================================================================
describe('gitRepos GET /api/git-repos', { concurrency: false }, () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(TMP_ROOT, 'repos-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.CCV_PROJECT_DIR; });

  it('returns root repo + subdir repos, skips hidden and node_modules', async () => {
    initRepo(dir);
    commit(dir, 'seed.txt', 'x\n', 'init');
    // 子仓库
    initRepo(join(dir, 'frontend'));
    initRepo(join(dir, 'backend'));
    // 应跳过：隐藏目录、node_modules、普通非 git 目录
    initRepo(join(dir, '.hidden'));
    mkdirSync(join(dir, 'node_modules', '.git'), { recursive: true });
    mkdirSync(join(dir, 'plaindir'), { recursive: true });

    process.env.CCV_PROJECT_DIR = dir;
    const handler = handlerFor('/api/git-repos', 'GET');
    const { status, json } = await callGet(handler, '/api/git-repos', makeDeps(dir));
    assert.equal(status, 200);
    const repos = json().repos;
    const names = repos.map(r => r.name).sort();
    // root 用 basename(dir)，子仓库 frontend/backend
    assert.ok(names.includes(basename(dir)), 'root repo present');
    assert.ok(names.includes('frontend'));
    assert.ok(names.includes('backend'));
    assert.ok(!names.includes('.hidden'), 'hidden dir skipped');
    assert.ok(!names.includes('node_modules'), 'node_modules skipped');
    assert.ok(!names.includes('plaindir'), 'non-git dir skipped');
    // root entry 标记
    const root = repos.find(r => r.path === '.');
    assert.ok(root && root.isRoot === true);
    const sub = repos.find(r => r.name === 'frontend');
    assert.equal(sub.isRoot, false);
    assert.equal(sub.path, 'frontend');
  });

  it('omits root entry when project dir is not a git repo', async () => {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    initRepo(join(dir, 'sub'));
    process.env.CCV_PROJECT_DIR = dir;
    const handler = handlerFor('/api/git-repos', 'GET');
    const { json } = await callGet(handler, '/api/git-repos', makeDeps(dir));
    const repos = json().repos;
    assert.ok(!repos.some(r => r.isRoot), 'no root entry');
    assert.ok(repos.some(r => r.name === 'sub'));
  });

  it('returns 500 with empty repos when readdir throws (project dir missing)', async () => {
    process.env.CCV_PROJECT_DIR = join(dir, 'does-not-exist');
    const handler = handlerFor('/api/git-repos', 'GET');
    const { status, json } = await callGet(handler, '/api/git-repos', makeDeps(dir));
    assert.equal(status, 500);
    assert.deepEqual(json().repos, []);
    assert.ok(typeof json().error === 'string');
  });
});

// ====================================================================
// gitStatus
// ====================================================================
describe('gitStatus GET /api/git-status', { concurrency: false }, () => {
  let dir, deps, handler;
  beforeEach(() => {
    dir = mkdtempSync(join(TMP_ROOT, 'status-'));
    initRepo(dir);
    deps = makeDeps(dir);
    handler = handlerFor('/api/git-status', 'GET');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('400 on invalid repo param', async () => {
    const { status, json } = await callGet(handler, '/api/git-status?repo=../escape', deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid repo parameter');
    assert.deepEqual(json().changes, []);
  });

  it('reports staged + modified + untracked changes with line counts', async () => {
    commit(dir, 'base.txt', 'l1\nl2\n', 'init');
    // modified tracked
    writeFileSync(join(dir, 'base.txt'), 'l1\nCHANGED\nl3\n');
    // staged new file
    writeFileSync(join(dir, 'staged.txt'), 'a\nb\n');
    execSync('git add staged.txt', { cwd: dir, stdio: 'pipe' });
    // untracked file (2 lines)
    writeFileSync(join(dir, 'untracked.txt'), 'u1\nu2\n');

    const { status, json } = await callGet(handler, '/api/git-status', deps);
    assert.equal(status, 200);
    const data = json();
    const files = data.changes.map(c => c.file).sort();
    assert.deepEqual(files, ['base.txt', 'staged.txt', 'untracked.txt']);
    const untracked = data.changes.find(c => c.file === 'untracked.txt');
    assert.equal(untracked.status, '??');
    const staged = data.changes.find(c => c.file === 'staged.txt');
    assert.equal(staged.status, 'A');
    // insertions 应至少含 staged(2) + untracked(2) + 修改新增行
    assert.ok(data.insertions >= 4, `insertions=${data.insertions}`);
    assert.equal(typeof data.deletions, 'number');
    assert.equal(data.insertions_capped, false);
  });

  it('decodes octal-escaped non-ASCII filenames from porcelain quoting', async () => {
    // 中文文件名会被 git status --porcelain 用 "\\xxx" 八进制转义并加引号
    const cn = '中文.txt';
    writeFileSync(join(dir, cn), 'hi\n');
    const { json } = await callGet(handler, '/api/git-status', deps);
    const files = json().changes.map(c => c.file);
    assert.ok(files.includes(cn), `decoded filename should be ${cn}, got ${JSON.stringify(files)}`);
  });

  it('empty clean repo yields no changes and zero stats', async () => {
    commit(dir, 'only.txt', 'x\n', 'init');
    const { status, json } = await callGet(handler, '/api/git-status', deps);
    assert.equal(status, 200);
    assert.deepEqual(json().changes, []);
    assert.equal(json().insertions, 0);
    assert.equal(json().deletions, 0);
  });

  it('500 when execFileAsync (git) rejects', async () => {
    const badDeps = {
      ...deps,
      execFileAsync: async () => { throw new Error('boom git'); },
    };
    const { status, json } = await callGet(handler, '/api/git-status', badDeps);
    assert.equal(status, 500);
    assert.equal(json().error, 'boom git');
    assert.deepEqual(json().changes, []);
  });
});

// ====================================================================
// gitDiff
// ====================================================================
describe('gitDiff GET /api/git-diff', { concurrency: false }, () => {
  let dir, deps, handler;
  beforeEach(() => {
    dir = mkdtempSync(join(TMP_ROOT, 'diff-'));
    initRepo(dir);
    deps = makeDeps(dir);
    handler = handlerFor('/api/git-diff', 'GET');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('400 on invalid repo param', async () => {
    const { status, json } = await callGet(handler, '/api/git-diff?repo=a/b&files=x', deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid repo parameter');
    assert.deepEqual(json().diffs, []);
  });

  it('400 when files param is missing', async () => {
    const { status, json } = await callGet(handler, '/api/git-diff', deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Missing files parameter');
  });

  it('returns diff for a modified tracked file', async () => {
    commit(dir, 'm.txt', 'one\ntwo\n', 'init');
    writeFileSync(join(dir, 'm.txt'), 'one\nTWO\n');
    const { status, json } = await callGet(handler, '/api/git-diff?files=m.txt', deps);
    assert.equal(status, 200);
    const diffs = json().diffs;
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].file, 'm.txt');
    assert.equal(diffs[0].old_content, 'one\ntwo\n');
    assert.equal(diffs[0].new_content, 'one\nTWO\n');
  });

  it('trims and filters files list; empty entries dropped', async () => {
    writeFileSync(join(dir, 'n.txt'), 'fresh\n');
    const { status, json } = await callGet(handler, '/api/git-diff?files=' + encodeURIComponent(' n.txt , , '), deps);
    assert.equal(status, 200);
    assert.equal(json().diffs.length, 1);
    assert.equal(json().diffs[0].file, 'n.txt');
    assert.equal(json().diffs[0].is_new, true);
  });

  it('ignores malformed commit hash (falls back to working tree)', async () => {
    commit(dir, 'c.txt', 'a\n', 'init');
    writeFileSync(join(dir, 'c.txt'), 'a\nb\n');
    // commit 参数非法 → commitHash=undefined → 工作树模式
    const { status, json } = await callGet(handler, '/api/git-diff?files=c.txt&commit=not-a-hash!!', deps);
    assert.equal(status, 200);
    assert.equal(json().diffs.length, 1);
    assert.equal(json().diffs[0].new_content, 'a\nb\n');
  });

  it('uses a valid commit hash to diff against that commit', async () => {
    commit(dir, 'h.txt', 'v1\n', 'first');
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    commit(dir, 'h.txt', 'v2\n', 'second');
    const { status, json } = await callGet(handler, `/api/git-diff?files=h.txt&commit=${sha}`, deps);
    assert.equal(status, 200);
    // commit 模式：getGitDiffs 对第一个 commit 走 `git diff-tree --root <sha>` => 'A\th.txt'，
    // 内容取自被 diff 的那个 commit（first，即 v1），不是工作树的 v2。
    const diffs = json().diffs;
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].file, 'h.txt');
    assert.equal(diffs[0].status, 'A');
    assert.equal(diffs[0].is_new, true);
    assert.equal(diffs[0].old_content, '');
    assert.equal(diffs[0].new_content, 'v1\n');
  });

  it('500 when getGitDiffs internals throw via resolveRepoCwd-good but git failure', async () => {
    // 让 execFile-based getGitDiffs 失败：把 cwd 指到一个非 git 目录会被 resolveRepoCwd 拦截，
    // 改为注入会抛错的 resolveRepoCwd 来命中 catch 分支。
    const badDeps = { ...deps, resolveRepoCwd() { throw new Error('resolve boom'); } };
    const { status, json } = await callGet(handler, '/api/git-diff?files=x.txt', badDeps);
    assert.equal(status, 500);
    assert.equal(json().error, 'resolve boom');
    assert.deepEqual(json().diffs, []);
  });
});

// ====================================================================
// gitLogUnpushed
// ====================================================================
describe('gitLogUnpushed GET /api/git-log-unpushed', { concurrency: false }, () => {
  let dir, deps, handler;
  beforeEach(() => {
    dir = mkdtempSync(join(TMP_ROOT, 'unpushed-'));
    initRepo(dir);
    deps = makeDeps(dir);
    handler = handlerFor('/api/git-log-unpushed', 'GET');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('400 on invalid repo param', async () => {
    const { status, json } = await callGet(handler, '/api/git-log-unpushed?repo=..', deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid repo parameter');
    assert.deepEqual(json().commits, []);
    assert.equal(json().hasUpstream, false);
  });

  it('no upstream → hasUpstream false, commits empty', async () => {
    commit(dir, 'a.txt', 'a\n', 'c1');
    const { status, json } = await callGet(handler, '/api/git-log-unpushed', deps);
    assert.equal(status, 200);
    assert.equal(json().hasUpstream, false);
    assert.deepEqual(json().commits, []);
  });

  it('with an upstream and unpushed commits → lists them', async () => {
    // 造一个本地 "remote"：clone 后在 clone 里再提交
    commit(dir, 'a.txt', 'a\n', 'base');
    const remote = mkdtempSync(join(TMP_ROOT, 'remote-'));
    rmSync(remote, { recursive: true, force: true });
    execSync(`git clone "${dir}" "${remote}"`, { stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: remote, stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: remote, stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { cwd: remote, stdio: 'pipe' });
    // clone 自带 origin 上游；在 clone 中新增本地未推送 commit
    writeFileSync(join(remote, 'b.txt'), 'b\n');
    execSync('git add b.txt && git commit -m "unpushed-one"', { cwd: remote, stdio: 'pipe' });

    const remoteDeps = makeDeps(remote);
    const { status, json } = await callGet(handler, '/api/git-log-unpushed', remoteDeps);
    assert.equal(status, 200);
    assert.equal(json().hasUpstream, true);
    assert.ok(json().commits.some(c => (c.subject || c.message || '').includes('unpushed-one')),
      `commits=${JSON.stringify(json().commits)}`);
    rmSync(remote, { recursive: true, force: true });
  });

  it('500 when getUnpushedCommits throws via resolveRepoCwd error', async () => {
    const badDeps = { ...deps, resolveRepoCwd() { throw new Error('cwd fail'); } };
    const { status, json } = await callGet(handler, '/api/git-log-unpushed', badDeps);
    assert.equal(status, 500);
    assert.equal(json().error, 'cwd fail');
    assert.deepEqual(json().commits, []);
    assert.equal(json().hasUpstream, false);
  });
});

// ====================================================================
// gitRestore (POST, streaming body)
// ====================================================================
describe('gitRestore POST /api/git-restore', { concurrency: false }, () => {
  let dir, deps, handler;
  beforeEach(() => {
    dir = mkdtempSync(join(TMP_ROOT, 'restore-'));
    initRepo(dir);
    commit(dir, 'seed.txt', 'seed\n', 'init');
    deps = makeDeps(dir);
    handler = handlerFor('/api/git-restore', 'POST');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('400 on invalid JSON body', async () => {
    const { status, json } = await callPost(handler, '/api/git-restore', 'not-json{', deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid request body');
  });

  it('400 on missing path', async () => {
    const { status, json } = await callPost(handler, '/api/git-restore', {}, deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Missing path');
  });

  it('400 on absolute path', async () => {
    const { status, json } = await callPost(handler, '/api/git-restore', { path: '/etc/passwd' }, deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid path');
  });

  it('400 on ../ traversal', async () => {
    const { status, json } = await callPost(handler, '/api/git-restore', { path: '../x' }, deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid path');
  });

  it('400 on invalid repo parameter', async () => {
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'seed.txt', repo: 'a/b' }, deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Invalid repo parameter');
  });

  it('reverts a modified tracked file to HEAD content', async () => {
    writeFileSync(join(dir, 'seed.txt'), 'tampered\n');
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'seed.txt' }, deps);
    assert.equal(status, 200);
    assert.equal(json().ok, true);
    assert.equal(readFileSync(join(dir, 'seed.txt'), 'utf-8'), 'seed\n');
  });

  it('removes an untracked file (git clean branch)', async () => {
    writeFileSync(join(dir, 'fresh.txt'), 'just made\n');
    assert.ok(existsSync(join(dir, 'fresh.txt')));
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'fresh.txt' }, deps);
    assert.equal(status, 200);
    assert.equal(json().ok, true);
    assert.equal(existsSync(join(dir, 'fresh.txt')), false);
  });

  it('restores a file deleted from the working tree (existsSync-false branch)', async () => {
    unlinkSync(join(dir, 'seed.txt'));
    assert.equal(existsSync(join(dir, 'seed.txt')), false);
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'seed.txt' }, deps);
    assert.equal(status, 200);
    assert.equal(json().ok, true);
    assert.equal(readFileSync(join(dir, 'seed.txt'), 'utf-8'), 'seed\n');
  });

  it('serializes concurrent restores of the same file via the lock map', async () => {
    writeFileSync(join(dir, 'seed.txt'), 'A\n');
    const p1 = callPost(handler, '/api/git-restore', { path: 'seed.txt' }, deps);
    const p2 = callPost(handler, '/api/git-restore', { path: 'seed.txt' }, deps);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(readFileSync(join(dir, 'seed.txt'), 'utf-8'), 'seed\n');
    // 锁完成后应自清理
    assert.equal(deps.gitRestoreLocks.size, 0);
  });

  it('400 when a symlink target escapes cwd (realpath traversal guard)', async () => {
    // filePath 本身不含 .. 也非绝对路径，但 realpath 解析到 cwd 外 → 命中 realpathSync 越权分支
    const outside = mkdtempSync(join(TMP_ROOT, 'outside-'));
    const secret = join(outside, 'secret.txt');
    writeFileSync(secret, 'top secret\n');
    try {
      symlinkSync(secret, join(dir, 'link.txt'));
    } catch {
      // 某些文件系统不支持 symlink，跳过断言但不让用例失败
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'link.txt' }, deps);
    assert.equal(status, 400);
    assert.equal(json().error, 'Path traversal not allowed');
    rmSync(outside, { recursive: true, force: true });
  });

  it('500 when git status execFileAsync rejects', async () => {
    const badDeps = {
      ...deps,
      execFileAsync: async () => { throw new Error('status fail'); },
    };
    const { status, json } = await callPost(handler, '/api/git-restore', { path: 'seed.txt' }, badDeps);
    assert.equal(status, 500);
    assert.equal(json().error, 'status fail');
  });
});

after(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});
