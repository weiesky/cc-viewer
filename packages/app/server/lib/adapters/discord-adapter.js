// Discord adapter — the platform-specific half of the Discord bridge. The generic orchestration
// (dedup, access control, queue, inject, chunk, turn-end reply) lives in server/lib/im-bridge-core.js;
// this module only knows discord.js's Gateway client, inbound message shape, and outbound send.
//
// Uses discord.js v14: the bot dials OUT to Discord's Gateway WebSocket (no public URL). Credential is
// a single bot token. Per the multi-IM model it responds to ALL messages in the bound conversation
// (a guild channel or a DM); only the bot/self loop-guard applies. Reply lands ~10s after the turn.
//
// Distilled from LangBot's Discord adapter: enable the privileged MESSAGE_CONTENT intent; loop-guard
// `author.bot || author.id === self`; DM vs guild by `inGuild()`, reply target = channel.
//
// Console prerequisite (no code equivalent — surfaced in the UI help): in the Discord Developer Portal,
// create an app + bot, ENABLE the Message Content Intent (else message.content is silently empty), copy
// the bot token, and invite the bot with the `bot`+`applications.commands` scopes and View/Send perms.
import { registerAdapter } from '../im-bridge-core.js';

// ─── test seam: a fake discord.js factory (zero real gateway / socket) ───
let sdkFactory = null;
export function __setClientFactory(fn) { sdkFactory = fn; }

async function loadSdk() {
  if (sdkFactory) return sdkFactory();
  return import('discord.js');
}

const CONNECT_PROBE_MS = 12_000; // internal connect guard (< core CONNECT_TIMEOUT_MS)
const DISCORD_MAX = 2_000;       // hard per-message limit

/** Normalize a discord.js Message into the core's inbound shape. The bot/self loop-guard runs in the
 *  event handler (before this). */
