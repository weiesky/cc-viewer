import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The core writes per-platform audit logs into LOG_DIR; redirect it before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-imcore-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../server/lib/im/im-bridge-core.js');

// Two fake adapters reuse the server.dingtalk.* i18n namespace so tr() resolves without new keys.
function makeFake(id) {
  const rec = { onInbound: null, connected: false, acks: 0, sends: [] };
  const adapter = {
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: { inboundAck: false, sdkManagesToken: true },
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: () => true,
    statusFields: () => ({}),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; rec.connected = true; return { id }; },
    async disconnect() { rec.connected = false; },
    ack() { rec.acks++; },
    async sendOne(cfg, target, content) { rec.sends.push({ target, content }); },
    async testConnection() { return { ok: true }; },
  };
  core.registerAdapter(adapter);
  return rec;
}

const recA = makeFake('imA');
const recB = makeFake('imB');

// marker now carries the sender id: ⟦im:<id>:<senderId>⟧ (fixtures default senderId to 'u1').
const MARK = (id, s) => `⟦im:${id}:u1⟧` + s;
const tick = () => new Promise((r) => setTimeout(r, 5));

// Shared PTY harness — one PTY for both platforms (the whole point of the single-flight).
let injects, ptyEsc, streaming, ptyKind, ptyRunning, skipPerm, injectOk, cfgA, cfgB;

function deps(getConfig) {
  return {
    writeToPty: (d) => { if (d === '\x1b') ptyEsc++; },
    writeToPtySequential: (chunks, cb) => { injects.push(chunks[0]); if (cb) cb(injectOk); },
    getPtyState: () => ({ running: ptyRunning, exitCode: null }),
    getPtyKind: () => ptyKind,
    getPtySkipPermissions: () => skipPerm,
    isStreaming: () => streaming,
    getConfig,
  };
}

function inbound(rec, over = {}) {
  const conversationId = over.conversationId ?? 'c1';
  const senderId = over.senderId ?? 'u1';
  return rec.onInbound({
    text: over.content ?? 'hi',
    conversationId,
    isGroup: false,
    senderId,
    msgId: over.msgId ?? 'm' + Math.random(),
    target: { conversationId, senderId },
  }, null);
}

function writeTranscript(text) {
  const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'user', message: { content: 'q' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
  ].join('\n'));
  return p;
}

before(async () => {
  cfgA = { enabled: true, appKey: 'a', appSecret: 'a', allowStaffIds: [], maxChunkChars: 3800 };
  cfgB = { enabled: true, appKey: 'b', appSecret: 'b', allowStaffIds: [], maxChunkChars: 3800 };
});

beforeEach(async () => {
  core.__resetForTests('imA');
  core.__resetForTests('imB');
  recA.onInbound = null; recA.sends = []; recA.acks = 0;
  recB.onInbound = null; recB.sends = []; recB.acks = 0;
  injects = []; ptyEsc = 0;
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true;
  await core.startBridge('imA', deps(() => cfgA));
  await core.startBridge('imB', deps(() => cfgB));
});

