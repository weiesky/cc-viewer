// DingTalk adapter — the platform-specific half of the DingTalk bridge. The generic
// orchestration (dedup, access control, queue, inject, chunk, turn-end reply) lives in
// server/lib/im-bridge-core.js; this module only knows DingTalk's Stream client, ACK protocol,
// inbound payload shape, access-token fetch, and proactive App API send endpoints.
import { randomUUID } from 'node:crypto';
import { registerAdapter } from '../im-bridge-core.js';
import { t } from '../../i18n.js';

// ─── test seam: a fake Stream client factory (zero dingtalk-stream / network) ───
let clientFactory = null;
export function __setClientFactory(fn) { clientFactory = fn; }

// ─── DingTalk App API (proactive send; the inbound sessionWebhook is expired by reply time) ───
const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const GROUP_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';
const OTO_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const CARD_CREATE_URL = 'https://api.dingtalk.com/v1.0/card/instances';
const CARD_DELIVER_URL = 'https://api.dingtalk.com/v1.0/card/instances/deliver';
const CARD_CREATE_AND_DELIVER_URL = 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver';
const CARD_STREAMING_URL = 'https://api.dingtalk.com/v1.0/card/streaming';

async function getAccessToken(cfg, ctx) {
  const tc = ctx.store.tokenCache;
  if (tc && tc.appKey === cfg.appKey && tc.expiresAt > Date.now() + 300_000) {
    return tc.accessToken;
  }
  const r = await ctx.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: cfg.appKey, appSecret: cfg.appSecret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.accessToken) throw new Error(`token ${r.status}: ${j.message || j.code || 'failed'}`);
  ctx.store.tokenCache = { appKey: cfg.appKey, accessToken: j.accessToken, expiresAt: Date.now() + (j.expireIn || 7200) * 1000 };
  return j.accessToken;
}

/** Normalize a DingTalk TOPIC_ROBOT callback into the core's inbound shape. Returns null for
 *  an unparseable payload (the core skips it). */
function normalizeInbound(res) {
  let msg;
  try { msg = JSON.parse(res?.data ?? '{}'); } catch { return null; }
  const conversationId = msg.conversationId;
  const conversationType = msg.conversationType;
  const senderStaffId = msg.senderStaffId;
  const robotCode = msg.robotCode || msg.chatbotUserId;
  return {
    text: msg.text?.content ?? '',
    conversationId,
    isGroup: String(conversationType) === '2',
    senderId: senderStaffId,
    senderName: msg.senderNick || null, // 昵称回调里免费提供；头像不取（见下方 resolveSender 注释）
    msgId: res?.headers?.messageId,
    // opaque platform extras carried back to sendOne
    target: { conversationId, conversationType, robotCode, senderStaffId },
  };
}

// AI 卡片模板里「流式 Markdown 变量」的名字：用户可经 aiCardStreamKey 配置；留空按钉钉惯例用 'content'。
function streamKeyOf(cfg) {
  const k = cfg && typeof cfg.aiCardStreamKey === 'string' ? cfg.aiCardStreamKey.trim() : '';
  return k || 'content';
}

// ─── 卡片投递目标字段（群 / 单聊的 openSpaceId + deliver model）───
// 单一来源，消除 createAndDeliver(AI)、legacy deliver 两处重复的 conversationType==='2' 分支。
function cardDeliverFields(target) {
  const isGroup = String(target.conversationType) === '2';
  return isGroup
    ? { userIdType: 1, openSpaceId: 'dtv1.card//IM_GROUP.' + target.conversationId, imGroupOpenDeliverModel: { robotCode: target.robotCode } }
    : { userIdType: 1, openSpaceId: 'dtv1.card//IM_ROBOT.' + target.senderStaffId, imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT', robotCode: target.robotCode } };
}

// createAndDeliver（AI 卡片）在 deliver 字段之上还需 OpenSpaceModel(supportForward)。legacy 的 deliver
// 端点只用 cardDeliverFields（不带 OpenSpaceModel，保持原报文不变）。
function cardSpaceFields(target) {
  const isGroup = String(target.conversationType) === '2';
  return { ...cardDeliverFields(target), [isGroup ? 'imGroupOpenSpaceModel' : 'imRobotOpenSpaceModel']: { supportForward: true } };
}

// AI 卡片：createAndDeliver 单调用建卡 + 投递（callbackType STREAM、flowStatus=处理中、content 空），
// 再补一帧空 content「kick」开启流式生命周期（群尤其需要）。返回 { outTrackId, streaming:true }。
async function createAiCard(cfg, target, ctx) {
  const token = await getAccessToken(cfg, ctx);
  const outTrackId = randomUUID();
  const r = await ctx.fetch(CARD_CREATE_AND_DELIVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
    body: JSON.stringify({
      cardTemplateId: cfg.aiCardTemplateId,
      outTrackId,
      callbackType: 'STREAM',
      cardData: { cardParamMap: { [streamKeyOf(cfg)]: '', flowStatus: '1' } }, // cardParamMap 值必须为字符串
      ...cardSpaceFields(target),
    }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`ai-card create ${r.status}: ${j.message || j.code || 'failed'}`); }
  const handle = { outTrackId, streaming: true };
  // kick：开启流式生命周期。best-effort——权限缺失时 finalize 的 instances PUT 仍能兜底落最终内容。
  await streamFrame(cfg, handle, '', ctx, {}).catch(() => {});
  return handle;
}

// legacy 卡片：create + deliver 两步（沿用原 status+content 模板变量）。无 cardTemplateId 返回 null。
async function createLegacyCard(cfg, target, statusText, ctx) {
  if (!cfg.cardTemplateId) return null;
  const token = await getAccessToken(cfg, ctx);
  const outTrackId = randomUUID();
  const headers = { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token };
  const cr = await ctx.fetch(CARD_CREATE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      outTrackId,
      cardTemplateId: cfg.cardTemplateId,
      cardData: { cardParamMap: { status: statusText, content: '' } },
    }),
  });
  if (!cr.ok) { const j = await cr.json().catch(() => ({})); throw new Error(`card create ${cr.status}: ${j.message || j.code || 'failed'}`); }

  const dr = await ctx.fetch(CARD_DELIVER_URL, { method: 'POST', headers, body: JSON.stringify({ outTrackId, ...cardDeliverFields(target) }) });
  if (!dr.ok) { const j = await dr.json().catch(() => ({})); throw new Error(`card deliver ${dr.status}: ${j.message || j.code || 'failed'}`); }
  return { outTrackId };
}

