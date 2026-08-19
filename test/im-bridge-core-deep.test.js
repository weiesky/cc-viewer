// Deeper im-bridge-core coverage: the branches the happy-path suite (im-bridge-core.test.js)
// never reaches — sender resolution (success/neg-cache/error), ack-card finalize/update paths,
// the reply-timeout + idle-poll timers (driven with node:test mock timers), rate-limit wait,
// stop/reload/startAll/stopAll/testConnection-catch, and __resetAllForTests.
import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-imcore-deep-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../packages/app/server/lib/im/im-bridge-core.js');

// A fully-featured fake adapter: optional resolveSender / sendAckCard / updateAckCard so the
// card and sender branches light up. Behaviour is steered per-test via the returned `rec`.
function makeRich(id, opts = {}) {
  const rec = {
    onInbound: null, connected: false, acks: 0, sends: [], cards: [], updates: [], resolves: [],
    sendOneImpl: null, updateImpl: null, ackImpl: null, resolveImpl: null,
  };
  const adapter = {
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: { inboundAck: false, sdkManagesToken: true },
    rateLimit: opts.rateLimit || { max: 1000, windowMs: 60_000 },
    hasCreds: () => true,
    statusFields: () => ({ tag: id }),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; rec.connected = true; return { id }; },
    async disconnect() { rec.connected = false; },
    ack() { rec.acks++; },
    async sendOne(cfg, target, content) {
      rec.sends.push({ target, content });
      if (rec.sendOneImpl) return rec.sendOneImpl(content);
    },
    async testConnection() { return rec.testImpl ? rec.testImpl() : { ok: true }; },
  };
  if (opts.resolveSender) {
    adapter.resolveSender = async (cfg, senderId, ctx) => { rec.resolves.push(senderId); return rec.resolveImpl ? rec.resolveImpl(senderId) : null; };
  }
  if (opts.ackCard) {
    adapter.sendAckCard = async (cfg, target, status, ctx) => { rec.cards.push({ target, status }); return rec.ackImpl ? rec.ackImpl() : { outTrackId: 'ot-' + id }; };
    adapter.updateAckCard = async (cfg, target, handle, text, status, ctx) => { rec.updates.push({ handle, text, status }); return rec.updateImpl ? rec.updateImpl() : true; };
  }
  core.registerAdapter(adapter);
  return rec;
}

const recPlain = makeRich('dpPlain');
const recCard = makeRich('dpCard', { ackCard: true });
const recResolve = makeRich('dpResolve', { resolveSender: true });
const recRate = makeRich('dpRate', { rateLimit: { max: 1, windowMs: 40 } });

const tick = (n = 5) => new Promise((r) => setTimeout(r, n));

let injects, ptyEsc, streaming, ptyKind, ptyRunning, skipPerm, injectOk, cfg;

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
    senderName: over.senderName,
    senderAvatar: over.senderAvatar,
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

