// Direct adapter-level coverage for the DingTalk platform half. The bridge-level
// suite (dingtalk-bridge.test.js) drives the happy paths through im-bridge-core;
// this file calls the adapter methods directly with a fake ctx to hit the error
// arms and the ack-card create/deliver/update branches the bridge never exercises.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CCV_LOG_DIR = mkdtempSync(join(tmpdir(), 'ccv-dtadapter-'));

const { default: adapter, __setClientFactory } = await import('../server/lib/adapters/dingtalk-adapter.js');

// A ctx carrying a recording fetch + a store (the token cache lives on store.tokenCache).
function makeCtx(fetchImpl) {
  const calls = [];
  return {
    calls,
    store: {},
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers, method: init?.method });
      return fetchImpl(url, init);
    },
  };
}

const okToken = (url) => url.includes('accessToken')
  ? { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) }
  : { ok: true, json: async () => ({}) };

const cfg = { appKey: 'ak', appSecret: 'sec', cardTemplateId: 'tmpl1' };

describe('getAccessToken (token fetch + cache)', () => {
  it('caches the token and reuses it within the expiry window', async () => {
    const ctx = makeCtx(okToken);
    await adapter.testConnection(cfg, ctx);            // forces tokenCache=null then a fetch
    const firstFetches = ctx.calls.filter((c) => c.url.includes('accessToken')).length;
    // sendOne reuses the cached token (expiresAt far in the future) → no second token fetch
    await adapter.sendOne(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 'hi', ctx);
    const total = ctx.calls.filter((c) => c.url.includes('accessToken')).length;
    assert.equal(firstFetches, 1);
    assert.equal(total, 1, 'cached token reused — no second accessToken fetch');
  });

  it('throws a descriptive error when the token endpoint returns !ok', async () => {
    const ctx = makeCtx(() => ({ ok: false, status: 401, json: async () => ({ message: 'bad creds' }) }));
    await assert.rejects(
      () => adapter.testConnection(cfg, ctx).then((r) => { if (!r.ok) throw new Error(r.detail); }),
      /401.*bad creds/,
    );
  });

  it('throws when the token endpoint is ok but omits accessToken', async () => {
    const ctx = makeCtx((url) => url.includes('accessToken')
      ? { ok: true, status: 200, json: async () => ({ code: 'NoToken' }) }
      : { ok: true, json: async () => ({}) });
    const r = await adapter.testConnection(cfg, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /NoToken|failed/);
  });
});

describe('testConnection', () => {
  it('returns ok:true when the token fetch succeeds', async () => {
    const ctx = makeCtx(okToken);
    const r = await adapter.testConnection(cfg, ctx);
    assert.deepEqual(r, { ok: true });
  });

  it('returns ok:false with a detail string when the token fetch fails', async () => {
    const ctx = makeCtx(() => ({ ok: false, status: 500, json: async () => ({ code: 'Server' }) }));
    const r = await adapter.testConnection(cfg, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /500/);
  });
});

describe('sendOne', () => {
  it('1:1 message posts to oToMessages with userIds', async () => {
    const ctx = makeCtx(okToken);
    await adapter.sendOne(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 'body', ctx);
    const send = ctx.calls.find((c) => c.url.includes('oToMessages/batchSend'));
    assert.ok(send);
    assert.deepEqual(send.body.userIds, ['u']);
    assert.equal(send.headers['x-acs-dingtalk-access-token'], 'tok');
  });

  it('group message (type=2) posts to groupMessages with openConversationId and no userIds', async () => {
    const ctx = makeCtx(okToken);
    await adapter.sendOne(cfg, { conversationType: '2', robotCode: 'r', conversationId: 'grp' }, 'body', ctx);
    const send = ctx.calls.find((c) => c.url.includes('groupMessages/send'));
    assert.ok(send);
    assert.equal(send.body.openConversationId, 'grp');
    assert.ok(!('userIds' in send.body));
  });

  it('throws when the send endpoint returns !ok (error arm)', async () => {
    const ctx = makeCtx((url) => url.includes('accessToken')
      ? { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) }
      : { ok: false, status: 403, json: async () => ({ message: 'forbidden' }) });
    await assert.rejects(
      () => adapter.sendOne(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 'body', ctx),
      /send 403.*forbidden/,
    );
  });

  it('send error arm tolerates a non-JSON error body', async () => {
    const ctx = makeCtx((url) => url.includes('accessToken')
      ? { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) }
      : { ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await assert.rejects(
      () => adapter.sendOne(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 'body', ctx),
      /send 500: failed/,
    );
  });
});

