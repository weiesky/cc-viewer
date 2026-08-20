// Branch coverage for server/lib/adapters/feishu-adapter.js
// 直接以 default export 的方法 + 合成 ctx 调用，逐个覆盖分支臂（不经 core 编排，便于精确控分支）。
// normalizeInbound 非导出，经 connect 注册的 dispatcher handler 间接驱动。
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 私有 LOG_DIR，必须在目标模块首次加载前设好。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-feishu-' + process.pid + '-'));
process.env.CCV_LOG_DIR = tmpDir;

let fa;
before(async () => {
  fa = (await import('../server/lib/adapters/feishu-adapter.js')).default;
});

// ── 合成一个最小 Lark SDK 工厂，并通过 connect 拿到注册好的 inbound handler ──
async function makeHandlerVia(connectCfg = {}) {
  const mod = await import('../server/lib/adapters/feishu-adapter.js');
  const adapter = mod.default;
  const rec = { sends: [], wsOpts: null, clientOpts: null };
  let handler = null;
  mod.__setClientFactory(() => ({
    Domain: { Feishu: 0, Lark: 1 },
    LoggerLevel: connectCfg.noLogger ? undefined : { warn: 2 },
    Client: class { constructor(opts) { rec.clientOpts = opts; } },
    WSClient: class {
      constructor(opts) { rec.wsOpts = opts; }
      async start({ eventDispatcher }) { rec.started = true; void eventDispatcher; }
      async stop() { rec.stopped = true; }
    },
    EventDispatcher: class {
      register(map) { handler = map['im.message.receive_v1']; return this; }
    },
  }));
  const cfg = { appId: 'cli_x', appSecret: 'sec', region: connectCfg.region || 'feishu' };
  const ctx = { store: {} };
  const inbound = [];
  const hooks = { onInbound: (n) => { inbound.push(n); } };
  const ws = await adapter.connect(cfg, hooks, ctx);
  return { handler, inbound, rec, ws, ctx };
}

describe('feishu connect / loadSdk 分支', () => {
  it('region=lark 走 Domain.Lark，且注册了 receive_v1 handler', async () => {
    const { rec, handler } = await makeHandlerVia({ region: 'lark' });
    assert.equal(rec.clientOpts.domain, 1);
    assert.equal(typeof handler, 'function');
    assert.equal(rec.started, true);
    // LoggerLevel 存在 → loggerLevel 取 warn 值（非 undefined）
    assert.equal(rec.wsOpts.loggerLevel, 2);
    assert.ok(rec.wsOpts.wsConfig && rec.wsOpts.wsConfig.PingInterval);
  });

  it('region=feishu 走 Domain.Feishu', async () => {
    const { rec } = await makeHandlerVia({ region: 'feishu' });
    assert.equal(rec.clientOpts.domain, 0);
  });

  it('LoggerLevel 缺失 → loggerLevel 取 undefined 分支', async () => {
    const { rec } = await makeHandlerVia({ noLogger: true });
    assert.equal(rec.wsOpts.loggerLevel, undefined);
  });
});

