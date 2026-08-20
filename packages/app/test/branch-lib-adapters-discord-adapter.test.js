// 分支覆盖补强：server/lib/adapters/discord-adapter.js
// 直接调用 adapter 的方法(sendOne/sendAckCard/updateAckCard/testConnection/disconnect/ack/hasCreds)
// 并通过 connect 的 MessageCreate handler 驱动 normalizeInbound 的全部分支。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 私有 LOG_DIR,必须在目标模块(经 im-bridge-core)首次 import 之前设好。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-discord-' + process.pid + '-'));
process.env.CCV_LOG_DIR = tmpDir;

let discord, adapter;

before(async () => {
  discord = await import('../server/lib/adapters/discord-adapter.js');
  adapter = discord.default;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

// ─── helpers ───
const Events = { MessageCreate: 'messageCreate', ClientReady: 'clientReady' };

// 通用可发送 channel 工厂(send 返回带 id 的 msg)
function makeChannel(rec, via, id) {
  return {
    send: async (c) => { rec.sends.push({ via, id, content: c }); return { id: 'm' + (rec.sends.length) }; },
    messages: {
      fetch: async (mid) => { rec.fetchedMsg = mid; return { id: mid, edit: async (c) => { rec.edited = c; } }; },
    },
  };
}

// ─── hasCreds / statusFields / 静态字段 ───
describe('discord hasCreds / 静态描述', () => {
  it('hasCreds 在有 token 时为 true,无 token 时为 false', () => {
    assert.equal(adapter.hasCreds({ botToken: 'x' }), true);
    assert.equal(adapter.hasCreds({ botToken: '' }), false);
    assert.equal(adapter.hasCreds({}), false);
  });
  it('statusFields 返回空对象(token 是密钥,不暴露)', () => {
    assert.deepEqual(adapter.statusFields(), {});
  });
  it('ack 是 no-op,不抛错', () => {
    assert.doesNotThrow(() => adapter.ack());
  });
  it('id / allowListField / capabilities 字段正确', () => {
    assert.equal(adapter.id, 'discord');
    assert.equal(adapter.allowListField, 'allowUserIds');
    assert.equal(adapter.capabilities.inboundAck, false);
  });
});

// ─── sendOne 分支 ───
describe('discord sendOne 分支', () => {
  it('client 缺失时抛 not connected', async () => {
    await assert.rejects(
      () => adapter.sendOne({}, { channelId: 'c' }, 'hi', { store: {} }),
      /not connected/,
    );
  });

  it('guild 路径(无 userId)走 channels.fetch,短内容单条发送', async () => {
    const rec = { sends: [], channelsFetch: [], usersFetch: [] };
    const client = {
      channels: { fetch: async (id) => { rec.channelsFetch.push(id); return makeChannel(rec, 'channel', id); } },
      users: { fetch: async () => { throw new Error('should not be called'); } },
    };
    await adapter.sendOne({}, { channelId: 'chan1', userId: null }, 'short', { store: { client } });
    assert.deepEqual(rec.channelsFetch, ['chan1']);
    assert.equal(rec.sends.length, 1);
    assert.equal(rec.sends[0].via, 'channel');
  });

  it('DM 路径(有 userId)走 users.fetch().createDM()', async () => {
    const rec = { sends: [], usersFetch: [] };
    const client = {
      users: { fetch: async (id) => { rec.usersFetch.push(id); return { createDM: async () => makeChannel(rec, 'dm', id) }; } },
      channels: { fetch: async () => { throw new Error('should not be called'); } },
    };
    await adapter.sendOne({}, { channelId: 'cc', userId: 'u1' }, 'hi', { store: { client } });
    assert.deepEqual(rec.usersFetch, ['u1']);
    assert.equal(rec.sends.at(-1).via, 'dm');
  });

  it('channel 不可发送(send 非函数)时抛 not sendable', async () => {
    const client = { channels: { fetch: async () => ({ /* no send */ }) } };
    await assert.rejects(
      () => adapter.sendOne({}, { channelId: 'c', userId: null }, 'x', { store: { client } }),
      /not sendable/,
    );
  });

  it('channel 为 null 时抛 not sendable', async () => {
    const client = { channels: { fetch: async () => null } };
    await assert.rejects(
      () => adapter.sendOne({}, { channelId: 'c', userId: null }, 'x', { store: { client } }),
      /not sendable/,
    );
  });

  it('超 2000 字硬切分(4500 → 2000+2000+500)', async () => {
    const rec = { sends: [] };
    const client = { channels: { fetch: async (id) => makeChannel(rec, 'channel', id) } };
    await adapter.sendOne({}, { channelId: 'c', userId: null }, 'x'.repeat(4500), { store: { client } });
    assert.equal(rec.sends.length, 3);
    for (const s of rec.sends) assert.ok(s.content.length <= 2000);
    assert.equal(rec.sends.map((s) => s.content).join('').length, 4500);
  });

  it('空内容(length 0)时 for 循环零次,不发送', async () => {
    const rec = { sends: [] };
    const client = { channels: { fetch: async (id) => makeChannel(rec, 'channel', id) } };
    await adapter.sendOne({}, { channelId: 'c', userId: null }, '', { store: { client } });
    assert.equal(rec.sends.length, 0);
  });
});

// ─── sendAckCard 分支 ───
describe('discord sendAckCard 分支', () => {
  it('client 缺失时抛 not connected', async () => {
    await assert.rejects(
      () => adapter.sendAckCard({}, { channelId: 'c' }, 'status', { store: {} }),
      /not connected/,
    );
  });

  it('guild 路径返回 channelId/messageId/userId 句柄', async () => {
    const rec = { sends: [] };
    const client = { channels: { fetch: async (id) => makeChannel(rec, 'channel', id) } };
    const h = await adapter.sendAckCard({}, { channelId: 'chanA', userId: null }, '思考中', { store: { client } });
    assert.equal(h.channelId, 'chanA');
    assert.ok(h.messageId);
    assert.equal(h.userId, null);
  });

  it('DM 路径走 users.fetch().createDM()', async () => {
    const rec = { sends: [], usersFetch: [] };
    const client = { users: { fetch: async (id) => { rec.usersFetch.push(id); return { createDM: async () => makeChannel(rec, 'dm', id) }; } } };
    const h = await adapter.sendAckCard({}, { channelId: 'cc', userId: 'u9' }, 'st', { store: { client } });
    assert.deepEqual(rec.usersFetch, ['u9']);
    assert.equal(h.userId, 'u9');
  });

  it('channel 不可发送时抛 not sendable', async () => {
    const client = { channels: { fetch: async () => ({}) } };
    await assert.rejects(
      () => adapter.sendAckCard({}, { channelId: 'c', userId: null }, 's', { store: { client } }),
      /not sendable/,
    );
  });
});

// ─── updateAckCard 分支(全为未覆盖热点 159-164) ───
describe('discord updateAckCard 分支', () => {
  it('client 缺失时返回 false', async () => {
    const ok = await adapter.updateAckCard({}, {}, {}, 'c', 'done', { store: {} });
    assert.equal(ok, false);
  });

  it('guild 路径成功 edit 返回 true,并裁剪到 2000 字', async () => {
    const rec = { sends: [] };
    const client = { channels: { fetch: async (id) => makeChannel(rec, 'channel', id) } };
    const ok = await adapter.updateAckCard(
      {}, { channelId: 'cX', userId: null }, { channelId: 'cX', messageId: 'm1', userId: null },
      'y'.repeat(3000), 'done', { store: { client } },
    );
    assert.equal(ok, true);
    assert.equal(rec.fetchedMsg, 'm1');
    assert.equal(rec.edited.length, 2000);
  });

  it('DM 路径(handle.userId)走 users.fetch().createDM() 并成功', async () => {
    const rec = { sends: [], usersFetch: [] };
    const client = { users: { fetch: async (id) => { rec.usersFetch.push(id); return { createDM: async () => makeChannel(rec, 'dm', id) }; } } };
    const ok = await adapter.updateAckCard(
      {}, { userId: 'u7' }, { userId: 'u7', messageId: 'mm', channelId: 'cc' },
      'short', 'done', { store: { client } },
    );
    assert.equal(ok, true);
    assert.deepEqual(rec.usersFetch, ['u7']);
    assert.equal(rec.edited, 'short');
  });

  it('channel.messages.fetch 非函数时返回 false', async () => {
    const client = { channels: { fetch: async () => ({ /* no messages */ }) } };
    const ok = await adapter.updateAckCard(
      {}, { channelId: 'c' }, { channelId: 'c', messageId: 'm' }, 'x', 'done', { store: { client } },
    );
    assert.equal(ok, false);
  });

  it('channel 为 null 时返回 false', async () => {
    const client = { channels: { fetch: async () => null } };
    const ok = await adapter.updateAckCard(
      {}, { channelId: 'c' }, { channelId: 'c', messageId: 'm' }, 'x', 'done', { store: { client } },
    );
    assert.equal(ok, false);
  });

  it('内部抛错时 catch 返回 false', async () => {
    const client = { channels: { fetch: async () => { throw new Error('boom'); } } };
    const ok = await adapter.updateAckCard(
      {}, { channelId: 'c' }, { channelId: 'c', messageId: 'm' }, 'x', 'done', { store: { client } },
    );
    assert.equal(ok, false);
  });
});

// ─── testConnection 分支(176-177 catch) ───
describe('discord testConnection 分支', () => {
  it('HTTP 200 → ok:true', async () => {
    let url, auth;
    const ctx = { fetch: async (u, init) => { url = u; auth = init?.headers?.Authorization; return { ok: true, status: 200 }; } };
    const r = await adapter.testConnection({ botToken: 'tok' }, ctx);
    assert.deepEqual(r, { ok: true });
    assert.match(url, /users\/@me/);
    assert.equal(auth, 'Bot tok');
  });

  it('HTTP 非 ok → ok:false + HTTP detail', async () => {
    const ctx = { fetch: async () => ({ ok: false, status: 403 }) };
    const r = await adapter.testConnection({ botToken: 'bad' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /HTTP 403/);
  });

  it('fetch 抛 Error → catch 返回 message detail', async () => {
    const ctx = { fetch: async () => { throw new Error('network down'); } };
    const r = await adapter.testConnection({ botToken: 't' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /network down/);
  });

  it('fetch 抛非 Error(无 message)→ catch 用 String(e)', async () => {
    const ctx = { fetch: async () => { throw 'raw-string-error'; } }; // eslint-disable-line no-throw-literal
    const r = await adapter.testConnection({ botToken: 't' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /raw-string-error/);
  });
});

// ─── disconnect 分支 ───
describe('discord disconnect 分支', () => {
  it('完整 client + ctx.store:调用 removeAllListeners/destroy 并清空 store.client', async () => {
    let removed = false, destroyed = false;
    const store = { client: {} };
    const client = { removeAllListeners: () => { removed = true; }, destroy: async () => { destroyed = true; } };
    await adapter.disconnect(client, { store });
    assert.equal(removed, true);
    assert.equal(destroyed, true);
    assert.equal(store.client, null);
  });

  it('client 为 null / ctx 无 store:可选链全部短路,不抛错', async () => {
    await assert.doesNotReject(() => adapter.disconnect(null, {}));
    await assert.doesNotReject(() => adapter.disconnect(undefined, undefined));
  });

  it('removeAllListeners / destroy 抛错被 try/catch 吞掉', async () => {
    const client = {
      removeAllListeners: () => { throw new Error('rm fail'); },
      destroy: async () => { throw new Error('destroy fail'); },
    };
    await assert.doesNotReject(() => adapter.disconnect(client, { store: {} }));
  });
});

// ─── connect:驱动 normalizeInbound 的全部分支 ───
describe('discord connect → normalizeInbound 分支', () => {
  // 构造一个最小 FakeClient,捕获 onInbound 的规范化结果。
  class FakeClient extends EventEmitter {
    constructor() { super(); this.user = null; }
    login(token) {
      this._token = token;
      if (token === '__bad__') return Promise.reject(new Error('invalid token'));
      if (token === '__hang__') return Promise.resolve(token); // 不触发 ClientReady → 走 error/timeout
      this.user = { id: 'self' };
      setImmediate(() => this.emit(Events.ClientReady, this));
      return Promise.resolve(token);
    }
    destroy() { this._destroyed = true; return Promise.resolve(); }
  }

  function installSdk() {
    discord.__setClientFactory(() => ({
      Client: FakeClient,
      GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 },
      Partials: { Channel: 1 },
      Events,
    }));
  }
  function makeCtx() { return { store: {} }; }

  it('connect 成功(ClientReady)解析为 client,并注册 error + messageCreate', async () => {
    installSdk();
    const ctx = makeCtx();
    const inbound = [];
    const client = await adapter.connect({ botToken: 'good' }, { onInbound: (m) => inbound.push(m) }, ctx);
    assert.ok(client);
    assert.ok(client.listenerCount(Events.MessageCreate) > 0);
    assert.ok(client.listenerCount('error') > 0);
  });

  it('持久 error 监听器吞掉运行期 error,不抛(进程不崩)', async () => {
    installSdk();
    const ctx = makeCtx();
    const client = await adapter.connect({ botToken: 'good' }, { onInbound: () => {} }, ctx);
    assert.doesNotThrow(() => client.emit('error', new Error('late gateway error')));
  });

  it('login reject(坏 token)→ connect 拒绝', async () => {
    installSdk();
    await assert.rejects(
      () => adapter.connect({ botToken: '__bad__' }, { onInbound: () => {} }, makeCtx()),
      /invalid token/,
    );
  });

  it('未设 factory → loadSdk 走真实 import("discord.js")(坏 token 必拒绝)', async () => {
    discord.__setClientFactory(null); // 覆盖 line23 的 false 分支:真实 import 路径
    const ctx = { store: {} };
    try {
      await assert.rejects(
        () => adapter.connect({ botToken: 'definitely-not-a-valid-bot-token' }, { onInbound: () => {} }, ctx),
        // 坏 token 触发真实 login → 网络/鉴权错误(或连接窗超时),任一拒绝皆可。
      );
    } finally {
      try { await ctx.store.client?.destroy?.(); } catch { /* best-effort */ }
      installSdk(); // 还原 fake factory,避免污染后续(本文件作用域)。
    }
  });

  it('运行期 error 事件(连接窗内)→ connect 拒绝', async () => {
    // 一个永不 ClientReady 的 client,connect 后我们 emit error 触发 once('error') reject 路径。
    class HangClient extends EventEmitter {
      constructor() { super(); this.user = null; }
      login() { setImmediate(() => this.emit('error', new Error('gw boom'))); return Promise.resolve('t'); }
      destroy() { return Promise.resolve(); }
    }
    discord.__setClientFactory(() => ({
      Client: HangClient,
      GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 },
      Partials: { Channel: 1 },
      Events,
    }));
    await assert.rejects(
      () => adapter.connect({ botToken: 't' }, { onInbound: () => {} }, makeCtx()),
      /gw boom/,
    );
    installSdk();
  });

  // 用真实 connect 拿到 client 后,手动 emit messageCreate 来覆盖 loop-guard + normalizeInbound。
  async function connected() {
    installSdk();
    const ctx = makeCtx();
    const inbound = [];
    const client = await adapter.connect({ botToken: 'good' }, { onInbound: (m) => inbound.push(m) }, ctx);
    return { client, inbound };
  }

  it('loop-guard:author.bot 的消息被忽略', async () => {
    const { client, inbound } = await connected();
    client.emit(Events.MessageCreate, { id: '1', content: 'x', author: { id: 'a', bot: true }, channelId: 'c', inGuild: () => true });
    assert.equal(inbound.length, 0);
  });

  it('loop-guard:author.id === self 的消息被忽略', async () => {
    const { client, inbound } = await connected();
    client.emit(Events.MessageCreate, { id: '2', content: 'x', author: { id: 'self', bot: false }, channelId: 'c', inGuild: () => true });
    assert.equal(inbound.length, 0);
  });

  it('loop-guard:author 为 undefined 时可选链短路,正常入站', async () => {
    const { client, inbound } = await connected();
    // author 缺失 → message.author?.bot 短路为 undefined(falsy),id 检查 undefined === 'self' false → 进入 normalize
    client.emit(Events.MessageCreate, { id: '3', content: 'hi', author: undefined, channelId: 'c', inGuild: () => true });
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].senderId, '');
    assert.equal(inbound[0].senderName, null);
    assert.equal(inbound[0].senderAvatar, null);
  });

  it('normalizeInbound:inGuild() 为函数且 true → isGroup,target.userId 为 null', async () => {
    const { client, inbound } = await connected();
    client.emit(Events.MessageCreate, {
      id: '4', content: '<@99> hello there', channelId: 'gchan',
      author: { id: 'alice', bot: false, global_name: 'Alice', displayAvatarURL: () => 'http://av/alice.png' },
      inGuild: () => true,
    });
    assert.equal(inbound.length, 1);
    const m = inbound[0];
    assert.equal(m.isGroup, true);
    assert.equal(m.text, 'hello there'); // 去掉 <@99> 前缀
    assert.equal(m.conversationId, 'gchan');
    assert.equal(m.senderId, 'alice');
    assert.equal(m.senderName, 'Alice'); // global_name 优先
    assert.equal(m.senderAvatar, 'http://av/alice.png'); // displayAvatarURL 优先
    assert.equal(m.target.userId, null);
  });

  it('normalizeInbound:inGuild 非函数 → 用 !!message.guild;无 displayAvatarURL 用 avatar hash 拼 CDN', async () => {
    const { client, inbound } = await connected();
    client.emit(Events.MessageCreate, {
      id: '5', content: 'dm text', channelId: 'dmc',
      author: { id: 'bob', bot: false, username: 'bobby', avatar: 'abc' }, // 无 global_name → 用 username;无 displayAvatarURL → 拼 CDN
      guild: null, // inGuild 非函数 → !!guild = false → DM
    });
    assert.equal(inbound.length, 1);
    const m = inbound[0];
    assert.equal(m.isGroup, false);
    assert.equal(m.senderName, 'bobby'); // username 回退
    assert.equal(m.senderAvatar, 'https://cdn.discordapp.com/avatars/bob/abc.png');
    assert.equal(m.target.userId, 'bob'); // DM → userId = senderId
  });

  it('normalizeInbound:无 displayAvatarURL 且无 avatar → senderAvatar 为 null;content 为 null → text 为空串', async () => {
    const { client, inbound } = await connected();
    client.emit(Events.MessageCreate, {
      id: '6', content: null, channelId: 'c2',
      author: { id: 'carol', bot: false }, // 无名字 → null;无 avatar → null
      guild: { id: 'g' }, // inGuild 非函数,但 guild 真值 → isGroup true
    });
    assert.equal(inbound.length, 1);
    const m = inbound[0];
    assert.equal(m.text, '');
    assert.equal(m.senderName, null);
    assert.equal(m.senderAvatar, null);
    assert.equal(m.isGroup, true);
  });
});
