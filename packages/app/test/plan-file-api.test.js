/**
 * /api/plan-file 路径白名单与安全测试
 *
 * 内联 server.js 的核心校验逻辑（不依赖 HTTP server / 真实 fs），覆盖：
 *   - 缺 path → 400
 *   - 非 .md 扩展 → 400
 *   - 路径在 plansDir 之外 → 403
 *   - 文件不存在 → 404
 *   - 体积超限 → 413
 *   - 合法 .md → 200 + content
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, statSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';

// 内联：server.js /api/plan-file 端点的同步校验逻辑
function checkPlanFile(rawPath, plansDir) {
  if (!rawPath) return { status: 400, error: 'missing path' };
  if (rawPath.indexOf('\x00') !== -1) return { status: 400, error: 'invalid path (null byte)' };
  const isWin = platform() === 'win32';
  const norm = (p) => isWin ? p.toLowerCase() : p;
  if (!rawPath.toLowerCase().endsWith('.md')) {
    return { status: 400, error: 'invalid extension' };
  }
  const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(rawPath);
  if (!isAbs) {
    return { status: 400, error: 'absolute path required' };
  }
  const resolved = resolve(rawPath);
  const plansDirSep = plansDir.endsWith('/') || plansDir.endsWith('\\') ? plansDir : plansDir + (isWin ? '\\' : '/');
  if (!norm(resolved).startsWith(norm(plansDirSep))) {
    return { status: 403, error: 'forbidden' };
  }
  if (!existsSync(resolved)) {
    return { status: 404, error: 'not found' };
  }
  let realResolved, realPlansDir;
  try {
    realResolved = realpathSync(resolved);
    realPlansDir = realpathSync(plansDir);
  } catch {
    return { status: 404, error: 'realpath failed' };
  }
  const realPlansDirSep = realPlansDir.endsWith('/') || realPlansDir.endsWith('\\')
    ? realPlansDir : realPlansDir + (isWin ? '\\' : '/');
  if (!norm(realResolved).startsWith(norm(realPlansDirSep))) {
    return { status: 403, error: 'forbidden (symlink)' };
  }
  const st = statSync(realResolved);
  if (!st.isFile()) return { status: 404, error: 'not a file' };
  if (st.size > 2 * 1024 * 1024) return { status: 413, error: 'too large' };
  return { status: 200, content: readFileSync(realResolved, 'utf-8') };
}

const TMP = join(tmpdir(), `ccv-plan-file-test-${Date.now()}`);
const PLANS = join(TMP, '.claude', 'plans');

describe('/api/plan-file 路径校验', () => {
  beforeEach(() => {
    mkdirSync(PLANS, { recursive: true });
    writeFileSync(join(PLANS, 'foo.md'), '# Hello\n\nbody');
  });
  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it('缺 path → 400', () => {
    const r = checkPlanFile('', PLANS);
    assert.equal(r.status, 400);
  });

  it('非 .md 扩展 → 400', () => {
    const r = checkPlanFile(join(PLANS, 'evil.txt'), PLANS);
    assert.equal(r.status, 400);
  });

  it('相对路径 → 400 (要求绝对路径)', () => {
    const r = checkPlanFile('plans/foo.md', PLANS);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'absolute path required');
  });

  it('null-byte 注入 → 400', () => {
    const r = checkPlanFile(join(PLANS, 'foo\x00.md'), PLANS);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'invalid path (null byte)');
  });

  it('路径越界（../etc/passwd）→ 403', () => {
    const r = checkPlanFile('/etc/passwd.md', PLANS);
    assert.equal(r.status, 403);
  });

  it('合法 .md → 200 + content', () => {
    const r = checkPlanFile(join(PLANS, 'foo.md'), PLANS);
    assert.equal(r.status, 200);
    assert.equal(r.content, '# Hello\n\nbody');
  });

  it('文件不存在 → 404', () => {
    const r = checkPlanFile(join(PLANS, 'missing.md'), PLANS);
    assert.equal(r.status, 404);
  });

  it('符号链接逃逸 → 403（POSIX 平台）', () => {
    if (platform() === 'win32') return; // Windows 符号链接需特权，跳过
    // 在 plansDir 内放符号链接指向外部敏感文件
    const evilLink = join(PLANS, 'evil.md');
    const target = '/etc/hosts'; // 任何存在的外部文件
    if (!existsSync(target)) return;
    try {
      symlinkSync(target, evilLink);
    } catch {
      return; // 权限问题跳过
    }
    const r = checkPlanFile(evilLink, PLANS);
    assert.equal(r.status, 403);
  });

  it('体积超限（>2MB）→ 413', () => {
    const big = join(PLANS, 'big.md');
    writeFileSync(big, 'x'.repeat(3 * 1024 * 1024)); // 3MB
    const r = checkPlanFile(big, PLANS);
    assert.equal(r.status, 413);
  });
});
