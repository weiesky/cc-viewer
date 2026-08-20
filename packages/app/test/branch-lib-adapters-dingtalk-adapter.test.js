// 分支补强:server/lib/adapters/dingtalk-adapter.js
// 邻近的 dingtalk-adapter-deep.test.js 已覆盖 token 缓存/错误臂、sendOne、ack-card 创建/投递/更新、
// 工厂注入路径与 ack 各臂。本文件补的是它未触及的分支:
//   1) connect 的真实 dingtalk-stream import 臂(无 clientFactory,lines 75-79)——
//      patch DWClient.prototype 的 connect / registerCallbackListener 避免真网络调用,after() 还原;
//   2) connect 工厂客户端缺 registerCallbackListener 时的 false 臂(line 71);
//   3) normalizeInbound 的 nullish / 短路兜底:res.data 缺失(?? '{}')、robotCode 缺失走 chatbotUserId、
//      conversationType !== '2' 的 1:1 臂、senderNick 缺失走 null。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 私有 LOG_DIR,避免与并发测试争抢共享目录(必须在目标模块 import 之前设好)。
process.env.CCV_LOG_DIR = mkdtempSync(join(tmpdir(), 'ccv-branch-dtadapter-'));

let adapter;
let __setClientFactory;
let DWClientProtoConnect;
let DWClientProtoRegister;
let DWClientProto;

before(async () => {
  const mod = await import('../server/lib/adapters/dingtalk-adapter.js');
  adapter = mod.default;
  __setClientFactory = mod.__setClientFactory;
});

after(() => {
  // 还原任何 patch 过的原型方法
  if (DWClientProto) {
    DWClientProto.connect = DWClientProtoConnect;
    DWClientProto.registerCallbackListener = DWClientProtoRegister;
  }
  // 清掉测试 seam,避免影响其它文件(虽然各文件独立进程,仍属良好卫生)
  if (__setClientFactory) __setClientFactory(null);
});

describe('connect — 真实 dingtalk-stream import 臂(无 clientFactory)', () => {
  it('走真实 DWClient 路径并经 normalizeInbound 接线 onInbound(lines 75-79)', async () => {
    __setClientFactory(null); // 强制进入 else 分支:await import('dingtalk-stream')

    // patch 真实 DWClient 原型,拦截网络:connect 变 no-op,registerCallbackListener 捕获 handler
    const smod = await import('dingtalk-stream');
    DWClientProto = smod.DWClient.prototype;
    DWClientProtoConnect = DWClientProto.connect;
    DWClientProtoRegister = DWClientProto.registerCallbackListener;

    let registeredTopic = null;
    let registeredHandler = null;
    let connectCalled = false;
    DWClientProto.registerCallbackListener = function (topic, handler) {
      registeredTopic = topic;
      registeredHandler = handler;
      return this;
    };
    DWClientProto.connect = async function () { connectCalled = true; };

    const inboundSeen = [];
    const client = await adapter.connect(
      { appKey: 'ak', appSecret: 'sec' },
      { onInbound: (norm, raw) => inboundSeen.push({ norm, raw }) },
    );

    assert.ok(client, 'connect 返回了真实 DWClient 实例');
    assert.equal(connectCalled, true, 'await client.connect?.() 被调用');
    assert.equal(typeof registeredHandler, 'function', '注册了回调');
    // TOPIC_ROBOT 用于真实路径(与工厂路径的 "__test__" topic 区分)
    assert.equal(registeredTopic, smod.TOPIC_ROBOT);

    // 驱动一条原始 payload,验证经 normalizeInbound 接线到 onInbound
    const raw = {
      headers: { messageId: 'mreal' },
      data: JSON.stringify({
        text: { content: 'real' },
        conversationId: 'cR',
        conversationType: '1',
        senderStaffId: 'uR',
        senderNick: 'Bob',
        robotCode: 'rcR',
      }),
    };
    registeredHandler(raw);
    assert.equal(inboundSeen.length, 1);
    assert.equal(inboundSeen[0].norm.text, 'real');
    assert.equal(inboundSeen[0].norm.isGroup, false);
  });
});

describe('connect — 工厂客户端缺 registerCallbackListener(line 71 false 臂)', () => {
  it('工厂返回的 client 无 registerCallbackListener 时不接线、仍 connect', async () => {
    let connected = false;
    __setClientFactory((opts) => ({
      _opts: opts,
      // 故意不提供 registerCallbackListener,触发 typeof !== 'function' 的 false 臂
      connect() { connected = true; },
    }));
    const client = await adapter.connect(
      { appKey: 'ak', appSecret: 'sec' },
      { onInbound: () => { throw new Error('不应被调用'); } },
    );
    assert.ok(client);
    assert.equal(connected, true);
    __setClientFactory(null);
  });

  it('工厂返回的 client 无 connect 方法时(connect?. 短路)不抛', async () => {
    __setClientFactory(() => ({
      registerCallbackListener() {},
      // 无 connect,验证 await client.connect?.() 的可选链短路臂
    }));
    await assert.doesNotReject(() =>
      adapter.connect({ appKey: 'ak', appSecret: 'sec' }, { onInbound: () => {} }),
    );
    __setClientFactory(null);
  });
});

