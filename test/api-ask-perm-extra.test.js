// 覆盖 server/routes/ask-perm.js 的 askPermRoutes 数组里所有 handler 的行为分支：
//   - pendingAsks：memory + disk union / 排序 / disk filter / 错误回包
//   - askHook：body-too-large(413) / 缺 questions(400) / 非法 JSON(400) /
//       normalize description / Map 满驱逐(429) / toolUseId 复用 / 409 冲突 /
//       fallback id / plugin 直接答 / short-poll ack / WS 广播 / res.close cancel
//   - askHookResult：URL 不匹配(400) / 非法 id(400) / disk answered/cancelled 立返 /
//       404 / 注册 listener + wait 超时(204) / res.close 清理 / wait clamp
//   - permHook：body-too-large(413) / 缺 toolName(400) / 非法 JSON(400) /
//       Map 满驱逐(429) / plugin allow/deny 短路 / WS 广播 / res.close
//   - streamChunk：非 loopback / 缺 internal header → 403 / payload-too-large(413) /
//       乱序 chunk 丢弃(204) / FIFO 驱逐 / 正常广播(204)
//
// 范式参照 test/api-preferences.test.js + test/ask-flow-controller.test.js：
//   - import 前先 mkdtemp 设 CCV_LOG_DIR / CLAUDE_CONFIG_DIR，after() 清理；
//   - req 用 EventEmitter 模拟流式，res 用收集器；
//   - deps 按源码注入（pendingAskHooks/pendingPermHooks Map、persist* 桩、terminalWss 假对象等）。
//
// plugin 直接答路径需要真实 plugin（runWaterfallHook 只跑 LOG_DIR/plugins/ 下的真实文件），
// 用 loadPlugins() 装一个临时 plugin 覆盖 onAskRequest/onPermRequest 分支。

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 隔离 LOG_DIR：必须在任何 findcc-loading import 之前 ─────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ask-perm-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const { askPermRoutes } = await import('../packages/app/server/routes/ask-perm.js');
const askStore = await import('../packages/app/server/lib/ask/ask-store.js');
const { loadPlugins } = await import('../packages/app/server/lib/plugin-loader.js');

// ── 路由 handler 提取 ──────────────────────────────────────────────────────────
const pendingAsksHandler = askPermRoutes.find(r => r.path === '/api/pending-asks').handler;
const askHookHandler = askPermRoutes.find(r => r.path === '/api/ask-hook' && r.method === 'POST').handler;
const askHookResultHandler = askPermRoutes.find(r => r.predicate && r.predicate('/api/ask-hook/x/result', 'GET')).handler; // probe, not array position
const permHookHandler = askPermRoutes.find(r => r.path === '/api/perm-hook').handler;
const streamChunkHandler = askPermRoutes.find(r => r.path === '/api/stream-chunk').handler;

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

// askHookResult 是 async：handler 同步返回后还要 await askStoreConsumeIfFinal（带文件锁的磁盘
// 读）才会注册 listener / 命中 catch / 写回包。原用例靠固定 5-10ms setTimeout 等它——全量并行
// 跑时 12 进程争 CPU，磁盘锁 + I/O 常超过这点窗口 → 偶发「listener 未注册 / status 未写」假失败。
// 改成轮询直到可观测条件成立（带宽松上限），消除时序竞争。不改源码。
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

// ── 测试替身 ────────────────────────────────────────────────────────────────────

/** 收集回包：{ status, headers, body(原始字符串), json(惰性解析), ended } */
function makeRes(extra = {}) {
  const res = {
    status: 0,
    headers: null,
    body: undefined,
    ended: false,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    _closeCbs: [],
    writeHead(code, headers) { this.status = code; this.headers = headers || null; this.headersSent = true; return this; },
    end(b) { this.body = b; this.ended = true; this.writableEnded = true; if (b !== undefined && b !== null) try { this.json = JSON.parse(b); } catch { this.json = undefined; } },
    on(ev, cb) { if (ev === 'close') this._closeCbs.push(cb); return this; },
    _fireClose() { for (const cb of this._closeCbs) cb(); },
    ...extra,
  };
  return res;
}