function normalizeInbound(message) {
  const isGroup = typeof message.inGuild === 'function' ? message.inGuild() : !!message.guild;
  const author = message.author || {};
  const senderId = author.id || '';
  const channelId = message.channelId;
  // Strip a leading bot mention (<@123> / <@!123>) so "@bot do X" injects as "do X".
  const text = String(message.content ?? '').replace(/^<@!?\d+>\s*/, '');
  // 姓名 + 头像在事件里免费可得（无需 API）：优先 global_name，头像用 discord.js 的 displayAvatarURL()，
  // 退化为按 avatar hash 拼 CDN URL（无头像则 null，由前端回落默认头像）。
  const senderAvatar = typeof author.displayAvatarURL === 'function'
    ? author.displayAvatarURL()
    : (author.avatar ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png` : null);
  return {
    text,
    conversationId: channelId,
    isGroup,
    senderId,
    senderName: author.global_name || author.username || null,
    senderAvatar,
    msgId: message.id,
    // For a DM, channels.fetch(channelId) is broken on a partial DM channel (CHANNEL_RECIPIENT_REQUIRED),
    // so carry the user id and reply via users.fetch().createDM(). Guild channels fetch reliably by id.
    target: { conversationId: channelId, channelId, userId: isGroup ? null : senderId },
  };
}

const discordAdapter = {
  id: 'discord',
  i18nNs: 'server.discord',
  allowListField: 'allowUserIds',
  capabilities: { inboundAck: false },
  // Discord allows ~5 messages / 5s per channel; cap conservatively.
  rateLimit: { max: 5, windowMs: 5_000 },

  hasCreds(cfg) { return !!cfg.botToken; },
  // Discord's only credential is the token (a secret) — exposing any tail would leak secret material.
  statusFields() { return {}; },

  async connect(cfg, hooks, ctx) {
    const mod = await loadSdk();
    const { Client, GatewayIntentBits, Partials, Events } = mod;
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // privileged — must also be enabled in the Dev Portal
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // REQUIRED to receive DMs (DM channels are uncached)
    });
    ctx.store.client = client;
    // Persistent error listener for the life of the client: a Node EventEmitter that emits 'error'
    // with NO listener throws and crashes the process. NOTE: the connect-window once('error') below
    // is NOT consumed by a successful ClientReady resolve — it survives and must therefore be a
    // settled-guarded no-op post-connect (see below). Record errors as lastError here (state flips
    // come from the shard lifecycle events below; the gateway auto-reconnects).
    client.on('error', (e) => hooks.onConnectionChange?.(null, e));
    // Shard lifecycle → core tri-state. Single unsharded gateway = one shard, so no per-shard map.
    // Events?.X ?? 'literal' keeps test fakes (whose Events map lacks shard constants) working.
    client.on(Events?.ShardReconnecting ?? 'shardReconnecting', () => hooks.onConnectionChange?.('reconnecting'));
    client.on(Events?.ShardResume ?? 'shardResume', () => hooks.onConnectionChange?.('connected'));
    client.on(Events?.ShardReady ?? 'shardReady', () => hooks.onConnectionChange?.('connected'));
    client.on(Events?.ShardDisconnect ?? 'shardDisconnect', (ev) =>
      hooks.onConnectionChange?.('disconnected', new Error(`gateway closed (code ${ev?.code ?? 'unknown'})`)));
    client.on(Events?.Invalidated ?? 'invalidated', () =>
      hooks.onConnectionChange?.('disconnected', new Error('session invalidated')));
    client.on(Events?.ShardError ?? 'shardError', (e) => hooks.onConnectionChange?.(null, e));
    client.on(Events.MessageCreate, (message) => {
      // Loop-guard: ignore the bot's own messages (Discord redelivers our send as a new event) and
      // all other bots. author.bot covers self; the id check is belt-and-suspenders.
      if (message.author?.bot || message.author?.id === client.user?.id) return;
      hooks.onInbound(normalizeInbound(message), null);
    });
    // login() resolves only the handshake start and REJECTS (as a promise) on a bad token — route that
    // into the same promise, else a bad token hangs to the timeout. ClientReady signals fully-ready.
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
      const timer = setTimeout(() => { try { client.destroy(); } catch { /* best-effort */ } finish(reject, new Error('connect timeout')); }, CONNECT_PROBE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      client.once(Events.ClientReady, () => finish(resolve, client));
      // Guard the destroy behind `settled`: this once-listener is NOT consumed by ClientReady, so
      // an unguarded destroy would kill the LIVE client on the first post-connect 'error' event
      // (freezing the bridge with no reconnect — the exact stale-status bug this adapter fixes).
      client.once('error', (e) => {
        if (settled) return; // post-connect errors are handled by the persistent listener above
        try { client.destroy(); } catch { /* best-effort */ }
        finish(reject, new Error(String(e?.message || e)));
      });
      client.login(cfg.botToken).catch((e) => {
        if (settled) return;
        try { client.destroy(); } catch { /* best-effort */ }
        finish(reject, new Error(String(e?.message || e)));
      });
    });
  },

  async disconnect(client, ctx) {
    try { client?.removeAllListeners?.(); } catch { /* best-effort */ }
    try { await client?.destroy?.(); } catch { /* best-effort */ }
    if (ctx?.store) ctx.store.client = null;
  },

  ack() { /* no-op (Discord has no inbound ack; loop-guard + msgId dedup handle redelivery) */ },

  async sendOne(cfg, target, content, ctx) {
    const client = ctx.store.client;
    if (!client) throw new Error('discord client not connected');
    let channel;
    if (target.userId) {
      // DM: reconstruct via the user (channels.fetch on a partial DM channel throws #9624).
      const user = await client.users.fetch(target.userId);
      channel = await user.createDM();
    } else {
      channel = await client.channels.fetch(target.channelId);
    }
    if (!channel || typeof channel.send !== 'function') throw new Error(`channel not sendable: ${target.channelId}`);
    // Hard-split at Discord's 2000-char limit (defense: maxChunkChars clamps up to 5000, > the limit).
    for (let i = 0; i < content.length; i += DISCORD_MAX) {
      await channel.send(content.slice(i, i + DISCORD_MAX));
    }
  },

  async sendAckCard(cfg, target, statusText, ctx) {
    const client = ctx.store.client;
    if (!client) throw new Error('discord client not connected');
    let channel;
    if (target.userId) {
      const user = await client.users.fetch(target.userId);
      channel = await user.createDM();
    } else {
      channel = await client.channels.fetch(target.channelId);
    }
    if (!channel || typeof channel.send !== 'function') throw new Error(`channel not sendable: ${target.channelId}`);
    const msg = await channel.send(statusText);
    return { channelId: target.channelId, messageId: msg.id, userId: target.userId };
  },

  async updateAckCard(cfg, target, handle, content, status, ctx) {
    try {
      const client = ctx.store.client;
      if (!client) return false;
      let channel;
      if (handle.userId) {
        const user = await client.users.fetch(handle.userId);
        channel = await user.createDM();
      } else {
        channel = await client.channels.fetch(handle.channelId);
      }
      if (!channel || typeof channel.messages?.fetch !== 'function') return false;
      const msg = await channel.messages.fetch(handle.messageId);
      await msg.edit(content.slice(0, DISCORD_MAX));
      return true;
    } catch {
      return false;
    }
  },

  async testConnection(cfg, ctx) {
    // Validate the token via REST without opening a gateway (and without the privileged intent).
    try {
      const r = await ctx.fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${cfg.botToken}` },
      });
      if (r.ok) return { ok: true };
      return { ok: false, detail: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, detail: String(e?.message || e) };
    }
  },
};

registerAdapter(discordAdapter);

export default discordAdapter;
