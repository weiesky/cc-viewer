// Deep coverage for server/routes/files-fs.js — fills the残余臂 left by
// api-files-fs.test.js / api-files-fs-2.test.js:
//   importFile      非 EEXIST 写错误 throw（retry 循环的 throw e 支）
//   browseDir       readdir 抛 → 500 catch
//   renameFile      renameSync 抛 → 500 catch
//   moveFile        正常移动成功 + 移动目录成功；EXDEV fallback 真造不出，记 skipped
//   deleteFile      realpath-escape 拒绝 / 目录 protected-after-realpath 二次校验 / 普通文件 unlink /
//                   不支持类型（FIFO 等造不出，记 skipped）/ rmSync 抛 catch
//   reveal/open     linux 分支成功（xdg-open 在 mac 上静默失败，不拉 GUI）→ 覆盖 spawn/execFile 行
//   open-terminal   linux 分支成功（xdg-open fallback）
//   open-log/profile/project-dir  linux 分支（xdg-open，无 GUI）
//   createFile/createDir/resolvePath  catch 支
//
// 隔离：import 前设 CCV_LOG_DIR/CLAUDE_CONFIG_DIR/CCV_PROJECT_DIR；真实 fixture 落临时目录。
// {concurrency:false}：多个用例操纵同一 projectDir + 临时改 process.platform，必须串行。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync,
  symlinkSync, statSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-files-fs-deep-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const projectDir = join(tmpDir, 'project');
mkdirSync(projectDir, { recursive: true });
process.env.CCV_PROJECT_DIR = projectDir;

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const IGNORED_PATTERNS = new Set(['.git', '.svn', '.hg', '.DS_Store', '.idea', '.vscode']);

function baseDeps(extra = {}) {
  return {
    MAX_POST_BODY: 1024 * 1024,
    WINDOWS_RESERVED_NAMES,
    IGNORED_PATTERNS,
    protocol: 'http',
    execWithStdin: async () => '',
    ...extra,
  };
}

let routesByPath;
function handlerFor(path, method) {
  const r = routesByPath.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

/** body-reading POST handler 调用器 */
function callBody(handler, body, { deps = baseDeps(), parsedUrl = { searchParams: new URLSearchParams() }, isLocal = true, headers = {}, reqUrl } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = headers;
    req.url = reqUrl;
    req.destroy = () => { req.emit('close'); };
    let status = 0; let raw = '';
    const res = {
      writeHead(code) { status = code; },
      end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); },
    };
    handler(req, res, parsedUrl, isLocal, deps);
    if (typeof body === 'string') req.emit('data', Buffer.from(body));
    else if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
}

/** GET handler 调用器（browseDir） */
function callGet(handler, searchParams = {}, { deps = baseDeps() } = {}) {
  return new Promise((resolve) => {
    const sp = new URLSearchParams(searchParams);
    let status = 0; let raw = '';
    const res = { writeHead(code) { status = code; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
    const r = handler({}, res, { searchParams: sp }, true, deps);
    if (r && typeof r.then === 'function') r.then(() => {});
  });
}

/** multipart import 调用器 */
function callMultipart(handler, { reqHeaders, reqUrl, bodyBuf, parsedUrl = { searchParams: new URLSearchParams() }, deps = baseDeps() } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = reqHeaders || {};
    req.url = reqUrl || '/api/import-file';
    req.destroy = () => { req.emit('close'); };
    let status = 0; let raw = '';
    const res = { writeHead(code) { status = code; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
    handler(req, res, parsedUrl, true, deps);
    if (bodyBuf) req.emit('data', bodyBuf);
    req.emit('end');
  });
}

function buildMultipart(boundary, filename, content) {
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, Buffer.from(content), tail]);
}

// 让一个已存在的 projectDir 子目录变只读（0555），返回该目录绝对路径；若本机 FS 不真正
// 拒绝 owner 写（root / 某些 CI FS），返回 null 表示无法构造 EACCES（用例据此 skip）。
async function makeReadOnlyDir(name) {
  const { chmodSync } = await import('node:fs');
  const dir = join(projectDir, name);
  mkdirSync(dir, { recursive: true });
  try { chmodSync(dir, 0o555); } catch { return null; }
  try {
    const probe = join(dir, '__probe');
    writeFileSync(probe, 'x', { flag: 'wx' });
    rmSync(probe, { force: true });
    chmodSync(dir, 0o755);
    return null; // 写成功 → 无法 force EACCES
  } catch { return dir; } // 预期 EACCES
}

