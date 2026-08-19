// 企业微信 (WeCom) adapter — the platform-specific half of the WeCom bridge. The generic
// orchestration (dedup, access control, queue, inject, chunk, turn-end reply) lives in
// server/lib/im-bridge-core.js; this module only knows WeCom's smart-robot long-connection client,
// inbound frame shape, and outbound send.
//
// Uses the 企业微信智能机器人长连接 (Smart Robot long-connection) mode via @wecom/aibot-node-sdk:
// an OUTBOUND WebSocket (wss://openws.work.weixin.qq.com) authed with botId + secret — so it works
// on loopback with no public URL, no trusted-IP whitelist, and no WXBizMsgCrypt in our code (the
// SDK handles auth/heartbeat/reconnect). Replies use the proactive sendMessage (our reply lands
// ~10s after the turn, well past the 5s synchronous reply window; the 24h proactive window covers it).
//
// Console prerequisite (no code equivalent — surfaced in the UI help/README): create a 智能机器人,
// set its API 接收模式 to 长连接, copy the botId + secret, and add the bot to a chat.
import { randomUUID } from 'node:crypto';
import { registerAdapter } from '../im-bridge-core.js';

// ─── test seam: a fake SDK factory (zero real SDK / socket) ───
let sdkFactory = null;
export function __setClientFactory(fn) { sdkFactory = fn; }

async function loadSdk() {
  if (sdkFactory) return sdkFactory();
  return import('@wecom/aibot-node-sdk');
}
function resolveWSClient(mod) {
  const ns = mod.default ?? mod;
  return ns.WSClient ?? mod.WSClient;
}

const CONNECT_PROBE_MS = 12_000; // internal connect guard (< core CONNECT_TIMEOUT_MS) to avoid a leaked reconnect loop
const TEST_PROBE_MS = 8_000;

/** Normalize a WeCom `message.text` WsFrame into the core's inbound shape. Returns null for an
 *  unusable frame (the core skips it). */
function normalizeInbound(frame) {
  const b = frame?.body;
  if (!b) return null;
  const isGroup = b.chattype === 'group';
  const senderId = b.from?.userid || '';
  const receiveId = isGroup ? b.chatid : senderId; // group → chatid, single → sender userid
  // A group frame missing chatid (chatid is optional in the SDK types) has no reply target — drop
  // it rather than bind/send to undefined.
  if (!receiveId) return null;
  return {
    text: b.text?.content ?? '',
    conversationId: receiveId,
    isGroup,
    senderId,
    msgId: b.msgid,
    // 逐字流式（aiCard）靠被动回复 replyStream，须透传入站帧的 req_id。core 入队是浅展开
    // `{ ...target, ... }`，故把整帧挂进 target 内层才能随队列项流转到 sendAckCard/streamCardText/
    // updateAckCard。非流式路径不读它，无副作用。
    target: { conversationId: receiveId, receiveId, _frame: frame },
  };
}

