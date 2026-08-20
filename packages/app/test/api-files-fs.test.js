// 覆盖目标：server/routes/files-fs.js —— 文件系统增删改查/浏览/上传路由（第一部分）。
//
// 本文件覆盖：
//   /api/upload         （multipart：缺 boundary / 超 100MB / malformed / 无 filename /
//                        Windows 保留名 / 正常落盘 + persistPath 副本）
//   /api/import-file    （缺 boundary / dir 校验失败 / content-length 超限 / 路径穿越 /
//                        malformed / 无 filename / 正常落盘 / 同名冲突自动改名）
//   /api/browse-dir     （正常列目录 / 无效目录 / .git 标记 / 排序 / 根目录 parent=null）
//   /api/files          （绝对路径 + .. 守卫 / 列目录 + 排序 / symlink-to-dir / gitignore 标记 /
//                        IGNORED_PATTERNS 过滤 / 目录不存在 404）
//   /api/rename-file    （正常 / 缺参 / 非法路径 / 源不存在 / 目标已存在 / JSON 错误 / 嵌套路径）
//   /api/move-file      （正常 / 缺参 / 非法 / 源不存在 / 目标非目录 / 移入自身 / 目标已存在 / EXDEV fallback 无法直接造，记 skipped）
//   /api/delete-file    （文件 / 目录 / 缺参 / 非法 / 不存在 / symlink 拒绝 / protected dir 拒绝 / JSON 错误）
//   /api/resolve-path   （正常 / 空路径 / 非法路径 / JSON 错误）
//   /api/create-file    （正常 / 缺 name / 非法 name / 非法 dir / 目录不存在 / 已存在 / 嵌套）
//   /api/create-dir     （正常 / 缺 name / 非法 name / 非法 dir / 目录不存在 / 已存在 / 嵌套）
//
// 隔离范式：import 目标模块之前先 mkdtemp 并设 CCV_LOG_DIR / CLAUDE_CONFIG_DIR / CCV_PROJECT_DIR，
// 所有 fs 操作落在临时目录里造真实 fixture；after() 清理。req 用 EventEmitter 模拟，res 用收集器。

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync,
  readdirSync, symlinkSync, statSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 隔离：必须在任何 import 目标模块前设好 env ──────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-files-fs-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// 项目根 = 临时目录的一个子目录（fixtures 都造在这里，所有相对路径都落进来）
const projectDir = join(tmpDir, 'project');
mkdirSync(projectDir, { recursive: true });
process.env.CCV_PROJECT_DIR = projectDir;

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const IGNORED_PATTERNS = new Set(['.git', '.svn', '.hg', '.DS_Store', '.idea', '.vscode']);

// execWithStdin 假实现：默认返回空（无文件被 gitignore）。测试可临时替换。
let execStdinImpl = async () => '';
const deps = {
  MAX_POST_BODY: 1024 * 1024,
  WINDOWS_RESERVED_NAMES,
  IGNORED_PATTERNS,
  protocol: 'http',
  execWithStdin: (...args) => execStdinImpl(...args),
};

let routesByPath;

// /api/upload 把文件落到 server/routes/files-fs.js:72 写死的 *共享* 目录
// (/tmp/cc-viewer-uploads 或 tmpdir()/cc-viewer-uploads)。该目录被 file-access-policy.test.js
// 等其它文件并发读取，绝不能整目录 rmSync——只清理本文件成功 upload 用例自己落盘的产物。
// 成功 upload/extensionless 两个用例把返回的 data.path push 进来，after() 逐个 unlink。
const ownUploadProducts = [];

function handlerFor(path, method) {
  const r = routesByPath.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

// 调用一个 body-reading POST handler（rename/move/delete/create-file/create-dir/resolve），返回 {status, headers, data, raw}
function callBody(handler, body, { parsedUrl = { searchParams: new URLSearchParams() }, isLocal = true, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = headers;
    let status = 0; let hdr = null; let raw = '';
    const res = {
      writeHead(code, h) { status = code; hdr = h; },
      end(b) {
        raw = b || '';
        let data; try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status, headers: hdr, data, raw });
      },
    };
    handler(req, res, parsedUrl, isLocal, deps);
    if (typeof body === 'string') req.emit('data', Buffer.from(body));
    else if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
}

