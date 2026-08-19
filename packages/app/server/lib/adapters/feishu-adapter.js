// Feishu/Lark adapter — the platform-specific half of the Feishu bridge. The generic
// orchestration (dedup, access control, queue, inject, chunk, turn-end reply) lives in
// server/lib/im-bridge-core.js; this module only knows Feishu's WebSocket long-connection event
// client, inbound payload shape, and outbound send.
//
// Inbound uses the official SDK's WSClient long-connection (NOT a webhook) so it works on
// loopback with no public URL — mirroring how DingTalk uses dingtalk-stream. The SDK's
// Lark.Client auto-acquires & caches the tenant_access_token for outbound, so (unlike DingTalk)
// we never hand-roll an outbound token; testConnection is the only place that fetches one by hand.
//
// Console prerequisite (no code equivalent — surfaced to the user in the UI/README): the custom
// app must set Event Subscription to "long connection", subscribe `im.message.receive_v1`, grant
// the `im:message` send scope, and be published.
import { registerAdapter } from '../im-bridge-core.js';

// ─── test seam: a fake SDK factory ({ Client, WSClient, EventDispatcher, Domain, LoggerLevel })
// so unit tests never import the real SDK or open a socket. ───
let sdkFactory = null;
export function __setClientFactory(fn) { sdkFactory = fn; }

// Internal connect guard (< core CONNECT_TIMEOUT_MS): bounds the onReady wait on hook-capable SDK
// builds so a misconfigured app fails with lastError instead of leaking a background retry loop.
const CONNECT_PROBE_MS = 12_000;

const TOKEN_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
function tokenHost(region) {
  return region === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
}

// AI 卡片(CardKit v1)里那个被逐字流式覆写的 markdown 组件 id（建卡与流式更新都引用它）。
const AI_CARD_ELEMENT_ID = 'md';

/** 构造一个 Card JSON 2.0 流式卡片：单 markdown 组件 + streaming_mode。建卡时 streaming=true。 */
function buildStreamCardJson(content, { streaming, headerTemplate = 'blue' } = {}) {
  return {
    schema: '2.0',
    config: { streaming_mode: !!streaming },
    header: { title: { tag: 'plain_text', content: 'Claude' }, template: headerTemplate },
    body: { elements: [{ tag: 'markdown', element_id: AI_CARD_ELEMENT_ID, content: content || '' }] },
  };
}

/** Feishu 返回 HTTP 200 但 body.code 非 0 表示失败；统一判定。 */
function isErr(r) { return r && typeof r.code === 'number' && r.code !== 0; }

async function loadSdk() {
  if (sdkFactory) return sdkFactory();
  return import('@larksuiteoapi/node-sdk');
}

/** Normalize an `im.message.receive_v1` event into the core's inbound shape. Returns null when
 *  the payload is unusable (the core skips it). */
function normalizeInbound(data) {
  const msg = data?.message;
  if (!msg) return null;
  let text = '';
  if (msg.message_type === 'text') {
    let content;
    try { content = JSON.parse(msg.content || '{}'); } catch { content = {}; }
    // Strip Feishu @-mention placeholders (`@_user_1`) the platform injects into group text.
    text = String(content.text || '').replace(/@_user_\d+/g, '').trim();
  }
  const isGroup = msg.chat_type === 'group';
  const sid = data.sender?.sender_id || {};
  const senderId = sid.open_id || sid.user_id || sid.union_id || '';
  return {
    text,
    conversationId: msg.chat_id,
    isGroup,
    senderId,
    msgId: msg.message_id,
    // In a group, reply to the chat; in a p2p, reply to the sender. receive_id_type tells the
    // send API which id space `receiveId` is in.
    target: isGroup
      ? { conversationId: msg.chat_id, receiveId: msg.chat_id, receiveIdType: 'chat_id' }
      : { conversationId: msg.chat_id, receiveId: senderId, receiveIdType: 'open_id' },
  };
}