describe('generic orchestration through a non-DingTalk adapter', () => {
  it('acks, marks origin with the adapter id, and injects via bracketed paste', async () => {
    await inbound(recA, { msgId: 'm1', content: 'hello' });
    assert.equal(recA.acks, 1);
    assert.equal(injects[0], '\x1b[200~' + MARK('imA', 'hello') + '\x1b[201~');
  });

  it('dedups a redelivered msgId', async () => {
    await inbound(recA, { msgId: 'dup', content: 'x' });
    await inbound(recA, { msgId: 'dup', content: 'x' });
    assert.equal(injects.length, 1);
  });

  it('allowlist blocks a non-listed sender (per-adapter allowListField)', async () => {
    cfgA = { ...cfgA, allowStaffIds: ['u1'] };
    await inbound(recA, { msgId: 'm1', senderId: 'intruder', content: 'x' });
    assert.equal(injects.length, 0);
    await inbound(recA, { msgId: 'm2', senderId: 'u1', content: 'ok' });
    assert.equal(injects[0], '\x1b[200~' + MARK('imA', 'ok') + '\x1b[201~');
  });

  it('sanitizes inbound text: strips paste-frame terminators, control bytes, and CR before injection', async () => {
    // A crafted message trying to break out of the bracketed-paste frame and smuggle a submit (CR).
    await inbound(recA, { msgId: 's1', content: 'a\x1b[201~b\x07c\rd' });
    // \x1b[201~ (paste terminator), \x07 (control), \r (submit key) all removed → 'abcd', safely framed.
    assert.equal(injects[0], '\x1b[200~' + MARK('imA', 'abcd') + '\x1b[201~');
  });

  it('caps a reply at MAX_CHUNKS_PER_TURN (5) and appends a truncation marker', async () => {
    cfgA = { ...cfgA, maxChunkChars: 500 };           // late-bound via deps(() => cfgA); no re-prime needed
    await inbound(recA, { msgId: 'c1', content: 'go' }); // arm the slot (A owns it)
    await tick(); // let the ack card promise settle (ackProcessing text send)
    const ackSends = recA.sends.length;
    // Six ~300-char paragraphs → six chunks (two won't fit in 500) → capped to five.
    const sixParas = Array.from({ length: 6 }, (_, i) => `P${i}`.padEnd(300, 'x')).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(sixParas));
    const replySends = recA.sends.slice(ackSends);
    assert.equal(replySends.length, 5, 'six chunks capped to five');
    assert.match(replySends.at(-1).content, /截断|truncated/i, 'last chunk carries a truncation marker');
  });
});

describe('IM worker skip-permissions handling', () => {
  it('non-worker: blockOnSkipPermissions blocks injection (legacy behavior preserved)', async () => {
    skipPerm = true;
    cfgA = { ...cfgA, blockOnSkipPermissions: true };
    delete process.env.CCV_IM_PLATFORM;
    await inbound(recA, { msgId: 'blk1', content: 'x' });
    assert.equal(injects.length, 0, 'blocked when not a worker');
    assert.ok(recA.sends.length > 0, 'sender told it was blocked');
  });

  it('worker (CCV_IM_PLATFORM set): ignores blockOnSkipPermissions, injects, no per-message warning', async () => {
    skipPerm = true;
    cfgA = { ...cfgA, blockOnSkipPermissions: true };
    process.env.CCV_IM_PLATFORM = 'imA';
    try {
      await inbound(recA, { msgId: 'wrk1', content: 'go' });
      await tick(); // let ack card promise settle
      assert.equal(injects.length, 1, 'worker injects despite blockOnSkipPermissions');
      assert.equal(injects[0], '\x1b[200~' + MARK('imA', 'go') + '\x1b[201~');
      // The ack card path fires (ackProcessing text); but no skip-perm warning.
      assert.ok(!recA.sends.some((s) => /skip|权限/.test(s.content)), 'no per-message skip-perm warning in worker mode');
    } finally {
      delete process.env.CCV_IM_PLATFORM;
    }
  });
});