function auditFor(id) {
  const p = join(tmpDir, `${id}-audit.log`);
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

before(() => {
  cfg = { enabled: true, appKey: 'x', appSecret: 'y', allowStaffIds: [], maxChunkChars: 3800 };
});

beforeEach(async () => {
  for (const id of ['dpPlain', 'dpCard', 'dpResolve', 'dpRate']) core.__resetForTests(id);
  for (const r of [recPlain, recCard, recResolve, recRate]) { r.onInbound = null; r.sends = []; r.acks = 0; r.cards = []; r.updates = []; r.resolves = []; r.sendOneImpl = null; r.updateImpl = null; r.ackImpl = null; r.resolveImpl = null; r.testImpl = null; }
  injects = []; ptyEsc = 0; streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true;
});

describe('sender resolution (resolveAndPersistSender)', () => {
  it('calls resolveSender to fill a missing name and positive-caches the sender', async () => {
    recResolve.resolveImpl = () => ({ name: 'Resolved Name', avatar: 'http://a/x.png' });
    await core.startBridge('dpResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'r1', content: 'hi', senderId: 'sUser' }); // no senderName → resolveSender invoked
    await tick();
    assert.deepEqual(recResolve.resolves, ['sUser'], 'resolveSender called once for the missing-name sender');
    // a second inbound from the same sender within TTL must NOT call resolveSender again (positive cache)
    await inbound(recResolve, { msgId: 'r2', content: 'hi2', senderId: 'sUser' });
    await tick();
    assert.deepEqual(recResolve.resolves, ['sUser'], 'positive cache suppresses a second resolve');
  });

  it('negative-caches when resolveSender returns nothing (no name, no avatar)', async () => {
    recResolve.resolveImpl = () => null;
    await core.startBridge('dpResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'n1', content: 'hi', senderId: 'ghost' });
    await tick();
    assert.deepEqual(recResolve.resolves, ['ghost']);
    // negative cache (10min TTL) → no immediate re-resolve
    await inbound(recResolve, { msgId: 'n2', content: 'hi', senderId: 'ghost' });
    await tick();
    assert.deepEqual(recResolve.resolves, ['ghost'], 'negative cache suppresses immediate retry');
  });

  it('swallows a throwing resolveSender and records resolve-sender-error in the audit log', async () => {
    recResolve.resolveImpl = () => { throw new Error('contact api down'); };
    await core.startBridge('dpResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'e1', content: 'hi', senderId: 'boom' });
    await tick();
    assert.match(auditFor('dpResolve'), /resolve-sender-error/);
    // injection still happened despite the resolve failure (resolution is best-effort, non-blocking)
    assert.equal(injects.length, 1);
  });

  it('skips resolveSender entirely when the inbound already carries name + avatar', async () => {
    await core.startBridge('dpResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'f1', content: 'hi', senderId: 'full', senderName: 'Has Name', senderAvatar: 'http://a' });
    await tick();
    assert.deepEqual(recResolve.resolves, [], 'no contact-API call when fields are already present');
  });
});

describe('ack card finalize + update paths', () => {
  it('updateAckCard receives the reply text on turn_end (single chunk → card update, no sendOne)', async () => {
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'c1', content: 'go' });
    await tick();
    assert.equal(recCard.cards.length, 1, 'ack card created on inject');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('the reply'));
    await tick();
    assert.equal(recCard.updates.length, 1, 'card updated in place');
    assert.match(recCard.updates[0].text, /the reply/);
    assert.equal(recCard.updates[0].status, 'done');
    assert.ok(!recCard.sends.some((s) => /the reply/.test(s.content)), 'no fallback sendOne when the card update succeeds');
  });

  it('multi-chunk reply: card update carries chunk 1, remaining chunks go via sendOne', async () => {
    cfg = { ...cfg, maxChunkChars: 200 };
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'm1', content: 'go' });
    await tick();
    const longText = Array.from({ length: 3 }, (_, i) => `chunk${i} ` + 'z'.repeat(180)).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(longText));
    await tick();
    assert.equal(recCard.updates.length, 1);
    assert.ok(recCard.sends.length >= 1, 'overflow chunks sent via sendOne after the card update');
    cfg = { ...cfg, maxChunkChars: 3800 };
  });

  it('falls back to sendReply when updateAckCard returns false', async () => {
    recCard.updateImpl = () => false;
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'u1', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('fallback reply'));
    await tick();
    assert.ok(recCard.sends.some((s) => /fallback reply/.test(s.content)), 'reply re-sent via sendOne when card update fails');
  });

  it('catches a throwing updateAckCard and still delivers the reply via sendReply', async () => {
    recCard.updateImpl = () => { throw new Error('card put 500'); };
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 't1', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('still delivered'));
    await tick();
    assert.match(auditFor('dpCard'), /card-update-error/);
    assert.ok(recCard.sends.some((s) => /still delivered/.test(s.content)));
  });

  it('ackCard:false config skips the card path (injects, no card created, no ack send)', async () => {
    cfg = { ...cfg, ackCard: false };
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'p1', content: 'go' });
    await tick();
    assert.equal(recCard.cards.length, 0, 'no card when ackCard:false');
    assert.equal(injects.length, 1, 'prompt still injected');
    // The reply still routes via sendReply on turn_end (no ack card to update).
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('reply text'));
    await tick();
    assert.ok(recCard.sends.some((s) => /reply text/.test(s.content)), 'turn_end reply sent via sendOne (no card)');
    cfg = { ...cfg, ackCard: undefined };
  });

  it('ackCard:false + skip-perm warns via sendReply (skip-perm-warning audit)', async () => {
    cfg = { ...cfg, ackCard: false };
    skipPerm = true;
    delete process.env.CCV_IM_PLATFORM;
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 's1', content: 'go' });
    await tick();
    assert.match(auditFor('dpCard'), /skip-perm-warning/);
    cfg = { ...cfg, ackCard: undefined };
  });
});

