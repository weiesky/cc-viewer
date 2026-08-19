import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Bridge writes an audit log into LOG_DIR; redirect it before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-dtbridge-test-'));
process.env.CCV_LOG_DIR = tmpDir;

// server/i18n.js is the same module instance the bridge's t() reads from, so setLang here
// mutates the very currentLang the bridge renders against.
const { setLang, getLang } = await import('../packages/app/server/i18n.js');

const bridge = await import('../packages/app/server/lib/dingtalk-bridge.js');
const {
  __setClientFactory, __setFetchForTests, __resetForTests, __setMaxQueueForTests,
  startBridge, notifyTurnEnd, isBridgeRunning, getBridgeStatus,
  extractLastAssistantText, chunkText, testConnection,
} = bridge;

const { default: dingtalkAdapter } = await import('../packages/app/server/lib/adapters/dingtalk-adapter.js');

const PASTE = (s) => ['\x1b[200~' + s + '\x1b[201~', '\r'];
// The bridge prepends an IM-origin marker to every injected prompt EXCEPT slash commands.
// Marker now carries the sender id (fixtures default senderStaffId → senderId 'u1').
const MARK = (s) => '⟦im:dingtalk:u1⟧' + s;
const tick = () => new Promise((r) => setTimeout(r, 5));

// shared mutable harness
let rec, calls, fetches, cfg, streaming, ptyKind, ptyRunning, skipPerm, injectOk;

function makeDeps() {
  return {
    writeToPty: (d) => calls.writeToPty.push(d),
    writeToPtySequential: (chunks, cb, opts) => { calls.writeSeq.push(chunks); calls.writeSeqOpts.push(opts || null); if (cb) cb(injectOk); },
    getPtyState: () => ({ running: ptyRunning, exitCode: null }),
    getPtyKind: () => ptyKind,
    getPtySkipPermissions: () => skipPerm,
    isStreaming: () => streaming,
    getConfig: () => cfg,
  };
}

function inbound(over = {}) {
  const data = JSON.stringify({
    text: { content: over.content ?? 'hello' },
    conversationId: over.conversationId ?? 'c1',
    conversationType: over.conversationType ?? '1',
    senderStaffId: over.senderStaffId ?? 'u1',
    robotCode: over.robotCode ?? 'r1',
  });
  return rec.handler({ headers: { messageId: over.msgId ?? 'm' + Math.random() }, data });
}

before(() => {
  __setClientFactory((opts) => {
    rec.opts = opts;
    return {
      registerCallbackListener(_topic, handler) { rec.handler = handler; return this; },
      connect() { rec.connected = true; },
      disconnect() { rec.connected = false; },
      socketCallBackResponse(id, payload) { rec.acks.push({ id, payload }); },
    };
  });
  __setFetchForTests(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    fetches.push({ url, body });
    if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
    return { ok: true, json: async () => ({}) };
  });
});

beforeEach(async () => {
  __resetForTests();
  rec = { acks: [], connected: false, handler: null };
  calls = { writeToPty: [], writeSeq: [], writeSeqOpts: [] };
  fetches = [];
  cfg = { enabled: true, appKey: 'ak123456', appSecret: 'sec', allowStaffIds: [], maxChunkChars: 3800 };
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true;
  await startBridge(makeDeps());
});

describe('lifecycle', () => {
  it('connects when enabled with creds', () => {
    assert.equal(isBridgeRunning(), true);
    assert.equal(rec.connected, true);
    assert.equal(typeof rec.handler, 'function');
    assert.equal(getBridgeStatus().appKeyTail, '3456');
  });

  it('is a no-op when disabled', async () => {
    __resetForTests();
    cfg = { ...cfg, enabled: false };
    rec = { acks: [], connected: false, handler: null };
    await startBridge(makeDeps());
    assert.equal(isBridgeRunning(), false);
    assert.equal(rec.connected, false);
  });
});

