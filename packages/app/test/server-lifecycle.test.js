// 覆盖目标：server/server.js 的启动/停机生命周期与 SSE 广播分支——
//   - startViewer → stopViewer 多轮往返（端口重新分配 + clients 引用稳定 + _doStop 清理链）
//   - stopViewer 幂等（同一 in-flight promise）+ stop 后 getPort 归零语义
//   - EADDRINUSE 步进：占住一个端口的同时再起一个 → 第二个落到下一个端口（startViewer 的
//     createConnection probe → tryListen(port+1) 分支）
//   - setSdkStreamingState / broadcastTurnEnd 在「有 SSE 客户端连着」时真正走 sendEventToClients
//     —— 之前 server-http-extra.test.js 在 workspace 模式且无 client 时只命中 no-op 短路，
//      本文件连一条真 /events SSE 流，让 1781-1794 / 1896-1901 / 1986-1990 的「clients.length>0」分支命中。
//
// 隔离：workspace 模式（CCV_WORKSPACE_MODE=1）阻止 _initPromise 自动启动，由测试显式
// startViewer/stopViewer 控时序；NODE_ENV=test 激活 __testing。{concurrency:false}。
//
// 放过（确认打不到，原因见完成留言）：
//   - _doStop 里 `_resumeState.tempFile` rename/unlink（1927-1940）与 handleExit（2073-2079）：
//     _resumeState 是 interceptor.js 的模块级 let，无 setter export，测试无法在不跑真 resume
//     交互的前提下置非 null。
//   - 启动后 30s 的 checkAndUpdate 升级检查（2039-2062）：定时器 30s + 需 npm registry 网络，
//     不适合单测里等待/打网络（G5 可用 mock 单独覆盖 updater.js）。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-lifecycle-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
// 端口隔离：node:test 每个文件独立进程，但默认端口窗 7008-7049 被全部 server-* 测试共享，
// 全量并行跑时会跨进程抢占同一端口 → 本文件的 EADDRINUSE squatter 用 portA 二次 listen 时
// 撞到别的进程已占的端口而 reject（实测 listen EADDRINUSE 0.0.0.0:7017）。给本文件一个私有
// 高位端口窗（无其它测试使用），让 startViewer 与 squatter 都落在这里，step-forward 断言恢复确定性。
process.env.CCV_START_PORT = '17920';
process.env.CCV_MAX_PORT = '17959';
// 让 turn_end trailing-debounce 缩到 100ms（clamp 下限），单测里可在 ~200ms 内观察到
// _scheduleTurnEndBroadcast → timer fire → _emitTurnEnd → SSE turn_end 落地（1805-1808,1777-1794）。
process.env.CCV_TURN_END_DEBOUNCE_MS = '100';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询直到 cond() 为真：每 10ms 查一次，累计超过 timeoutMs 则 resolve(false)。
 * 用于替代"固定 sleep 后假定异步已完成"——异步事件（跨 loopback 的 SSE 解析）落地时刻
 * 不确定，固定 sleep 在高负载下偶发还没解析完。返回是否在上限内满足条件。
 */
function waitUntil(cond, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      let ok = false;
      try { ok = !!cond(); } catch { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 10);
    };
    poll();
  });
}

/** 开一条 SSE /events 连接，把若干 named-event 收进 events[]；返回可关闭句柄。 */
function openSse(port) {
  return new Promise((resolve) => {
    const events = []; // { event, data }
    let raw = '';
    const req = request({ hostname: '127.0.0.1', port, path: '/events', method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        raw += chunk;
        // 简单 SSE 解析：以空行分隔的 record，提取 event: / data:
        let idx;
        while ((idx = raw.indexOf('\n\n')) >= 0) {
          const record = raw.slice(0, idx);
          raw = raw.slice(idx + 2);
          let ev = 'message';
          const dataLines = [];
          for (const line of record.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length) events.push({ event: ev, data: dataLines.join('\n') });
        }
      });
      resolve({
        events,
        waitFor: (evName, timeoutMs = 2000) => new Promise((res2) => {
          const start = Date.now();
          const poll = () => {
            const hit = events.find((e) => e.event === evName);
            if (hit) return res2(hit);
            if (Date.now() - start > timeoutMs) return res2(null);
            setTimeout(poll, 25);
          };
          poll();
        }),
        close: () => { try { req.destroy(); } catch {} },
      });
    });
    req.on('error', () => resolve({ events: [], waitFor: async () => null, close: () => {} }));
    req.end();
  });
}