describe('cross-adapter single-flight', () => {
  it('only one adapter injects at a time; the other is deferred, not dropped, then drains', async () => {
    await inbound(recA, { msgId: 'a1', content: 'a-first' }); // A injects, owns the slot
    assert.equal(injects.length, 1);
    await inbound(recB, { msgId: 'b1', content: 'b-first' }); // B must NOT inject while A holds the slot
    assert.equal(injects.length, 1, 'B is blocked by the shared single-flight');
    assert.ok(recB.sends.some((s) => /busy|正在忙/i.test(s.content)), 'B sender told it is queued');

    // A's turn ends → reply routes to A, slot releases, B drains
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('A reply'));
    assert.equal(injects.length, 2, 'B injects after A releases the slot');
    assert.equal(injects[1], '\x1b[200~' + MARK('imB', 'b-first') + '\x1b[201~');
    assert.match(recA.sends.at(-1).content, /A reply/);
  });

  it('notifyTurnEnd routes ONLY to the owning adapter', async () => {
    await inbound(recA, { msgId: 'a1', content: 'x' });
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('owned by A'));
    assert.ok(recA.sends.some((s) => /owned by A/.test(s.content)));
    assert.ok(!recB.sends.some((s) => /owned by A/.test(s.content)), 'B must never receive A\'s reply');
  });

  it('a /stop from the OTHER platform releases the slot globally (ESC + unwedge)', async () => {
    await inbound(recA, { msgId: 'a1', content: 'long task' }); // A owns the slot
    await inbound(recB, { msgId: 'b1', content: '/stop' });       // B interrupts the shared PTY
    assert.equal(ptyEsc, 1, 'ESC sent to the shared PTY');
    // slot released → a new prompt from A can inject again
    await inbound(recA, { msgId: 'a2', content: 'again' });
    assert.equal(injects.at(-1), '\x1b[200~' + MARK('imA', 'again') + '\x1b[201~');
  });

  it('a failed injection releases the slot globally so the other platform proceeds', async () => {
    injectOk = false;
    await inbound(recA, { msgId: 'a1', content: 'will fail' });
    await tick();
    assert.ok(recA.sends.some((s) => /注入失败|Injection failed/.test(s.content)));
    injectOk = true;
    await inbound(recB, { msgId: 'b1', content: 'b ok' }); // slot is free → B injects
    assert.equal(injects.at(-1), '\x1b[200~' + MARK('imB', 'b ok') + '\x1b[201~');
  });

  it('drops a turn_end whose ts predates the injection (slot kept, no cross-turn leak)', async () => {
    const before = Date.now();
    await inbound(recA, { msgId: 'a1', content: 'x' }); // arms at since ≈ now (≥ before)
    await inbound(recB, { msgId: 'b1', content: 'queued' }); // blocked
    await core.notifyTurnEnd('s', before - 1000, writeTranscript('stale')); // ts < since → ignored
    assert.equal(injects.length, 1, 'stale turn_end must not release the slot');
    assert.ok(!recA.sends.some((s) => /stale/.test(s.content)), 'stale text must not be sent');
    // a real turn_end (ts ≥ since) then releases and B drains
    await core.notifyTurnEnd('s', Date.now() + 10, writeTranscript('real'));
    assert.equal(injects.length, 2);
  });

  it('is idempotent when a turn_end is delivered twice for one injection', async () => {
    await inbound(recA, { msgId: 'a1', content: 'x' });
    const ts = Date.now();
    const tp = writeTranscript('once');
    await core.notifyTurnEnd('s', ts, tp);
    await core.notifyTurnEnd('s', ts, tp); // doubled delivery of the same turn
    assert.equal(recA.sends.filter((s) => /once/.test(s.content)).length, 1, 'doubled turn_end must not resend');
  });
});

describe('status + lifecycle', () => {
  it('reports running per platform and stop releases an owned slot', async () => {
    assert.equal(core.isBridgeRunning('imA'), true);
    assert.equal(core.isBridgeRunning('imB'), true);
    await inbound(recA, { msgId: 'a1', content: 'x' }); // A owns the slot
    assert.equal(injects.length, 1);
    await core.stopBridge('imA'); // A (the owner) stops → owned slot must release
    assert.equal(core.isBridgeRunning('imA'), false);
    // B is still running; its next prompt injects (slot was freed by A's stop)
    await inbound(recB, { msgId: 'b1', content: 'go' });
    assert.equal(injects.at(-1), '\x1b[200~' + MARK('imB', 'go') + '\x1b[201~');
  });

  it('getBridgeStatus is null-safe for an unknown platform', () => {
    const s = core.getBridgeStatus('nope');
    assert.equal(s.running, false);
    assert.equal(s.boundConversationId, null);
  });

  it('isolates a failing adapter connect (running=false + lastError); others keep running', async () => {
    core.registerAdapter({
      id: 'imThrow', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds',
      capabilities: {}, rateLimit: { max: 1000, windowMs: 60_000 },
      hasCreds: () => true, statusFields: () => ({}),
      async connect() { throw new Error('boom'); },
      async disconnect() {}, ack() {}, async sendOne() {}, async testConnection() { return { ok: false }; },
    });
    await core.startBridge('imThrow', deps(() => ({ enabled: true, appKey: 'x', appSecret: 'y', allowStaffIds: [], maxChunkChars: 3800 })));
    assert.equal(core.isBridgeRunning('imThrow'), false);
    assert.match(core.getBridgeStatus('imThrow').lastError || '', /boom/);
    assert.equal(core.isBridgeRunning('imA'), true, 'a sibling adapter is unaffected');
    core.__resetForTests('imThrow');
  });
});

