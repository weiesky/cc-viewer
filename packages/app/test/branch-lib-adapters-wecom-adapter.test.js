// 分支覆盖补强：server/lib/adapters/wecom-adapter.js
// 现有 test/wecom-bridge.test.js 走 core.startBridge / core.testConnection 包装，覆盖了正常路径，
// 但 connect 超时支路(80-83)、testConnection 构造抛错 catch(128-129)、loadSdk 真实 import 支路(22)、
// resolveWSClient 的 mod.WSClient 兜底、statusFields/hasCreds、disconnect 可选链各臂、sendOne 早退/errcode
// 各臂等分支未触及。本文件用【直接调用 adapter 方法】+【子进程 loader 重定向】补齐这些分支。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// 私有 LOG_DIR，必须在目标模块 import 之前设好（adapter 静态 import im-bridge-core）。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-wecom-'));
process.env.CCV_LOG_DIR = tmpDir;

const ADAPTER_PATH = new URL('../server/lib/adapters/wecom-adapter.js', import.meta.url);
let wecom; // default export (adapter object)
let mod;   // module namespace (for __setClientFactory)

before(async () => {
  mod = await import('../server/lib/adapters/wecom-adapter.js');
  wecom = mod.default;
});

after(() => {
  mod.__setClientFactory(null); // 还原测试 seam，避免影响并发跑的其它文件（同进程不会共享，但稳妥）
  rmSync(tmpDir, { recursive: true, force: true });
});

// 一个最小可控的 WSClient 假实现工厂；行为由 opts 之外的标志驱动。
function makeFakeClientClass(behavior) {
  return class FakeWSClient extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.disconnected = false;
      this.removedAll = false;
      behavior.instances.push(this);
      if (behavior.ctorThrows) throw new Error('ctor boom');
    }
    connect() {
      behavior.connected = true;
      if (behavior.mode === 'auth') setImmediate(() => this.emit('authenticated'));
      else if (behavior.mode === 'error') setImmediate(() => this.emit('error', new Error('bad creds')));
      else if (behavior.mode === 'connectThrow') throw new Error('connect boom');
      // mode 'hang' → 永不 emit（用于超时支路）
      return this;
    }
    disconnect() { this.disconnected = true; }
    removeAllListeners() { this.removedAll = true; return super.removeAllListeners(); }
    async sendMessage(receiveId, body) {
      behavior.sends.push({ receiveId, body });
      return behavior.sendRes;
    }
  };
}

function newBehavior(over = {}) {
  return { instances: [], sends: [], mode: 'auth', connected: false, ctorThrows: false, sendRes: { errcode: 0, errmsg: 'ok' }, ...over };
}

function ctxWith(client) { return { store: { client } }; }

const cfg = { botId: 'bot_x', secret: 's' };

