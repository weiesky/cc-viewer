/**
 * Multi-project broadcast scoping (2026-10) — stream-progress / streaming_status
 * must reach only the SSE clients VIEWING the source project (the cross-project
 * typewriter/spinner bleed fix).
 *
 * Covers ask-perm.js streamChunk: payload now carries `project`, and the
 * broadcast goes through filterClientsByViewProject instead of raw deps.clients.
 * Fixture pattern mirrors resume-route.test.js (isolated CCV_LOG_DIR, direct
 * handler calls with fake req/res); no real SSE/PTY is opened.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// Isolate LOG_DIR before importing anything that loads findcc/interceptor.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-stream-scope-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { askPermRoutes } = await import('../server/routes/ask-perm.js');
const { initForWorkspace } = await import('../server/interceptor.js');

// Bind a project so _projectName is non-empty (the bound project fallback).
initForWorkspace(join(tmpDir, 'boundProj'), { forceNew: true });

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const streamChunkRoute = askPermRoutes.find((r) => r.path === '/api/stream-chunk');
assert.ok(streamChunkRoute, 'POST /api/stream-chunk must be registered');
const streamChunk = streamChunkRoute.handler;

/** A fake SSE client: captures every sendEventToClients payload routed to it.
 *  `_ccvViewProject` is the per-connection stamp events.js applies (:484). */
function mkSseClient(viewProject, viewInstance) {
  const writes = [];
  return {
    _ccvViewProject: viewProject,
    _ccvViewInstance: viewInstance,
    writes,
    // sendEventToClients writes via sseWrite(res, frame) → res.write
    write(chunk) { writes.push(chunk); return true; },
  };
}

function mkReq(payloadObj) {
  const req = new EventEmitter();
  req.socket = { remoteAddress: '127.0.0.1' };
  req.headers = { 'x-cc-viewer-internal': '1' };
  process.nextTick(() => {
    req.emit('data', JSON.stringify(payloadObj));
    req.emit('end');
  });
  return req;
}

function callStreamChunk(entryPayload, clients) {
  return new Promise((resolve) => {
    const res = { writeHead() {}, end() { resolve(); } };
    const parsedUrl = new URL('/api/stream-chunk', 'http://localhost');
    streamChunk(mkReq(entryPayload), res, parsedUrl, true, {
      clients,
      liveStreamLastSeq: new Map(),
      MAX_POST_BODY: 1 << 20,
    });
  });
}

const baseEntry = {
  timestamp: '2026-10-05T00:00:00.000Z',
  url: 'https://api.anthropic.com/v1/messages',
  body: { model: 'claude-fable-5' },
  response: { body: { content: [{ type: 'text', text: 'hi' }] } },
  sessionId: 'a9883ab8-0ab7-459a-bcfd-4c8950a14384',
  _chunkSeq: 1,
};

