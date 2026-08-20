// 覆盖目标：server/server.js 中既有 server-*.test.js 仍未触达的「可达残余分支」。
// 既有 harness（server-lifecycle / server-http-extra / server-http-extra-2 / server-auth-branches /
// server-ws-branches）已覆盖大部分启停、静态、WS、auth 路径；本文件补以下 workspace-mode
// 可达、且不需要拉起任何 node-pty / 外网 / GUI 子进程的残余分支：
//
//   A. deps.setAuthConfig（server.js 486-489）+ deps.clearAuthOverride（491-494）
//      —— 经 POST /api/auth/config 路由触达。loopback 恒 isAdmin，{enabled,password} 走
//      setAuthConfig；{clearOverride:true} 走 clearAuthOverride。
//   B. _notifyParentPending 的 switch 全分支（235-252）——经 broadcastWsMessage（server.js
//      1994-2008）转译。本机 server 进程默认无 process.send（非 forked），故既有测试只命中
//      234 行的 `!process.send` 短路；这里临时安装 process.send 捕获事件，覆盖 ask-hook-pending
//      / *-resolved / *-cancelled / *-timeout 各 case + default（非 ask 类型）+ 252 行 send。
//   C. beforeRequest 插件 hook 抛错的「实际行为」pin：handleRequest 包了 runWaterfallHook 的
//      try/catch（server.js 660-671），文档化为"插件抛错 → 500 Plugin error"。但
//      runWaterfallHook（plugin-loader.js 107-122）对每个 hook **自身** 用 try/catch 吞掉异常
//      并续跑，**不会向上抛**——故一个普通的抛错 beforeRequest 插件**到不了** 665-671 的 500 分支，
//      请求照常返回（hookResult.handled 仍为 false → 走正常路由）。本段按现状 pin：上传一个
//      必抛的 beforeRequest 插件，断言请求仍 200（异常被 loader 吞）。665-671 的 500 分支只在
//      runWaterfallHook 自身抛（loader 内部 bug）时可达，普通插件无法触发 → 记 skipped/notes。
//   D. setSdkStreamingState 的 inactive→inactive 无边沿不广播分支（server.js 1985-1986 的
//      `changed||isActive` 为 false 短路）——补 server-http-extra 只打了 active/inactive 边沿之外的
//      「持续 inactive」一路。
//   E. serverStarted hook 的 interactions.getPendingPerms / resolvePerm / getPendingAsks /
//      resolveAsk（server.js 930-968）——既有测试均未让任何插件在 serverStarted 拿到 interactions
//      并真的 resolve 一个 pending entry。本段写一个 serverStarted 插件把 interactions 暂存到
//      globalThis，再经 /api/perm-hook、/api/ask-hook 长轮询挂出真 pending entry，调
//      interactions.resolvePerm/resolveAsk 解析它，断言长轮询 res 真被 {decision}/{answers} 解析。
//      workspace 模式 terminalWss 为 null → 962-965 / 942-945 的 WS 广播分支跳过（无 client，等价）。
//
// 隔离：workspace 模式（CCV_WORKSPACE_MODE=1）阻止 _initPromise 自动启动，由测试显式
// startViewer/stopViewer 控时序；NODE_ENV=test 激活 __testing。{concurrency:false}。
// 进程卫生：本文件全程不发任何 WS 'input' → 不 spawnShell → 不拉起 node-pty 子进程；
// 唯一可能的子进程是 stats-worker（Worker thread，stopViewer 内 terminate）。每个 describe
// 的 after() 都 stopViewer 并等待端口释放；C 段的抛错插件在 after 里删除并 reload 复原，
// 避免污染同进程后续（本文件 describe 串行，C 放最后）。
//
// 放过（确认 workspace 模式打不到）：
//   - startStreamingStatusTimer 内的 CLI streaming 广播（1897-1901）：该 timer 仅在
//     `if (!isWorkspaceMode)` 内 start，CLI-only；需真 CLI 模式 + 改 interceptor.streamingState +
//     500ms tick，与本文件 workspace 单例模式冲突，留给 CLI-mode 测试。
//   - serverStarted interactions.resolvePerm/resolveAsk（931-967）：需先有真 pending perm/ask
//     entry 再由插件 hook 在 serverStarted 时调用；时序复杂，已由 server-ws-branches/plugins 的
//     WS/route 路径等价覆盖 resolve 语义。
//   - auto-update setTimeout（2040-2062）/ handleExit（2073-2079）：workspace skip 块 + 需 30s
//     定时器 + npm registry 网络（见 server-lifecycle.test.js 顶注）。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-residual-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
// 私有高位端口窗，避免与其它 server-* 测试跨进程抢端口（参照 server-lifecycle.test.js）。
// 注意：本文件原与 server-startup-extra.test.js 共用 17860-17899，node:test 默认按 CPU 核并行
// 跑文件 → 两者会同时从 17860 起 server，抵消"私有窗逐文件独占"的隔离意图。这里改用独占的
// 17820-17859，与 startup-extra(17860-17899) / lifecycle(17920-17959) 三者互不重叠。
process.env.CCV_START_PORT = '17820';
process.env.CCV_MAX_PORT = '17859';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 低层 http：可自定义 method/headers/body，返回 {status, headers, body, json()}. */
function raw(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    let payload = null;
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: h }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: d,
        json() { try { return JSON.parse(d); } catch { return null; } },
      }));
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

