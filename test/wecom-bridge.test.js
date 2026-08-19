import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-wecom-bridge-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../packages/app/server/lib/im-bridge-core.js');
const wecom = await import('../packages/app/server/lib/adapters/wecom-adapter.js');

// Fake @wecom/aibot-node-sdk WSClient (EventEmitter) — zero real SDK / socket.
let rec, authMode, sendErrcode;
class FakeWSClient extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; rec.client = this; rec.opts = opts; }
  connect() {
    rec.connected = true;
    // emit on next tick so the adapter's authenticated/error listeners are registered first
    setImmediate(() => { if (authMode === 'ok') this.emit('authenticated'); else this.emit('error', new Error('bad creds')); });
    return this;
  }
  disconnect() { rec.disconnected = true; }
  async sendMessage(receiveId, body) { rec.sends.push({ receiveId, body }); return { errcode: sendErrcode, errmsg: sendErrcode ? 'fail' : 'ok' }; }
  async replyStream(frame, streamId, content, finish) { (rec.streams ||= []).push({ frame, streamId, content, finish }); return { headers: {} }; }
  async replyStreamNonBlocking(frame, streamId, content, finish) { (rec.streams ||= []).push({ frame, streamId, content, finish, nb: true }); return { headers: {} }; }
}
function installFakeSdk() {
  wecom.__setClientFactory(() => ({ WSClient: FakeWSClient }));
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

// Feed a message.text frame through the registered handler on the live client.
function receive(over = {}) {
  rec.client.emit('message.text', {
    headers: { req_id: 'r' + Math.random() },
    body: {
      msgid: over.msgId ?? 'mid_' + Math.random(),
      aibotid: 'bot_x',
      chattype: over.chatType ?? 'single',
      chatid: over.chatId,
      from: { userid: over.userid ?? 'zhangsan' },
      text: over.text === undefined ? { content: 'hello' } : over.text,
    },
  });
}

before(() => { rec = { sends: [] }; installFakeSdk(); });

beforeEach(async () => {
  core.__resetForTests('wecom');
  rec = { sends: [] };
  authMode = 'ok'; sendErrcode = 0;
  installFakeSdk();
  injects = [];
  cfg = { enabled: true, botId: 'bot_x', secret: 's', allowUserIds: [], maxChunkChars: 3800 };
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true; liveText = '';
  await core.startBridge('wecom', deps());
});

describe('wecom connect / lifecycle', () => {
  it('connects (resolves on authenticated) and registers a message.text handler', () => {
    assert.equal(core.isBridgeRunning('wecom'), true);
    assert.equal(rec.connected, true);
    assert.equal(rec.opts.botId, 'bot_x');
    assert.ok(rec.client.listenerCount('message.text') > 0);
  });

  it('a bad-cred connect surfaces as not-running + lastError (no false connected)', async () => {
    core.__resetForTests('wecom');
    rec = { sends: [] }; installFakeSdk(); authMode = 'fail';
    await core.startBridge('wecom', deps());
    assert.equal(core.isBridgeRunning('wecom'), false);
    assert.match(core.getBridgeStatus('wecom').lastError || '', /bad creds/);
  });
});

describe('wecom inbound normalization', () => {
  it('injects a single-chat text message with the ⟦im:wecom⟧ marker', async () => {
    receive({ text: { content: 'look here' } });
    await tick();
    assert.equal(injects[0], '\x1b[200~⟦im:wecom:zhangsan⟧look here\x1b[201~');
  });

  it('ignores a non-text (empty text) message', async () => {
    receive({ text: { content: '' } });
    await tick();
    assert.equal(injects.length, 0);
  });

  it('tolerates a frame with no body (no throw, no inject)', async () => {
    rec.client.emit('message.text', { headers: { req_id: 'x' } });
    await tick();
    assert.equal(injects.length, 0);
  });

  it('dedups a redelivered msgid', async () => {
    receive({ msgId: 'dup', text: { content: 'x' } });
    receive({ msgId: 'dup', text: { content: 'x' } });
    await tick();
    assert.equal(injects.length, 1);
  });

  it('drops a group frame with no chatid (no reply target → no inject)', async () => {
    receive({ chatType: 'group', text: { content: 'orphan' } }); // chatId omitted
    await tick();
    assert.equal(injects.length, 0);
  });

  it('enforces the userid allowlist', async () => {
    cfg = { ...cfg, allowUserIds: ['alice'] };
    receive({ userid: 'intruder', text: { content: 'x' } });
    await tick();
    assert.equal(injects.length, 0);
    receive({ userid: 'alice', text: { content: 'ok' } });
    await tick();
    assert.equal(injects[0], '\x1b[200~⟦im:wecom:alice⟧ok\x1b[201~');
  });
});

describe('wecom outbound', () => {
  function writeTranscript(text) {
    const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }

  it('replies to a single chat via sendMessage(userid, markdown)', async () => {
    receive({ userid: 'alice', text: { content: 'hi' } });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('the answer'));
    const send = rec.sends.at(-1);
    assert.equal(send.receiveId, 'alice');
    assert.equal(send.body.msgtype, 'markdown');
    assert.match(send.body.markdown.content, /the answer/);
  });

  it('replies to a group chat via sendMessage(chatid, markdown)', async () => {
    receive({ chatType: 'group', chatId: 'wrkgrp1', text: { content: 'hi' } });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('group answer'));
    assert.equal(rec.sends.at(-1).receiveId, 'wrkgrp1');
  });

  it('throws (sets lastError) when sendMessage returns a non-zero errcode', async () => {
    sendErrcode = 95000;
    receive({ userid: 'bob', text: { content: 'hi' } });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('reply'));
    await tick();
    assert.match(core.getBridgeStatus('wecom').lastError || '', /95000/);
  });
});