// ─── 逐字流式（钉钉 AI 卡片）：streamTimer 贯穿 slot 生命周期 + 注入轮次重置 + finalize 权威全文 ───
function makeStreamFake(id) {
  const rec = { onInbound: null, pushes: [], finals: [], handle: { outTrackId: 'ot-' + id, streaming: true } };
  const adapter = {
    id, i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds',
    capabilities: {}, rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: () => true, statusFields: () => ({}),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; return { id }; },
    async disconnect() {}, ack() {}, async sendOne() {}, async testConnection() { return { ok: true }; },
    async sendAckCard() { return rec.handle; },
    async streamCardText(cfg, target, handle, fullText) {
      rec.inFlight = (rec.inFlight || 0) + 1;
      rec.maxInFlight = Math.max(rec.maxInFlight || 0, rec.inFlight);
      if (rec.gate) await rec.gate;          // 单测可经 rec.gate 阻塞一帧，制造 await 期间的并发探测
      rec.pushes.push(fullText);
      rec.inFlight--;
      return true;
    },
    async updateAckCard(cfg, target, handle, content, status) { rec.finals.push({ content, status }); return true; },
  };
  core.registerAdapter(adapter);
  return rec;
}
const recS = makeStreamFake('imS');
const waitTicks = () => new Promise((r) => setTimeout(r, 45)); // 多个 8ms tick