describe('sendAckCard', () => {
  it('returns null without a cardTemplateId (no network)', async () => {
    const ctx = makeCtx(okToken);
    const r = await adapter.sendAckCard({ appKey: 'ak', appSecret: 'sec' }, { conversationType: '1' }, 'status', ctx);
    assert.equal(r, null);
    assert.equal(ctx.calls.length, 0, 'no fetch when card disabled');
  });

  it('1:1 card creates then delivers via IM_ROBOT openSpaceId and returns the outTrackId', async () => {
    const ctx = makeCtx(okToken);
    const r = await adapter.sendAckCard(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u9' }, 'thinking', ctx);
    const create = ctx.calls.find((c) => c.url.endsWith('/card/instances'));
    const deliver = ctx.calls.find((c) => c.url.includes('/card/instances/deliver'));
    assert.ok(create && deliver);
    assert.equal(create.body.cardTemplateId, 'tmpl1');
    assert.match(deliver.body.openSpaceId, /IM_ROBOT\.u9/);
    assert.equal(deliver.body.imRobotOpenDeliverModel.robotCode, 'r');
    assert.equal(r.outTrackId, create.body.outTrackId);
  });

  it('group card delivers via IM_GROUP openSpaceId', async () => {
    const ctx = makeCtx(okToken);
    await adapter.sendAckCard(cfg, { conversationType: '2', robotCode: 'r', conversationId: 'g7' }, 'thinking', ctx);
    const deliver = ctx.calls.find((c) => c.url.includes('/card/instances/deliver'));
    assert.match(deliver.body.openSpaceId, /IM_GROUP\.g7/);
    assert.equal(deliver.body.imGroupOpenDeliverModel.robotCode, 'r');
  });

  it('throws when card create returns !ok', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.endsWith('/card/instances')) return { ok: false, status: 400, json: async () => ({ message: 'bad tmpl' }) };
      return { ok: true, json: async () => ({}) };
    });
    await assert.rejects(
      () => adapter.sendAckCard(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx),
      /card create 400.*bad tmpl/,
    );
  });

  it('throws when card deliver returns !ok', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.includes('/card/instances/deliver')) return { ok: false, status: 422, json: async () => ({ code: 'DeliverFail' }) };
      return { ok: true, json: async () => ({}) };
    });
    await assert.rejects(
      () => adapter.sendAckCard(cfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx),
      /card deliver 422.*DeliverFail/,
    );
  });
});

describe('updateAckCard', () => {
  it('PUTs the card update and returns true on ok', async () => {
    const ctx = makeCtx(okToken);
    const ok = await adapter.updateAckCard(cfg, {}, { outTrackId: 'ot1' }, 'new content', 'done', ctx);
    assert.equal(ok, true);
    const put = ctx.calls.find((c) => c.method === 'PUT');
    assert.ok(put);
    assert.equal(put.body.outTrackId, 'ot1');
    assert.equal(put.body.cardData.cardParamMap.content, 'new content');
  });

  it('returns false when the update fetch reports !ok', async () => {
    const ctx = makeCtx((url) => url.includes('accessToken')
      ? { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) }
      : { ok: false, status: 500, json: async () => ({}) });
    const ok = await adapter.updateAckCard(cfg, {}, { outTrackId: 'ot1' }, 'c', 's', ctx);
    assert.equal(ok, false);
  });

  it('returns false (swallows) when the token fetch throws', async () => {
    const ctx = makeCtx(() => { throw new Error('network down'); });
    const ok = await adapter.updateAckCard(cfg, {}, { outTrackId: 'ot1' }, 'c', 's', ctx);
    assert.equal(ok, false);
  });
});

// AI 卡片（逐字流式）：aiCardTemplateId 走 createAndDeliver + /card/streaming + flowStatus 状态标签。
const aiCfg = { appKey: 'ak', appSecret: 'sec', aiCardTemplateId: 'ai1' };

