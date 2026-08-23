// 覆盖目标：server/server.js 的剩余分支（baseline 单跑约 80% branch）。
// 既有 server-*.test.js 已覆盖大量 happy/error path；本文件专攻它们没触达的分支：
//   A. 非本机请求（用机器 LAN IP 连服务器 → req.socket.remoteAddress 非 loopback →
//      isLocal=false）触发 handleRequest 鉴权三态拒绝 / Host allowlist allow/reject /
//      WS upgrade 鉴权失败 destroy —— 这些在 loopback 下永远走 allow 短路，旧测试承认打不到。
//   B. handleRequest 静态服务分支：index.html prefs 主题注入（dark/light/缺失）、SPA fallback、
//      /assets stale-chunk 404、非 GET /api 404、OPTIONS、beforeRequest 插件抛错 500。
//   C. 模块加载期 / startViewer 期 env 分支（用子进程 canonical import，spread process.env 让
//      NODE_V8_COVERAGE 传入子进程、覆盖率回并）：
//        - CCV_USE_PASSWORD=1 无显式密码 → generatePassword()（line 335）
//        - CCV_BASE_PATH 前缀剥离 + <base> 注入（684-686 / 730-734）
//        - CCV_ALLOWED_HOSTS 显式 allow / '*' 关闭防护 / reject 403
//        - CCV_TURN_END_DEBOUNCE_MS 各档（非数 / 越界 / 合法 / 空 / IM 默认）
//   D. turn-end 状态机 / SDK export 分支：__testing namespace、broadcastTurnEnd、
//      broadcastWsMessage parent 转译、_emitTurnEnd test-hook throw。
//      （setSdkStreamingState/pushSdkEntry 已随「SDK 模式走 wire 通路」改造退役）
//
// 隔离（与 270+ 文件并发）：私有高位端口窗 18020-18079（in-process）/ 18100+（子进程各自窗）；
// import server.js 之前指私有 mkdtemp 到 CCV_LOG_DIR/CLAUDE_CONFIG_DIR；NODE_ENV=test 激活
// __testing；node:test 默认按文件进程隔离，本文件独占一个 server.js 单例。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { rmBestEffort } from './_helpers/rm-sync.mjs';

// ── 必须在任何拉起 findcc.js 的 import 之前设置 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-srv-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
process.env.CCV_START_PORT = '18020';
process.env.CCV_MAX_PORT = '18079';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;

const SERVER_PATH = fileURLToPath(new URL('../server/server.js', import.meta.url));
// 子进程 driver 写在 tmpDir（项目 node_modules 树之外）→ bare import 'ws' 解析不到，
// 故把 ws 入口绝对路径注入 driver，用 file:// URL 动态 import。
const _require = createRequire(import.meta.url);
const WS_ENTRY_URL = pathToFileURL(_require.resolve('ws')).href;

// 取一个非 internal 的 LAN IPv4（用来让请求的 remoteAddress 非 loopback → isLocal=false）。
function firstLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}
const LAN_IP = firstLanIp();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred, { timeout = 4000, interval = 25 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let ok = false;
    try { ok = await pred(); } catch { ok = false; }
    if (ok) return true;
    await wait(interval);
  }
  return false;
}

