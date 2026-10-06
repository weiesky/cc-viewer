/**
 * 第四轮 review 配套测试（2026-10）：
 * ① filesExists POST body {project} 正路径（files-fs.js）
 * ② git ?project= 正路径（git.js gitRepos/gitStatus）
 * ③ resolve-path 保持 bound（不接 ?project=，防 foreign 绝对路径回显）
 * ④ viewProject 穿线契约（gitApi._q / searchApi body / AppHeader _withProject / ImageViewer）
 * ⑤ sid-detach 场景（detach-view-reset 语义扩展：纯 sid-detach 也全量重置）
 *
 * Fixture 同 view-routes-project.test.js（隔离 CCV_LOG_DIR、直接调 handler、捕获 res）。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-r4-routes-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { filesFsRoutes } = await import('../server/routes/files-fs.js');
const { gitRoutes } = await import('../server/routes/git.js');
const { initForWorkspace } = await import('../server/interceptor.js');
const { registerWorkspace } = await import('../server/workspace-registry.js');
const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');

const boundDir = join(tmpDir, 'boundProj');
const parallelDir = join(tmpDir, 'parallelProj');
mkdirSync(join(boundDir, 'sub'), { recursive: true });
mkdirSync(join(parallelDir, 'psub'), { recursive: true });
writeFileSync(join(boundDir, 'b.txt'), 'b');
writeFileSync(join(parallelDir, 'p.txt'), 'p');
writeFileSync(join(parallelDir, 'psub', 'nested.txt'), 'n');
const parallelName = projectKeyForCwd(parallelDir);

initForWorkspace(boundDir, { forceNew: true });
process.env.CCV_PROJECT_DIR = boundDir;
await registerWorkspace(parallelDir);

after(() => {
  delete process.env.CCV_PROJECT_DIR;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function findRoute(routes, method, path) {
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}
function callGet(handler, url, deps = {}) {
  return new Promise((resolve) => {
    let status = 0, payload = '';
    const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: safeJson(payload) }); } };
    const out = handler({ method: 'GET', headers: {} }, res, new URL(url, 'http://localhost'), true, { MAX_POST_BODY: 1 << 20, IGNORED_PATTERNS: new Set(), ...deps });
    if (out && typeof out.then === 'function') out.catch((e) => resolve({ status: -1, body: { error: String(e) } }));
  });
}
function callPost(handler, url, bodyObj, deps = {}) {
  return new Promise((resolve) => {
    let status = 0, payload = '';
    const req = new EventEmitter();
    req.headers = {};
    const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: safeJson(payload) }); } };
    handler(req, res, new URL(url, 'http://localhost'), true, { MAX_POST_BODY: 1 << 20, IGNORED_PATTERNS: new Set(), ...deps });
    req.emit('data', JSON.stringify(bodyObj));
    req.emit('end');
  });
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

describe('① filesExists POST body {project}', () => {
  const filesExists = findRoute(filesFsRoutes, 'POST', '/api/files-exists');

  it('body {project} → 探测并行项目文件（绑定项目文件应为 false）', async () => {
    const { status, body } = await callPost(filesExists, '/api/files-exists', {
      paths: ['p.txt', 'psub/nested.txt', 'b.txt'],
      project: parallelName,
    });
    assert.equal(status, 200);
    const m = new Map((body?.results || []).map((r) => [r.path, r.exists]));
    assert.equal(m.get('p.txt'), true, '并行项目文件存在');
    assert.equal(m.get('psub/nested.txt'), true, '并行项目嵌套文件存在');
    assert.equal(m.get('b.txt'), false, '绑定项目文件在并行项目下不存在');
  });

  it('body {project: ghost} → 404', async () => {
    const { status } = await callPost(filesExists, '/api/files-exists', { paths: ['x.txt'], project: 'ghost-no-such' });
    assert.equal(status, 404);
  });

  it('不带 project → 绑定项目（parity）', async () => {
    const { status, body } = await callPost(filesExists, '/api/files-exists', { paths: ['b.txt', 'p.txt'] });
    assert.equal(status, 200);
    const m = new Map((body?.results || []).map((r) => [r.path, r.exists]));
    assert.equal(m.get('b.txt'), true);
    assert.equal(m.get('p.txt'), false);
  });
});

describe('② git ?project=（无 git 仓库环境的语义）', () => {
  const gitRepos = gitRoutes.find((r) => r.path === '/api/git-repos').handler;
  const gitStatus = gitRoutes.find((r) => r.path === '/api/git-status').handler;

  it('gitRepos ?project=<registered> → 按并行项目根扫描（未知项目 404）', async () => {
    const okRes = await callGet(gitRepos, `/api/git-repos?project=${encodeURIComponent(parallelName)}`);
    assert.equal(okRes.status, 200, `registered 并行项目不 404: ${okRes.status}`);
    assert.ok(Array.isArray(okRes.body?.repos));
    const ghost = await callGet(gitRepos, '/api/git-repos?project=ghost-no-such');
    assert.equal(ghost.status, 404);
  });

  it('gitStatus ?project=ghost → 404', async () => {
    const r = await callGet(gitStatus, '/api/git-status?project=ghost-no-such', { resolveRepoCwd: (repo, base) => base });
    assert.equal(r.status, 404);
  });
});

describe('③ resolve-path 保持 bound（不接 ?project=）', () => {
  const resolvePath = findRoute(filesFsRoutes, 'POST', '/api/resolve-path');

  it('?project= 被忽略：仍解析绑定项目根（不回显 foreign 绝对路径）', async () => {
    const { status, body } = await callPost(resolvePath, `/api/resolve-path?project=${encodeURIComponent(parallelName)}`, { path: 'b.txt' });
    assert.equal(status, 200);
    assert.equal(body?.fullPath, join(boundDir, 'b.txt'), 'resolve-path 必须保持 bound');
    assert.ok(!String(body?.fullPath || '').includes(parallelDir), '绝不解析到并行项目');
  });
});

describe('④ viewProject 穿线契约（源码锚点）', () => {
  it('gitApi 经 withViewParams 拼 ?project=/?instance=；fetchAllRepos 全部请求带参', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../../apps/web/src/utils/gitApi.js', import.meta.url), 'utf8');
    assert.ok(src.includes("withViewParams('/api/git-repos', { project, instance })"), 'git-repos 拼 project+instance');
    assert.ok(/fetchAllRepos\(project, instance\)/.test(src), 'fetchAllRepos 接受 project+instance');
    assert.ok((src.match(/withViewParams\(`\/api\/git-(status|log-unpushed)\?repo=\$\{encodeURIComponent\(repo\.path\)\}`, \{ project, instance \}\)/g) || []).length >= 2, 'git-status/git-log-unpushed 都拼参');
  });

  it('searchApi.searchCode 把 project+instance 放进 body', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../../apps/web/src/utils/searchApi.js', import.meta.url), 'utf8');
    assert.ok(src.includes('...(project ? { project } : {})'), 'searchCode body 带 project');
    assert.ok(src.includes('...(instance ? { instance } : {})'), 'searchCode body 带 instance');
  });

  it('AppHeader seqResourceLoaders._withProject 经 withViewParams 拼 ?project=/?instance=', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../../apps/web/src/utils/seqResourceLoaders.js', import.meta.url), 'utf8');
    assert.ok(src.includes('function _withProject(path, project, instance)'), 'seqResourceLoaders._withProject(path, project, instance)');
    assert.ok(src.includes('withViewParams(path, { project, instance })'), '委托 withViewParams 拼参');
  });

  it('ImageViewer 接受 project+instance 并经 withViewParams 拼参', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../../apps/web/src/components/viewers/ImageViewer.jsx', import.meta.url), 'utf8');
    assert.ok(/ImageViewer\(\{[^}]*project[^}]*instance[^}]*\}\)/.test(src), 'ImageViewer project+instance prop');
    assert.ok(src.includes('withViewParams('), 'file-raw 经 withViewParams 拼参');
  });
});

describe('⑤ sid-detach 场景语义（镜像 + 锚点）', () => {
  it('纯 sid-detach（attachedSid-only）也走全量重置（锚点）', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../../apps/web/src/AppBase.jsx', import.meta.url), 'utf8');
    // handleDetachView 的触发条件是 attachedSid || viewedProject —— 纯 sid-detach 同样命中。
    assert.ok(/if \(!this\.state\.attachedSid && !this\.state\.viewedProject\) return;/.test(src), 'sid-only detach 不被跳过');
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1200}?requests: \[\],/.test(src), 'sid-detach 同样清 entries');
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1200}?resumeSwitch: \{ uuid: this\.state\.projectName \|\| 'bound' \}/.test(src), 'sid-detach 同样置遮罩');
  });
});