describe('rate-limit gate wait branch', () => {
  it('blocks the reply send within the window, then proceeds after the window elapses', async () => {
    await core.startBridge('dpRate', deps(() => cfg));
    await inbound(recRate, { msgId: 'rl', content: 'go' });
    await tick();
    // rateLimit max=1/40ms. inbound already fired the ackProcessing send ("thinking…"), which
    // consumed the single slot. The reply text below is "a\n\nbbbbbbbbbb" (13 chars ≤ maxChunkChars
    // 3800) → chunkText returns ONE chunk. So this is *ack + single-chunk reply contend for one slot*
    // (NOT a multi-chunk reply): the reply's rateLimitGate must await a full window before it can send.
    assert.equal(recRate.sends.length, 1, 'only the ackProcessing send landed before turn_end');
    const t0 = Date.now();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('a' + '\n\n' + 'b'.repeat(10)));
    const elapsed = Date.now() - t0;
    // Regression guard: if rateLimitGate's `await setTimeout(wait)` (im-bridge-core.js wait branch) is
    // deleted (i.e. the gate stops blocking), elapsed collapses to ~0 and this fails. windowMs is 40ms;
    // allow margin for timer slack but require most of a window to have elapsed.
    assert.ok(elapsed >= 35, `reply send must wait ~one window; elapsed=${elapsed}ms`);
    // Both sends landed (ack first, then the gated reply), in order — the reply was blocked, not dropped.
    assert.equal(recRate.sends.length, 2, 'ack + reply both delivered, reply not dropped');
    assert.match(recRate.sends[1].content, /^a\n\nb+$/, 'the gated 2nd send is the reply text');
  });
});

// These exercise armActiveInjection's reply-timeout (PENDING_TIMEOUT_MS) and idle-poll
// (IDLE_POLL_INTERVAL_MS × THRESHOLD) timers. Both are wall-clock minutes, so we drive them
// with node:test mock timers. After enabling mock timers, NEVER call a real setTimeout (it is
// mocked and would never fire) — drain promise chains with the microtask helper instead.
const drain = async (n = 12) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe('reply-timeout + idle-poll timers (mock timers)', () => {
  it('fires a reply-timeout that finalizes the ack card and replies, then drains', async (t) => {
    await core.startBridge('dpCard', deps(() => cfg));
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    inbound(recCard, { msgId: 'to1', content: 'go' });   // sync up to the writeToPtySequential cb
    await drain();                                         // settle the ack-card promise chain
    t.mock.timers.tick(10 * 60_000 + 100);                // jump past PENDING_TIMEOUT_MS (10min, non-worker)
    await drain(30);                                       // let the timeout handler's awaits resolve
    assert.match(auditFor('dpCard'), /reply-timeout/);
    // The card was finalized with the ackTimeout status (error), or a fallback reply went out.
    assert.ok(recCard.updates.some((u) => u.status === 'error') || recCard.sends.some((s) => /timeout|超时/i.test(s.content)));
  });

  it('idle-poll synthesises a turn_end after streaming starts then goes quiet', async (t) => {
    // streaming=false at inbound time so the prompt actually injects and arms the idle poll.
    streaming = false;
    await core.startBridge('dpCard', deps(() => cfg));
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    inbound(recCard, { msgId: 'id1', content: 'go' });   // injects + arms idle poll
    await drain();
    streaming = true;                 // the turn is now streaming
    t.mock.timers.tick(5_000);        // poll 1: sees streaming → sawStreaming=true, idle count 0
    streaming = false;                // turn went quiet
    t.mock.timers.tick(5_000);        // poll 2: idle count 1
    t.mock.timers.tick(5_000);        // poll 3: idle count 2
    t.mock.timers.tick(5_000);        // poll 4: idle count 3 == THRESHOLD → synthetic notifyTurnEnd
    await drain(30);
    assert.match(auditFor('dpCard'), /idle-turn-end/);
  });
});