describe('feishu normalizeInbound 分支（经 dispatcher handler）', () => {
  let handler, inbound;
  before(async () => { ({ handler, inbound } = await makeHandlerVia()); });

  function feed(over = {}) {
    inbound.length = 0;
    const message = over.noMessage ? undefined : {
      chat_id: 'chatId' in over ? over.chatId : 'oc_chat',
      chat_type: over.chatType ?? 'p2p',
      message_type: over.messageType ?? 'text',
      message_id: over.msgId ?? 'om1',
      content: 'content' in over ? over.content : JSON.stringify({ text: 'hi' }),
    };
    const data = { message };
    if (!over.noSender) data.sender = over.sender ?? { sender_id: over.senderId ?? { open_id: 'ou_a' } };
    return handler(data, null);
  }

  it('无 message → null（core 跳过）', async () => {
    await feed({ noMessage: true });
    assert.equal(inbound[0], null);
  });

  it('text 消息 → 解析文本 + p2p target 用 open_id', async () => {
    await feed({ chatType: 'p2p', senderId: { open_id: 'ou_z' } });
    const n = inbound[0];
    assert.equal(n.text, 'hi');
    assert.equal(n.isGroup, false);
    assert.equal(n.target.receiveIdType, 'open_id');
    assert.equal(n.target.receiveId, 'ou_z');
  });

  it('group 消息 → target 用 chat_id + 剥离 @_user_N', async () => {
    await feed({ chatType: 'group', chatId: 'oc_g', content: JSON.stringify({ text: '@_user_1  go' }) });
    const n = inbound[0];
    assert.equal(n.isGroup, true);
    assert.equal(n.target.receiveIdType, 'chat_id');
    assert.equal(n.target.receiveId, 'oc_g');
    assert.equal(n.text, 'go');
  });

  it('非 text 消息 → text 留空（message_type !== text 分支）', async () => {
    await feed({ messageType: 'image', content: JSON.stringify({ image_key: 'x' }) });
    assert.equal(inbound[0].text, '');
  });

  it('坏 JSON content → catch → text 空', async () => {
    await feed({ content: 'not json{{' });
    assert.equal(inbound[0].text, '');
  });

  it('content 缺失 → 用 "{}" 默认（content || "{}"）', async () => {
    await feed({ content: '' });
    assert.equal(inbound[0].text, '');
  });

  it('content.text 缺失 → "" 默认', async () => {
    await feed({ content: JSON.stringify({}) });
    assert.equal(inbound[0].text, '');
  });

  it('senderId 用 user_id 回退（open_id 缺失）', async () => {
    await feed({ senderId: { user_id: 'uu_1' } });
    assert.equal(inbound[0].senderId, 'uu_1');
  });

  it('senderId 用 union_id 回退（open/user 缺失）', async () => {
    await feed({ senderId: { union_id: 'un_1' } });
    assert.equal(inbound[0].senderId, 'un_1');
  });

  it('sender_id 全空 → senderId ""（最终 || "" 分支）', async () => {
    await feed({ senderId: {} });
    assert.equal(inbound[0].senderId, '');
  });

  it('sender 缺失 → sender?.sender_id || {} 分支', async () => {
    await feed({ noSender: true });
    assert.equal(inbound[0].senderId, '');
  });
});

describe('feishu disconnect 分支', () => {
  it('有 stop() → 调 stop', async () => {
    let stopped = false, closed = false;
    await fa.disconnect({ stop: async () => { stopped = true; }, close: async () => { closed = true; } });
    assert.equal(stopped, true);
    assert.equal(closed, false, 'stop 存在时不得再 close');
  });

  it('无 stop 有 close → 调 close', async () => {
    let closed = false;
    await fa.disconnect({ close: async () => { closed = true; } });
    assert.equal(closed, true);
  });

  it('两者皆无 → 静默返回', async () => {
    await fa.disconnect({});
    await fa.disconnect(null);
  });

  it('stop 抛错 → catch 吞掉', async () => {
    await fa.disconnect({ stop: async () => { throw new Error('boom'); } });
  });
});

describe('feishu ack（no-op）', () => {
  it('调用不抛', () => { fa.ack(); });
});

describe('feishu hasCreds / statusFields 分支', () => {
  it('hasCreds 两臂', () => {
    assert.equal(fa.hasCreds({ appId: 'a', appSecret: 'b' }), true);
    assert.equal(fa.hasCreds({ appId: 'a' }), false);
    assert.equal(fa.hasCreds({}), false);
  });
  it('statusFields appId 存在 → 尾4位；缺失 → ""', () => {
    assert.equal(fa.statusFields({ appId: 'cli_5678' }).appKeyTail, '5678');
    assert.equal(fa.statusFields({}).appKeyTail, '');
    assert.equal(fa.statusFields(null).appKeyTail, '');
  });
});

