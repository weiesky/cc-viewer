/**
 * POST /api/git-restore endpoint tests
 *
 * 覆盖（issue #84 回归）：
 *   - 修改的 tracked 文件 → revert 恢复到 committed 内容
 *   - 未跟踪文件（??） → revert 删除文件
 *   - 工作树删除的 tracked 文件 → revert 重建文件
 *   - 路径穿越 ../ 与绝对路径 → 400
 *   - 嵌套子目录（带原生 path separator）→ 不命中 Windows 路径分隔符锅
 *   - isPathContained helper 单元测试（不同分隔符下的等价语义）
 *
 * 隔离：mktemp 一个临时 git repo 作 CCV_PROJECT_DIR；env 必须在 server.js 首次 import 之前
 *       设好，否则 file-access-policy 顶层 STARTUP_CWD 锁定。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { isPathContained } from '../server/lib/file-api.js';

const TMP = mkdtempSync(join(tmpdir(), 'ccv-git-restore-'));
const PROJECT = join(TMP, 'project');

mkdirSync(PROJECT, { recursive: true });
execSync('git init', { cwd: PROJECT, stdio: 'pipe' });
execSync('git config user.email "test@test.com"', { cwd: PROJECT, stdio: 'pipe' });
execSync('git config user.name "Test"', { cwd: PROJECT, stdio: 'pipe' });
// 初始 commit 让 HEAD 存在，后续 git checkout -- 才有参照
writeFileSync(join(PROJECT, 'seed.txt'), 'seed\n');
execSync('git add seed.txt && git commit -m "init"', { cwd: PROJECT, stdio: 'pipe' });

process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好。
// 注:顶部 line 22 静态 import 的是 file-api.js(仅 node 内置依赖,不拉 server.js),server.js 由 before() 动态 import,此处端口窗在其加载前已生效。
process.env.CCV_START_PORT = '17940';
process.env.CCV_MAX_PORT = '17949';

function httpJson(port, path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data,
          json() { try { return JSON.parse(data); } catch { return null; } },
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('POST /api/git-restore', { concurrency: false }, () => {
  let stopViewer;
  let port;

  before(async () => {
    const mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv);
    port = mod.getPort();
    stopViewer = mod.stopViewer;
    assert.ok(port > 0);
  });

  after(() => {
    try { stopViewer && stopViewer(); } catch {}
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it('restores modified tracked file to HEAD content', async () => {
    writeFileSync(join(PROJECT, 'a.txt'), 'original\n');
    execSync('git add a.txt && git commit -m "add a"', { cwd: PROJECT, stdio: 'pipe' });
    writeFileSync(join(PROJECT, 'a.txt'), 'tampered\n');
    assert.equal(readFileSync(join(PROJECT, 'a.txt'), 'utf-8'), 'tampered\n');

    const res = await httpJson(port, '/api/git-restore', 'POST', { path: 'a.txt' });
    assert.equal(res.status, 200, `body: ${res.body}`);
    assert.equal(res.json().ok, true);
    assert.equal(readFileSync(join(PROJECT, 'a.txt'), 'utf-8'), 'original\n');
  });

  it('removes untracked file', async () => {
    writeFileSync(join(PROJECT, 'fresh.txt'), 'just made\n');
    assert.ok(existsSync(join(PROJECT, 'fresh.txt')));

    const res = await httpJson(port, '/api/git-restore', 'POST', { path: 'fresh.txt' });
    assert.equal(res.status, 200, `body: ${res.body}`);
    assert.equal(existsSync(join(PROJECT, 'fresh.txt')), false);
  });

  it('restores file deleted from working tree (existsSync false branch)', async () => {
    writeFileSync(join(PROJECT, 'b.txt'), 'b body\n');
    execSync('git add b.txt && git commit -m "add b"', { cwd: PROJECT, stdio: 'pipe' });
    unlinkSync(join(PROJECT, 'b.txt'));
    assert.equal(existsSync(join(PROJECT, 'b.txt')), false);

    const res = await httpJson(port, '/api/git-restore', 'POST', { path: 'b.txt' });
    assert.equal(res.status, 200, `body: ${res.body}`);
    assert.equal(readFileSync(join(PROJECT, 'b.txt'), 'utf-8'), 'b body\n');
  });

  it('restores file inside a subdirectory (path-separator regression for #84)', async () => {
    mkdirSync(join(PROJECT, 'sub', 'nested'), { recursive: true });
    const rel = ['sub', 'nested', 'deep.txt'].join('/');
    writeFileSync(join(PROJECT, 'sub', 'nested', 'deep.txt'), 'deep original\n');
    execSync(`git add ${rel} && git commit -m "add deep"`, { cwd: PROJECT, stdio: 'pipe' });
    writeFileSync(join(PROJECT, 'sub', 'nested', 'deep.txt'), 'deep tampered\n');

    const res = await httpJson(port, '/api/git-restore', 'POST', { path: rel });
    assert.equal(res.status, 200, `body: ${res.body}`);
    assert.equal(readFileSync(join(PROJECT, 'sub', 'nested', 'deep.txt'), 'utf-8'), 'deep original\n');
  });

  it('rejects ../ path traversal', async () => {
    const res = await httpJson(port, '/api/git-restore', 'POST', { path: '../escape' });
    assert.equal(res.status, 400);
  });

  it('rejects absolute path', async () => {
    const res = await httpJson(port, '/api/git-restore', 'POST', { path: '/etc/passwd' });
    assert.equal(res.status, 400);
  });

  it('rejects missing path', async () => {
    const res = await httpJson(port, '/api/git-restore', 'POST', {});
    assert.equal(res.status, 400);
  });

  it('rejects invalid JSON body', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port, path: '/api/git-restore', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    assert.equal(res.status, 400);
  });
});

describe('isPathContained() — cross-platform separator', () => {
  // 独立 fixture：上面 describe 的 after() 会 rm TMP，跨 describe 共用同一 PROJECT
  // 在 isPathContained() 这里就会 ENOENT；用独立 tmpdir 隔开两边生命周期。
  let ROOT;
  before(() => {
    ROOT = mkdtempSync(join(tmpdir(), 'ccv-isPathContained-'));
  });
  after(() => {
    try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
  });

  it('returns true when target equals root', () => {
    assert.equal(isPathContained(ROOT, ROOT), true);
  });

  it('returns true for files inside the root (native separator)', () => {
    writeFileSync(join(ROOT, 'inside.txt'), '');
    assert.equal(isPathContained(join(ROOT, 'inside.txt'), ROOT), true);
  });

  it('returns true for nested directories', () => {
    mkdirSync(join(ROOT, 'inside', 'nest'), { recursive: true });
    assert.equal(isPathContained(join(ROOT, 'inside', 'nest'), ROOT), true);
  });

  it('returns false for path outside root', () => {
    assert.equal(isPathContained(tmpdir(), ROOT), false);
  });

  it('does not get fooled by prefix match (ROOT vs ROOT_extra)', () => {
    // 如果 startsWith 没用 sep 兜底，"/tmp/foo" 可能被误判为含在 "/tmp/foo_extra"。
    const sibling = ROOT + '_extra';
    mkdirSync(sibling, { recursive: true });
    try {
      assert.equal(isPathContained(sibling, ROOT), false);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('uses path.sep — confirms the imported separator matches platform', () => {
    // 不是行为测试而是文档化断言：sep 在 POSIX 上是 '/'，Windows 上是 '\\'。
    // 若未来某次回归把硬编码 '/' 重新引入，前面的 prefix-match 测试会落网。
    assert.ok(sep === '/' || sep === '\\');
  });
});