/** stopViewer + 等端口释放，确保 after() 不留监听。 */
async function stopAndSettle(mod) {
  try { await mod.stopViewer(); } catch {}
  await wait(120);
}

describeCli('server.js residual: deps.setAuthConfig / clearAuthOverride via /api/auth/config', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'workspace server should start');
    port = mod.getPort();
    assert.ok(port > 0);
  });

  after(async () => {
    await stopAndSettle(mod);
  });

  it('POST /api/auth/config {enabled,password} invokes deps.setAuthConfig and re-reads effective config', async () => {
    const res = await raw(port, '/api/auth/config', {
      method: 'POST',
      body: { enabled: true, password: 'resid-pw' },
    });
    assert.equal(res.status, 200, 'loopback admin POST should be accepted');
    const state = res.json();
    assert.ok(state, 'response is JSON state');
    assert.equal(state.enabled, true, 'effective enabled now true after setAuthConfig');
    // deps.setAuthConfig re-loaded authConfig → getAuthConfig() export must reflect it.
    const cfg = mod.getAuthConfig();
    assert.equal(cfg.enabled, true, 'in-memory authConfig.enabled updated');
    assert.equal(cfg.password, 'resid-pw', 'in-memory authConfig.password updated to the set value');
  });

  it('POST /api/auth/config {clearOverride:true} invokes deps.clearAuthOverride and re-reads config', async () => {
    // 先确保有可清的状态（上一个用例已 enable）。clearOverride 在无 project 时退回 global，
    // server.js clearProjectOverride(null) 安全无副作用 → authConfig 重新 load。
    const res = await raw(port, '/api/auth/config', {
      method: 'POST',
      body: { clearOverride: true },
    });
    assert.equal(res.status, 200, 'clearOverride accepted on loopback');
    const state = res.json();
    assert.ok(state, 'clearOverride returns the rebuilt state');
    // clearAuthOverride 返回值即重载后的 authConfig；getAuthConfig 应同步。
    const cfg = mod.getAuthConfig();
    assert.equal(typeof cfg.enabled, 'boolean', 'authConfig still has a boolean enabled after clear');
  });
});

