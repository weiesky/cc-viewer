// 覆盖目标：server/server.js 的 setupTerminalWebSocket 里「真实长轮询解析」分支——
// 既有 test/server-http-extra-2.test.js 只打了 ask-hook-answer/ask-cancel/perm-hook-answer
// 的「未知 id / 缺 id」否定路径（warn / cancelled-ack），从未制造真正 pending 的 long-poll
// 再用 WS 应答它。本文件用 CLI 模式起真 server，先 POST /api/ask-hook、/api/perm-hook 把
// long-poll res 挂住，再开真 ws 发应答，断言长轮询 res 真被 200 解析。专攻这些 happy-path：
//   - ask-hook-answer 命中内存 entry（非 shortPoll）→ hookRes 收 {answers}        (1376-1408)
//   - ask-hook-answer first-write-wins：第二答收 ask-hook-already-answered 之后再发
//     ask-hook-cancelled（entry 已删）                                            (1420-1455)
//   - perm-hook-answer 命中内存 entry → hookRes 收 {decision} + 广播 resolved     (1462-1481)
//   - ask-cancel 命中内存 entry（Hook 路径）→ hookRes 收 {cancelled} + 广播        (1517-1536,1565-1571)
//   - connection 时 replay pending ask-hook（新 ws 收 ask-hook-pending）           (1224-1237)
//   - perm-hook short-poll GET handoff（/api/ask-hook/:id/result）+ ws answer 推送 listener
//
// 隔离同 server-http-extra-2.test.js：CCV_CLI_MODE=1 + mkdtemp env，NODE_ENV=test。
// 关键：这些分支都**不**需要 PTY——只有 input 消息才 spawnShell。本文件全程不发 input，
// 故不拉起任何 node-pty 子进程，afterEach 只需 ws.close + 解挂 long-poll。
// 放过：SDK 模式专属分支（sdk-ask-answer/sdk-plan-answer/perm 的 _sdkResolveApproval 真接线，
// 需 runSdkMode），SIGWINCH 重绘 / 反压 timeout terminate（需真 PTY 洪泛）。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ws-branch-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19730';
process.env.CCV_MAX_PORT = '19739';

/**
 * POST /api/ask-hook 长轮询：返回一个 { id, done } 句柄。
 * - id：用我们传入的 toolUseId（ask-hook 路由对合法白名单 toolUseId 直接复用为 id）。
 * - done：一个 Promise，在 server 终于回 res 时 resolve {status, body}；不会自己超时，
 *   由调用方在拿到答案 / 测试 after 主动 req.destroy()。
 * settleTimeoutMs 仅作兜底，防个别用例忘了解挂导致挂死。
 */
function postAskHookLongPoll(port, toolUseId, questions, { shortPoll = false, settleTimeoutMs = 4000 } = {}) {
  const body = JSON.stringify({ questions, toolUseId });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (shortPoll) headers['X-Ask-Poll-Mode'] = 'short';
  let req;
  let settled = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const settle = (v) => { if (!settled) { settled = true; resolveDone(v); } };
  req = request({ hostname: '127.0.0.1', port, path: '/api/ask-hook', method: 'POST', headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => settle({ status: res.statusCode, body: data }));
  });
  req.on('error', (err) => settle({ status: -1, error: err.code || err.message }));
  const tid = setTimeout(() => { try { req.destroy(); } catch {} settle({ status: -1, error: 'client-timeout' }); }, settleTimeoutMs);
  if (typeof tid.unref === 'function') tid.unref();
  req.write(body);
  req.end();
  return { id: toolUseId, done, abort: () => { try { req.destroy(); } catch {} } };
}