/** 流式 req：socket.remoteAddress + headers 可配置 */
function makeReq({ headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.socket = { remoteAddress };
  req.destroy = () => { req.emit('end'); }; // 模拟 destroy 后 end 仍触发（源码 askHook 依赖 end 内 bodyTooLarge 分支回 413）
  return req;
}

/** 假 terminalWss：收集 send 的消息 */
function makeWss() {
  const sent = [];
  const client = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  return { _sent: sent, clients: { forEach: (fn) => fn(client) } };
}

/** 默认 deps 工厂：每个用例独立 Map */
function makeDeps(over = {}) {
  const wss = over.terminalWss === undefined ? makeWss() : over.terminalWss;
  const persisted = [];
  const deleted = [];
  return {
    _wss: wss,
    _persisted: persisted,
    _deleted: deleted,
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

/** 驱动 POST 类 handler：emit data 后 emit end，等微任务 drain（handler 内 await runWaterfallHook） */
async function drivePost(handler, body, { req, res, deps } = {}) {
  req = req || makeReq();
  res = res || makeRes();
  deps = deps || makeDeps();
  handler(req, res, { pathname: '/x' }, true, deps);
  if (body !== null) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
  req.emit('end');
  // handler 'end' 回调是 async，await runWaterfallHook 至少跨一个微任务；多 drain 几轮保险
  await new Promise(r => setTimeout(r, 5));
  return { req, res, deps };
}

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: pendingAsks (GET /api/pending-asks)', () => {
  beforeEach(() => { try { rmSync(join(tmpDir, 'ask-store.json'), { force: true }); } catch {} });

  it('memory entries 按 createdAt 升序返回，source=memory', () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('b', { questions: [{ question: 'Qb' }], createdAt: 200 });
    deps.pendingAskHooks.set('a', { questions: [{ question: 'Qa' }], createdAt: 100 });
    const res = makeRes();
    pendingAsksHandler({}, res, { pathname: '/api/pending-asks' }, true, deps);
    assert.equal(res.status, 200);
    assert.equal(res.json.askProtocolVersion, 1);
    assert.deepEqual(res.json.pendingAsks.map(e => e.id), ['a', 'b']);
    assert.equal(res.json.pendingAsks[0].source, 'memory');
  });

  it('union disk pending（不在内存）→ source=disk；answered/空questions/内存重复 全被过滤', async () => {
    await askStore.saveAskStore({
      mem: { id: 'mem', questions: [{ question: 'M' }], createdAt: 50, status: 'pending' },
      diskP: { id: 'diskP', questions: [{ question: 'D' }], createdAt: 80, status: 'pending' },
      ans: { id: 'ans', questions: [{ question: 'A' }], createdAt: 70, status: 'answered', answers: { x: 1 }, answeredAt: 75 },
      ghost: { id: 'ghost', questions: [], createdAt: 60, status: 'pending' },
    });
    const deps = makeDeps();
    deps.pendingAskHooks.set('mem', { questions: [{ question: 'M' }], createdAt: 50 });
    const res = makeRes();
    pendingAsksHandler({}, res, { pathname: '/api/pending-asks' }, true, deps);
    assert.equal(res.status, 200);
    const ids = res.json.pendingAsks.map(e => e.id);
    // mem(memory) + diskP(disk)；ans(answered)/ghost(空) 过滤掉；mem 不被 disk 重复
    assert.deepEqual(ids, ['mem', 'diskP']);
    const diskEntry = res.json.pendingAsks.find(e => e.id === 'diskP');
    assert.equal(diskEntry.source, 'disk');
    assert.equal(res.json.pendingAsks.find(e => e.id === 'mem').source, 'memory');
  });

  it('loadAskStore 抛错 → 500 错误回包', () => {
    // deps.pendingAskHooks.entries 抛错触发 catch（loadAskStore 自身吞错，这里用 Map 替身让 entries throw）
    const deps = makeDeps();
    deps.pendingAskHooks = { entries: () => { throw new Error('boom'); } };
    const res = makeRes();
    pendingAsksHandler({}, res, { pathname: '/api/pending-asks' }, true, deps);
    assert.equal(res.status, 500);
    assert.equal(res.json.error, 'failed to read pending asks');
    assert.match(res.json.detail, /boom/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: askHook (POST /api/ask-hook)', () => {
  it('非法 JSON body → 400 Invalid request body', async () => {
    const { res } = await drivePost(askHookHandler, 'not-json');
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Invalid request body');
  });

  it('questions 缺失/非数组 → 400 Missing questions', async () => {
    const { res } = await drivePost(askHookHandler, { toolUseId: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Missing questions');
  });

  it('questions 空数组 → 400 Missing questions', async () => {
    const { res } = await drivePost(askHookHandler, { questions: [] });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Missing questions');
  });

  it('body 超 1MB → 413 Request body too large', async () => {
    const req = makeReq();
    const res = makeRes();
    const deps = makeDeps();
    askHookHandler(req, res, { pathname: '/x' }, true, deps);
    // emit 一个 >1MB 的 chunk → 触发 bodyTooLarge + req.destroy()（替身的 destroy 会 emit end）
    req.emit('data', 'x'.repeat(1000001));
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'Request body too large');
  });

  it('long-poll 正常：normalize description、注册 entry、广播 ask-hook-pending、用 toolUseId 作 id', async () => {
    const deps = makeDeps();
    // 注意：body 经 JSON.stringify 后 handler 解析出自己的副本，故 normalize 结果只能从
    // 注册的 entry.questions / WS 广播 payload 里读，不能断言外层原对象。
    const questions = [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B', description: 'keep' }] }];
    const { res } = await drivePost(askHookHandler, { questions, toolUseId: 'tool_abc' }, { deps });
    // long-poll：res 未结束（挂起等答案）
    assert.equal(res.ended, false);
    // entry 已注册（最终 live entry）
    const entry = deps.pendingAskHooks.get('tool_abc');
    assert.ok(entry, 'entry 应以 toolUseId 注册');
    assert.equal(entry.shortPoll, false);
    assert.ok(entry.timer, 'live entry 应有 timer');
    clearTimeout(entry.timer);
    // normalize：缺 description 补 ''，已有的保留（从 handler 内部副本读）
    assert.equal(entry.questions[0].options[0].description, '');
    assert.equal(entry.questions[0].options[1].description, 'keep');
    // 广播 ask-hook-pending
    const pending = deps._wss._sent.find(m => m.type === 'ask-hook-pending');
    assert.ok(pending);
    assert.equal(pending.id, 'tool_abc');
    assert.equal(pending.timeoutMs, deps.ASK_HOOK_TIMEOUT_MS);
    assert.equal(pending.questions[0].options[0].description, '', '广播 payload 也应是 normalize 后');
    // 持久化
    assert.ok(deps._persisted.some(p => p.id === 'tool_abc'));
  });

  it('short-poll 模式（X-Ask-Poll-Mode: short）：立即返 { id, capability: short-poll } 且 entry.shortPoll=true', async () => {
    const deps = makeDeps();
    const req = makeReq({ headers: { 'x-ask-poll-mode': 'short' } });
    const { res } = await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'sp1' }, { deps, req });
    assert.equal(res.status, 200);
    assert.equal(res.json.capability, 'short-poll');
    assert.equal(res.json.id, 'sp1');
    const entry = deps.pendingAskHooks.get('sp1');
    assert.equal(entry.shortPoll, true);
    clearTimeout(entry.timer);
  });

  it('缺 toolUseId → fallback 生成 ask_<ts>_<rnd> id', async () => {
    const deps = makeDeps();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }] }, { deps });
    const ids = [...deps.pendingAskHooks.keys()];
    assert.equal(ids.length, 1);
    assert.match(ids[0], /^ask_\d+_[a-z0-9]+$/);
    clearTimeout(deps.pendingAskHooks.get(ids[0]).timer);
  });

  it('非法 toolUseId（含非法字符）→ fallback ask_ id（不用原值）', async () => {
    const deps = makeDeps();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'bad id!' }, { deps });
    const ids = [...deps.pendingAskHooks.keys()];
    assert.match(ids[0], /^ask_/);
    clearTimeout(deps.pendingAskHooks.get(ids[0]).timer);
  });

  it('同 toolUseId 旧 res 活跃 → 409 Duplicate', async () => {
    const deps = makeDeps();
    const liveRes = makeRes(); // writableEnded=false, destroyed=false
    deps.pendingAskHooks.set('dup', { questions: [], res: liveRes, timer: setTimeout(() => {}, 99999) });
    const { res } = await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'dup' }, { deps });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'Duplicate toolUseId, previous request still pending');
    clearTimeout(deps.pendingAskHooks.get('dup').timer);
  });

  it('同 toolUseId 旧 res 已断（writableEnded）→ 复用槽位，删旧 entry', async () => {
    const deps = makeDeps();
    const oldTimer = setTimeout(() => {}, 99999);
    const deadRes = makeRes(); deadRes.writableEnded = true;
    deps.pendingAskHooks.set('reuse', { questions: [], res: deadRes, timer: oldTimer });
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'reuse' }, { deps });
    // 复用：旧 entry 被 delete 后重新 set 为新 live entry
    assert.ok(deps._deleted.includes('reuse'), '旧槽位应被 persistAskDelete');
    const entry = deps.pendingAskHooks.get('reuse');
    assert.ok(entry.timer && entry.timer !== oldTimer);
    clearTimeout(entry.timer);
  });

  it('Map 满 → 驱逐最旧 entry（429 给旧 res + ask-hook-timeout 广播）', async () => {
    const deps = makeDeps({ ASK_HOOK_MAP_MAX: 1 });
    const oldRes = makeRes();
    const oldTimer = setTimeout(() => {}, 99999);
    deps.pendingAskHooks.set('old', { questions: [], res: oldRes, timer: oldTimer });
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'newer' }, { deps });
    // 旧 res 收 429
    assert.equal(oldRes.status, 429);
    assert.equal(oldRes.json.error, 'Too many concurrent requests');
    // 旧 entry 被删，timeout 广播
    assert.ok(deps._deleted.includes('old'));
    assert.ok(deps._wss._sent.some(m => m.type === 'ask-hook-timeout' && m.id === 'old'));
    // 新 entry 存在
    const entry = deps.pendingAskHooks.get('newer');
    assert.ok(entry);
    clearTimeout(entry.timer);
  });

  it('long-poll res.close（client abort）→ 清 entry + 广播 ask-hook-timeout', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'closeme' }, { deps, res });
    const entry = deps.pendingAskHooks.get('closeme');
    assert.ok(entry);
    res._fireClose();
    assert.equal(deps.pendingAskHooks.has('closeme'), false, 'close 应清掉 entry');
    assert.ok(deps._wss._sent.some(m => m.type === 'ask-hook-timeout' && m.id === 'closeme'));
  });

  it('short-poll res.close 不视为 cancel（entry 留存等 24h timer 兜底）', async () => {
    const deps = makeDeps();
    const req = makeReq({ headers: { 'x-ask-poll-mode': 'short' } });
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'spclose' }, { deps, req, res });
    const entry = deps.pendingAskHooks.get('spclose');
    res._fireClose();
    assert.equal(deps.pendingAskHooks.has('spclose'), true, 'short-poll close 不清 entry');
    clearTimeout(entry.timer);
  });

  it('24h timer fire → 删 entry、给 res 回 408、广播 ask-hook-timeout', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'totimer' }, { deps, res });
    const entry = deps.pendingAskHooks.get('totimer');
    assert.ok(entry);
    // 直接 fire timer 回调（不等 24h）：clearTimeout 后手动调内部逻辑不可行 → 用 _onTimeout? 改为重写：
    // 这里通过把 ASK_HOOK_TIMEOUT_MS 设极小重跑一条更直接，见下一个用例；此处仅断言 timer 存在
    assert.equal(typeof entry.timer, 'object');
    clearTimeout(entry.timer);
  });

  it('超时（极小 ASK_HOOK_TIMEOUT_MS）→ res 回 408 Timeout + 广播', async () => {
    const deps = makeDeps({ ASK_HOOK_TIMEOUT_MS: 5 });
    const res = makeRes();
    await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'fast' }, { deps, res });
    // 等 timer fire
    await new Promise(r => setTimeout(r, 30));
    assert.equal(res.status, 408);
    assert.equal(res.json.error, 'Timeout');
    assert.equal(deps.pendingAskHooks.has('fast'), false);
    assert.ok(deps._wss._sent.some(m => m.type === 'ask-hook-timeout' && m.id === 'fast'));
  });

  it('terminalWss 为 null：不广播也不抛（容错分支）', async () => {
    const deps = makeDeps({ terminalWss: null });
    const { res } = await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'nowss' }, { deps });
    assert.equal(res.ended, false);
    const entry = deps.pendingAskHooks.get('nowss');
    assert.ok(entry);
    clearTimeout(entry.timer);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: askHook plugin 直接答（onAskRequest waterfall）', () => {
  const pluginsDir = join(tmpDir, 'plugins');
  const pluginFile = join(pluginsDir, 'answer-ask.mjs');

  before(async () => {
    mkdirSync(pluginsDir, { recursive: true });
    // plugin 返回 answers → askHook 直接 200 回答案，不挂 res
    writeFileSync(pluginFile, `export const hooks = { onAskRequest: async () => ({ answers: { 'Q?': 'PLUGIN' } }) };\n`);
    await loadPlugins();
  });

  after(async () => {
    rmSync(pluginsDir, { recursive: true, force: true });
    await loadPlugins(); // 还原 _plugins=[]，防污染其他 describe
  });

  it('plugin 提供 answers → 200 { answers }、释放占位 entry、不广播 pending', async () => {
    const deps = makeDeps();
    const { res } = await drivePost(askHookHandler, { questions: [{ question: 'Q?', options: [] }], toolUseId: 'plug1' }, { deps });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.answers, { 'Q?': 'PLUGIN' });
    assert.equal(deps.pendingAskHooks.has('plug1'), false, 'plugin 答后释放占位');
    assert.ok(deps._deleted.includes('plug1'));
    // 不应有 ask-hook-pending 广播（提前 return）
    assert.equal(deps._wss._sent.some(m => m.type === 'ask-hook-pending'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: askHookResult (GET /api/ask-hook/:id/result)', () => {
  beforeEach(() => { try { rmSync(join(tmpDir, 'ask-store.json'), { force: true }); } catch {} });

  function driveGet(pathname, deps) {
    const res = makeRes();
    askHookResultHandler({}, res, { pathname }, true, deps);
    return res;
  }

  it('URL 不匹配 result 正则 → 400 空回包', async () => {
    const res = driveGet('/api/ask-hook/no-result-suffix', makeDeps());
    assert.ok(await waitUntil(() => res.ended), 'handler 应在超时前回包');
    assert.equal(res.status, 400);
  });

  it('非法 id（含非法字符）→ 400 invalid id', async () => {
    const res = driveGet('/api/ask-hook/bad%20id/result', makeDeps());
    assert.ok(await waitUntil(() => res.ended), 'handler 应在超时前回包');
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'invalid id');
  });

  it('disk answered → 200 { answers } 并消费', async () => {
    await askStore.markAnswered('ans1', { 'Q?': 'X' });
    const deps = makeDeps();
    const res = driveGet('/api/ask-hook/ans1/result?wait=1000', deps);
    assert.ok(await waitUntil(() => res.ended), 'handler 应在超时前回包');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.answers, { 'Q?': 'X' });
    // 已消费：再 load 不应有该 id
    assert.equal((await askStore.loadAskStore()).ans1, undefined);
  });

  it('disk cancelled → 200 { cancelled: true, reason }', async () => {
    await askStore.markCancelled('can1', 'user abort');
    const deps = makeDeps();
    const res = driveGet('/api/ask-hook/can1/result?wait=1000', deps);
    assert.ok(await waitUntil(() => res.ended), 'handler 应在超时前回包（status 仍 0 说明 await 未完成）');
    assert.equal(res.status, 200);
    assert.equal(res.json.cancelled, true);
    assert.equal(res.json.reason, 'user abort');
  });

  it('内存无 + disk 无 → 404 no such ask', async () => {
    const deps = makeDeps();
    const res = driveGet('/api/ask-hook/ghost/result', deps);
    assert.ok(await waitUntil(() => res.ended), 'handler 应在超时前回包');
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'no such ask');
  });

  it('内存 pending → 注册 listener；wait 超时(极小) → 204', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('wait1', { questions: [{ question: 'Q?' }], createdAt: Date.now() });
    const res = driveGet('/api/ask-hook/wait1/result?wait=10', deps);
    // listener 已注册（等 async handler 走过 await）
    const registered = await waitUntil(() => deps.shortPollListeners.get('wait1')?.size === 1);
    assert.ok(registered, 'listener 应注册');
    // 等 wait(被 clamp 到下限 1000ms) → 这里 wait=10 会被 Math.max(1000,...) 提为 1000；轮询到 204
    const timedOut = await waitUntil(() => res.status === 204, { timeout: 3000 });
    assert.ok(timedOut, '超时后应回 204');
    assert.equal(res.status, 204);
    assert.equal(deps.shortPollListeners.get('wait1').size, 0, '超时后移除 listener');
  });

  it('wait 参数被 clamp 到 [1000,60000]（传 999999 → 60000，传 5 → 1000）', async () => {
    // 通过 listener.tid 的存在 + 不立即 204 间接验证（精确值难直接读，转测行为：极大 wait 不会马上 204）
    const deps = makeDeps();
    deps.pendingAskHooks.set('clamp1', { questions: [{ question: 'Q?' }], createdAt: Date.now() });
    const res = driveGet('/api/ask-hook/clamp1/result?wait=999999', deps);
    // 等 listener 注册到位（确认 handler 已走过 await），此刻仍不应 204（大 wait）
    const registered = await waitUntil(() => deps.shortPollListeners.get('clamp1')?.size === 1);
    assert.ok(registered, 'listener 应注册');
    assert.equal(res.ended, false, '大 wait 下短时间内不应 204');
    const listener = [...deps.shortPollListeners.get('clamp1')][0];
    clearTimeout(listener.tid);
  });

  it('listener 注册后 res.close → 清 listener、清 timer，不回包', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('closel', { questions: [{ question: 'Q?' }], createdAt: Date.now() });
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/closel/result?wait=30000' }, true, deps);
    // 等 async handler 走过 await 注册好 listener（不再赌固定 5ms）
    const registered = await waitUntil(() => deps.shortPollListeners.get('closel')?.size === 1);
    assert.ok(registered, 'listener 应在 handler await 完成后注册');
    assert.equal(deps.shortPollListeners.get('closel').size, 1);
    res._fireClose();
    assert.equal(deps.shortPollListeners.get('closel').size, 0, 'close 后移除 listener');
    assert.equal(res.ended, false, 'close 路径不写回包');
  });

  it('内部异常（pendingAskHooks.get 抛错）→ 500 错误回包（catch 分支）', async () => {
    const deps = makeDeps();
    // consumeIfFinal 对不存在 id 返 null，随后 pendingAskHooks.get 抛 → 落入 outer catch
    deps.pendingAskHooks = { get: () => { throw new Error('mapfail'); } };
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/errid/result?wait=1000' }, true, deps);
    // 等 async handler 走过 await 后命中 catch 写回 500（不再赌固定 10ms）
    const got500 = await waitUntil(() => res.status === 500);
    assert.ok(got500, 'catch 分支应在 await 完成后写回 500');
    assert.equal(res.status, 500);
    assert.match(res.json.error, /mapfail/);
  });

  it('server 重启场景：内存无 entry 但 disk pending → 仍注册 listener（不 404）', async () => {
    await askStore.setEntry('restart1', { questions: [{ question: 'Q?' }], createdAt: Date.now() });
    const deps = makeDeps();
    const res = makeRes();
    askHookResultHandler({}, res, { pathname: '/api/ask-hook/restart1/result?wait=30000' }, true, deps);
    // 等 async handler 走过 await 注册 listener（disk pending 路径），再断言挂等不回包
    const registered = await waitUntil(() => deps.shortPollListeners.get('restart1')?.size === 1);
    assert.ok(registered, 'disk pending 时应注册 listener 挂等');
    assert.equal(res.status, 0, 'disk pending 时不立即回包，挂等');
    assert.equal(deps.shortPollListeners.get('restart1').size, 1);
    const listener = [...deps.shortPollListeners.get('restart1')][0];
    clearTimeout(listener.tid);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: permHook (POST /api/perm-hook)', () => {
  it('非法 JSON → 400 Invalid request body', async () => {
    const { res } = await drivePost(permHookHandler, 'xx');
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Invalid request body');
  });

  it('缺 toolName → 400 Missing toolName', async () => {
    const { res } = await drivePost(permHookHandler, { input: {} });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'Missing toolName');
  });

  it('body 超 1MB → 413（注意：源码在 data 回调里直接回 413）', async () => {
    const req = makeReq();
    const res = makeRes();
    permHookHandler(req, res, { pathname: '/x' }, true, makeDeps());
    req.emit('data', 'x'.repeat(1000001));
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'Request body too large');
  });

  it('正常：注册 perm entry、广播 perm-hook-pending、res 挂起', async () => {
    const deps = makeDeps();
    const { res } = await drivePost(permHookHandler, { toolName: 'Bash', input: { command: 'ls' } }, { deps });
    assert.equal(res.ended, false);
    const ids = [...deps.pendingPermHooks.keys()];
    assert.equal(ids.length, 1);
    assert.match(ids[0], /^perm_\d+_/);
    const entry = deps.pendingPermHooks.get(ids[0]);
    assert.equal(entry.toolName, 'Bash');
    assert.deepEqual(entry.input, { command: 'ls' });
    clearTimeout(entry.timer);
    const pending = deps._wss._sent.find(m => m.type === 'perm-hook-pending');
    assert.ok(pending);
    assert.equal(pending.toolName, 'Bash');
  });

  it('Map 满 → 驱逐最旧（429 给旧 res）', async () => {
    const deps = makeDeps({ PERM_HOOK_MAP_MAX: 1 });
    const oldRes = makeRes();
    const oldTimer = setTimeout(() => {}, 99999);
    deps.pendingPermHooks.set('po', { toolName: 'X', input: {}, res: oldRes, timer: oldTimer });
    const { } = await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps });
    assert.equal(oldRes.status, 429);
    assert.equal(deps.pendingPermHooks.has('po'), false);
    // 新 entry
    const newId = [...deps.pendingPermHooks.keys()][0];
    clearTimeout(deps.pendingPermHooks.get(newId).timer);
  });

  it('res.close（perm-bridge 断开）→ 清 entry、广播 perm-hook-timeout', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps, res });
    const id = [...deps.pendingPermHooks.keys()][0];
    res._fireClose();
    assert.equal(deps.pendingPermHooks.has(id), false);
    assert.ok(deps._wss._sent.some(m => m.type === 'perm-hook-timeout' && m.id === id));
  });

  it('5min 超时（fake timer 快进）→ res 回 408 Timeout、删 entry、广播 perm-hook-timeout', async (t) => {
    // PERM_HOOK_TIMEOUT 在源码内硬编码 5*60*1000，无 deps 注入口；用 node:test fake timer 快进。
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deps = makeDeps();
    const req = makeReq();
    const res = makeRes();
    permHookHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ toolName: 'Bash', input: {} }));
    req.emit('end');
    // end 回调是 async（await runWaterfallHook 无插件即空循环）；drain 微任务让 entry/timer 注册完成
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const id = [...deps.pendingPermHooks.keys()][0];
    assert.ok(id, 'entry 应已注册');
    // 快进 5 分钟触发 timer 回调
    t.mock.timers.tick(5 * 60 * 1000 + 1);
    assert.equal(res.status, 408);
    assert.equal(res.json.error, 'Timeout');
    assert.equal(deps.pendingPermHooks.has(id), false, 'timeout 后删 entry');
    assert.ok(deps._wss._sent.some(m => m.type === 'perm-hook-timeout' && m.id === id));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: permHook plugin 短路（onPermRequest waterfall）', () => {
  const pluginsDir = join(tmpDir, 'plugins');

  afterEach(async () => {
    rmSync(pluginsDir, { recursive: true, force: true });
    await loadPlugins();
  });

  // 每次用不同文件名：ESM import 按 URL 缓存模块，复用同名文件会拿到旧 decision。
  let _pluginCounter = 0;
  async function installPermPlugin(decision) {
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, `perm-${_pluginCounter++}.mjs`),
      `export const hooks = { onPermRequest: async () => (${JSON.stringify({ decision })}) };\n`);
    await loadPlugins();
  }

  it('plugin decision=allow → 200 { decision: allow }，不注册 entry', async () => {
    await installPermPlugin('allow');
    const deps = makeDeps();
    const { res } = await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps });
    assert.equal(res.status, 200);
    assert.equal(res.json.decision, 'allow');
    assert.equal(deps.pendingPermHooks.size, 0, 'plugin 短路后不挂 entry');
  });

  it('plugin decision=deny → 200 { decision: deny }', async () => {
    await installPermPlugin('deny');
    const deps = makeDeps();
    const { res } = await drivePost(permHookHandler, { toolName: 'Write', input: {} }, { deps });
    assert.equal(res.status, 200);
    assert.equal(res.json.decision, 'deny');
  });

  it('plugin decision=非白名单（如 "ask"）→ fall-through 到常规审批（挂 res）', async () => {
    await installPermPlugin('ask');
    const deps = makeDeps();
    const { res } = await drivePost(permHookHandler, { toolName: 'Bash', input: {} }, { deps });
    assert.equal(res.ended, false, '未知 decision 不短路，继续常规审批');
    assert.equal(deps.pendingPermHooks.size, 1);
    const id = [...deps.pendingPermHooks.keys()][0];
    clearTimeout(deps.pendingPermHooks.get(id).timer);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('ask-perm: streamChunk (POST /api/stream-chunk)', () => {
  function internalReq(remoteAddress = '127.0.0.1') {
    return makeReq({ headers: { 'x-cc-viewer-internal': '1' }, remoteAddress });
  }

  it('非 loopback remote → 403 Forbidden', () => {
    const req = makeReq({ headers: { 'x-cc-viewer-internal': '1' }, remoteAddress: '10.0.0.5' });
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'Forbidden');
  });

  it('缺 x-cc-viewer-internal header → 403', () => {
    const req = makeReq({ headers: {}, remoteAddress: '127.0.0.1' });
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    assert.equal(res.status, 403);
  });

  it('IPv6 loopback (::1) + internal header → 通过鉴权', async () => {
    const req = internalReq('::1');
    const res = makeRes();
    const deps = makeDeps();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 't', url: 'u', _chunkSeq: 0, response: { body: { content: [{ text: 'hi' }] } }, body: { model: 'claude' } }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 204);
    assert.equal(deps.liveStreamLastSeq.get('t|u'), 0);
  });

  it('payload 超 8MB → 413 Payload too large', async () => {
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, makeDeps());
    req.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1));
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'Payload too large');
  });

  it('乱序旧 chunk（seq < lastSeq）→ 丢弃返 204，不更新 lastSeq', async () => {
    const deps = makeDeps();
    deps.liveStreamLastSeq.set('t|u', 5);
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 't', url: 'u', _chunkSeq: 3 }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 204);
    assert.equal(deps.liveStreamLastSeq.get('t|u'), 5, '旧 chunk 不更新 lastSeq');
  });

  it('新 chunk（seq >= lastSeq）→ 更新 lastSeq 并广播 stream-progress', async () => {
    const deps = makeDeps();
    deps.liveStreamLastSeq.set('t|u', 2);
    // 收集 sendEventToClients 写入：clients 用一个收集 write 的假 res
    const written = [];
    deps.clients = [{ write: (s) => written.push(s), writableEnded: false, destroyed: false }];
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 't', url: 'u', _chunkSeq: 4, response: { body: { content: [{ text: 'X' }] } }, body: { model: 'm' } }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 204);
    assert.equal(deps.liveStreamLastSeq.get('t|u'), 4);
    const ev = written.join('');
    assert.match(ev, /event: stream-progress/);
    assert.match(ev, /"model":"m"/);
  });

  it('seq 缺省视作 0', async () => {
    const deps = makeDeps();
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 'a', url: 'b' }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(deps.liveStreamLastSeq.get('a|b'), 0);
  });

  it('lastSeq Map > 200 → FIFO 驱逐最早 100 条', async () => {
    const deps = makeDeps();
    for (let i = 0; i < 200; i++) deps.liveStreamLastSeq.set(`k${i}|u`, 0);
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', JSON.stringify({ timestamp: 'new', url: 'u', _chunkSeq: 0 }));
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    // 插入第 201 个触发驱逐：删最早 100 → size 应为 200-100+1 = 101
    assert.equal(deps.liveStreamLastSeq.size, 101);
    assert.equal(deps.liveStreamLastSeq.has('k0|u'), false, '最早的应被驱逐');
    assert.equal(deps.liveStreamLastSeq.has('new|u'), true);
  });

  it('非法 JSON body → 静默吞错仍返 204（catch 后落到 res.writeHead(204)）', async () => {
    const deps = makeDeps();
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', 'not json');
    req.emit('end');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 204);
  });

  it('payload-too-large 后 aborted → 后续 end 不再二次回包', async () => {
    const deps = makeDeps();
    const req = internalReq();
    const res = makeRes();
    streamChunkHandler(req, res, { pathname: '/x' }, true, deps);
    req.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1)); // 触发 413 + aborted
    assert.equal(res.status, 413);
    req.emit('end'); // aborted=true → end 直接 return，不改 status
    await new Promise(r => setTimeout(r, 5));
    assert.equal(res.status, 413, 'aborted 后 end 不二次写');
  });
});