describe('feishu resolveSender 分支', () => {
  it('senderId 空 → null', async () => {
    assert.equal(await fa.resolveSender({}, '', { store: {} }), null);
  });

  it('client 缺 contact.v3.user.get → null', async () => {
    assert.equal(await fa.resolveSender({}, 'ou_a', { store: { sendClient: {} } }), null);
    assert.equal(await fa.resolveSender({}, 'ou_a', { store: {} }), null);
  });

  it('成功：name + avatar_240', async () => {
    const client = { contact: { v3: { user: { get: async () => ({ code: 0, data: { user: { name: '张三', avatar: { avatar_240: 'a240', avatar_72: 'a72', avatar_origin: 'ao' } } } }) } } } };
    const r = await fa.resolveSender({}, 'ou_a', { store: { sendClient: client } });
    assert.deepEqual(r, { name: '张三', avatar: 'a240' });
  });

  it('avatar 回退 avatar_72（无 240）', async () => {
    const client = { contact: { v3: { user: { get: async () => ({ data: { user: { name: 'n', avatar: { avatar_72: 'a72', avatar_origin: 'ao' } } } }) } } } };
    const r = await fa.resolveSender({}, 'ou_a', { store: { sendClient: client } });
    assert.equal(r.avatar, 'a72');
  });

  it('avatar 回退 avatar_origin（无 240/72）', async () => {
    const client = { contact: { v3: { user: { get: async () => ({ data: { user: { name: 'n', avatar: { avatar_origin: 'ao' } } } }) } } } };
    const r = await fa.resolveSender({}, 'ou_a', { store: { sendClient: client } });
    assert.equal(r.avatar, 'ao');
  });

  it('无 avatar 对象 → avatar null；无 user → name null', async () => {
    const c1 = { contact: { v3: { user: { get: async () => ({ data: { user: { name: 'only' } } }) } } } };
    assert.deepEqual(await fa.resolveSender({}, 'ou_a', { store: { sendClient: c1 } }), { name: 'only', avatar: null });
    const c2 = { contact: { v3: { user: { get: async () => ({ data: {} }) } } } };
    assert.deepEqual(await fa.resolveSender({}, 'ou_a', { store: { sendClient: c2 } }), { name: null, avatar: null });
  });

  it('code 非 0（number）→ null', async () => {
    const client = { contact: { v3: { user: { get: async () => ({ code: 99, msg: 'no scope' }) } } } };
    assert.equal(await fa.resolveSender({}, 'ou_a', { store: { sendClient: client } }), null);
  });

  it('get 抛错 → catch → null', async () => {
    const client = { contact: { v3: { user: { get: async () => { throw new Error('net'); } } } } };
    assert.equal(await fa.resolveSender({}, 'ou_a', { store: { sendClient: client } }), null);
  });
});

describe('feishu sendOne 分支', () => {
  function clientWith(create) { return { im: { v1: { message: { create } } } }; }

  it('无 client → 抛 not initialized', async () => {
    await assert.rejects(() => fa.sendOne({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'hi', { store: {} }), /not initialized/);
  });

  it('成功（code 0）→ 不抛，参数正确', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0 }; });
    await fa.sendOne({}, { receiveId: 'ou_r', receiveIdType: 'open_id' }, 'hello', { store: { sendClient: client } });
    assert.equal(captured.params.receive_id_type, 'open_id');
    assert.equal(captured.data.receive_id, 'ou_r');
    assert.equal(JSON.parse(captured.data.content).text, 'hello');
  });

  it('code 非 0 且有 msg → 抛带 msg', async () => {
    const client = clientWith(async () => ({ code: 230, msg: 'bad receiver' }));
    await assert.rejects(() => fa.sendOne({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'x', { store: { sendClient: client } }), /send 230: bad receiver/);
  });

  it('code 非 0 无 msg → 用 failed 默认', async () => {
    const client = clientWith(async () => ({ code: 9 }));
    await assert.rejects(() => fa.sendOne({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'x', { store: { sendClient: client } }), /send 9: failed/);
  });

  it('r 无 code（非 number）→ 不抛', async () => {
    const client = clientWith(async () => ({}));
    await fa.sendOne({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'x', { store: { sendClient: client } });
  });
});

describe('feishu sendAckCard 分支', () => {
  function clientWith(create) { return { im: { v1: { message: { create } } } }; }

  it('无 client → 抛 not initialized', async () => {
    await assert.rejects(() => fa.sendAckCard({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'working', { store: {} }), /not initialized/);
  });

  it('成功 → 返回 messageId', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0, data: { message_id: 'om_card' } }; });
    const r = await fa.sendAckCard({}, { receiveId: 'r', receiveIdType: 'open_id' }, 'status...', { store: { sendClient: client } });
    assert.equal(r.messageId, 'om_card');
    assert.equal(captured.data.msg_type, 'interactive');
  });

  it('成功但无 data → messageId undefined（r?.data?.message_id 分支）', async () => {
    const client = clientWith(async () => ({ code: 0 }));
    const r = await fa.sendAckCard({}, { receiveId: 'r', receiveIdType: 'open_id' }, 's', { store: { sendClient: client } });
    assert.equal(r.messageId, undefined);
  });

  it('code 非 0 有 msg → 抛', async () => {
    const client = clientWith(async () => ({ code: 5, msg: 'card fail' }));
    await assert.rejects(() => fa.sendAckCard({}, { receiveId: 'r', receiveIdType: 'open_id' }, 's', { store: { sendClient: client } }), /sendAckCard 5: card fail/);
  });

  it('code 非 0 无 msg → failed 默认', async () => {
    const client = clientWith(async () => ({ code: 6 }));
    await assert.rejects(() => fa.sendAckCard({}, { receiveId: 'r', receiveIdType: 'open_id' }, 's', { store: { sendClient: client } }), /sendAckCard 6: failed/);
  });
});

