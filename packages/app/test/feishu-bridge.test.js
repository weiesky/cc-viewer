import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-feishu-bridge-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../server/lib/im/im-bridge-core.js');
const feishu = await import('../server/lib/adapters/feishu-adapter.js');

// Fake SDK ({ Client, WSClient, EventDispatcher, Domain, LoggerLevel }) — zero real SDK / socket.
let rec;
function installFakeSdk() {
  feishu.__setClientFactory(() => ({
    Domain: { Feishu: 0, Lark: 1 },
    LoggerLevel: { info: 3 },
    Client: class {
      constructor(opts) {
        rec.clientOpts = opts;
        this.im = { v1: { message: { create: async (args) => { rec.sends.push(args); return { code: 0 }; } } } };
        this.cardkit = { v1: {
          card: {
            create: async (a) => { (rec.cardkitCreates ||= []).push(a); return { code: 0, data: { card_id: 'card_' + ((rec.cardkitCreates || []).length) } }; },
            settings: async (a) => { (rec.cardkitSettings ||= []).push(a); return { code: 0 }; },
          },
          cardElement: { content: async (a) => { (rec.cardkitContents ||= []).push(a); return { code: 0 }; } },
        } };
      }
    },
    WSClient: class {
      constructor(opts) { rec.wsOpts = opts; }
      async start({ eventDispatcher }) { rec.started = true; rec.dispatcher = eventDispatcher; }
      async stop() { rec.stopped = true; }
    },
    EventDispatcher: class {
      constructor() { this._h = {}; }
      register(map) { Object.assign(this._h, map); rec.handlers = this._h; return this; }
    },
  }));
}

const tick = () => new Promise((r) => setTimeout(r, 5));

let injects, cfg, streaming, ptyKind, ptyRunning, skipPerm, injectOk, liveText;
function deps() {
  return {
    writeToPty: () => {},
    writeToPtySequential: (chunks, cb) => { injects.push(chunks[0]); if (cb) cb(injectOk); },
    getPtyState: () => ({ running: ptyRunning, exitCode: null }),
    getPtyKind: () => ptyKind,
    getPtySkipPermissions: () => skipPerm,
    isStreaming: () => streaming,
    getConfig: () => cfg,
    getLiveText: () => liveText,
    resetLiveText: () => { liveText = ''; },
  };
}

// Feed an im.message.receive_v1 event through the registered handler.
function receive(over = {}) {
  const message = {
    chat_id: over.chatId ?? 'oc_chat',
    chat_type: over.chatType ?? 'p2p',
    message_type: over.messageType ?? 'text',
    message_id: over.msgId ?? 'om_' + Math.random(),
    content: over.content ?? JSON.stringify({ text: 'hello' }),
  };
  const sender = { sender_id: { open_id: over.openId ?? 'ou_sender' } };
  return rec.handlers['im.message.receive_v1']({ message, sender });
}

before(() => { rec = {}; installFakeSdk(); });

beforeEach(async () => {
  core.__resetForTests('feishu');
  rec = { sends: [] };
  installFakeSdk();
  injects = [];
  cfg = { enabled: true, appId: 'cli_x', appSecret: 'sec', region: 'feishu', allowUserIds: [], maxChunkChars: 3800 };
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true; liveText = '';
  await core.startBridge('feishu', deps());
});

describe('feishu connect / lifecycle', () => {
  it('starts the WSClient with wsConfig + a registered im.message.receive_v1 handler', () => {
    assert.equal(core.isBridgeRunning('feishu'), true);
    assert.equal(rec.started, true);
    assert.ok(rec.wsOpts.wsConfig && rec.wsOpts.wsConfig.PingInterval, 'wsConfig must be set (else start() hangs)');
    assert.equal(typeof rec.handlers['im.message.receive_v1'], 'function');
  });

  it('maps region=lark to Domain.Lark', async () => {
    core.__resetForTests('feishu');
    rec = { sends: [] }; installFakeSdk();
    cfg = { ...cfg, region: 'lark' };
    await core.startBridge('feishu', deps());
    assert.equal(rec.clientOpts.domain, 1, 'lark → Domain.Lark (1)');
  });
});