describe('AI card — sendAckCard', () => {
  it('createAndDeliver (STREAM, string flowStatus, empty content) + kick frame, returns streaming handle', async () => {
    const ctx = makeCtx(okToken);
    const r = await adapter.sendAckCard(aiCfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u9' }, 'thinking', ctx);
    const create = ctx.calls.find((c) => c.url.endsWith('/card/instances/createAndDeliver'));
    assert.ok(create, 'uses the createAndDeliver endpoint');
    assert.equal(create.body.cardTemplateId, 'ai1');
    assert.equal(create.body.callbackType, 'STREAM');
    assert.equal(create.body.cardData.cardParamMap.flowStatus, '1'); // 字符串
    assert.equal(create.body.cardData.cardParamMap.content, '');
    assert.match(create.body.openSpaceId, /IM_ROBOT\.u9/);
    const kick = ctx.calls.find((c) => c.url.endsWith('/card/streaming'));
    assert.ok(kick && kick.method === 'PUT', 'kick frame opens the streaming lifecycle');
    assert.equal(kick.body.content, '');
    assert.equal(kick.body.isFull, true);
    assert.equal(r.outTrackId, create.body.outTrackId);
    assert.equal(r.streaming, true);
  });

  it('group AI card uses the IM_GROUP openSpaceId + deliver model', async () => {
    const ctx = makeCtx(okToken);
    await adapter.sendAckCard(aiCfg, { conversationType: '2', robotCode: 'r', conversationId: 'g7' }, 'thinking', ctx);
    const create = ctx.calls.find((c) => c.url.endsWith('/card/instances/createAndDeliver'));
    assert.match(create.body.openSpaceId, /IM_GROUP\.g7/);
    assert.equal(create.body.imGroupOpenDeliverModel.robotCode, 'r');
  });

  it('falls back to the legacy card when AI create fails but cardTemplateId is set', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.endsWith('/card/instances/createAndDeliver')) return { ok: false, status: 403, json: async () => ({ message: 'no perm' }) };
      return { ok: true, json: async () => ({}) };
    });
    const r = await adapter.sendAckCard({ ...aiCfg, cardTemplateId: 'tmpl1' }, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx);
    assert.ok(ctx.calls.find((c) => c.url.endsWith('/card/instances') && c.method === 'POST'), 'legacy create');
    assert.ok(ctx.calls.find((c) => c.url.includes('/card/instances/deliver')), 'legacy deliver');
    assert.ok(r && !r.streaming, 'legacy handle has no streaming flag');
  });

  it('throws when AI create fails and there is no legacy cardTemplateId', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.endsWith('/card/instances/createAndDeliver')) return { ok: false, status: 403, json: async () => ({ message: 'no perm' }) };
      return { ok: true, json: async () => ({}) };
    });
    await assert.rejects(
      () => adapter.sendAckCard(aiCfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx),
      /ai-card create 403.*no perm/,
    );
  });
});

describe('AI card — streamCardText', () => {
  it('PUTs a streaming frame with all 7 fields (string content, isFull, isError:false)', async () => {
    const ctx = makeCtx(okToken);
    const ok = await adapter.streamCardText(aiCfg, {}, { outTrackId: 'ot9', streaming: true }, 'hello so far', ctx);
    assert.equal(ok, true);
    const put = ctx.calls.find((c) => c.url.endsWith('/card/streaming'));
    assert.equal(put.method, 'PUT');
    assert.equal(put.body.outTrackId, 'ot9');
    assert.equal(put.body.key, 'content');
    assert.equal(put.body.content, 'hello so far');
    assert.equal(put.body.isFull, true);
    assert.equal(put.body.isFinalize, false);
    assert.equal(put.body.isError, false);
    assert.equal(typeof put.body.guid, 'string');
  });

  it('is a no-op (false) for a non-streaming handle', async () => {
    const ctx = makeCtx(okToken);
    const ok = await adapter.streamCardText(aiCfg, {}, { outTrackId: 'ot' }, 'x', ctx);
    assert.equal(ok, false);
    assert.equal(ctx.calls.length, 0, 'no fetch for a non-streaming handle');
  });

  it('defaults the streaming key to "content" and honors a custom aiCardStreamKey', async () => {
    const def = makeCtx(okToken);
    await adapter.streamCardText(aiCfg, {}, { outTrackId: 'ot', streaming: true }, 'hi', def);
    assert.equal(def.calls.find((c) => c.url.endsWith('/card/streaming')).body.key, 'content');

    const cus = makeCtx(okToken);
    await adapter.streamCardText({ ...aiCfg, aiCardStreamKey: 'reply' }, {}, { outTrackId: 'ot', streaming: true }, 'hi', cus);
    assert.equal(cus.calls.find((c) => c.url.endsWith('/card/streaming')).body.key, 'reply');
  });
});