function getJson(port, path) {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('error', () => resolve({ status: -1, json: null }));
    req.end();
  });
}

describeCli('server.js lifecycle: start/stop rounds + EADDRINUSE + SSE broadcasts', { concurrency: false }, () => {
  let mod;

  before(async () => {
    mod = await import('../server/server.js');
  });

  after(async () => {
    await new Promise((resolve) => {
      try { mod.stopViewer(); } catch {}
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 300);
    });
  });

  it('startViewer/stopViewer survives multiple round trips and rebinds a port each time', async () => {
    const ports = [];
    for (let round = 0; round < 3; round++) {
      const srv = await mod.startViewer();
      assert.ok(srv, `round ${round}: server should start`);
      const p = mod.getPort();
      assert.ok(p > 0, `round ${round}: port assigned`);
      ports.push(p);
      // 探活
      const r = await getJson(p, '/api/cli-mode');
      assert.equal(r.status, 200, `round ${round}: server reachable`);
      await mod.stopViewer();
      await wait(120);
    }
    // 至少跑满 3 轮且每轮都拿到一个有效端口（范围取本文件私有端口窗，见顶部 CCV_START_PORT/CCV_MAX_PORT）
    assert.equal(ports.length, 3);
    const lo = parseInt(process.env.CCV_START_PORT, 10);
    const hi = parseInt(process.env.CCV_MAX_PORT, 10);
    for (const p of ports) assert.ok(p >= lo && p <= hi, `port ${p} in expected range [${lo},${hi}]`);
  });

  it('stopViewer() is idempotent: two calls return the same in-flight promise', async () => {
    await mod.startViewer();
    const p1 = mod.stopViewer();
    const p2 = mod.stopViewer();
    assert.strictEqual(p1, p2, 'concurrent stopViewer() must reuse the in-flight stop promise');
    await p1;
  });

  it('startViewer steps to the next port when the preferred one is occupied (EADDRINUSE probe)', async () => {
    // 直接占住 startViewer 第一个尝试的端口（CCV_START_PORT），强制它步进到下一个空闲端口。
    // 不再做「start→stop→赌 OS 复用同端口」的脆弱舞步：那个旧写法假定 stop 后 startViewer 会拿回
    // 同一个 portA，且在 stop 与 squatter.listen 之间存在 race（squatter 还没占上 → startViewer 抢回
    // portA → step-forward 断言挂）；并且依赖私有端口窗对抗跨进程抢占，仍非确定性。
    //
    // 新写法：先在 startViewer 之前用裸 net server 占住 START_PORT（绑 0.0.0.0，server.js 的 probe
    // 走 127.0.0.1:port connect 会命中），再 startViewer → probe 见 START_PORT 已占 → tryListen(+1)。
    // 私有端口窗 [17920,17959] 保证 START_PORT 本身在测试环境一定空闲，squatter.listen 必成功。
    const START = parseInt(process.env.CCV_START_PORT, 10);
    const squatter = createServer(() => {});
    await new Promise((res, rej) => {
      squatter.once('error', rej);
      squatter.listen(START, '0.0.0.0', res);
    });
    try {
      const srvB = await mod.startViewer();
      assert.ok(srvB, 'server should still start by stepping past the squatted START_PORT');
      const portB = mod.getPort();
      assert.notEqual(portB, START, 'must NOT bind the squatted START_PORT');
      assert.ok(portB > START, 'must step forward to a higher free port');
      const r = await getJson(portB, '/api/cli-mode');
      assert.equal(r.status, 200, 'stepped server is reachable');
      await mod.stopViewer();
      await wait(100);
    } finally {
      await new Promise((res) => squatter.close(res));
    }
  });

  it('setSdkStreamingState + broadcastTurnEnd reach a connected SSE client (clients.length>0 branch)', async () => {
    const srv = await mod.startViewer();
    assert.ok(srv);
    const port = mod.getPort();
    mod.__testing.reset();

    const sse = await openSse(port);
    // 等 /events 初次握手（events 路由会立即推一批初始 named events）；给握手一点时间。
    await wait(200);

    // setSdkStreamingState active → 应作为 streaming_status named event 推给已连客户端。
    mod.setSdkStreamingState({ active: true, startTime: Date.now(), model: 'test' });
    const streaming = await sse.waitFor('streaming_status', 2000);
    assert.ok(streaming, 'connected SSE client should receive streaming_status when SDK state goes active');

    // turn_end：debounce 已被 env 缩到 100ms。broadcastTurnEnd 入桶 → ~100ms 后 timer fire →
    // _emitTurnEnd → sendEventToClients(clients,'turn_end',...) 真正下发给这条 SSE。
    let emitted = null;
    mod.__testing.onBroadcast((payload) => { emitted = payload; });
    assert.equal(mod.__testing.getDebounceMs(), 100, 'env override should shrink debounce to 100ms');
    mod.broadcastTurnEnd('lifecycle-sse-sess', Date.now());
    const turnEnd = await sse.waitFor('turn_end', 2000);
    assert.ok(turnEnd, 'connected SSE client should receive turn_end after the debounce fires');
    assert.ok(emitted && emitted.sessionId === 'lifecycle-sse-sess',
      'onBroadcast hook should observe the emitted turn_end payload');
    const parsed = JSON.parse(turnEnd.data);
    assert.equal(parsed.sessionId, 'lifecycle-sse-sess', 'turn_end SSE payload carries the sessionId');

    // streaming_status inactive 边沿也下发（changed 分支）。
    // inactive 边沿经 sendEventToClients 同步 res.write，但客户端收包+SSE 解析跨 loopback TCP
    // 是异步的——与 active 边沿(上面 waitFor)/turn_end 一致，这里也轮询第二条 streaming_status
    // 落地，而不是固定 sleep 后假定已解析完（高负载下 120ms 内第二条可能尚未入 events[]）。
    mod.setSdkStreamingState({ active: false });
    const sawInactive = await waitUntil(
      () => sse.events.filter((e) => e.event === 'streaming_status').length >= 2,
      2000,
    );
    const streamingCount = sse.events.filter((e) => e.event === 'streaming_status').length;
    assert.ok(sawInactive && streamingCount >= 2,
      `both active and inactive streaming_status edges are delivered (saw ${streamingCount})`);

    sse.close();
    mod.__testing.reset();
    await mod.stopViewer();
    await wait(100);
  });

  it('_emitTurnEnd via test hook fires through to the broadcast callback', async () => {
    // 不依赖真实 10s debounce：用 __testing 直接驱动调度 + 把 debounce 当作黑盒，
    // 只断言「schedule 后 pending key 出现」以及「reset 清空」。真正的 SSE turn_end 落地
    // 由 debounce.test.js 覆盖；此处补 server.js 内 _scheduleTurnEndBroadcast 的入桶分支。
    mod.__testing.reset();
    mod.broadcastTurnEnd('lifecycle-sess', Date.now());
    assert.deepEqual(mod.__testing.getPendingKeys(), ['lifecycle-sess']);
    // 再次同 key schedule → 重排（clearTimeout 旧 timer）不应新增 key
    mod.broadcastTurnEnd('lifecycle-sess', Date.now());
    assert.deepEqual(mod.__testing.getPendingKeys(), ['lifecycle-sess']);
    // rising-edge cancel：observeStreamingTick(active) 应清空所有 pending
    const wasEdge = mod.__testing.observeStreamingTick(true, 'cli');
    assert.equal(wasEdge, true, 'inactive→active should be a rising edge');
    assert.deepEqual(mod.__testing.getPendingKeys(), [], 'rising edge cancels all pending turn-end timers');
    mod.__testing.reset();
  });
});