/** 调用一个 GET handler（browse/files），返回 {status, data} */
function callGet(handler, searchParams = {}, { isLocal = true } = {}) {
  return new Promise((resolve) => {
    const sp = new URLSearchParams(searchParams);
    let status = 0; let raw = '';
    const res = { writeHead(code) { status = code; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
    const r = handler({}, res, { searchParams: sp }, isLocal, deps);
    if (r && typeof r.then === 'function') r.then(() => {}); // files() 是 async，res 在内部 end
  });
}

/** 调用 multipart upload/import handler。 */
function callMultipart(handler, { reqHeaders, reqUrl, bodyBuf, emitChunks, parsedUrl = { searchParams: new URLSearchParams() }, isLocal = true } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = reqHeaders || {};
    req.url = reqUrl || '/api/upload';
    req.destroy = () => { req.emit('close'); };
    let status = 0; let raw = '';
    const res = {
      writeHead(code) { status = code; },
      end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); },
    };
    handler(req, res, parsedUrl, isLocal, deps);
    const chunks = emitChunks || (bodyBuf ? [bodyBuf] : []);
    for (const c of chunks) req.emit('data', c);
    req.emit('end');
  });
}

/** 拼一个最小 multipart body：单个 file part。 */
function buildMultipart(boundary, filename, content) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, body, tail]);
}

before(async () => {
  const mod = await import('../server/routes/files-fs.js');
  routesByPath = mod.filesFsRoutes;
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true }); // 临时根 + persistPath 副本 (CLAUDE_CONFIG_DIR=tmpDir)
  // 共享 upload 目录是其它测试文件并发读取的资源，只删本文件自己落盘的产物，
  // 绝不整目录 rmSync——否则会和 file-access-policy.test.js 的 isReadAllowed/realpathSync 读路径互踩。
  for (const p of ownUploadProducts) {
    try { unlinkSync(p); } catch { /* 可能已被清理或测试 skip，忽略 */ }
  }
});

// 每个用例前清空 projectDir 内容，避免互相干扰
beforeEach(() => {
  for (const n of readdirSync(projectDir)) rmSync(join(projectDir, n), { recursive: true, force: true });
  execStdinImpl = async () => '';
});

