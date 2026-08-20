// 覆盖目标：server/routes/logs.js 的日志管理 handler（按当前工作区状态测，不改源码）。
//   GET  /api/local-logs    localLogs   —— 成功 + 内部错误 500
//   GET  /api/download-log  downloadLog —— 校验/404/format=raw/默认流式/路径越权
//   GET  /api/local-log     localLog    —— 校验/类型/limit 尾部 SSE/全量 SSE/NOT_FOUND
//   POST /api/delete-logs   deleteLogs  —— 空数组/非法 JSON/成功
// 范式：参照 test/api-preferences.test.js —— 任何 import 前先建临时 LOG_DIR 并设 env，
// handler 用 EventEmitter 假 req + 收集型 res 直接调用。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-logs-gap-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const SEP = '\n---\n';
const deps = { MAX_POST_BODY: 1024 * 1024 };

function entry(ts, url = 'https://api.anthropic.com/v1/messages') {
  return JSON.stringify({ timestamp: ts, url, method: 'POST', mainAgent: true, body: { model: 'claude-opus-4-8' } });
}

/** 写日志文件到 <LOG_DIR>/<project>/<filename> */
function writeLog(project, filename, entries) {
  const dir = join(tmpDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), entries.join(SEP) + SEP);
}

/** 构造一个收集 writeHead/write/end 的假 res（同时是 EventEmitter 以支持 stream.pipe）。*/
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.headersSent = false;
  res.writableEnded = false;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; res.headersSent = true; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); res.ended = true; res.writableEnded = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}

function body(res) { return res.chunks.join(''); }
function json(res) { return JSON.parse(body(res)); }

/** GET handler（无 body），返回 Promise<res>，等到 res.end 触发 */
function callGet(handler, parsedUrl) {
  const res = makeRes();
  return new Promise((resolve) => {
    res.on('finish', () => resolve(res));
    Promise.resolve(handler({ headers: {} }, res, parsedUrl, true, deps)).catch(() => resolve(res));
  });
}

/** POST handler（流式 body），返回 Promise<res> */
function callPost(handler, bodyStr, parsedUrl = { searchParams: new URLSearchParams() }) {
  const req = new EventEmitter();
  req.headers = {};
  const res = makeRes();
  return new Promise((resolve) => {
    res.on('finish', () => resolve(res));
    handler(req, res, parsedUrl, true, deps);
    req.emit('data', typeof bodyStr === 'string' ? bodyStr : JSON.stringify(bodyStr));
    req.emit('end');
  });
}

function url(pathname, query = {}) {
  const sp = new URLSearchParams(query);
  return { pathname, searchParams: sp };
}