describe('feishu updateAckCard 分支', () => {
  function clientWith(patch) { return { im: { v1: { message: { patch } } } }; }

  it('无 client → false', async () => {
    assert.equal(await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'done', { store: {} }), false);
  });

  it('status=done → template green，成功 true', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0 }; });
    const r = await fa.updateAckCard({}, {}, { messageId: 'om1' }, 'final', 'done', { store: { sendClient: client } });
    assert.equal(r, true);
    assert.equal(JSON.parse(captured.data.content).header.template, 'green');
    assert.equal(captured.path.message_id, 'om1');
  });

  it('status=interrupted → orange', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0 }; });
    await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'interrupted', { store: { sendClient: client } });
    assert.equal(JSON.parse(captured.data.content).header.template, 'orange');
  });

  it('status=error → red', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0 }; });
    await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'error', { store: { sendClient: client } });
    assert.equal(JSON.parse(captured.data.content).header.template, 'red');
  });

  it('未知 status → blue 默认（templateMap[status] || blue）', async () => {
    let captured;
    const client = clientWith(async (a) => { captured = a; return { code: 0 }; });
    await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'weird', { store: { sendClient: client } });
    assert.equal(JSON.parse(captured.data.content).header.template, 'blue');
  });

  it('code 非 0 → false', async () => {
    const client = clientWith(async () => ({ code: 7 }));
    assert.equal(await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'done', { store: { sendClient: client } }), false);
  });

  it('patch 抛错 → catch → false', async () => {
    const client = clientWith(async () => { throw new Error('x'); });
    assert.equal(await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'done', { store: { sendClient: client } }), false);
  });

  it('r 无 code → true', async () => {
    const client = clientWith(async () => ({}));
    assert.equal(await fa.updateAckCard({}, {}, { messageId: 'm' }, 'c', 'done', { store: { sendClient: client } }), true);
  });
});

describe('feishu testConnection 分支', () => {
  it('region=feishu host + code 0 → ok', async () => {
    let hit;
    const ctx = { fetch: async (url) => { hit = url; return { ok: true, status: 200, json: async () => ({ code: 0 }) }; } };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b', region: 'feishu' }, ctx);
    assert.equal(r.ok, true);
    assert.match(hit, /open\.feishu\.cn/);
  });

  it('region=lark host', async () => {
    let hit;
    const ctx = { fetch: async (url) => { hit = url; return { ok: true, status: 200, json: async () => ({ code: 0 }) }; } };
    await fa.testConnection({ appId: 'a', appSecret: 'b', region: 'lark' }, ctx);
    assert.match(hit, /open\.larksuite\.com/);
  });

  it('HTTP 200 但 code 非 0 + 有 msg → fail，detail=msg', async () => {
    const ctx = { fetch: async () => ({ ok: true, status: 200, json: async () => ({ code: 999, msg: 'app not found' }) }) };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /app not found/);
  });

  it('code 非 0 无 msg → detail 用 token status 拼串（j.code ?? failed 取 code）', async () => {
    const ctx = { fetch: async () => ({ ok: true, status: 200, json: async () => ({ code: 42 }) }) };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /token 200: 42/);
  });

  it('HTTP 非 ok 且 code 缺失 → detail 用 status + j.code ?? failed', async () => {
    const ctx = { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /token 500: failed/);
  });

  it('json() 抛错 → catch(() => ({})) 回退空对象 → code undefined → fail', async () => {
    const ctx = { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('parse'); } }) };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
  });

  it('fetch 抛 Error → catch，detail 用 e.message', async () => {
    const ctx = { fetch: async () => { throw new Error('network down'); } };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /network down/);
  });

  it('fetch 抛非 Error（无 message）→ detail 用 String(e)', async () => {
    const ctx = { fetch: async () => { throw 'plain string err'; } };
    const r = await fa.testConnection({ appId: 'a', appSecret: 'b' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /plain string err/);
  });
});

