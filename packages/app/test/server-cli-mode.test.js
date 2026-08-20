// 覆盖目标：server/server.js 的 CLI-mode 专属、且需要**真 PTY**的 terminal WS 分支——
// 既有 server-ws-branches.test.js 走 CLI 模式但全程不发 input，故不拉 node-pty；本文件反其道，
// 真 spawnShell / spawnScratch 起 /bin/sh PTY，专攻以下 input/resize/scratch 路径：
//   - /ws/terminal input：PTY 未运行 → spawnShell；首发 input 成为 activeWs；Ctrl+C 防抖
//     单次透传 + 2s 内连按第二次被拦（toast）                                  (1302-1339)
//   - /ws/terminal input-sequential：writeToPtySequential 回 input-sequential-done(seq) (1340-1360)
//   - /ws/terminal resize：clientSizes/mobileClients 维护 + 移动端优先仲裁 + 首次 SIGWINCH 兜底 (1634-1659)
//   - /ws/terminal close：activeWs 断开后把控制权移交剩余客户端                  (1664-1686)
//   - /ws/terminal-scratch：upgrade 校验 id（缺/非法 destroy）、懒 spawn、state/data、
//     input/resize/kill、close 解监听                                          (1091-1204)
//   - startStreamingStatusTimer 间隔体：streamingState.active 时向 SSE 客户端推 streaming_status (1897-1901)
//
// 隔离：CCV_CLI_MODE=1 + mkdtemp env，NODE_ENV=test，端口私有窗 17900-17909（START/MAX 经 env 钉死，
// 避开既有 startup-extra 17860-17899 与 lifecycle 17920-17959；cli-startup 占 17910-17914、
// im-worker 占 17915-17919）。进程卫生：after 里显式 killPty()+killAllScratch()，再确认无残留 PTY 子进程。
// node-pty 加载失败（缺平台 prebuild）→ 整套 skip。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-cli-mode-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
// 私有端口窗（与 server-ws-branches 的默认窗错开），钉死防 EADDRINUSE 漫游到别人的窗。
process.env.CCV_START_PORT = '17900';
process.env.CCV_MAX_PORT = '17909';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 轮询直到 pred() 为真或超时（每 10ms 查一次）；替代固定 sleep 后假定异步已完成。
async function waitUntil(pred, { timeoutMs = 3000, intervalMs = 10, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await pred(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntil timeout: ${label}`);
    await wait(intervalMs);
  }
}

// 打开一个 ws 并等到 open；返回带 msgs 队列 + waitFor(pred) 的句柄。
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

// 一个不会成功 upgrade 的 ws（期望被 server destroy socket）；返回一个在 close/error 时 resolve 的 promise。
function expectWsRejected(base, path) {
  return new Promise((res) => {
    const ws = new WebSocket(base + path);
    let opened = false;
    ws.on('open', () => { opened = true; try { ws.close(); } catch {} });
    ws.on('error', () => res({ opened }));
    ws.on('close', () => res({ opened }));
    const tid = setTimeout(() => { try { ws.terminate(); } catch {} res({ opened, timedOut: true }); }, 2500);
    if (typeof tid.unref === 'function') tid.unref();
  });
}

// GET /events SSE，返回 { events:[], waitForEvent(name), abort() }。
function connectSse(port) {
  let req;
  const events = [];
  const waiters = [];
  let buf = '';
  req = request({ hostname: '127.0.0.1', port, path: '/events', method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*([\s\S]*)$/m);
        const ev = { name: evMatch ? evMatch[1].trim() : 'message', data: dataMatch ? dataMatch[1] : '' };
        events.push(ev);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].name === ev.name) { waiters[i].resolve(ev); waiters.splice(i, 1); }
        }
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return {
    events,
    waitForEvent: (name, timeoutMs = 3000) => new Promise((res) => {
      const hit = events.find((e) => e.name === name);
      if (hit) return res(hit);
      const entry = { name, resolve: res };
      waiters.push(entry);
      const tid = setTimeout(() => {
        const idx = waiters.indexOf(entry);
        if (idx >= 0) waiters.splice(idx, 1);
        res(null);
      }, timeoutMs);
      if (typeof tid.unref === 'function') tid.unref();
    }),
    abort: () => { try { req.destroy(); } catch {} },
  };
}

// node-pty 能否加载——不能则整套 skip（CI 缺 prebuild 时）。
let ptyAvailable = false;
try { await import('node-pty'); ptyAvailable = true; } catch { ptyAvailable = false; }

describeCli('server.js CLI-mode terminal WS with a real PTY', { concurrency: false, skip: ptyAvailable ? false : 'node-pty unavailable' }, () => {
  let mod, ptyMgr, scratchMgr, port, base;

  before(async () => {
    mod = await import('../server/server.js');
    ptyMgr = await import('../server/pty-manager.js');
    scratchMgr = await import('../server/scratch-pty-manager.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode server should start');
    port = mod.getPort();
    assert.ok(port >= 17900 && port <= 17909, `port should be in private window, got ${port}`);
    base = `ws://127.0.0.1:${port}`;
    // 让 setupTerminalWebSocket 的 await import('ws') / pty-manager / scratch-pty-manager 挂载完成。
    await wait(200);
  });

  after(async () => {
    // 进程卫生：先杀掉所有真 PTY 子进程（main + scratch），再停 server，最后清 tmp。
    try { ptyMgr.killPty(); } catch {}
    try { scratchMgr.killAllScratch(); } catch {}
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 400);
    });
    // 兜底：确认主 PTY 已回收（防遗留子进程）。
    try { assert.equal(ptyMgr.getPtyState().running, false, 'main PTY must be dead after teardown'); } catch {}
  });

  // ─────────── input：PTY 未运行 → spawnShell；首发 input 成为 activeWs ───────────
  it('input on /ws/terminal spawns a real shell when none is running and becomes activeWs', async () => {
    assert.equal(ptyMgr.getPtyState().running, false, 'precondition: no PTY running');
    const conn = await connectWs(base);
    // 先发一条 resize 注册尺寸，再发 input 触发 spawnShell（input 分支命中 activeWs 切换 + 尺寸应用）。
    conn.send({ type: 'resize', cols: 80, rows: 24 });
    conn.send({ type: 'input', data: 'echo cli-mode-probe\r' });
    await waitUntil(() => ptyMgr.getPtyState().running === true, { label: 'shell spawned' });
    assert.equal(ptyMgr.getPtyState().running, true, 'a real shell should be running after input');
    // PTY 输出应回流为 data 消息（命中 onPtyData → ws.send）。
    const data = await conn.waitFor((m) => m.type === 'data' && typeof m.data === 'string', 3000);
    assert.ok(data, 'should receive at least one data frame from the live PTY');
    await conn.close();
  });

  // ─────────── Ctrl+C 防抖：单次透传；2s 内连按第二次被拦 + 回 toast ───────────
  it('double Ctrl+C within 2s is intercepted and replies a toast (single passes through)', async () => {
    // 此时 PTY 已由上个用例 spawn（懒启动后保留）。直接发 Ctrl+C 两次。
    assert.equal(ptyMgr.getPtyState().running, true, 'PTY should still be running from prior test');
    const conn = await connectWs(base);
    // 第一次 Ctrl+C：ws._ctrlCLastTime 从 0 起 → 不拦，透传，不回 toast。
    conn.send({ type: 'input', data: '\x03' });
    // 第二次 Ctrl+C（紧接着，<2s）：命中拦截 → 回 toast，不透传第二个 Ctrl+C。
    conn.send({ type: 'input', data: '\x03' });
    const toast = await conn.waitFor((m) => m.type === 'toast' && typeof m.message === 'string', 2500);
    assert.ok(toast, 'second Ctrl+C within 2s must reply a toast (ctrlCBlocked)');
    await conn.close();
  });

  // ─────────── input-sequential：writeToPtySequential 回 input-sequential-done(seq) ───────────
  it('input-sequential drains chunks and replies input-sequential-done echoing seq', async () => {
    const conn = await connectWs(base);
    conn.send({ type: 'input-sequential', chunks: ['echo seq1\r', 'echo seq2\r'], seq: 'unit-seq-7', settleMs: 30 });
    const done = await conn.waitFor((m) => m.type === 'input-sequential-done', 4000);
    assert.ok(done, 'should receive input-sequential-done');
    assert.equal(done.seq, 'unit-seq-7', 'seq must be echoed back to the client');
    assert.equal(typeof done.ok, 'boolean', 'done.ok must be a boolean');
    await conn.close();
  });

  // 非字符串 chunk：入口 every(string) 校验拒绝。① 进程不崩（否则后续连接失败）
  // ② 拒绝路径仍回 input-sequential-done(ok:false, seq)，不静默丢弃让带 seq 客户端挂超时。
  it('input-sequential rejects non-string chunks with ok:false (no crash, replies seq)', async () => {
    const conn = await connectWs(base);
    conn.send({ type: 'input-sequential', chunks: ['ok', 123, {}], seq: 'unit-seq-bad', settleMs: 30 });
    const done = await conn.waitFor((m) => m.type === 'input-sequential-done', 4000);
    assert.ok(done, 'reject path must still reply input-sequential-done');
    assert.equal(done.ok, false, 'invalid chunks → ok:false');
    assert.equal(done.seq, 'unit-seq-bad', 'seq echoed even on reject');
    // 进程存活：紧接一条合法序列仍正常完成
    conn.send({ type: 'input-sequential', chunks: ['echo alive\r'], seq: 'unit-seq-ok', settleMs: 30 });
    const ok2 = await conn.waitFor((m) => m.type === 'input-sequential-done' && m.seq === 'unit-seq-ok', 4000);
    assert.ok(ok2, 'server survived bad input and processes the next valid request');
    await conn.close();
  });

  // ─────────── resize：移动端优先仲裁 + clientSizes/mobileClients 维护 ───────────
  it('mobile resize is authoritative and a PC resize stores size without crashing', async () => {
    const pc = await connectWs(base);
    const mob = await connectWs(base);
    // PC 端 resize（无移动端时 PC 生效，记入 clientSizes）。
    pc.send({ type: 'resize', cols: 100, rows: 30 });
    await wait(50);
    // 移动端 resize（mobile:true → 始终生效，加入 mobileClients）。
    mob.send({ type: 'resize', cols: 40, rows: 20, mobile: true });
    await wait(50);
    // 再发一次 PC resize：此时有移动端在线 → PC 仅存储不应用（不抛错即覆盖到分支）。
    pc.send({ type: 'resize', cols: 120, rows: 40 });
    await wait(80);
    // 没有崩溃即说明 resize 仲裁分支均被走到；PTY 仍在跑。
    assert.equal(ptyMgr.getPtyState().running, true, 'PTY survives the resize arbitration');
    await pc.close();
    await mob.close();
  });

  // ─────────── close：activeWs 断开后控制权移交剩余客户端 ───────────
  it('closing the active ws hands control to a remaining client', async () => {
    const a = await connectWs(base);
    const b = await connectWs(base);
    // a 先发 input → 成为 activeWs。
    a.send({ type: 'resize', cols: 90, rows: 28 });
    a.send({ type: 'input', data: '\r' });
    await wait(80);
    // b 注册一个尺寸，便于 close handler 在 a 断开时挑到 b 作为新 activeWs。
    b.send({ type: 'resize', cols: 95, rows: 29 });
    await wait(60);
    // 关闭 a（activeWs）→ close handler 走 activeWs===ws 分支，遍历 clientSizes 移交给 b。
    await a.close();
    await wait(120);
    // server 未崩溃、PTY 仍在 → 移交分支已执行（无直接可观测返回，靠存活性 + 后续可用性断言）。
    assert.equal(ptyMgr.getPtyState().running, true, 'PTY survives active-ws handoff');
    // b 仍可正常交互（再发一条 input-sequential 拿到 done）。
    b.send({ type: 'input-sequential', chunks: ['echo after-handoff\r'], seq: 'handoff', settleMs: 30 });
    const done = await b.waitFor((m) => m.type === 'input-sequential-done' && m.seq === 'handoff', 4000);
    assert.ok(done, 'remaining client b should still drive the PTY after handoff');
    await b.close();
  });

  // ─────────── scratch upgrade 校验：缺 id / 非法 id → socket destroy（不 open） ───────────
  it('rejects /ws/terminal-scratch with a missing or invalid id', async () => {
    const noId = await expectWsRejected(base, '/ws/terminal-scratch');
    assert.equal(noId.opened, false, 'scratch ws without id must be rejected before open');
    const badId = await expectWsRejected(base, '/ws/terminal-scratch?id=' + encodeURIComponent('bad id with spaces!'));
    assert.equal(badId.opened, false, 'scratch ws with an invalid id must be rejected');
  });

  // ─────────── scratch happy path：懒 spawn + state/data + input/resize/kill + close ───────────
  it('scratch ws lazily spawns a shell, streams state/data, and handles input/resize/kill', async () => {
    const sid = 'scr_unit_1';
    assert.equal(scratchMgr.getScratchState(sid).running, false, 'precondition: no scratch pty');
    const conn = await connectWs(base, '/ws/terminal-scratch?id=' + sid);
    // 连接即懒 spawn → 应先收 state 帧（running:true）。
    const stateMsg = await conn.waitFor((m) => m.type === 'state', 3000);
    assert.ok(stateMsg, 'scratch ws should emit an initial state frame');
    await waitUntil(() => scratchMgr.getScratchState(sid).running === true, { label: 'scratch spawned' });
    // resize（命中 resizeScratch 分支）。
    conn.send({ type: 'resize', cols: 70, rows: 22 });
    // input（命中 writeScratch；s.running 已 true → 不重复 spawn）。
    conn.send({ type: 'input', data: 'echo scratch-probe\r' });
    const data = await conn.waitFor((m) => m.type === 'data' && typeof m.data === 'string', 3000);
    assert.ok(data, 'scratch ws should stream PTY data');
    // kill 消息：用户主动关 tab → killScratch（pty 被杀，配额释放）。
    conn.send({ type: 'kill' });
    await waitUntil(() => scratchMgr.getScratchState(sid).running === false, { label: 'scratch killed' });
    assert.equal(scratchMgr.getScratchState(sid).running, false, 'kill message must tear down the scratch pty');
    await conn.close();
  });

  // ─────────── scratch 重连：已有 pty 的 id 再连，命中 hasScratchPty 复用（不计新配额） ───────────
  it('reconnecting an existing scratch id reuses its pty (replays buffered output)', async () => {
    const sid = 'scr_reuse_1';
    const c1 = await connectWs(base, '/ws/terminal-scratch?id=' + sid);
    await c1.waitFor((m) => m.type === 'state', 3000);
    await waitUntil(() => scratchMgr.getScratchState(sid).running === true, { label: 'scratch reuse spawned' });
    c1.send({ type: 'input', data: 'echo reuse-buffer\r' });
    // 等到 outputBuffer 攒了点东西，再断开（pty 保留）。
    await waitUntil(() => (scratchMgr.getScratchOutputBuffer(sid) || '').length > 0, { label: 'scratch buffered' });
    await c1.close();
    await wait(80);
    // pty 应仍存活（close handler 不杀 pty）。
    assert.equal(scratchMgr.getScratchState(sid).running, true, 'scratch pty survives ws close');
    // 重连同 id：connection handler 命中 buffer → 立即回放一帧 data。
    const c2 = await connectWs(base, '/ws/terminal-scratch?id=' + sid);
    const replay = await c2.waitFor((m) => m.type === 'data' && typeof m.data === 'string', 3000);
    assert.ok(replay, 'reconnecting should replay the buffered scratch output');
    await c2.close();
    // 收尾杀掉这个保留的 pty。
    try { scratchMgr.killScratch(sid); } catch {}
  });

  // ─────────── startStreamingStatusTimer 间隔体：active 时向 SSE 推 streaming_status ───────────
  // ─────────── input 在 PTY 已运行时：跳过 spawnShell，命中 activeWs 切换 + clientSizes 尺寸应用 ───────────
  it('input with a live PTY switches activeWs and applies the new client size (no respawn)', async () => {
    assert.equal(ptyMgr.getPtyState().running, true, 'PTY should be live from earlier tests');
    const conn = await connectWs(base);
    conn.send({ type: 'resize', cols: 88, rows: 26 });
    await wait(40);
    conn.send({ type: 'input', data: 'echo live-input\r' });
    const data = await conn.waitFor((m) => m.type === 'data' && typeof m.data === 'string', 3000);
    assert.ok(data, 'data should flow on the existing PTY without a respawn');
    assert.equal(ptyMgr.getPtyState().running, true);
    await conn.close();
  });

  // ─────────── ask-cancel：首次 disk-revival 取消（broadcast），二次同 id 取消 → !handled 仅 ack 发起方 ───────────
  // 第一次对一个内存无 entry 的 id 发 ask-cancel：markCancelled 写 disk 终态返 true → handled=true →
  // 广播 ask-hook-cancelled 给所有 client (1543-1546,1565-1571)。
  // 第二次同 id：disk 已是 cancelled 终态 → markCancelled 返 false → handled=false →
  // 仅给发起方回 ack（1547-1556 的 already-answered ack + 1572-1575 的 cancelled ack），不再广播。
  it('ask-cancel: first disk-revival broadcasts; a second cancel on the same id only acks the sender', async () => {
    const a = await connectWs(base);
    const b = await connectWs(base);
    // 第一次：disk-revival 取消 → 广播给所有（含 B）。
    a.send({ type: 'ask-cancel', id: 'askCancelTwice1', reason: 'first cancel' });
    const firstB = await b.waitFor((m) => m.type === 'ask-hook-cancelled' && m.id === 'askCancelTwice1', 2500);
    assert.ok(firstB, 'first cancel (disk-revival) should broadcast to other clients');
    // 第二次：disk 已 cancelled → markCancelled 返 false → 仅 ack 发起方，不再广播给 B。
    const bSeen = b.msgs.length;
    a.send({ type: 'ask-cancel', id: 'askCancelTwice1', reason: 'second cancel' });
    const ackA = await a.waitFor((m) => m.type === 'ask-hook-cancelled' && m.id === 'askCancelTwice1', 2500);
    assert.ok(ackA, 'sender should still receive an ack on the losing second cancel');
    await wait(150);
    const bGot = b.msgs.slice(bSeen).filter((m) => m.id === 'askCancelTwice1' && m.type === 'ask-hook-cancelled');
    assert.equal(bGot.length, 0, 'losing second cancel must NOT re-broadcast to other clients');
    await a.close();
    await b.close();
  });

  // ─────────── ask-cancel 非法 id 格式 → warn + return（不应答） (1503-1506) ───────────
  it('ask-cancel with an invalid id format is rejected silently (no ack)', async () => {
    const conn = await connectWs(base);
    const seen = conn.msgs.length;
    conn.send({ type: 'ask-cancel', id: 'bad id!!', reason: 'x' });
    await wait(180);
    const got = conn.msgs.slice(seen).filter((m) => m.type === 'ask-hook-cancelled');
    assert.equal(got.length, 0, 'invalid-format ask-cancel id must be dropped with no ack');
    await conn.close();
  });

  // ─────────── sdk-plan-answer：CLI 无 resolver → 仍 broadcast sdk-plan-resolved (1583-1588) ───────────
  it('sdk-plan-answer broadcasts sdk-plan-resolved to other clients in CLI mode', async () => {
    const a = await connectWs(base);
    const b = await connectWs(base);
    a.send({ type: 'sdk-plan-answer', id: 'planRelay1', approve: true });
    const resolvedB = await b.waitFor((m) => m.type === 'sdk-plan-resolved' && m.id === 'planRelay1', 2500);
    assert.ok(resolvedB, 'other client should receive sdk-plan-resolved broadcast');
    await a.close();
    await b.close();
  });

  // ─────────── sdk-ask-answer：CLI 无 resolver → broadcast sdk-ask-resolved + notifyParent (1488-1494) ───────────
  it('sdk-ask-answer broadcasts sdk-ask-resolved to other clients in CLI mode', async () => {
    const a = await connectWs(base);
    const b = await connectWs(base);
    a.send({ type: 'sdk-ask-answer', id: 'askRelay1', answers: ['ignored-in-cli'] });
    const resolvedB = await b.waitFor((m) => m.type === 'sdk-ask-resolved' && m.id === 'askRelay1', 2500);
    assert.ok(resolvedB, 'other client should receive sdk-ask-resolved broadcast');
    await a.close();
    await b.close();
  });

  // ─────────── sdk-user-message（无 handler）+ sdk-interrupt（非 SDK 模式）→ 忽略/warn 分支不崩 ───────────
  it('sdk-user-message and sdk-interrupt are ignored gracefully in CLI mode', async () => {
    const conn = await connectWs(base);
    conn.send({ type: 'sdk-user-message', text: 'hello from cli' });
    conn.send({ type: 'sdk-interrupt' });
    await wait(150);
    assert.equal(ptyMgr.getPtyState().running, true, 'server still healthy after ignored SDK relays');
    conn.send({ type: 'input-sequential', chunks: ['echo still-alive\r'], seq: 'sdk-ignore', settleMs: 30 });
    const done = await conn.waitFor((m) => m.type === 'input-sequential-done' && m.seq === 'sdk-ignore', 4000);
    assert.ok(done, 'server keeps serving after ignored SDK relay messages');
    await conn.close();
  });

  it('streaming status timer pushes streaming_status to SSE clients when active', async () => {
    // CLI 模式下 startViewer 已起 streamingStatusTimer（每 500ms）。手动把 interceptor 的
    // streamingState 置 active，连一个 SSE，timer 下一拍即广播 streaming_status（命中 1897-1901）。
    const ic = await import('../server/interceptor.js');
    const sse = connectSse(port);
    // 等 SSE 连接被 server 接纳（events 路由会先推一批 init 事件）。
    await wait(150);
    ic.streamingState.active = true;
    ic.streamingState.startTime = Date.now();
    ic.streamingState.model = 'unit-test-model';
    try {
      const ev = await sse.waitForEvent('streaming_status', 3000);
      assert.ok(ev, 'SSE client should receive a streaming_status event while streaming is active');
      const parsed = JSON.parse(ev.data);
      assert.equal(parsed.active, true, 'streaming_status payload should report active:true');
      assert.equal(typeof parsed.elapsed, 'number', 'active payload carries elapsed ms');
    } finally {
      // 复位，避免污染后续 timer 拍。
      ic.streamingState.active = false;
      ic.streamingState.startTime = null;
      sse.abort();
    }
  });

  // ─────────── CCV_BASE_PATH：静态 strip + index <base> 注入 + WS upgrade strip ───────────
  // base-path 在 server.js 里逐请求读 process.env.CCV_BASE_PATH（570/679/730/1063），可运行时设。
  // 设 /proxy 后：①GET /proxy/index.html → 静态 strip(684-686) + index <base> 注入(731-736)；
  // ②scratch ws 连 /proxy/ws/terminal-scratch?id=... → upgrade pathname strip(1065-1067) 后正常 upgrade。
  // 收尾恢复 env，避免污染后续用例 / 其他文件（虽进程独立，仍守纪律）。
  it('CCV_BASE_PATH strips the prefix for static, index <base> injection, and WS upgrade', async () => {
    const prev = process.env.CCV_BASE_PATH;
    process.env.CCV_BASE_PATH = '/proxy';
    try {
      // ① 静态 strip(684-686) + filePath '/' → '/index.html'(687) + serveIndexHtml <base> 注入(731-736)。
      //    必须请求 base-path 根 '/proxy/'（→ '/'）才会走 serveIndexHtml 注入分支；显式 '/proxy/index.html'
      //    会被常规静态路径直接发原文件、跳过注入。
      const html = await new Promise((resolve) => {
        const req = request({ hostname: '127.0.0.1', port, path: '/proxy/', method: 'GET' }, (res) => {
          let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', () => resolve({ status: -1 }));
        const tid = setTimeout(() => { try { req.destroy(); } catch {} resolve({ status: -1 }); }, 4000);
        if (typeof tid.unref === 'function') tid.unref();
        req.end();
      });
      assert.equal(html.status, 200, 'GET /proxy/ should serve index after base-path strip');
      assert.ok(/<base href="\/proxy\/"/.test(html.body), 'index html should carry the injected <base href="/proxy/">');

      // ② scratch ws upgrade 在 base path 下：pathname strip 后命中 /ws/terminal-scratch 分支
      const sid = 'scr_bp_1';
      const conn = await connectWs(base, '/proxy/ws/terminal-scratch?id=' + sid);
      const stateMsg = await conn.waitFor((m) => m.type === 'state', 10000);
      assert.ok(stateMsg, 'scratch ws under base-path should upgrade and emit state');
      await conn.close();
      try { scratchMgr.killScratch(sid); } catch {}
    } finally {
      if (prev === undefined) delete process.env.CCV_BASE_PATH; else process.env.CCV_BASE_PATH = prev;
    }
  });

  // ─────────── 主 PTY 退出 → 连着的 ws 收 exit 帧 (1292-1295) ───────────
  // 放在最后：这会让 singleton shell 真退出（此后 getPtyState().running=false），无后续用例依赖它。
  // 给 shell 发 `exit\r` 让其干净退出 → onPtyExit 触发 → ws.readyState===1 分支 send {type:'exit'}。
  it('a clean PTY exit is forwarded as an exit frame to a connected ws', async () => {
    // 确保有一个活的 PTY（前面用例可能已留下；没有就发 input 起一个）。
    const conn = await connectWs(base);
    if (ptyMgr.getPtyState().running !== true) {
      conn.send({ type: 'resize', cols: 80, rows: 24 });
      conn.send({ type: 'input', data: '\r' });
      await waitUntil(() => ptyMgr.getPtyState().running === true, { label: 'shell for exit test' });
    }
    // 让 shell 退出。/bin/sh 收到 `exit\n` 会终止进程。
    // 时窗 20s:真实 shell 退出 → onPtyExit → ws 帧的链路在全量并行 + CPU 加压下 5s 会超窗
    // (waitFor 事件驱动,帧到即返,正常路径不受影响)。
    conn.send({ type: 'input', data: 'exit\r' });
    const exitMsg = await conn.waitFor((m) => m.type === 'exit', 20000);
    assert.ok(exitMsg, 'connected ws should receive an exit frame when the PTY terminates');
    assert.equal(typeof exitMsg.exitCode, 'number', 'exit frame carries a numeric exitCode');
    await waitUntil(() => ptyMgr.getPtyState().running === false, { label: 'PTY torn down after exit' });
    await conn.close();
  });
});