let routes;
before(async () => {
  const mod = await import('../server/routes/logs.js');
  routes = mod.logsRoutes;
});
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function h(path, method) {
  const r = routes.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

describe('GET /api/local-logs', () => {
  beforeEach(() => {
    for (const n of readdirSync(tmpDir)) {
      if (n !== 'preferences.json') rmSync(join(tmpDir, n), { recursive: true, force: true });
    }
  });

  it('returns grouped v2 sessions with 200 (v1 files are invisible, 1.7.0)', async () => {
    // Legacy v1 files must NOT be listed anymore…
    writeLog('proj', 'proj_20260601_100000.jsonl', [entry('2026-06-01T10:00:00.000Z')]);
    // …only v2 session dirs are.
    const sids = ['aaaa1111-2222-4333-8444-bbbb55550001', 'aaaa1111-2222-4333-8444-bbbb55550002'];
    for (const [i, sid] of sids.entries()) {
      const dir = join(tmpDir, 'proj', 'sessions', sid);
      mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs: `2026-06-0${i + 1}T10:00:00.000Z` }));
      writeFileSync(join(dir, 'journal.jsonl'), [
        JSON.stringify({ ph: 'meta', wireFormat: 2 }),
        JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', ts: `2026-06-0${i + 1}T10:00:00.000Z`, kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', method: 'POST', model: 'm', msgFrom: 0, msgTo: 1, evt: 'snapshot' }),
        JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: `2026-06-0${i + 1}T10:00:01.000Z`, status: 'ok' }),
      ].join('\n') + '\n');
      writeFileSync(join(dir, 'conversations', 'main', 'e0.jsonl'),
        JSON.stringify({ seq: 1, rid: 'r1', t: 'snapshot', msgs: [{ role: 'user', content: [{ type: 'text', text: `prompt ${i}` }] }] }) + '\n');
    }
    const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs'));
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.ok(data.proj, 'has proj group');
    assert.equal(data.proj.length, 2, 'two v2 sessions, zero v1 rows');
    assert.ok(data.proj.every((row) => row.kind === 'v2'));
  });

  // ─── ?project= — view another project's logs (modal project switcher) ──────
  describe('?project=', () => {
    function writeV2Session(project, sid, startTs) {
      const dir = join(tmpDir, project, 'sessions', sid);
      mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs }));
      writeFileSync(join(dir, 'journal.jsonl'), [
        JSON.stringify({ ph: 'meta', wireFormat: 2 }),
        JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', ts: startTs, kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', method: 'POST', model: 'm', msgFrom: 0, msgTo: 1, evt: 'snapshot' }),
        JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok' }),
      ].join('\n') + '\n');
      writeFileSync(join(dir, 'conversations', 'main', 'e0.jsonl'),
        JSON.stringify({ seq: 1, rid: 'r1', t: 'snapshot', msgs: [{ role: 'user', content: [{ type: 'text', text: `${project} prompt` }] }] }) + '\n');
    }

    it('serves the requested project with _allProjects and 200', async () => {
      writeV2Session('proj', 'aaaa1111-2222-4333-8444-bbbb55550001', '2026-06-01T10:00:00.000Z');
      writeV2Session('other', 'bbbb2222-3333-4444-8555-cccc66660002', '2026-06-02T10:00:00.000Z');
      const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', pageSize: '50', project: 'other' }));
      assert.equal(res.statusCode, 200);
      const data = json(res);
      // _currentProject stays the ACTIVE project ('' in this test — no workspace
      // bound); the VIEWED project is reported separately via _viewedProject.
      // Pinning this prevents "viewing A" from leaking into global currentProject.
      assert.equal(data._currentProject, '');
      assert.equal(data._viewedProject, 'other');
      assert.ok(Array.isArray(data.items), 'paginated shape');
      assert.equal(data.items.length, 1);
      assert.ok(data.items[0].file.startsWith('v2:other/'), 'only other project rows');
      assert.ok(data._allProjects.includes('proj') && data._allProjects.includes('other'), '_allProjects lists both');
      assert.deepEqual([...data._allProjects].sort(), data._allProjects, '_allProjects sorted');
    });

    it('400 on path traversal project=..', async () => {
      const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', project: '..' }));
      assert.equal(res.statusCode, 400);
      assert.equal(json(res).error, 'Invalid project name');
    });

    it('400 on project containing a separator (a/b)', async () => {
      // sanitizePathComponent maps '/' → '_' so the strict compare rejects it.
      const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', project: 'a/b' }));
      assert.equal(res.statusCode, 400);
      assert.equal(json(res).error, 'Invalid project name');
    });

    it('nonexistent project → 200 with empty page', async () => {
      const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', project: 'nonexistent' }));
      assert.equal(res.statusCode, 200);
      const data = json(res);
      assert.equal(data.items.length, 0);
      assert.equal(data.total, 0);
      assert.ok(Array.isArray(data._allProjects));
    });

    it('page/pageSize are clamped: 0/negative/garbage fall back to sane bounds', async () => {
      writeV2Session('proj', 'aaaa1111-2222-4333-8444-bbbb55550001', '2026-06-01T10:00:00.000Z');
      // page=0 / page=-1 / page=abc → all treated as page 1.
      for (const p of ['0', '-1', 'abc']) {
        const res = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: p, project: 'proj' }));
        assert.equal(res.statusCode, 200, `page=${p} still 200`);
        assert.equal(json(res).page, 1, `page=${p} clamps to 1`);
      }
      // pageSize: 0/garbage both fall to the 50 default (parseInt → 0/NaN are
      // falsy → `|| 50`); pageSize=9999 clamps to the 200 cap.
      const s0 = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', pageSize: '0', project: 'proj' }));
      assert.equal(json(s0).pageSize, 50, 'pageSize=0 falls back to default 50');
      const sBad = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', pageSize: 'abc', project: 'proj' }));
      assert.equal(json(sBad).pageSize, 50, 'pageSize=abc falls back to default 50');
      const sBig = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', pageSize: '9999', project: 'proj' }));
      assert.equal(json(sBig).pageSize, 200, 'pageSize=9999 clamps to cap 200');
    });

    it('missing/empty ?project falls back to the active project (no 400)', async () => {
      writeV2Session('proj', 'aaaa1111-2222-4333-8444-bbbb55550001', '2026-06-01T10:00:00.000Z');
      // No project param at all → active project (='' here), 200, _viewedProject=''.
      const noParam = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1' }));
      assert.equal(noParam.statusCode, 200);
      assert.equal(json(noParam)._currentProject, '');
      assert.equal(json(noParam)._viewedProject, '');
      // Empty project= → same fallback (empty string is falsy → skipped), not 400.
      const emptyParam = await callGet(h('/api/local-logs', 'GET'), url('/api/local-logs', { page: '1', project: '' }));
      assert.equal(emptyParam.statusCode, 200);
    });
  });
});