const wecomAdapter = {
  id: 'wecom',
  i18nNs: 'server.wecom',
  allowListField: 'allowUserIds',
  capabilities: { inboundAck: false },
  // WeCom proactive-push limit is 30/min·1000/hr per conversation; cap conservatively.
  rateLimit: { max: 30, windowMs: 60_000 },

  hasCreds(cfg) { return !!(cfg.botId && cfg.secret); },
  statusFields(cfg) { return { botIdTail: cfg?.botId?.slice(-4) || '' }; },

  // 发送者姓名/头像：v1 不实现 resolveSender —— 智能机器人长连接凭证（botId+secret）拿不到
  // 企业通讯录的 corp_access_token，`/cgi-bin/user/get` 不可达。故 WeCom 发送者在「对话记录」里
  // 降级为默认头像 + senderId（不报错、不阻断）。后续如引入管理员级凭证再补 resolveSender。

  async connect(cfg, hooks, ctx) {
    const mod = await loadSdk();
    const WSClient = resolveWSClient(mod);
    const client = new WSClient({ botId: cfg.botId, secret: cfg.secret });
    ctx.store.client = client; // single client for inbound + outbound (sendOne reads it)
    client.on('message.text', (frame) => hooks.onInbound(normalizeInbound(frame), null));
    // Persistent lifecycle listeners → core tri-state. Registered up front (pre-connect emits are
    // ignored by the core while not running); removed by disconnect()'s removeAllListeners.
    // NOTE: one connection per bot — running testConnection against the SAME bot kicks the live
    // bridge via disconnected_event, which the SDK treats as TERMINAL (isManualClose, no
    // reconnect). The status will correctly show Disconnected until the bridge is restarted;
    // auto-restart-after-test is a deliberate non-goal for now (backlog).
    let kicked = false;
    client.on('event.disconnected_event', () => {
      // Server kicked this connection (a new one took over): the SDK sets isManualClose and will
      // NOT reconnect, so this is terminal; the 'disconnected' emit that follows must not
      // downgrade it to reconnecting.
      kicked = true;
      hooks.onConnectionChange?.('disconnected', new Error('kicked: new connection established'));
    });
    client.on('disconnected', (reason) => {
      if (!kicked) hooks.onConnectionChange?.('reconnecting', reason ? new Error(String(reason)) : null);
    });
    client.on('reconnecting', () => hooks.onConnectionChange?.('reconnecting'));
    client.on('authenticated', () => { kicked = false; hooks.onConnectionChange?.('connected'); });
    client.on('error', (e) => {
      const terminal = e?.name === 'WSReconnectExhaustedError' || e?.name === 'WSAuthFailureError'
        || e?.code === 'WS_RECONNECT_EXHAUSTED';
      hooks.onConnectionChange?.(terminal ? 'disconnected' : null, e);
    });
    // connect() is synchronous; resolve once the WS handshake authenticates so the core's
    // `connected` flag and CONNECT_TIMEOUT_MS race are meaningful (bad creds → lastError, not a
    // false "connected"). Reject (and tear down) on error or an internal timeout.
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { client.disconnect(); } catch { /* best-effort */ }
        reject(new Error('connect timeout'));
      }, CONNECT_PROBE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      client.on('authenticated', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(client); });
      client.on('error', (e) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        // Tear down before rejecting — else the SDK keeps auto-reconnecting/retrying auth in the
        // background even though the bridge reports not-running.
        try { client.disconnect(); } catch { /* best-effort */ }
        reject(new Error(String(e?.message || e)));
      });
      client.connect();
    });
  },

  async disconnect(client, ctx) {
    try { client?.removeAllListeners?.(); } catch { /* best-effort */ }
    try { client?.disconnect?.(); } catch { /* best-effort */ }
    if (ctx?.store) ctx.store.client = null;
  },

  // Long-connection has no app-level inbound ACK (the SDK handles transport); rely on msgid dedup.
  ack() { /* no-op */ },

  async sendOne(cfg, target, content, ctx) {
    const client = ctx.store.client;
    if (!client) throw new Error('wecom client not connected');
    const res = await client.sendMessage(target.receiveId, { msgtype: 'markdown', markdown: { content } });
    if (res && typeof res.errcode === 'number' && res.errcode !== 0) {
      throw new Error(`send ${res.errcode}: ${res.errmsg || 'failed'}`);
    }
  },

  // ─── 逐字流式（AI 卡片）─── 用智能机器人长连接的 stream 被动回复(replyStream)：首帧即 ack(确立
  // streamId、落 5s 首回复窗口)，streamTick 逐帧推累计全文，finalize 以 finish=true 收尾(落 10min
  // 流式窗口内)。无模板 id 概念，开关就是 cfg.aiCard。
  streamEnabled(cfg) { return !!cfg?.aiCard; },

  async sendAckCard(cfg, target, statusText, ctx) {
    if (!cfg?.aiCard) return null;             // 未开 aiCard → 返回 null,core 回退 proactive 文本 ack(旧行为)
    const client = ctx.store.client;
    const frame = target?._frame;
    if (!client || !frame) {                   // 无连接/无帧(无法被动回复) → 回退
      if (ctx.store && !frame) ctx.store.lastAiCardError = 'no inbound frame';
      return null;
    }
    try {
      const streamId = randomUUID();
      // 首帧 finish=false：开流 + 即时 ack 文本。
      await client.replyStream(frame, streamId, statusText, false);
      return { streamId, frame, streaming: true };
    } catch (e) {
      if (ctx.store) ctx.store.lastAiCardError = String(e?.message || e);
      return null;                             // 开流失败 → 回退 proactive 文本 ack
    }
  },

  async streamCardText(cfg, target, handle, fullText, ctx) {
    const client = ctx.store.client;
    const frame = handle?.frame || target?._frame;
    if (!client || !frame || !handle?.streamId) return false;
    try {
      // 优先非阻塞：上一帧未 ack 则跳过本帧(返回 'skipped')，避免中间帧排队积压;最终全文由 finalize 兜底。
      if (typeof client.replyStreamNonBlocking === 'function') {
        const r = await client.replyStreamNonBlocking(frame, handle.streamId, fullText, false);
        return r !== 'skipped';
      }
      await client.replyStream(frame, handle.streamId, fullText, false);
      return true;
    } catch { return false; }
  },

  async updateAckCard(cfg, target, handle, fullText, status, ctx) {
    // 流式收尾：finish=true 的最终帧 SDK 保证发送(不受非阻塞跳帧限制)。WeCom stream 无状态标签，
    // 中断/失败语义由 core 传入的 fullText 文本自身承载，status 此处不额外渲染。
    try {
      const client = ctx.store.client;
      const frame = handle?.frame || target?._frame;
      if (!client || !frame || !handle?.streamId) return false;
      await client.replyStream(frame, handle.streamId, fullText, true);
      return true;
    } catch { return false; }
  },

  async testConnection(cfg) {
    // No REST validate endpoint exists for the smart-robot mode — auth is in the WS handshake. Open
    // a throwaway probe and wait for 'authenticated'. NOTE: WeCom allows one connection per bot, so
    // testing while the live bridge is connected to the same bot briefly kicks it (the bridge then
    // auto-reconnects). maxReconnectAttempts:0 keeps the probe from spinning a backoff loop.
    let client;
    try {
      const mod = await loadSdk();
      const WSClient = resolveWSClient(mod);
      client = new WSClient({ botId: cfg.botId, secret: cfg.secret, maxReconnectAttempts: 0 });
    } catch (e) {
      return { ok: false, detail: String(e?.message || e) };
    }
    return await new Promise((resolve) => {
      let settled = false;
      const done = (res) => {
        if (settled) return;
        settled = true;
        try { client.removeAllListeners?.(); } catch { /* best-effort */ }
        try { client.disconnect?.(); } catch { /* best-effort */ }
        resolve(res);
      };
      const timer = setTimeout(() => done({ ok: false, detail: 'timeout' }), TEST_PROBE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      client.on('authenticated', () => { clearTimeout(timer); done({ ok: true }); });
      client.on('error', (e) => { clearTimeout(timer); done({ ok: false, detail: String(e?.message || e) }); });
      try { client.connect(); } catch (e) { clearTimeout(timer); done({ ok: false, detail: String(e?.message || e) }); }
    });
  },
};

registerAdapter(wecomAdapter);

export default wecomAdapter;
