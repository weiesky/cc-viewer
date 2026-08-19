/**
 * V3.S5 — client entry assembler: rows + native lines → v1-shape entries.
 * The load-bearing case runs the REAL /events handler twice (flag off = legacy
 * entries as the oracle; flag on = rows + v3_conv/v3_resp) and asserts the
 * assembled entries match the legacy ones on every field the chat pipeline
 * consumes (messages, response body, flags, _seq/_seqEpoch) — tools/system
 * are absent by design (detail view fetches on demand).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-v3-assembler-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { createV3Assembler } = await import('../apps/web/src/utils/v3Assembler.js');

const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = [];
  res.ended = false; res.destroyed = false; res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString() : String(c)); return true; };
  res.end = () => { res.ended = true; res.emit('finish'); return res; };
  res.text = () => res.chunks.join('');
  res.on('error', () => {});
  return res;
}
const makeReq = () => { const req = new EventEmitter(); req.headers = {}; return req; };
const url = (pathname) => ({ pathname, searchParams: new URLSearchParams() });

function framesOf(text, name) {
  const out = [];
  for (const block of text.split('\n\n')) {
    if (block.startsWith(`event: ${name}\ndata: `)) out.push(JSON.parse(block.slice(`event: ${name}\ndata: `.length)));
  }
  return out;
}

describe('createV3Assembler unit', () => {
  it('replays snapshot/append/replace-tail and attaches responses', () => {
    const a = createV3Assembler();
    const sid = 'unit-sid';
    a.addConvLines(sid, 'main', [
      { seq: 1, t: 'snapshot', msgs: [textMsg('user', 'u1')] },
      { seq: 2, t: 'append', msgs: [textMsg('assistant', 'a1'), textMsg('user', 'u2')] },
      { seq: 3, t: 'ctl', op: 'replace-tail', msg: textMsg('user', 'u2-replaced') },
    ]);
    a.addRespLines(sid, [{ seq: 2, body: { content: [], usage: { input_tokens: 9 } } }]);
    const row = (seq, over = {}) => ({ seq, sessionId: sid, timestamp: `2026-07-16T12:00:0${seq}.000Z`, url: 'u', method: 'POST', conv: 'main', kind: 'main', mainAgent: true, model: 'm', status: 200, duration: 5, inProgress: false, evt: seq === 1 ? 'snapshot' : undefined, ...over });

    const e1 = a.buildEntry(row(1));
    assert.deepEqual(e1.body.messages, [textMsg('user', 'u1')]);
    assert.equal(e1._isCheckpoint, true);
    assert.equal(e1._seqEpoch, `v2:${sid}`);

    const e2 = a.buildEntry(row(2));
    assert.equal(e2.body.messages.length, 3);
    assert.equal(e2._totalMessageCount, 3);
    assert.equal(e2._isCheckpoint, undefined, 'delta entries arrive pre-expanded (implicit checkpoint)');
    assert.deepEqual(e2.response.body.usage, { input_tokens: 9 });

    const e3 = a.buildEntry(row(3, { inProgress: true }));
    assert.equal(e3.inProgress, true);
    assert.equal(e3.response, undefined);
    assert.equal(e3.body.messages[2].content[0].text, 'u2-replaced');
    assert.ok(e3.requestId);
  });
});

describe('cold assembly parity vs legacy entries (oracle)', () => {
  let events, interceptor, sidCounter = 0;

  before(async () => {
    interceptor = await import('../packages/app/server/interceptor.js');
    interceptor.initForWorkspace(join(tmpDir, 'asmproj'), { forceNew: true });
    const eventsMod = await import('../packages/app/server/routes/events.js');
    events = eventsMod.eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const eventsDeps = (over = {}) => ({
    turnEndDebounceMs: 1, DEFAULT_EVENTS_LIMIT: 400, SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
    pendingMajorUpdate: null, clients: [], wireV3: false, ...over,
  });

  it('assembled entries match the legacy cold stream on chat-consumed fields', async () => {
    const w = interceptor._v2Writer;
    w.resetSessions();
    const sid = `50000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
    const mk = (i, messages, mainAgent = true) => ({
      timestamp: `2026-07-16T12:10:0${i}.000Z`,
      url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {},
      body: {
        model: 'claude-fable-5',
        system: [{ type: 'text', text: mainAgent ? 'You are Claude Code test.' : 'You are a helper subagent.' }],
        tools: [{ name: 'Bash' }],
        metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) },
        messages,
      },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent, requestId: `rid_${i}`,
    });
    // Big + non-ASCII content: forces the 512KB pushChunked split (≥2 v3_conv
    // frames, review F3) and pins the byte-meter unit on multibyte payloads
    // (both sides count UTF-16 code units, review F9).
    const bigCjk = '中文测试内容-'.repeat(50000); // ~350K chars, >512KB as UTF-8
    const t1 = [textMsg('user', 'turn 1 ' + bigCjk)];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2 ' + bigCjk)];
    const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
    for (const [i, msgs] of [t1, t2, t3].entries()) {
      const e = mk(i, msgs);
      const h = w.ingestRequest(e, e.body.messages);
      w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [{ type: 'text', text: `resp ${i}` }], usage: { input_tokens: i + 1, output_tokens: 1 } } }, duration: 8 });
    }
    const sub = mk(3, [textMsg('user', 'sub work')], false);
    const hs = w.ingestRequest(sub, sub.body.messages);
    w.ingestCompletion(hs, { ...sub, response: { status: 200, headers: {}, body: { content: [{ type: 'text', text: 'sub resp' }], usage: {} } }, duration: 3 });
    await w.flush();

    // Oracle: legacy flag-off stream, client-reconstructed
    const { reconstructEntries } = await import('../packages/app/server/lib/delta-reconstructor.js');
    const off = makeRes();
    await events(makeReq(), off, url('/events'), true, eventsDeps());
    const legacyRaw = framesOf(off.text(), 'load_chunk').flat();
    const legacy = reconstructEntries(legacyRaw);
    off.emit('close');

    // Flagged: rows + native lines, NO legacy chunks
    const on = makeRes();
    await events(makeReq(), on, url('/events'), true, eventsDeps({ wireV3: true }));
    const text = on.text();
    assert.equal(framesOf(text, 'load_chunk').length, 0, 'legacy chunks suppressed when flagged');
    const rows = framesOf(text, 'v2_requests')[0].rows;
    const convFrames = framesOf(text, 'v3_conv');
    assert.ok(convFrames.filter((f) => f.channel === 'main').length >= 2, '512KB budget splits the big channel into multiple frames');
    const a = createV3Assembler();
    for (const f of convFrames) a.addConvLines(f.sessionId, f.channel, f.lines);
    for (const f of framesOf(text, 'v3_resp')) a.addRespLines(f.sessionId, f.lines);
    const assembled = a.buildColdEntries(rows);
    on.emit('close');

    assert.equal(assembled.length, legacy.length, 'same window membership');
    for (let i = 0; i < legacy.length; i++) {
      const L = legacy[i]; const A = assembled[i];
      assert.equal(A.timestamp, L.timestamp, `entry ${i} timestamp`);
      assert.equal(A.mainAgent, !!L.mainAgent, `entry ${i} mainAgent`);
      assert.deepEqual(A.body.messages, L.body.messages, `entry ${i} reconstructed messages parity`);
      assert.deepEqual(A.response?.body, L.response?.body, `entry ${i} response body parity`);
      assert.equal(A.body.model, L.body.model, `entry ${i} model`);
      assert.ok(Number.isInteger(A._seq), `entry ${i} assembled _seq present`);
      if (L._seq !== undefined) assert.equal(A._seq, L._seq, `entry ${i} seq matches legacy envelope`);
    }
    // Reconnect contract (review F1/P0-2): a fresh reset frame resets the
    // assembler; re-feeding the replayed window must be idempotent.
    a.reset();
    for (const f of convFrames) a.addConvLines(f.sessionId, f.channel, f.lines);
    for (const f of framesOf(text, 'v3_resp')) a.addRespLines(f.sessionId, f.lines);
    assert.deepEqual(a.buildColdEntries(rows), assembled, 'second cold cycle after reset assembles identically');
    // load_start still emitted with the rows-derived total (loading UX parity)
    const loadStart = framesOf(text, 'load_start')[0];
    assert.equal(loadStart.total, rows.length);
    // v3Bytes = exact sum of the v3 frame payload lengths. UNIT: UTF-16 code
    // units (String.length) on BOTH sides — the client accumulates
    // event.data.length, so the meter is internally consistent; the CJK
    // fixture above pins that this is NOT Buffer.byteLength (review F9).
    const payloadLen = (name) => text.split('\n\n').filter((b) => b.startsWith(`event: ${name}\ndata: `)).reduce((acc, b) => acc + b.slice(`event: ${name}\ndata: `.length).length, 0);
    assert.equal(loadStart.v3Bytes, payloadLen('v2_requests') + payloadLen('v3_conv') + payloadLen('v3_resp'));
    // kv/context side frames survive the flip (sourced from the newest main
    // row's readV2SingleEntry rebuild instead of the legacy scan ring)
    assert.ok(text.includes('event: context_window'), 'context_window frame on the v3 path');
    assert.ok(text.includes('event: kv_cache_content'), 'kv_cache_content frame on the v3 path');
  });
});