const feishuAdapter = {
  id: 'feishu',
  i18nNs: 'server.feishu',
  allowListField: 'allowUserIds',
  capabilities: { inboundAck: false, sdkManagesToken: true },
  // Feishu IM send limits are generous (≈1000/min/app); cap conservatively.
  rateLimit: { max: 50, windowMs: 60_000 },

  hasCreds(cfg) { return !!(cfg.appId && cfg.appSecret); },
  statusFields(cfg) { return { appKeyTail: cfg?.appId?.slice(-4) || '' }; },

  async connect(cfg, hooks, ctx) {
    const Lark = await loadSdk();
    const domain = cfg.region === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
    const base = { appId: cfg.appId, appSecret: cfg.appSecret, domain };
    // Outbound client (auto-manages the tenant_access_token cache).
    ctx.store.sendClient = new Lark.Client(base);
    let settled = false;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {}); // detached guard: a pre-await rejection must not raise unhandledRejection
    // Inbound long-connection event client. wsConfig keys per SDK build: 1.66.0 reads ONLY the
    // lowercase `pingTimeout` (seconds) — it arms the pong/liveness watchdog that terminates a
    // zombie socket after a SILENT network drop (NAT idle, sleep, no FIN) and triggers reconnect;
    // without it such drops are never detected. The capitalized PingInterval/PingTimeout keys are
    // kept for older builds that read them (1.66.0 ignores unknown keys, so both are safe).
    const ws = new Lark.WSClient({
      ...base,
      loggerLevel: Lark.LoggerLevel ? Lark.LoggerLevel.warn : undefined, // warn: avoid noisy info-level stdout
      wsConfig: { PingInterval: 30, PingTimeout: 5, pingTimeout: 5 },
      // Lifecycle hooks ship with newer SDK builds (present in the installed 1.66.0); an older
      // build silently ignores unknown ctor options, so wiring them is always safe.
      onReady: () => {
        if (settled) { hooks.onConnectionChange?.('connected'); return; }
        settled = true; resolveReady();
      },
      onReconnecting: () => hooks.onConnectionChange?.('reconnecting'),
      onReconnected: () => hooks.onConnectionChange?.('connected'),
      onError: (err) => {
        if (settled) { hooks.onConnectionChange?.('disconnected', err); return; }
        settled = true; rejectReady(err instanceof Error ? err : new Error(String(err?.message || err)));
      },
    });
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => hooks.onInbound(normalizeInbound(data), null),
    });
    if (typeof ws.getConnectionStatus === 'function') {
      // Hook-capable build (feature-detected): start() resolves before the handshake completes,
      // so gate on onReady/onError; bound with an internal timeout below the core's connect race.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectReady(new Error('connect timeout'));
      }, CONNECT_PROBE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      try {
        await ws.start({ eventDispatcher: dispatcher });
        await ready;
      } catch (e) {
        // Stop the SDK's background retry loop so a failed connect doesn't leak.
        try { await ws.close?.({}); } catch { /* best-effort */ }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    } else {
      // Older SDK (and legacy test fakes): original behavior — start() is trusted, no
      // lifecycle hooks fire, connection state stays start/stop-driven.
      await ws.start({ eventDispatcher: dispatcher });
    }
    return ws;
  },

  async disconnect(ws) {
    // Branch on method presence, not return value — a void-returning stop() must not also call close().
    try {
      if (typeof ws?.stop === 'function') await ws.stop();
      else if (typeof ws?.close === 'function') await ws.close();
    } catch { /* best-effort */ }
  },

  // Feishu long-connection has no app-level inbound ACK (the SDK handles transport acking).
  ack() { /* no-op */ },

  // 解析发送者姓名 + 头像（供「对话记录」展示）。事件只带 open_id，姓名/头像需查通讯录：
  // 复用已建好的 sendClient（自带 tenant_access_token 缓存）调 contact.v3.user.get。
  // 需应用具备「读取通讯录」相关 scope；无权限/外部用户/失败 → null，由 bridge 静默降级。
  async resolveSender(cfg, senderId, ctx) {
    if (!senderId) return null;
    const client = ctx.store.sendClient;
    if (!client?.contact?.v3?.user?.get) return null;
    try {
      const r = await client.contact.v3.user.get({
        path: { user_id: senderId },
        params: { user_id_type: 'open_id' },
      });
      if (r && typeof r.code === 'number' && r.code !== 0) return null;
      const u = r?.data?.user || {};
      const avatar = u.avatar?.avatar_240 || u.avatar?.avatar_72 || u.avatar?.avatar_origin || null;
      return { name: u.name || null, avatar };
    } catch { return null; }
  },

  async sendOne(cfg, target, content, ctx) {
    const client = ctx.store.sendClient;
    if (!client) throw new Error('feishu send client not initialized');
    const r = await client.im.v1.message.create({
      params: { receive_id_type: target.receiveIdType },
      data: { receive_id: target.receiveId, msg_type: 'text', content: JSON.stringify({ text: content }) },
    });
    if (r && typeof r.code === 'number' && r.code !== 0) {
      throw new Error(`send ${r.code}: ${r.msg || 'failed'}`);
    }
  },

  // ─── 逐字流式（AI 卡片）─── 用 CardKit v1：建卡片实例(streaming_mode) → 引用 card_id 发消息 →
  // cardElement.content 逐帧覆写正文(飞书自动 diff 出打字机效果) → settings 关流收尾。无模板 id 概念，
  // 开关就是 cfg.aiCard；建卡失败(如缺 cardkit:card:write scope)安全回退到 1.0 占位卡片。
  streamEnabled(cfg) { return !!cfg?.aiCard; },

  async sendAckCard(cfg, target, statusText, ctx) {
    const client = ctx.store.sendClient;
    if (!client) throw new Error('feishu send client not initialized');
    // 流式路径：CardKit 建卡 + 引用发送。任何环节失败 → 落诊断并回退到下面的 1.0 占位卡片。
    if (cfg?.aiCard && client.cardkit?.v1?.card?.create) {
      try {
        const created = await client.cardkit.v1.card.create({
          data: { type: 'card_json', data: JSON.stringify(buildStreamCardJson(statusText, { streaming: true })) },
        });
        if (isErr(created)) throw new Error(`card.create ${created.code}: ${created.msg || ''}`);
        const cardId = created?.data?.card_id;
        if (!cardId) throw new Error('card.create returned no card_id');
        const r = await client.im.v1.message.create({
          params: { receive_id_type: target.receiveIdType },
          data: {
            receive_id: target.receiveId,
            msg_type: 'interactive',
            content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
          },
        });
        if (isErr(r)) throw new Error(`send ${r.code}: ${r.msg || ''}`);
        return { messageId: r?.data?.message_id, cardId, elementId: AI_CARD_ELEMENT_ID, streaming: true, seq: 0 };
      } catch (e) {
        if (ctx.store) ctx.store.lastAiCardError = String(e?.message || e);
        // fall through → 1.0 占位卡片（非流式），保证 ack 不丢
      }
    }
    // ── 1.0 占位卡片（非流式；aiCard 关闭或 CardKit 不可用时走这条，行为同旧版） ──
    const card = {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: 'Claude' }, template: 'blue' },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: statusText } }],
    };
    const r = await client.im.v1.message.create({
      params: { receive_id_type: target.receiveIdType },
      data: { receive_id: target.receiveId, msg_type: 'interactive', content: JSON.stringify(card) },
    });
    if (isErr(r)) throw new Error(`sendAckCard ${r.code}: ${r.msg || 'failed'}`);
    return { messageId: r?.data?.message_id };
  },

  async streamCardText(cfg, target, handle, fullText, ctx) {
    const client = ctx.store.sendClient;
    if (!client || !handle?.cardId || !client.cardkit?.v1?.cardElement?.content) return false;
    try {
      const seq = ++handle.seq; // 单 in-flight + 单调自增,保证 sequence 严格递增、不乱序
      const r = await client.cardkit.v1.cardElement.content({
        path: { card_id: handle.cardId, element_id: handle.elementId || AI_CARD_ELEMENT_ID },
        data: { content: fullText, sequence: seq, uuid: `c_${handle.cardId}_${seq}` },
      });
      return !isErr(r);
    } catch { return false; }
  },

  async updateAckCard(cfg, target, handle, content, status, ctx) {
    try {
      const client = ctx.store.sendClient;
      if (!client) return false;
      // 流式句柄：先以权威全文覆写正文(打字机收口) → settings 关 streaming_mode + 更新预览摘要
      //（缺摘要会让消息列表预览卡在「生成中」）。状态由文本本身承载,CardKit 无 header 状态标签。
      if (handle?.streaming && handle.cardId && client.cardkit?.v1?.cardElement?.content) {
        const seqC = ++handle.seq;
        const rc = await client.cardkit.v1.cardElement.content({
          path: { card_id: handle.cardId, element_id: handle.elementId || AI_CARD_ELEMENT_ID },
          data: { content, sequence: seqC, uuid: `c_${handle.cardId}_${seqC}` },
        });
        if (isErr(rc)) return false;
        if (client.cardkit?.v1?.card?.settings) {
          const seqS = ++handle.seq;
          const preview = String(content).replace(/\s+/g, ' ').trim().slice(0, 40);
          await client.cardkit.v1.card.settings({
            path: { card_id: handle.cardId },
            data: {
              settings: JSON.stringify({ config: { streaming_mode: false, summary: { content: preview } } }),
              sequence: seqS,
              uuid: `s_${handle.cardId}_${seqS}`,
            },
          }).catch((e) => {
            // 关流失败:内容已落定,飞书 10min 后会自动关流;仅记诊断(消息列表预览可能短暂卡在「生成中」)。
            if (ctx.store) ctx.store.lastAiCardError = 'settings close: ' + String(e?.message || e);
          });
        }
        return true;
      }
      // 非流式句柄（1.0 占位卡片）：保持原整卡 patch + header 状态色。
      const templateMap = { done: 'green', interrupted: 'orange', error: 'red' };
      const card = {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: 'Claude' }, template: templateMap[status] || 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
      };
      const r = await client.im.v1.message.patch({
        path: { message_id: handle.messageId },
        data: { content: JSON.stringify(card) },
      });
      if (isErr(r)) return false;
      return true;
    } catch { return false; }
  },

  async testConnection(cfg, ctx) {
    try {
      const r = await ctx.fetch(tokenHost(cfg.region) + TOKEN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
      });
      const j = await r.json().catch(() => ({}));
      // Feishu returns HTTP 200 with a non-zero `code` on bad creds — check the body code.
      if (!r.ok || j.code !== 0) return { ok: false, detail: j.msg || `token ${r.status}: ${j.code ?? 'failed'}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String(e?.message || e) };
    }
  },
};

registerAdapter(feishuAdapter);

export default feishuAdapter;