describe('wecom testConnection', () => {
  it('ok when the probe authenticates', async () => {
    authMode = 'ok';
    const r = await core.testConnection('wecom', { botId: 'b', secret: 's' });
    assert.equal(r.ok, true);
    assert.equal(rec.disconnected, true, 'probe socket is torn down');
  });

  it('fails when the probe errors', async () => {
    authMode = 'fail';
    const r = await core.testConnection('wecom', { botId: 'b', secret: 'bad' });
    assert.equal(r.ok, false);
    assert.match(r.detail, /bad creds/);
  });
});

describe('wecom AI 卡片流式 (aiCard)', () => {
  function writeTranscript(text) {
    const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }

  it('开 aiCard：ack 开流(finish=false) → finalize 收尾(finish=true)，streamId 全程一致、末帧为 transcript 全文', async () => {
    cfg = { ...cfg, aiCard: true };
    receive({ userid: 'alice', text: { content: 'hi' } });
    await tick();
    const open = (rec.streams || []).find((s) => s.finish === false);
    assert.ok(open, 'ack 应以 replyStream finish=false 开流');
    assert.ok(open.frame?.headers?.req_id, '入站帧 req_id 应透传');
    assert.equal(typeof open.content, 'string');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('the streamed answer'));
    await tick();
    const fin = (rec.streams || []).find((s) => s.finish === true);
    assert.ok(fin, 'finalize 应 replyStream finish=true');
    assert.equal(fin.streamId, open.streamId, 'streamId 全程一致');
    assert.match(fin.content, /the streamed answer/);
    assert.equal(rec.sends.length, 0, '流式路径不应再走 proactive sendMessage');
  });

  it('关 aiCard：不开流(无 replyStream)，回退 proactive sendMessage ack', async () => {
    receive({ userid: 'bob', text: { content: 'hi' } });
    await tick();
    assert.equal((rec.streams || []).length, 0);
    assert.ok(rec.sends.length >= 1, 'proactive ack 走 sendMessage');
  });
});

describe('wecom connection tri-state (mid-life socket drops)', () => {
  it('disconnected → reconnecting; authenticated → connected again', () => {
    assert.equal(core.getBridgeStatus('wecom').connectionState, 'connected');
    rec.client.emit('disconnected', 'net down');
    let st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'reconnecting');
    assert.equal(st.connected, false);
    assert.match(st.lastError || '', /net down/);
    rec.client.emit('authenticated');
    st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.connected, true);
    assert.equal(st.lastError, null, 'recovery must clear the retained disconnect cause');
  });

  it("'reconnecting' emits map to reconnecting", () => {
    rec.client.emit('reconnecting', 1);
    assert.equal(core.getBridgeStatus('wecom').connectionState, 'reconnecting');
  });

  it('terminal error (WSReconnectExhaustedError) → disconnected', () => {
    rec.client.emit('error', Object.assign(new Error('gave up'), { name: 'WSReconnectExhaustedError' }));
    const st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /gave up/);
  });

  it('non-terminal error records lastError without flipping the state', () => {
    rec.client.emit('error', new Error('transient'));
    const st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'connected');
    assert.match(st.lastError, /transient/);
  });

  it('server kick (event.disconnected_event then disconnected) stays terminal', () => {
    rec.client.emit('event.disconnected_event', {});
    rec.client.emit('disconnected', 'closed'); // SDK emits this right after the kick — must not downgrade
    const st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /kicked/);
    // A later successful re-auth (e.g. after re-enable) clears the kicked latch.
    rec.client.emit('authenticated');
    assert.equal(core.getBridgeStatus('wecom').connectionState, 'connected');
  });

  it('emits after stopBridge cannot flip the state', async () => {
    const client = rec.client;
    await core.stopBridge('wecom');
    client.emit('authenticated');
    client.emit('disconnected', 'x');
    const st = core.getBridgeStatus('wecom');
    assert.equal(st.connectionState, 'disconnected');
    assert.equal(st.connected, false);
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