// ───────────────────────────── /api/upload ─────────────────────────────
describe('/api/upload', () => {
  const handler = () => handlerFor('/api/upload', 'POST');

  it('400 when boundary is missing', async () => {
    const { status, data } = await callMultipart(handler(), { reqHeaders: { 'content-type': 'multipart/form-data' } });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing boundary');
  });

  it('413 when content-length exceeds 100MB', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': 'multipart/form-data; boundary=B', 'content-length': String(101 * 1024 * 1024) },
    });
    assert.equal(status, 413);
    assert.match(data.error, /too large/i);
  });

  it('413 when streamed bytes exceed 100MB even if content-length lies', async () => {
    // content-length 缺省 → 0，绕过前置守卫；在 data 阶段累积超限触发 abort
    const big = Buffer.alloc(60 * 1024 * 1024); // 单块 60MB
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': 'multipart/form-data; boundary=B' },
      emitChunks: [big, big], // 120MB > 100MB
    });
    assert.equal(status, 413);
    assert.match(data.error, /too large/i);
  });

  it('500 on malformed multipart (no header terminator)', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': 'multipart/form-data; boundary=B' },
      bodyBuf: Buffer.from('no crlf-crlf here'),
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'Upload failed');
  });

  it('500 when part has no filename', async () => {
    const boundary = 'X';
    const buf = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\nhello\r\n--${boundary}--\r\n`);
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      bodyBuf: buf,
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'Upload failed');
  });

  it('500 when filename is a Windows reserved device name', async () => {
    const boundary = 'Y';
    const buf = buildMultipart(boundary, 'CON.txt', 'data');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      bodyBuf: buf,
    });
    assert.equal(status, 500); // 'Reserved filename not allowed' 被 catch 成 Upload failed
    assert.equal(data.error, 'Upload failed');
  });

  it('200 and writes file to upload dir + persist copy on normal upload', async () => {
    const boundary = 'Z';
    const content = 'hello-upload-body';
    const buf = buildMultipart(boundary, 'note.txt', content);
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      bodyBuf: buf,
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.path && existsSync(data.path), 'saved file must exist');
    ownUploadProducts.push(data.path); // 仅清理自己的产物，见 after()
    assert.equal(readFileSync(data.path, 'utf-8'), content);
    // 时间戳被插入到扩展名前
    assert.match(data.path, /note-\d+\.txt$/);
    // persistPath 副本写到 ~/.claude/cc-viewer/<project>/images/（CLAUDE_CONFIG_DIR=tmpDir）
    if (data.persistPath) {
      assert.ok(existsSync(data.persistPath), 'persist copy must exist');
      assert.equal(readFileSync(data.persistPath, 'utf-8'), content);
    }
  });

  it('200 with extensionless filename appends -<ts> suffix', async () => {
    const boundary = 'E';
    const buf = buildMultipart(boundary, 'README', 'x');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      bodyBuf: buf,
    });
    assert.equal(status, 200);
    assert.match(data.path, /README-\d+$/);
    ownUploadProducts.push(data.path); // 仅清理自己的产物，见 after()
  });
});

// ───────────────────────────── /api/import-file ─────────────────────────────
describe('/api/import-file', () => {
  const handler = () => handlerFor('/api/import-file', 'POST');

  function importHeaders(boundary, extra = {}) {
    return { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', ...extra };
  }

  it('400 when boundary is missing', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: { 'content-type': 'multipart/form-data', host: 'localhost' },
      reqUrl: '/api/import-file?dir=',
    });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing boundary');
  });

  it('400 when dir param fails validateImportDir (e.g. absolute)', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders('B'),
      reqUrl: '/api/import-file?dir=/etc',
    });
    assert.equal(status, 400);
    assert.match(data.error, /Invalid dir/i);
  });

  it('400 when dir tries to write into .git', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders('B'),
      reqUrl: '/api/import-file?dir=.git',
    });
    assert.equal(status, 400);
    assert.match(data.error, /\.git/);
  });

  it('413 when content-length exceeds 100MB', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders('B', { 'content-length': String(200 * 1024 * 1024) }),
      reqUrl: '/api/import-file?dir=',
    });
    assert.equal(status, 413);
    assert.match(data.error, /too large/i);
  });

  it('413 when streamed bytes exceed 100MB', async () => {
    const big = Buffer.alloc(60 * 1024 * 1024);
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders('B'),
      reqUrl: '/api/import-file?dir=',
      emitChunks: [big, big],
    });
    assert.equal(status, 413);
  });

  it('500 on malformed multipart', async () => {
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders('B'),
      reqUrl: '/api/import-file?dir=',
      bodyBuf: Buffer.from('garbage'),
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'Import failed');
  });

  it('500 when part has no filename', async () => {
    const boundary = 'NF';
    const buf = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\nhi\r\n--${boundary}--\r\n`);
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=',
      bodyBuf: buf,
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'Import failed');
  });

  it('500 when filename is a Windows reserved device name', async () => {
    const boundary = 'RN';
    const buf = buildMultipart(boundary, 'NUL.dat', 'x');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=',
      bodyBuf: buf,
    });
    assert.equal(status, 500);
    assert.equal(data.error, 'Import failed');
  });

  it('200 writes file into project dir at root', async () => {
    const boundary = 'OK';
    const buf = buildMultipart(boundary, 'imported.txt', 'imported-content');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=',
      bodyBuf: buf,
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.name, 'imported.txt');
    assert.equal(data.relPath, 'imported.txt');
    assert.equal(readFileSync(join(projectDir, 'imported.txt'), 'utf-8'), 'imported-content');
  });

  it('200 writes into a sub directory and reports relPath', async () => {
    const boundary = 'SUB';
    const buf = buildMultipart(boundary, 'f.txt', 'sub');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=assets',
      bodyBuf: buf,
    });
    assert.equal(status, 200);
    assert.equal(data.relPath, 'assets/f.txt');
    assert.ok(existsSync(join(projectDir, 'assets', 'f.txt')));
  });

  it('200 auto-renames on filename conflict (stem-1.ext)', async () => {
    writeFileSync(join(projectDir, 'dup.txt'), 'existing');
    const boundary = 'DUP';
    const buf = buildMultipart(boundary, 'dup.txt', 'new');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=',
      bodyBuf: buf,
    });
    assert.equal(status, 200);
    assert.equal(data.name, 'dup-1.txt');
    assert.equal(readFileSync(join(projectDir, 'dup-1.txt'), 'utf-8'), 'new');
    assert.equal(readFileSync(join(projectDir, 'dup.txt'), 'utf-8'), 'existing', 'original untouched');
  });

  it('400 rejects a dir that realpath-escapes cwd via a symlink', async (t) => {
    const outside = join(tmpDir, 'outside-import');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(projectDir, 'escapelink'), 'dir');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const boundary = 'ESC';
    const buf = buildMultipart(boundary, 'x.txt', 'data');
    const { status, data } = await callMultipart(handler(), {
      reqHeaders: importHeaders(boundary),
      reqUrl: '/api/import-file?dir=escapelink',
      bodyBuf: buf,
    });
    assert.equal(status, 400);
    assert.equal(data.error, 'Path traversal not allowed');
  });
});