// 轮询助手：等待 predicate 为真（manual-mode 下 client 在 async connect 内的 await 之后才构造）。
async function waitUntil(pred, { timeout = 2000, interval = 5 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitUntil timeout');
}
// 等到 behavior 里出现第 idx+1 个被构造的 client 实例并返回它。
async function awaitInstance(behavior, idx = 0) {
  await waitUntil(() => behavior.instances.length > idx);
  return behavior.instances[idx];
}

describe('wecom hasCreds / statusFields 分支', () => {
  it('hasCreds: 两者齐全 → true', () => {
    assert.equal(wecom.hasCreds({ botId: 'a', secret: 'b' }), true);
  });
  it('hasCreds: 缺 secret → false', () => {
    assert.equal(wecom.hasCreds({ botId: 'a', secret: '' }), false);
  });
  it('hasCreds: 缺 botId → false', () => {
    assert.equal(wecom.hasCreds({ botId: '', secret: 'b' }), false);
  });
  it('statusFields: 有 botId → 取末 4 位', () => {
    assert.deepEqual(wecom.statusFields({ botId: 'abcdefgh' }), { botIdTail: 'efgh' });
  });
  it('statusFields: cfg 为 undefined → 走可选链兜底空串', () => {
    assert.deepEqual(wecom.statusFields(undefined), { botIdTail: '' });
  });
  it('statusFields: botId 缺失 → || 兜底空串', () => {
    assert.deepEqual(wecom.statusFields({}), { botIdTail: '' });
  });
});

describe('wecom connect 分支', () => {
  it('收到 authenticated → resolve client，并注册 message.text 监听', async () => {
    const behavior = newBehavior({ mode: 'auth' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const ctx = ctxWith(null);
    const inbound = [];
    const client = await wecom.connect(cfg, { onInbound: (m) => inbound.push(m) }, ctx);
    assert.equal(ctx.store.client, client);
    assert.ok(client.listenerCount('message.text') > 0);
    // 触发一帧验证 onInbound 走 normalizeInbound
    client.emit('message.text', { body: { chattype: 'single', from: { userid: 'u1' }, text: { content: 'hi' }, msgid: 'm1' } });
    assert.equal(inbound[0].conversationId, 'u1');
  });

  it('收到 error → reject 并 disconnect 兜底', async () => {
    const behavior = newBehavior({ mode: 'error' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    await assert.rejects(() => wecom.connect(cfg, { onInbound() {} }, ctxWith(null)), /bad creds/);
    assert.equal(behavior.instances[0].disconnected, true);
  });

  it('超时（永不 authenticate）→ reject "connect timeout" + disconnect（覆盖 80-83，且 setTimeout 返回非 Timeout 走 unref FALSE 臂）', async () => {
    const behavior = newBehavior({ mode: 'hang' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    // 把 global.setTimeout 替换为「立即触发且返回一个无 unref 的数字句柄」的版本，
    // 这样 12s 的内部守护计时器会立刻 fire（覆盖超时回调 80-83），
    // 且 timer.unref 不是函数 → 覆盖 line 85 的 FALSE 臂。
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { Promise.resolve().then(() => fn()); return 0; };
    try {
      await assert.rejects(() => wecom.connect(cfg, { onInbound() {} }, ctxWith(null)), /connect timeout/);
    } finally {
      global.setTimeout = realSetTimeout;
    }
    assert.equal(behavior.instances[0].disconnected, true);
  });

  it('超时回调里 client.disconnect 抛错也被吞掉（best-effort catch）', async () => {
    const behavior = newBehavior({ mode: 'hang' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.disconnect = function () { throw new Error('dc boom'); };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { Promise.resolve().then(() => fn()); return 0; };
    try {
      await assert.rejects(() => wecom.connect(cfg, { onInbound() {} }, ctxWith(null)), /connect timeout/);
    } finally {
      global.setTimeout = realSetTimeout;
    }
  });

  it('resolveWSClient: ns.WSClient 缺失 → 回退 mod.WSClient', async () => {
    const behavior = newBehavior({ mode: 'auth' });
    const Cls = makeFakeClientClass(behavior);
    // default 存在但其上无 WSClient → ns = mod.default，ns.WSClient 为 undefined → ?? mod.WSClient
    mod.__setClientFactory(() => ({ default: {}, WSClient: Cls }));
    const client = await wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
    assert.ok(client instanceof Cls);
  });

  it('error 的 e.message 为空 → String(e?.message || e) 走 || e 兜底', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; }; // 不自动 emit，手动控制时序
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const p = wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
    const inst = await awaitInstance(behavior);
    // 抛一个没有 message 的「错误」对象 → e?.message 为 undefined → 兜底用 e（被 String 化）
    inst.emit('error', { toString() { return 'plain-err'; } });
    await assert.rejects(() => p, /plain-err/);
  });

  it('authenticated 已 settle 后再来 error → error 回调命中 settled 早退（L88）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const p = wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
    const inst = await awaitInstance(behavior);
    inst.emit('authenticated');           // 先 settle（resolve）
    inst.emit('error', new Error('late')); // 再来 error → if (settled) return
    const client = await p;
    assert.ok(client instanceof Cls);
  });

  it('error 已 settle 后再来 authenticated → authenticated 回调命中 settled 早退（L86）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const p = wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
    const inst = await awaitInstance(behavior);
    inst.emit('error', new Error('first'));  // 先 settle（reject）
    inst.emit('authenticated');               // 再来 authenticated → if (settled) return
    await assert.rejects(() => p, /first/);
  });

  it('已 authenticate 后超时计时器再 fire → 命中 settled 早退（L80）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    // 捕获内部守护计时器的回调，待 authenticate settle 之后再手动触发它 → settled 早退。
    // 仅按 delay===CONNECT_PROBE_MS(12000) 识别 connect 守护计时器；其余（waitUntil 5ms 轮询）走真实实现。
    let timerCb = null;
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...rest) => {
      if (ms === 12000 && timerCb === null) { timerCb = fn; return { unref() {} }; }
      return realSetTimeout(fn, ms, ...rest);
    };
    let client;
    try {
      const p = wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
      const inst = await awaitInstance(behavior);
      inst.emit('authenticated'); // settle
      client = await p;
      assert.ok(timerCb, '应已捕获 connect 守护计时器');
      timerCb();                  // 计时器迟到 fire → if (settled) return
    } finally {
      global.setTimeout = realSetTimeout;
    }
    assert.ok(client instanceof Cls);
  });

  it('error 路径里 disconnect 抛错被 catch 吞（L92）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; };
    Cls.prototype.disconnect = function () { throw new Error('dc boom'); };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const p = wecom.connect(cfg, { onInbound() {} }, ctxWith(null));
    const inst = await awaitInstance(behavior);
    inst.emit('error', new Error('e1'));
    await assert.rejects(() => p, /e1/); // disconnect 抛错不影响 reject 原因
  });
});

describe('wecom normalizeInbound（经由 connect 注册的 handler）分支', () => {
  async function connectAndCapture(behavior) {
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const inbound = [];
    const ctx = ctxWith(null);
    const client = await wecom.connect(cfg, { onInbound: (m) => inbound.push(m) }, ctx);
    return { client, inbound };
  }

  it('frame 无 body → onInbound 收到 null', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { headers: {} });
    assert.equal(inbound[0], null);
  });

  it('group 帧有 chatid → receiveId 用 chatid，isGroup=true', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { body: { chattype: 'group', chatid: 'g1', from: { userid: 'u' }, text: { content: 'x' }, msgid: 'm' } });
    assert.equal(inbound[0].isGroup, true);
    assert.equal(inbound[0].conversationId, 'g1');
    assert.equal(inbound[0].target.receiveId, 'g1');
  });

  it('group 帧缺 chatid → receiveId 落空 → null', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { body: { chattype: 'group', from: { userid: 'u' }, text: { content: 'x' }, msgid: 'm' } });
    assert.equal(inbound[0], null);
  });

  it('single 帧 from 缺 userid → senderId 兜底空串 → receiveId 落空 → null', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { body: { chattype: 'single', from: {}, text: { content: 'x' }, msgid: 'm' } });
    assert.equal(inbound[0], null);
  });

  it('single 帧无 from 字段 → from?.userid 可选链兜底 → null', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { body: { chattype: 'single', text: { content: 'x' }, msgid: 'm' } });
    assert.equal(inbound[0], null);
  });

  it('text 缺失 → text?.content ?? "" 兜底空串', async () => {
    const { client, inbound } = await connectAndCapture(newBehavior());
    client.emit('message.text', { body: { chattype: 'single', from: { userid: 'u' }, msgid: 'm' } });
    assert.equal(inbound[0].text, '');
    assert.equal(inbound[0].conversationId, 'u');
  });
});