describe('feishu streamEnabled 分支', () => {
  it('aiCard true → true；false/缺失/undefined → false', () => {
    assert.equal(fa.streamEnabled({ aiCard: true }), true);
    assert.equal(fa.streamEnabled({ aiCard: false }), false);
    assert.equal(fa.streamEnabled({}), false);
    assert.equal(fa.streamEnabled(undefined), false);
  });
});

describe('feishu sendAckCard — AI 卡片 (CardKit) 流式分支', () => {
  function streamClient({ createRes, createThrows } = {}) {
    const rec = { creates: [], sends: [] };
    const client = {
      cardkit: { v1: { card: { create: async (a) => { rec.creates.push(a); if (createThrows) throw new Error('boom'); return createRes ?? { code: 0, data: { card_id: 'card_1' } }; } } } },
      im: { v1: { message: { create: async (a) => { rec.sends.push(a); return { code: 0, data: { message_id: 'om_x' } }; } } } },
    };
    return { client, rec };
  }

  it('aiCard 开 → 建卡(streaming_mode)+引用 card_id 发送，返回 streaming 句柄', async () => {
    const { client, rec } = streamClient();
    const ctx = { store: { sendClient: client } };
    const r = await fa.sendAckCard({ aiCard: true }, { receiveId: 'ou_a', receiveIdType: 'open_id' }, 'thinking', ctx);
    assert.equal(r.streaming, true);
    assert.equal(r.cardId, 'card_1');
    assert.equal(r.elementId, 'md');
    assert.equal(r.seq, 0);
    const createData = JSON.parse(rec.creates[0].data.data);
    assert.equal(createData.config.streaming_mode, true);
    assert.equal(createData.body.elements[0].element_id, 'md');
    const sent = JSON.parse(rec.sends[0].data.content);
    assert.equal(sent.type, 'card');
    assert.equal(sent.data.card_id, 'card_1');
    assert.equal(rec.sends[0].data.msg_type, 'interactive');
  });

  it('aiCard 开但 client 无 cardkit 能力 → 回退 1.0 占位卡片 (非流式)', async () => {
    const rec = { sends: [] };
    const client = { im: { v1: { message: { create: async (a) => { rec.sends.push(a); return { code: 0, data: { message_id: 'om_legacy' } }; } } } } };
    const ctx = { store: { sendClient: client } };
    const r = await fa.sendAckCard({ aiCard: true }, { receiveId: 'r', receiveIdType: 'open_id' }, 's', ctx);
    assert.equal(r.streaming, undefined);
    assert.equal(r.messageId, 'om_legacy');
    assert.equal(JSON.parse(rec.sends[0].data.content).elements[0].tag, 'div'); // 1.0 卡片
  });

  it('建卡 code 非 0 → 落 lastAiCardError 并回退 1.0', async () => {
    const { client, rec } = streamClient({ createRes: { code: 99, msg: 'no scope' } });
    const ctx = { store: { sendClient: client } };
    const r = await fa.sendAckCard({ aiCard: true }, { receiveId: 'r', receiveIdType: 'open_id' }, 's', ctx);
    assert.equal(r.streaming, undefined);
    assert.match(ctx.store.lastAiCardError, /99|no scope/);
    assert.equal(rec.sends.length, 1, '回退发了 1.0 卡片');
  });

  it('建卡 throw → 回退 1.0 + lastAiCardError', async () => {
    const { client } = streamClient({ createThrows: true });
    const ctx = { store: { sendClient: client } };
    const r = await fa.sendAckCard({ aiCard: true }, { receiveId: 'r', receiveIdType: 'open_id' }, 's', ctx);
    assert.equal(r.streaming, undefined);
    assert.match(ctx.store.lastAiCardError, /boom/);
  });

  it('aiCard 关 → 直接走 1.0 占位卡片 (不碰 cardkit)', async () => {
    const { client, rec } = streamClient();
    const r = await fa.sendAckCard({ aiCard: false }, { receiveId: 'r', receiveIdType: 'open_id' }, 's', { store: { sendClient: client } });
    assert.equal(r.streaming, undefined);
    assert.equal(rec.creates.length, 0, 'aiCard 关不应建卡');
  });
});