// ───────────────────────────── /api/browse-dir ─────────────────────────────
describe('/api/browse-dir', () => {
  const handler = () => handlerFor('/api/browse-dir', 'GET');

  it('400 on non-existent path', async () => {
    const { status, data } = await callGet(handler(), { path: join(tmpDir, 'no-such-dir') });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory');
  });

  it('400 when path is a file not a directory', async () => {
    const f = join(projectDir, 'afile.txt');
    writeFileSync(f, 'x');
    const { status, data } = await callGet(handler(), { path: f });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid directory');
  });

  it('200 lists subdirectories, hides dotfiles, flags git repos, sets parent', async () => {
    mkdirSync(join(projectDir, 'zeta'));
    mkdirSync(join(projectDir, 'alpha'));
    mkdirSync(join(projectDir, '.hidden'));
    mkdirSync(join(projectDir, 'repo'));
    mkdirSync(join(projectDir, 'repo', '.git'));
    writeFileSync(join(projectDir, 'loose.txt'), 'x'); // 文件不应出现

    const { status, data } = await callGet(handler(), { path: projectDir });
    assert.equal(status, 200);
    assert.equal(data.current, projectDir);
    assert.ok(data.parent && data.parent !== projectDir, 'parent must be set for non-root');
    const names = data.dirs.map((d) => d.name);
    assert.ok(!names.includes('.hidden'), 'dotfiles hidden');
    assert.ok(!names.includes('loose.txt'), 'files excluded');
    assert.ok(names.includes('alpha') && names.includes('zeta') && names.includes('repo'));
    // git 仓库排前（hasGit=true 优先）
    assert.equal(data.dirs[0].name, 'repo');
    assert.equal(data.dirs[0].hasGit, true);
    // 非 git 目录按名字排序
    const nonGit = data.dirs.filter((d) => !d.hasGit).map((d) => d.name);
    assert.deepEqual(nonGit, ['alpha', 'zeta']);
  });
});

