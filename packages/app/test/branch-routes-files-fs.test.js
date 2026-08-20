// 分支补强：server/routes/files-fs.js —— 填补 api-files-fs*.test.js / files-fs-deep.test.js
// 留下的残余分支臂，把 single-run branch 拉到 >= 95%。
//
// 本文件覆盖的残余分支：
//   browseDir    catch（isDirectory 通过后 readdirSync 抛 EACCES，235-237）
//   deleteFile   「不支持类型」else 臂（FIFO：非 symlink/非 dir/非 file，510-513）
//   revealFile   darwin 臂（561）/ win32 臂（563-564）/ catch（path 数字 → TypeError，571-573）
//   openFile     darwin 臂（615）/ win32 臂（617）/ catch（path 数字 → TypeError，624-626）
//   resolvePath  catch（path 数字 → TypeError，652-654）
//   openTerminal darwin / win32 / linux 三个平台臂（748-775，含 gnome-terminal 分支 759-760）
//
// 关键手法：reveal/open/open-terminal 的成功臂直接 execFile/spawn 真实平台命令（open / explorer.exe
//   / cmd.exe / gnome-terminal）。本文件在 before() 里造一个 fakeBin 目录，放同名 stub 脚本
//   （`#!/bin/sh; exit 0`）并 prepend 到 process.env.PATH —— 这样：
//     (a) 不会拉起真实 GUI（Finder / 终端）；
//     (b) bare spawn(...).unref() 不会因二进制缺失抛 async ENOENT 把 uncaughtException 归给当前
//         用例 fail（node:test 会抢先 file 级 uncaughtException 守卫，故必须从源头消除 async 错误）。
//   平台用 Object.defineProperty(process,'platform',...) 临时改写，每用例 finally 还原。
//
// 隔离：import 前设私有 tmp 的 CCV_LOG_DIR/CLAUDE_CONFIG_DIR/CCV_PROJECT_DIR；fixture 落临时目录；
//   私有 fakeBin 目录在 tmp 内；PATH 在 after() 还原。{concurrency:false}：改 platform / PATH /
//   同一 projectDir，必须串行。
//
// 不可达分支（不为凑数写假断言）：
//   502-505  deleteFile realFull2 二次 realpath 逃逸 —— 需 lstat 与 rmSync 之间 TOCTOU 换链，
//            单进程内无法确定性复现。
//   konsole/xfce4/xterm/xdg-open fallback（openTerminal 761-771）—— loop 的 catch{continue} 只
//            在 spawn 同步抛时进入，而缺二进制/不可执行都是 async 错误，gnome-terminal 必先
//            「成功」spawn → launched=true → break，单进程内造不出同步 spawn 失败让其 fall-through。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync,
  chmodSync, lstatSync, existsSync, readFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-files-fs-'));
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
function callBody(handler, body, { deps = baseDeps(), parsedUrl = { searchParams: new URLSearchParams() }, isLocal = true } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = {};
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

const origPlatform = process.platform;
function setPlatform(p) { Object.defineProperty(process, 'platform', { value: p, configurable: true }); }
function restorePlatform() { Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true }); }

// 短暂等待 detached spawn 的 async 'error'/'exit' 落地（stub 立刻 exit 0，无错误），让 unref 子进程
// 在用例窗口内安静收尾，避免事件溢到下一个用例。
function settle(ms = 120) { return new Promise((r) => setTimeout(r, ms)); }

// 平台命令 stub 目录：放同名可执行脚本（exit 0），prepend 到 PATH，避免真实 GUI / async ENOENT。
const fakeBin = join(tmpDir, 'fakebin');
const origPath = process.env.PATH;
const STUB_NAMES = ['open', 'explorer.exe', 'cmd.exe', 'gnome-terminal', 'konsole', 'xterm', 'xdg-open'];

// explorer.exe 单独用捕获 stub：把 argv 写进文件供断言 /select,"<path>" 规范形式
// （POSIX 下 windowsVerbatimArguments 被忽略，argv 即字面值，含字面双引号）。
// 其余 stub 保持纯 exit 0，不动既有用例语义。
const explorerCapture = join(tmpDir, 'explorer-args.txt');

