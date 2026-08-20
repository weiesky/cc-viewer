/**
 * server/routes/files-content.js —— 分支补强测试（针对 catch / 错误映射分支）。
 *
 * 已有 test/api-files-content.test.js 覆盖全部 6 个 handler 的正常路径与
 * 校验/policy 分支；本文件专门补上各 handler 的 catch 块（防御性错误处理）：
 *   - planFile      catch (63-65)   —— try 内 searchParams.get 抛错
 *   - fileContentGet catch (116-120) —— policy 通过后 readFileSync EACCES（chmod 000）
 *   - projectMemory catch (178-183) —— try 内 searchParams.get 抛错
 *   - claudeMd      catch (232-235) —— try 内 searchParams.get 抛错
 *   - fileRaw       catch (315-319) —— policy 通过后 readFileSync EACCES（chmod 000）
 *
 * 隔离：在【import 目标模块前】mkdtempSync 建私有沙箱并设
 *   CCV_PROJECT_DIR / CLAUDE_CONFIG_DIR / CCV_LOG_DIR（STARTUP_CWD / allowlist root
 *   在模块加载时锁定，env 必须先于动态 import 设好），after() rmSync 清理。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 私有沙箱（必须在动态 import 目标模块之前注入 env）────────────────────────
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-branch-fc-')));
const PROJECT = join(TMP, 'project');
const FAKE_CLAUDE = join(TMP, 'claude');
mkdirSync(PROJECT, { recursive: true });
mkdirSync(FAKE_CLAUDE, { recursive: true });

process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE;
process.env.CCV_LOG_DIR = join(TMP, 'logs');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

/** 同步 res：收集 status / headers / body。 */
function makeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || null; },
    end(b) { this.body = b == null ? '' : (Buffer.isBuffer(b) ? b : String(b)); },
  };
}

/** searchParams.get 一调用即抛错 —— 触发 handler try 块内的 get 失败。 */
function throwingSearchParams() {
  return { get() { throw new Error('boom-search'); } };
}

let planFile, fileContentGet, projectMemory, claudeMd, fileRaw;

before(async () => {
  const mod = await import('../server/routes/files-content.js');
  const routes = mod.filesContentRoutes;
  const byPath = (p, m) => routes.find(r => r.path === p && r.method === m)?.handler;
  planFile = byPath('/api/plan-file', 'GET');
  fileContentGet = byPath('/api/file-content', 'GET');
  projectMemory = byPath('/api/project-memory', 'GET');
  claudeMd = byPath('/api/claude-md', 'GET');
  fileRaw = routes.find(r => r.predicate)?.handler;
  assert.ok(planFile && fileContentGet && projectMemory && claudeMd && fileRaw,
    '五个目标 handler 全部解析到');
});

after(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────────────────────────────────────────────────────────
describe('catch 防御分支 —— try 块内 searchParams.get 抛错', { concurrency: false }, () => {
  it('planFile catch → 500 + String(e.message)（行 63-65）', () => {
    const res = makeRes();
    planFile({ method: 'GET' }, res, { pathname: '/api/plan-file', searchParams: throwingSearchParams() });
    assert.equal(res.statusCode, 500);
    const j = JSON.parse(res.body);
    assert.equal(j.ok, false);
    assert.equal(j.error, 'boom-search');
  });

  it('projectMemory catch → 500 Internal error（行 178-183，500 不回显细节）', () => {
    const res = makeRes();
    projectMemory({ method: 'GET' }, res, { pathname: '/api/project-memory', searchParams: throwingSearchParams() });
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'Internal error');
  });

  it('claudeMd catch → 500 Internal error（行 232-235）', () => {
    const res = makeRes();
    claudeMd({ method: 'GET' }, res, { pathname: '/api/claude-md', searchParams: throwingSearchParams() });
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).error, 'Internal error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('catch 防御分支 —— policy 通过后读文件失败（EACCES）', { concurrency: false }, () => {
  // 以 uid != 0 运行；root 会无视权限位，此时跳过。
  const canTestEacces = !(process.getuid && process.getuid() === 0);

  it('fileContentGet：chmod 000 文件 readFileSync EACCES → 500 Cannot read file（行 116-120）', (t) => {
    if (!canTestEacces) return t.skip('root 无视权限位，跳过 EACCES 用例');
    const f = join(PROJECT, 'noread-fc.txt');
    writeFileSync(f, 'secret');
    chmodSync(f, 0o000);
    try {
      const res = makeRes();
      fileContentGet(
        { method: 'GET' },
        res,
        { pathname: '/api/file-content', searchParams: new URLSearchParams('path=' + encodeURIComponent(f)) },
      );
      // statSync 成功（isFile + size ok），readFileSync 抛 EACCES；
      // EACCES 不在 ERROR_STATUS_MAP → status 500 → 'Cannot read file: ...'
      assert.equal(res.statusCode, 500);
      assert.match(JSON.parse(res.body).error, /Cannot read file:/);
    } finally {
      try { chmodSync(f, 0o644); } catch {}
    }
  });

  it('fileRaw：chmod 000 文件 readFileSync EACCES → 500 Cannot read file（行 315-319）', (t) => {
    if (!canTestEacces) return t.skip('root 无视权限位，跳过 EACCES 用例');
    const f = join(PROJECT, 'noread-raw.png');
    writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    chmodSync(f, 0o000);
    try {
      const res = makeRes();
      fileRaw(
        { method: 'GET' },
        res,
        { pathname: '/api/file-raw', searchParams: new URLSearchParams('path=' + encodeURIComponent(f)) },
      );
      assert.equal(res.statusCode, 500);
      assert.match(JSON.parse(res.body).error, /Cannot read file:/);
    } finally {
      try { chmodSync(f, 0o644); } catch {}
    }
  });
});