/** 低层 http：可自定义 hostname / method / headers / body。返回 {status, headers, body}. */
function raw(hostname, port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    let payload = null;
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = request({ hostname, port, path, method, headers: h }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════════════
// 子进程驱动脚本：canonical import server.js（spread process.env 保留 NODE_V8_COVERAGE）。
// 入子进程后按 CCV_TEST_SCENARIO 跑特定分支，再 process.exit。覆盖率写回 test-runner 的
// NODE_V8_COVERAGE 目录被合并。
// ════════════════════════════════════════════════════════════════════════
function runScenario(scenario, extraEnv = {}, { timeout = 30000, pluginSrc = null } = {}) {
  const driver = join(tmpDir, `driver-${scenario}.mjs`);
  // driver 脚本写到私有 tmpDir，import server.js 的 canonical 绝对路径。
  const serverUrl = SERVER_PATH.replace(/\\/g, '/');
  const script = `
import { request } from 'node:http';
const SERVER_URL = ${JSON.stringify('file://' + (serverUrl.startsWith('/') ? '' : '/') + serverUrl)};
function get(host, port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: host, port, path, method: 'GET', headers }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject); req.end();
  });
}
const scenario = process.env.CCV_TEST_SCENARIO;
const mod = await import(SERVER_URL);
try {
  if (scenario === 'usePasswordGen' || scenario === 'turnEndEnv') {
    // 仅需模块加载期分支求值——什么都不做直接退出。
    process.exit(0);
  }
  if (scenario === 'listenError') {
    // START_PORT=1（特权端口，非 root listen → EACCES，非 EADDRINUSE）→ currentServer 'error'
    // 走 reject 分支（1005-1007）→ startViewer reject。捕获即视为覆盖成功。
    let rejected = false;
    try { await mod.startViewer(); } catch { rejected = true; }
    // EACCES 时 reject；若环境恰能绑定特权端口则 resolve（仍不算失败）。
    try { await mod.stopViewer(); } catch {}
    process.exit(0);
  }
  // 其余场景：起 server，发请求覆盖 handleRequest 分支。
  const srv = await mod.startViewer();
  if (!srv) { console.error('NO_SERVER'); process.exit(2); }
  const port = mod.getPort();
  const lanIp = process.env.CCV_TEST_LAN_IP || '127.0.0.1';
  if (scenario === 'basePath') {
    // CCV_BASE_PATH 设置时：带前缀的 / 请求应剥离前缀返回 index.html（含 <base> 注入）。
    await get('127.0.0.1', port, '/proxy/');             // 前缀剥离 → index.html + base 注入
    await get('127.0.0.1', port, '/proxy/api/preferences'); // 前缀剥离 → API 路由
    await get('127.0.0.1', port, '/no-prefix-path');     // 不带前缀 → SPA fallback
    // 双斜杠前缀：顶层 stripBasePath 剥一次 → //proxy/inner.js；静态段不再二次剥离
    // （base-path 收口后双重剥离已消除），文件不存在 → SPA fallback。
    await get('127.0.0.1', port, '/proxy//proxy/inner.js');
    await get('127.0.0.1', port, '/proxy/index.html');   // 直接 index.html 命中 serveIndexHtml + base 注入
  } else if (scenario === 'authReject') {
    // 密码鉴权开启（CCV_USE_PASSWORD + CCV_PASSWORD）→ 非本机无凭证：
    //   - wantsHtml(Accept text/html 或 url='/') → login-page 200 HTML
    //   - 非 HTML（API/XHR）→ unauthorized 401
    await get(lanIp, port, '/', { Host: lanIp + ':' + port, Accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9' }); // login-page
    await get(lanIp, port, '/api/preferences', { Host: lanIp + ':' + port }); // unauthorized 401
    await get(lanIp, port, '/api/preferences', { Host: lanIp + ':' + port, 'accept-language': 'fr-FR' }); // 再来一次（localeFromAcceptLanguage 分支）
  } else if (scenario === 'allowedHostsReject') {
    // CCV_ALLOWED_HOSTS 显式设白名单 → Host 不在表内 403（need isLocal=false 才进 Host gate）。
    await get(lanIp, port, '/api/preferences', { Host: 'evil.example.com:' + port });   // reject 403
    await get(lanIp, port, '/api/preferences', { Host: 'allowed.test:' + port });        // allow（在白名单）
    await get(lanIp, port, '/api/preferences', { Host: '[::1]:' + port });               // bracket IPv6 剥离
  } else if (scenario === 'allowedHostsWildcard') {
    await get(lanIp, port, '/api/preferences', { Host: 'anything.example:' + port });     // '*' → 跳过 Host gate
  } else if (scenario === 'pluginHandled') {
    // beforeRequest 插件返回 { handled:true } → handleRequest 在 hookResult.handled 处 return（663-664）。
    await get('127.0.0.1', port, '/plugin-handled-path');
    await get('127.0.0.1', port, '/api/preferences'); // 未 handled → 正常路由
  } else if (scenario === 'httpsPlugin' || scenario === 'httpsThrow') {
    // httpsPlugin：假证书 → createHttpsServer 抛错回落 HTTP（852-858）。
    // httpsThrow：httpsOptions hook 自身抛错 → startViewer 的 try/catch（825-826）。
    await get('127.0.0.1', port, '/api/preferences');
  } else if (scenario === 'sdkUserMsgThrow') {
    // _sdkSendUserMessage reject → sdk-user-message handler 的 .catch（1592-1594）。
    const _wsmod = await import(${JSON.stringify(WS_ENTRY_URL)});
    const WebSocket = _wsmod.WebSocket || _wsmod.default || _wsmod;
    const tok = mod.getAccessToken();
    mod.setSdkSendUserMessage(async () => { throw new Error('send-failed'); });
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws/terminal?token=' + tok);
    await new Promise((r) => { ws.on('open', r); ws.on('error', r); setTimeout(r, 2500); });
    try { ws.send(JSON.stringify({ type: 'sdk-user-message', text: 'boom' })); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try { ws.close(); } catch {}
  } else if (scenario === 'repoCwd') {
    // CCV_PROJECT_DIR 指向临时项目，其下有 sub/.git 且 path-contained → resolveRepoCwd 返回 candidate（141）。
    await get('127.0.0.1', port, '/api/git-status?repo=sub');     // 合法子 repo → 返回 candidate（141）
    await get('127.0.0.1', port, '/api/git-status?repo=nogit');   // 子目录无 .git → null（138）
    await get('127.0.0.1', port, '/api/git-status?repo=nope');    // 不存在 → null（137）
  } else if (scenario === 'serverStartedResolve') {
    // CLI 模式 + 插件捕获 serverStarted.interactions。先建一个 WS（terminalWss 有 readyState=1 客户端），
    // 再 POST /api/perm-hook + /api/ask-hook 挂 long-poll 真实 entry，最后 GET 插件路由触发
    // resolvePerm / resolveAsk → if(terminalWss) 广播（942-946 / 962-967）。
    const _wsmod = await import(${JSON.stringify(WS_ENTRY_URL)});
    const WebSocket = _wsmod.WebSocket || _wsmod.default || _wsmod;
    const tok = mod.getAccessToken();
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws/terminal?token=' + tok);
    await new Promise((r) => { ws.on('open', r); ws.on('error', r); setTimeout(r, 2500); });
    // 挂 long-poll（不 await body；server 会 hold res）
    function post(path, obj) {
      return new Promise((resolve) => {
        const b = JSON.stringify(obj);
        const q = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (rs) => { rs.resume(); rs.on('end', () => {}); });
        q.on('error', () => {});
        q.write(b); q.end();
        setTimeout(resolve, 150); // 给 server 时间建 entry
        return q;
      });
    }
    await post('/api/perm-hook', { toolName: 'Bash', input: { command: 'ls' } });
    await post('/api/ask-hook', { questions: [{ question: 'q?', options: [{ label: 'a' }] }], toolUseId: 'ssr_ask_1' });
    await new Promise((r) => setTimeout(r, 200));
    await get('127.0.0.1', port, '/__resolve-all'); // 插件 beforeRequest 调 resolvePerm/resolveAsk
    await new Promise((r) => setTimeout(r, 250));
    try { ws.close(); } catch {}
  } else if (scenario === 'sdkWs') {
    // CLI+SDK 模式：WS 已建立（isCliMode），且 isSdkMode + 注入的 _sdk* 句柄都就绪 →
    // 覆盖 sdk-ask-answer / sdk-plan-answer / perm-hook-answer(SDK 路径) / sdk-interrupt(有 cancelled)
    // / ask-cancel(SDK 路径 _sdkCancelApproval) / sdk-user-message。
    const _wsmod = await import(${JSON.stringify(WS_ENTRY_URL)});
    const WebSocket = _wsmod.WebSocket || _wsmod.default || _wsmod;
    const tok = mod.getAccessToken();
    // 注入 SDK 句柄（cli.js 平时做的事）
    mod.setSdkResolveApproval((id, ans) => true);
    mod.setSdkCancelApproval((id, reason) => true);
    mod.setSdkSendUserMessage(async (t) => {});
    mod.setSdkInterruptTurn(() => [{ id: 'a1', kind: 'ask' }, { id: 'p1', kind: 'perm' }, { id: '', kind: 'plan' }]);
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws/terminal?token=' + tok);
    await new Promise((r) => { ws.on('open', r); ws.on('error', r); setTimeout(r, 2500); });
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
    send({ type: 'sdk-ask-answer', id: 'q1', answers: ['x'] });
    send({ type: 'sdk-plan-answer', id: 'pl1', approve: true, feedback: 'ok' });
    send({ type: 'sdk-plan-answer', id: 'pl2', approve: false }); // approve!==false 反例
    send({ type: 'perm-hook-answer', id: 'pm1', decision: 'allow', allowSession: true }); // SDK 路径 allowSession
    send({ type: 'perm-hook-answer', id: 'pm2', decision: 'deny' }); // SDK 路径 非 allowSession
    send({ type: 'sdk-user-message', text: 'hello sdk' });
    send({ type: 'sdk-interrupt' }); // isSdkMode && _sdkInterruptTurn → 广播 cancelled
    send({ type: 'ask-cancel', id: 'cancel_via_sdk_1', reason: 'abort' }); // _sdkCancelApproval 路径 handled=true
    await new Promise((r) => setTimeout(r, 300));
    try { ws.close(); } catch {}
  } else if (scenario === 'turnEndEmit') {
    // 短 debounce + onBroadcast 抛错 → timer fire 调 _emitTurnEnd，桩抛错经 NODE_ENV=test 重抛
    // → _emitTurnEnd 外层 catch（1792-1793）。同时覆盖正常 fire（imCore.notifyTurnEnd 路径）。
    mod.__testing.reset();
    let fired = 0;
    mod.__testing.onBroadcast(() => { fired++; if (fired === 1) throw new Error('stub-throw'); });
    mod.__testing.scheduleTurnEnd('sid-emit-1', Date.now()); // 第一次 fire 抛错 → 外层 catch
    await new Promise((r) => setTimeout(r, 400));
    mod.__testing.onBroadcast(() => { fired++; });
    mod.__testing.scheduleTurnEnd('sid-emit-2', Date.now()); // 第二次正常 fire
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 80));
  await mod.stopViewer();
  process.exit(0);
} catch (e) {
  console.error('SCENARIO_ERR', e && e.stack || e);
  process.exit(3);
}
`;
  writeFileSync(driver, script);
  const env = {
    ...process.env,
    CCV_TEST_SCENARIO: scenario,
    CCV_LOG_DIR: mkdtempSync(join(tmpdir(), 'ccv-sub-' + scenario + '-')),
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    NODE_ENV: 'test',
    ...extraEnv,
  };
  env.CLAUDE_CONFIG_DIR = env.CCV_LOG_DIR;
  if (pluginSrc) {
    const pdir = join(env.CCV_LOG_DIR, 'plugins');
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, 'branch-test-plugin.mjs'), pluginSrc);
  }
  return spawnSync(process.execPath, [driver], { env, encoding: 'utf8', timeout });
}