describe('streamChunk multi-project scoping', () => {
  it('payload carries the source project (bound fallback) and reaches only viewers of it', async () => {
    const viewerA = mkSseClient('projA');
    const viewerBound = mkSseClient('boundProj');
    const clients = [viewerA, viewerBound];
    // Entry with NO _resumeProject → source = bound project.
    await callStreamChunk({ ...baseEntry }, clients);

    const boundGot = viewerBound.writes.join('');
    const aGot = viewerA.writes.join('');
    assert.ok(boundGot.includes('stream-progress'), 'bound viewer receives the typewriter');
    assert.ok(boundGot.includes('"project":"boundProj"'), 'payload is stamped with the source project');
    assert.equal(aGot, '', 'a client viewing ANOTHER project must NOT receive it (bleed fix)');
  });

  it('entry._resumeProject (parallel claude) routes to THAT project’s viewers', async () => {
    const viewerA = mkSseClient('projA');
    const viewerBound = mkSseClient('boundProj');
    viewerA.writes.length = 0;
    viewerBound.writes.length = 0;
    const clients = [viewerA, viewerBound];
    await callStreamChunk({ ...baseEntry, _resumeProject: 'projA', _chunkSeq: 2 }, clients);

    assert.ok(viewerA.writes.join('').includes('"project":"projA"'), 'parallel project viewer receives its own typewriter');
    assert.equal(viewerBound.writes.join(''), '', 'bound viewer does NOT receive the parallel project’s frame');
  });

  it('un-stamped clients (default = bound project) still receive the bound frame (legacy parity)', async () => {
    const legacyClient = mkSseClient(undefined); // no stamp → defaults to bound
    const clients = [legacyClient];
    await callStreamChunk({ ...baseEntry, _chunkSeq: 3 }, clients);
    assert.ok(legacyClient.writes.join('').includes('stream-progress'), 'legacy single-project client unaffected');
  });

  // ── New-field routing (entry.project / entry.instance) — the "dead code made
  // live" point of 5c28d4c5. The interceptor stamps the chunk with the emitting
  // claude's self-reported project/instance; entry.project now WINS over the
  // _resumeProject fallback, and entry.instance narrows to the matching instance.
  it('entry.project wins over entry._resumeProject when both are present', async () => {
    const viewerSelf = mkSseClient('projSelf');
    const viewerResume = mkSseClient('projResume');
    const clients = [viewerSelf, viewerResume];
    await callStreamChunk({ ...baseEntry, project: 'projSelf', _resumeProject: 'projResume', _chunkSeq: 4 }, clients);
    assert.ok(viewerSelf.writes.join('').includes('"project":"projSelf"'), 'self-reported project routes to its viewers');
    assert.equal(viewerResume.writes.join(''), '', 'the _resumeProject fallback must NOT win over entry.project');
  });

  it('entry.instance narrows the broadcast to the matching instance viewer only', async () => {
    const viewerI1 = mkSseClient('projA', 'ccv-i1');
    const viewerI2 = mkSseClient('projA', 'ccv-i2');
    const clients = [viewerI1, viewerI2];
    await callStreamChunk({ ...baseEntry, project: 'projA', instance: 'ccv-i1', _chunkSeq: 5 }, clients);
    assert.ok(viewerI1.writes.join('').includes('"instance":"ccv-i1"'), 'matching instance viewer receives the chunk');
    assert.equal(viewerI2.writes.join(''), '', 'a DIFFERENT instance viewer of the same project is excluded');
  });

  it('an UNSTAMPED-instance viewer of the same project still receives the instance frame (active/clear same set)', async () => {
    // P2-b fix: a project-level viewer (no _ccvViewInstance) of the source
    // project must receive an instance-stamped frame — excluding only clients
    // stamped with a DIFFERENT instance. This keeps the streaming_status/turn
    // active frame and its later clear on the SAME recipient set, so a project
    // viewer's spinner is never stranded by a parallel instance chip coming online.
    const viewerProjectLevel = mkSseClient('projA', undefined);
    const viewerOtherInst = mkSseClient('projA', 'ccv-i2');
    const clients = [viewerProjectLevel, viewerOtherInst];
    await callStreamChunk({ ...baseEntry, project: 'projA', instance: 'ccv-i1', _chunkSeq: 6 }, clients);
    assert.ok(viewerProjectLevel.writes.join('').includes('stream-progress'), 'project-level (unstamped-instance) viewer of the same project is kept');
    assert.equal(viewerOtherInst.writes.join(''), '', 'different-instance viewer is still excluded');
  });

  it('no stamp at all still falls back to the bound project (legacy regression guard)', async () => {
    const viewerBound = mkSseClient('boundProj');
    const viewerForeign = mkSseClient('projX');
    const clients = [viewerBound, viewerForeign];
    await callStreamChunk({ ...baseEntry, _chunkSeq: 7 }, clients);
    assert.ok(viewerBound.writes.join('').includes('"project":"boundProj"'), 'absent everything ⇒ bound project');
    assert.equal(viewerForeign.writes.join(''), '', 'foreign viewer excluded');
  });
});