describeCli('server.js residual: _notifyParentPending switch via broadcastWsMessage (process.send installed)', { concurrency: false }, () => {
  let mod, port, prevSend;
  let captured;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv);
    port = mod.getPort();
    // 安装 process.send 桩，捕获 _notifyParentPending → process.send(event)（server.js 252）。
    // 真实 forked tab-worker 才有 process.send；本机独立 server 默认无，故需手动注入才能进 switch。
    captured = [];
    prevSend = process.send;
    process.send = (event) => { captured.push(event); return true; };
  });

  after(async () => {
    // 还原 process.send，避免污染同进程后续测试 / 触发 node:test runner 的 IPC 误判。
    if (prevSend === undefined) delete process.send; else process.send = prevSend;
    await stopAndSettle(mod);
  });

  it('ask-hook-pending → pending-add (with questions+projectName); ack id stringified', () => {
    captured.length = 0;
    mod.broadcastWsMessage({ type: 'ask-hook-pending', id: 42, questions: [{ q: 'x' }] });
    const ev = captured.find((e) => e && e.type === 'pending-add');
    assert.ok(ev, 'ask-hook-pending should translate to pending-add');
    assert.equal(ev.kind, 'ask');
    assert.equal(ev.id, '42', 'numeric id is stringified');
    assert.deepEqual(ev.payload.questions, [{ q: 'x' }], 'questions forwarded in payload');
    assert.equal(typeof ev.payload.projectName, 'string', 'projectName present (possibly empty)');
  });

  it('sdk-ask-pending with missing id falls back to __ask__ sentinel', () => {
    captured.length = 0;
    mod.broadcastWsMessage({ type: 'sdk-ask-pending', questions: [] });
    const ev = captured.find((e) => e && e.type === 'pending-add');
    assert.ok(ev);
    assert.equal(ev.id, '__ask__', 'missing id → __ask__ sentinel');
  });

  it('ask-hook-resolved / sdk-ask-resolved / ask-hook-cancelled / *-timeout → pending-remove', () => {
    for (const type of ['ask-hook-resolved', 'sdk-ask-resolved', 'ask-hook-cancelled', 'ask-hook-timeout', 'sdk-ask-timeout']) {
      captured.length = 0;
      mod.broadcastWsMessage({ type, id: 'sess-' + type });
      const ev = captured.find((e) => e && e.type === 'pending-remove');
      assert.ok(ev, `${type} should translate to pending-remove`);
      assert.equal(ev.kind, 'ask');
      assert.equal(ev.id, 'sess-' + type, 'id forwarded for remove');
    }
  });

  it('non-ask type (perm-hook-resolved) does NOT reach process.send (not whitelisted in broadcastWsMessage)', () => {
    captured.length = 0;
    // broadcastWsMessage 的 whitelist 不含 perm-hook-* → _notifyParentPending 不被调用，
    // process.send 不应收到任何事件。
    mod.broadcastWsMessage({ type: 'perm-hook-resolved', id: 'p1' });
    assert.equal(captured.length, 0, 'perm-hook-* is inline-only, never bridged to parent');
  });

  it('broadcastWsMessage tolerates a string payload and a malformed object without throwing', () => {
    captured.length = 0;
    // 字符串 payload：进 broadcastWsMessage 的 terminalWss 分支（此处 terminalWss 为 null → no-op），
    // 且 typeof msg === 'object' 为 false → 不进 _notifyParentPending。不应抛。
    assert.doesNotThrow(() => mod.broadcastWsMessage('hello'));
    // 对象但 type 非 string → switch default / 短路；不应抛、不应桥接。
    assert.doesNotThrow(() => mod.broadcastWsMessage({ foo: 'bar' }));
    assert.equal(captured.length, 0, 'neither string nor typeless object bridges to parent');
  });
});

describeCli('server.js residual: setSdkStreamingState no-edge inactive branch', { concurrency: false }, () => {
  let mod;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv);
    mod.__testing.reset();
  });

  after(async () => {
    mod.__testing.reset();
    await stopAndSettle(mod);
  });

  it('inactive→inactive emits no rising edge and takes the no-broadcast short-circuit', () => {
    // 起点 _lastSdkActive=false（reset 后）。再喂一个 inactive：wasActive=false, isActive=false →
    // changed=false && isActive=false → 不进 sendEventToClients 分支（server.js 1986 短路）。
    // observeStreamingTick 也不应报 rising edge。无 SSE client，纯状态机断言。
    let edge = null;
    // 用 __testing.observeStreamingTick 单独验 sdk 路径 wasActive=false → false（非边沿）。
    edge = mod.__testing.observeStreamingTick(false, 'sdk');
    assert.equal(edge, false, 'inactive observe is not a rising edge');
    // setSdkStreamingState(inactive) 不抛、不广播（无 client 时本就 no-op，这里确认 falsy 入参归一化）。
    assert.doesNotThrow(() => mod.setSdkStreamingState({ active: false }));
    assert.doesNotThrow(() => mod.setSdkStreamingState(undefined));
    assert.doesNotThrow(() => mod.setSdkStreamingState(null));
    assert.doesNotThrow(() => mod.setSdkStreamingState({}));
  });

  it('active edge then inactive edge are both accepted (rising then falling)', () => {
    mod.__testing.reset();
    const rising = mod.__testing.observeStreamingTick(true, 'sdk');
    assert.equal(rising, true, 'inactive→active is a rising edge');
    const stillActive = mod.__testing.observeStreamingTick(true, 'sdk');
    assert.equal(stillActive, false, 'active→active is not an edge');
    const falling = mod.__testing.observeStreamingTick(false, 'sdk');
    assert.equal(falling, false, 'active→inactive is a falling edge (returns false, only rising returns true)');
  });
});