describe('lifecycle: stop / reload / startAll / stopAll', () => {
  it('stopBridge finalizes the in-flight ack card with a noSession status', async () => {
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'st1', content: 'go' });
    await tick();
    await core.stopBridge('dpCard');
    assert.equal(core.isBridgeRunning('dpCard'), false);
    assert.ok(recCard.updates.some((u) => u.status === 'error'), 'ack card finalized on stop');
  });

  it('reloadBridge stops then restarts a platform (idempotent)', async () => {
    await core.startBridge('dpPlain', deps(() => cfg));
    assert.equal(core.isBridgeRunning('dpPlain'), true);
    await core.reloadBridge('dpPlain', deps(() => cfg));
    assert.equal(core.isBridgeRunning('dpPlain'), true, 'still running after reload');
  });

  it('testConnection catches a throwing adapter and returns ok:false', async () => {
    recPlain.testImpl = () => { throw new Error('cannot reach'); };
    await core.startBridge('dpPlain', deps(() => cfg));
    const r = await core.testConnection('dpPlain', cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /cannot reach/);
  });

  it('testConnection returns a not-found shape for an unknown platform', async () => {
    const r = await core.testConnection('no-such-platform', cfg);
    assert.equal(r.ok, false);
    assert.match(r.detail, /unknown/);
  });

  it('startAll / stopAll fan out across registered platforms', async () => {
    await core.startAll((id) => deps(() => cfg));
    assert.equal(core.isBridgeRunning('dpPlain'), true);
    assert.equal(core.isBridgeRunning('dpCard'), true);
    await core.stopAll();
    assert.equal(core.isBridgeRunning('dpPlain'), false);
    assert.equal(core.isBridgeRunning('dpCard'), false);
  });
});

describe('__resetAllForTests + isRealUserPrompt edge', () => {
  it('extractLastAssistantText treats a tool_result-only user line as a continuation (does not break the turn)', () => {
    const p = join(tmpDir, 'cont-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'real question' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'part one' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), // continuation, not a boundary
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'part two' }] } }),
      // a user line whose content is neither string nor array → isRealUserPrompt returns false
      // (the final `return false` fall-through), so it is NOT treated as a turn boundary.
      JSON.stringify({ type: 'user', message: { content: null } }),
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /part one/);
    assert.match(out, /part two/);
  });

  it('card-update path truncates when the reply exceeds MAX_CHUNKS_PER_TURN (5) chunks', async () => {
    cfg = { ...cfg, maxChunkChars: 120 };
    await core.startBridge('dpCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'big1', content: 'go' });
    await tick();
    // 8 paragraphs each just over the 120-char cap → 8 chunks → capped to 5 with a truncation marker
    const huge = Array.from({ length: 8 }, (_, i) => `para${i} ` + 'w'.repeat(115)).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(huge));
    await tick();
    assert.equal(recCard.updates.length, 1, 'first chunk delivered via the card update');
    // chunk 1 (the card) + 4 overflow sends = 5 total chunks, last one truncated
    assert.equal(recCard.sends.length, 4, 'remaining 4 of the 5 capped chunks sent via sendOne');
    assert.match(recCard.sends.at(-1).content, /截断|truncated/i, 'the 5th (last) chunk carries the truncation marker');
    cfg = { ...cfg, maxChunkChars: 3800 };
  });

  it('__resetAllForTests clears every platform', async () => {
    await core.startBridge('dpPlain', deps(() => cfg));
    await core.startBridge('dpCard', deps(() => cfg));
    core.__resetAllForTests();
    assert.equal(core.isBridgeRunning('dpPlain'), false);
    assert.equal(core.isBridgeRunning('dpCard'), false);
  });
});

after(() => {
  for (const id of ['dpPlain', 'dpCard', 'dpResolve', 'dpRate']) core.__resetForTests(id);
  rmSync(tmpDir, { recursive: true, force: true });
});