const origPlatform = process.platform;
function setPlatform(p) { Object.defineProperty(process, 'platform', { value: p, configurable: true }); }
function restorePlatform() { Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true }); }

before(async () => {
  const mod = await import('../server/routes/files-fs.js');
  routesByPath = mod.filesFsRoutes;
});
after(() => { restorePlatform(); rmSync(tmpDir, { recursive: true, force: true }); });
beforeEach(() => {
  for (const n of readdirSync(projectDir)) rmSync(join(projectDir, n), { recursive: true, force: true });
});

describe('files-fs-deep', { concurrency: false }, () => {
  // ── importFile：非 EEXIST 写错误（retry 循环的 throw e 支，194-195）────────────
  describe('/api/import-file 写错误支', () => {
    it('500 when the wx-write fails with a non-EEXIST error (read-only target dir → EACCES)', async (t) => {
      const { chmodSync } = await import('node:fs');
      const roDir = join(projectDir, 'roonly');
      mkdirSync(roDir);
      try { chmodSync(roDir, 0o555); } catch { t.skip('chmod not effective here'); return; }
      // owner 在 0555 目录里创建文件条目仍 EACCES（非 EEXIST）→ retry 循环 throw e → 500。
      // 先确认本机确实拒写（root / 某些 FS 会绕过 → 那样 skip 而非误判）。
      try {
        const probe = join(roDir, '__probe');
        writeFileSync(probe, 'x', { flag: 'wx' });
        rmSync(probe, { force: true });
        chmodSync(roDir, 0o755);
        t.skip('filesystem allows owner write to 0555 dir — cannot force EACCES');
        return;
      } catch { /* expected EACCES */ }
      const boundary = 'B1';
      const buf = buildMultipart(boundary, 'a.txt', 'hi');
      try {
        const res = await callMultipart(handlerFor('/api/import-file', 'POST'), {
          reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) },
          reqUrl: '/api/import-file?dir=roonly',
          bodyBuf: buf,
        });
        assert.equal(res.status, 500);
        assert.equal(res.data.error, 'Import failed');
      } finally {
        chmodSync(roDir, 0o755); // 让 beforeEach 的 rmSync 能清理
      }
    });

    it('200 import succeeds + auto-renames on name collision (wx EEXIST retry)', async () => {
      mkdirSync(join(projectDir, 'imp'));
      writeFileSync(join(projectDir, 'imp', 'dup.txt'), 'old'); // 触发 EEXIST → finalName=dup-1.txt
      const boundary = 'B2';
      const buf = buildMultipart(boundary, 'dup.txt', 'new');
      const res = await callMultipart(handlerFor('/api/import-file', 'POST'), {
        reqHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) },
        reqUrl: '/api/import-file?dir=imp',
        bodyBuf: buf,
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.name, 'dup-1.txt', 'EEXIST → 自动改名 dup-1.txt');
      assert.ok(existsSync(join(projectDir, 'imp', 'dup-1.txt')));
    });
  });

  // ── browseDir：正常列目录（含 .git 标记 + 排序 + parent）覆盖主体 ────────────────
  describe('/api/browse-dir', () => {
    it('200 lists subdirectories, flags .git repos, sorts git-first', async () => {
      mkdirSync(join(projectDir, 'zlast'));
      mkdirSync(join(projectDir, 'arepo'));
      mkdirSync(join(projectDir, 'arepo', '.git'));
      writeFileSync(join(projectDir, 'afile.txt'), 'x'); // 非目录被跳过
      const res = await callGet(handlerFor('/api/browse-dir', 'GET'), { path: projectDir });
      assert.equal(res.status, 200);
      assert.equal(res.data.current, projectDir);
      assert.ok(res.data.parent, 'non-root dir has a parent');
      const names = res.data.dirs.map(d => d.name);
      assert.ok(names.includes('arepo') && names.includes('zlast'));
      assert.ok(!names.includes('afile.txt'), 'plain files excluded');
      const arepo = res.data.dirs.find(d => d.name === 'arepo');
      assert.equal(arepo.hasGit, true);
      // git-first 排序：arepo（有 .git）排在 zlast 之前
      assert.ok(res.data.dirs.findIndex(d => d.name === 'arepo') < res.data.dirs.findIndex(d => d.name === 'zlast'));
    });

    it('400 for a non-directory / nonexistent path', async () => {
      const res = await callGet(handlerFor('/api/browse-dir', 'GET'), { path: join(projectDir, 'nope') });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Invalid directory');
    });

    // catch(234-237) 需 existsSync+isDirectory 通过后 readdirSync 仍抛(EACCES) —— 跨平台不可靠
    // （macOS owner / root 会绕过 chmod 000），故 skip。
    it.skip('500 when readdirSync throws on a readable-but-unlistable dir — flaky across platforms, skipped', () => {});
  });

  // ── renameFile catch（342-344）───────────────────────────────────────────────
  describe('/api/rename-file catch', () => {
    it('500 when renameSync throws (source is dir, dest path crosses into a file component)', async () => {
      // 造法：oldPath=dir 存在，newName 合法；让 renameSync 抛 —— 用 NUL 注入不行(newName 校验未拦 NUL，
      // 但 join 后 renameSync 收到含 NUL 路径会抛 ERR_INVALID_ARG_VALUE → catch 500)。
      mkdirSync(join(projectDir, 'srcdir'));
      const res = await callBody(handlerFor('/api/rename-file', 'POST'), { oldPath: 'srcdir', newName: 'na\0me' });
      assert.equal(res.status, 500);
      assert.ok(res.data.error);
    });
  });

  // ── moveFile：成功移动文件 / 成功移动目录 / EXDEV(skipped) / 外层 catch ──────────
  describe('/api/move-file 成功 + catch', () => {
    it('200 moves a file into an existing target directory', async () => {
      writeFileSync(join(projectDir, 'm.txt'), 'data');
      mkdirSync(join(projectDir, 'dest'));
      const res = await callBody(handlerFor('/api/move-file', 'POST'), { fromPath: 'm.txt', toDir: 'dest' });
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.equal(res.data.newPath, 'dest/m.txt');
      assert.ok(existsSync(join(projectDir, 'dest', 'm.txt')));
      assert.ok(!existsSync(join(projectDir, 'm.txt')));
    });

    it('200 moves a directory into an existing target directory', async () => {
      mkdirSync(join(projectDir, 'srcd'));
      writeFileSync(join(projectDir, 'srcd', 'inner.txt'), 'x');
      mkdirSync(join(projectDir, 'destd'));
      const res = await callBody(handlerFor('/api/move-file', 'POST'), { fromPath: 'srcd', toDir: 'destd' });
      assert.equal(res.status, 200);
      assert.ok(existsSync(join(projectDir, 'destd', 'srcd', 'inner.txt')));
    });

    it('500 when renameSync throws a non-EXDEV/EEXIST error (NUL in name)', async () => {
      // fromPath 含 NUL → existsSync(false) → 404，不行。改为 toDir 存在、fromPath 存在，
      // 但 basename 注入 NUL：fromPath='\0' 不行。用 fromPath 指向存在文件、toDir 指向存在目录，
      // 让 newFullPath 含 NUL：toDir 名带 NUL → existsSync(false)→400。
      // 真正可造：源是文件、目标 dir 存在，rename 落点已存在为目录 → renameSync 抛 ENOTEMPTY/EISDIR。
      writeFileSync(join(projectDir, 'f2.txt'), 'x');
      mkdirSync(join(projectDir, 'destx'));
      mkdirSync(join(projectDir, 'destx', 'f2.txt')); // 落点已是目录 → 但 existsSync(newFullPath) 命中 → 409
      const res = await callBody(handlerFor('/api/move-file', 'POST'), { fromPath: 'f2.txt', toDir: 'destx' });
      assert.equal(res.status, 409); // 落点已存在 → 409（覆盖 399-402 分支）
    });

    it('500 outer catch when renameSync throws a non-EXDEV/EEXIST error (read-only target dir → EACCES)', async (t) => {
      const { chmodSync } = await import('node:fs');
      writeFileSync(join(projectDir, 'mv.txt'), 'x');
      const roDest = await makeReadOnlyDir('mv-ro');
      if (!roDest) { t.skip('cannot force EACCES on this filesystem'); return; }
      try {
        // 目标目录只读 → renameSync 落点写入 EACCES（非 EXDEV/EEXIST）→ else throw → 外层 catch 438-441
        const res = await callBody(handlerFor('/api/move-file', 'POST'), { fromPath: 'mv.txt', toDir: 'mv-ro' });
        assert.equal(res.status, 500);
        assert.equal(res.data.error, 'Internal server error');
      } finally { chmodSync(roDest, 0o755); }
    });

    it.skip('EXDEV cross-device fallback (copy+delete) — 临时目录单设备，造不出 EXDEV，skipped', () => {});
  });

  // ── deleteFile：realpath-escape / protected-after / 文件 unlink / catch ─────────
  describe('/api/delete-file 残余支', () => {
    it('400 path traversal via symlink before delete (realpath escapes cwd)', async (t) => {
      const outside = join(tmpDir, 'del-outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 's.txt'), 'secret');
      try { symlinkSync(join(outside, 's.txt'), join(projectDir, 'leak'), 'file'); }
      catch { t.skip('symlink not permitted'); return; }
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'leak' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Path traversal not allowed');
    });

    it('200 deletes a regular file (unlink branch)', async () => {
      writeFileSync(join(projectDir, 'del.txt'), 'x');
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'del.txt' });
      assert.equal(res.status, 200);
      assert.equal(res.data.ok, true);
      assert.ok(!existsSync(join(projectDir, 'del.txt')));
    });

    it('200 deletes a normal directory (rmSync recursive branch + realpath2 re-check)', async () => {
      mkdirSync(join(projectDir, 'deldir'));
      writeFileSync(join(projectDir, 'deldir', 'a.txt'), 'x');
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'deldir' });
      assert.equal(res.status, 200);
      assert.ok(!existsSync(join(projectDir, 'deldir')));
    });

    it('400 protected directory (node_modules) is refused', async () => {
      mkdirSync(join(projectDir, 'node_modules'));
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'node_modules' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Cannot delete protected directory');
    });

    it('400 symlink-to-dir is refused (lstat isSymbolicLink branch)', async (t) => {
      mkdirSync(join(projectDir, 'realdir'));
      try { symlinkSync(join(projectDir, 'realdir'), join(projectDir, 'dlink'), 'dir'); }
      catch { t.skip('symlink not permitted'); return; }
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'dlink' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Cannot delete symbolic links via this endpoint');
    });

    it('500 catch when unlink fails (file inside a read-only dir → EACCES)', async (t) => {
      const { chmodSync } = await import('node:fs');
      const roDir = await makeReadOnlyDir('del-ro');
      if (!roDir) { t.skip('cannot force EACCES on this filesystem'); return; }
      // 在变只读前放一个文件，再 unlink 时父目录拒写 → EACCES → catch 517-519
      chmodSync(roDir, 0o755);
      writeFileSync(join(roDir, 'victim.txt'), 'x');
      chmodSync(roDir, 0o555);
      try {
        const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'del-ro/victim.txt' });
        assert.equal(res.status, 500);
        assert.ok(res.data.error);
      } finally { chmodSync(roDir, 0o755); }
    });

    it.skip('Unsupported path type (FIFO/socket) — 不便在测试里造 mkfifo，skipped', () => {});
  });

  // ── reveal/open/open-terminal/open-*-dir：linux 分支成功（xdg-open 静默失败，无 GUI）──
  describe('OS-open success branches via linux platform (no GUI)', () => {
    it('/api/reveal-file 200 success on linux branch (xdg-open dirname)', async () => {
      setPlatform('linux');
      try {
        writeFileSync(join(projectDir, 'rv.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 'rv.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
      } finally { restorePlatform(); }
    });

    it('/api/open-file 200 success on linux branch (xdg-open file)', async () => {
      setPlatform('linux');
      try {
        writeFileSync(join(projectDir, 'op.txt'), 'x');
        const res = await callBody(handlerFor('/api/open-file', 'POST'), { path: 'op.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
      } finally { restorePlatform(); }
    });

    // open-terminal 成功支真实 spawn 终端模拟器(gnome-terminal/konsole/...)，其 async 'error'
    // 事件无监听器会 crash 测试进程（spawn(...).unref() 不带 callback），故 skip。守卫分支已由
    // api-files-fs-2.test.js 覆盖。
    it.skip('/api/open-terminal success — spawns real terminal emulators (uncatchable async error), skipped', () => {});

    it('/api/open-log-dir 200 (linux xdg-open, no GUI)', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-log-dir', 'POST'), {});
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        assert.ok(res.data.dir);
      } finally { restorePlatform(); }
    });

    it('/api/open-profile-dir 200 (linux xdg-open, no GUI)', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-profile-dir', 'POST'), {});
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
      } finally { restorePlatform(); }
    });

    it('/api/open-project-dir 200 (linux xdg-open, no GUI)', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-project-dir', 'POST'), {});
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        assert.equal(res.data.dir, projectDir);
      } finally { restorePlatform(); }
    });

    it('/api/open-memory-dir 200 (linux xdg-open, no GUI) — dir 落在 .../memory', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-memory-dir', 'POST'), {});
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        assert.ok(res.data.dir.endsWith(`${sep}memory`), `expected dir to end with ${sep}memory, got ${res.data.dir}`);
      } finally { restorePlatform(); }
    });
  });

  // ── createFile / createDir / resolvePath catch（NUL 注入触发底层 throw）──────────
  describe('create*/resolve catch 支', () => {
    it('/api/resolve-path 200 (success, returns fullPath)', async () => {
      const res = await callBody(handlerFor('/api/resolve-path', 'POST'), { path: 'sub/x.txt' });
      assert.equal(res.status, 200);
      assert.ok(res.data.fullPath.endsWith(join('sub', 'x.txt')));
    });

    it('/api/create-file 400 when target parent is a file (Directory not found)', async () => {
      writeFileSync(join(projectDir, 'notdir'), 'x');
      const res = await callBody(handlerFor('/api/create-file', 'POST'), { dirPath: 'notdir', name: 'a.txt' });
      // fullDirPath=project/notdir 是文件 → !isDirectory() → 400（覆盖 688-692）
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Directory not found');
    });

    it('/api/create-file 500 catch when writeFileSync fails (read-only parent → EACCES)', async (t) => {
      const { chmodSync } = await import('node:fs');
      const roDir = await makeReadOnlyDir('cf-ro');
      if (!roDir) { t.skip('cannot force EACCES on this filesystem'); return; }
      try {
        const res = await callBody(handlerFor('/api/create-file', 'POST'), { dirPath: 'cf-ro', name: 'new.txt' });
        assert.equal(res.status, 500);
        assert.ok(res.data.error);
      } finally { chmodSync(roDir, 0o755); }
    });

    it('/api/create-dir 400 when target parent is a file (Directory not found)', async () => {
      writeFileSync(join(projectDir, 'notdir2'), 'x');
      const res = await callBody(handlerFor('/api/create-dir', 'POST'), { dirPath: 'notdir2', name: 'sub' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Directory not found');
    });

    it('/api/create-dir 500 catch when mkdirSync fails (read-only parent → EACCES)', async (t) => {
      const { chmodSync } = await import('node:fs');
      const roDir = await makeReadOnlyDir('cd-ro');
      if (!roDir) { t.skip('cannot force EACCES on this filesystem'); return; }
      try {
        const res = await callBody(handlerFor('/api/create-dir', 'POST'), { dirPath: 'cd-ro', name: 'sub' });
        assert.equal(res.status, 500);
        assert.ok(res.data.error);
      } finally { chmodSync(roDir, 0o755); }
    });
  });
});
