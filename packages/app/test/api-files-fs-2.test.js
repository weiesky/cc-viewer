// 覆盖目标：server/routes/files-fs.js —— OS-open 路由的守卫分支 + editor 协调路由（第二部分）。
//
// 本文件覆盖：
//   /api/reveal-file    （守卫：JSON 错误 / 缺 path / 非法 path / 不存在 404；成功路径真实
//                        execFile('open',...) 会拉起 Finder，记 skipped，只测守卫）
//   /api/open-file      （同上守卫分支）
//   /api/open-terminal  （守卫：JSON 错误 / 非法 path / 目录不存在；成功 spawn 终端记 skipped）
//   /api/editor-open    （缺参 400 / JSON 错误 400 / 正常注册 session + 广播到 terminalWss）
//   /api/editor-status  （缺 id 400 / 已知 session 返回 done / 未知 session 返回 done:true）
//   /api/editor-done    （缺 sessionId 400 / JSON 错误 400 / 标记 done + 延迟清理；用 fake timer 验证清理）
//
// 注：/api/open-log-dir、/api/open-profile-dir、/api/open-project-dir 三个无 body、无守卫、
//   直接 execFile 打开目录的路由会真实拉起 Finder/Explorer，全部记 skipped（task 允许）。
//   reveal/open/open-terminal 的成功分支同理记 skipped。

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-files-fs2-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const projectDir = join(tmpDir, 'project');
mkdirSync(projectDir, { recursive: true });
process.env.CCV_PROJECT_DIR = projectDir;

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

/** GET handler 调用器（editor-status） */
function callGet(handler, searchParams = {}, deps = baseDeps()) {
  let status = 0; let raw = '';
  const res = { writeHead(c) { status = c; }, end(b) { raw = b || ''; } };
  handler({}, res, { searchParams: new URLSearchParams(searchParams) }, true, deps);
  let d; try { d = JSON.parse(raw); } catch { d = raw; }
  return { status, data: d };
}

function baseDeps(extra = {}) {
  return { MAX_POST_BODY: 1024 * 1024, ...extra };
}