describe('AI card — configurable stream key (create + finalize)', () => {
  const customCfg = { appKey: 'ak', appSecret: 'sec', aiCardTemplateId: 'ai1', aiCardStreamKey: 'reply' };

  it('createAndDeliver seeds cardParamMap under the custom key', async () => {
    const ctx = makeCtx(okToken);
    await adapter.sendAckCard(customCfg, { conversationType: '1', robotCode: 'r', senderStaffId: 'u' }, 's', ctx);
    const create = ctx.calls.find((c) => c.url.endsWith('/card/instances/createAndDeliver'));
    assert.ok('reply' in create.body.cardData.cardParamMap, 'uses the custom key, not content');
    assert.equal(create.body.cardData.cardParamMap.reply, '');
    assert.equal(create.body.cardData.cardParamMap.flowStatus, '1');
  });

  it('finalize writes the full text to the custom key via instances PUT', async () => {
    const ctx = makeCtx(okToken);
    await adapter.updateAckCard(customCfg, {}, { outTrackId: 'ot', streaming: true }, 'final answer', 'done', ctx);
    const inst = ctx.calls.find((c) => c.url.endsWith('/card/instances') && c.method === 'PUT');
    assert.equal(inst.body.cardData.cardParamMap.reply, 'final answer');
    assert.equal(inst.body.cardData.cardParamMap.flowStatus, '3');
  });
});

describe('AI card — updateAckCard finalize', () => {
  it('finalizes via streaming (isFinalize) + sets flowStatus 3 via instances (updateCardDataByKey)', async () => {
    const ctx = makeCtx(okToken);
    const ok = await adapter.updateAckCard(aiCfg, {}, { outTrackId: 'ot1', streaming: true }, 'final answer', 'done', ctx);
    assert.equal(ok, true);
    const fin = ctx.calls.find((c) => c.url.endsWith('/card/streaming'));
    assert.equal(fin.body.isFinalize, true);
    assert.equal(fin.body.content, 'final answer');
    const inst = ctx.calls.find((c) => c.url.endsWith('/card/instances') && c.method === 'PUT');
    assert.equal(inst.body.cardData.cardParamMap.flowStatus, '3');
    assert.equal(inst.body.cardUpdateOptions.updateCardDataByKey, true);
  });

  it('maps error/interrupted to flowStatus 5 + isError on the final frame', async () => {
    const ctx = makeCtx(okToken);
    await adapter.updateAckCard(aiCfg, {}, { outTrackId: 'ot1', streaming: true }, 'oops', 'error', ctx);
    const fin = ctx.calls.find((c) => c.url.endsWith('/card/streaming'));
    assert.equal(fin.body.isError, true);
    const inst = ctx.calls.find((c) => c.url.endsWith('/card/instances') && c.method === 'PUT');
    assert.equal(inst.body.cardData.cardParamMap.flowStatus, '5');
  });

  it('still succeeds via the instances PUT when the streaming PUT fails (degrades w/o Card.Streaming.Write)', async () => {
    const ctx = makeCtx((url) => {
      if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
      if (url.endsWith('/card/streaming')) return { ok: false, status: 403, json: async () => ({ message: 'no stream perm' }) };
      return { ok: true, json: async () => ({}) };
    });
    const ok = await adapter.updateAckCard(aiCfg, {}, { outTrackId: 'ot1', streaming: true }, 'final', 'done', ctx);
    assert.equal(ok, true, 'instances PUT settles the final content + tag, so finalize still counts as success');
  });
});