describe('wecom disconnect 分支', () => {
  it('正常 client：removeAllListeners + disconnect 被调用，store.client 置空', async () => {
    const behavior = newBehavior();
    const inst = new (makeFakeClientClass(behavior))({});
    const ctx = ctxWith(inst);
    await wecom.disconnect(inst, ctx);
    assert.equal(inst.removedAll, true);
    assert.equal(inst.disconnected, true);
    assert.equal(ctx.store.client, null);
  });

  it('client 为 null：可选链全部短路，不抛；ctx 无 store → 不写', async () => {
    await wecom.disconnect(null, {});         // ctx?.store 为 undefined 臂
    await wecom.disconnect(undefined, undefined); // ctx?.store 整体可选链
  });

  it('client.removeAllListeners 抛错 → catch 吞掉，仍尝试 disconnect', async () => {
    const behavior = newBehavior();
    const inst = new (makeFakeClientClass(behavior))({});
    inst.removeAllListeners = () => { throw new Error('rm boom'); };
    const ctx = ctxWith(inst);
    await wecom.disconnect(inst, ctx);
    assert.equal(inst.disconnected, true);
    assert.equal(ctx.store.client, null);
  });

  it('client.disconnect 抛错 → catch 吞掉', async () => {
    const behavior = newBehavior();
    const inst = new (makeFakeClientClass(behavior))({});
    inst.disconnect = () => { throw new Error('dc boom'); };
    const ctx = ctxWith(inst);
    await wecom.disconnect(inst, ctx); // 不抛
    assert.equal(ctx.store.client, null);
  });

  it('client 无 removeAllListeners/disconnect 方法 → 可选方法调用短路', async () => {
    const ctx = ctxWith({});
    await wecom.disconnect({}, ctx); // {}?.removeAllListeners?.() → undefined
    assert.equal(ctx.store.client, null);
  });
});

