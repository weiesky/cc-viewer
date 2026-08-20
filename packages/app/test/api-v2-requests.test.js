/**
 * V3.S2 — the v2_requests metadata channel.
 * Cold: /events emits one `v2_requests` frame (rows before load_end) when
 * deps.wireV3 is on, nothing when off; server_config carries the flag; the
 * br-negotiated stream (which now includes the rows frame) still decodes
 * byte-identical to plaintext.
 * Live: V2LiveFeed({wireV3:true}) broadcasts one `v2_requests_delta` row per
 * emitted item — usage mapped to client shape, typeTag from the shared
 * classifyRequest, cacheLoss against the retained previous mainAgent.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-v2-requests-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const SYS = [{ type: 'text', text: 'You are Claude Code test system.' }];
const TOOLS_A = [{ name: 'Bash', description: 'tool set A' }];
const TOOLS_B = [{ name: 'Bash', description: 'tool set B (changed)' }];
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = [];
  res.ended = false; res.destroyed = false; res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.write(c); res.ended = true; res.emit('finish'); return res; };
  res.body = () => Buffer.concat(res.chunks);
  res.on('error', () => {});
  return res;
}
const makeReq = (headers = {}) => { const req = new EventEmitter(); req.headers = headers; return req; };
const url = (pathname, query = {}) => ({ pathname, searchParams: new URLSearchParams(query) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(cond, ms = 10000) { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await tick(); }

function frameOf(text, name) {
  for (const block of text.split('\n\n')) {
    if (block.startsWith(`event: ${name}\ndata: `)) return JSON.parse(block.slice(`event: ${name}\ndata: `.length));
  }
  return null;
}

let events, interceptor;
let sidCounter = 0;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  interceptor.initForWorkspace(join(tmpDir, 'rowsproj'), { forceNew: true });
  const eventsMod = await import('../server/routes/events.js');
  events = eventsMod.eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function entryOf(i, messages, { tools = TOOLS_A, mainAgent = true, system = SYS, ts = null, sid } = {}) {
  return {
    timestamp: ts || `2026-07-16T11:00:0${i}.000Z`,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST', headers: {},
    body: { model: 'claude-fable-5', system, tools, metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent, requestId: `rid_${i}`,
  };
}

async function seed(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `40000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const [e, usage] of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage } }, duration: 21 });
  }
  await w.flush();
  return sid;
}

const eventsDeps = (over = {}) => ({
  turnEndDebounceMs: 1234, DEFAULT_EVENTS_LIMIT: 400, SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
  pendingMajorUpdate: null, clients: [], wireV3: false, ...over,
});

describe('cold v2_requests frame (/events)', () => {
  it('flag on: rows land before load_end with typeTag/cacheLoss; server_config carries wireV3', async () => {
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    await seed([
      [entryOf(0, t1), { input_tokens: 10, output_tokens: 5 }],
      [entryOf(1, t2, { tools: TOOLS_B }), { input_tokens: 20, output_tokens: 6, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 }],
    ]);
    const res = makeRes();
    await events(makeReq({}), res, url('/events'), true, eventsDeps({ wireV3: true }));
    const text = res.body().toString();
    assert.equal(frameOf(text, 'server_config').wireV3, true);
    const frame = frameOf(text, 'v2_requests');
    assert.ok(frame, 'v2_requests frame present');
    assert.ok(text.indexOf('event: v2_requests') < text.indexOf('event: load_end'), 'rows precede load_end');
    assert.equal(frame.totalCount, 2);
    assert.equal(frame.rows.length, 2);
    assert.equal(frame.rows[0].typeTag?.type, 'MainAgent');
    assert.deepEqual(frame.rows[1].usage, { input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 });
    assert.ok(frame.rows[1].cacheLoss?.reasons.includes('tools_change'));
    res.emit('close');
  });

  it('flag off: no v2_requests frame, server_config says wireV3:false (dark-launch default)', async () => {
    await seed([[entryOf(0, [textMsg('user', 'solo')]), { input_tokens: 1, output_tokens: 1 }]]);
    const res = makeRes();
    await events(makeReq({}), res, url('/events'), true, eventsDeps());
    const text = res.body().toString();
    assert.equal(frameOf(text, 'server_config').wireV3, false);
    assert.equal(frameOf(text, 'v2_requests'), null);
    res.emit('close');
  });

  it('br stream including the rows frame decodes byte-identical to plaintext', async () => {
    await seed([[entryOf(0, [textMsg('user', 'br check')]), { input_tokens: 2, output_tokens: 2 }]]);
    const plain = makeRes();
    await events(makeReq({}), plain, url('/events'), true, eventsDeps({ wireV3: true }));
    const br = makeRes();
    await events(makeReq({ 'accept-encoding': 'br' }), br, url('/events'), true, eventsDeps({ wireV3: true }));
    const plainText = plain.body().toString();
    const d = zlib.createBrotliDecompress();
    const bufs = [];
    d.on('data', (c) => bufs.push(c));
    let fed = 0;
    await until(() => {
      while (fed < br.chunks.length) d.write(br.chunks[fed++]); // feed as flushes land
      return Buffer.concat(bufs).toString().includes('event: load_end');
    });
    assert.equal(Buffer.concat(bufs).toString(), plainText);
    plain.emit('close'); br.emit('close');
  });
});

describe('cold native lines (V3.S4, /events flagged)', () => {
  it('emits v3_conv (from last snapshot ≤ window start) and v3_resp (window member seqs); absent flag-off', async () => {
    const t1 = [textMsg('user', 'native 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'native 2')];
    await seed([
      [entryOf(0, t1), { input_tokens: 1, output_tokens: 1 }],
      [entryOf(1, t2), { input_tokens: 2, output_tokens: 2 }],
    ]);
    const res = makeRes();
    await events(makeReq({}), res, url('/events'), true, eventsDeps({ wireV3: true }));
    const text = res.body().toString();
    const conv = frameOf(text, 'v3_conv');
    assert.ok(conv, 'v3_conv frame present');
    assert.equal(conv.channel, 'main');
    assert.ok(Array.isArray(conv.lines) && conv.lines.length >= 2, 'snapshot + append lines');
    assert.equal(conv.lines[0].t, 'snapshot', 'starts at a snapshot');
    const resp = frameOf(text, 'v3_resp');
    assert.ok(resp, 'v3_resp frame present');
    assert.equal(resp.lines.length, 2, 'one responses line per window member');
    assert.ok(resp.lines.every((l) => l.body && Number.isInteger(l.seq)));
    res.emit('close');

    const off = makeRes();
    await events(makeReq({}), off, url('/events'), true, eventsDeps());
    const offText = off.body().toString();
    assert.equal(frameOf(offText, 'v3_conv'), null);
    assert.equal(frameOf(offText, 'v3_resp'), null);
    off.emit('close');
  });
});

describe('live v2_requests_delta rows (V2LiveFeed wireV3)', () => {
  it('emits one row per item with usage/typeTag; cacheLoss against previous main', async () => {
    const { V2LiveFeed } = await import('../server/lib/v2/live-feed.js');
    const { V2Writer } = await import('../server/lib/v2/v2-writer.js');
    const { resolveSessionDirName } = await import('../server/lib/v2/session-select.js');
    const project = 'liveproj';
    const sid = '40000000-0000-4000-8000-999999999999';
    const client = { writes: [], destroyed: false, writable: true, write(p) { this.writes.push(String(p)); return true; }, once() {}, end() {} };
    const feed = new V2LiveFeed({
      clients: [client], getClaudePid: () => 1, runParallelHook: () => Promise.resolve(),
      watchImpl: () => ({ close() {}, on() {} }), safetyPollMs: 0, wireV3: true,
    });
    feed.start(join(tmpDir, project));

    const w = new V2Writer({ logDir: tmpDir, project, enabled: true, minFreeBytes: 0 });
    const t1 = [textMsg('user', 'turn 1')];
    const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
    const fire = (e, usage) => {
      const h = w.ingestRequest(e, e.body.messages);
      w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage } }, duration: 33 });
    };
    fire(entryOf(0, t1, { sid }), { input_tokens: 10, output_tokens: 5 });
    fire(entryOf(1, t2, { tools: TOOLS_B, sid }), { input_tokens: 20, output_tokens: 6, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 });
    await w.flush();

    const sessionDir = join(tmpDir, project, 'sessions', resolveSessionDirName(join(tmpDir, project), sid) || sid);
    feed.tick(sessionDir);
    await until(() => client.writes.some((x) => x.includes('event: v2_requests_delta')));

    // Review F4: with wireV3 the legacy full-entry broadcast is SUPPRESSED —
    // bare `data:` frames (no event name) must not appear.
    assert.equal(client.writes.filter((x) => x.startsWith('data: ')).length, 0, 'full-entry broadcast suppressed');

    const rows = client.writes
      .filter((x) => x.startsWith('event: v2_requests_delta\ndata: '))
      .map((x) => JSON.parse(x.slice('event: v2_requests_delta\ndata: '.length, x.indexOf('\n\n'))));
    assert.ok(rows.length >= 2, `expected ≥2 rows, got ${rows.length}`);
    const final = new Map(rows.map((r) => [`${r.sessionId}\x00${r.seq}`, r]));
    const [r1, r2] = [...final.values()].sort((a, b) => a.seq - b.seq);
    assert.equal(r1.typeTag?.type, 'MainAgent');
    assert.equal(r1.inProgress, false);
    assert.deepEqual(r2.usage, { input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 });
    assert.ok(r2.cacheLoss?.reasons.includes('tools_change'), JSON.stringify(r2.cacheLoss));
    assert.equal(r2.status, 200);
    assert.equal(r2.duration, 33);

    // V3.S4: raw native lines forwarded alongside (conv + responses)
    const convFrames = client.writes.filter((x) => x.startsWith('event: v3_conv\ndata: '));
    const respFrames = client.writes.filter((x) => x.startsWith('event: v3_resp\ndata: '));
    assert.ok(convFrames.length >= 2, 'one v3_conv per conv line');
    assert.ok(respFrames.length >= 2, 'one v3_resp per responses line');
    const conv0 = JSON.parse(convFrames[0].slice('event: v3_conv\ndata: '.length, convFrames[0].indexOf('\n\n')));
    assert.equal(conv0.sessionId, sid);
    assert.equal(conv0.channel, 'main');
    assert.equal(conv0.line.t, 'snapshot');
    const resp0 = JSON.parse(respFrames[0].slice('event: v3_resp\ndata: '.length, respFrames[0].indexOf('\n\n')));
    assert.equal(resp0.sessionId, sid);
    assert.ok(resp0.line.body, 'raw responses line forwarded verbatim');

    feed.stop?.();
    rmSync(join(tmpDir, project), { recursive: true, force: true });
  });

  it('typeTag correction re-sends the previous row when nextReq flips its classification (review F5)', async () => {
    const { V2LiveFeed } = await import('../server/lib/v2/live-feed.js');
    const { V2Writer } = await import('../server/lib/v2/v2-writer.js');
    const { resolveSessionDirName } = await import('../server/lib/v2/session-select.js');
    const project = 'corrproj';
    const sid = '40000000-0000-4000-8000-888888888888';
    const client = { writes: [], destroyed: false, writable: true, write(p) { this.writes.push(String(p)); return true; }, once() {}, end() {} };
    const feed = new V2LiveFeed({
      clients: [client], getClaudePid: () => 1, runParallelHook: () => Promise.resolve(),
      watchImpl: () => ({ close() {}, on() {} }), safetyPollMs: 0, wireV3: true,
    });
    feed.start(join(tmpDir, project));

    const w = new V2Writer({ logDir: tmpDir, project, enabled: true, minFreeBytes: 0 });
    const fire = (e) => {
      const h = w.ingestRequest(e, e.body.messages);
      w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: {} } }, duration: 5 });
    };
    // Preflight shape: NO tools, single user message, Claude Code system —
    // classify(A, null) cannot be Preflight (needs nextReq), classify(A, B)
    // becomes Preflight once B's messages contain A's text signature.
    const preText = 'unique preflight probe text for the correction fixture';
    fire({
      timestamp: '2026-07-16T14:00:00.000Z', url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {},
      body: { model: 'claude-fable-5', system: SYS, tools: [], metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) }, messages: [textMsg('user', preText)] },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false, mainAgent: false, requestId: 'rid_pre',
    });
    fire(entryOf(1, [textMsg('user', preText), textMsg('user', 'go')], { sid, ts: '2026-07-16T14:00:01.000Z' }));
    await w.flush();

    const sessionDir = join(tmpDir, project, 'sessions', resolveSessionDirName(join(tmpDir, project), sid) || sid);
    feed.tick(sessionDir);
    await until(() => {
      const rows = client.writes.filter((x) => x.startsWith('event: v2_requests_delta\ndata: '))
        .map((x) => JSON.parse(x.slice('event: v2_requests_delta\ndata: '.length, x.indexOf('\n\n'))));
      const preRows = rows.filter((r) => r.seq === 1);
      return preRows.length >= 2 && preRows.some((r) => r.typeTag?.type === 'Preflight' || r.typeTag?.type === 'Plan');
    });
    const preRows = client.writes.filter((x) => x.startsWith('event: v2_requests_delta\ndata: '))
      .map((x) => JSON.parse(x.slice('event: v2_requests_delta\ndata: '.length, x.indexOf('\n\n'))))
      .filter((r) => r.seq === 1);
    assert.ok(preRows.length >= 2, 'row re-sent after nextReq landed');
    assert.notDeepEqual(preRows[0].typeTag, preRows[preRows.length - 1].typeTag, 'classification corrected');
    feed.stop?.();
    rmSync(join(tmpDir, project), { recursive: true, force: true });
  });
});