describe('connect / ack via fake client factory', () => {
  beforeEach(() => __setClientFactory(null));

  it('connect uses the injected factory and wires onInbound through normalizeInbound', async () => {
    let registered = null;
    let connected = false;
    __setClientFactory((opts) => ({
      _opts: opts,
      registerCallbackListener(_topic, handler) { registered = handler; },
      connect() { connected = true; },
    }));
    const inboundSeen = [];
    const client = await adapter.connect({ appKey: 'ak', appSecret: 'sec' }, { onInbound: (norm, raw) => inboundSeen.push({ norm, raw }) });
    assert.ok(connected);
    assert.equal(typeof registered, 'function');
    // Drive a raw TOPIC_ROBOT payload through the registered listener.
    const raw = { headers: { messageId: 'mid1' }, data: JSON.stringify({ text: { content: 'hi' }, conversationId: 'c1', conversationType: '2', senderStaffId: 'u1', senderNick: 'Alice', robotCode: 'rc' }) };
    registered(raw);
    assert.equal(inboundSeen.length, 1);
    const n = inboundSeen[0].norm;
    assert.equal(n.text, 'hi');
    assert.equal(n.isGroup, true);
    assert.equal(n.senderName, 'Alice');
    assert.equal(n.msgId, 'mid1');
    assert.equal(n.target.robotCode, 'rc');
    // disconnect best-effort
    await adapter.disconnect(client);
  });

  it('normalizeInbound returns null for an unparseable payload', async () => {
    let registered = null;
    __setClientFactory(() => ({ registerCallbackListener(_t, h) { registered = h; }, connect() {} }));
    const seen = [];
    await adapter.connect({ appKey: 'ak', appSecret: 'sec' }, { onInbound: (norm) => seen.push(norm) });
    registered({ headers: { messageId: 'x' }, data: '{not json' });
    assert.equal(seen[0], null);
  });

  it('ack uses socketCallBackResponse when present', () => {
    const acks = [];
    adapter.ack({ headers: { messageId: 'a1' } }, { socketCallBackResponse: (id, p) => acks.push({ id, p }) });
    assert.deepEqual(acks, [{ id: 'a1', p: { success: true } }]);
  });

  it('ack falls back to client.send when socketCallBackResponse is absent', () => {
    const sent = [];
    adapter.ack({ headers: { messageId: 'a2' } }, { send: (id, payload) => sent.push({ id, payload }) });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, 'a2');
    assert.match(sent[0].payload, /SUCCESS/);
  });

  it('ack is a no-op (no throw) without a messageId or client', () => {
    assert.doesNotThrow(() => adapter.ack({ headers: {} }, { send() { throw new Error('should not be called'); } }));
    assert.doesNotThrow(() => adapter.ack({ headers: { messageId: 'x' } }, null));
  });

  it('disconnect swallows a throwing client', async () => {
    await assert.doesNotReject(() => adapter.disconnect({ disconnect() { throw new Error('boom'); } }));
    await assert.doesNotReject(() => adapter.disconnect(null));
  });

  it('connect passes keepAlive: true to the client factory (silent-drop detection)', async () => {
    let seenOpts = null;
    __setClientFactory((opts) => { seenOpts = opts; return { registerCallbackListener() {}, connect() {} }; });
    await adapter.connect({ appKey: 'ak', appSecret: 'sec' }, { onInbound: () => {} });
    assert.equal(seenOpts.keepAlive, true);
    assert.equal(seenOpts.clientId, 'ak');
  });
});

describe('connectionProbe (dingtalk-stream has no lifecycle events — the core polls this)', () => {
  it('truth table over the SDK client fields', () => {
    assert.equal(adapter.connectionProbe(null), 'disconnected');
    assert.equal(adapter.connectionProbe({ userDisconnect: true, connected: true }), 'disconnected');
    assert.equal(adapter.connectionProbe({ userDisconnect: false, connected: true }), 'connected');
    assert.equal(adapter.connectionProbe({ userDisconnect: false, connected: false }), 'reconnecting');
  });
});

describe('static descriptors', () => {
  it('hasCreds requires both appKey and appSecret', () => {
    assert.equal(adapter.hasCreds({ appKey: 'a', appSecret: 'b' }), true);
    assert.equal(adapter.hasCreds({ appKey: 'a' }), false);
    assert.equal(adapter.hasCreds({}), false);
  });

  it('statusFields exposes the appKey tail', () => {
    assert.equal(adapter.statusFields({ appKey: 'abcd1234' }).appKeyTail, '1234');
    assert.equal(adapter.statusFields({}).appKeyTail, '');
  });
});