describe('GET /api/download-log', () => {
  beforeEach(() => {
    writeLog('dl', 'dl_20260601_100000.jsonl', [entry('2026-06-01T10:00:00.000Z'), entry('2026-06-01T10:01:00.000Z')]);
  });

  it('400 on missing file param', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log'));
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid file name');
  });

  it('400 on path traversal (..)', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: '../evil.jsonl' }));
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid file name');
  });

  it('400 on disallowed extension', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: 'dl/config.json' }));
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid file type');
  });

  it('400 for legacy .jsonl.zip archives (zip read support removed 2026-07-14)', async () => {
    // 行为变更 pin（history.md 承诺）：遗留归档既不可下载也不可打开，干净 400 而非 500。
    const dir = join(tmpDir, 'dl');
    writeFileSync(join(dir, 'dl_20260603_100000.jsonl.zip'), 'legacy zip bytes');
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: 'dl/dl_20260603_100000.jsonl.zip' }));
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid file type');
    const open = await callGet(h('/api/local-log', 'GET'), url('/api/local-log', { file: 'dl/dl_20260603_100000.jsonl.zip' }));
    assert.equal(open.statusCode, 400);
  });

  it('404 when file does not exist', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: 'dl/missing.jsonl' }));
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error, 'File not found');
  });

  it('format=raw streams original bytes with octet-stream + Content-Length', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: 'dl/dl_20260601_100000.jsonl', format: 'raw' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/octet-stream');
    assert.ok(res.headers['Content-Length'] > 0, 'Content-Length present');
    assert.match(res.headers['Content-Disposition'], /dl_20260601_100000\.jsonl/);
    // raw 透传原始内容（含 separator）
    assert.match(body(res), /api\.anthropic\.com/);
  });

  it('default (non-raw) streams chunked rebuilt entries', async () => {
    const res = await callGet(h('/api/download-log', 'GET'), url('/api/download-log', { file: 'dl/dl_20260601_100000.jsonl' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Transfer-Encoding'], 'chunked');
    // 流式输出包含 \n---\n 分隔
    assert.match(body(res), /\n---\n/);
    assert.ok(res.ended);
  });
});

describe('GET /api/local-log (independent SSE stream)', () => {
  beforeEach(() => {
    writeLog('sse', 'sse_20260601_100000.jsonl', [
      entry('2026-06-01T10:00:00.000Z'),
      entry('2026-06-01T10:01:00.000Z'),
      entry('2026-06-01T10:02:00.000Z'),
    ]);
  });

  it('400 on missing file', async () => {
    const res = await callGet(h('/api/local-log', 'GET'), url('/api/local-log'));
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid file name');
  });

  it('400 on bad extension', async () => {
    const res = await callGet(h('/api/local-log', 'GET'), url('/api/local-log', { file: 'sse/x.txt' }));
    assert.equal(res.statusCode, 400);
    assert.match(json(res).error, /Only \.jsonl/);
  });

  it('404 (NOT_FOUND) for missing existing file via validateLogPath', async () => {
    const res = await callGet(h('/api/local-log', 'GET'), url('/api/local-log', { file: 'sse/missing.jsonl' }));
    assert.equal(res.statusCode, 404);
  });

  it('full mode (no limit): emits load_start + load_chunk*3 + load_end', async () => {
    const res = await callGet(h('/api/local-log', 'GET'), url('/api/local-log', { file: 'sse/sse_20260601_100000.jsonl' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    const out = body(res);
    assert.match(out, /event: load_start\ndata: /);
    const chunks = out.split('event: load_chunk').length - 1;
    assert.equal(chunks, 3, '3 条各一个 load_chunk');
    assert.match(out, /event: load_end\ndata: \{\}/);
    // load_start.total 为 3（全量模式走 countLogEntries）
    const ls = JSON.parse(out.match(/event: load_start\ndata: (\{.*?\})\n\n/)[1]);
    assert.equal(ls.total, 3);
    assert.equal(ls.incremental, false);
  });

  it('tail mode (limit>0): load_start carries hasMore/oldestTs, skips count', async () => {
    const res = await callGet(h('/api/local-log', 'GET'), url('/api/local-log', { file: 'sse/sse_20260601_100000.jsonl', limit: '2' }));
    assert.equal(res.statusCode, 200);
    const out = body(res);
    const ls = JSON.parse(out.match(/event: load_start\ndata: (\{.*?\})\n\n/)[1]);
    assert.equal(ls.incremental, false);
    assert.ok('hasMore' in ls, 'tail mode load_start has hasMore');
    assert.ok('oldestTs' in ls, 'tail mode load_start has oldestTs');
    assert.match(out, /event: load_end/);
  });
});

describe('POST /api/delete-logs', () => {
  beforeEach(() => {
    writeLog('del', 'del_20260601_100000.jsonl', [entry('2026-06-01T10:00:00.000Z')]);
  });

  it('400 when files is empty array', async () => {
    const res = await callPost(h('/api/delete-logs', 'POST'), { files: [] });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'No files specified');
  });

  it('400 when files missing (not an array)', async () => {
    const res = await callPost(h('/api/delete-logs', 'POST'), { foo: 1 });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'No files specified');
  });

  it('400 on invalid JSON body', async () => {
    const res = await callPost(h('/api/delete-logs', 'POST'), '{bad json');
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid JSON');
  });

  it('200 with per-file results on valid delete (soft delete: moved, not unlinked)', async () => {
    const res = await callPost(h('/api/delete-logs', 'POST'), { files: ['del/del_20260601_100000.jsonl'] });
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.ok(Array.isArray(data.results));
    assert.equal(data.results[0].ok, true);
    // 1.7.0 result shape: movedTo points into removed-<YYYYMMDD>/ and the bytes survive there.
    assert.match(data.results[0].movedTo, /removed-\d{8}[/\\]del_20260601_100000\.jsonl$/);
    assert.equal(existsSync(data.results[0].movedTo), true, 'soft delete keeps the file');
    assert.equal(existsSync(join(tmpDir, 'del', 'del_20260601_100000.jsonl')), false);
  });

  it('per-file error (not HTTP error) for a nonexistent v2 ref', async () => {
    const res = await callPost(h('/api/delete-logs', 'POST'), { files: ['v2:del/aaaa1111-2222-4333-8444-bbbb55550001'] });
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.equal(data.results[0].ok, undefined);
    assert.equal(data.results[0].error, 'Not found');
  });
});
