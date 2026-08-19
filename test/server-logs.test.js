// ████ 文件内显式隔离(第六层闸) — ESM 静态 import 会被提升(hoist) ████
// LOG_DIR 在 ../findcc.js 加载时即固化:projectDir=join(LOG_DIR,...) 会被 mkdirSync/rmSync。
// 若先静态 import findcc 再赋 env,LOG_DIR 落到真实 ~/.claude/cc-viewer,误伤用户数据
// (2026-06-06 事故同源)。必须:node: 内置静态 import → 隔离段锁 env → 动态 import 项目模块。
// 私有端口窗 19750-19759 避免与默认窗 / 其它 server-* 测试跨进程抢端口。禁止改回静态 import。
import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rmSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 隔离段:务必早于任何项目模块 import ──
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-srvlogs-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;
// 1.7.0: v2 is unconditional; stale soak-shell exports must not confuse a
// reader into thinking they still matter (they are ignored).
delete process.env.CCV_WIRE_V2_READ;
delete process.env.CCV_WIRE_V2;
process.env.CCV_START_PORT = '19750';
process.env.CCV_MAX_PORT = '19759';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// 隔离段之后才动态 import(此时 LOG_DIR 已固化到 __isoDir)
const { LOG_DIR } = await import('../packages/app/findcc.js');

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

