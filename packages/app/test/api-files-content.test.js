/**
 * server/routes/files-content.js (filesContentRoutes) endpoint tests.
 *
 * 覆盖目标 —— 6 个路由 handler 的读取/编码/范围/保存/越权/错误分支：
 *   GET  /api/plan-file      planFile        —— .md 限定 + size cap + policy 闸
 *   GET  /api/file-content   fileContentGet  —— 相对/绝对路径 + ".." 拒绝 + size cap
 *   GET  /api/project-memory projectMemory   —— 入口 MEMORY.md + 明细 ?file= + symlink 收紧
 *   GET  /api/claude-md      claudeMd        —— 候选列表 + ?id= 读取
 *   GET|HEAD /api/file-raw   fileRaw         —— 二进制/mime/HEAD/CSP/size cap + fallback
 *   POST /api/file-content   fileContentPost —— 写覆盖/新建/超体积/非字符串 content
 *
 * 隔离策略（与 api-preferences.test.js / api-project-memory.test.js 同款）：
 *   - 在【任何 import 目标模块之前】mkdtempSync 建临时目录并设
 *     CCV_PROJECT_DIR / CLAUDE_CONFIG_DIR / CCV_LOG_DIR，使临时目录成为
 *     file-access-policy allowlist 的项目 root（STARTUP_CWD 在模块加载时锁定，
 *     故 env 必须先设好），after() 里 rmSync 清理。
 *   - handler 签名为 (req, res, parsedUrl)：GET 用 plain res 收包；
 *     POST 用 EventEmitter req（emit data/end）模拟流式 body。
 *
 * 注意：这些 handler 不接收 isLocal/deps —— 越权防护靠 path allowlist + ".." 拒绝，
 * 不是 isLocal 门禁，故"越权"用例 = 路径穿越 / outside-allowlist。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync,
  symlinkSync, unlinkSync, existsSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 沙箱目录：必须在 import 目标模块前建好并注入 env ──────────────────────────
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-files-content-test-')));
const PROJECT = join(TMP, 'project');
const FAKE_CLAUDE = join(TMP, 'claude');
mkdirSync(PROJECT, { recursive: true });
mkdirSync(FAKE_CLAUDE, { recursive: true });

process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE;
process.env.CCV_LOG_DIR = join(TMP, 'logs');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// project-memory 端点的目录编码（与 server 实现完全一致）
const encodedCwd = PROJECT.replace(/[/\\]+$/, '').replace(/[^a-zA-Z0-9-]/g, '-');
const MEMORY_DIR = join(FAKE_CLAUDE, 'projects', encodedCwd, 'memory');
mkdirSync(MEMORY_DIR, { recursive: true });

/** 构造一个同步 res，收集 status / headers / body 文本。 */
function makeRes() {
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || null; },
    end(b) { this.body = b == null ? '' : Buffer.isBuffer(b) ? b : String(b); },
  };
  return res;
}

/** 同步调用 GET handler，返回 { status, headers, body, json() }。 */
function callGet(handler, pathname, search = '', method = 'GET') {
  const res = makeRes();
  const parsedUrl = {
    pathname,
    searchParams: new URLSearchParams(search),
  };
  const req = { method };
  handler(req, res, parsedUrl);
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    json() { return JSON.parse(res.body.toString()); },
  };
}

/** 调用 POST handler（req 为流式 EventEmitter），resolve { status, json }。 */
function callPost(handler, body, { chunked = false } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.destroy = () => { req.emit('end'); }; // 模拟 overflow 时的 destroy → end
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code; },
      end(b) {
        resolve({ status: this.statusCode, json: JSON.parse(b == null ? '{}' : String(b)) });
      },
    };
    handler(req, res);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (chunked) {
      // 拆成两块发送，触发 data 多次累积
      const mid = Math.floor(payload.length / 2);
      req.emit('data', payload.slice(0, mid));
      req.emit('data', payload.slice(mid));
    } else {
      req.emit('data', payload);
    }
    req.emit('end');
  });
}