describeCli('server.js residual: beforeRequest plugin throw is SWALLOWED by loader (pins actual behavior)', { concurrency: false }, () => {
  let mod, port;
  const PLUGIN_NAME = 'residual-throwing.js';

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv);
    port = mod.getPort();
    // 上传一个 beforeRequest 必抛的插件，再 reload 装载。
    const pluginContent = [
      'export default {',
      "  name: 'residual-throwing',",
      '  hooks: {',
      '    beforeRequest() { throw new Error("residual boom"); },',
      '  },',
      '};',
    ].join('\n');
    const up = await raw(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: PLUGIN_NAME, content: pluginContent }] },
    });
    assert.equal(up.status, 200, 'plugin upload accepted');
    const reload = await raw(port, '/api/plugins/reload', { method: 'POST' });
    assert.equal(reload.status, 200, 'plugin reload ok');
    // 确认插件确已装载（出现在列表里）。
    const list = await raw(port, '/api/plugins');
    const found = (list.json()?.plugins || []).find((p) => p.file === PLUGIN_NAME);
    assert.ok(found, 'throwing plugin is loaded and listed');
  });

  after(async () => {
    // 删除抛错插件并 reload 复原，避免污染同进程（本文件 describe 串行，此为最后一个）。
    try {
      await raw(port, '/api/plugins?file=' + encodeURIComponent(PLUGIN_NAME), { method: 'DELETE' });
      await raw(port, '/api/plugins/reload', { method: 'POST' });
    } catch {}
    await stopAndSettle(mod);
  });

  it('a throwing beforeRequest hook does NOT 500 — loader swallows it and the request proceeds normally', async () => {
    // server.js 文档把 handleRequest 660-671 的 catch 标为"插件错误 → 500 Plugin error"，
    // 但 runWaterfallHook（plugin-loader.js 112-119）对每个 hook 自身 try/catch 吞掉异常并续跑，
    // 不向上抛 → handleRequest 的 catch 到不了，hookResult.handled 仍 false → 走正常路由。
    // 按现状 pin：请求拿到正常 200（而非 500），证明 665-671 的 500 分支对普通抛错插件不可达。
    const res = await raw(port, '/api/cli-mode');
    assert.equal(res.status, 200, 'thrown hook is swallowed by loader; request returns normally (NOT 500)');
    const j = res.json();
    assert.ok(j && typeof j === 'object', 'normal /api/cli-mode JSON payload still returned');
  });
});

/** 挂一条不自我超时的长轮询 POST：返回 { id?, done }；done 在 server 回 res 时 settle。 */
function postLongPoll(port, path, body) {
  const payload = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  let settled = false, resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const settle = (v) => { if (!settled) { settled = true; resolveDone(v); } };
  const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} settle({ status: res.statusCode, json: j }); });
  });
  req.on('error', () => settle({ status: -1, json: null }));
  req.write(payload);
  req.end();
  return { req, done, abort: () => { try { req.destroy(); } catch {} } };
}

