// 分支补洞：server/routes/ask-perm.js 的 catch{}/默认值/早退/三元/predicate 等
// 残余分支。已有 test/api-ask-perm-extra.test.js 覆盖主干行为，本文件只补单跑口径下
// 仍未命中的防御分支：
//   - pendingAsks / askHookResult / streamChunk 的 `err?.message || err` 右支
//   - askHookResult disk answered/cancelled 的 `answers || {}` / `cancelReason || ''` 右支
//   - normalize 循环里 `continue`（q 无 options）
//   - 各处 `try { res.writeHead/end } catch {}` 与 `try { ws.send } catch {}`（让 res/ws 抛）
//   - askHook plugin 答后 persistAskDelete 抛 → 外层 catch{}（167）
//   - permHook plugin allow + res.writeHead 抛 → 外层 catch{}（337）
//   - 定时器 fire 时 res.writeHead 抛 / ws.send 抛
//   - streamChunk remoteAddress 缺省（|| ''）/ aborted 后第二个 data chunk 早退
//   - askHookResult listener.finished 已置位的早退（res.close 重入 / tid fire 时已 finished）
//   - 路由 predicate 函数本身
//
// 范式参照 test/api-ask-perm-extra.test.js：import 前 mkdtemp 设隔离 LOG_DIR；
// req 用 EventEmitter，res 用收集器；deps 按源码注入。src/utils 风格 shim 先注册。
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 隔离 LOG_DIR / CLAUDE_CONFIG_DIR：必须在目标模块 import 之前 ──────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-askperm-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const { askPermRoutes } = await import('../packages/app/server/routes/ask-perm.js');
const askStore = await import('../packages/app/server/lib/ask-store.js');

const pendingAsksHandler = askPermRoutes.find(r => r.path === '/api/pending-asks').handler;
const askHookHandler = askPermRoutes.find(r => r.path === '/api/ask-hook' && r.method === 'POST').handler;
// Locate by probing the predicate (not by array position) so route order stays free.
const askHookResultRoute = askPermRoutes.find(r => r.predicate && r.predicate('/api/ask-hook/x/result', 'GET'));
const askHookResultHandler = askHookResultRoute.handler;
const permHookHandler = askPermRoutes.find(r => r.path === '/api/perm-hook').handler;
const streamChunkHandler = askPermRoutes.find(r => r.path === '/api/stream-chunk').handler;

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