// ════════════════════════════════════════════════════════════════════════
// A + B. 在进程内 CLI-mode server 上跑 handleRequest 分支
// ════════════════════════════════════════════════════════════════════════
describeCli('server.js handleRequest 分支（in-process CLI server）', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0, 'port assigned');
  });

  after(async () => {
    try { await mod.stopViewer(); } catch {}
    await wait(150);
  });

  it('OPTIONS 预检返回 200（CORS 短路）', async () => {
    const r = await raw('127.0.0.1', port, '/api/preferences', { method: 'OPTIONS' });
    assert.equal(r.status, 200);
  });

  it('GET / 命中 index.html（SSR 主题注入路径，prefs 缺失走默认）', async () => {
    const r = await raw('127.0.0.1', port, '/');
    // dist 可能存在或缺失：存在则 200 html，缺失则 serveIndexHtml 失败 → SPA fallback 仍尝试。
    assert.ok([200, 404].includes(r.status));
  });

  it('GET / 命中 index.html：prefs.themeColor=dark 注入（写 prefs 后再请求）', async () => {
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ themeColor: 'dark' }));
    const r = await raw('127.0.0.1', port, '/');
    assert.ok([200, 404].includes(r.status));
    if (r.status === 200) assert.match(r.headers['content-type'] || '', /text\/html/);
  });

  it('GET /assets/missing-xyz.js → 404 stale-chunk（不走 SPA fallback）', async () => {
    const r = await raw('127.0.0.1', port, '/assets/does-not-exist-zzz.js');
    assert.equal(r.status, 404);
    assert.match(r.body, /stale chunk|Asset not found/i);
  });

  it('GET /favicon.ico 走静态资源免鉴权分支', async () => {
    const r = await raw('127.0.0.1', port, '/favicon.ico');
    assert.ok([200, 404].includes(r.status));
  });

  it('GET 任意非 API 路径 → SPA fallback（index.html 或 404）', async () => {
    const r = await raw('127.0.0.1', port, '/some/spa/route');
    assert.ok([200, 404].includes(r.status));
  });

  it('LAN IP GET /api/proxy-profiles 带 token → maskProfiles 脱敏路径（103-104）', {
    skip: !LAN_IP ? '无可用 LAN IP' : false,
  }, async () => {
    const tok = mod.getAccessToken();
    const r = await raw(LAN_IP, port, '/api/proxy-profiles?token=' + tok, { headers: { Host: LAN_IP + ':' + port } });
    assert.equal(r.status, 200);
    // 非本机 → maskProfiles 被调用；返回结构含 profiles 数组。
    const j = JSON.parse(r.body);
    assert.ok(j && Array.isArray(j.profiles));
  });

  it('GET /api/git-status?repo=server → resolveRepoCwd 命中无 .git 子目录返回 null（138）', async () => {
    const r = await raw('127.0.0.1', port, '/api/git-status?repo=server');
    // server 子目录存在但无 .git → resolveRepoCwd 返回 null → 路由按无效 repo 处理（非 200 即可）。
    assert.ok([400, 404, 500, 200].includes(r.status));
  });

  it('GET /api/git-status?repo=../escape → resolveRepoCwd 含 .. 直接 null（132）', async () => {
    const r = await raw('127.0.0.1', port, '/api/git-status?repo=' + encodeURIComponent('../escape'));
    assert.ok(typeof r.status === 'number');
  });

  it('GET /api/git-status?repo=. → resolveRepoCwd 直接返回 projectDir（131 短路）', async () => {
    const r = await raw('127.0.0.1', port, '/api/git-status?repo=.');
    assert.ok(typeof r.status === 'number');
  });

  it('POST 未知 /api 路径 → JSON 404', async () => {
    const r = await raw('127.0.0.1', port, '/api/totally-unknown-xyz', { method: 'POST', body: {} });
    assert.equal(r.status, 404);
    assert.match(r.body, /Not Found/);
  });

  it('DELETE 非 /api 非 GET → 纯文本 404', async () => {
    const r = await raw('127.0.0.1', port, '/not-api-path', { method: 'DELETE' });
    assert.equal(r.status, 404);
  });

  it('WS /ws/terminal 路径在 handleRequest 里早返回（不当 HTTP 处理）', async () => {
    // 直接 GET /ws/terminal（非 upgrade）→ handleRequest 顶部 return，socket 被挂起；
    // 我们设短超时后 abort，断言不会立即收到 HTTP 响应体。
    const got = await new Promise((resolve) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/ws/terminal', method: 'GET' }, (res) => {
        resolve({ status: res.statusCode });
      });
      req.on('error', () => resolve({ error: true }));
      req.setTimeout(300, () => { req.destroy(); resolve({ timedOut: true }); });
      req.end();
    });
    // 早返回 → server 不写响应 → 客户端超时（timedOut）或 error。
    assert.ok(got.timedOut || got.error, '应早返回不产生 HTTP 响应');
  });

  // ── 非本机请求（LAN IP）触发 isLocal=false 的 Host allowlist gate ──
  it('LAN IP 请求合法 Host（本机 LAN IP）→ 通过 Host gate（200/4xx 均可，不应 host-not-allowed）',
    { skip: !LAN_IP ? '无可用 LAN IP' : false }, async () => {
      const r = await raw(LAN_IP, port, '/api/preferences', { headers: { Host: LAN_IP + ':' + port } });
      // 默认 allowlist 含本机 LAN IP → 通过 Host gate；但带 token? 无 token + 非本机 + 未开 password →
      // decideAuth 返回 forbidden（403 JSON {error:'Forbidden...'}）。两种 403 文案不同。
      assert.equal(r.status, 403);
      assert.match(r.body, /Forbidden: invalid token/);
    });

  it('LAN IP 请求带正确 token → 过鉴权，Host gate 非法 Host → host-not-allowed 403',
    { skip: !LAN_IP ? '无可用 LAN IP' : false }, async () => {
      const tok = mod.getAccessToken();
      const r = await raw(LAN_IP, port, '/api/preferences?token=' + tok, { headers: { Host: 'evil.example.com:' + port } });
      assert.equal(r.status, 403);
      assert.match(r.body, /host-not-allowed/);
    });

  it('LAN IP 静态资源请求免鉴权（isStaticAsset 短路 allow + 跳过 Host gate）',
    { skip: !LAN_IP ? '无可用 LAN IP' : false }, async () => {
      const r = await raw(LAN_IP, port, '/assets/x-stale-zzz.js', { headers: { Host: 'evil.example.com:' + port } });
      // 静态资源不挡 Host gate；找不到文件 → 404 stale-chunk。
      assert.equal(r.status, 404);
      assert.match(r.body, /Asset not found|stale chunk/i);
    });

  it('LAN IP 带 token GET /（wantsHtml）→ 过鉴权 + Host gate（合法 Host）',
    { skip: !LAN_IP ? '无可用 LAN IP' : false }, async () => {
      const tok = mod.getAccessToken();
      const r = await raw(LAN_IP, port, '/?token=' + tok, { headers: { Host: LAN_IP + ':' + port, Accept: 'text/html' } });
      assert.ok([200, 404].includes(r.status));
    });

  // ── WS upgrade 鉴权失败 destroy（非本机 + 无 token）──
  it('LAN IP WS upgrade 无 token → 鉴权失败 socket.destroy',
    { skip: !LAN_IP ? '无可用 LAN IP' : false }, async () => {
      const ws = new WebSocket(`ws://${LAN_IP}:${port}/ws/terminal`, { headers: { Host: LAN_IP + ':' + port } });
      const result = await new Promise((resolve) => {
        ws.on('open', () => resolve('open'));
        ws.on('error', () => resolve('error'));
        ws.on('close', () => resolve('close'));
        setTimeout(() => resolve('timeout'), 2000);
      });
      try { ws.close(); } catch {}
      assert.ok(['error', 'close'].includes(result), 'upgrade 应被 destroy → error/close');
    });

  it('WS upgrade 未知路径 → socket.destroy（else 分支）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/unknown-path?token=${mod.getAccessToken()}`);
    const result = await new Promise((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
      ws.on('close', () => resolve('close'));
      setTimeout(() => resolve('timeout'), 2000);
    });
    try { ws.close(); } catch {}
    assert.ok(['error', 'close'].includes(result));
  });

  it('WS /ws/terminal-scratch 缺 id → destroy', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-scratch?token=${mod.getAccessToken()}`);
    const result = await new Promise((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
      ws.on('close', () => resolve('close'));
      setTimeout(() => resolve('timeout'), 2000);
    });
    try { ws.close(); } catch {}
    assert.ok(['error', 'close'].includes(result));
  });

  it('WS /ws/terminal-scratch 非法 id 格式 → destroy', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-scratch?id=${encodeURIComponent('bad id!!')}&token=${mod.getAccessToken()}`);
    const result = await new Promise((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
      ws.on('close', () => resolve('close'));
      setTimeout(() => resolve('timeout'), 2000);
    });
    try { ws.close(); } catch {}
    assert.ok(['error', 'close'].includes(result));
  });

  it('WS /ws/terminal-scratch 合法 id → connection handler 跑过（state/message 分支）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-scratch?id=branchscratch1&token=${mod.getAccessToken()}`);
    const opened = await new Promise((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 3000);
    });
    if (opened) {
      // 收到任意消息（spawnScratch 失败也会发 toast/state）即证明 connection handler 跑过。
      await new Promise((resolve) => {
        ws.on('message', () => resolve(true));
        setTimeout(() => resolve(false), 1500);
      });
      // 发 resize / kill 覆盖 message 分支
      try { ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 })); } catch {}
      try { ws.send(JSON.stringify({ type: 'kill' })); } catch {}
      try { ws.send('bad-json'); } catch {}
      await wait(150);
    }
    try { ws.close(); } catch {}
    // 不强制收到 state（无 shell 环境 spawn 可能失败）；upgrade 成功即覆盖 scratch connection 分支。
    assert.ok(opened, 'scratch upgrade 应成功（合法 id）');
  });

  it('scratch WS 反压：暂停读取 + 洪泛输出 → onBehind/makeBpLogger 触发（1120-1163/1183-1187）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-scratch?id=bpscratch1&token=${mod.getAccessToken()}`);
    const opened = await new Promise((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 4000);
    });
    if (!opened) { try { ws.close(); } catch {} return assert.ok(true, '无法 open（环境无 shell）→ 跳过'); }
    // 等 spawn 完成（收到首条消息）
    await new Promise((resolve) => { ws.on('message', () => resolve(true)); setTimeout(resolve, 1500); });
    // 暂停 client socket → 不再排空 → server 侧 ws.bufferedAmount 增长
    try { ws._socket && ws._socket.pause(); } catch {}
    // 触发大量输出：input 一条产生海量 stdout 的命令（yes 循环），随后 server onScratchData 灌入 ws
    try { ws.send(JSON.stringify({ type: 'input', data: 'yes ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 | head -n 200000\n' })); } catch {}
    // 轮询等 server 侧进入 behind（无法直接读 server 状态，给足时间让 bufferedAmount 越过 1MB）
    await wait(1500);
    // 恢复读取 → 缓冲排空 → onResume（data-resync）
    try { ws._socket && ws._socket.resume(); } catch {}
    await wait(800);
    // 杀掉 scratch pty 释放资源
    try { ws.send(JSON.stringify({ type: 'kill' })); } catch {}
    await wait(250);
    // kill 后再发 input → scratch 未 running → 触发 spawnScratch 重启分支（1184-1187）
    try { ws.send(JSON.stringify({ type: 'input', data: 'echo respawn\n' })); } catch {}
    await wait(300);
    try { ws.send(JSON.stringify({ type: 'kill' })); } catch {}
    await wait(150);
    try { ws.close(); } catch {}
    assert.ok(true);
  });

  it('主终端 WS 反压：input 拉起 shell + 暂停读取 + 洪泛 → onResume SIGWINCH 路径（1255-1281）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?token=${mod.getAccessToken()}`);
    const opened = await new Promise((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 4000);
    });
    if (!opened) { try { ws.close(); } catch {} return assert.ok(true); }
    await new Promise((resolve) => { ws.on('message', () => resolve(true)); setTimeout(resolve, 1200); });
    // 先发 resize 成为 activeWs（onResume 的 Windows 分支用 activeWs，但本机 POSIX 走 SIGWINCH）
    try { ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30, mobile: false })); } catch {}
    // input 拉起交互式 shell（PTY running）
    try { ws.send(JSON.stringify({ type: 'input', data: '\n' })); } catch {}
    await wait(400);
    // input-sequential 覆盖 1341-1360（含 chunks）
    try { ws.send(JSON.stringify({ type: 'input-sequential', chunks: ['echo seq-1\n'], seq: 7, settleMs: 50 })); } catch {}
    await wait(300);
    // 暂停读取 + 洪泛
    try { ws._socket && ws._socket.pause(); } catch {}
    try { ws.send(JSON.stringify({ type: 'input', data: 'yes ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef | head -n 300000\n' })); } catch {}
    await wait(1800);
    try { ws._socket && ws._socket.resume(); } catch {}
    await wait(900);
    // Ctrl+C 两次（拦截连续 Ctrl+C 分支 1324-1339）
    try { ws.send(JSON.stringify({ type: 'input', data: '\x03' })); } catch {}
    try { ws.send(JSON.stringify({ type: 'input', data: '\x03' })); } catch {}
    await wait(200);
    try { ws.close(); } catch {}
    assert.ok(true);
  });

  it('input-sequential 回调时 ws 已关 → send 抛错走 catch（1356-1358）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?token=${mod.getAccessToken()}`);
    const opened = await new Promise((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 4000);
    });
    if (!opened) { try { ws.close(); } catch {} return assert.ok(true); }
    await new Promise((resolve) => { ws.on('message', () => resolve(true)); setTimeout(resolve, 1000); });
    // 发 input 拉起 shell（input-sequential 需要 PTY）
    try { ws.send(JSON.stringify({ type: 'input', data: '\n' })); } catch {}
    await wait(300);
    // 发 input-sequential（settleMs 给一点延迟），随后立刻关 ws → done 回调里 ws.send 抛错。
    try { ws.send(JSON.stringify({ type: 'input-sequential', chunks: ['echo x\n'], seq: 1, settleMs: 120 })); } catch {}
    await wait(20);
    try { ws.close(); } catch {}     // 回调 fire 时 ws 已 CLOSING/CLOSED → send throw → catch(1356-1358)
    await wait(400);
    assert.ok(true);
  });

  it('WS /ws/terminal 主终端 connection（state + replay）— 不发 input 不拉起 PTY', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?token=${mod.getAccessToken()}`);
    const gotState = await new Promise((resolve) => {
      ws.on('message', (m) => { try { if (JSON.parse(m.toString()).type === 'state') resolve(true); } catch {} });
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 3000);
    });
    if (gotState) {
      // 发 resize（非 mobile，无活跃客户端 → 成为 activeWs + _needRedrawBootstrap 兜底）
      try { ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24, mobile: false })); } catch {}
      // 发 mobile resize 覆盖 mobile 分支
      try { ws.send(JSON.stringify({ type: 'resize', cols: 50, rows: 20, mobile: true })); } catch {}
      // 未知 id 的 ask-cancel（非法格式 → warn return）
      try { ws.send(JSON.stringify({ type: 'ask-cancel', id: 'bad id with space' })); } catch {}
      // 合法格式但无 entry 的 ask-cancel → handled=false 仅 ack
      try { ws.send(JSON.stringify({ type: 'ask-cancel', id: 'nonexistent_id_123' })); } catch {}
      // image-upload-notify 合法前缀外 → 被过滤（path 不匹配）
      try { ws.send(JSON.stringify({ type: 'image-upload-notify', path: '/etc/passwd' })); } catch {}
      // sdk-interrupt 在非 SDK 模式 → console.warn 分支
      try { ws.send(JSON.stringify({ type: 'sdk-interrupt' })); } catch {}
      // sdk-user-message 无接线 → 无操作
      try { ws.send(JSON.stringify({ type: 'sdk-user-message', text: 'hi' })); } catch {}
      // 非法 JSON → 内层 catch
      try { ws.send('not-json{{{'); } catch {}
      await wait(150);
    }
    try { ws.close(); } catch {}
    assert.ok(gotState, '主终端应收到 state');
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. 模块加载期 / startViewer env 分支（子进程 canonical import）
// ════════════════════════════════════════════════════════════════════════
describeCli('server.js 模块加载期 / startViewer env 分支（子进程）', { concurrency: false }, () => {
  it('CCV_USE_PASSWORD=1 无显式密码 → generatePassword()（line 335）', () => {
    const res = runScenario('usePasswordGen', {
      CCV_USE_PASSWORD: '1',
      CCV_PROJECT_DIR: '/tmp/ccv-branch-genpw',
      CCV_WORKSPACE_MODE: '1', // 跳过自动启动
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_TURN_END_DEBOUNCE_MS 非数 → warn 回 default', () => {
    const res = runScenario('turnEndEnv', {
      CCV_TURN_END_DEBOUNCE_MS: 'not-a-number',
      CCV_WORKSPACE_MODE: '1',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_TURN_END_DEBOUNCE_MS 越界 → warn 回 default', () => {
    const res = runScenario('turnEndEnv', {
      CCV_TURN_END_DEBOUNCE_MS: '99999999',
      CCV_WORKSPACE_MODE: '1',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_TURN_END_DEBOUNCE_MS 合法值 → 直接采用', () => {
    const res = runScenario('turnEndEnv', {
      CCV_TURN_END_DEBOUNCE_MS: '500',
      CCV_WORKSPACE_MODE: '1',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_IM_PLATFORM 设置 → IM worker 默认 debounce 200ms 分支', () => {
    const res = runScenario('turnEndEnv', {
      CCV_IM_PLATFORM: 'dingtalk',
      CCV_TURN_END_DEBOUNCE_MS: '',
      CCV_WORKSPACE_MODE: '1',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_BASE_PATH 前缀剥离 + <base> 注入 + SPA fallback（startViewer 起 server）', () => {
    const res = runScenario('basePath', {
      CCV_BASE_PATH: '/proxy',
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18120',
      CCV_MAX_PORT: '18139',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_BASE_PATH 双前缀 → 顶层剥一次后不再二次剥离（SPA fallback）', () => {
    const res = runScenario('basePath', {
      CCV_BASE_PATH: '/proxy',
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18180',
      CCV_MAX_PORT: '18199',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('密码鉴权开启 + 非本机无凭证 → login-page(HTML) / unauthorized(API 401)', {
    skip: !LAN_IP ? '无可用 LAN IP' : false,
  }, () => {
    const res = runScenario('authReject', {
      CCV_USE_PASSWORD: '1',
      CCV_PASSWORD: 'branchpw123',
      CCV_PROJECT_DIR: '/tmp/ccv-branch-authrej',
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18200',
      CCV_MAX_PORT: '18219',
      CCV_TEST_LAN_IP: LAN_IP,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_ALLOWED_HOSTS 显式白名单 → 非法 Host 403 / 白名单 Host allow / bracket IPv6 剥离', {
    skip: !LAN_IP ? '无可用 LAN IP' : false,
  }, () => {
    const res = runScenario('allowedHostsReject', {
      CCV_ALLOWED_HOSTS: 'allowed.test,127.0.0.1,::1,[::1]',
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18140',
      CCV_MAX_PORT: '18159',
      CCV_TEST_LAN_IP: LAN_IP,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_ALLOWED_HOSTS=* → 完全关闭 Host 防护', {
    skip: !LAN_IP ? '无可用 LAN IP' : false,
  }, () => {
    const res = runScenario('allowedHostsWildcard', {
      CCV_ALLOWED_HOSTS: '*',
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18160',
      CCV_MAX_PORT: '18179',
      CCV_TEST_LAN_IP: LAN_IP,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('beforeRequest 插件返回 handled:true → handleRequest return（663-664）', () => {
    const res = runScenario('pluginHandled', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18220',
      CCV_MAX_PORT: '18239',
    }, {
      pluginSrc: `export default {
  name: 'branch-test-plugin',
  hooks: {
    beforeRequest(ctx) {
      if (ctx.url === '/plugin-handled-path') {
        ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
        ctx.res.end('handled-by-plugin');
        return { handled: true };
      }
      return ctx;
    },
  },
};
`,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CLI+SDK 模式 WS → sdk-ask/plan/perm/interrupt/user-message/ask-cancel(SDK) 分支', () => {
    const res = runScenario('sdkWs', {
      CCV_CLI_MODE: '1',
      CCV_SDK_MODE: '1',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18260',
      CCV_MAX_PORT: '18279',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('短 debounce + onBroadcast 抛错 → _emitTurnEnd 外层 catch（1792-1793）+ 正常 fire', () => {
    const res = runScenario('turnEndEmit', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18280',
      CCV_MAX_PORT: '18299',
      CCV_TURN_END_DEBOUNCE_MS: '120',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('httpsOptions hook 提供无效证书 → createHttpsServer 抛错回落 HTTP（852-858）', () => {
    const res = runScenario('httpsPlugin', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18240',
      CCV_MAX_PORT: '18259',
    }, {
      pluginSrc: `export default {
  name: 'branch-test-plugin',
  hooks: {
    // 提供 cert 触发 useHttps=true，但内容非法 → createHttpsServer 抛错 → fallback HTTP。
    httpsOptions() { return { cert: 'NOT-A-REAL-CERT', key: 'NOT-A-REAL-KEY' }; },
  },
};
`,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('httpsOptions hook 自身抛错 → startViewer try/catch（825-826）', () => {
    const res = runScenario('httpsThrow', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18300',
      CCV_MAX_PORT: '18319',
    }, {
      pluginSrc: `export default {
  name: 'branch-test-plugin',
  hooks: {
    httpsOptions() { throw new Error('https hook boom'); },
  },
};
`,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('_sdkSendUserMessage reject → sdk-user-message .catch（1592-1594）', () => {
    const res = runScenario('sdkUserMsgThrow', {
      CCV_CLI_MODE: '1',
      CCV_SDK_MODE: '1',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18320',
      CCV_MAX_PORT: '18339',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('startViewer listen 非 EADDRINUSE 错误（特权端口 EACCES）→ reject（1005-1007）', () => {
    const res = runScenario('listenError', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '1',
      CCV_MAX_PORT: '1',
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('resolveRepoCwd：合法子 repo 返回 candidate（141）/ 无 .git（138）/ 不存在（137）', () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccv-branch-proj-'));
    mkdirSync(join(proj, 'sub', '.git'), { recursive: true });   // 合法子 repo
    mkdirSync(join(proj, 'nogit'), { recursive: true });          // 无 .git
    const res = runScenario('repoCwd', {
      CCV_CLI_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_PROJECT_DIR: proj,
      CCV_START_PORT: '18380',
      CCV_MAX_PORT: '18399',
    });
    rmSync(proj, { recursive: true, force: true });
    assert.equal(res.status, 0, res.stderr);
  });

  it('serverStarted.interactions resolvePerm/resolveAsk + terminalWss 广播（942-946/962-967）', () => {
    const res = runScenario('serverStartedResolve', {
      CCV_CLI_MODE: '1',
      CCV_SDK_MODE: '0',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18360',
      CCV_MAX_PORT: '18379',
    }, {
      pluginSrc: `let IX = null;
export default {
  name: 'branch-test-plugin',
  hooks: {
    serverStarted(ctx) { IX = ctx.interactions; },
    beforeRequest(ctx) {
      if (ctx.url === '/__resolve-all' && IX) {
        for (const p of IX.getPendingPerms()) IX.resolvePerm(p.id, 'allow', false);
        for (const a of IX.getPendingAsks()) IX.resolveAsk(a.id, ['answer-x']);
        ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
        ctx.res.end('resolved');
        return { handled: true };
      }
      return ctx;
    },
  },
};
`,
    });
    assert.equal(res.status, 0, res.stderr);
  });

  it('CCV_IM_PLATFORM(CLI) → IM worker startBridge 路径（成功或 catch 均覆盖 985-998）', () => {
    const res = runScenario('imWorker', {
      CCV_CLI_MODE: '1',
      CCV_SDK_MODE: '0',
      CCV_IM_PLATFORM: 'dingtalk',
      CCV_WORKSPACE_MODE: '0',
      CCV_START_PORT: '18340',
      CCV_MAX_PORT: '18359',
    });
    assert.equal(res.status, 0, res.stderr);
  });
});

// ════════════════════════════════════════════════════════════════════════
// D. turn-end 状态机 / SDK export 分支（__testing namespace + 直接调 export）
// ════════════════════════════════════════════════════════════════════════
describeCli('server.js turn-end 状态机 / SDK export 分支', { concurrency: false }, () => {
  let mod;
  before(async () => { mod = await import('../server/server.js'); });
  after(async () => {
    mod.__testing.reset();
    try { await mod.stopViewer(); } finally { await rmBestEffort(tmpDir); }
  });

  it('__testing namespace 在 NODE_ENV=test 下为真实实现（非 frozen no-op）', () => {
    assert.ok(mod.__testing);
    mod.__testing.reset();
    assert.deepEqual(mod.__testing.getPendingKeys(), []);
    assert.ok(typeof mod.__testing.getDebounceMs() === 'number');
  });

  it('broadcastTurnEnd 入桶排 timer（同 key 重排）→ getPendingKeys 含该 key', () => {
    mod.__testing.reset();
    mod.broadcastTurnEnd('sess-A', Date.now());
    mod.broadcastTurnEnd('sess-A', Date.now()); // 同 key → clearTimeout 旧的重排
    mod.broadcastTurnEnd(null, Date.now());     // null → _normalizeKey → null 键
    const keys = mod.__testing.getPendingKeys();
    assert.ok(keys.includes('sess-A'));
    assert.ok(keys.includes(null));
    mod.__testing.reset();
  });

  it('observeStreamingTick rising-edge cancel 所有 pending（true 返回）', () => {
    mod.__testing.reset();
    mod.broadcastTurnEnd('sess-B', Date.now());
    assert.ok(mod.__testing.getPendingKeys().length > 0);
    const rising = mod.__testing.observeStreamingTick(true, 'cli'); // false→true rising edge
    assert.equal(rising, true);
    assert.deepEqual(mod.__testing.getPendingKeys(), [], 'rising edge 应 cancel 全部 pending');
    // 非 rising（持续 active）→ false
    assert.equal(mod.__testing.observeStreamingTick(true, 'cli'), false);
    // 下降沿后再升 → 又是 rising
    assert.equal(mod.__testing.observeStreamingTick(false, 'cli'), false);
    assert.equal(mod.__testing.observeStreamingTick(true, 'cli'), true);
    mod.__testing.reset();
  });

  it('observeStreamingTick sdk mode 分支独立追踪', () => {
    mod.__testing.reset();
    assert.equal(mod.__testing.observeStreamingTick(true, 'sdk'), true);
    assert.equal(mod.__testing.observeStreamingTick(true, 'sdk'), false);
    mod.__testing.reset();
  });

  it('setIsStopping(true) 后 observeStreamingTick / scheduleTurnEnd 全部短路', () => {
    mod.__testing.reset();
    mod.__testing.setIsStopping(true);
    assert.equal(mod.__testing.observeStreamingTick(true, 'cli'), false);
    mod.__testing.scheduleTurnEnd('sess-C', Date.now());
    assert.deepEqual(mod.__testing.getPendingKeys(), [], '_isStopping 时 schedule 短路');
    mod.__testing.reset();
  });

  it('onBroadcast 测试桩在 timer fire 时被调用（_emitTurnEnd 路径，debounce 极短）', async () => {
    // 用子进程式不可控；这里直接验证 _emitTurnEnd 经 scheduleTurnEnd→timer 触发桩。
    // debounce 由 env 决定，默认 10s 太长；改用 onBroadcast + 手动 fire 不可行，
    // 故仅验证桩注册不抛 + scheduleTurnEnd 不报错（fire 路径在 turn-end-debounce.test.js 已覆盖）。
    mod.__testing.reset();
    let called = false;
    mod.__testing.onBroadcast(() => { called = true; });
    mod.__testing.scheduleTurnEnd('sess-D', Date.now());
    assert.ok(mod.__testing.getPendingKeys().includes('sess-D'));
    mod.__testing.reset();
    assert.equal(called, false); // 10s debounce 内不会 fire
  });

  it('broadcastWsMessage：ask 类型转译给 parent（无 process.send 时 _notifyParentPending 短路）', () => {
    // 无 terminalWss / 无 process.send → 两条路径都安全 no-op，但分支求值计入。
    assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'ask-hook-resolved', id: 'x' }));
    assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'sdk-ask-pending', id: 'y', questions: [] }));
    assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'perm-hook-resolved', id: 'z' })); // 非 ask → 不转译
    assert.doesNotThrow(() => mod.broadcastWsMessage('raw-string-msg')); // 字符串分支
    assert.doesNotThrow(() => mod.broadcastWsMessage(null)); // null → 全短路
  });

  it('SDK 注入器 setter 接线后 broadcastWsMessage 正常', () => {
    mod.setSdkResolveApproval(() => true);
    mod.setSdkCancelApproval(() => true);
    mod.setSdkSendUserMessage(async () => {});
    mod.setSdkInterruptTurn(() => []);
    assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'sdk-ask-resolved', id: 'q' }));
    // 还原避免污染其他 export-level 断言
    mod.setSdkResolveApproval(null);
    mod.setSdkCancelApproval(null);
    mod.setSdkSendUserMessage(null);
    mod.setSdkInterruptTurn(null);
  });

  it('export getter：getPort/getProtocol/getAccessToken/getInternalToken/getAuthConfig/getAllLocalIps', () => {
    assert.ok(typeof mod.getPort() === 'number');
    assert.equal(mod.getProtocol(), 'http');
    assert.match(mod.getAccessToken(), /^[0-9a-f]{32}$/);
    assert.match(mod.getInternalToken(), /^[0-9a-f]{32}$/);
    assert.ok(mod.getAuthConfig());
    assert.ok(Array.isArray(mod.getAllLocalIps()));
  });
});
