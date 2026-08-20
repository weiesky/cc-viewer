// Verifies the migration of ask-hook from a single-slot pendingAskHook variable
// to a Map<id, entry> mirroring perm-hook. Before this change, the second concurrent
// AskUserQuestion call would 409-supersede the first one, locking up the next ask
// until the first bridge process timed out.
//
// Workspace mode (used here) does not start the terminal WebSocket server, so we cannot
// inject ws-based answers from the test. Instead, the test asserts the supersede property
// purely via HTTP: when two concurrent POSTs are in flight and the client times out before
// the server responds, neither side should observe a 409 — that status only appears when
// the legacy single-slot path actively cancels the prior request.
import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 文件内显式隔离(第六层闸) — env 必须早于 server.js 动态 import(见 before)████
// server.js 加载时即固化 LOG_DIR / START_PORT / MAX_PORT,且其依赖链(updater 的 CACHE_DIR、
// ensure-hooks、settings)派生自 getClaudeConfigDir()。在 server.js import 之前锁 CCV_LOG_DIR /
// CLAUDE_CONFIG_DIR 到进程私有临时目录,绝不触碰真实 ~/.claude(2026-06-06 事故防再犯)。
// 私有端口窗 19740-19749 避免与默认窗 7008-7049 / 其它 server-* 测试跨进程抢端口。
// 禁止把这些 env 移到 before 之后或改回依赖默认值。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-askhook-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;
process.env.CCV_START_PORT = '19740';
process.env.CCV_MAX_PORT = '19749';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function postAskHook(port, questions, clientTimeoutMs) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ questions });
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = request({
      hostname: '127.0.0.1', port, path: '/api/ask-hook', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => settle({ status: res.statusCode, body: data }));
    });
    req.on('error', (err) => settle({ status: -1, error: err.code || err.message }));
    setTimeout(() => { try { req.destroy(); } catch {} settle({ status: -1, error: 'client-timeout' }); }, clientTimeoutMs);
    req.write(body);
    req.end();
  });
}

describeCli('server ask-hook Map (concurrent asks)', { concurrency: false }, () => {
  let port, stopViewer;

  before(async () => {
    const mod = await import('../server/server.js');
    await mod.startViewer();
    port = mod.getPort();
    stopViewer = mod.stopViewer;
    assert.ok(port > 0);
  });

  after(() => { try { stopViewer(); } catch {} });

  it('two concurrent /api/ask-hook posts both stay long-pending — no 409 supersede', async () => {
    // Stagger POSTs by ~50ms so the second one definitively arrives after the first is parked.
    // Both clients abort at 800ms; if the legacy single-slot bug were still present, the first
    // POST would receive HTTP 409 within a few ms of the second arriving.
    const q1 = [{ question: 'Q1?', header: 'A', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false }];
    const q2 = [{ question: 'Q2?', header: 'B', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: false }];
    const p1 = postAskHook(port, q1, 800);
    await new Promise(r => setTimeout(r, 50));
    const p2 = postAskHook(port, q2, 800);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.notEqual(r1.status, 409, 'first ask was 409-superseded — Map migration regressed: ' + JSON.stringify(r1));
    assert.notEqual(r2.status, 409, 'second ask was 409-superseded — Map migration regressed: ' + JSON.stringify(r2));
    // Both should have aborted via client-timeout (server still long-polling, never responded).
    assert.equal(r1.error, 'client-timeout', 'first ask did not stay long-pending — got ' + JSON.stringify(r1));
    assert.equal(r2.error, 'client-timeout', 'second ask did not stay long-pending — got ' + JSON.stringify(r2));
  });

  it('rejects empty questions array with 400 (regression guard for input validation)', async () => {
    const r = await postAskHook(port, [], 1000);
    assert.equal(r.status, 400);
  });
});