describe('wecom ack（no-op）', () => {
  it('ack 不抛', () => { assert.equal(wecom.ack(), undefined); });
});

describe('wecom sendOne 分支', () => {
  it('store 无 client → 抛 not connected', async () => {
    await assert.rejects(() => wecom.sendOne(cfg, { receiveId: 'u' }, 'hi', ctxWith(null)), /not connected/);
  });

  it('errcode=0 → 正常发送，不抛', async () => {
    const behavior = newBehavior({ sendRes: { errcode: 0, errmsg: 'ok' } });
    const inst = new (makeFakeClientClass(behavior))({});
    await wecom.sendOne(cfg, { receiveId: 'u9' }, 'body', ctxWith(inst));
    assert.equal(behavior.sends[0].receiveId, 'u9');
    assert.equal(behavior.sends[0].body.msgtype, 'markdown');
    assert.equal(behavior.sends[0].body.markdown.content, 'body');
  });

  it('errcode 非 0 且有 errmsg → 抛带 errmsg', async () => {
    const behavior = newBehavior({ sendRes: { errcode: 95000, errmsg: 'rate' } });
    const inst = new (makeFakeClientClass(behavior))({});
    await assert.rejects(() => wecom.sendOne(cfg, { receiveId: 'u' }, 'x', ctxWith(inst)), /send 95000: rate/);
  });

  it('errcode 非 0 且 errmsg 缺失 → || "failed" 兜底', async () => {
    const behavior = newBehavior({ sendRes: { errcode: 42 } });
    const inst = new (makeFakeClientClass(behavior))({});
    await assert.rejects(() => wecom.sendOne(cfg, { receiveId: 'u' }, 'x', ctxWith(inst)), /send 42: failed/);
  });

  it('res 为 null（无返回体）→ 不进非零分支，不抛', async () => {
    const behavior = newBehavior({ sendRes: null });
    const inst = new (makeFakeClientClass(behavior))({});
    await wecom.sendOne(cfg, { receiveId: 'u' }, 'x', ctxWith(inst));
  });

  it('res.errcode 不是 number → typeof 判定不成立，不抛', async () => {
    const behavior = newBehavior({ sendRes: { errcode: 'oops' } });
    const inst = new (makeFakeClientClass(behavior))({});
    await wecom.sendOne(cfg, { receiveId: 'u' }, 'x', ctxWith(inst));
  });
});

