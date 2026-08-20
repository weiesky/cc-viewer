/**
 * V3.S1 — readV2SingleEntry + GET /api/v2-entry.
 * Unit tier: single-entry reads against a real V2Writer session — byte parity
 * with the cold stream for full-bodied targets, checkpoint promotion (full
 * replayed messages, matching the client's post-reconstruction state) for
 * mid-session main deltas, prevMain pairing, blob backfill, unknown-seq null.
 * CLI tier: the HTTP route — basename + bare-UUID addressing, sid param,
 * br compression round-trip, 400/404.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import zlib from 'node:zlib';
import { describeCli } from './_helpers/cli-tier.mjs';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-v2-entry-'));
process.env.CCV_LOG_DIR = process.env.CCV_TEST_CLI ? process.env.CCV_LOG_DIR || 'tmp' : tmpRoot;
process.env.CLAUDE_CONFIG_DIR = tmpRoot;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_START_PORT = '18470';
process.env.CCV_MAX_PORT = '18479';

const { V2Writer } = await import('../server/lib/v2/v2-writer.js');
const { readV2SingleEntry, iterateV2RawEntries } = await import('../server/lib/v2/adapter.js');
const { reconstructEntries } = await import('@ccv/core/delta-reconstructor');
const { resolveSessionDirName } = await import('../server/lib/v2/session-select.js');

const SID = 'e1e2e3e4-1111-4222-8333-000000000001';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

const unitDir = join(tmpRoot, 'unitproj');

function buildSession(logDir, project) {
  const w = new V2Writer({ logDir, project, enabled: true, minFreeBytes: 0 });
  const mk = (messages, i, over = {}) => ({
    timestamp: `2026-07-16T09:00:0${i}.000Z`,
    project,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {},
    body: {
      model: 'claude-fable-5',
      max_tokens: 32000, // residual param — must ride req.params to the detail view
      system: [{ type: 'text', text: 'You are Claude Code test system.' }],
      tools: [{ name: 'Bash', description: 'runs shell commands in a sandbox' }],
      metadata: { user_id: USER_ID },
      messages,
    },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent: true, requestId: `rid_${i}`,
    ...over,
  });
  const t1 = [textMsg('user', 'turn 1')];
  const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
  const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
  const wires = [t1, t2, t3];
  wires.forEach((messages, i) => {
    const e = mk(messages, i);
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 5 + i, output_tokens: 2 } } }, duration: 7 });
  });
  // A sub-agent request between main turns (own conv channel, full messages)
  const sub = mk([textMsg('user', 'sub work')], 3, {
    mainAgent: false,
    body: {
      model: 'claude-fable-5',
      system: [{ type: 'text', text: 'You are a helper subagent.' }],
      tools: [{ name: 'Bash' }],
      metadata: { user_id: USER_ID },
      messages: [textMsg('user', 'sub work')],
    },
  });
  const hs = w.ingestRequest(sub, sub.body.messages);
  w.ingestCompletion(hs, { ...sub, response: { status: 200, headers: {}, body: { content: [], usage: {} } }, duration: 3 });
  return w.flush().then(() => w);
}

describe('readV2SingleEntry (V3.S1 unit)', () => {
  let sessionDir, cold, reconstructed, coldParsed;

  before(async () => {
    await buildSession(tmpRoot, 'unitproj');
    const basename = resolveSessionDirName(unitDir, SID) || SID;
    sessionDir = join(unitDir, 'sessions', basename);
    cold = [...iterateV2RawEntries(sessionDir)];
    coldParsed = cold.map((r) => JSON.parse(r));
    reconstructed = reconstructEntries(cold.map((r) => JSON.parse(r)));
  });

  after(() => { rmSync(join(tmpRoot, 'unitproj'), { recursive: true, force: true }); });

  it('checkpoint target is byte-identical to the cold stream raw', async () => {
    const seq = coldParsed[0]._seq ?? 1; // first main turn = checkpoint
    const r = await readV2SingleEntry(sessionDir, { seq });
    assert.ok(r);
    assert.equal(r.entry, cold[0]);
    assert.equal(r.prevMain, null, 'first main has no predecessor');
  });

  it('mid-session main delta is promoted to full replayed messages (client-equivalent)', async () => {
    const idx = 2; // third main turn — a delta on the wire
    const seq = coldParsed[idx]._seq;
    assert.ok(Number.isInteger(seq), 'delta entries carry _seq');
    const r = await readV2SingleEntry(sessionDir, { seq });
    assert.ok(r);
    const got = JSON.parse(r.entry);
    assert.equal(got._isCheckpoint, true, 'promoted');
    assert.deepEqual(got.body.messages, reconstructed[idx].body.messages, 'full state == reconstructor oracle');
    assert.equal(got._totalMessageCount, got.body.messages.length);
    // non-message fields still match the wire entry
    const wire = JSON.parse(cold[idx]);
    assert.deepEqual(got.response, wire.response);
    assert.deepEqual(got.body.tools, wire.body.tools, 'blob backfill intact');
    assert.deepEqual(got.body.system, wire.body.system);
    assert.equal(got.body.max_tokens, 32000, 'residual params reach the detail-view entry');
  });

  it('prevMain is the preceding mainAgent entry, also promoted', async () => {
    const idx = 2;
    const r = await readV2SingleEntry(sessionDir, { seq: coldParsed[idx]._seq });
    assert.ok(r.prevMain);
    const prev = JSON.parse(r.prevMain);
    assert.deepEqual(prev.body.messages, reconstructed[1].body.messages, 'prevMain full state');
    assert.equal(prev.timestamp, coldParsed[1].timestamp);
  });

  it('sub-agent target is byte-identical (no promotion) and pairs with preceding main', async () => {
    const subIdx = coldParsed.findIndex((e) => !e.mainAgent);
    assert.ok(subIdx > 0);
    // sub entries carry no _seq on the wire — locate via journal seq ordering:
    // seq is 1-based over ingest order (3 mains then the sub → seq 4)
    const r = await readV2SingleEntry(sessionDir, { seq: 4 });
    assert.ok(r);
    assert.equal(r.entry, cold[subIdx], 'sub target byte-parity');
    const prev = JSON.parse(r.prevMain);
    assert.equal(prev.timestamp, coldParsed[2].timestamp, 'prevMain = last main before the sub');
  });

  it('unknown seq returns null (caller answers 404)', async () => {
    assert.equal(await readV2SingleEntry(sessionDir, { seq: 999 }), null);
  });

  it('sessionId filter restricts the match', async () => {
    assert.equal(await readV2SingleEntry(sessionDir, { seq: 1, sessionId: 'no-such-uuid' }), null);
    const r = await readV2SingleEntry(sessionDir, { seq: 1, sessionId: SID });
    assert.ok(r);
  });
});

describeCli('GET /api/v2-entry (V3.S1 route)', { concurrency: false }, () => {
  const projectName = `projV3E_${Date.now()}`;
  let stopViewer, port, LOG_DIR, basename;

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  before(async () => {
    ({ LOG_DIR } = await import('../findcc.js'));
    await buildSession(LOG_DIR, projectName);
    basename = resolveSessionDirName(join(LOG_DIR, projectName), SID) || SID;
    const mod = await import('../server/server.js');
    stopViewer = mod.stopViewer;
    await mod.startViewer();
    port = mod.getPort();
  });

  after(() => {
    stopViewer();
    rmSync(join(LOG_DIR, projectName), { recursive: true, force: true });
  });

  it('serves {entry, prevMain} by basename ref', async () => {
    const r = await get(`/api/v2-entry?file=${encodeURIComponent(`v2:${projectName}/${basename}`)}&seq=2`);
    assert.equal(r.status, 200);
    const body = JSON.parse(r.buf.toString());
    assert.ok(body.entry && body.entry.body);
    assert.ok(body.prevMain, 'seq 2 has a preceding main');
  });

  it('resolves a bare-UUID ref (client only holds _seqEpoch UUID)', async () => {
    const r = await get(`/api/v2-entry?file=${encodeURIComponent(`v2:${projectName}/${SID}`)}&seq=1&sid=${SID}`);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.buf.toString()).prevMain, null);
  });

  it('br round-trip decodes to the identical plaintext body', async () => {
    const path = `/api/v2-entry?file=${encodeURIComponent(`v2:${projectName}/${basename}`)}&seq=3`;
    const plain = await get(path);
    const br = await get(path, { 'accept-encoding': 'br' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(br.buf).toString(), plain.buf.toString());
  });

  it('unknown seq → 404; malformed params → 400; bad project → 404', async () => {
    const r404 = await get(`/api/v2-entry?file=${encodeURIComponent(`v2:${projectName}/${basename}`)}&seq=999`);
    assert.equal(r404.status, 404);
    const r400 = await get('/api/v2-entry?file=not-a-ref&seq=x');
    assert.equal(r400.status, 400);
    const rMissing = await get(`/api/v2-entry?file=${encodeURIComponent('v2:no-such-proj/nope')}&seq=1`);
    assert.ok(rMissing.status === 404 || rMissing.status === 403);
  });
});