/** POST /api/perm-hook 长轮询：server 自生成 id（perm_*），从 ws 的 perm-hook-pending 广播里取。 */
function postPermHookLongPoll(port, toolName, input, { settleTimeoutMs = 4000 } = {}) {
  const body = JSON.stringify({ toolName, input });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  let req;
  let settled = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const settle = (v) => { if (!settled) { settled = true; resolveDone(v); } };
  req = request({ hostname: '127.0.0.1', port, path: '/api/perm-hook', method: 'POST', headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => settle({ status: res.statusCode, body: data }));
  });
  req.on('error', (err) => settle({ status: -1, error: err.code || err.message }));
  const tid = setTimeout(() => { try { req.destroy(); } catch {} settle({ status: -1, error: 'client-timeout' }); }, settleTimeoutMs);
  if (typeof tid.unref === 'function') tid.unref();
  req.write(body);
  req.end();
  return { done, abort: () => { try { req.destroy(); } catch {} } };
}

/** GET /api/ask-hook/:id/result 短轮询挂等（wait ms 内有答案立即返）。 */
function getAskHookResult(port, id, wait = 3000, settleTimeoutMs = 5000) {
  let req;
  let settled = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const settle = (v) => { if (!settled) { settled = true; resolveDone(v); } };
  req = request({ hostname: '127.0.0.1', port, path: `/api/ask-hook/${encodeURIComponent(id)}/result?wait=${wait}`, method: 'GET' }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => settle({ status: res.statusCode, body: data }));
  });
  req.on('error', (err) => settle({ status: -1, error: err.code || err.message }));
  const tid = setTimeout(() => { try { req.destroy(); } catch {} settle({ status: -1, error: 'client-timeout' }); }, settleTimeoutMs);
  if (typeof tid.unref === 'function') tid.unref();
  req.end();
  return { done, abort: () => { try { req.destroy(); } catch {} } };
}