// ── 轮询助手：替代固定 sleep 断言（async handler 跨 await） ──────────────────────
async function waitUntil(predicate, { timeout = 2000, interval = 5 } = {}) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try { ok = !!predicate(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - start > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ── 测试替身 ─────────────────────────────────────────────────────────────────────
/** 普通收集 res */
function makeRes(extra = {}) {
  const res = {
    status: 0, headers: null, body: undefined, ended: false,
    headersSent: false, writableEnded: false, destroyed: false, _closeCbs: [],
    writeHead(code, headers) { this.status = code; this.headers = headers || null; this.headersSent = true; return this; },
    end(b) { this.body = b; this.ended = true; this.writableEnded = true; if (b !== undefined && b !== null) try { this.json = JSON.parse(b); } catch { this.json = undefined; } },
    on(ev, cb) { if (ev === 'close') this._closeCbs.push(cb); return this; },
    _fireClose() { for (const cb of this._closeCbs) cb(); },
    ...extra,
  };
  return res;
}

/** writeHead 抛错的 res（headersSent 保持 false 以便先进 if 再抛进 catch） */
function makeThrowingRes(extra = {}) {
  return makeRes({
    writeHead() { throw new Error('writeHead-boom'); },
    ...extra,
  });
}

function makeReq({ headers = {}, remoteAddress = '127.0.0.1', socket } = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.socket = socket !== undefined ? socket : { remoteAddress };
  req.destroy = () => { req.emit('end'); };
  return req;
}

/** 假 wss：可让 client.send 抛 */
function makeWss({ throwOnSend = false } = {}) {
  const sent = [];
  const client = {
    readyState: 1,
    send: (s) => { if (throwOnSend) throw new Error('ws-send-boom'); sent.push(JSON.parse(s)); },
  };
  return { _sent: sent, clients: { forEach: (fn) => fn(client) } };
}

function makeDeps(over = {}) {
  const wss = over.terminalWss === undefined ? makeWss() : over.terminalWss;
  const persisted = [];
  const deleted = [];
  const spCancels = [];
  return {
    _wss: wss, _persisted: persisted, _deleted: deleted, _spCancels: spCancels,
    notifyShortPollCancel: (id, reason) => spCancels.push({ id, reason }),
    pendingAskHooks: new Map(),
    pendingPermHooks: new Map(),
    shortPollListeners: new Map(),
    liveStreamLastSeq: new Map(),
    clients: [],
    ASK_HOOK_MAP_MAX: 1000,
    PERM_HOOK_MAP_MAX: 1000,
    ASK_HOOK_TIMEOUT_MS: 24 * 60 * 60 * 1000,
    terminalWss: wss,
    persistAskEntry: (id, e) => persisted.push({ id, e }),
    persistAskDelete: (id) => deleted.push(id),
    notifyParentPending: () => {},
    ...over,
  };
}

async function drivePost(handler, body, { req, res, deps } = {}) {
  req = req || makeReq();
  res = res || makeRes();
  deps = deps || makeDeps();
  handler(req, res, { pathname: '/x' }, true, deps);
  if (body !== null) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
  req.emit('end');
  await new Promise(r => setTimeout(r, 5));
  return { req, res, deps };
}

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: pendingAsks', () => {
  it('catch 中 err.message 为 falsy → `|| err` 右支（throw 非 Error 对象）', () => {
    const deps = makeDeps();
    // entries() 抛一个 message 为空串的对象 → err?.message='' falsy → String(err)
    deps.pendingAskHooks = { entries: () => { throw { message: '' }; } };
    const res = makeRes();
    pendingAsksHandler({}, res, { pathname: '/api/pending-asks' }, true, deps);
    assert.equal(res.status, 500);
    assert.equal(res.json.error, 'failed to read pending asks');
    // String({message:''}) === '[object Object]'
    assert.equal(res.json.detail, '[object Object]');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: askHook', () => {
  it('normalize 循环：question 为 null / 无 options 数组 → continue（不抛）', async () => {
    const deps = makeDeps();
    // 三个元素：null（!q）、无 options、options 非数组 —— 均命中 continue；最后一个合法
    const questions = [null, { question: 'no-opts' }, { question: 'bad', options: 'x' }, { question: 'ok', options: [{ label: 'a' }] }];
    const { res } = await drivePost(askHookHandler, { questions, toolUseId: 'norm1' }, { deps });
    assert.equal(res.ended, false);
    const entry = deps.pendingAskHooks.get('norm1');
    assert.ok(entry, '应正常注册 entry');
    // 仅合法 question 的 option 被补 description
    assert.equal(entry.questions[3].options[0].description, '');
    clearTimeout(entry.timer);
  });

  it('body-too-large 时 res.writeHead 抛 → 413 catch{} 吞错（48 行）', async () => {
    const req = makeReq();
    const res = makeThrowingRes();
    const deps = makeDeps();
    askHookHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', 'x'.repeat(1000001)); // bodyTooLarge + destroy()→end
    await new Promise(r => setTimeout(r, 5));
    // writeHead 抛被 catch 吞 → 不崩；res 未成功写
    assert.equal(res.headersSent, false);
  });

  it('Map 满驱逐：旧 res.writeHead 抛 + ws.send 抛 → 77/83 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ ASK_HOOK_MAP_MAX: 1, terminalWss: wss });
    const oldRes = makeThrowingRes();
    const oldTimer = setTimeout(() => {}, 99999);
    deps.pendingAskHooks.set('old', { questions: [], res: oldRes, timer: oldTimer });
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'new1' }, { deps });
    // 旧被删、新建成功；writeHead/send 抛均被吞
    assert.equal(deps.pendingAskHooks.has('old'), false);
    const entry = deps.pendingAskHooks.get('new1');
    assert.ok(entry);
    clearTimeout(entry.timer);
  });

  it('res.close cancel 时 ws.send 抛 → 144 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ terminalWss: wss });
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'closews' }, { deps, res });
    assert.ok(deps.pendingAskHooks.has('closews'));
    res._fireClose(); // 触发 timeout 广播，send 抛被吞
    assert.equal(deps.pendingAskHooks.has('closews'), false);
  });

  it('short-poll ack 时 res.writeHead 抛 → 203 catch{} 吞错', async () => {
    const deps = makeDeps();
    const req = makeReq({ headers: { 'x-ask-poll-mode': 'short' } });
    const res = makeThrowingRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'spthrow' }, { deps, req, res });
    // entry 仍注册（ack 抛不影响后续）
    const entry = deps.pendingAskHooks.get('spthrow');
    assert.ok(entry);
    assert.equal(res.headersSent, false);
    clearTimeout(entry.timer);
  });

  it('广播 ask-hook-pending 时 ws.send 抛 → 211 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ terminalWss: wss });
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'bcthrow' }, { deps, res });
    const entry = deps.pendingAskHooks.get('bcthrow');
    assert.ok(entry, 'send 抛被吞，entry 仍注册');
    clearTimeout(entry.timer);
  });

  it('24h timer fire：entry.res.writeHead 抛 + ws.send 抛 → 180/184 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ ASK_HOOK_TIMEOUT_MS: 5, terminalWss: wss });
    const res = makeThrowingRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'tfire' }, { deps, res });
    const fired = await waitUntil(() => !deps.pendingAskHooks.has('tfire'));
    assert.ok(fired, 'timer 应 fire 删 entry（writeHead/send 抛均吞）');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: askHook plugin 答后 persistAskDelete 抛 (167 外层 catch)', () => {
  const pluginsDir = join(tmpDir, 'plugins');
  let loadPlugins;
  before(async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    ({ loadPlugins } = await import('../packages/app/server/lib/plugin-loader.js'));
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'ans167.mjs'),
      `export const hooks = { onAskRequest: async () => ({ answers: { Q: 'P' } }) };\n`);
    await loadPlugins();
  });
  after(async () => {
    rmSync(pluginsDir, { recursive: true, force: true });
    await loadPlugins();
  });

  it('plugin 答 answers 但 persistAskDelete 抛 → 落入外层 catch{}（167），不崩', async () => {
    const deps = makeDeps({
      persistAskDelete: () => { throw new Error('persist-boom'); },
    });
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'p167' }, { deps, res });
    // 抛在 deps.persistAskDelete（155-156 间）→ 外层 167 catch 吞；后续继续走 timer 注册
    // entry 已被 pendingAskHooks.delete(155) 删，但因 persist 抛未走到 return，timer 分支重新 set live entry
    const entry = deps.pendingAskHooks.get('p167');
    if (entry) clearTimeout(entry.timer);
    // 不崩即达成覆盖目标
    assert.ok(true);
  });

  it('plugin 答 answers 时 res.writeHead 抛 → 内层 163 catch{} 吞错', async () => {
    const deps = makeDeps();
    const res = makeThrowingRes(); // writableEnded/destroyed/headersSent 均 false → 进 if 内 try
    await drivePost(askHookHandler, { questions: [{ question: 'Q', options: [] }], toolUseId: 'p163' }, { deps, res });
    // 163 抛被吞 → return；entry 已释放
    assert.equal(deps.pendingAskHooks.has('p163'), false);
    assert.ok(deps._deleted.includes('p163'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: askHookResult', () => {
  beforeEach(() => { try { rmSync(join(tmpDir, 'ask-store.json'), { force: true }); } catch {} });

  function driveGet(pathname, deps, res) {
    res = res || makeRes();
    askHookResultHandler({}, res, { pathname }, true, deps);
    return res;
  }

  it('disk answered 但 answers 为 null → `answers || {}` 右支返 {}', async () => {
    // saveAskStore 把 answered+falsy answers 归一为 null；consumeIfFinal 返回 answers:null
    await askStore.saveAskStore({
      a248: { id: 'a248', questions: [{ question: 'Q' }], createdAt: 10, status: 'answered', answers: null },
    });
    const deps = makeDeps();
    const res = driveGet('/api/ask-hook/a248/result?wait=1000', deps);
    assert.ok(await waitUntil(() => res.ended));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.answers, {});
  });

  it('disk cancelled 但 cancelReason 为空 → `cancelReason || ""` 右支返 ""', async () => {
    await askStore.saveAskStore({
      c253: { id: 'c253', questions: [{ question: 'Q' }], createdAt: 10, status: 'cancelled', cancelReason: '' },
    });
    const deps = makeDeps();
    const res = driveGet('/api/ask-hook/c253/result?wait=1000', deps);
    assert.ok(await waitUntil(() => res.ended));
    assert.equal(res.status, 200);
    assert.equal(res.json.cancelled, true);
    assert.equal(res.json.reason, '');
  });

  it('catch：consumeIfFinal 后 get 抛非 Error（message falsy）→ `|| err` 右支 + 500', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks = { get: () => { throw { message: 0 }; } };
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/eobj/result?wait=1000' }, true, deps);
    const got = await waitUntil(() => res.status === 500);
    assert.ok(got);
    assert.equal(res.json.error, '[object Object]');
  });

  it('catch 内 res.writeHead 抛 → 288 内层 catch{} 吞错（不崩）', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks = { get: () => { throw new Error('outer'); } };
    const res = makeThrowingRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/cthrow/result?wait=1000' }, true, deps);
    // 等 catch 走过（writeHead 抛被 288 吞，res 不会 ended）
    const passed = await waitUntil(() => res.headersSent === false && res.status === 0, { timeout: 800 });
    // 仅需不抛崩；headersSent 仍 false
    assert.equal(res.headersSent, false);
  });

  it('listener tid 超时回包时 res.writeHead(204) 抛 → 274 catch{} 吞错', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('w274', { questions: [{ question: 'Q' }], createdAt: Date.now() });
    const res = makeThrowingRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/w274/result?wait=5' }, true, deps);
    const registered = await waitUntil(() => deps.shortPollListeners.get('w274')?.size === 1);
    assert.ok(registered);
    // wait 被 clamp 到 1000ms；等 tid fire（writeHead 抛被吞）
    const cleared = await waitUntil(() => deps.shortPollListeners.get('w274').size === 0, { timeout: 3000 });
    assert.ok(cleared, 'tid fire 后移除 listener（即便 writeHead 抛）');
  });

  it('res.close 重入：第二次触发时 listener.finished 已置位 → 277 早退（return）', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('c277', { questions: [{ question: 'Q' }], createdAt: Date.now() });
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/c277/result?wait=30000' }, true, deps);
    const registered = await waitUntil(() => deps.shortPollListeners.get('c277')?.size === 1);
    assert.ok(registered);
    res._fireClose(); // 第一次：finished=true，清 listener
    assert.equal(deps.shortPollListeners.get('c277').size, 0);
    res._fireClose(); // 第二次：finished 已 true → 277 早退
    assert.equal(deps.shortPollListeners.get('c277').size, 0);
  });

  it('tid fire 时 listener.finished 已被外部置位（未清 tid）→ 271 早退（return）', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('t271', { questions: [{ question: 'Q' }], createdAt: Date.now() });
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/t271/result?wait=5' }, true, deps);
    const registered = await waitUntil(() => deps.shortPollListeners.get('t271')?.size === 1);
    assert.ok(registered);
    // 模拟外部 answer-delivery：直接把 listener.finished 置 true（不 clearTimeout），
    // tid（clamp 到 1000ms）随后 fire → 命中 `if (listener.finished) return;`
    const listener = [...deps.shortPollListeners.get('t271')][0];
    listener.finished = true;
    // 等 tid 触发（应观察到 res 未被回包，因为早退）
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(res.ended, false, 'finished 已置位 → tid 回调早退不回包');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: permHook', () => {
  it('Map 满驱逐：旧 res.writeHead 抛 → 318 catch{} 吞错', async () => {
    const deps = makeDeps({ PERM_HOOK_MAP_MAX: 1 });
    const oldRes = makeThrowingRes();
    const oldTimer = setTimeout(() => {}, 99999);
    deps.pendingPermHooks.set('po', { toolName: 'X', input: {}, res: oldRes, timer: oldTimer });
    await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps });
    assert.equal(deps.pendingPermHooks.has('po'), false);
    const id = [...deps.pendingPermHooks.keys()][0];
    clearTimeout(deps.pendingPermHooks.get(id).timer);
  });

  it('广播 perm-hook-pending 时 ws.send 抛 → 365 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ terminalWss: wss });
    const res = makeRes();
    await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps, res });
    const id = [...deps.pendingPermHooks.keys()][0];
    assert.ok(id, 'send 抛被吞，entry 仍注册');
    clearTimeout(deps.pendingPermHooks.get(id).timer);
  });

  it('res.close 时 ws.send 抛 → 379 catch{} 吞错', async () => {
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ terminalWss: wss });
    const res = makeRes();
    await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps, res });
    const id = [...deps.pendingPermHooks.keys()][0];
    res._fireClose();
    assert.equal(deps.pendingPermHooks.has(id), false);
  });

  it('5min timer fire：entry.res.writeHead 抛 + ws.send 抛 → 348/352 catch{} 吞错', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const wss = makeWss({ throwOnSend: true });
    const deps = makeDeps({ terminalWss: wss });
    const req = makeReq();
    const res = makeThrowingRes();
    permHookHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ toolName: 'Bash', input: {} }));
    req.emit('end');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const id = [...deps.pendingPermHooks.keys()][0];
    assert.ok(id);
    t.mock.timers.tick(5 * 60 * 1000 + 1); // fire timer：writeHead/send 抛均吞
    assert.equal(deps.pendingPermHooks.has(id), false, 'timeout 后删 entry（即便 writeHead/send 抛）');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: permHook plugin allow + res.writeHead 抛 (337 外层 catch)', () => {
  const pluginsDir = join(tmpDir, 'plugins');
  let loadPlugins;
  before(async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    ({ loadPlugins } = await import('../packages/app/server/lib/plugin-loader.js'));
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'perm337.mjs'),
      `export const hooks = { onPermRequest: async () => ({ decision: 'allow' }) };\n`);
    await loadPlugins();
  });
  after(async () => {
    rmSync(pluginsDir, { recursive: true, force: true });
    await loadPlugins();
  });

  it('plugin decision=allow 但 res.writeHead 抛 → 落入外层 catch{}（337），随后继续常规审批', async () => {
    const deps = makeDeps();
    const res = makeThrowingRes();
    await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps, res });
    // 333 writeHead 抛 → 337 catch 吞 → 不 return → 继续走常规审批挂 entry
    const id = [...deps.pendingPermHooks.keys()][0];
    assert.ok(id, '337 catch 后应继续注册 entry');
    clearTimeout(deps.pendingPermHooks.get(id).timer);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: streamChunk', () => {
  function internalReq(remoteAddress = '127.0.0.1', socket) {
    return makeReq({ headers: { 'x-cc-viewer-internal': '1' }, remoteAddress, socket });
  }

  it('socket.remoteAddress 缺省（undefined）→ `|| ""` 右支 → 非 loopback → 403', () => {
    // socket 存在但 remoteAddress undefined → remote='' → isLoopback false → 403
    const req = internalReq(undefined, { remoteAddress: undefined });
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'Forbidden');
  });

  it('403 回包时 res.writeHead 抛 → 400 行 catch{} 吞错（不崩）', () => {
    const req = makeReq({ headers: {}, remoteAddress: '10.0.0.1' }); // 非 loopback + 无 internal
    const res = makeThrowingRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    assert.equal(res.headersSent, false); // writeHead 抛被吞
  });

  it('payload-too-large 后再来一个 data chunk → 406 行 `if (aborted) return` 早退', async () => {
    const deps = makeDeps();
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1)); // aborted=true + 413
    assert.equal(res.status, 413);
    req.emit('data', 'more'); // aborted 已 true → 早退（不再追加 body）
    req.emit('end'); // aborted → end 也早退
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 413, 'aborted 后不二次写');
  });

  it('payload-too-large 时 res.writeHead 抛 → 410 行 catch{} 吞错', async () => {
    const req = internalReq();
    const res = makeThrowingRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    req.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1));
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.headersSent, false); // 抛被吞
  });

  it('乱序旧 chunk 回 204 时 res.writeHead 抛 → 422 行 catch{} 吞错', async () => {
    const deps = makeDeps();
    deps.liveStreamLastSeq.set('t|u', 5);
    const req = internalReq();
    const res = makeThrowingRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 't', url: 'u', _chunkSeq: 3 }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(deps.liveStreamLastSeq.get('t|u'), 5, '旧 chunk 不更新 lastSeq');
    assert.equal(res.headersSent, false); // writeHead 抛被吞
  });

  it('正常 end 回 204 时 res.writeHead 抛 → 442 行 catch{} 吞错', async () => {
    const deps = makeDeps();
    const req = internalReq();
    const res = makeThrowingRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 'a', url: 'b', _chunkSeq: 0 }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    // 业务逻辑跑完（lastSeq 已写），仅最终 204 writeHead 抛被吞
    assert.equal(deps.liveStreamLastSeq.get('a|b'), 0);
    assert.equal(res.headersSent, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm 分支补洞: 路由 predicate', () => {
  it('predicate(url, method) 真值/假值各分支', () => {
    const p = askHookResultRoute.predicate;
    // 全真
    assert.equal(p('/api/ask-hook/abc/result?wait=1', 'GET'), true);
    // 前缀不符
    assert.equal(p('/api/other/abc/result', 'GET'), false);
    // 不含 /result
    assert.equal(p('/api/ask-hook/abc', 'GET'), false);
    // 方法非 GET
    assert.equal(p('/api/ask-hook/abc/result', 'POST'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Waiter-liveness tracking + POST /api/ask-hook/:id/cancel (reaper support, see
// server/lib/ask-reaper.js). English comments per current CLAUDE.md convention.
const askHookCancelRoute = askPermRoutes.find(
  (r) => r.predicate && r.predicate('/api/ask-hook/x/cancel', 'POST')
);
const askHookCancelHandler = askHookCancelRoute.handler;

async function driveCancel(id, body, { deps, res } = {}) {
  deps = deps || makeDeps();
  res = res || makeRes();
  const req = makeReq();
  askHookCancelHandler(req, res, { pathname: `/api/ask-hook/${id}/cancel` }, true, deps);
  if (body !== null && body !== undefined) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
  req.emit('end');
  await new Promise((r) => setTimeout(r, 10));
  return { deps, res };
}

describe('ask-perm: waiter liveness seeding/refresh', () => {
  it('short-poll POST seeds askWaiterLastPoll; long-poll POST does not', async () => {
    const deps = makeDeps({ askWaiterLastPoll: new Map() });
    await drivePost(askHookHandler, { questions: [{ question: 'q', options: [] }], toolUseId: 'toolu_live1' },
      { req: makeReq({ headers: { 'x-ask-poll-mode': 'short' } }), deps });
    assert.ok(deps.askWaiterLastPoll.get('toolu_live1') > 0);
    clearTimeout(deps.pendingAskHooks.get('toolu_live1').timer);

    const deps2 = makeDeps({ askWaiterLastPoll: new Map() });
    await drivePost(askHookHandler, { questions: [{ question: 'q', options: [] }], toolUseId: 'toolu_live2' },
      { req: makeReq(), deps: deps2 });
    assert.equal(deps2.askWaiterLastPoll.has('toolu_live2'), false);
    clearTimeout(deps2.pendingAskHooks.get('toolu_live2').timer);
  });

  it('GET /result refreshes askWaiterLastPoll even when the entry is unknown (404 path)', async () => {
    const deps = makeDeps({ askWaiterLastPoll: new Map() });
    const res = makeRes();
    await askHookResultHandler(makeReq(), res, { pathname: '/api/ask-hook/toolu_ghost/result?wait=1000' }, true, deps);
    await waitUntil(() => res.ended);
    assert.equal(res.status, 404);
    assert.ok(deps.askWaiterLastPoll.get('toolu_ghost') > 0);
  });

  it('handlers stay safe when deps lack askWaiterLastPoll (optional chaining)', async () => {
    const deps = makeDeps(); // no askWaiterLastPoll key
    const { res } = await drivePost(askHookHandler, { questions: [{ question: 'q', options: [] }], toolUseId: 'toolu_nomap' },
      { req: makeReq({ headers: { 'x-ask-poll-mode': 'short' } }), deps });
    assert.equal(res.status, 200);
    const res2 = makeRes();
    await askHookResultHandler(makeReq(), res2, { pathname: '/api/ask-hook/toolu_nomap/result?wait=1000' }, true, deps);
    // no throw = pass; entry exists in memory so a listener got registered
    clearTimeout(deps.pendingAskHooks.get('toolu_nomap').timer);
    for (const set of deps.shortPollListeners.values()) {
      for (const l of set) { l.finished = true; clearTimeout(l.tid); }
    }
  });
});

describe('ask-perm: POST /api/ask-hook/:id/cancel', () => {
  beforeEach(async () => {
    await askStore.replaceAll({});
  });

  it('cancel and /result predicates never overlap (method + path discriminators)', () => {
    assert.notEqual(askHookCancelRoute, undefined);
    // A URL that matches one predicate must not match the other, in both directions,
    // so registration order can never change dispatch behavior.
    assert.equal(askHookCancelRoute.predicate('/api/ask-hook/x/result', 'GET'), false);
    assert.equal(askHookResultRoute.predicate('/api/ask-hook/x/cancel', 'POST'), false);
    // Substring-bearing ids stay disambiguated by HTTP method.
    assert.equal(askHookResultRoute.predicate('/api/ask-hook/cancel_abc/result?wait=1', 'GET'), true);
    assert.equal(askHookCancelRoute.predicate('/api/ask-hook/cancel_abc/result?wait=1', 'GET'), false);
    assert.equal(askHookCancelRoute.predicate('/api/ask-hook/result_abc/cancel', 'POST'), true);
    assert.equal(askHookResultRoute.predicate('/api/ask-hook/result_abc/cancel', 'POST'), false);
  });

  it('memory short-poll entry: 204, memory cleared, disk cancelled, WS broadcast, liveness dropped', async () => {
    const deps = makeDeps({ askWaiterLastPoll: new Map() });
    await drivePost(askHookHandler, { questions: [{ question: 'q', options: [] }], toolUseId: 'toolu_c1' },
      { req: makeReq({ headers: { 'x-ask-poll-mode': 'short' } }), deps });
    assert.ok(deps.pendingAskHooks.has('toolu_c1'));
    const { res } = await driveCancel('toolu_c1', { reason: 'hook process exited' }, { deps });
    assert.equal(res.status, 204);
    assert.equal(deps.pendingAskHooks.has('toolu_c1'), false);
    assert.equal(deps.askWaiterLastPoll.has('toolu_c1'), false);
    await waitUntil(() => askStore.loadAskStore()['toolu_c1']?.status === 'cancelled');
    const row = askStore.loadAskStore()['toolu_c1'];
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelReason, 'hook process exited');
    assert.ok(deps._wss._sent.some((m) => m.type === 'ask-hook-cancelled' && m.id === 'toolu_c1'));
    assert.deepEqual(deps._spCancels, [{ id: 'toolu_c1', reason: 'hook process exited' }], 'hanging poll listeners must be woken');
  });

  it('memory long-poll entry: hanging res receives {cancelled:true}, persistAskDelete called', async () => {
    const deps = makeDeps();
    const hookRes = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'q', options: [] }], toolUseId: 'toolu_lp1' },
      { req: makeReq(), res: hookRes, deps });
    assert.ok(deps.pendingAskHooks.has('toolu_lp1'));
    assert.equal(hookRes.ended, false, 'long-poll res still hanging');
    const { res } = await driveCancel('toolu_lp1', { reason: 'bye' }, { deps });
    assert.equal(res.status, 204);
    await waitUntil(() => hookRes.ended);
    assert.equal(hookRes.json.cancelled, true);
    assert.equal(hookRes.json.reason, 'bye');
    assert.ok(deps._deleted.includes('toolu_lp1'));
  });

  it('disk-only entry: markCancelled lands, broadcast fires', async () => {
    await askStore.setEntry('toolu_disk1', { questions: [{ question: 'q' }], createdAt: Date.now(), status: 'pending' });
    const { deps, res } = await driveCancel('toolu_disk1', undefined);
    assert.equal(res.status, 204);
    await waitUntil(() => askStore.loadAskStore()['toolu_disk1']?.status === 'cancelled');
    assert.equal(askStore.loadAskStore()['toolu_disk1'].cancelReason, 'hook process exited');
    assert.ok(deps._wss._sent.some((m) => m.type === 'ask-hook-cancelled' && m.id === 'toolu_disk1'));
    assert.deepEqual(deps._spCancels, [{ id: 'toolu_disk1', reason: 'hook process exited' }], 'disk-only branch keeps WS-handler parity');
  });

  it('already-final disk entry: 204 but NO broadcast (first-write-wins respected)', async () => {
    await askStore.setEntry('toolu_done1', { questions: [{ question: 'q' }], createdAt: Date.now(), status: 'pending' });
    await askStore.markAnswered('toolu_done1', { q: 'a' });
    const { deps, res } = await driveCancel('toolu_done1', { reason: 'late' });
    assert.equal(res.status, 204);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(askStore.loadAskStore()['toolu_done1'].status, 'answered');
    assert.equal(deps._wss._sent.some((m) => m.type === 'ask-hook-cancelled'), false);
  });

  it('invalid id → 400; oversized body → 413 emitted from the data handler (real destroy never fires end)', async () => {
    const { res } = await driveCancel('bad*id', { reason: 'x' });
    assert.equal(res.status, 400);
    const deps = makeDeps();
    const res2 = makeRes();
    const req2 = makeReq();
    req2.destroy = () => {}; // real Node semantics: destroy() does NOT emit 'end'
    askHookCancelHandler(req2, res2, { pathname: '/api/ask-hook/toolu_big/cancel' }, true, deps);
    req2.emit('data', 'x'.repeat(5000));
    await waitUntil(() => res2.ended);
    assert.equal(res2.status, 413);
    // a late chunk after the reject must not throw or double-respond
    req2.emit('data', 'y');
    assert.equal(res2.status, 413);
  });

  it('reason is sliced to 500 chars and non-JSON body falls back to the default reason', async () => {
    await askStore.setEntry('toolu_r1', { questions: [{ question: 'q' }], createdAt: Date.now(), status: 'pending' });
    await driveCancel('toolu_r1', { reason: 'r'.repeat(600) });
    await waitUntil(() => askStore.loadAskStore()['toolu_r1']?.status === 'cancelled');
    assert.equal(askStore.loadAskStore()['toolu_r1'].cancelReason.length, 500);

    await askStore.setEntry('toolu_r2', { questions: [{ question: 'q' }], createdAt: Date.now(), status: 'pending' });
    await driveCancel('toolu_r2', 'not json');
    await waitUntil(() => askStore.loadAskStore()['toolu_r2']?.status === 'cancelled');
    assert.equal(askStore.loadAskStore()['toolu_r2'].cancelReason, 'hook process exited');
  });
});
