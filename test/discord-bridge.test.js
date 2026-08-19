import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-discord-bridge-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../packages/app/server/lib/im-bridge-core.js');
const discord = await import('../packages/app/server/lib/adapters/discord-adapter.js');

// Fake discord.js — { Client, GatewayIntentBits, Partials, Events }. The fake must use the SAME Events
// values the adapter registers with.
const Events = { MessageCreate: 'messageCreate', ClientReady: 'clientReady' };
let rec, badToken;
class FakeClient extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.user = null; rec.client = this; }
  login(token) {
    rec.loginToken = token;
    if (token === badToken) return Promise.reject(new Error('invalid token'));
    this.user = { id: 'self' };
    setImmediate(() => this.emit(Events.ClientReady, this));
    return Promise.resolve(token);
  }
  destroy() { rec.destroyed = true; return Promise.resolve(); }
  get channels() { return { fetch: async (id) => { rec.channelsFetch.push(id); return { send: async (c) => { rec.sends.push({ via: 'channel', id, content: c }); return { id: 'mock-msg-' + rec.sends.length }; } }; } }; }
  get users() { return { fetch: async (id) => { rec.usersFetch.push(id); return { createDM: async () => ({ send: async (c) => { rec.sends.push({ via: 'dm', id, content: c }); return { id: 'mock-msg-' + rec.sends.length }; } }) }; } }; }
}
function installFakeSdk() {
  discord.__setClientFactory(() => ({
    Client: FakeClient,
    GatewayIntentBits: { Guilds: 1, GuildMessages: 512, MessageContent: 32768, DirectMessages: 4096 },
    Partials: { Channel: 1 },
    Events,
  }));
}

const tick = () => new Promise((r) => setTimeout(r, 5));

let injects, cfg, streaming, ptyKind, ptyRunning, skipPerm, injectOk;
function deps() {
  return {
    writeToPty: () => {},
    writeToPtySequential: (chunks, cb) => { injects.push(chunks[0]); if (cb) cb(injectOk); },
    getPtyState: () => ({ running: ptyRunning, exitCode: null }),
    getPtyKind: () => ptyKind,
    getPtySkipPermissions: () => skipPerm,
    isStreaming: () => streaming,
    getConfig: () => cfg,
  };
}

// Emit a messageCreate through the registered handler.
function receive(over = {}) {
  const guild = over.guild === undefined ? null : over.guild;
  rec.client.emit('messageCreate', {
    id: over.msgId ?? 'mid_' + Math.random(),
    content: over.content ?? 'hello',
    author: { id: over.authorId ?? 'alice', bot: over.bot ?? false },
    channelId: over.channelId ?? (guild ? 'chan1' : 'dmchan'),
    guild,
    inGuild() { return !!guild; },
  });
}

before(() => { rec = { sends: [], channelsFetch: [], usersFetch: [] }; installFakeSdk(); });

beforeEach(async () => {
  core.__resetForTests('discord');
  rec = { sends: [], channelsFetch: [], usersFetch: [] };
  badToken = '__bad__';
  installFakeSdk();
  injects = [];
  cfg = { enabled: true, botToken: 'goodtoken', allowUserIds: [], maxChunkChars: 1900 };
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true;
  await core.startBridge('discord', deps());
});

describe('discord connect / lifecycle', () => {
  it('connects (resolves on ClientReady) and registers a messageCreate handler', () => {
    assert.equal(core.isBridgeRunning('discord'), true);
    assert.equal(rec.loginToken, 'goodtoken');
    assert.ok(rec.client.listenerCount('messageCreate') > 0);
  });

  it('a bad token surfaces as not-running + lastError (login rejection routed in)', async () => {
    core.__resetForTests('discord');
    rec = { sends: [], channelsFetch: [], usersFetch: [] }; installFakeSdk();
    cfg = { ...cfg, botToken: '__bad__' };
    await core.startBridge('discord', deps());
    assert.equal(core.isBridgeRunning('discord'), false);
    assert.match(core.getBridgeStatus('discord').lastError || '', /invalid token/);
  });
});

describe('discord inbound', () => {
  it('injects a guild message with the ⟦im:discord⟧ marker', async () => {
    receive({ guild: { id: 'g1' }, content: 'look here' });
    await tick();
    assert.equal(injects[0], '\x1b[200~⟦im:discord:alice⟧look here\x1b[201~');
  });

  it('strips a leading bot mention', async () => {
    receive({ content: '<@123> do this' });
    await tick();
    assert.equal(injects[0], '\x1b[200~⟦im:discord:alice⟧do this\x1b[201~');
  });

  it('ignores the bot\'s own / other bot messages (loop guard)', async () => {
    receive({ bot: true, content: 'echo' });
    receive({ authorId: 'self', content: 'my own reply' });
    await tick();
    assert.equal(injects.length, 0);
  });

  it('dedups a redelivered message id', async () => {
    receive({ msgId: 'dup', content: 'x' });
    receive({ msgId: 'dup', content: 'x' });
    await tick();
    assert.equal(injects.length, 1);
  });

  it('enforces the userid allowlist', async () => {
    cfg = { ...cfg, allowUserIds: ['alice'] };
    receive({ authorId: 'intruder', content: 'x' });
    await tick();
    assert.equal(injects.length, 0);
    receive({ authorId: 'alice', content: 'ok' });
    await tick();
    assert.equal(injects[0], '\x1b[200~⟦im:discord:alice⟧ok\x1b[201~');
  });
});