describeCli('server local logs endpoints', { concurrency: false }, () => {
  let startViewer, stopViewer, getPort;
  let port;
  const projectName = `projX_${Date.now()}`;
  const fileName = `${projectName}_20260101_120000.jsonl`;
  const fileRel = `${projectName}/${fileName}`;
  const projectDir = join(LOG_DIR, projectName);

  // 1.7.0: the list endpoint serves v2 sessions; hand-written session fixture
  // (same line shapes the writer produces — pinned by stats/adapter suites).
  const SID = 'aaaa1111-2222-4333-8444-bbbb5555cccc';
  function makeV2Session(sid, { startTs = '2026-01-01T12:00:00.000Z', leader = null } = {}) {
    const dir = join(projectDir, 'sessions', sid);
    mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({
      wireFormat: 2, sessionId: sid, pid: 1, startTs,
      ...(leader && { leader }),
    }));
    writeFileSync(join(dir, 'journal.jsonl'), [
      JSON.stringify({ ph: 'meta', wireFormat: 2 }),
      JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', ts: startTs, kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', method: 'POST', model: 'claude-opus-4-6', msgFrom: 0, msgTo: 1, evt: 'snapshot' }),
      JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok', usage: { in: 1, out: 1 } }),
    ].join('\n') + '\n');
    writeFileSync(join(dir, 'conversations', 'main', 'e0.jsonl'),
      JSON.stringify({ seq: 1, rid: 'r1', t: 'snapshot', msgs: [{ role: 'user', content: [{ type: 'text', text: 'q-first prompt' }] }] }) + '\n');
    writeFileSync(join(dir, 'responses.jsonl'),
      JSON.stringify({ seq: 1, rid: 'r1', body: { content: [{ type: 'text', text: 'a1' }], usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
    return dir;
  }

  before(async () => {
    mkdirSync(projectDir, { recursive: true });
    makeV2Session(SID);
    // 未迁移 v1 文件仍在磁盘上：列表必须无视它（迁移是它唯一的出路），
    // 但 /api/local-log 直连逃生舱仍能读它。
    const entries = [];
    for (let i = 0; i < 10; i++) {
      const ts = `2026-01-01T12:${String(i).padStart(2, '0')}:00Z`;
      entries.push(JSON.stringify({
        timestamp: ts,
        url: '/v1/messages',
        mainAgent: true,
        body: { model: 'claude-opus-4-6', messages: [{ role: 'user', content: `q${i}` }] },
        response: { status: 200, body: { content: [{ type: 'text', text: `a${i}` }] } },
      }));
    }
    writeFileSync(join(projectDir, fileName), entries.join('\n---\n') + '\n---\n');

    const mod = await import('../packages/app/server/server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
  });

  after(() => {
    stopViewer();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('GET /api/local-logs returns grouped v2 sessions (v1 files not in the default view)', async () => {
    const res = await httpRequest(port, '/api/local-logs');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(typeof data._currentProject, 'string');
    assert.ok(Array.isArray(data[projectName]));
    assert.equal(data[projectName].length, 1, 'the unmigrated v1 file must not be listed');
    assert.equal(data[projectName][0].file, `v2:${projectName}/${SID}`);
    assert.equal(data[projectName][0].kind, 'v2');
    assert.equal(data[projectName][0].turns, 1);
    assert.deepEqual(data[projectName][0].preview, ['q-first prompt']);
  });

  it('GET /api/local-logs?view=v1 lists legacy files (incl. legacy pid-prefixed); default view carries _v1FileCount', async () => {
    const pidFile = `999__${projectName}_20260102_130000.jsonl`;
    writeFileSync(join(projectDir, pidFile), '{"timestamp":"2026-01-02T13:00:00Z","url":"/v1/messages"}\n---\n');
    // _v1FileCount / _unmigratedV1Count are CURRENT-project signals — bind the
    // workspace to the fixture project the way a real launch does.
    const { initForWorkspace } = await import('../packages/app/server/interceptor.js');
    initForWorkspace(projectDir, { forceNew: true });
    try {
      const v1 = (await httpRequest(port, '/api/local-logs?view=v1')).json();
      assert.equal(v1._currentProject, projectName);
      assert.ok(Array.isArray(v1[projectName]), 'v1 view groups by project');
      const files = v1[projectName].map((x) => x.file);
      assert.ok(files.includes(fileRel), 'plain v1 file listed');
      assert.ok(files.includes(`${projectName}/${pidFile}`), 'legacy pid-prefixed file listed as-is');
      assert.equal(v1[projectName][0].file, `${projectName}/${pidFile}`, 'newest first');
      assert.ok(v1[projectName].every((x) => typeof x.size === 'number' && x.size > 0));
      assert.ok(!('_unmigratedV1Count' in v1), 'v1 view carries no migration counters');
      assert.ok(!('_v1FileCount' in v1), 'v1 view carries no gating counter');

      // default view: v1 rows absent, but both signals present
      const def = (await httpRequest(port, '/api/local-logs')).json();
      assert.equal(def._v1FileCount, 2, 'v1 files ON DISK gate the v1-view entry');
      assert.equal(typeof def._unmigratedV1Count, 'number');
    } finally {
      rmSync(join(projectDir, pidFile), { force: true });
    }
  });

  it('a converted-but-present v1 file counts in _v1FileCount but not _unmigratedV1Count', async () => {
    // The converter never deletes sources: once every file is marked done AT
    // ITS CURRENT SIZE, the migrate signals go to zero while the v1-view entry
    // must stay reachable so the leftovers can still be viewed/deleted.
    const { initForWorkspace } = await import('../packages/app/server/interceptor.js');
    const { listV1Files } = await import('../packages/app/server/lib/v2/convert.js');
    const { statSync } = await import('node:fs');
    const { _invalidate: invalidateMig } = await import('../packages/app/server/lib/v2/migrate-prompt.js');
    initForWorkspace(projectDir, { forceNew: true });
    const files = listV1Files(projectDir).map((name) => ({
      name, size: statSync(join(projectDir, name)).size, done: true,
    }));
    assert.ok(files.length >= 1, 'fixture has a v1 file on disk');
    writeFileSync(join(projectDir, 'wire-v2-convert-state.json'),
      JSON.stringify({ version: 1, status: 'done', files }));
    // The TTL memo may hold a stale result from the previous test's HTTP call
    // — drop it so this test sees the freshly-written convert state.
    invalidateMig();
    try {
      const def = (await httpRequest(port, '/api/local-logs')).json();
      assert.equal(def._v1FileCount, files.length, 'converter never deletes sources — entry link stays');
      assert.equal(def._unmigratedV1Count, 0, 'fully-converted files are no longer pending');
    } finally {
      rmSync(join(projectDir, 'wire-v2-convert-state.json'), { force: true });
      invalidateMig(); // don't let the done-state memo leak into the next test
    }
  });

  it('GET /api/local-logs lists every session of the project (no instance filtering)', async () => {
    const SID_2 = 'bbbb2222-3333-4444-8555-cccc6666dddd';
    // Sessions written by an old build may still carry meta.instanceId — the
    // list must include them all the same (the instance concept is gone).
    const dir = makeV2Session(SID_2, { startTs: '2026-01-05T12:00:00.000Z' });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({
      wireFormat: 2, sessionId: SID_2, pid: 1, startTs: '2026-01-05T12:00:00.000Z', instanceId: '999',
    }));
    try {
      const data = (await httpRequest(port, '/api/local-logs')).json();
      assert.equal(data[projectName].length, 2, 'all sessions listed regardless of legacy instanceId');
      assert.equal(data[projectName][0].file, `v2:${projectName}/${SID_2}`, 'newest first');
      assert.ok(!('instanceId' in data[projectName][0]), 'instanceId is no longer emitted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GET /api/local-log serves v2 addressing unconditionally; unknown session is 404', async () => {
    const ok = await httpRequest(port, `/api/local-log?file=${encodeURIComponent(`v2:${projectName}/${SID}`)}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'text/event-stream');
    assert.ok(ok.body.includes('q-first prompt'), 'adapter-synthesized entry served');
    const missing = await httpRequest(port, '/api/local-log?file=v2:projX/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404);
  });

  it('GET /api/download-log serves the rebuilt v2 stream; raw is the session zip (S6a)', async () => {
    const dl = await httpRequest(port, `/api/download-log?file=${encodeURIComponent(`v2:${projectName}/${SID}`)}`);
    assert.equal(dl.status, 200);
    assert.ok(dl.body.includes('q-first prompt'));
    const raw = await httpRequest(port, `/api/download-log?file=${encodeURIComponent(`v2:${projectName}/${SID}`)}&format=raw`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers['content-type'], 'application/zip');
    assert.ok(raw.body.startsWith('PK'), 'raw body is a zip archive');
  });

  it('GET /api/download-log rejects invalid file name', async () => {
    const res = await httpRequest(port, '/api/download-log?file=../../etc/passwd');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file name'));
  });

  it('GET /api/download-log rejects invalid file type', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/20260101.txt');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file type'));
  });

  it('GET /api/download-log returns 404 when file not found', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/not-exist.jsonl');
    assert.equal(res.status, 404);
  });

  it('GET /api/download-log returns file content for existing log', async () => {
    const res = await httpRequest(port, `/api/download-log?file=${encodeURIComponent(fileRel)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.ok(res.body.includes('2026-01-01T12:00:00Z'));
  });

  it('GET /api/local-log returns SSE event stream with entries', async () => {
    const res = await httpRequest(port, `/api/local-log?file=${encodeURIComponent(fileRel)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream');
    // 验证 SSE 流包含 load_start, load_chunk, load_end 事件
    assert.ok(res.body.includes('event: load_start'), 'Should contain load_start event');
    assert.ok(res.body.includes('event: load_chunk'), 'Should contain load_chunk event');
    assert.ok(res.body.includes('event: load_end'), 'Should contain load_end event');
    assert.ok(res.body.includes('2026-01-01T12:00:00Z'), 'Should contain entry data');
  });

  // 1.7.0 P3: /api/entries/page 已随「加载更早会话」一并移除
  it('GET /api/entries/page no longer exists (history paging removed)', async () => {
    const res = await httpRequest(port, '/api/entries/page?before=2099-01-01T00:00:00Z&limit=5');
    let json = null;
    try { json = res.json(); } catch { /* SPA HTML fallback — route gone */ }
    assert.ok(!json || json.entries === undefined, 'paging endpoint must not answer');
  });


  // ── 1.7.0: the mode switch is gone — the routes must be too ─────────────────
  it('GET/POST /api/wire-v2-mode no longer exist (v2 is unconditional)', async () => {
    // Unrouted GETs fall through to the SPA handler — assert the API shape is
    // gone rather than a status code.
    const get = await httpRequest(port, '/api/wire-v2-mode');
    let getJson = null;
    try { getJson = get.json(); } catch { /* SPA HTML — exactly what we want */ }
    assert.ok(!getJson || getJson.configMode === undefined, 'mode endpoint must not answer');
    const post = await httpRequest(port, '/api/wire-v2-mode', { method: 'POST', body: { mode: 'dual' } });
    assert.notEqual(post.status, 200, 'mode switch must not be persistable anymore');
  });
});