describe('wecom testConnection 分支', () => {
  it('authenticated → ok:true，并清理 probe socket', async () => {
    const behavior = newBehavior({ mode: 'auth' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const r = await wecom.testConnection(cfg);
    assert.deepEqual(r, { ok: true });
    assert.equal(behavior.instances[0].disconnected, true);
    assert.equal(behavior.instances[0].opts.maxReconnectAttempts, 0);
  });

  it('error → ok:false + detail', async () => {
    const behavior = newBehavior({ mode: 'error' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /bad creds/);
  });

  it('client.connect 同步抛错 → catch 内 done({ok:false}) （覆盖 connect try/catch 臂）', async () => {
    const behavior = newBehavior({ mode: 'connectThrow' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /connect boom/);
  });

  it('WSClient 构造抛错 → 外层 catch 返回 ok:false（覆盖 128-129）', async () => {
    const behavior = newBehavior({ ctorThrows: true });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /ctor boom/);
  });

  it('loadSdk 抛错（factory 抛）→ 128-129 catch', async () => {
    mod.__setClientFactory(() => { throw new Error('factory boom'); });
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /factory boom/);
  });

  it('超时（probe 永不响应）→ ok:false detail:timeout', async () => {
    const behavior = newBehavior({ mode: 'hang' });
    mod.__setClientFactory(() => ({ WSClient: makeFakeClientClass(behavior) }));
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { Promise.resolve().then(() => fn()); return 0; };
    let r;
    try {
      r = await wecom.testConnection(cfg);
    } finally {
      global.setTimeout = realSetTimeout;
    }
    assert.deepEqual(r, { ok: false, detail: 'timeout' });
  });

  it('done 二次调用（authenticated 后 timer 再 fire）被 settled 短路；removeAllListeners 抛错被吞', async () => {
    const behavior = newBehavior({ mode: 'auth' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.removeAllListeners = function () { throw new Error('rm boom'); };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const r = await wecom.testConnection(cfg); // catch 吞掉 removeAllListeners 抛错
    assert.deepEqual(r, { ok: true });
  });

  it('done 内 disconnect 抛错被吞', async () => {
    const behavior = newBehavior({ mode: 'auth' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.disconnect = function () { throw new Error('dc boom'); };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const r = await wecom.testConnection(cfg);
    assert.deepEqual(r, { ok: true });
  });

  it('构造抛「无 message」对象 → 外层 catch String(e?.message || e) 走 || e（L128）', async () => {
    mod.__setClientFactory(() => { throw { toString() { return 'no-msg-ctor'; } }; });
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /no-msg-ctor/);
  });

  it('error 的 e 无 message → error 回调 String(e?.message || e) 走 || e（L142）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { return this; };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const p = wecom.testConnection(cfg);
    const inst = await awaitInstance(behavior);
    inst.emit('error', { toString() { return 'errobj'; } });
    const r = await p;
    assert.equal(r.ok, false);
    assert.match(r.detail, /errobj/);
  });

  it('connect 同步抛「无 message」对象 → catch String(e?.message || e) 走 || e（L143）', async () => {
    const behavior = newBehavior({ mode: 'manual' });
    const Cls = makeFakeClientClass(behavior);
    Cls.prototype.connect = function () { throw { toString() { return 'connobj'; } }; };
    mod.__setClientFactory(() => ({ WSClient: Cls }));
    const r = await wecom.testConnection(cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /connobj/);
  });
});

describe('wecom streamEnabled 分支', () => {
  it('aiCard true → true；false/缺失/undefined → false', () => {
    assert.equal(wecom.streamEnabled({ aiCard: true }), true);
    assert.equal(wecom.streamEnabled({ aiCard: false }), false);
    assert.equal(wecom.streamEnabled({}), false);
    assert.equal(wecom.streamEnabled(undefined), false);
  });
});

describe('wecom sendAckCard 分支', () => {
  const frame = { headers: { req_id: 'rq1' }, body: {} };
  it('aiCard 关 → null (回退 proactive 文本 ack)', async () => {
    const r = await wecom.sendAckCard({ aiCard: false }, { _frame: frame }, 'hi', { store: { client: {} } });
    assert.equal(r, null);
  });
  it('aiCard 开但无 frame → null + lastAiCardError', async () => {
    const ctx = { store: { client: {} } };
    const r = await wecom.sendAckCard({ aiCard: true }, {}, 'hi', ctx);
    assert.equal(r, null);
    assert.match(ctx.store.lastAiCardError, /frame/);
  });
  it('aiCard 开但无 client → null', async () => {
    const r = await wecom.sendAckCard({ aiCard: true }, { _frame: frame }, 'hi', { store: {} });
    assert.equal(r, null);
  });
  it('aiCard 开 + frame → replyStream(finish=false)，返回 streaming 句柄 (透传整帧)', async () => {
    const calls = [];
    const client = { replyStream: async (f, id, content, finish) => { calls.push({ f, id, content, finish }); return { headers: {} }; } };
    const ctx = { store: { client } };
    const r = await wecom.sendAckCard({ aiCard: true }, { _frame: frame }, 'thinking', ctx);
    assert.equal(r.streaming, true);
    assert.ok(r.streamId);
    assert.equal(calls[0].f, frame, '整帧透传(含 req_id)');
    assert.equal(calls[0].content, 'thinking');
    assert.equal(calls[0].finish, false);
  });
  it('replyStream 抛错 → null + lastAiCardError', async () => {
    const client = { replyStream: async () => { throw new Error('open boom'); } };
    const ctx = { store: { client } };
    const r = await wecom.sendAckCard({ aiCard: true }, { _frame: frame }, 'x', ctx);
    assert.equal(r, null);
    assert.match(ctx.store.lastAiCardError, /open boom/);
  });
});

describe('wecom streamCardText 分支', () => {
  const frame = { headers: { req_id: 'rq1' } };
  it('优先 replyStreamNonBlocking；非 skipped → true', async () => {
    const calls = [];
    const client = { replyStreamNonBlocking: async (f, id, c, fin) => { calls.push({ f, id, c, fin }); return { headers: {} }; } };
    const handle = { streamId: 'sid', frame, streaming: true };
    assert.equal(await wecom.streamCardText({}, { _frame: frame }, handle, 'abc', { store: { client } }), true);
    assert.equal(calls[0].id, 'sid');
    assert.equal(calls[0].c, 'abc');
    assert.equal(calls[0].fin, false);
  });
  it('replyStreamNonBlocking 返回 "skipped" → false (跳帧不计推送)', async () => {
    const client = { replyStreamNonBlocking: async () => 'skipped' };
    assert.equal(await wecom.streamCardText({}, {}, { streamId: 'sid', frame }, 'x', { store: { client } }), false);
  });
  it('无 replyStreamNonBlocking → 回退 replyStream → true', async () => {
    const calls = [];
    const client = { replyStream: async (f, id, c, fin) => { calls.push({ fin }); return {}; } };
    assert.equal(await wecom.streamCardText({}, {}, { streamId: 'sid', frame }, 'x', { store: { client } }), true);
    assert.equal(calls[0].fin, false);
  });
  it('缺 streamId → false', async () => {
    const client = { replyStreamNonBlocking: async () => ({}) };
    assert.equal(await wecom.streamCardText({}, {}, { frame }, 'x', { store: { client } }), false);
  });
  it('抛错 → false', async () => {
    const client = { replyStreamNonBlocking: async () => { throw new Error('x'); } };
    assert.equal(await wecom.streamCardText({}, {}, { streamId: 'sid', frame }, 'x', { store: { client } }), false);
  });
});

describe('wecom updateAckCard — 流式收尾分支', () => {
  const frame = { headers: { req_id: 'rq1' } };
  it('finish=true 收尾 → true (streamId/content 正确)', async () => {
    const calls = [];
    const client = { replyStream: async (f, id, c, fin) => { calls.push({ f, id, c, fin }); return {}; } };
    const r = await wecom.updateAckCard({}, {}, { streamId: 'sid', frame }, 'final', 'done', { store: { client } });
    assert.equal(r, true);
    assert.equal(calls[0].fin, true);
    assert.equal(calls[0].id, 'sid');
    assert.equal(calls[0].c, 'final');
  });
  it('缺 streamId → false', async () => {
    const client = { replyStream: async () => ({}) };
    assert.equal(await wecom.updateAckCard({}, {}, { frame }, 'x', 'done', { store: { client } }), false);
  });
  it('抛错 → false', async () => {
    const client = { replyStream: async () => { throw new Error('x'); } };
    assert.equal(await wecom.updateAckCard({}, {}, { streamId: 'sid', frame }, 'x', 'done', { store: { client } }), false);
  });
});

// loadSdk 的「无 factory → 真实 import」支路（line 22）+ resolveWSClient 在 CJS 命名空间下的解析，
// 用子进程跑：用一个 module-resolve loader 把 @wecom/aibot-node-sdk 重定向到本地假实现（零网络）。
describe('wecom loadSdk 真实 import 支路（子进程 + loader 重定向）', () => {
  it('factory 为 null 时 connect 走 import(@wecom/...) 并成功 authenticate', () => {
    const sub = mkdtempSync(join(tmpdir(), 'ccv-branch-wecom-sub-'));
    try {
      const fakeSdk = join(sub, 'fake-sdk.mjs');
      const loader = join(sub, 'loader.mjs');
      const preload = join(sub, 'preload.mjs');
      const runner = join(sub, 'run.mjs');
      writeFileSync(fakeSdk, [
        "import { EventEmitter } from 'node:events';",
        'export class WSClient extends EventEmitter {',
        '  constructor(opts) { super(); this.opts = opts; }',
        '  connect() { setImmediate(() => this.emit("authenticated")); return this; }',
        '  disconnect() {}',
        '  removeAllListeners() { super.removeAllListeners(); return this; }',
        '}',
      ].join('\n'));
      writeFileSync(loader, [
        'export async function resolve(spec, ctx, next) {',
        "  if (spec === '@wecom/aibot-node-sdk') {",
        "    return { url: new URL('./fake-sdk.mjs', import.meta.url).href, shortCircuit: true };",
        '  }',
        '  return next(spec, ctx);',
        '}',
      ].join('\n'));
      writeFileSync(preload, [
        "import { register } from 'node:module';",
        "register('./loader.mjs', import.meta.url);",
      ].join('\n'));
      writeFileSync(runner, [
        `const wecom = (await import(${JSON.stringify(ADAPTER_PATH.href)})).default;`,
        '// 不设 factory → loadSdk 走真实 import（被 loader 重定向到 fake-sdk）',
        "const r = await wecom.testConnection({ botId: 'b', secret: 's' });",
        "if (!r.ok) { console.error('UNEXPECTED', JSON.stringify(r)); process.exit(3); }",
        "console.log('OK');",
      ].join('\n'));

      const res = spawnSync(process.execPath, ['--import', preload, runner], {
        // 必须 spread process.env，否则 NODE_V8_COVERAGE 丢失、子进程覆盖不计入
        env: { ...process.env, CCV_LOG_DIR: sub },
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(res.status, 0, `subprocess failed: ${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /OK/);
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });
});