describe('inbound', () => {
  it('acks BEFORE injecting, then injects via bracketed paste with settle delay', async () => {
    await inbound({ msgId: 'm1', content: 'hello' });
    assert.equal(rec.acks[0].id, 'm1');
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('hello')));
    assert.equal(calls.writeSeqOpts[0]?.settleMs, 250);
  });

  it('sanitizes a paste-breakout payload before injecting', async () => {
    // crafted \x1b[201~ would close the paste frame; it must be stripped
    await inbound({ msgId: 'm1', content: 'hello\x1b[201~rm -rf /' });
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('hellorm -rf /')));
  });

  it('/stop clears the in-flight reply so the queue is not wedged', async () => {
    await inbound({ msgId: 'm1', content: 'first' });   // injected, turn in flight
    await inbound({ msgId: 'm2', content: '/stop' });    // ESC + clears pending
    assert.ok(calls.writeToPty.includes('\x1b'));
    await inbound({ msgId: 'm3', content: 'third' });    // should inject again now
    assert.equal(calls.writeSeq.length, 2);
    assert.deepEqual(calls.writeSeq[1], PASTE(MARK('third')));
  });

  it('/stop sends ESC, never a process kill, and injects nothing', async () => {
    await inbound({ msgId: 'm1', content: '/stop' });
    assert.deepEqual(calls.writeToPty, ['\x1b']);
    assert.equal(calls.writeSeq.length, 0);
  });

  it('dedups redelivered messageId (no double injection)', async () => {
    await inbound({ msgId: 'dup', content: 'hello' });
    await inbound({ msgId: 'dup', content: 'hello' });
    assert.equal(calls.writeSeq.length, 1);
  });

  it('queues while a turn is in flight (does not interleave)', async () => {
    await inbound({ msgId: 'm1', content: 'first' });   // injected, turn in flight
    await inbound({ msgId: 'm2', content: 'second' });  // should queue, not inject
    assert.equal(calls.writeSeq.length, 1);
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('first')));
  });

  it('rejects when no Claude session (and never auto-spawns)', async () => {
    ptyRunning = false;
    await inbound({ msgId: 'm1', content: 'hello' });
    assert.equal(calls.writeSeq.length, 0);
    assert.equal(calls.writeToPty.length, 0);
    await tick();
    assert.ok(fetches.some((f) => f.url.includes('/robot/')), 'should reply no-session');
  });

  it('rejects a bare shell PTY (kind !== claude)', async () => {
    ptyKind = 'shell';
    await inbound({ msgId: 'm1', content: 'hello' });
    assert.equal(calls.writeSeq.length, 0);
  });

  it('prepends the IM-origin marker to a normal prompt', async () => {
    await inbound({ msgId: 'm1', content: 'look at this' });
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('look at this')));
  });

  it('does NOT mark a slash command (a marker prefix would break CLI command parsing)', async () => {
    await inbound({ msgId: 'm1', content: '/clear' });
    assert.deepEqual(calls.writeSeq[0], PASTE('/clear')); // no marker
  });

  it('does NOT mark a slash command sent with leading whitespace', async () => {
    await inbound({ msgId: 'm1', content: '   /model sonnet' });
    assert.deepEqual(calls.writeSeq[0], PASTE('/model sonnet')); // trimmed at queue + carve-out
  });
});

describe('access control', () => {
  it('allowlist blocks non-listed staff', async () => {
    cfg = { ...cfg, allowStaffIds: ['u1'] };
    await inbound({ msgId: 'm1', senderStaffId: 'intruder', content: 'hello' });
    assert.equal(calls.writeSeq.length, 0);
    await inbound({ msgId: 'm2', senderStaffId: 'u1', content: 'hello' });
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('hello')));
  });

  it('bind-first: a second conversation is ignored', async () => {
    await inbound({ msgId: 'm1', conversationId: 'cA', content: 'hello' }); // binds cA
    await inbound({ msgId: 'm2', conversationId: 'cB', content: 'hello' }); // ignored
    assert.equal(calls.writeSeq.length, 1);
    assert.equal(getBridgeStatus().boundConversationId, 'cA');
  });
});

describe('outbound on turn_end', () => {
  function writeTranscript(lines) {
    const p = join(tmpDir, 'transcript-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    return p;
  }

  it('sends the last assistant text turn (markdown App API), text-only', async () => {
    await inbound({ msgId: 'm1', content: 'hi', conversationType: '1', senderStaffId: 'u1' });
    const tp = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Hello back' }] } },
    ]);
    await notifyTurnEnd('s1', Date.now(), tp);
    const sends = fetches.filter((f) => f.url.includes('oToMessages/batchSend'));
    const send = sends.at(-1);
    assert.ok(send, 'should send via 1:1 App API');
    const param = JSON.parse(send.body.msgParam);
    assert.match(param.text, /Hello back/);
    assert.doesNotMatch(param.text, /thinking|^x$/);
    // pending cleared → next prompt injects again
    await inbound({ msgId: 'm2', content: 'again' });
    assert.equal(calls.writeSeq.length, 2);
  });

  it('is idempotent when a turn_end is delivered twice for one injection', async () => {
    await inbound({ msgId: 'm1', content: 'hi' });
    const tp = writeTranscript([
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'same' }] } },
    ]);
    const ts = Date.now();
    await notifyTurnEnd('s1', ts, tp);
    await notifyTurnEnd('s1', ts, tp); // doubled delivery of the same turn
    const replyCount = fetches.filter((f) => f.url.includes('/robot/') && /same/.test(JSON.parse(f.body.msgParam).text)).length;
    assert.equal(replyCount, 1, 'doubled turn_end must not resend');
  });

  // P2-1 regression: the old text-signature guard wrongly swallowed a later turn whose reply
  // repeated a short confirmation. Distinct turns (different ts) must each send.
  it('sends every distinct turn even when the reply text repeats', async () => {
    await inbound({ msgId: 'm1', content: 'hi' });
    const tp = writeTranscript([
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '完成。' }] } },
    ]);
    await notifyTurnEnd('s1', Date.now(), tp);
    const first = fetches.filter((f) => f.url.includes('/robot/')).length;
    await inbound({ msgId: 'm2', content: 'again' });
    await notifyTurnEnd('s1', Date.now() + 5, tp); // different turn, identical reply text
    const second = fetches.filter((f) => f.url.includes('/robot/')).length;
    assert.ok(second > first, 'a later turn repeating a short reply must still be sent');
  });
});