describe('normalizeInbound — nullish / 短路兜底分支', () => {
  // 借由工厂注入捕获 normalizeInbound 的输出(adapter 未单独导出该函数)
  function captureNormalized(raw) {
    return new Promise((resolve) => {
      let handler = null;
      __setClientFactory(() => ({
        registerCallbackListener(_topic, h) { handler = h; },
        connect() {},
      }));
      adapter
        .connect({ appKey: 'ak', appSecret: 'sec' }, { onInbound: (norm) => resolve(norm) })
        .then(() => handler(raw));
    });
  }

  after(() => __setClientFactory(null));

  it('res.data 缺失时走 ?? "{}" 兜底,得到空 text 与 undefined 字段', async () => {
    // data 为 undefined → JSON.parse('{}') → 各字段缺失
    const norm = await captureNormalized({ headers: { messageId: 'm1' } });
    assert.equal(norm.text, '', 'text?.content ?? "" 兜底为空串');
    assert.equal(norm.conversationId, undefined);
    assert.equal(norm.isGroup, false, 'String(undefined) !== "2"');
    assert.equal(norm.senderName, null, 'senderNick 缺失 → null');
    assert.equal(norm.msgId, 'm1');
  });

  it('robotCode 缺失时回退到 chatbotUserId(|| 右臂)', async () => {
    const norm = await captureNormalized({
      headers: { messageId: 'm2' },
      data: JSON.stringify({
        text: { content: 'x' },
        conversationId: 'c2',
        conversationType: '2',
        senderStaffId: 'u2',
        chatbotUserId: 'botFallback',
        // 不带 robotCode
      }),
    });
    assert.equal(norm.target.robotCode, 'botFallback');
    assert.equal(norm.isGroup, true);
  });

  it('text 对象缺失时 text?.content ?? "" 走可选链短路臂', async () => {
    const norm = await captureNormalized({
      headers: { messageId: 'm3' },
      data: JSON.stringify({
        // 无 text 字段
        conversationId: 'c3',
        conversationType: '1',
        senderStaffId: 'u3',
        senderNick: 'Carol',
        robotCode: 'rc3',
      }),
    });
    assert.equal(norm.text, '');
    assert.equal(norm.senderName, 'Carol');
    assert.equal(norm.isGroup, false);
  });

  it('res 为 null 时 res?.data 短路且不抛(返回有效对象)', async () => {
    const norm = await captureNormalized(null);
    // res?.data → undefined → ?? '{}' → 解析成功;res?.headers?.messageId → undefined
    assert.equal(norm.text, '');
    assert.equal(norm.msgId, undefined);
  });
});

// 记录式 ctx:抓取每次 fetch 调用并按注入的 fetchImpl 返回
function makeCtx(fetchImpl) {
  const calls = [];
  return {
    calls,
    store: {},
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, method: init?.method });
      return fetchImpl(url, init);
    },
  };
}

const cfg = { appKey: 'ak', appSecret: 'sec', cardTemplateId: 'tmpl1' };

describe('getAccessToken — || / ?? 兜底分支', () => {
  it('token 错误体既无 message 又无 code → 落到 "failed"(L31 最右臂)', async () => {
    const ctx = makeCtx(() => ({ ok: false, status: 418, json: async () => ({}) }));
    const r = await adapter.testConnection(cfg, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /token 418: failed/);
  });

  it('token 错误体 .json() 抛错 → catch(()=>({})) 兜底,仍落到 "failed"(L30 catch 臂)', async () => {
    const ctx = makeCtx(() => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }));
    const r = await adapter.testConnection(cfg, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /token 502: failed/);
  });

  it('token 成功但缺 expireIn → 走 || 7200 默认过期(L32 右臂)', async () => {
    const before = Date.now();
    const ctx = makeCtx((url) => url.includes('accessToken')
      ? { ok: true, json: async () => ({ accessToken: 'tok' /* 无 expireIn */ }) }
      : { ok: true, json: async () => ({}) });
    const r = await adapter.testConnection(cfg, ctx);
    assert.deepEqual(r, { ok: true });
    // 缓存被写入,过期时间约为 now + 7200_000(默认)
    assert.ok(ctx.store.tokenCache);
    assert.equal(ctx.store.tokenCache.accessToken, 'tok');
    assert.ok(ctx.store.tokenCache.expiresAt >= before + 7200_000 - 1000);
  });
});

describe('testConnection — String(e?.message || e) 的 || e 右臂(L191)', () => {
  it('token fetch 以非 Error(无 .message)拒绝时,detail 用 e 本身字符串化', async () => {
    // fetch 直接 reject 一个字符串(无 .message 属性)→ e?.message 为 undefined → 走 || e
    const ctx = { store: {}, fetch: async () => { throw 'rawstring-failure'; } };
    const r = await adapter.testConnection(cfg, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.detail, 'rawstring-failure');
  });
});

describe('ack — catch 吞错臂(L98)', () => {
  it('client.socketCallBackResponse 抛错时 ack 不向外抛(best-effort catch)', () => {
    assert.doesNotThrow(() =>
      adapter.ack(
        { headers: { messageId: 'mX' } },
        { socketCallBackResponse() { throw new Error('socket boom'); } },
      ),
    );
  });
});

describe('sendAckCard — 错误体 || "failed" 最右臂', () => {
  it('card create 错误体既无 message 又无 code → "card create N: failed"(L141)', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.endsWith('/card/instances')) return { ok: false, status: 400, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    await assert.rejects(
      () => adapter.sendAckCard(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx),
      /card create 400: failed/,
    );
  });

  it('card deliver 错误体既无 message 又无 code → "card deliver N: failed"(L163)', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.includes('/card/instances/deliver')) return { ok: false, status: 422, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    await assert.rejects(
      () => adapter.sendAckCard(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx),
      /card deliver 422: failed/,
    );
  });
});