// 一帧流式更新（PUT /card/streaming）。isFull:true 全量重发（幂等自愈丢帧）；7 字段含 isError。
async function streamFrame(cfg, handle, fullText, ctx, opts = {}) {
  try {
    if (!handle?.outTrackId) return false;
    const token = await getAccessToken(cfg, ctx);
    const r = await ctx.fetch(CARD_STREAMING_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: JSON.stringify({
        outTrackId: handle.outTrackId,
        guid: randomUUID(),
        key: streamKeyOf(cfg),
        content: String(fullText ?? ''),
        isFull: true,
        isFinalize: !!opts.finalize,
        isError: !!opts.error,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// 局部更新卡片变量（PUT /card/instances，updateCardDataByKey 只改传入键）。值须全字符串。
async function putCardInstances(cfg, handle, cardParamMap, ctx) {
  try {
    if (!handle?.outTrackId) return false;
    const token = await getAccessToken(cfg, ctx);
    const r = await ctx.fetch(CARD_CREATE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: JSON.stringify({
        outTrackId: handle.outTrackId,
        cardData: { cardParamMap },
        cardUpdateOptions: { updateCardDataByKey: true },
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const dingtalkAdapter = {
  id: 'dingtalk',
  i18nNs: 'server.dingtalk',
  allowListField: 'allowStaffIds',
  capabilities: { inboundAck: true, sdkManagesToken: false },
  rateLimit: { max: 18, windowMs: 60_000 }, // stay under DingTalk's 20/min

  hasCreds(cfg) { return !!(cfg.appKey && cfg.appSecret); },
  statusFields(cfg) { return { appKeyTail: cfg?.appKey?.slice(-4) || '' }; },

  async connect(cfg, hooks) {
    let client;
    // keepAlive is required for silent-drop detection: without it the SDK never pings, so a
    // network loss with no FIN leaves the socket "open" and `client.connected` true forever.
    // Known SDK quirk: dingtalk-stream arms a new heartbeat interval on every socket 'open'
    // without clearing the previous one, so each reconnect leaks one 8s interval (bounded by
    // reconnect count; disconnect() clears the last). Accepted — detection matters more.
    const opts = { clientId: cfg.appKey, clientSecret: cfg.appSecret, keepAlive: true };
    if (clientFactory) {
      client = clientFactory(opts);
      if (typeof client.registerCallbackListener === 'function') {
        client.registerCallbackListener('__test__', (res) => hooks.onInbound(normalizeInbound(res), res));
      }
    } else {
      const mod = await import('dingtalk-stream');
      const { DWClient, TOPIC_ROBOT } = mod;
      client = new DWClient(opts);
      client.registerCallbackListener(TOPIC_ROBOT, (res) => hooks.onInbound(normalizeInbound(res), res));
    }
    await client.connect?.();
    return client;
  },

  // dingtalk-stream emits no client-level lifecycle events (open/close/error live on an internal
  // ws that is replaced on every reconnect), so the core polls this instead. `userDisconnect` is
  // TS-private but a plain runtime field; it flips true only on manual disconnect().
  connectionProbe(client) {
    if (!client || client.userDisconnect) return 'disconnected';
    return client.connected ? 'connected' : 'reconnecting';
  },

  async disconnect(client) {
    try { await client?.disconnect?.(); } catch { /* best-effort */ }
  },

  // ackCtx is the raw `res`; `client` is the live Stream client (passed by the core).
  ack(res, client) {
    try {
      const id = res?.headers?.messageId;
      if (!id || !client) return;
      if (typeof client.socketCallBackResponse === 'function') {
        client.socketCallBackResponse(id, { success: true });
      } else if (typeof client.send === 'function') {
        client.send(id, JSON.stringify({ status: 'SUCCESS', message: 'OK' }));
      }
    } catch { /* best-effort; ack failure only risks a redelivery, caught by dedup */ }
  },

  async sendOne(cfg, target, content, ctx) {
    const token = await getAccessToken(cfg, ctx);
    const msgParam = JSON.stringify({ title: t('server.dingtalk.replyChunkTitle'), text: content });
    const isGroup = String(target.conversationType) === '2';
    const url = isGroup ? GROUP_SEND_URL : OTO_SEND_URL;
    const body = isGroup
      ? { robotCode: target.robotCode, openConversationId: target.conversationId, msgKey: 'sampleMarkdown', msgParam }
      : { robotCode: target.robotCode, userIds: [target.senderStaffId].filter(Boolean), msgKey: 'sampleMarkdown', msgParam };
    const r = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`send ${r.status}: ${j.message || j.code || 'failed'}`);
    }
  },

  // 发送者姓名：回调里的 senderNick 已免费带出（见 normalizeInbound），「对话记录」直接用它。
  // 故意不实现 resolveSender —— 头像需查通讯录（topapi/v2/user/get），而机器人应用的 appKey/appSecret
  // 没有通讯录读取权限，调用必失败（errcode 60121/88）；且这些未授权调用会打到与消息发送同一个 appKey，
  // 触发钉钉风控/限流，反过来阻断模型回复的下发。故 DingTalk 发送者头像在「对话记录」里降级为默认头像
  // （名字仍是真实昵称，不报错、不抢占发送配额）。后续如引入具备通讯录 scope 的凭证再补 resolveSender。

  // ack 卡片：aiCardTemplateId 非空 → AI 卡片（flowStatus 状态标签 + /card/streaming 逐字）；建卡
  // 失败则降级 legacy 卡片（cardTemplateId 单次更新）；都没有 → 返回 null，core 发纯文本 ack。
  async sendAckCard(cfg, target, statusText, ctx) {
    if (cfg.aiCardTemplateId) {
      try {
        return await createAiCard(cfg, target, ctx);
      } catch (e) {
        // 把失败原因留在 store，供 core 落审计（即便降级 legacy 也能诊断「为什么没流式」）。
        if (ctx?.store) ctx.store.lastAiCardError = String(e?.message || e);
        // AI 卡片创建失败：有 legacy 模板则降级单卡片，否则抛给 core 走纯文本。
        if (!cfg.cardTemplateId) throw e;
      }
    }
    return await createLegacyCard(cfg, target, statusText, ctx);
  },

  // 对话过程中逐字推送（core 的 streamTimer 调用）。仅 AI 卡片句柄有效；best-effort 返回 bool。
  async streamCardText(cfg, target, handle, fullText, ctx, opts = {}) {
    if (!handle?.streaming) return false;
    return streamFrame(cfg, handle, fullText, ctx, opts);
  },

  async updateAckCard(cfg, target, handle, content, status, ctx) {
    try {
      if (handle?.streaming) {
        const flowStatus = status === 'done' ? '3' : '5'; // 执行完成 / 执行失败（含中断·超时）
        // 官方 finalize：流式帧 isFinalize:true 收尾。
        const streamed = await streamFrame(cfg, handle, content, ctx, { finalize: true, error: status !== 'done' });
        // 再用 /card/instances 落定权威全文 + 状态标签：即便缺 Card.Streaming.Write 权限这步仍生效，
        // 保证最终内容与 tag 一定渲染、不会卡在「处理中」。
        const settled = await putCardInstances(cfg, handle, { [streamKeyOf(cfg)]: String(content ?? ''), flowStatus }, ctx);
        return streamed || settled;
      }
      // legacy 卡片：单次 PUT 更新 content。
      const token = await getAccessToken(cfg, ctx);
      const r = await ctx.fetch(CARD_CREATE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
          outTrackId: handle.outTrackId,
          cardData: { cardParamMap: { status: '', content } },
        }),
      });
      return r.ok;
    } catch {
      return false;
    }
  },

  async testConnection(cfg, ctx) {
    try {
      ctx.store.tokenCache = null; // force a fresh fetch
      await getAccessToken(cfg, ctx);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String(e?.message || e) };
    }
  },
};

registerAdapter(dingtalkAdapter);

export default dingtalkAdapter;