let routes;
let planFile, fileContentGet, projectMemory, claudeMd, fileRaw, fileContentPost;

before(async () => {
  const mod = await import('../server/routes/files-content.js');
  routes = mod.filesContentRoutes;
  assert.ok(Array.isArray(routes) && routes.length === 6, 'expect 6 routes');
  const byPath = (p, m) => routes.find(r => r.path === p && r.method === m)?.handler;
  planFile = byPath('/api/plan-file', 'GET');
  fileContentGet = byPath('/api/file-content', 'GET');
  projectMemory = byPath('/api/project-memory', 'GET');
  claudeMd = byPath('/api/claude-md', 'GET');
  fileContentPost = byPath('/api/file-content', 'POST');
  // file-raw 用 predicate，没有 path 字段
  fileRaw = routes.find(r => r.predicate)?.handler;
  assert.ok(planFile && fileContentGet && projectMemory && claudeMd && fileContentPost && fileRaw,
    'all six handlers resolved');
});

after(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/plan-file', { concurrency: false }, () => {
  it('缺 path → 400 missing path', () => {
    const r = callGet(planFile, '/api/plan-file');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'missing path');
  });

  it('null-byte 注入 → 400', () => {
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent('/foo\x00bar.md'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'invalid path (null byte)');
  });

  it('非 .md 扩展 → 400 invalid extension', () => {
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(join(PROJECT, 'a.txt')));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'invalid extension');
  });

  it('相对路径 → 400 absolute path required', () => {
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent('plans/foo.md'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'absolute path required');
  });

  it('outside-allowlist 存在文件 → 403 forbidden', () => {
    // 真实存在但落在 allowlist root（PROJECT）之外的 .md：直接放 TMP 根下
    const outside = join(TMP, 'outside-plan.md');
    writeFileSync(outside, '# outside');
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(outside));
    assert.equal(r.status, 403);
    const j = r.json();
    assert.equal(j.error, 'forbidden');
    assert.equal(j.ok, false);
    assert.equal(j.reason, 'outside-allowlist');
  });

  it('不存在的越权路径（realpath-failed）→ 404 not found', () => {
    // plan-file 把 realpath-failed 归 404/'not found'，其余 policy 失败归 403/'forbidden'
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent('/etc/passwd.md'));
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'not found');
  });

  it('不存在的 .md（realpath-failed）→ 404 not found', () => {
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(join(PROJECT, 'missing.md')));
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'not found');
  });

  it('合法 .md → 200 + content', () => {
    const p = join(PROJECT, 'plan.md');
    writeFileSync(p, '# Plan\n\nbody');
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.content, '# Plan\n\nbody');
  });

  it('目录而非文件 → 404 not a file', () => {
    const d = join(PROJECT, 'subdir');
    mkdirSync(d, { recursive: true });
    // 必须 .md 结尾才进 statSync 分支：建一个以 .md 命名的目录
    const dirMd = join(PROJECT, 'dir.md');
    mkdirSync(dirMd, { recursive: true });
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(dirMd));
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'not a file');
  });

  it('超 2MB → 413 too large', () => {
    const big = join(PROJECT, 'big.md');
    writeFileSync(big, 'x'.repeat(2 * 1024 * 1024 + 16));
    const r = callGet(planFile, '/api/plan-file', 'path=' + encodeURIComponent(big));
    assert.equal(r.status, 413);
    assert.equal(r.json().error, 'too large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/file-content', { concurrency: false }, () => {
  it('缺 path → 400 Invalid path', () => {
    const r = callGet(fileContentGet, '/api/file-content');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid path');
  });

  it('相对路径含 .. → 400 Invalid path（明确攻击拒绝）', () => {
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent('../secret.txt'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid path');
  });

  it('相对路径在项目目录内 → 200 + 原样 path 回返', () => {
    writeFileSync(join(PROJECT, 'rel.txt'), 'relative-body');
    const r = callGet(fileContentGet, '/api/file-content', 'path=rel.txt');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.path, 'rel.txt', 'path 字段回返原始入参');
    assert.equal(j.content, 'relative-body');
    assert.equal(j.size, 'relative-body'.length);
  });

  it('绝对路径在项目内 → 200', () => {
    const p = join(PROJECT, 'abs.txt');
    writeFileSync(p, 'abs-body');
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    assert.equal(r.json().content, 'abs-body');
  });

  it('绝对路径 outside-allowlist（真实存在）→ 403 Forbidden + allowedRoots', () => {
    const outside = join(TMP, 'outside-fc.txt');
    writeFileSync(outside, 'outside-data');
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent(outside));
    assert.equal(r.status, 403);
    const j = r.json();
    assert.equal(j.error, 'Forbidden');
    assert.equal(j.reason, 'outside-allowlist');
    assert.ok(Array.isArray(j.allowedRoots), 'outside-allowlist 带 allowedRoots 诊断');
  });

  it('绝对路径不存在 → 404 File not found（realpath-failed）', () => {
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent(join(PROJECT, 'ghost.txt')));
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'File not found');
  });

  it('目标是目录 → 400 Not a file', () => {
    const d = join(PROJECT, 'adir');
    mkdirSync(d, { recursive: true });
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent(d));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Not a file');
  });

  it('超 5MB → 413 File too large', () => {
    const big = join(PROJECT, 'big-fc.bin');
    writeFileSync(big, 'y'.repeat(5 * 1024 * 1024 + 8));
    const r = callGet(fileContentGet, '/api/file-content', 'path=' + encodeURIComponent(big));
    assert.equal(r.status, 413);
    assert.equal(r.json().error, 'File too large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/project-memory', { concurrency: false }, () => {
  it('入口 MEMORY.md 不存在 → 200 exists:false + dir/indexPath', () => {
    // 确保不存在
    try { unlinkSync(join(MEMORY_DIR, 'MEMORY.md')); } catch {}
    const r = callGet(projectMemory, '/api/project-memory');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.exists, false);
    assert.equal(j.dir, MEMORY_DIR);
    assert.equal(j.indexPath, join(MEMORY_DIR, 'MEMORY.md'));
  });

  it('入口存在 → 200 exists:true + content', () => {
    const content = '# Memory index\n\n- item';
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), content);
    const r = callGet(projectMemory, '/api/project-memory');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.exists, true);
    assert.equal(j.content, content);
  });

  it('?file=<basename>.md → 200 明细内容', () => {
    const content = '# Detail\n\ndetail-body';
    writeFileSync(join(MEMORY_DIR, 'feedback_x.md'), content);
    const r = callGet(projectMemory, '/api/project-memory', 'file=feedback_x.md');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.name, 'feedback_x.md');
    assert.equal(j.content, content);
    assert.equal(j.path, realpathSync(join(MEMORY_DIR, 'feedback_x.md')));
  });

  it('?file= 含路径分隔符 → 400 Invalid file name', () => {
    const r = callGet(projectMemory, '/api/project-memory', 'file=' + encodeURIComponent('../etc/passwd.md'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid file name');
  });

  it('?file= 含反斜杠 → 400', () => {
    const r = callGet(projectMemory, '/api/project-memory', 'file=' + encodeURIComponent('foo\\bar.md'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid file name');
  });

  it('?file= 以点开头 → 400', () => {
    const r = callGet(projectMemory, '/api/project-memory', 'file=' + encodeURIComponent('.hidden.md'));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid file name');
  });

  it('?file= 非 .md → 400 Only .md files allowed', () => {
    writeFileSync(join(MEMORY_DIR, 'plain.txt'), 'x');
    const r = callGet(projectMemory, '/api/project-memory', 'file=plain.txt');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Only .md files allowed');
  });

  it('?file= 不存在 → 404 File not found', () => {
    const r = callGet(projectMemory, '/api/project-memory', 'file=nope.md');
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'File not found');
  });

  it('symlink 逃出 memoryDir → 403 Path traversal not allowed', () => {
    const outside = join(TMP, 'mem-outside.md');
    writeFileSync(outside, '# leaked');
    const link = join(MEMORY_DIR, 'leak.md');
    try { unlinkSync(link); } catch {}
    let linked = true;
    try { symlinkSync(outside, link); } catch { linked = false; }
    if (!linked) return; // 无权限创建 symlink → 跳过
    const r = callGet(projectMemory, '/api/project-memory', 'file=leak.md');
    assert.equal(r.status, 403);
    assert.equal(r.json().error, 'Path traversal not allowed');
    try { unlinkSync(link); } catch {}
  });

  it('入口超 512KB → 413 File too large', () => {
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), 'z'.repeat(512 * 1024 + 16));
    const r = callGet(projectMemory, '/api/project-memory');
    assert.equal(r.status, 413);
    assert.equal(r.json().error, 'File too large');
    // 复原小入口，避免污染后续
    writeFileSync(join(MEMORY_DIR, 'MEMORY.md'), '# small');
  });

  it('明细超 512KB → 413', () => {
    writeFileSync(join(MEMORY_DIR, 'big-detail.md'), 'q'.repeat(512 * 1024 + 16));
    const r = callGet(projectMemory, '/api/project-memory', 'file=big-detail.md');
    assert.equal(r.status, 413);
    assert.equal(r.json().error, 'File too large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/claude-md', { concurrency: false }, () => {
  it('无 id → 200 entries 列表（含项目 CLAUDE.md）', () => {
    writeFileSync(join(PROJECT, 'CLAUDE.md'), '# project rules');
    const r = callGet(claudeMd, '/api/claude-md');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.ok(Array.isArray(j.entries), 'entries 是数组');
    // 至少有项目自身这一条；每条只暴露 id/scope/tail（不泄漏 realPath/mtimeMs）
    assert.ok(j.entries.length >= 1);
    for (const e of j.entries) {
      assert.deepEqual(Object.keys(e).sort(), ['id', 'scope', 'tail']);
    }
    const proj = j.entries.find(e => e.tail === 'CLAUDE.md');
    assert.ok(proj, '项目根 CLAUDE.md 在列表中');
    assert.equal(proj.scope, 'project');
  });

  it('合法 id → 200 + content/scope/tail', () => {
    writeFileSync(join(PROJECT, 'CLAUDE.md'), '# claude-md content');
    const list = callGet(claudeMd, '/api/claude-md').json();
    const target = list.entries.find(e => e.tail === 'CLAUDE.md');
    assert.ok(target);
    const r = callGet(claudeMd, '/api/claude-md', 'id=' + target.id);
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.id, target.id);
    assert.equal(j.scope, 'project');
    assert.equal(j.content, '# claude-md content');
  });

  it('格式非法 id → 400 Invalid id（readCandidateById regex）', () => {
    const r = callGet(claudeMd, '/api/claude-md', 'id=not-a-valid-id');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid id');
  });

  it('格式合法但不存在的 id → 404 Candidate not found', () => {
    const r = callGet(claudeMd, '/api/claude-md', 'id=abcdef012345');
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'Candidate not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET|HEAD /api/file-raw', { concurrency: false }, () => {
  it('predicate 匹配 /api/file-raw 与子路径，仅 GET/HEAD', () => {
    const route = routes.find(r => r.predicate);
    assert.equal(route.predicate('/api/file-raw', 'GET'), true);
    assert.equal(route.predicate('/api/file-raw/foo.png', 'HEAD'), true);
    assert.equal(route.predicate('/api/file-raw', 'POST'), false);
    assert.equal(route.predicate('/api/other', 'GET'), false);
  });

  it('缺 path → 400 Invalid path', () => {
    const r = callGet(fileRaw, '/api/file-raw');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid path');
  });

  it('png 二进制 via ?path → 200 + image/png + Content-Length', () => {
    const p = join(PROJECT, 'pic.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    writeFileSync(p, bytes);
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], 'image/png');
    assert.equal(r.headers['Content-Length'], bytes.length);
    assert.ok(Buffer.isBuffer(r.body));
    assert.deepEqual(Buffer.from(r.body), bytes);
  });

  it('未知扩展名 → application/octet-stream', () => {
    const p = join(PROJECT, 'data.bin');
    writeFileSync(p, Buffer.from([9, 8, 7]));
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], 'application/octet-stream');
  });

  it('css/js → 正确 MIME 且无 CSP 头（HTML 预览同目录子资源：opaque origin 下 octet-stream 的 CSS 被浏览器严格 MIME 校验拒用）', () => {
    const cases = [
      ['report.css', 'body{color:red}', 'text/css'],
      ['sorter.js', 'void 0;', 'text/javascript'],
      ['mod.mjs', 'export {};', 'text/javascript'],
      ['data.json', '{}', 'application/json'],
      ['bundle.js.map', '{"version":3}', 'application/json'],
      ['readme.txt', 'plain', 'text/plain'],
      ['f.woff', 'wOFF', 'font/woff'],
      ['f.woff2', 'wOF2', 'font/woff2'],
      ['f.ttf', 'ttf0', 'font/ttf'],
    ];
    for (const [name, content, mime] of cases) {
      const p = join(PROJECT, name);
      writeFileSync(p, content);
      const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(p));
      assert.equal(r.status, 200, `${name} should be 200`);
      assert.equal(r.headers['Content-Type'], mime, `${name} mime`);
      assert.equal(r.headers['Content-Security-Policy'], undefined,
        `${name}: CSP 仅对 text/html 文档下发，非文档资源不带`);
    }
  });

  it('HTML → 带 CSP sandbox header', () => {
    const p = join(PROJECT, 'page.html');
    writeFileSync(p, '<h1>hi</h1>');
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], 'text/html');
    assert.equal(
      r.headers['Content-Security-Policy'],
      "sandbox allow-scripts; connect-src 'none'; form-action 'none'",
    );
  });

  it('HEAD → 不返回 body，Content-Length = stat.size', () => {
    const p = join(PROJECT, 'head.png');
    const bytes = Buffer.from('PNGDATA0123456789');
    writeFileSync(p, bytes);
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(p), 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Length'], bytes.length);
    // HEAD 时 data === null → res.end(null) → body 为空
    assert.equal(r.body, '');
  });

  it('path 走 URL 段 /api/file-raw/<encoded> 解码', () => {
    const p = join(PROJECT, 'seg.gif');
    writeFileSync(p, Buffer.from([0x47, 0x49, 0x46]));
    const r = callGet(fileRaw, '/api/file-raw/' + encodeURIComponent(p));
    assert.equal(r.status, 200);
    assert.equal(r.headers['Content-Type'], 'image/gif');
  });

  it('outside-allowlist（真实存在）→ 403 Forbidden', () => {
    const outside = join(TMP, 'outside-raw.png');
    writeFileSync(outside, Buffer.from([1, 2, 3, 4]));
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(outside));
    assert.equal(r.status, 403);
    assert.equal(r.json().error, 'Forbidden');
  });

  it('不存在的项目内文件 → 404 File not found', () => {
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(join(PROJECT, 'no-such.png')));
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'File not found');
  });

  it('目录而非文件 → 400 Not a file', () => {
    const d = join(PROJECT, 'rawdir');
    mkdirSync(d, { recursive: true });
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(d));
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Not a file');
  });

  it('超 10MB → 413 File too large', () => {
    const big = join(PROJECT, 'huge.bin');
    writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 16, 1));
    const r = callGet(fileRaw, '/api/file-raw', 'path=' + encodeURIComponent(big));
    assert.equal(r.status, 413);
    assert.equal(r.json().error, 'File too large');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/file-content', { concurrency: false }, () => {
  it('覆盖现有文件 → 200 ok + size', async () => {
    const p = join(PROJECT, 'write-target.txt');
    writeFileSync(p, 'old');
    const { status, json } = await callPost(fileContentPost, { path: p, content: 'new-content' });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.size, 'new-content'.length);
    assert.equal(readFileSync(p, 'utf-8'), 'new-content');
  });

  it('相对路径新建（含嵌套目录递归创建）→ 200 + 落盘', async () => {
    const rel = 'newdir/deeper/created.txt';
    const { status, json } = await callPost(fileContentPost, { path: rel, content: 'nested' });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const onDisk = join(PROJECT, rel);
    assert.ok(existsSync(onDisk));
    assert.equal(readFileSync(onDisk, 'utf-8'), 'nested');
  });

  it('分块 body（多次 data 事件）正确累积', async () => {
    const p = join(PROJECT, 'chunked.txt');
    const { status, json } = await callPost(
      fileContentPost,
      { path: p, content: 'AAAABBBB' },
      { chunked: true },
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(readFileSync(p, 'utf-8'), 'AAAABBBB');
  });

  it('缺 path → 400 Invalid path', async () => {
    const { status, json } = await callPost(fileContentPost, { content: 'x' });
    assert.equal(status, 400);
    assert.equal(json.error, 'Invalid path');
  });

  it('content 非字符串 → 400 Content must be a string', async () => {
    const p = join(PROJECT, 'whatever.txt');
    const { status, json } = await callPost(fileContentPost, { path: p, content: 123 });
    assert.equal(status, 400);
    assert.equal(json.error, 'Content must be a string');
  });

  it('损坏 JSON body → 500 Cannot save file（JSON.parse 抛错走 catch）', async () => {
    const { status, json } = await callPost(fileContentPost, '{not valid json');
    assert.equal(status, 500);
    assert.ok(/Cannot save file/.test(json.error));
  });

  it('outside-allowlist 绝对路径写 → 403 Forbidden', async () => {
    const { status, json } = await callPost(fileContentPost, { path: '/etc/evil.txt', content: 'hack' });
    assert.equal(status, 403);
    assert.equal(json.error, 'Forbidden');
  });

  it('覆盖已存在但 outside-allowlist 的文件 → 403（policy 非 realpath-failed 分支）', async () => {
    // 真实存在的越权文件：policy.ok=false 且 reason=outside-allowlist（非 realpath-failed）
    // → 命中 fileContentPost 末尾 else 分支（不走祖先上溯）
    const outside = join(TMP, 'outside-write-existing.txt');
    writeFileSync(outside, 'pre-existing');
    const { status, json } = await callPost(fileContentPost, { path: outside, content: 'overwrite' });
    assert.equal(status, 403);
    assert.equal(json.error, 'Forbidden');
    assert.equal(json.reason, 'outside-allowlist');
    // 越权写必须被拒，文件内容不变
    assert.equal(readFileSync(outside, 'utf-8'), 'pre-existing');
  });

  it('新建落在 outside-allowlist 祖先 → 403（递归上溯到根仍未命中）', async () => {
    // /nonexistent-root-xyz/a/b/c.txt：祖先一路 realpath-failed 直至根，最终 outside-allowlist
    const { status, json } = await callPost(
      fileContentPost,
      { path: '/nonexistent-root-xyz-zzz/a/b/c.txt', content: 'x' },
    );
    assert.equal(status, 403);
    assert.equal(json.error, 'Forbidden');
  });

  it('body 超 5MB → 413 Request body too large', async () => {
    // 直接走 overflow 分支：发送 >5MB 字符串，handler 在 data 回调里 destroy
    const huge = 'p'.repeat(5 * 1024 * 1024 + 100);
    const { status, json } = await callPost(
      fileContentPost,
      JSON.stringify({ path: join(PROJECT, 'x.txt'), content: huge }),
    );
    assert.equal(status, 413);
    assert.equal(json.error, 'Request body too large');
  });
});