describe('feishu inbound normalization', () => {
  it('injects a p2p text message with the ⟦im:feishu⟧ marker', async () => {
    await receive({ msgId: 'om1', content: JSON.stringify({ text: 'look here' }) });
    assert.equal(injects[0], '\x1b[200~⟦im:feishu:ou_sender⟧look here\x1b[201~');
  });

  it('strips @_user_N mention placeholders from group text', async () => {
    await receive({ msgId: 'om1', chatType: 'group', content: JSON.stringify({ text: '@_user_1 do this' }) });
    assert.equal(injects[0], '\x1b[200~⟦im:feishu:ou_sender⟧do this\x1b[201~');
  });

  it('ignores a non-text message (no injection)', async () => {
    await receive({ msgId: 'om1', messageType: 'image', content: JSON.stringify({ image_key: 'x' }) });
    assert.equal(injects.length, 0);
  });

  it('tolerates garbage content JSON', async () => {
    await receive({ msgId: 'om1', content: 'not json{{' });
    assert.equal(injects.length, 0); // empty text → ignored, no throw
  });

  it('dedups a redelivered message_id', async () => {
    await receive({ msgId: 'dup', content: JSON.stringify({ text: 'x' }) });
    await receive({ msgId: 'dup', content: JSON.stringify({ text: 'x' }) });
    assert.equal(injects.length, 1);
  });
});

describe('feishu outbound', () => {
  function writeTranscript(text) {
    const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }

  it('replies to a p2p turn via message.create with receive_id_type=open_id', async () => {
    await receive({ msgId: 'om1', openId: 'ou_alice', content: JSON.stringify({ text: 'hi' }) });
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('the answer'));
    const send = rec.sends.at(-1);
    assert.equal(send.params.receive_id_type, 'open_id');
    assert.equal(send.data.receive_id, 'ou_alice');
    assert.match(JSON.parse(send.data.content).text, /the answer/);
  });

  it('replies to a group turn via message.create with receive_id_type=chat_id', async () => {
    await receive({ msgId: 'om1', chatType: 'group', chatId: 'oc_grp', content: JSON.stringify({ text: 'hi' }) });
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('group answer'));
    const send = rec.sends.at(-1);
    assert.equal(send.params.receive_id_type, 'chat_id');
    assert.equal(send.data.receive_id, 'oc_grp');
  });
});

describe('feishu testConnection', () => {
  it('ok when the region-correct token host returns code 0', async () => {
    let hitUrl = null;
    core.__setFetchForTests(async (url) => { hitUrl = url; return { ok: true, json: async () => ({ code: 0, tenant_access_token: 't', expire: 7200 }) }; });
    const r = await core.testConnection('feishu', { appId: 'cli', appSecret: 'sec', region: 'feishu' });
    assert.equal(r.ok, true);
    assert.match(hitUrl, /open\.feishu\.cn/);
  });

  it('uses the larksuite host when region=lark', async () => {
    let hitUrl = null;
    core.__setFetchForTests(async (url) => { hitUrl = url; return { ok: true, json: async () => ({ code: 0 }) }; });
    await core.testConnection('feishu', { appId: 'cli', appSecret: 'sec', region: 'lark' });
    assert.match(hitUrl, /open\.larksuite\.com/);
  });

  it('fails on a non-zero body code even with HTTP 200', async () => {
    core.__setFetchForTests(async () => ({ ok: true, json: async () => ({ code: 99991663, msg: 'app not found' }) }));
    const r = await core.testConnection('feishu', { appId: 'bad', appSecret: 'bad', region: 'feishu' });
    assert.equal(r.ok, false);
    assert.match(r.detail, /app not found/);
  });
});

