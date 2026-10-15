/**
 * 服务端只读路由 ?project= 支持（multi-project, 2026-10）—— 代表路由验证：
 * /api/files、/api/skills、/api/project-stats、/api/proxy-stats、/api/resume-sessions
 * 跟随 viewedProject；未知项目 404；写路由 parity（不带 ?project= 行为不变）。
 *
 * Fixture 模式同 resume-route.test.js（隔离 CCV_LOG_DIR、直接调 handler、捕获 res）。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-view-routes-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { filesFsRoutes } = await import('../server/routes/files-fs.js');
const { skillsRoutes } = await import('../server/routes/skills.js');
const { projectMetaRoutes } = await import('../server/routes/project-meta.js');
const { proxyStatsRoutes } = await import('../server/routes/proxy-stats.js');
const { resumeRoutes } = await import('../server/routes/resume.js');
const { initForWorkspace } = await import('../server/interceptor.js');
const { registerWorkspace } = await import('../server/workspace-registry.js');
const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
const { registerSdkSessionLister } = await import('../server/lib/sdk-session-index.js');

// 绑定项目 + 一个 registered 的并行项目（有真实目录与文件）。
const boundDir = join(tmpDir, 'boundProj');
const parallelDir = join(tmpDir, 'parallelProj');
mkdirSync(join(boundDir, 'subdir'), { recursive: true });
mkdirSync(join(parallelDir, 'psubdir'), { recursive: true });
writeFileSync(join(boundDir, 'bound-file.txt'), 'bound');
writeFileSync(join(parallelDir, 'parallel-file.txt'), 'parallel');
writeFileSync(join(parallelDir, 'psubdir', 'nested.txt'), 'nested');
const parallelName = projectKeyForCwd(parallelDir);

initForWorkspace(boundDir, { forceNew: true });
process.env.CCV_PROJECT_DIR = boundDir;
await registerWorkspace(parallelDir);

after(() => {
  delete process.env.CCV_PROJECT_DIR;
  registerSdkSessionLister(null);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function findRoute(routes, method, path) {
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

function callGet(handler, url, deps = {}) {
  return new Promise((resolve) => {
    let status = 0;
    let payload = '';
    const res = {
      writeHead(code) { status = code; },
      end(b) { payload = b || ''; resolve({ status, body: safeJson(payload), raw: payload }); },
    };
    const parsedUrl = new URL(url, 'http://localhost');
    const out = handler({ method: 'GET', headers: {} }, res, parsedUrl, true, { MAX_POST_BODY: 1 << 20, IGNORED_PATTERNS: new Set(), ...deps });
    if (out && typeof out.then === 'function') out.catch((e) => resolve({ status: -1, body: { error: String(e) }, raw: '' }));
  });
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

describe('/api/files ?project=', () => {
  const files = findRoute(filesFsRoutes, 'GET', '/api/files');

  it('无 ?project= → 绑定项目（parity）', async () => {
    const { status, body } = await callGet(files, '/api/files?path=.');
    assert.equal(status, 200);
    const names = (body?.items || body || []).map((i) => i.name || i);
    assert.ok(JSON.stringify(body).includes('bound-file.txt'), `绑定项目文件: ${JSON.stringify(body)?.slice(0, 300)}`);
  });

  it('?project=<registered> → 并行项目文件树', async () => {
    const { status, body } = await callGet(files, `/api/files?path=.&project=${encodeURIComponent(parallelName)}`);
    assert.equal(status, 200);
    assert.ok(JSON.stringify(body).includes('parallel-file.txt'), `并行项目文件: ${JSON.stringify(body)?.slice(0, 300)}`);
    assert.ok(!JSON.stringify(body).includes('bound-file.txt'), '不应出现绑定项目文件');
  });

  it('?project=ghost → 404', async () => {
    const { status, body } = await callGet(files, '/api/files?path=.&project=ghost-no-such');
    assert.equal(status, 404);
    assert.equal(body?.error, 'unknown project');
  });

  it('SDK instance identity loads the exact same-name workspace instead of returning ambiguous', async () => {
    const dirA = join(tmpDir, 'sdk-a', 'sameFiles');
    const dirB = join(tmpDir, 'sdk-b', 'sameFiles');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(join(dirA, 'from-a.txt'), 'a');
    writeFileSync(join(dirB, 'from-b.txt'), 'b');
    await registerWorkspace(dirA);
    await registerWorkspace(dirB);
    const keyA = 'ccv-' + 'a'.repeat(32);
    const keyB = 'ccv-' + 'b'.repeat(32);
    registerSdkSessionLister(() => [
      { cwd: dirA, instanceKey: keyA, active: false },
      { cwd: dirB, instanceKey: keyB, active: true },
    ]);
    try {
      const ambiguous = await callGet(files, '/api/files?path=.&project=sameFiles');
      assert.equal(ambiguous.status, 400);
      const exact = await callGet(files, `/api/files?path=.&project=sameFiles&instance=${keyB}`);
      assert.equal(exact.status, 200);
      assert.ok(JSON.stringify(exact.body).includes('from-b.txt'));
      assert.ok(!JSON.stringify(exact.body).includes('from-a.txt'));
    } finally {
      registerSdkSessionLister(null);
    }
  });
});

describe('/api/skills ?project=', () => {
  const skills = findRoute(skillsRoutes, 'GET', '/api/skills');
  it('?project=<registered> → 并行项目技能列表（空但不 404/500）', async () => {
    const { status, body } = await callGet(skills, `/api/skills?project=${encodeURIComponent(parallelName)}`);
    assert.equal(status, 200);
    assert.equal(body?.ok, true);
    assert.ok(Array.isArray(body?.skills));
  });
  it('?project=ghost → 404', async () => {
    const { status } = await callGet(skills, '/api/skills?project=ghost-no-such');
    assert.equal(status, 404);
  });
});

describe('/api/project-stats + /api/proxy-stats ?project=', () => {
  const pStats = findRoute(projectMetaRoutes, 'GET', '/api/project-stats');
  const xStats = findRoute(proxyStatsRoutes, 'GET', '/api/proxy-stats');

  it('project-stats ?project=<name> → 按名取 log-store（无文件时 404 而非 500）', async () => {
    const { status } = await callGet(pStats, `/api/project-stats?project=${encodeURIComponent(parallelName)}`);
    assert.ok(status === 404 || status === 200, `按名查询不 500: ${status}`);
  });

  it('proxy-stats ?project=<name> → proxyStats null（无数据时 200 + null，不 500）', async () => {
    const { status, body } = await callGet(xStats, `/api/proxy-stats?project=${encodeURIComponent(parallelName)}`);
    assert.equal(status, 200);
    assert.ok('proxyStats' in (body || {}));
  });

  it('proxy-stats 无 ?project= → 绑定项目（parity：有 _projectName 时不 404）', async () => {
    const { status } = await callGet(xStats, '/api/proxy-stats');
    assert.ok(status !== 500, `parity 不 500: ${status}`);
  });

  it('stats routes consume instance identity instead of rejecting a same-name SDK project', async () => {
    const dir = join(tmpDir, 'sdk-b', 'sameFiles');
    const key = 'ccv-' + 'b'.repeat(32);
    registerSdkSessionLister(() => [{ cwd: dir, instanceKey: key, active: true }]);
    try {
      const query = `project=sameFiles&instance=${key}`;
      const projectStats = await callGet(pStats, `/api/project-stats?${query}`);
      assert.notEqual(projectStats.status, 400);
      const proxyStats = await callGet(xStats, `/api/proxy-stats?${query}`);
      assert.equal(proxyStats.status, 200);
      assert.ok('proxyStats' in (proxyStats.body || {}));
    } finally {
      registerSdkSessionLister(null);
    }
  });

  it('a forged arbitrary name paired with a valid instance must NOT bypass the LOG_DIR guard', async () => {
    // Regression (review P1): resolveViewRoot resolves a valid instance BEFORE name
    // validation, so the stats name must derive from the RESOLVED project — never the raw
    // ?project= — or any live instance key becomes a LOG_DIR presence oracle over names.
    const dir = join(tmpDir, 'sdk-b', 'sameFiles');
    const key = 'ccv-' + 'b'.repeat(32);
    registerSdkSessionLister(() => [{ cwd: dir, instanceKey: key, active: true }]);
    // Plant BOTH stores with discriminating sentinels: the forged name's own store
    // (the oracle victim) and the resolved project's store. Pre-fix the response leaks
    // the victim's sentinel; a correct route must serve the RESOLVED project's data.
    const forgedName = 'not-a-registered-name';
    mkdirSync(join(tmpDir, forgedName), { recursive: true });
    writeFileSync(join(tmpDir, forgedName, `${forgedName}.json`), JSON.stringify({ sentinel: 'VICTIM-STORE', totals: { inputTokens: 999999 } }));
    mkdirSync(join(tmpDir, 'sameFiles'), { recursive: true });
    writeFileSync(join(tmpDir, 'sameFiles', 'sameFiles.json'), JSON.stringify({ sentinel: 'RESOLVED-STORE', totals: { inputTokens: 111 } }));
    try {
      const forged = `project=${forgedName}&instance=${key}`;
      const p = await callGet(pStats, `/api/project-stats?${forged}`);
      assert.equal(p.status, 200, 'resolved project has a stats file');
      assert.equal(p.body && p.body.sentinel, 'RESOLVED-STORE',
        'the response must describe the RESOLVED project, never the forged name\'s store (oracle closed)');
      // The forged name's own store must never be the lookup target for any request shape.
      const probe = await callGet(pStats, `/api/project-stats?project=${forgedName}`);
      assert.equal(probe.status, 404, 'the unregistered name alone stays 404 (never served, even though its store exists on disk)');
      assert.notEqual(probe.body && probe.body.sentinel, 'VICTIM-STORE');
    } finally {
      registerSdkSessionLister(null);
    }
  });

  it('stats follow a leaf-symlinked workspace by its RAW basename (store key), not the realpath target', async () => {
    // Regression (review round-2): resolveViewRoot realpathSync()s its root, but the
    // LOG_DIR store is keyed by the RAW launch basename (interceptor.initForWorkspace).
    // A leaf-symlinked workspace must read ITS OWN store, not the link target's.
    const { symlinkSync } = await import('node:fs');
    const realLeaf = join(tmpDir, 'symlink-target', 'realLeafDir');
    mkdirSync(realLeaf, { recursive: true });
    const alias = join(tmpDir, 'aliasLeaf');
    try { symlinkSync(realLeaf, alias, 'dir'); } catch { return; } // platform without symlink perms: skip
    const aliasName = projectKeyForCwd(alias);
    mkdirSync(join(tmpDir, aliasName), { recursive: true });
    writeFileSync(join(tmpDir, aliasName, `${aliasName}.json`), JSON.stringify({ sentinel: 'ALIAS-STORE', totals: { inputTokens: 222 } }));
    await registerWorkspace(alias);
    const p = await callGet(pStats, `/api/project-stats?project=${encodeURIComponent(aliasName)}`);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body && p.body.sentinel, 'ALIAS-STORE', 'symlinked leaf reads its own store name, not the realpath target\'s');
  });
});

describe('/api/resume-sessions ?project=', () => {
  const sessions = findRoute(resumeRoutes, 'GET', '/api/resume-sessions');
  it('?project=<name> → 按名列会话（空 store 也 200 + items[]）', async () => {
    const { status, body } = await callGet(sessions, `/api/resume-sessions?limit=5&project=${encodeURIComponent(parallelName)}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.items));
  });
  it('无 ?project= → 绑定项目（parity）', async () => {
    const { status, body } = await callGet(sessions, '/api/resume-sessions?limit=5');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body?.items));
  });
});

describe('写路由 parity（不带 ?project= 行为不变）', () => {
  it('rename/move/delete/git-restore/search-replace/file-content POST 无 ?project= 分支（源码锚点）', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join: j } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const filesFs = readFileSync(j(here, '../server/routes/files-fs.js'), 'utf8');
    const git = readFileSync(j(here, '../server/routes/git.js'), 'utf8');
    const search = readFileSync(j(here, '../server/routes/search.js'), 'utf8');
    const filesContent = readFileSync(j(here, '../server/routes/files-content.js'), 'utf8');
    // 写 handler 不得出现 _viewRootOrReply（它们必须保持绑定根）。
    for (const name of ['renameFile', 'moveFile', 'deleteFile', 'createFile', 'createDir', 'importFile']) {
      const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]{0,300}?_viewRootOrReply`);
      assert.ok(!re.test(filesFs), `${name} 不得走 view-root`);
    }
    assert.ok(!/function gitRestore\([^)]*\) \{[\s\S]{0,300}?_viewRootOrReply/.test(git), 'gitRestore 不得走 view-root');
    assert.ok(!/function replaceHandler\([^)]*\) \{[\s\S]{0,300}?_viewRootOrReply/.test(search), 'search-replace 不得走 view-root');
    assert.ok(!/function fileContentPost\([^)]*\) \{[\s\S]{0,400}?_viewRootOrReply/.test(filesContent), 'file-content POST 不得走 view-root');
  });
});