describe('DingTalk AI-card streaming (streamTimer)', () => {
  let liveText, resetCount, sCfg, streamingS;
  function sDeps() {
    return {
      writeToPty: () => {},
      writeToPtySequential: (chunks, cb) => { if (cb) cb(true); },
      getPtyState: () => ({ running: true, exitCode: null }),
      getPtyKind: () => 'claude',
      getPtySkipPermissions: () => false,
      isStreaming: () => streamingS,
      getConfig: () => sCfg,
      getLiveText: () => liveText,
      resetLiveText: () => { resetCount++; liveText = ''; },
    };
  }
  const inS = (over = {}) => recS.onInbound({
    text: over.content ?? 'hi', conversationId: 'c1', senderId: 'u1',
    msgId: over.msgId ?? 'm' + Math.random(), target: { conversationId: 'c1', senderId: 'u1' },
  }, null);

  beforeEach(async () => {
    core.__resetForTests('imS');
    recS.onInbound = null; recS.pushes = []; recS.finals = [];
    recS.gate = null; recS.inFlight = 0; recS.maxInFlight = 0;
    liveText = ''; resetCount = 0; streamingS = false; // 注入时不在 streaming → drainQueue 才会 arm
    sCfg = { enabled: true, appKey: 's', appSecret: 's', allowStaffIds: [], maxChunkChars: 3800, ackCard: true, aiCardTemplateId: 'ai1' };
    core.__setStreamTickMsForTests(8);
    await core.startBridge('imS', sDeps());
  });
  after(() => core.__setStreamTickMsForTests(undefined));

  it('resets live text at arm, then pushes only once growth ≥ threshold', async () => {
    await inS({ msgId: 's1' });
    assert.equal(resetCount, 1, 'live text reset at injection arm (per-turn, not per-API-call)');
    liveText = 'x'.repeat(5); await waitTicks();
    assert.equal(recS.pushes.length, 0, 'no push below the 20-char threshold');
    liveText = 'y'.repeat(40); await waitTicks();
    assert.ok(recS.pushes.length >= 1, 'pushes after growth ≥ threshold');
    assert.equal(recS.pushes.at(-1), 'y'.repeat(40), 'pushes the full accumulated text (isFull)');
  });

  it('keeps pushing while isStreaming() is false (survives tool-gap flicker)', async () => {
    await inS({ msgId: 's2' });
    liveText = 'a'.repeat(40); await waitTicks();
    const n1 = recS.pushes.length;
    assert.ok(n1 >= 1);
    // isStreaming stays false (the tool gap) — the slot-lifetime timer must keep pushing as text grows.
    liveText = 'a'.repeat(40) + '\n\n' + 'b'.repeat(40); await waitTicks();
    assert.ok(recS.pushes.length > n1, 'still pushes across the isStreaming() false window');
  });

  it('finalizes with the authoritative transcript text (not live text) and stops the timer', async () => {
    await inS({ msgId: 's3' });
    liveText = 'partial '.repeat(5); await waitTicks();
    assert.ok(recS.pushes.length >= 1);
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('FINAL authoritative answer'));
    assert.equal(recS.finals.length, 1);
    assert.equal(recS.finals[0].content, 'FINAL authoritative answer');
    assert.equal(recS.finals[0].status, 'done');
    const afterFinal = recS.pushes.length;
    liveText = 'z'.repeat(200); await waitTicks();
    assert.equal(recS.pushes.length, afterFinal, 'no mid-stream push after finalize releases the slot');
  });

  it('stops pushing after a /stop releases the slot', async () => {
    await inS({ msgId: 's4', content: 'task' });
    liveText = 'q'.repeat(40); await waitTicks();
    const afterFirst = recS.pushes.length;
    await inS({ msgId: 's5', content: '/stop' });
    liveText = 'q'.repeat(40) + 'w'.repeat(200); await waitTicks();
    assert.equal(recS.pushes.length, afterFirst, 'no push after /stop clears the streamTimer');
  });

  it('caps mid-stream pushes at STREAM_MAX_FRAMES (billing guard)', async () => {
    await inS({ msgId: 's6' });
    let s = '';
    for (let i = 0; i < 30; i++) { s += 'x'.repeat(25); liveText = s; await new Promise((r) => setTimeout(r, 12)); }
    await waitTicks();
    // 30 次足量增长若无上限会推 30 帧；硬上限 25 必须挡住（≤25 才算未回归）。
    assert.ok(recS.pushes.length <= 25, `mid-stream pushes capped at 25, got ${recS.pushes.length}`);
    assert.ok(recS.pushes.length >= 10, 'streaming actually drove many frames (approached the cap)');
  });

  it('finalize truncates transcript beyond STREAM_MAX_CHARS', async () => {
    await inS({ msgId: 's7' });
    liveText = 'partial'; await waitTicks();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('y'.repeat(25_000)));
    assert.equal(recS.finals.length, 1);
    const c = recS.finals[0].content;
    assert.ok(c.length <= 20_000 + 60, `finalize content truncated to ~20000, got ${c.length}`);
    assert.match(c, /截断|truncated/i, 'truncation marker appended');
  });

  it('single in-flight guard: never more than one push concurrently', async () => {
    let release; recS.gate = new Promise((r) => { release = r; });
    await inS({ msgId: 's8' });
    liveText = 'a'.repeat(40); // 超阈值一次；之后保持不变 → 仅首帧合格，凸显 await 期间的并发探测
    await new Promise((r) => setTimeout(r, 40)); // 多个 tick 在首帧 gated 期间触发，必须被 _streamInFlight 挡住
    release(); recS.gate = null;
    await waitTicks();
    assert.equal(recS.maxInFlight, 1, 'in-flight guard prevents overlapping /card/streaming PUTs');
    assert.equal(recS.pushes.length, 1, 'text constant after first push → exactly one frame');
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