/** 打开一个 ws 并等到 open；返回 ws + 一个 collect 队列 + waitFor(predicate) 工具。 */
function connectWs(base, path = '/ws/terminal') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    const msgs = [];
    const waiters = [];
    ws.on('message', (d) => {
      let m;
      try { m = JSON.parse(d.toString()); } catch { m = { raw: d.toString() }; }
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
      }
    });
    ws.on('error', () => {});
    ws.on('open', () => resolve({
      ws,
      msgs,
      send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      // 等一条满足 pred 的消息（已收到的也算）；timeout 返回 null。
      waitFor: (pred, timeoutMs = 2500) => new Promise((res) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        const entry = { pred, resolve: res };
        waiters.push(entry);
        const tid = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          res(null);
        }, timeoutMs);
        if (typeof tid.unref === 'function') tid.unref();
      }),
      close: () => new Promise((res) => { ws.on('close', () => res()); try { ws.close(); } catch { res(); } }),
    }));
    ws.on('close', () => {});
    const tid = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('ws open timeout')); }, 3000);
    if (typeof tid.unref === 'function') tid.unref();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describeCli('server.js terminal WS long-poll resolution branches (CLI mode)', { concurrency: false }, () => {
  let mod, port, base;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode server should start');
    port = mod.getPort();
    assert.ok(port > 0);
    base = `ws://127.0.0.1:${port}`;
    // 让 setupTerminalWebSocket 的 await import('ws') / pty-manager 挂载完成。
    await wait(200);
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 400);
    });
  });

  // ─────────── ask-hook-answer 命中内存 entry（非 shortPoll 长轮询） ───────────
  it('ask-hook-answer resolves a real long-poll POST with {answers}', async () => {
    const q = [{ question: 'Pick one?', header: 'H', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }];
    const poll = postAskHookLongPoll(port, 'askLongPoll1', q);
    const conn = await connectWs(base);
    // 等 server 广播 ask-hook-pending（确认 POST 已挂入 pendingAskHooks）
    const pending = await conn.waitFor((m) => m.type === 'ask-hook-pending' && m.id === 'askLongPoll1');
    assert.ok(pending, 'should receive ask-hook-pending broadcast for the parked POST');

    // 通过 ws 应答 → 长轮询 POST 应被 200 {answers} 解析
    conn.send({ type: 'ask-hook-answer', id: 'askLongPoll1', answers: ['A'] });
    const res = await poll.done;
    assert.equal(res.status, 200, `long-poll should resolve 200, got ${JSON.stringify(res)}`);
    const j = JSON.parse(res.body);
    assert.deepEqual(j.answers, ['A'], 'hookRes must echo the answers from ws');
    await conn.close();
  });

  // ─────────── perm-hook-answer 命中内存 entry → {decision} + 广播 ───────────
  it('perm-hook-answer resolves a real long-poll POST with {decision} and broadcasts resolved', async () => {
    // 用两条 ws：A 应答，B 验证收到 perm-hook-resolved 广播（c !== ws 分支）。
    const connA = await connectWs(base);
    const connB = await connectWs(base);
    const poll = postPermHookLongPoll(port, 'Bash', { command: 'ls' });
    // 从广播里取 server 自生成的 perm id
    const pendingA = await connA.waitFor((m) => m.type === 'perm-hook-pending' && m.toolName === 'Bash');
    assert.ok(pendingA && pendingA.id, 'should broadcast perm-hook-pending with an id');
    const permId = pendingA.id;

    connA.send({ type: 'perm-hook-answer', id: permId, decision: 'allow' });
    const res = await poll.done;
    assert.equal(res.status, 200, `perm long-poll should resolve 200, got ${JSON.stringify(res)}`);
    assert.deepEqual(JSON.parse(res.body), { decision: 'allow' });
    // B 应收到 resolved 广播
    const resolvedB = await connB.waitFor((m) => m.type === 'perm-hook-resolved' && m.id === permId);
    assert.ok(resolvedB, 'other client (B) should receive perm-hook-resolved broadcast');
    await connA.close();
    await connB.close();
  });

  // ─────────── ask-cancel 命中内存 entry（Hook 路径）→ {cancelled} + 广播 ───────────
  it('ask-cancel cancels a real pending ask-hook → POST resolves {cancelled} and broadcasts to all', async () => {
    const q = [{ question: 'Cancel me?', header: 'C', options: [{ label: 'X' }], multiSelect: false }];
    const poll = postAskHookLongPoll(port, 'askCancel1', q);
    const connA = await connectWs(base);
    const connB = await connectWs(base);
    await connA.waitFor((m) => m.type === 'ask-hook-pending' && m.id === 'askCancel1');

    connA.send({ type: 'ask-cancel', id: 'askCancel1', reason: 'user aborted in test' });
    const res = await poll.done;
    assert.equal(res.status, 200, `ask-hook POST should resolve 200 on cancel, got ${JSON.stringify(res)}`);
    const j = JSON.parse(res.body);
    assert.equal(j.cancelled, true);
    assert.equal(j.reason, 'user aborted in test');
    // handled=true → 广播给所有 client（含发起方 A 与旁观 B）
    const cancelledB = await connB.waitFor((m) => m.type === 'ask-hook-cancelled' && m.id === 'askCancel1');
    assert.ok(cancelledB, 'all clients should receive ask-hook-cancelled when a real entry is cancelled');
    assert.equal(cancelledB.reason, 'user aborted in test');
    await connA.close();
    await connB.close();
  });

  // ─────────── disk-revival 分支：内存无 entry 但 ask-bridge 短轮询 disk（server 重启场景） ───────────
  // ask-hook-answer 带一个内存里没有的 id：askEntry=null → else if(askId) → markAnswered 落 disk →
  // 返 true → askAnswered=true → 广播 ask-hook-resolved 给其他 client。(server.js 1409-1418,1434-1440)
  it('ask-hook-answer for an id with no memory entry writes disk (markAnswered) and broadcasts resolved', async () => {
    const connA = await connectWs(base);
    const connB = await connectWs(base);
    // 该 id 从未 POST 过 → 内存无 entry、disk 无终态 → markAnswered 创建 answered 占位返 true
    connA.send({ type: 'ask-hook-answer', id: 'askDiskRevive1', answers: ['only'] });
    const resolvedB = await connB.waitFor((m) => m.type === 'ask-hook-resolved' && m.id === 'askDiskRevive1');
    assert.ok(resolvedB, 'B should receive ask-hook-resolved for the disk-revived answer');
    // GET /result 应能从 disk 消费到刚写的答案
    const getRes = getAskHookResult(port, 'askDiskRevive1', 1500);
    const r = await getRes.done;
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body).answers, ['only'], 'disk answer should be consumable via GET /result');
    await connA.close();
    await connB.close();
  });

  // ─────────── first-write-wins 抢答失败：disk 已是终态 → already-answered ack（不广播） ───────────
  // 先把 id 在 disk 上标 answered（经上一类路径），再对同 id 发 ask-hook-answer：markAnswered 返 false →
  // alreadyAnswered=true → 发起方收 ask-hook-already-answered，且不广播给其他 client。(1419-1432)
  it('ask-hook-answer losing first-write-wins yields ask-hook-already-answered ack (no broadcast)', async () => {
    const connA = await connectWs(base);
    const connB = await connectWs(base);
    // 第一次：写 disk answered 终态
    connA.send({ type: 'ask-hook-answer', id: 'askFww1', answers: ['first'] });
    await connB.waitFor((m) => m.type === 'ask-hook-resolved' && m.id === 'askFww1');
    // 清空 B 已收消息记录窗口起点
    const bSeenBefore = connB.msgs.length;
    // 第二次：同 id，disk 已 answered → markAnswered 返 false → alreadyAnswered → 仅 ack 发起方
    connA.send({ type: 'ask-hook-answer', id: 'askFww1', answers: ['second'] });
    const ackA = await connA.waitFor((m) => m.type === 'ask-hook-already-answered' && m.id === 'askFww1', 2000);
    assert.ok(ackA, 'sender should receive ask-hook-already-answered when losing first-write-wins');
    // B 不应再收到针对该 id 的新广播（不广播抢答失败，防覆盖真实 answer）
    await wait(150);
    const bNewForId = connB.msgs.slice(bSeenBefore).filter((m) => m.id === 'askFww1' && m.type !== 'ask-hook-resolved');
    assert.equal(bNewForId.length, 0, 'losing answer must NOT broadcast to other clients');
    await connA.close();
    await connB.close();
  });

  // ─────────── connection 时 replay pending ask-hook ───────────
  it('a newly connected ws replays in-flight pending ask-hook(s)', async () => {
    // 先挂一个 ask（不连 ws），再连新 ws → connection handler 应 replay ask-hook-pending。
    const q = [{ question: 'Replay?', header: 'RP', options: [{ label: 'Z' }], multiSelect: false }];
    const poll = postAskHookLongPoll(port, 'askReplay1', q);
    // 给 server 一点时间把 entry set 进 pendingAskHooks
    await wait(120);
    const conn = await connectWs(base);
    const replayed = await conn.waitFor(
      (m) => m.type === 'ask-hook-pending' && m.id === 'askReplay1', 2500);
    assert.ok(replayed, 'new ws should replay the in-flight ask-hook-pending');
    assert.ok(Array.isArray(replayed.questions) && replayed.questions.length === 1);
    assert.ok(typeof replayed.timeoutMs === 'number' && replayed.timeoutMs > 0, 'replay carries remaining timeoutMs');
    // 清场：取消该 ask 让 POST 收尾
    conn.send({ type: 'ask-cancel', id: 'askReplay1' });
    await poll.done;
    await conn.close();
  });

  // ─────────── short-poll：GET /result 挂等 → ws answer 推 listener ───────────
  it('short-poll GET /result is woken by a ws ask-hook-answer (markAnswered + notifyShortPollAnswer)', async () => {
    const q = [{ question: 'Short?', header: 'SP', options: [{ label: 'P' }, { label: 'Q' }], multiSelect: false }];
    // short-poll：POST 立即返 { id, capability }，entry 留在内存等 ws answer
    const poll = postAskHookLongPoll(port, 'askShort1', q, { shortPoll: true });
    const ack = await poll.done;
    assert.equal(ack.status, 200);
    const ackJson = JSON.parse(ack.body);
    assert.equal(ackJson.capability, 'short-poll');
    assert.equal(ackJson.id, 'askShort1');

    // GET /result 挂等
    const getRes = getAskHookResult(port, 'askShort1', 3000);
    await wait(120); // 让 listener 注册
    // ws answer → markAnswered 落 disk + _notifyShortPollAnswer 推醒 GET listener
    const conn = await connectWs(base);
    conn.send({ type: 'ask-hook-answer', id: 'askShort1', answers: ['Q'] });
    const res = await getRes.done;
    assert.equal(res.status, 200, `short-poll GET should be woken 200, got ${JSON.stringify(res)}`);
    assert.deepEqual(JSON.parse(res.body).answers, ['Q']);
    await conn.close();
  });

  // ─────────── ask-cancel short-poll：markCancelled + notifyShortPollCancel ───────────
  it('ask-cancel on a short-poll entry wakes GET /result with {cancelled}', async () => {
    const q = [{ question: 'ShortCancel?', header: 'SC', options: [{ label: 'M' }], multiSelect: false }];
    const poll = postAskHookLongPoll(port, 'askShortCancel1', q, { shortPoll: true });
    const ack = await poll.done;
    assert.equal(ack.status, 200);

    const getRes = getAskHookResult(port, 'askShortCancel1', 3000);
    await wait(120);
    const conn = await connectWs(base);
    conn.send({ type: 'ask-cancel', id: 'askShortCancel1', reason: 'cancel short' });
    const res = await getRes.done;
    assert.equal(res.status, 200);
    const j = JSON.parse(res.body);
    assert.equal(j.cancelled, true);
    assert.equal(j.reason, 'cancel short');
    await conn.close();
  });

  // ─────────── image-upload/remove-notify：两客户端广播（c !== ws 分支真实命中） ───────────
  it('image-upload-notify is broadcast to OTHER clients only (sender excluded)', async () => {
    const connA = await connectWs(base);
    const connB = await connectWs(base);
    const p = '/tmp/cc-viewer-uploads/branch-test.png';
    connA.send({ type: 'image-upload-notify', path: p, source: 'paste' });
    const gotB = await connB.waitFor((m) => m.type === 'image-upload-notify' && m.path === p);
    assert.ok(gotB, 'B (other client) should receive the upload notify');
    assert.equal(gotB.source, 'paste');
    // A 不应收到自己的广播（sender excluded）；给一点窗口确认没回声
    await wait(150);
    assert.ok(!connA.msgs.some((m) => m.type === 'image-upload-notify' && m.path === p),
      'sender A must NOT receive its own image-upload-notify');
    // remove-notify 同理
    connB.send({ type: 'image-remove-notify', path: p });
    const removeA = await connA.waitFor((m) => m.type === 'image-remove-notify' && m.path === p);
    assert.ok(removeA, 'A should receive remove-notify broadcast from B');
    await connA.close();
    await connB.close();
  });

  // ─────────── broadcastWsMessage：有真 terminalWss + 连着 ws → 真正 send 到客户端（1995-2000） ───────────
  it('broadcastWsMessage() pushes to a connected terminal ws client', async () => {
    const conn = await connectWs(base);
    // 字符串形态 + 对象形态都走 terminalWss.clients.forEach send。
    mod.broadcastWsMessage({ type: 'sdk-plan-pending', id: 'planBroadcast1', plan: 'do stuff' });
    const got = await conn.waitFor((m) => m.type === 'sdk-plan-pending' && m.id === 'planBroadcast1');
    assert.ok(got, 'connected ws client should receive the broadcastWsMessage payload');
    // 字符串入参分支
    mod.broadcastWsMessage(JSON.stringify({ type: 'custom-broadcast', n: 42 }));
    const got2 = await conn.waitFor((m) => m.type === 'custom-broadcast' && m.n === 42);
    assert.ok(got2, 'string-form broadcastWsMessage should also reach the client');
    await conn.close();
  });
});
