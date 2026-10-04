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
function mkSseClient(viewProject) {
  const writes = [];
  return {
    _ccvViewProject: viewProject,
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
});