describe('feishu AI 卡片流式 (aiCard / CardKit)', () => {
  function writeTranscript(text) {
    const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }

  it('开 aiCard：建卡(streaming_mode)+引用 card_id 发送 → finalize 覆写全文 + 关流', async () => {
    cfg = { ...cfg, aiCard: true };
    await receive({ msgId: 'om1', openId: 'ou_a', content: JSON.stringify({ text: 'hi' }) });
    await tick();
    assert.equal((rec.cardkitCreates || []).length, 1, '应建卡');
    assert.equal(JSON.parse(rec.cardkitCreates[0].data.data).config.streaming_mode, true);
    const cardSend = rec.sends.find((s) => { try { return JSON.parse(s.data.content).type === 'card'; } catch { return false; } });
    assert.ok(cardSend, '应发引用 card_id 的 interactive 消息');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('streamed reply text'));
    await tick();
    assert.ok((rec.cardkitContents || []).length >= 1, 'finalize 应覆写正文');
    assert.match(rec.cardkitContents.at(-1).data.content, /streamed reply text/);
    assert.equal(JSON.parse(rec.cardkitSettings.at(-1).data.settings).config.streaming_mode, false, 'finalize 应关流');
  });

  it('关 aiCard：不建卡(走 1.0 占位卡片)', async () => {
    await receive({ msgId: 'om2', openId: 'ou_b', content: JSON.stringify({ text: 'hi' }) });
    await tick();
    assert.equal((rec.cardkitCreates || []).length, 0);
  });
});

describe('feishu connection tri-state (SDK lifecycle hooks)', () => {
  // Hook-capable @larksuiteoapi/node-sdk builds are feature-detected via getConnectionStatus();
  // the fake above lacks it, keeping the legacy await-start() path covered by the suites above.
  function installPatchedSdk({ readyMode = 'ok' } = {}) {
    feishu.__setClientFactory(() => ({
      Domain: { Feishu: 0, Lark: 1 },
      LoggerLevel: { info: 3 },
      Client: class { constructor(opts) { rec.clientOpts = opts; } },
      WSClient: class {
        constructor(opts) { rec.wsOpts = opts; }
        getConnectionStatus() { return { state: 'connected' }; }
        async start({ eventDispatcher }) {
          rec.started = true; rec.dispatcher = eventDispatcher;
          if (readyMode === 'ok') setImmediate(() => rec.wsOpts.onReady());
          else setImmediate(() => rec.wsOpts.onError(new Error('app misconfigured')));
        }
        close() { rec.closed = true; }
      },
      EventDispatcher: class {
        constructor() { this._h = {}; }
        register(map) { Object.assign(this._h, map); rec.handlers = this._h; return this; }
      },
    }));
  }

  async function startPatched(opts) {
    core.__resetForTests('feishu');
    rec = { sends: [] };
    installPatchedSdk(opts);
    await core.startBridge('feishu', deps());
  }

  it('connect gates on onReady and reports connected', async () => {
    await startPatched();
    assert.equal(core.isBridgeRunning('feishu'), true);
    assert.equal(core.getBridgeStatus('feishu').connectionState, 'connected');
  });

  it('onError before ready fails the start with lastError and tears the client down', async () => {
    await startPatched({ readyMode: 'error' });
    const st = core.getBridgeStatus('feishu');
    assert.equal(core.isBridgeRunning('feishu'), false);
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /app misconfigured/);
    assert.equal(rec.closed, true, 'ws.close() must stop the SDK retry loop');
  });

  it('onReconnecting → reconnecting; onReconnected → connected', async () => {
    await startPatched();
    rec.wsOpts.onReconnecting();
    let st = core.getBridgeStatus('feishu');
    assert.equal(st.connectionState, 'reconnecting');
    assert.equal(st.connected, false);
    rec.wsOpts.onReconnected();
    st = core.getBridgeStatus('feishu');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.connected, true);
  });

  it('post-settle onError → terminal disconnected + lastError', async () => {
    await startPatched();
    rec.wsOpts.onError(new Error('pull config failed'));
    const st = core.getBridgeStatus('feishu');
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /pull config failed/);
  });

  it('hooks firing after stopBridge cannot flip the state', async () => {
    await startPatched();
    const wsOpts = rec.wsOpts;
    await core.stopBridge('feishu');
    wsOpts.onReconnected();
    assert.equal(core.getBridgeStatus('feishu').connectionState, 'disconnected');
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