// ───────────────────────────── /api/files ─────────────────────────────
describe('/api/files', () => {
  const handler = () => handlerFor('/api/files', 'GET');

  it('400 on absolute path', async () => {
    const { status, data } = await callGet(handler(), { path: '/etc' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid path');
  });

  it('400 on path traversal (..)', async () => {
    const { status, data } = await callGet(handler(), { path: '../secret' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid path');
  });

  it('404 when directory does not exist', async () => {
    const { status, data } = await callGet(handler(), { path: 'nope' });
    assert.equal(status, 404);
    assert.equal(data.error, 'Directory not found');
  });

  it('200 lists entries, dirs before files, applies IGNORED_PATTERNS', async () => {
    mkdirSync(join(projectDir, 'src'));
    mkdirSync(join(projectDir, '.git')); // 应被 IGNORED_PATTERNS 过滤
    writeFileSync(join(projectDir, 'b.txt'), 'x');
    writeFileSync(join(projectDir, 'a.txt'), 'x');

    const { status, data } = await callGet(handler(), { path: '.' });
    assert.equal(status, 200);
    const names = data.map((d) => d.name);
    assert.ok(!names.includes('.git'), '.git filtered');
    // 目录在前
    assert.equal(data[0].name, 'src');
    assert.equal(data[0].type, 'directory');
    // 文件按名排序
    const files = data.filter((d) => d.type === 'file').map((d) => d.name);
    assert.deepEqual(files, ['a.txt', 'b.txt']);
  });

  it('resolves a symlink-to-directory as type "directory"', async (t) => {
    mkdirSync(join(projectDir, 'realdir'));
    try {
      symlinkSync(join(projectDir, 'realdir'), join(projectDir, 'linkdir'), 'dir');
    } catch {
      t.skip('symlink not permitted on this platform');
      return;
    }
    const { status, data } = await callGet(handler(), { path: '.' });
    assert.equal(status, 200);
    const link = data.find((d) => d.name === 'linkdir');
    assert.ok(link);
    assert.equal(link.type, 'directory', 'symlink to dir should follow to directory');
  });

  it('falls back to file for a broken symlink', async (t) => {
    try {
      symlinkSync(join(projectDir, 'does-not-exist'), join(projectDir, 'brokenlink'), 'file');
    } catch {
      t.skip('symlink not permitted on this platform');
      return;
    }
    const { status, data } = await callGet(handler(), { path: '.' });
    assert.equal(status, 200);
    const link = data.find((d) => d.name === 'brokenlink');
    assert.ok(link);
    assert.equal(link.type, 'file', 'broken symlink falls back to file');
  });

  it('marks entries reported by git check-ignore as gitIgnored', async () => {
    writeFileSync(join(projectDir, 'tracked.txt'), 'x');
    writeFileSync(join(projectDir, 'ignored.log'), 'x');
    // 假 execWithStdin 返回 ignored.log 被忽略
    execStdinImpl = async (cmd, args, input) => {
      assert.equal(cmd, 'git');
      assert.deepEqual(args, ['check-ignore', '--stdin']);
      return 'ignored.log\n';
    };
    const { status, data } = await callGet(handler(), { path: '.' });
    assert.equal(status, 200);
    const ignored = data.find((d) => d.name === 'ignored.log');
    const tracked = data.find((d) => d.name === 'tracked.txt');
    assert.equal(ignored.gitIgnored, true);
    assert.equal(tracked.gitIgnored, undefined);
  });

  it('survives git check-ignore throwing (non-git repo)', async () => {
    writeFileSync(join(projectDir, 'x.txt'), 'x');
    execStdinImpl = async () => { throw new Error('not a git repo'); };
    const { status, data } = await callGet(handler(), { path: '.' });
    assert.equal(status, 200);
    assert.equal(data.find((d) => d.name === 'x.txt').gitIgnored, undefined);
  });

  it('handles empty directory without invoking git', async () => {
    mkdirSync(join(projectDir, 'empty'));
    let called = false;
    execStdinImpl = async () => { called = true; return ''; };
    const { status, data } = await callGet(handler(), { path: 'empty' });
    assert.equal(status, 200);
    assert.deepEqual(data, []);
    assert.equal(called, false, 'git check-ignore skipped for empty listing');
  });
});

// ───────────────────────────── /api/resolve-path ─────────────────────────────
describe('/api/resolve-path', () => {
  const handler = () => handlerFor('/api/resolve-path', 'POST');

  it('400 on invalid request body', async () => {
    const { status, data } = await callBody(handler(), 'not json');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 on absolute / traversal path', async () => {
    const a = await callBody(handler(), { path: '/etc/passwd' });
    assert.equal(a.status, 400);
    assert.equal(a.data.error, 'Invalid path');
    const b = await callBody(handler(), { path: '../escape' });
    assert.equal(b.status, 400);
  });

  it('200 resolves relative path against cwd', async () => {
    const { status, data } = await callBody(handler(), { path: 'sub/x.txt' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.fullPath, join(projectDir, 'sub/x.txt'));
  });

  it('200 with empty path resolves to cwd', async () => {
    const { status, data } = await callBody(handler(), { path: '' });
    assert.equal(status, 200);
    assert.equal(data.fullPath, projectDir);
  });
});

// ───────────────────────────── /api/rename-file ─────────────────────────────
describe('/api/rename-file', () => {
  const handler = () => handlerFor('/api/rename-file', 'POST');

  it('400 on invalid JSON', async () => {
    const { status, data } = await callBody(handler(), 'oops');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when oldPath or newName missing', async () => {
    const { status, data } = await callBody(handler(), { oldPath: 'a.txt' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing oldPath or newName');
  });

  it('400 on illegal paths (absolute / .. / slash in newName)', async () => {
    assert.equal((await callBody(handler(), { oldPath: '/a', newName: 'b' })).status, 400);
    assert.equal((await callBody(handler(), { oldPath: '../a', newName: 'b' })).status, 400);
    assert.equal((await callBody(handler(), { oldPath: 'a', newName: 'b/c' })).status, 400);
    assert.equal((await callBody(handler(), { oldPath: 'a', newName: 'b\\c' })).status, 400);
    assert.equal((await callBody(handler(), { oldPath: 'a', newName: '..' })).status, 400);
  });

  it('404 when source does not exist', async () => {
    const { status, data } = await callBody(handler(), { oldPath: 'ghost.txt', newName: 'new.txt' });
    assert.equal(status, 404);
    assert.equal(data.error, 'File not found');
  });

  it('409 when target already exists', async () => {
    writeFileSync(join(projectDir, 'src.txt'), 'a');
    writeFileSync(join(projectDir, 'dst.txt'), 'b');
    const { status, data } = await callBody(handler(), { oldPath: 'src.txt', newName: 'dst.txt' });
    assert.equal(status, 409);
    assert.equal(data.error, 'Target already exists');
  });

  it('200 renames a top-level file', async () => {
    writeFileSync(join(projectDir, 'old.txt'), 'data');
    const { status, data } = await callBody(handler(), { oldPath: 'old.txt', newName: 'new.txt' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.newPath, 'new.txt');
    assert.ok(!existsSync(join(projectDir, 'old.txt')));
    assert.equal(readFileSync(join(projectDir, 'new.txt'), 'utf-8'), 'data');
  });

  it('200 renames a nested file and keeps the directory prefix', async () => {
    mkdirSync(join(projectDir, 'dir'));
    writeFileSync(join(projectDir, 'dir', 'a.txt'), 'x');
    const { status, data } = await callBody(handler(), { oldPath: 'dir/a.txt', newName: 'b.txt' });
    assert.equal(status, 200);
    assert.equal(data.newPath, 'dir/b.txt');
    assert.ok(existsSync(join(projectDir, 'dir', 'b.txt')));
  });
});

// ───────────────────────────── /api/move-file ─────────────────────────────
describe('/api/move-file', () => {
  const handler = () => handlerFor('/api/move-file', 'POST');

  it('400 on invalid JSON', async () => {
    const { status, data } = await callBody(handler(), '{bad');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when fromPath or toDir missing', async () => {
    const { status, data } = await callBody(handler(), { fromPath: 'a' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing fromPath or toDir');
  });

  it('400 on illegal paths', async () => {
    assert.equal((await callBody(handler(), { fromPath: '/a', toDir: 'd' })).status, 400);
    assert.equal((await callBody(handler(), { fromPath: 'a', toDir: '../d' })).status, 400);
  });

  it('404 when source not found', async () => {
    mkdirSync(join(projectDir, 'dest'));
    const { status, data } = await callBody(handler(), { fromPath: 'ghost.txt', toDir: 'dest' });
    assert.equal(status, 404);
    assert.equal(data.error, 'Source not found');
  });

  it('400 when target directory is not a directory', async () => {
    writeFileSync(join(projectDir, 'a.txt'), 'x');
    writeFileSync(join(projectDir, 'notdir'), 'x');
    const { status, data } = await callBody(handler(), { fromPath: 'a.txt', toDir: 'notdir' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Target directory not found');
  });

  it('400 when moving a directory into itself', async () => {
    mkdirSync(join(projectDir, 'parent'));
    mkdirSync(join(projectDir, 'parent', 'child'));
    const { status, data } = await callBody(handler(), { fromPath: 'parent', toDir: 'parent/child' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Cannot move directory into itself');
  });

  it('409 when target location already has a same-named entry', async () => {
    writeFileSync(join(projectDir, 'f.txt'), 'a');
    mkdirSync(join(projectDir, 'dest'));
    writeFileSync(join(projectDir, 'dest', 'f.txt'), 'b');
    const { status, data } = await callBody(handler(), { fromPath: 'f.txt', toDir: 'dest' });
    assert.equal(status, 409);
    assert.equal(data.error, 'Target already exists');
  });

  it('200 moves a file into target directory (POSIX newPath)', async () => {
    writeFileSync(join(projectDir, 'm.txt'), 'movecontent');
    mkdirSync(join(projectDir, 'dest'));
    const { status, data } = await callBody(handler(), { fromPath: 'm.txt', toDir: 'dest' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.newPath, 'dest/m.txt');
    assert.ok(!existsSync(join(projectDir, 'm.txt')));
    assert.equal(readFileSync(join(projectDir, 'dest', 'm.txt'), 'utf-8'), 'movecontent');
  });

  it('200 moves a directory recursively', async () => {
    mkdirSync(join(projectDir, 'movedir'));
    writeFileSync(join(projectDir, 'movedir', 'inner.txt'), 'i');
    mkdirSync(join(projectDir, 'target'));
    const { status, data } = await callBody(handler(), { fromPath: 'movedir', toDir: 'target' });
    assert.equal(status, 200);
    assert.ok(existsSync(join(projectDir, 'target', 'movedir', 'inner.txt')));
    assert.ok(!existsSync(join(projectDir, 'movedir')));
  });
});

// ───────────────────────────── /api/delete-file ─────────────────────────────
describe('/api/delete-file', () => {
  const handler = () => handlerFor('/api/delete-file', 'POST');

  it('400 on invalid JSON', async () => {
    const { status, data } = await callBody(handler(), 'nope');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when path missing', async () => {
    const { status, data } = await callBody(handler(), {});
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing path');
  });

  it('400 on absolute / traversal path', async () => {
    assert.equal((await callBody(handler(), { path: '/etc/passwd' })).status, 400);
    assert.equal((await callBody(handler(), { path: '../x' })).status, 400);
  });

  it('404 when file does not exist', async () => {
    const { status, data } = await callBody(handler(), { path: 'ghost.txt' });
    assert.equal(status, 404);
    assert.equal(data.error, 'File not found');
  });

  it('200 deletes a regular file', async () => {
    writeFileSync(join(projectDir, 'del.txt'), 'x');
    const { status, data } = await callBody(handler(), { path: 'del.txt' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(!existsSync(join(projectDir, 'del.txt')));
  });

  it('200 deletes a directory recursively', async () => {
    mkdirSync(join(projectDir, 'deldir'));
    writeFileSync(join(projectDir, 'deldir', 'a.txt'), 'x');
    const { status, data } = await callBody(handler(), { path: 'deldir' });
    assert.equal(status, 200);
    assert.ok(!existsSync(join(projectDir, 'deldir')));
  });

  it('400 rejects deleting a protected directory (node_modules)', async () => {
    mkdirSync(join(projectDir, 'node_modules'));
    const { status, data } = await callBody(handler(), { path: 'node_modules' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Cannot delete protected directory');
    assert.ok(existsSync(join(projectDir, 'node_modules')), 'protected dir untouched');
  });

  it('400 rejects deleting a nested protected directory (forward-slash segment match)', async () => {
    mkdirSync(join(projectDir, 'wrap'));
    mkdirSync(join(projectDir, 'wrap', '.git'));
    // .git 出现在任意一段都被拒（split(/[\\/]/) + toLowerCase 段匹配）
    const { status, data } = await callBody(handler(), { path: 'wrap/.git' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Cannot delete protected directory');
    assert.ok(existsSync(join(projectDir, 'wrap', '.git')), 'protected dir untouched');
  });

  it('400 rejects a protected directory name regardless of case (toLowerCase guard)', async (t) => {
    // 大小写归一化守卫：请求段 '.GIT' 经 toLowerCase 归一化命中 protectedDirs。
    // 仅 case-insensitive 文件系统（macOS APFS/Win NTFS）上 existsSync('.GIT') 命中真实 .git；
    // case-sensitive（多数 Linux）上 existsSync 先 false → 404，跳过本断言。
    mkdirSync(join(projectDir, '.git'));
    if (!existsSync(join(projectDir, '.GIT'))) {
      t.skip('case-sensitive filesystem: .GIT does not resolve to .git');
      return;
    }
    const { status, data } = await callBody(handler(), { path: '.GIT' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Cannot delete protected directory');
  });

  it('POSIX: a backslash-embedded path that is not a real entry yields 404 (pin current behavior)', async () => {
    // 现状行为锚定：POSIX 上 path.join 不把 '\\' 当分隔符，'wrap\\node_modules' 不是真实路径，
    // existsSync 先返回 false → 404，protected-dir 守卫不可达（仅 Windows 上 '\\' 是分隔符时才命中）。
    mkdirSync(join(projectDir, 'wrap2'));
    mkdirSync(join(projectDir, 'wrap2', 'node_modules'));
    const { status } = await callBody(handler(), { path: 'wrap2\\node_modules' });
    if (process.platform === 'win32') {
      assert.equal(status, 400);
    } else {
      assert.equal(status, 404);
    }
  });

  it('400 rejects deleting a symbolic link', async (t) => {
    writeFileSync(join(projectDir, 'realfile.txt'), 'x');
    try {
      symlinkSync(join(projectDir, 'realfile.txt'), join(projectDir, 'link.txt'), 'file');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const { status, data } = await callBody(handler(), { path: 'link.txt' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Cannot delete symbolic links via this endpoint');
    assert.ok(existsSync(join(projectDir, 'realfile.txt')), 'link target untouched');
  });
});

// ───────────────────────────── /api/create-file ─────────────────────────────
describe('/api/create-file', () => {
  const handler = () => handlerFor('/api/create-file', 'POST');

  it('400 on invalid JSON', async () => {
    assert.equal((await callBody(handler(), 'bad')).status, 400);
  });

  it('400 when name missing', async () => {
    const { status, data } = await callBody(handler(), { dirPath: '' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing name');
  });

  it('400 on invalid file name (slash / backslash / .. / control char)', async () => {
    assert.equal((await callBody(handler(), { name: 'a/b' })).data.error, 'Invalid file name');
    assert.equal((await callBody(handler(), { name: 'a\\b' })).data.error, 'Invalid file name');
    assert.equal((await callBody(handler(), { name: '..' })).data.error, 'Invalid file name');
    assert.equal((await callBody(handler(), { name: 'a\x01b' })).data.error, 'Invalid file name');
  });

  it('400 on invalid dirPath (absolute / ..)', async () => {
    assert.equal((await callBody(handler(), { name: 'x.txt', dirPath: '/abs' })).data.error, 'Invalid path');
    assert.equal((await callBody(handler(), { name: 'x.txt', dirPath: '../up' })).data.error, 'Invalid path');
  });

  it('400 when target directory does not exist', async () => {
    const { status, data } = await callBody(handler(), { name: 'x.txt', dirPath: 'missing' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Directory not found');
  });

  it('409 when file already exists', async () => {
    writeFileSync(join(projectDir, 'exists.txt'), 'x');
    const { status, data } = await callBody(handler(), { name: 'exists.txt', dirPath: '' });
    assert.equal(status, 409);
    assert.equal(data.error, 'File already exists');
  });

  it('200 creates an empty file at project root', async () => {
    const { status, data } = await callBody(handler(), { name: 'fresh.txt', dirPath: '' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.path, 'fresh.txt');
    assert.equal(readFileSync(join(projectDir, 'fresh.txt'), 'utf-8'), '');
  });

  it('200 creates a file in a sub directory and reports nested relPath', async () => {
    mkdirSync(join(projectDir, 'nested'));
    const { status, data } = await callBody(handler(), { name: 'c.txt', dirPath: 'nested' });
    assert.equal(status, 200);
    assert.equal(data.path, 'nested/c.txt');
    assert.ok(existsSync(join(projectDir, 'nested', 'c.txt')));
  });

  it('400 rejects a dirPath that realpath-escapes cwd via a symlink', async (t) => {
    const outside = join(tmpDir, 'outside-create-file');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(projectDir, 'esc'), 'dir');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const { status, data } = await callBody(handler(), { name: 'leak.txt', dirPath: 'esc' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Path traversal not allowed');
    assert.ok(!existsSync(join(outside, 'leak.txt')), 'no file created outside cwd');
  });
});

// ───────────────────────────── /api/create-dir ─────────────────────────────
describe('/api/create-dir', () => {
  const handler = () => handlerFor('/api/create-dir', 'POST');

  it('400 on invalid JSON', async () => {
    assert.equal((await callBody(handler(), 'bad')).status, 400);
  });

  it('400 when name missing', async () => {
    const { status, data } = await callBody(handler(), {});
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing name');
  });

  it('400 on invalid folder name', async () => {
    assert.equal((await callBody(handler(), { name: 'a/b' })).data.error, 'Invalid folder name');
    assert.equal((await callBody(handler(), { name: '..' })).data.error, 'Invalid folder name');
    assert.equal((await callBody(handler(), { name: 'x\x02' })).data.error, 'Invalid folder name');
  });

  it('400 on invalid dirPath', async () => {
    assert.equal((await callBody(handler(), { name: 'd', dirPath: '/abs' })).data.error, 'Invalid path');
  });

  it('400 when parent directory does not exist', async () => {
    const { status, data } = await callBody(handler(), { name: 'd', dirPath: 'missing' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Directory not found');
  });

  it('409 when directory already exists', async () => {
    mkdirSync(join(projectDir, 'dup'));
    const { status, data } = await callBody(handler(), { name: 'dup', dirPath: '' });
    assert.equal(status, 409);
    assert.equal(data.error, 'Already exists');
  });

  it('200 creates a directory at root', async () => {
    const { status, data } = await callBody(handler(), { name: 'newdir', dirPath: '' });
    assert.equal(status, 200);
    assert.equal(data.path, 'newdir');
    assert.ok(statSync(join(projectDir, 'newdir')).isDirectory());
  });

  it('200 creates a nested directory', async () => {
    mkdirSync(join(projectDir, 'base'));
    const { status, data } = await callBody(handler(), { name: 'child', dirPath: 'base' });
    assert.equal(status, 200);
    assert.equal(data.path, 'base/child');
    assert.ok(statSync(join(projectDir, 'base', 'child')).isDirectory());
  });

  it('400 rejects a dirPath that realpath-escapes cwd via a symlink', async (t) => {
    const outside = join(tmpDir, 'outside-create-dir');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(projectDir, 'escd'), 'dir');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const { status, data } = await callBody(handler(), { name: 'leakdir', dirPath: 'escd' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Path traversal not allowed');
    assert.ok(!existsSync(join(outside, 'leakdir')), 'no dir created outside cwd');
  });
});
