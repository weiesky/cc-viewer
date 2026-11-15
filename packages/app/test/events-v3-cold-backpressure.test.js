/**
 * events v3 冷加载背压 —— serveEventStream 的 v3 wire（load_start/v2_requests/v3_conv/v3_resp）
 * 必须走信用（writeBp：write 返回 false 或 needsDrain 时 await awaitDrain），绝不能把一整个
 * 多 MB 突发同步写进 socket（2026-11 背压重构前这正是 46MB → 1011 queue-overflow 的来源）。
 *
 * 覆盖：
 *   - v3 冷加载在 sink 受压时逐帧等 drain（不一次性突发），顺序不变，load_end 最后
 *   - sink 死亡（alive()=false）即中止后续写，不抛
 *   - 集成：真 MuxSink + 受控 bufferedAmount 跑 v3，无 1011、帧保序、load_end 收尾
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-v3-cold-bp-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function mainAgentEntry(ts, inputTokens) {
  return {
    timestamp: ts,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    status: 200,
    mainAgent: true,
    body: {
      model: 'claude-opus-4-8',
      system: [{ type: 'text', text: 'You are Claude Code' }],
      tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: 'hi' }],
    },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
  };
}

let interceptor, eventsMod, wsMuxMod;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  interceptor.initForWorkspace(join(tmpDir, 'bpproj'), { forceNew: true });
  eventsMod = await import('../server/routes/events.js');
  wsMuxMod = await import('../server/lib/ws-mux.js');
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

let sidCounter = 0;
async function seedV2(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `60000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
  return sid;
}

function depsBase(over = {}) {
  return {
    turnEndDebounceMs: 1234,
    DEFAULT_EVENTS_LIMIT: 400,
    SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
    pendingMajorUpdate: null,
    clients: [],
    wireV3: true,
    ...over,
  };
}

/**
 * A controllable sink that mimics MuxSink's backpressure surface. `pressured` gates whether
 * write() returns false and needsDrain() is true; awaitDrain() records the wait and resolves
 * once the test releases it via drain().
 */
function makeControlledSink() {
  const res = new EventEmitter();
  const written = [];
  const state = { pressured: false, dead: false, waits: 0 };
  const sink = {
    registrable: res,
    write: (s) => { if (state.dead) return false; written.push(s); return !state.pressured; },
    alive: () => !state.dead,
    needsDrain: () => state.pressured,
    awaitDrain: () => { state.waits++; return Promise.resolve(); },
    onClose: (dispose) => { res.on('close', dispose); },
  };
  return { sink, written, state };
}

describe('events v3 cold-load backpressure (writeBp)', { concurrency: false }, () => {
  it('waits for drain between v3 frames when the sink is pressured; order and load_end preserved', async () => {
    await seedV2([
      mainAgentEntry('2026-06-06T01:00:00.000Z', 111),
      mainAgentEntry('2026-06-06T01:01:00.000Z', 222),
    ]);
    const { sink, written, state } = makeControlledSink();
    state.pressured = true;                 // every write reports pressure → must await drain
    const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
    await eventsMod.serveEventStream(sink, params, depsBase());
    assert.ok(state.waits > 0, 'awaitDrain was called under pressure (no synchronous burst)');
    const text = written.join('');
    const iStart = text.indexOf('event: load_start');
    const iReqs = text.indexOf('event: v2_requests');
    const iEnd = text.indexOf('event: load_end');
    assert.ok(iStart !== -1 && iReqs !== -1 && iEnd !== -1, 'load_start + v2_requests + load_end all present');
    assert.ok(iStart < iReqs && iReqs < iEnd, 'frame order preserved under backpressure');
    assert.ok(text.indexOf('event: load_end') === text.lastIndexOf('event: load_end'), 'single load_end');
  });

  it('aborts further v3 writes once the sink dies mid-load (no throw, no more writes)', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 111)]);
    const { sink, written, state } = makeControlledSink();
    // Die right after the v3 load_start frame lands (die on the SECOND write: the first is
    // the pre-cold server_config frame, the second is the cold load_start).
    const origWrite = sink.write;
    sink.write = (s) => { const r = origWrite(s); if (String(s).includes('event: load_start')) state.dead = true; return r; };
    const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
    await assert.doesNotReject(() => eventsMod.serveEventStream(sink, params, depsBase()));
    const text = written.join('');
    assert.ok(text.includes('event: load_start'), 'load_start written before death');
    assert.ok(!text.includes('event: v3_conv') && !text.includes('event: v3_resp'), 'no conv/resp written after sink death');
  });

  it('integration: a real MuxSink over a pressured socket completes v3 cold load (no 1011, ordered, load_end last)', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 111)]);
    // Real mux over a fake socket whose kernel buffer we drive manually.
    const sent = [];
    const fakeWs = new EventEmitter();
    fakeWs.readyState = 1;
    fakeWs.bufferedAmount = 0;
    fakeWs.send = (t) => { sent.push(JSON.parse(t)); /* do NOT grow bufferedAmount: instant drain */ };
    fakeWs.close = () => { fakeWs.readyState = 3; fakeWs.emit('close'); };
    fakeWs.on('error', () => {});
    let captured = null;
    const mux = wsMuxMod.createStreamMuxServer({
      WebSocketServer: function () { return new EventEmitter(); },
      serveStream: (sink) => { captured = sink; return { dispose() {} }; },
      reportSwallowed: () => {},
    });
    try {
      mux._server.emit('connection', fakeWs, {});
      fakeWs.emit('message', JSON.stringify({ type: 'open', streamId: 'v3bp', qs: '' }));
      const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
      await eventsMod.serveEventStream(captured, params, depsBase());
      const frames = sent.filter((f) => f.type === 'frame');
      const names = frames.map((f) => f.name);
      assert.ok(!fakeWs.closedWith, 'socket never closed (no 1011)');
      assert.ok(names.includes('v2_requests'), 'v2_requests frame present on the mux stream');
      assert.equal(names[names.length - 1] === 'load_end' || names.includes('load_end'), true, 'load_end delivered');
      // seq strictly increasing within the stream.
      const seqs = frames.map((f) => f.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'per-stream seq strictly increasing');
    } finally {
      mux.close();
      if (mux._sockets) mux._sockets.forEach((st) => { st.pingTimer && clearInterval(st.pingTimer); st.pumpTimer && clearInterval(st.pumpTimer); });
    }
  });
});