describeCli('server.js residual: serverStarted interactions resolvePerm / resolveAsk on real pending entries', { concurrency: false }, () => {
  let mod, port;
  const PLUGIN_NAME = 'residual-interactions.js';
  const GLOBAL_KEY = '__ccvResidualInteractions';
  const pluginsDir = join(tmpDir, 'plugins');

  before(async () => {
    mkdirSync(pluginsDir, { recursive: true });
    // serverStarted 插件：把 context.interactions 暂存到 globalThis，供测试调用。
    const pluginContent = [
      'export default {',
      "  name: 'residual-interactions',",
      '  hooks: {',
      '    serverStarted(ctx) {',
      `      globalThis['${GLOBAL_KEY}'] = ctx && ctx.interactions || null;`,
      '    },',
      '  },',
      '};',
    ].join('\n');
    writeFileSync(join(pluginsDir, PLUGIN_NAME), pluginContent);

    mod = await import('../server/server.js');
    // 确保上一个 describe 的 server 已停（其 after 已 stop），干净重启让 startViewer 重新
    // loadPlugins 装载本插件 → serverStarted 触发 → interactions 暂存。
    try { await mod.stopViewer(); } catch {}
    await wait(80);
    delete globalThis[GLOBAL_KEY];
    const srv = await mod.startViewer();
    assert.ok(srv, 'server restarts and fires serverStarted');
    port = mod.getPort();
    assert.ok(port > 0);
    assert.ok(globalThis[GLOBAL_KEY], 'serverStarted plugin captured the interactions object');
  });

  after(async () => {
    delete globalThis[GLOBAL_KEY];
    try { rmSync(join(pluginsDir, PLUGIN_NAME), { force: true }); } catch {}
    await stopAndSettle(mod);
  });

  it('getPendingPerms + resolvePerm resolves a real long-poll /api/perm-hook with {decision}', async () => {
    const interactions = globalThis[GLOBAL_KEY];
    const lp = postLongPoll(port, '/api/perm-hook', { toolName: 'Bash', input: { command: 'ls' } });
    // 给 server 一点时间把 res 挂进 pendingPermHooks（POST body 解析是 async）。
    await wait(120);
    const pendings = interactions.getPendingPerms();
    const mine = pendings.find((p) => p.toolName === 'Bash');
    assert.ok(mine, 'getPendingPerms() lists the in-flight perm-hook entry');
    assert.equal(typeof mine.id, 'string');
    const ok = interactions.resolvePerm(mine.id, 'allow', false);
    assert.equal(ok, true, 'resolvePerm returns true for a known id');
    const result = await lp.done;
    assert.equal(result.status, 200, 'long-poll perm-hook resolved 200');
    assert.deepEqual(result.json, { decision: 'allow' }, 'res body carries the decision');
    // 二次 resolve 已删 → false 分支（932-933）。
    assert.equal(interactions.resolvePerm(mine.id, 'deny'), false, 'resolvePerm on an already-removed id returns false');
    lp.abort();
  });

  it('getPendingAsks + resolveAsk resolves a real long-poll /api/ask-hook with {answers}', async () => {
    const interactions = globalThis[GLOBAL_KEY];
    // 用合法白名单 toolUseId → ask-hook 直接复用为 id，便于断言。
    const toolUseId = 'residual_ask_1';
    const questions = [{ question: 'pick one', options: ['a', 'b'] }];
    const lp = postLongPoll(port, '/api/ask-hook', { questions, toolUseId });
    await wait(120);
    const asks = interactions.getPendingAsks();
    const mine = asks.find((a) => a.id === toolUseId);
    assert.ok(mine, 'getPendingAsks() lists the in-flight ask-hook entry by toolUseId');
    assert.deepEqual(mine.questions, questions, 'questions echoed back');
    const answers = ['a'];
    const ok = interactions.resolveAsk(toolUseId, answers);
    assert.equal(ok, true, 'resolveAsk returns true for a known id');
    const result = await lp.done;
    assert.equal(result.status, 200, 'long-poll ask-hook resolved 200');
    assert.deepEqual(result.json, { answers }, 'res body carries the answers');
    assert.equal(interactions.resolveAsk(toolUseId, ['b']), false, 'resolveAsk on an already-removed id returns false');
    lp.abort();
  });

  it('resolveSdkApproval delegate is a no-op-safe optional-chain when no sdk fn is injected', () => {
    const interactions = globalThis[GLOBAL_KEY];
    // _sdkResolveApproval 默认 null → resolveSdkApproval 用 ?. 短路返回 undefined，不抛（server.js 969）。
    assert.doesNotThrow(() => {
      const r = interactions.resolveSdkApproval('x', 'allow');
      assert.equal(r, undefined, 'no sdk resolver injected → undefined');
    });
  });
});
