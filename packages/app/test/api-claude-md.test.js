/**
 * /api/claude-md endpoint tests
 *
 * 覆盖：
 *   - 列表 (无 ?id) 返回 entries 数组，元素含 {id, scope, tail, mtimeMs}，无 realPath 泄漏
 *   - 项目 CLAUDE.md + 全局 CLAUDE.md 都存在时两者都出现，project 在前 global 在后
 *   - ?id=<malformed> 返回 400
 *   - ?id=<valid hex 但不在候选> 返回 404
 *   - ?id=<valid> 返回 content
 *   - 文件超 512KB → 413
 *
 * 隔离：mktemp 创建假 CLAUDE_CONFIG_DIR + 假 CCV_PROJECT_DIR；env 必须在 server.js 首次 import
 *       之前设好（file-access-policy 顶层 STARTUP_CWD 锁定后无法刷新）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = mkdtempSync(join(tmpdir(), 'ccv-claude-md-api-'));
const FAKE_CLAUDE = join(TMP, 'claude');
const PROJECT = join(TMP, 'project');

mkdirSync(PROJECT, { recursive: true });
mkdirSync(FAKE_CLAUDE, { recursive: true });
// .git 终止父链 walk，避免上溯到真实 $HOME 命中宿主 CLAUDE.md
mkdirSync(join(PROJECT, '.git'));

process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE;
process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function httpRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/claude-md', { concurrency: false }, () => {
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

  it('returns empty entries when no CLAUDE.md anywhere', async () => {
    const res = await httpRequest(port, '/api/claude-md');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.deepEqual(data.entries, []);
  });

  it('returns project entry when project/CLAUDE.md exists', async () => {
    writeFileSync(join(PROJECT, 'CLAUDE.md'), '# project rules\n');
    const res = await httpRequest(port, '/api/claude-md');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].scope, 'project');
    assert.equal(data.entries[0].tail, 'CLAUDE.md');
    assert.match(data.entries[0].id, /^[0-9a-f]{12}$/);
    // 不应泄漏 realPath
    assert.equal(data.entries[0].realPath, undefined);
  });

  it('returns project + global entries; project first', async () => {
    writeFileSync(join(FAKE_CLAUDE, 'CLAUDE.md'), '# global rules\n');
    const res = await httpRequest(port, '/api/claude-md');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.entries.length, 2);
    assert.equal(data.entries[0].scope, 'project');
    assert.equal(data.entries[1].scope, 'global');
  });

  it('rejects malformed id with 400', async () => {
    const res = await httpRequest(port, '/api/claude-md?id=not-hex');
    assert.equal(res.status, 400);
  });

  it('returns 404 for valid-format but unknown id', async () => {
    const res = await httpRequest(port, '/api/claude-md?id=' + 'a'.repeat(12));
    assert.equal(res.status, 404);
  });

  it('returns content for valid id', async () => {
    const list = await httpRequest(port, '/api/claude-md');
    const project = list.json().entries.find(e => e.scope === 'project');
    assert.ok(project);
    const res = await httpRequest(port, '/api/claude-md?id=' + encodeURIComponent(project.id));
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.scope, 'project');
    assert.equal(data.tail, 'CLAUDE.md');
    assert.equal(data.content, '# project rules\n');
  });

  it('returns 413 when file exceeds 512KB cap', async () => {
    writeFileSync(join(PROJECT, 'CLAUDE.md'), 'x'.repeat(600 * 1024));
    const list = await httpRequest(port, '/api/claude-md');
    const project = list.json().entries.find(e => e.scope === 'project');
    assert.ok(project);
    const res = await httpRequest(port, '/api/claude-md?id=' + encodeURIComponent(project.id));
    assert.equal(res.status, 413);
    // 复原
    writeFileSync(join(PROJECT, 'CLAUDE.md'), '# project rules\n');
  });

  it('rejects symlink whose realpath basename != CLAUDE.md (defense-in-depth)', async () => {
    // 攻击场景：在项目内放一个名叫 CLAUDE.md 的 symlink → 指向 outside.md
    // 离散基点 PROJECT/CLAUDE.md 已先被前序用例写入，先备份再换 symlink。
    // discoverClaudeMdCandidates.pushIfFile 的 basename(real) 校验应让该入口不进候选清单 → 不会出现在 list 里。
    const outside = join(TMP, 'outside-secret.md');
    writeFileSync(outside, '# secret');
    const claudeMdPath = join(PROJECT, 'CLAUDE.md');
    const backup = join(TMP, 'CLAUDE.md.bak');
    // 备份 → 删 → 替换为 symlink
    writeFileSync(backup, '# project rules\n');
    try { unlinkSync(claudeMdPath); } catch {}
    symlinkSync(outside, claudeMdPath);

    const list = await httpRequest(port, '/api/claude-md');
    assert.equal(list.status, 200);
    const data = list.json();
    // 项目候选不应包含这个 basename-mismatched symlink；最多剩全局候选（如已写入）
    assert.equal(data.entries.filter(e => e.scope === 'project').length, 0);

    // 复原
    try { unlinkSync(claudeMdPath); } catch {}
    writeFileSync(claudeMdPath, '# project rules\n');
    try { unlinkSync(outside); } catch {}
    try { unlinkSync(backup); } catch {}
  });
});