describe('review fixes (P1/P2)', () => {
  function writeTp(text) {
    const p = join(tmpDir, 'rf-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    return p;
  }
  const robotFetches = () => fetches.filter((f) => f.url.includes('/robot/'));
  const lastText = () => JSON.parse(robotFetches().at(-1).body.msgParam).text;

  it('P1-1: failed injection clears pending (no 10-min wedge) and replies', async () => {
    injectOk = false;
    await inbound({ msgId: 'm1', content: 'hello' });
    await tick();
    assert.match(lastText(), /注入失败|Injection failed/);
    // pending was cleared → a subsequent (successful) injection proceeds
    injectOk = true;
    await inbound({ msgId: 'm2', content: 'retry' });
    assert.deepEqual(calls.writeSeq.at(-1), PASTE(MARK('retry')));
  });

  it('P2-3: inbound CR is stripped (submit byte cannot ride inside the paste frame)', async () => {
    await inbound({ msgId: 'm1', content: 'line1\rline2\ntail' });
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('line1line2\ntail'))); // \r gone, \n kept
  });

  it('P2-4: queue is capped — overflow is dropped with a notice, not enqueued', async () => {
    __setMaxQueueForTests(3); // exercise the cap without emitting >RATE_MAX busy notices
    await inbound({ msgId: 'a0', content: 'first' }); // injected, turn in flight
    for (let i = 0; i < 3; i++) await inbound({ msgId: 'q' + i, content: 'q' + i }); // fill the queue to cap
    await inbound({ msgId: 'overflow', content: 'too much' }); // over cap → dropped
    await tick();
    assert.ok(robotFetches().some((f) => /队列已满|queue is full/i.test(JSON.parse(f.body.msgParam).text)), 'overflow gets a queue-full notice');
    // drain the queued prompts: the dropped one must never have been injected
    for (let i = 0; i < 4; i++) await notifyTurnEnd('s', Date.now() + i, writeTp('ok' + i));
    assert.ok(!calls.writeSeq.some((c) => c[0].includes('too much')), 'dropped prompt must not inject');
    assert.deepEqual(calls.writeSeq.map((c) => c[0].includes('q0') || c[0].includes('q1') || c[0].includes('q2')).filter(Boolean).length, 3, 'the 3 queued prompts inject');
  });

  it('P2-5: skip-perm + blockOnSkipPermissions refuses injection and replies', async () => {
    skipPerm = true; cfg.blockOnSkipPermissions = true;
    await inbound({ msgId: 'm1', content: 'rm -rf' });
    await tick();
    assert.equal(calls.writeSeq.length, 0, 'must not inject under hard block');
    assert.match(lastText(), /收到，正在思考|Got it, thinking/); // block branch distinguished by no-injection above
  });

  it('P2-5: skip-perm without the flag still injects (warn-and-inject preserved)', async () => {
    skipPerm = true; cfg.blockOnSkipPermissions = false;
    await inbound({ msgId: 'm1', content: 'go' });
    assert.deepEqual(calls.writeSeq[0], PASTE(MARK('go'))); // warn branch distinguished by injection happening
    await tick(); await tick();
    assert.match(lastText(), /收到，正在思考|Got it, thinking/);
  });

  it('group conversation (type=2) sends via groupMessages with openConversationId', async () => {
    await inbound({ msgId: 'm1', content: 'hi', conversationType: '2', conversationId: 'grp1' });
    await notifyTurnEnd('s1', Date.now(), writeTp('group reply'));
    const send = fetches.find((f) => f.url.includes('groupMessages/send'));
    assert.ok(send, 'group turn must use the group send URL');
    assert.equal(send.body.openConversationId, 'grp1');
    assert.ok(!('userIds' in send.body), 'group body must not carry userIds');
  });

  it('reuses the cached access token across sends (no re-fetch within expiry)', async () => {
    await inbound({ msgId: 'm1', content: 'a' });
    await notifyTurnEnd('s1', Date.now(), writeTp('r1'));
    await inbound({ msgId: 'm2', content: 'b' });
    await notifyTurnEnd('s1', Date.now() + 1, writeTp('r2'));
    assert.equal(fetches.filter((f) => f.url.includes('accessToken')).length, 1, 'token fetched once');
  });

  it('caps a reply at MAX_CHUNKS_PER_TURN and marks it truncated', async () => {
    cfg.maxChunkChars = 500;
    const longText = Array.from({ length: 12 }, (_, i) => `para ${i} ` + 'y'.repeat(400)).join('\n\n');
    await inbound({ msgId: 'm1', content: 'hi' });
    await tick(); // let the ack card promise settle
    const ackSends = fetches.filter((f) => f.url.includes('oToMessages/batchSend')).length;
    await notifyTurnEnd('s1', Date.now(), writeTp(longText));
    const allSends = fetches.filter((f) => f.url.includes('oToMessages/batchSend'));
    const replySends = allSends.slice(ackSends);
    assert.equal(replySends.length, 5, 'no more than MAX_CHUNKS_PER_TURN chunks');
    assert.match(JSON.parse(replySends.at(-1).body.msgParam).text, /截断|truncated/);
  });
});