describe('discord outbound', () => {
  function writeTranscript(text) {
    const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }

  it('replies to a DM via users.fetch().createDM() — NOT channels.fetch (the #9624 path)', async () => {
    receive({ authorId: 'bob', content: 'hi' }); // DM (no guild)
    await tick(); await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('dm answer'));
    assert.ok(rec.usersFetch.length > 0 && rec.usersFetch.every((u) => u === 'bob'), 'all usersFetch must be for bob');
    assert.equal(rec.channelsFetch.length, 0, 'must not channels.fetch a DM');
    assert.equal(rec.sends.at(-1).via, 'dm');
    assert.match(rec.sends.at(-1).content, /dm answer/);
  });

  it('replies to a guild channel via channels.fetch()', async () => {
    receive({ guild: { id: 'g1' }, channelId: 'chan9', content: 'hi' });
    await tick(); await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('guild answer'));
    assert.ok(rec.channelsFetch.length > 0 && rec.channelsFetch.every((c) => c === 'chan9'), 'all channelsFetch must be for chan9');
    assert.equal(rec.sends.at(-1).via, 'channel');
  });
});

describe('discord sendOne 2000-char hard split (defense)', () => {
  it('splits content over 2000 chars into multiple sends', async () => {
    const big = 'x'.repeat(4500);
    const ctx = { fetch: () => {}, store: { client: rec.client } };
    await discord.default.sendOne(cfg, { channelId: 'c', userId: null }, big, ctx);
    const guildSends = rec.sends.filter((s) => s.via === 'channel');
    assert.equal(guildSends.length, 3, '4500 → 2000 + 2000 + 500');
    for (const s of guildSends) assert.ok(s.content.length <= 2000);
    assert.equal(guildSends.map((s) => s.content).join('').length, 4500);
  });
});

describe('discord testConnection (REST /users/@me)', () => {
  it('ok on HTTP 200', async () => {
    core.__setFetchForTests(async (url, init) => { rec.testUrl = url; rec.testAuth = init?.headers?.Authorization; return { ok: true, status: 200, json: async () => ({ id: 'botself' }) }; });
    const r = await core.testConnection('discord', { botToken: 'tok' });
    assert.equal(r.ok, true);
    assert.match(rec.testUrl, /users\/@me/);
    assert.equal(rec.testAuth, 'Bot tok');
  });

  it('fails on HTTP 401', async () => {
    core.__setFetchForTests(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await core.testConnection('discord', { botToken: 'bad' });
    assert.equal(r.ok, false);
    assert.match(r.detail, /401/);
  });
});

describe('discord connection tri-state (shard lifecycle)', () => {
  // The fake Events map lacks shard constants, so the adapter falls back to the literal names —
  // exactly what real discord.js emits.
  it('shardReconnecting → reconnecting; shardResume/shardReady → connected', () => {
    assert.equal(core.getBridgeStatus('discord').connectionState, 'connected');
    rec.client.emit('shardReconnecting', 0);
    assert.equal(core.getBridgeStatus('discord').connectionState, 'reconnecting');
    rec.client.emit('shardResume', 0);
    assert.equal(core.getBridgeStatus('discord').connectionState, 'connected');
    rec.client.emit('shardReconnecting', 0);
    rec.client.emit('shardReady', 0);
    assert.equal(core.getBridgeStatus('discord').connectionState, 'connected');
  });

  it('shardDisconnect (unrecoverable close) → disconnected with the close code', () => {
    rec.client.emit('shardDisconnect', { code: 4004 }, 0);
    const st = core.getBridgeStatus('discord');
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /4004/);
  });

  it('invalidated session → disconnected', () => {
    rec.client.emit('invalidated');
    const st = core.getBridgeStatus('discord');
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /invalidated/);
  });

  it("'error' and 'shardError' record lastError without flipping the state", () => {
    rec.client.emit('error', new Error('gateway blip'));
    let st = core.getBridgeStatus('discord');
    assert.equal(st.connectionState, 'connected');
    assert.match(st.lastError, /gateway blip/);
    rec.client.emit('shardError', new Error('shard blip'), 0);
    st = core.getBridgeStatus('discord');
    assert.equal(st.connectionState, 'connected');
    assert.match(st.lastError, /shard blip/);
  });

  it("a post-connect 'error' must NOT destroy the live client (connect-window once('error') is settled-guarded)", () => {
    rec.client.emit('error', new Error('gateway blip'));
    assert.notEqual(rec.destroyed, true, 'client.destroy() must not run for a post-connect error');
    // The client is still alive: the subsequent shard lifecycle still drives the state.
    rec.client.emit('shardReconnecting', 0);
    assert.equal(core.getBridgeStatus('discord').connectionState, 'reconnecting');
    rec.client.emit('shardResume', 0);
    const st = core.getBridgeStatus('discord');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.lastError, null, 'recovery clears the recorded error');
  });

  it('shard emits after stopBridge cannot flip the state', async () => {
    const client = rec.client;
    await core.stopBridge('discord');
    client.emit('shardReady', 0);
    assert.equal(core.getBridgeStatus('discord').connectionState, 'disconnected');
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