before(async () => {
  const mod = await import('../server/routes/files-fs.js');
  routesByPath = mod.filesFsRoutes;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

beforeEach(() => {
  for (const n of readdirSync(projectDir)) rmSync(join(projectDir, n), { recursive: true, force: true });
});

// ───────── 通用守卫断言生成器：所有 *-file 端点共享同一套 path 守卫 ─────────
function sharedPathGuards(routePath) {
  const handler = () => handlerFor(routePath, 'POST');

  it('400 on invalid JSON body', async () => {
    const { status, data } = await callBody(handler(), 'not-json');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when path is missing', async () => {
    const { status, data } = await callBody(handler(), {});
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing path');
  });

  it('400 on absolute path', async () => {
    const { status, data } = await callBody(handler(), { path: '/etc/passwd' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid path');
  });

  it('400 on traversal path', async () => {
    const { status, data } = await callBody(handler(), { path: '../escape' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid path');
  });

  it('404 when file does not exist', async () => {
    const { status, data } = await callBody(handler(), { path: 'no-such.txt' });
    assert.equal(status, 404);
    assert.equal(data.error, 'File not found');
  });

  it('400 when path realpath-escapes cwd via a symlink (before GUI spawn)', async (t) => {
    const outsideDir = join(tmpDir, 'outside-' + routePath.replace(/\W/g, '_'));
    mkdirSync(outsideDir, { recursive: true });
    const secret = join(outsideDir, 'secret.txt');
    writeFileSync(secret, 'top secret');
    try {
      symlinkSync(secret, join(projectDir, 'leaklink'), 'file');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const { status, data } = await callBody(handler(), { path: 'leaklink' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Path traversal not allowed');
  });
}

describe('/api/reveal-file guards', () => {
  sharedPathGuards('/api/reveal-file');
  it.skip('200 success path launches Finder/Explorer (real GUI — skipped)', () => {});
});

describe('/api/open-file guards', () => {
  sharedPathGuards('/api/open-file');
  it.skip('200 success path opens the file in default app (real GUI — skipped)', () => {});
});

// ───────────────────────────── /api/open-terminal ─────────────────────────────
describe('/api/open-terminal guards', () => {
  const handler = () => handlerFor('/api/open-terminal', 'POST');

  it('400 on invalid JSON body', async () => {
    const { status, data } = await callBody(handler(), 'oops');
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 on absolute / traversal path', async () => {
    assert.equal((await callBody(handler(), { path: '/abs' })).data.error, 'Invalid path');
    assert.equal((await callBody(handler(), { path: '../up' })).data.error, 'Invalid path');
  });

  it('400 when directory does not exist', async () => {
    const { status, data } = await callBody(handler(), { path: 'no-dir' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Directory not found');
  });

  it('400 when path points to a file, not a directory', async () => {
    writeFileSync(join(projectDir, 'afile.txt'), 'x');
    const { status, data } = await callBody(handler(), { path: 'afile.txt' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Directory not found');
  });

  it('400 when path realpath-escapes cwd via a symlink (before spawn)', async (t) => {
    const outside = join(tmpDir, 'outside-terminal');
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, join(projectDir, 'termlink'), 'dir');
    } catch {
      t.skip('symlink not permitted');
      return;
    }
    const { status, data } = await callBody(handler(), { path: 'termlink' });
    assert.equal(status, 400);
    assert.equal(data.error, 'Path traversal not allowed');
  });

  it.skip('200 success path spawns a terminal emulator (real spawn — skipped)', () => {});
});

// ───────── open-log-dir / open-profile-dir / open-project-dir：全部真实 execFile，记 skipped ─────────
describe('OS-open directory routes (real execFile — skipped)', () => {
  it.skip('/api/open-log-dir opens the log directory in the file manager', () => {});
  it.skip('/api/open-profile-dir opens the profile directory', () => {});
  it.skip('/api/open-project-dir opens the project directory', () => {});
});

// ───────────────────────────── /api/editor-open ─────────────────────────────
describe('/api/editor-open', () => {
  const handler = () => handlerFor('/api/editor-open', 'POST');

  it('400 on invalid JSON body', async () => {
    const sessions = new Map();
    const { status, data } = await callBody(handler(), '{bad', { deps: baseDeps({ editorSessions: sessions }) });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when sessionId or filePath missing', async () => {
    const sessions = new Map();
    const r1 = await callBody(handler(), { sessionId: 's1' }, { deps: baseDeps({ editorSessions: sessions }) });
    assert.equal(r1.status, 400);
    assert.equal(r1.data.error, 'Missing sessionId or filePath');
    const r2 = await callBody(handler(), { filePath: '/x' }, { deps: baseDeps({ editorSessions: sessions }) });
    assert.equal(r2.status, 400);
  });

  it('200 registers an editor session', async () => {
    const sessions = new Map();
    const { status, data } = await callBody(handler(), { sessionId: 'sess-1', filePath: '/some/file.txt' }, {
      deps: baseDeps({ editorSessions: sessions }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    const rec = sessions.get('sess-1');
    assert.ok(rec);
    assert.equal(rec.filePath, '/some/file.txt');
    assert.equal(rec.done, false);
    assert.equal(typeof rec.createdAt, 'number');
  });

  it('200 broadcasts editor-open to ready terminal WS clients only', async () => {
    const sessions = new Map();
    const sent = [];
    const mkClient = (readyState) => ({ readyState, send(m) { sent.push({ readyState, m }); } });
    const terminalWss = {
      clients: new Set([
        mkClient(1), // OPEN — should receive
        mkClient(0), // CONNECTING — should be skipped
        mkClient(3), // CLOSED — skipped
      ]),
    };
    const { status } = await callBody(handler(), { sessionId: 's2', filePath: '/p/q.js' }, {
      deps: baseDeps({ editorSessions: sessions, terminalWss }),
    });
    assert.equal(status, 200);
    assert.equal(sent.length, 1, 'only the OPEN client gets the broadcast');
    const payload = JSON.parse(sent[0].m);
    assert.deepEqual(payload, { type: 'editor-open', sessionId: 's2', filePath: '/p/q.js' });
  });

  it('200 swallows a throwing client.send and still responds ok', async () => {
    const sessions = new Map();
    const terminalWss = { clients: new Set([{ readyState: 1, send() { throw new Error('socket gone'); } }]) };
    const { status, data } = await callBody(handler(), { sessionId: 's3', filePath: '/a' }, {
      deps: baseDeps({ editorSessions: sessions, terminalWss }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

// ───────────────────────────── /api/editor-status ─────────────────────────────
describe('/api/editor-status', () => {
  const handler = () => handlerFor('/api/editor-status', 'GET');

  it('400 when id is missing', () => {
    const { status, data } = callGet(handler(), {}, baseDeps({ editorSessions: new Map() }));
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing id');
  });

  it('returns done:false for an in-progress session', () => {
    const sessions = new Map([['k', { filePath: '/x', done: false }]]);
    const { status, data } = callGet(handler(), { id: 'k' }, baseDeps({ editorSessions: sessions }));
    assert.equal(status, 200);
    assert.equal(data.done, false);
  });

  it('returns done:true for a finished session', () => {
    const sessions = new Map([['k', { filePath: '/x', done: true }]]);
    const { data } = callGet(handler(), { id: 'k' }, baseDeps({ editorSessions: sessions }));
    assert.equal(data.done, true);
  });

  it('returns done:true for an unknown session id', () => {
    const { data } = callGet(handler(), { id: 'ghost' }, baseDeps({ editorSessions: new Map() }));
    assert.equal(data.done, true);
  });
});

// ───────────────────────────── /api/editor-done ─────────────────────────────
describe('/api/editor-done', () => {
  const handler = () => handlerFor('/api/editor-done', 'POST');

  it('400 on invalid JSON body', async () => {
    const { status, data } = await callBody(handler(), '{nope', { deps: baseDeps({ editorSessions: new Map() }) });
    assert.equal(status, 400);
    assert.equal(data.error, 'Invalid request body');
  });

  it('400 when sessionId missing', async () => {
    const { status, data } = await callBody(handler(), {}, { deps: baseDeps({ editorSessions: new Map() }) });
    assert.equal(status, 400);
    assert.equal(data.error, 'Missing sessionId');
  });

  it('200 marks the session done and schedules cleanup', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sessions = new Map([['done-1', { filePath: '/x', done: false }]]);
    const { status, data } = await callBody(handler(), { sessionId: 'done-1' }, {
      deps: baseDeps({ editorSessions: sessions }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(sessions.get('done-1').done, true, 'session marked done immediately');
    assert.ok(sessions.has('done-1'), 'still present before timer fires');
    // 推进 5s 触发 delete
    t.mock.timers.tick(5000);
    assert.equal(sessions.has('done-1'), false, 'session deleted after 5s');
  });

  it('200 even when sessionId is unknown (no-op cleanup)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sessions = new Map();
    const { status, data } = await callBody(handler(), { sessionId: 'unknown' }, {
      deps: baseDeps({ editorSessions: sessions }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    t.mock.timers.tick(5000); // delete('unknown') is harmless
    assert.equal(sessions.size, 0);
  });
});
