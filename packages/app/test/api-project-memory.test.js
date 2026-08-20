/**
 * /api/project-memory endpoint tests
 *
 * 覆盖：
 *   - 路径编码：cwd.replace(/[^a-zA-Z0-9-]/g, '-') 与 ~/.claude/projects/ 实际目录格式一致
 *   - 入口 MEMORY.md 不存在 → exists:false
 *   - 入口存在 → exists:true + content
 *   - ?file=<basename>.md → 返回明细文件
 *   - ?file= 含 / 或 .. 或非 .md → 400
 *   - ?file= 不存在 → 404
 *
 * 隔离策略：mktemp 创建假 CLAUDE_CONFIG_DIR + 假 CCV_PROJECT_DIR，env 注入到 server。
 * 注意：必须在 server.js import 之前设置 env，否则 file-access-policy 顶部 STARTUP_CWD 锁定后无法刷新。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 沙箱：CLAUDE_CONFIG_DIR=<tmp>/claude，CCV_PROJECT_DIR=<tmp>/project
const TMP = mkdtempSync(join(tmpdir(), 'ccv-memory-test-'));
const FAKE_CLAUDE = join(TMP, 'claude');
const PROJECT = join(TMP, 'project');

// 编码与服务端实现保持完全一致：cwd.replace(/[/\\]+$/,'').replace(/[^a-zA-Z0-9-]/g,'-')
const encodedCwd = PROJECT.replace(/[/\\]+$/, '').replace(/[^a-zA-Z0-9-]/g, '-');
const MEMORY_DIR = join(FAKE_CLAUDE, 'projects', encodedCwd, 'memory');

mkdirSync(PROJECT, { recursive: true });
mkdirSync(MEMORY_DIR, { recursive: true });

process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE;
process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '17920';
process.env.CCV_MAX_PORT = '17929';

function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('GET /api/project-memory', { concurrency: false }, () => {
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

  it('returns exists:false when MEMORY.md is missing', async () => {
    const res = await httpRequest(port, '/api/project-memory');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.exists, false);
    // 严格断言整链路径 —— 把"编码 + 拼接"锁死，避免后续重构/编码变更悄无声息地破坏契约。
    assert.equal(data.dir, MEMORY_DIR);
    assert.equal(data.indexPath, join(MEMORY_DIR, 'MEMORY.md'));
  });

  it('returns exists:true with content when MEMORY.md exists', async () => {
    const indexContent = '# Test Memory\n\n- [Detail](feedback_test.md) — sample';
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), indexContent);
    const res = await httpRequest(port, '/api/project-memory');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.exists, true);
    assert.equal(data.content, indexContent);
  });

  it('returns detail file content for valid ?file=<basename>.md', async () => {
    const detailContent = '# Detail\n\nbody text';
    writeFileSync(join(MEMORY_DIR, 'feedback_test.md'), detailContent);
    const res = await httpRequest(port, '/api/project-memory?file=feedback_test.md');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.name, 'feedback_test.md');
    assert.equal(data.content, detailContent);
  });

  it('rejects ?file= with path separator', async () => {
    const res = await httpRequest(port, '/api/project-memory?file=' + encodeURIComponent('../etc/passwd.md'));
    assert.equal(res.status, 400);
  });

  it('rejects ?file= with backslash', async () => {
    const res = await httpRequest(port, '/api/project-memory?file=' + encodeURIComponent('foo\\bar.md'));
    assert.equal(res.status, 400);
  });

  it('rejects ?file= without .md extension', async () => {
    writeFileSync(join(MEMORY_DIR, 'plain.txt'), 'x');
    const res = await httpRequest(port, '/api/project-memory?file=plain.txt');
    assert.equal(res.status, 400);
  });

  it('rejects ?file= starting with dot (hidden / parent ref)', async () => {
    const res = await httpRequest(port, '/api/project-memory?file=' + encodeURIComponent('.hidden.md'));
    assert.equal(res.status, 400);
  });

  it('returns 404 for non-existent ?file=', async () => {
    const res = await httpRequest(port, '/api/project-memory?file=nope.md');
    assert.equal(res.status, 404);
  });

  it('rejects ?file= containing NUL byte (URL-encoded as %00)', async () => {
    const res = await httpRequest(port, '/api/project-memory?file=' + encodeURIComponent('foo\x00.md'));
    assert.equal(res.status, 400);
  });

  it('treats empty ?file= as the index path (returns entry, not 400)', async () => {
    // 空字符串 ?file= 时 searchParams.get('file') 返回 ''（falsy），走入口分支
    // 此前 step 已写过入口 MEMORY.md，应当返回 exists:true
    const res = await httpRequest(port, '/api/project-memory?file=');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.exists, true);
    assert.equal(typeof data.content, 'string');
  });

  it('rejects symlink that escapes memoryDir → 403', async () => {
    // 在 memoryDir 内放一个 symlink → memoryDir 之外的 .md 文件，
    // basename 校验过得了，realpath 收紧应当拦下来（server.js 的 startsWith(realDir+'/')）
    const outside = join(TMP, 'outside-secret.md');
    writeFileSync(outside, '# secret');
    const linkPath = join(MEMORY_DIR, 'leak.md');
    try { unlinkSync(linkPath); } catch {}
    symlinkSync(outside, linkPath);
    const res = await httpRequest(port, '/api/project-memory?file=leak.md');
    assert.equal(res.status, 403);
    const data = res.json();
    // error 文案不强制内容，但务必非泄漏完整路径
    assert.ok(typeof data.error === 'string');
    try { unlinkSync(linkPath); } catch {}
  });

  it('returns 413 for index larger than 512KB limit', async () => {
    // MAX_BYTES = 512 * 1024；写 600KB 入口超出
    const big = 'x'.repeat(600 * 1024);
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), big);
    const res = await httpRequest(port, '/api/project-memory');
    assert.equal(res.status, 413);
    // 测后恢复成可被后续断言用的小 MEMORY.md（本测试块到这里已快结束，但稳妥起见复原）
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), '# Test Memory\n\n- [Detail](feedback_test.md) — sample');
  });

  it('returns 413 for detail file larger than 512KB limit', async () => {
    const big = 'y'.repeat(600 * 1024);
    writeFileSync(join(MEMORY_DIR, 'big.md'), big);
    const res = await httpRequest(port, '/api/project-memory?file=big.md');
    assert.equal(res.status, 413);
  });
});