describe('extractLastAssistantText', () => {
  function tp(lines) {
    const p = join(tmpDir, 'ex-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    return p;
  }
  it('collects only the final turn, skips thinking/tool_use, excludes sidechain', () => {
    const p = tp([
      { type: 'user', message: { content: 'old prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } },
      { type: 'user', message: { content: 'new prompt' } },
      { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'SUBAGENT noise' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 't' }, { type: 'text', text: 'final answer' }] } },
    ]);
    const out = extractLastAssistantText(p);
    assert.match(out, /final answer/);
    assert.doesNotMatch(out, /old answer/);
    assert.doesNotMatch(out, /SUBAGENT/);
  });
  it('returns empty for missing path', () => {
    assert.equal(extractLastAssistantText('/no/such/file.jsonl'), '');
    assert.equal(extractLastAssistantText(''), '');
  });
});

describe('chunkText', () => {
  it('returns single chunk under the limit', () => {
    assert.deepEqual(chunkText('short', 100), ['short']);
  });
  it('splits long text into chunks under the limit', () => {
    const text = Array.from({ length: 50 }, (_, i) => `paragraph ${i} ` + 'x'.repeat(80)).join('\n\n');
    const chunks = chunkText(text, 500);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 500, `chunk len ${c.length}`);
  });
  it('hard-cuts a single oversized segment with no break points (no loss)', () => {
    const text = 'x'.repeat(1200); // no \n or space → exercises the lastIndexOf-fallback hard cut
    const chunks = chunkText(text, 500);
    assert.ok(chunks.length >= 3);
    for (const c of chunks) assert.ok(c.length <= 500, `chunk len ${c.length}`);
    assert.equal(chunks.join(''), text, 'no characters lost across the hard cut');
  });
});

describe('testConnection', () => {
  it('ok when token fetch succeeds', async () => {
    const r = await testConnection(cfg);
    assert.equal(r.ok, true);
  });
});

describe('system-message i18n follows configured language', () => {
  let origLang;
  beforeEach(() => { origLang = getLang(); });
  afterEach(() => { setLang(origLang); });

  // Trigger a busyQueued reply (sent when a second prompt arrives mid-turn) and return its text.
  async function busyQueuedText(lang) {
    setLang(lang);
    await inbound({ msgId: 'a1', content: 'first' });   // injected, turn in flight
    await inbound({ msgId: 'a2', content: 'second' });   // queued → busyQueued reply
    await tick(); await tick();
    // Skip the ack message (ackProcessing); the busyQueued reply is the second batchSend.
    const sends = fetches.filter((f) => f.url.includes('oToMessages/batchSend'));
    const send = sends.find((f) => /busy|排队|忙/.test(JSON.parse(f.body.msgParam).text));
    assert.ok(send, 'busyQueued should be sent to the 1:1 conversation');
    return JSON.parse(send.body.msgParam).text;
  }

  it('renders busyQueued in English when lang=en', async () => {
    assert.match(await busyQueuedText('en'), /Claude is busy/);
  });

  it('renders busyQueued in Chinese when lang=zh', async () => {
    assert.match(await busyQueuedText('zh'), /正在忙/);
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('dingtalk sender identity (name only; no contact-API avatar fetch)', () => {
  it('does NOT implement resolveSender — robot creds lack 通讯录 scope; name comes free from senderNick', () => {
    // The avatar fetch via topapi/v2/user/get always fails for a robot app (no contact scope) and
    // competes with message send on the same appKey (risk-control throttle). The bridge falls back
    // to senderNick (real name) + default avatar. See the adapter comment where resolveSender was.
    assert.equal(typeof dingtalkAdapter.resolveSender, 'undefined');
  });
});