// 轮询等待 detached spawn 的捕获文件落地（固定 settle 有 race）
async function waitForFile(p, timeoutMs = 3000) {
  const start = Date.now();
  while (!existsSync(p)) {
    if (Date.now() - start > timeoutMs) throw new Error(`capture file not written: ${p}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  mkdirSync(fakeBin, { recursive: true });
  for (const n of STUB_NAMES) {
    const p = join(fakeBin, n);
    if (n === 'explorer.exe') {
      writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > '${explorerCapture}'\nexit 0\n`);
    } else {
      writeFileSync(p, '#!/bin/sh\nexit 0\n');
    }
    try { chmodSync(p, 0o755); } catch {}
  }
  process.env.PATH = fakeBin + ':' + origPath;
  const mod = await import('../server/routes/files-fs.js');
  routesByPath = mod.filesFsRoutes;
});

after(() => {
  process.env.PATH = origPath;
  restorePlatform();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const n of readdirSync(projectDir)) {
    try { rmSync(join(projectDir, n), { recursive: true, force: true }); } catch {}
  }
});

describe('files-fs 分支补强', { concurrency: false }, () => {
  // ── browseDir catch（235-237）：isDirectory 通过后 readdirSync 抛 EACCES ────────────
  describe('/api/browse-dir catch', () => {
    it('500 when readdirSync throws after isDirectory passes (chmod 000 dir)', async (t) => {
      const blocked = join(projectDir, 'noread');
      mkdirSync(blocked, { recursive: true });
      try { chmodSync(blocked, 0o000); } catch { t.skip('chmod not effective'); return; }
      // 先确认本机 owner 确实读不了（root / 某些 FS 会绕过 → skip 而非误判）
      let canRead = false;
      try { readdirSync(blocked); canRead = true; } catch { /* expected EACCES */ }
      if (canRead) { try { chmodSync(blocked, 0o755); } catch {} t.skip('filesystem allows owner read of 0000 dir'); return; }
      try {
        const res = await callGet(handlerFor('/api/browse-dir', 'GET'), { path: blocked });
        assert.equal(res.status, 500);
        assert.ok(res.data.error, '500 body carries err.message');
      } finally { try { chmodSync(blocked, 0o755); } catch {} }
    });
  });

  // ── deleteFile：不支持的路径类型 else 臂（510-513）—— FIFO ────────────────────────
  describe('/api/delete-file 不支持类型', () => {
    it('400 Unsupported path type for a FIFO (not symlink/dir/file)', async (t) => {
      const fifo = join(projectDir, 'pipe.fifo');
      try { execFileSync('mkfifo', [fifo]); } catch { t.skip('mkfifo unavailable'); return; }
      // 确认确实造出了 FIFO（既非 symlink/dir/file）
      let st;
      try { st = lstatSync(fifo); } catch { t.skip('cannot stat fifo'); return; }
      if (!st.isFIFO() || st.isSymbolicLink() || st.isDirectory() || st.isFile()) {
        try { rmSync(fifo, { force: true }); } catch {}
        t.skip('not a clean FIFO on this FS'); return;
      }
      try {
        const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'pipe.fifo' });
        assert.equal(res.status, 400);
        assert.equal(res.data.error, 'Unsupported path type');
      } finally { try { rmSync(fifo, { force: true }); } catch {} }
    });
  });

  // ── revealFile：darwin（561）/ win32（563-564）平台臂 + catch（571-573）────────────
  describe('/api/reveal-file 平台臂 + catch', () => {
    it('200 success on darwin branch (execFile open -R via PATH stub, no GUI)', async () => {
      setPlatform('darwin');
      try {
        writeFileSync(join(projectDir, 'rv-d.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 'rv-d.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('200 success on win32 branch, argv 为规范形式 /select,"<path>"（verbatim + 仅路径加引号）', async () => {
      setPlatform('win32');
      try {
        rmSync(explorerCapture, { force: true });
        writeFileSync(join(projectDir, 'rv-w.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 'rv-w.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await waitForFile(explorerCapture);
        const argv = readFileSync(explorerCapture, 'utf-8').trimEnd();
        // POSIX 下 windowsVerbatimArguments 被忽略，stub 收到的 argv[1] 即字面值（含字面双引号）
        assert.equal(argv, `/select,"${join(projectDir, 'rv-w.txt')}"`);
        await settle();
      } finally { restorePlatform(); }
    });

    it('win32 含空格路径同样走规范形式（整体单 arg，路径带引号）', async () => {
      setPlatform('win32');
      try {
        rmSync(explorerCapture, { force: true });
        mkdirSync(join(projectDir, 'My Proj'), { recursive: true });
        writeFileSync(join(projectDir, 'My Proj', 'a b.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 'My Proj/a b.txt' });
        assert.equal(res.status, 200);
        await waitForFile(explorerCapture);
        const argv = readFileSync(explorerCapture, 'utf-8').trimEnd();
        assert.equal(argv, `/select,"${join(projectDir, 'My Proj', 'a b.txt')}"`);
        await settle();
      } finally { restorePlatform(); }
    });

    it('win32 中文路径（含空格）同样走规范形式', async () => {
      setPlatform('win32');
      try {
        rmSync(explorerCapture, { force: true });
        mkdirSync(join(projectDir, '中文目录'), { recursive: true });
        writeFileSync(join(projectDir, '中文目录', '文件 名.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: '中文目录/文件 名.txt' });
        assert.equal(res.status, 200);
        await waitForFile(explorerCapture);
        const argv = readFileSync(explorerCapture, 'utf-8').trimEnd();
        assert.equal(argv, `/select,"${join(projectDir, '中文目录', '文件 名.txt')}"`);
        await settle();
      } finally { restorePlatform(); }
    });

    it('500 when path is a non-string (TypeError before guards)', async () => {
      const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 5 });
      assert.equal(res.status, 500);
      assert.ok(res.data.error && /startsWith/.test(res.data.error));
    });
  });

  // ── openFile：darwin（615）/ win32（617）平台臂 + catch（624-626）──────────────────
  describe('/api/open-file 平台臂 + catch', () => {
    it('200 success on darwin branch (execFile open via PATH stub, no GUI)', async () => {
      setPlatform('darwin');
      try {
        writeFileSync(join(projectDir, 'op-d.txt'), 'x');
        const res = await callBody(handlerFor('/api/open-file', 'POST'), { path: 'op-d.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('200 success on win32 branch (execFile cmd.exe via PATH stub)', async () => {
      setPlatform('win32');
      try {
        writeFileSync(join(projectDir, 'op-w.txt'), 'x');
        const res = await callBody(handlerFor('/api/open-file', 'POST'), { path: 'op-w.txt' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('500 when path is a non-string (TypeError before guards)', async () => {
      const res = await callBody(handlerFor('/api/open-file', 'POST'), { path: 7 });
      assert.equal(res.status, 500);
      assert.ok(res.data.error && /startsWith/.test(res.data.error));
    });
  });

  // ── resolvePath catch（652-654）：path 为数字 → relPath.startsWith TypeError ─────────
  describe('/api/resolve-path catch', () => {
    it('500 when path is a non-string truthy value (TypeError)', async () => {
      const res = await callBody(handlerFor('/api/resolve-path', 'POST'), { path: 42 });
      assert.equal(res.status, 500);
      assert.ok(res.data.error && /startsWith/.test(res.data.error));
    });
  });

  // ── openTerminal：darwin / win32 / linux 三个平台臂（748-775）───────────────────────
  describe('/api/open-terminal 平台臂', () => {
    it('200 on darwin branch (spawn open -a Terminal via PATH stub)', async () => {
      setPlatform('darwin');
      try {
        mkdirSync(join(projectDir, 'wd-d'), { recursive: true });
        const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: 'wd-d' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('200 on win32 branch (spawn cmd.exe via PATH stub)', async () => {
      setPlatform('win32');
      try {
        mkdirSync(join(projectDir, 'wd-w'), { recursive: true });
        const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: 'wd-w' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('200 on linux branch (spawn gnome-terminal via PATH stub, first emulator wins)', async () => {
      setPlatform('linux');
      try {
        mkdirSync(join(projectDir, 'wd-l'), { recursive: true });
        const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: 'wd-l' });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        await settle();
      } finally { restorePlatform(); }
    });

    it('500 catch when path is a non-string（777-779：relDir.startsWith TypeError）', async () => {
      const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: 9 });
      assert.equal(res.status, 500);
      assert.ok(res.data.error && /startsWith/.test(res.data.error));
    });
  });

  // ── `process.env.CCV_PROJECT_DIR || process.cwd()` 的 process.cwd() 臂（12 处）────────
  //   全程其它用例都设了 CCV_PROJECT_DIR，从未走到右侧 process.cwd()。本块临时 unset 该 env
  //   并 chdir 到 projectDir，使 process.cwd() 返回项目目录，逐个 handler 触发其 cwd() 臂。
  describe('process.cwd() fallback 臂（CCV_PROJECT_DIR 未设）', () => {
    const origCwd = process.cwd();
    let savedProjEnv;
    before(() => {
      savedProjEnv = process.env.CCV_PROJECT_DIR;
      delete process.env.CCV_PROJECT_DIR;
      process.chdir(projectDir);
    });
    after(() => {
      process.chdir(origCwd);
      process.env.CCV_PROJECT_DIR = savedProjEnv;
    });

    it('files 列目录（248 cwd 臂）', async () => {
      writeFileSync(join(projectDir, 'cf.txt'), 'x');
      const res = await callBody(handlerFor('/api/files', 'GET'), undefined, { parsedUrl: { searchParams: new URLSearchParams({ path: '.' }) } });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data));
    });

    it('resolve-path（647 cwd 臂）', async () => {
      const res = await callBody(handlerFor('/api/resolve-path', 'POST'), { path: 'x.txt' });
      assert.equal(res.status, 200);
      assert.ok(res.data.fullPath);
    });

    it('rename-file（321 cwd 臂）', async () => {
      writeFileSync(join(projectDir, 'rn-old.txt'), 'x');
      const res = await callBody(handlerFor('/api/rename-file', 'POST'), { oldPath: 'rn-old.txt', newName: 'rn-new.txt' });
      assert.equal(res.status, 200);
    });

    it('move-file（371 cwd 臂）', async () => {
      writeFileSync(join(projectDir, 'mv-s.txt'), 'x');
      mkdirSync(join(projectDir, 'mv-dst'), { recursive: true });
      const res = await callBody(handlerFor('/api/move-file', 'POST'), { fromPath: 'mv-s.txt', toDir: 'mv-dst' });
      assert.equal(res.status, 200);
    });

    it('delete-file（467 cwd 臂）', async () => {
      writeFileSync(join(projectDir, 'dl.txt'), 'x');
      const res = await callBody(handlerFor('/api/delete-file', 'POST'), { path: 'dl.txt' });
      assert.equal(res.status, 200);
    });

    it('create-file（686 cwd 臂）', async () => {
      const res = await callBody(handlerFor('/api/create-file', 'POST'), { name: 'cwd-new.txt' });
      assert.equal(res.status, 200);
    });

    it('create-dir（811 cwd 臂）', async () => {
      const res = await callBody(handlerFor('/api/create-dir', 'POST'), { name: 'cwd-new-dir' });
      assert.equal(res.status, 200);
    });

    it('reveal-file linux（545 cwd 臂）', async () => {
      setPlatform('linux');
      try {
        writeFileSync(join(projectDir, 'rvc.txt'), 'x');
        const res = await callBody(handlerFor('/api/reveal-file', 'POST'), { path: 'rvc.txt' });
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-file linux（599 cwd 臂）', async () => {
      setPlatform('linux');
      try {
        writeFileSync(join(projectDir, 'opc.txt'), 'x');
        const res = await callBody(handlerFor('/api/open-file', 'POST'), { path: 'opc.txt' });
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-terminal linux（734 cwd 臂）', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: '' });
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-project-dir linux（860 cwd 臂）', async () => {
      setPlatform('linux');
      try {
        const res = await callBody(handlerFor('/api/open-project-dir', 'POST'), {});
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('import-file（144 cwd 臂）', async () => {
      const boundary = 'CWDB';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="imp-cwd.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const buf = Buffer.concat([head, Buffer.from('hi'), tail]);
      const res = await new Promise((resolve) => {
        const req = new EventEmitter();
        req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) };
        req.url = '/api/import-file?dir=';
        req.destroy = () => { req.emit('close'); };
        let status = 0; let raw = '';
        const res2 = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
        handlerFor('/api/import-file', 'POST')(req, res2, { searchParams: new URLSearchParams() }, true, baseDeps());
        req.emit('data', buf);
        req.emit('end');
      });
      assert.equal(res.status, 200);
    });
  });

  // ── 其它默认/三元臂：upload win32 臂、_projectName||default、import 空 dir/无扩展名、
  //    browseDir 无 path → homedir、files 无 path → '.'、create*/open* 的 relDir 空臂、
  //    openLogDir/ProfileDir 的 darwin/win32 三元臂 ──────────────────────────────────────
  describe('其它默认/三元臂', () => {
    it('upload win32 臂（72：uploadDir 用 os.tmpdir/cc-viewer-uploads）+ _projectName||default', async () => {
      setPlatform('win32');
      const savedName = process.env._CCV_TEST_NOOP; // 占位，避免 lint 误删
      void savedName;
      try {
        const boundary = 'UPB';
        const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="pic.png"\r\nContent-Type: image/png\r\n\r\n`);
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
        const buf = Buffer.concat([head, Buffer.from('PNGDATA'), tail]);
        const res = await new Promise((resolve) => {
          const req = new EventEmitter();
          req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) };
          req.url = '/api/upload';
          req.destroy = () => { req.emit('close'); };
          let status = 0; let raw = '';
          const res2 = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
          handlerFor('/api/upload', 'POST')(req, res2, { searchParams: new URLSearchParams() }, true, baseDeps());
          req.emit('data', buf);
          req.emit('end');
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.path && res.data.path.includes('cc-viewer-uploads'));
      } finally { restorePlatform(); }
    });

    it('upload 无扩展名文件（77-80：dotIdx<=0 → `${name}-${ts}`）', async () => {
      const boundary = 'UPN';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="noext"\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const buf = Buffer.concat([head, Buffer.from('D'), tail]);
      const res = await new Promise((resolve) => {
        const req = new EventEmitter();
        req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) };
        req.url = '/api/upload';
        req.destroy = () => { req.emit('close'); };
        let status = 0; let raw = '';
        const res2 = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
        handlerFor('/api/upload', 'POST')(req, res2, { searchParams: new URLSearchParams() }, true, baseDeps());
        req.emit('data', buf);
        req.emit('end');
      });
      assert.equal(res.status, 200);
      assert.ok(/noext-\d+$/.test(res.data.path));
    });

    it('import-file 无扩展名 + 非空 dir（175-176 空 ext 臂 + 198 dir 真臂）', async () => {
      mkdirSync(join(projectDir, 'impd'), { recursive: true });
      const boundary = 'IMN';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plain"\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const buf = Buffer.concat([head, Buffer.from('z'), tail]);
      const res = await new Promise((resolve) => {
        const req = new EventEmitter();
        req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) };
        req.url = '/api/import-file?dir=impd';
        req.destroy = () => { req.emit('close'); };
        let status = 0; let raw = '';
        const res2 = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
        handlerFor('/api/import-file', 'POST')(req, res2, { searchParams: new URLSearchParams() }, true, baseDeps());
        req.emit('data', buf);
        req.emit('end');
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.relPath, 'impd/plain');
    });

    it('browse-dir 无 path → homedir() 默认臂（211）', async () => {
      const res = await callGet(handlerFor('/api/browse-dir', 'GET'), {});
      // homedir 必为目录 → 200，且 current 为 homedir
      assert.equal(res.status, 200);
      assert.ok(res.data.current);
    });

    it('files 无 path → "." 默认臂（241）', async () => {
      const res = await callBody(handlerFor('/api/files', 'GET'), undefined, { parsedUrl: { searchParams: new URLSearchParams() } });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data));
    });

    it('files git-ignore 目录(trailing /)与嵌套路径臂（283 line.endsWith / 284 name.includes("/")）', async () => {
      mkdirSync(join(projectDir, 'gi'), { recursive: true });
      mkdirSync(join(projectDir, 'gi', 'builddir'), { recursive: true });
      writeFileSync(join(projectDir, 'gi', 'keep.txt'), 'x');
      // execWithStdin 返回：目录条目带尾斜杠（命中 283 ? 臂）；嵌套路径含 '/'（命中 284 ? 臂）
      const deps = baseDeps({ execWithStdin: async () => 'gi/builddir/\nnested/keep.txt\n' });
      const res = await callBody(handlerFor('/api/files', 'GET'), undefined, {
        parsedUrl: { searchParams: new URLSearchParams({ path: 'gi' }) }, deps,
      });
      assert.equal(res.status, 200);
      const bd = res.data.find(i => i.name === 'builddir');
      const kp = res.data.find(i => i.name === 'keep.txt');
      assert.equal(bd && bd.gitIgnored, true, 'trailing-slash dir → baseName builddir 标记 ignored');
      assert.equal(kp && kp.gitIgnored, true, 'nested path → basename keep.txt 标记 ignored');
    });

    it('browse-dir 根目录 parent===self → parent:null 臂（233）', async () => {
      const res = await callGet(handlerFor('/api/browse-dir', 'GET'), { path: '/' });
      assert.equal(res.status, 200);
      assert.equal(res.data.parent, null, 'filesystem root has no parent');
    });

    it('files 子目录 + symlink-to-dir（259-263 symlink 臂 + 274 reqPath!=="." 臂）', async (t) => {
      const sub = join(projectDir, 'sd');
      mkdirSync(sub, { recursive: true });
      mkdirSync(join(sub, 'real'), { recursive: true });
      writeFileSync(join(sub, 'f.txt'), 'x');
      try {
        const { symlinkSync } = await import('node:fs');
        symlinkSync(join(sub, 'real'), join(sub, 'lnk'), 'dir');
      } catch { /* symlink 不可用也无妨，仍覆盖 reqPath 子目录臂 */ }
      const res = await callBody(handlerFor('/api/files', 'GET'), undefined, { parsedUrl: { searchParams: new URLSearchParams({ path: 'sd' }) } });
      assert.equal(res.status, 200);
      const names = res.data.map(i => i.name);
      assert.ok(names.includes('f.txt'));
    });

    it('rename-file 嵌套 oldPath（338 includes("/") 真臂）', async () => {
      mkdirSync(join(projectDir, 'rnsub'), { recursive: true });
      writeFileSync(join(projectDir, 'rnsub', 'a.txt'), 'x');
      const res = await callBody(handlerFor('/api/rename-file', 'POST'), { oldPath: 'rnsub/a.txt', newName: 'b.txt' });
      assert.equal(res.status, 200);
      assert.equal(res.data.newPath, 'rnsub/b.txt');
    });

    it('create-file 带 dirPath（687 relDir 真臂 + 707 relPath 真臂）', async () => {
      mkdirSync(join(projectDir, 'cfd'), { recursive: true });
      const res = await callBody(handlerFor('/api/create-file', 'POST'), { dirPath: 'cfd', name: 'n.txt' });
      assert.equal(res.status, 200);
      assert.equal(res.data.path, 'cfd/n.txt');
    });

    it('create-dir 带 dirPath（812 relDir 真臂 + 832 relPath 真臂）', async () => {
      mkdirSync(join(projectDir, 'cdd'), { recursive: true });
      const res = await callBody(handlerFor('/api/create-dir', 'POST'), { dirPath: 'cdd', name: 'sub' });
      assert.equal(res.status, 200);
      assert.equal(res.data.path, 'cdd/sub');
    });

    it('open-terminal 带 relDir（735 relDir 真臂）linux', async () => {
      setPlatform('linux');
      try {
        mkdirSync(join(projectDir, 'otd'), { recursive: true });
        const res = await callBody(handlerFor('/api/open-terminal', 'POST'), { path: 'otd' });
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('resolve-path 空 path（648 cwd 臂：relPath 假 → fullPath=cwd）', async () => {
      const res = await callBody(handlerFor('/api/resolve-path', 'POST'), {});
      assert.equal(res.status, 200);
      assert.equal(res.data.fullPath, projectDir);
    });

    it('resolve-path 带 relPath（648 join 真臂）', async () => {
      const res = await callBody(handlerFor('/api/resolve-path', 'POST'), { path: 'deep/x' });
      assert.equal(res.status, 200);
      assert.ok(res.data.fullPath.endsWith(join('deep', 'x')));
    });

    it('open-log-dir darwin 臂（844 三元 darwin）', async () => {
      setPlatform('darwin');
      try {
        const res = await callBody(handlerFor('/api/open-log-dir', 'POST'), {});
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-log-dir win32 臂（844 三元 win32）', async () => {
      setPlatform('win32');
      try {
        const res = await callBody(handlerFor('/api/open-log-dir', 'POST'), {});
        assert.equal(res.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-profile-dir darwin/win32 臂（853 三元）+ mkdir 已存在臂', async () => {
      setPlatform('darwin');
      try {
        const r1 = await callBody(handlerFor('/api/open-profile-dir', 'POST'), {});
        assert.equal(r1.status, 200);
        await settle();
      } finally { restorePlatform(); }
      setPlatform('win32');
      try {
        const r2 = await callBody(handlerFor('/api/open-profile-dir', 'POST'), {});
        assert.equal(r2.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });

    it('open-project-dir darwin/win32 臂（861 三元）', async () => {
      setPlatform('darwin');
      try {
        const r1 = await callBody(handlerFor('/api/open-project-dir', 'POST'), {});
        assert.equal(r1.status, 200);
        await settle();
      } finally { restorePlatform(); }
      setPlatform('win32');
      try {
        const r2 = await callBody(handlerFor('/api/open-project-dir', 'POST'), {});
        assert.equal(r2.status, 200);
        await settle();
      } finally { restorePlatform(); }
    });
  });

  // ── MAX_POST_BODY 超限 → req.destroy() 臂（11 个 body-reading handler 共用同模式）──────
  //   handler: req.on('data', c => { body+=c; if (body.length > deps.MAX_POST_BODY) req.destroy(); })
  //   设极小 MAX_POST_BODY，emit 超长 chunk 命中 destroy 臂；随后 emit end 触发 JSON.parse(超长非法体)
  //   → 大多落 'Invalid request body' 400（editor-open/done 落 catch 400），断言松（只验 destroy 臂被走）。
  describe('MAX_POST_BODY 超限 destroy 臂', () => {
    const tinyDeps = (extra = {}) => baseDeps({ MAX_POST_BODY: 4, editorSessions: new Map(), ...extra });
    const oversized = 'X'.repeat(64); // > 4 字节

    function callOversized(handler, deps) {
      return new Promise((resolve) => {
        const req = new EventEmitter();
        req.headers = {};
        let destroyed = false;
        req.destroy = () => { destroyed = true; req.emit('close'); };
        let status = 0; let raw = '';
        const res = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d, destroyed }); } };
        handler(req, res, { searchParams: new URLSearchParams() }, true, deps);
        req.emit('data', Buffer.from(oversized));
        req.emit('end');
      });
    }

    const POST_BODY_ROUTES = [
      '/api/rename-file', '/api/move-file', '/api/delete-file', '/api/reveal-file',
      '/api/open-file', '/api/resolve-path', '/api/create-file', '/api/open-terminal',
      '/api/create-dir', '/api/editor-open', '/api/editor-done',
    ];

    for (const rp of POST_BODY_ROUTES) {
      it(`${rp} 超长 body 触发 req.destroy()`, async () => {
        const res = await callOversized(handlerFor(rp, 'POST'), tinyDeps());
        assert.equal(res.destroyed, true, 'data 监听器命中 destroy 臂');
        // 超长非法 JSON → 400（每个 handler 的 invalid body 守卫）
        assert.equal(res.status, 400);
      });
    }
  });

  // ── multipart 边角分支：无 content-type（15/103 `|| ''`）、无闭合 boundary（69/172 `=== -1` 臂）──
  describe('multipart 边角分支', () => {
    function callRawMultipart(handler, { headers, reqUrl, bodyBuf }) {
      return new Promise((resolve) => {
        const req = new EventEmitter();
        req.headers = headers || {};
        req.url = reqUrl;
        req.destroy = () => { req.emit('close'); };
        let status = 0; let raw = '';
        const res = { writeHead(c) { status = c; }, end(b) { raw = b || ''; let d; try { d = JSON.parse(raw); } catch { d = raw; } resolve({ status, data: d }); } };
        handler(req, res, { searchParams: new URLSearchParams() }, true, baseDeps());
        if (bodyBuf) req.emit('data', bodyBuf);
        req.emit('end');
      });
    }

    it('upload 无 content-type header（15 `|| ""` → 无 boundary → 400）', async () => {
      const res = await callRawMultipart(handlerFor('/api/upload', 'POST'), { headers: {}, reqUrl: '/api/upload' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Missing boundary');
    });

    it('import-file 无 content-type header（103 `|| ""` → 无 boundary → 400）', async () => {
      const res = await callRawMultipart(handlerFor('/api/import-file', 'POST'), { headers: {}, reqUrl: '/api/import-file?dir=' });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'Missing boundary');
    });

    it('upload 无闭合 boundary（69 `bodyEnd === -1` → slice 到末尾，仍写盘 200）', async () => {
      const boundary = 'NOCLOSE';
      // 只有开头 boundary + 头 + 正文，没有 \r\n--boundary 闭合段
      const buf = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="nc.png"\r\nContent-Type: image/png\r\n\r\nRAWBODYWITHOUTCLOSE`);
      const res = await callRawMultipart(handlerFor('/api/upload', 'POST'), {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) },
        reqUrl: '/api/upload', bodyBuf: buf,
      });
      assert.equal(res.status, 200);
      assert.ok(res.data.path);
    });

    it('import-file 无闭合 boundary（172 `bodyEnd === -1` → slice 到末尾，200）', async () => {
      mkdirSync(join(projectDir, 'ncimp'), { recursive: true });
      const boundary = 'NOCLOSE2';
      const buf = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="nc2.txt"\r\nContent-Type: application/octet-stream\r\n\r\nRAWNOCLOSE`);
      const res = await callRawMultipart(handlerFor('/api/import-file', 'POST'), {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, host: 'localhost', 'content-length': String(buf.length) },
        reqUrl: '/api/import-file?dir=ncimp', bodyBuf: buf,
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.name, 'nc2.txt');
    });
  });

  // ── files 断链 symlink → statSync 抛 → catch type='file' 臂（261-262）─────────────────
  describe('files 断链 symlink', () => {
    it('broken symlink falls back to type=file（261-262 catch 臂）', async (t) => {
      const { symlinkSync } = await import('node:fs');
      mkdirSync(join(projectDir, 'sl'), { recursive: true });
      try {
        symlinkSync(join(projectDir, 'sl', 'nonexistent-target'), join(projectDir, 'sl', 'broken'), 'file');
      } catch { t.skip('symlink not permitted'); return; }
      const res = await callBody(handlerFor('/api/files', 'GET'), undefined, {
        parsedUrl: { searchParams: new URLSearchParams({ path: 'sl' }) },
      });
      assert.equal(res.status, 200);
      const link = res.data.find(i => i.name === 'broken');
      assert.ok(link);
      assert.equal(link.type, 'file', '断链 symlink 在 statSync 抛后回落 file');
    });
  });
});