describe('feishu streamCardText 分支', () => {
  function contentClient(res) {
    const rec = { contents: [] };
    const client = { cardkit: { v1: { cardElement: { content: async (a) => { rec.contents.push(a); return res ?? { code: 0 }; } } } } };
    return { client, rec };
  }
  it('正常推送 → sequence 单调递增、uuid 带 cardId+seq、content 全文，true', async () => {
    const { client, rec } = contentClient();
    const handle = { cardId: 'c1', elementId: 'md', seq: 0, streaming: true };
    const ctx = { store: { sendClient: client } };
    assert.equal(await fa.streamCardText({}, {}, handle, 'abc', ctx), true);
    assert.equal(rec.contents[0].data.sequence, 1);
    assert.equal(rec.contents[0].data.uuid, 'c_c1_1');
    assert.equal(rec.contents[0].data.content, 'abc');
    assert.equal(rec.contents[0].path.card_id, 'c1');
    await fa.streamCardText({}, {}, handle, 'abcd', ctx);
    assert.equal(rec.contents[1].data.sequence, 2);
  });
  it('缺 cardId → false (不调用)', async () => {
    const { client, rec } = contentClient();
    assert.equal(await fa.streamCardText({}, {}, { elementId: 'md', seq: 0 }, 'x', { store: { sendClient: client } }), false);
    assert.equal(rec.contents.length, 0);
  });
  it('无 sendClient → false', async () => {
    assert.equal(await fa.streamCardText({}, {}, { cardId: 'c', elementId: 'md', seq: 0 }, 'x', { store: {} }), false);
  });
  it('code 非 0 → false', async () => {
    const { client } = contentClient({ code: 7 });
    assert.equal(await fa.streamCardText({}, {}, { cardId: 'c', elementId: 'md', seq: 0 }, 'x', { store: { sendClient: client } }), false);
  });
  it('抛错 → false', async () => {
    const client = { cardkit: { v1: { cardElement: { content: async () => { throw new Error('net'); } } } } };
    assert.equal(await fa.streamCardText({}, {}, { cardId: 'c', elementId: 'md', seq: 0 }, 'x', { store: { sendClient: client } }), false);
  });
});

describe('feishu updateAckCard — 流式收尾分支', () => {
  function finishClient({ contentRes, settingsThrows } = {}) {
    const rec = { contents: [], settings: [] };
    const client = { cardkit: { v1: {
      cardElement: { content: async (a) => { rec.contents.push(a); return contentRes ?? { code: 0 }; } },
      card: { settings: async (a) => { rec.settings.push(a); if (settingsThrows) throw new Error('s boom'); return { code: 0 }; } },
    } } };
    return { client, rec };
  }
  it('流式句柄 → 覆写最终全文 + 关 streaming_mode(带 summary)，true', async () => {
    const { client, rec } = finishClient();
    const handle = { streaming: true, cardId: 'c1', elementId: 'md', seq: 3 };
    const r = await fa.updateAckCard({}, {}, handle, 'the final answer', 'done', { store: { sendClient: client } });
    assert.equal(r, true);
    assert.equal(rec.contents[0].data.content, 'the final answer');
    assert.equal(rec.contents[0].data.sequence, 4);
    const settings = JSON.parse(rec.settings[0].data.settings);
    assert.equal(settings.config.streaming_mode, false);
    assert.equal(typeof settings.config.summary.content, 'string');
    assert.equal(rec.settings[0].data.sequence, 5);
  });
  it('content code 非 0 → false (不再关流)', async () => {
    const { client, rec } = finishClient({ contentRes: { code: 9 } });
    const r = await fa.updateAckCard({}, {}, { streaming: true, cardId: 'c', elementId: 'md', seq: 0 }, 'x', 'done', { store: { sendClient: client } });
    assert.equal(r, false);
    assert.equal(rec.settings.length, 0);
  });
  it('关流 settings 抛错 → 仍 true (best-effort) + 落诊断', async () => {
    const { client } = finishClient({ settingsThrows: true });
    const ctx = { store: { sendClient: client } };
    const r = await fa.updateAckCard({}, {}, { streaming: true, cardId: 'c', elementId: 'md', seq: 0 }, 'x', 'done', ctx);
    assert.equal(r, true);
    assert.match(ctx.store.lastAiCardError, /settings close/);
  });
});

// 清理私有 tmp。
import { after } from 'node:test';
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
