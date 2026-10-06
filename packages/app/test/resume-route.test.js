/**
 * /resume routes (server/routes/resume.js).
 *
 * Covers: GET /api/resume-sessions (current-project scope, shape, limit,
 * currentSessionUuid) and GET /api/live-processes (main-PTY-only listing, exited
 * exclusion). Fixture pattern mirrors session-pin.test.js (captured res, isolated
 * CCV_LOG_DIR).
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR before importing anything that loads findcc/interceptor.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-resume-route-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { resumeRoutes } = await import('../server/routes/resume.js');
const { initForWorkspace } = await import('../server/interceptor.js');

// Bind a live project so _projectName is non-empty (the list is scoped to it).
initForWorkspace(join(tmpDir, 'currentProj'), { forceNew: true });

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const getSessions = resumeRoutes.find((r) => r.method === 'GET' && r.path === '/api/resume-sessions').handler;

const UUID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';

async function callGet(query = {}) {
  let payload = '';
  const res = { writeHead() {}, end(b) { payload = b || ''; } };
  // The dispatcher passes a real URL object (server.js handleRequest) — mirror it
  // so the handler's searchParams access is exercised truthfully.
  const qs = new URLSearchParams(query).toString();
  const parsedUrl = new URL('/api/resume-sessions' + (qs ? `?${qs}` : ''), 'http://localhost');
  await getSessions({}, res, parsedUrl, false, { MAX_POST_BODY: 1 << 20 });
  return JSON.parse(payload || '{}');
}

describe('GET /api/resume-sessions', () => {
  it('returns an items array + total on an empty store', async () => {
    const out = await callGet({});
    assert.ok(Array.isArray(out.items));
    assert.equal(typeof out.total, 'number');
  });

  it('respects a valid limit and clamps absurd values', async () => {
    // No data seeded; we only assert the handler does not throw and honors the
    // query parse path (limit>50 clamps to 50, non-numeric → 10).
    const a = await callGet({ limit: '5' });
    const b = await callGet({ limit: '99999' });
    const c = await callGet({ limit: 'abc' });
    for (const out of [a, b, c]) assert.ok(Array.isArray(out.items));
  });

  it('lists only the bound project and carries a top-level currentSessionUuid', async () => {
    // Seed one ccv session in the BOUND project (currentProj) so a row exists.
    const { V2Writer } = await import('../server/lib/v2/v2-writer.js');
    const { _resetForTest } = await import('../server/lib/v2/session-list.js');
    _resetForTest(); // summarizeSessionPage caches rows; fresh seed needs a fresh cache
    const w = new V2Writer({ logDir: tmpDir, project: 'currentProj', enabled: true, minFreeBytes: 0 });
    const entry = {
      timestamp: new Date().toISOString(),
      project: 'currentProj',
      // mainAgent marks the request as kind='main' (classifyKind) — without it
      // the row is discard-filtered from the list.
      mainAgent: true,
      url: 'https://api.anthropic.com/v1/messages?beta=true',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        model: 'claude-fable-5',
        system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
        tools: [{ name: 'Edit', input_schema: {} }],
        metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: UUID }) },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi there' }] }],
      },
      response: null,
    };
    const h = w.ingestRequest(entry, entry.body.messages);
    w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    await w.close();

    const out = await callGet({ limit: '10' });
    const row = out.items.find(i => i.sessionUuid === UUID);
    assert.ok(row, 'seeded session in the bound project must appear in the list');
    assert.equal(row.project, 'currentProj', 'rows are scoped to the bound project');
    // The response must expose the ONE live session uuid (string|null) at the top
    // level so the client marks exactly one row "current".
    assert.ok('currentSessionUuid' in out, 'response must carry currentSessionUuid');
    assert.ok(out.currentSessionUuid === null || typeof out.currentSessionUuid === 'string');
  });
});

describe('GET /api/live-processes', () => {
  const getLive = resumeRoutes.find((r) => r.method === 'GET' && r.path === '/api/live-processes').handler;

  async function callLive() {
    let payload = '';
    const res = { writeHead() {}, end(b) { payload = b || ''; } };
    const parsedUrl = new URL('/api/live-processes', 'http://localhost');
    await getLive({}, res, parsedUrl, false, { MAX_POST_BODY: 1 << 20 });
    return JSON.parse(payload || '{}');
  }

  it('lists live main PTYs (kind=main) + currentProject', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    const mainDir = join(tmpDir, 'liveMainProj');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(mainDir, { recursive: true });

    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 31313 }) }));
    const prevProxy = process.env.CCV_PROXY_PORT;
    process.env.CCV_PROXY_PORT = process.env.CCV_PROXY_PORT || '9999';
    try {
      await ptyMgr.spawnClaude(9999, mainDir, [], 'claude');
      const out = await callLive();
      assert.ok(Array.isArray(out.processes), 'processes must be an array');
      assert.ok('currentProject' in out, 'must carry currentProject');
      const mainRow = out.processes.find(p => p.kind === 'main' && p.cwd === mainDir);
      assert.ok(mainRow, 'live main PTY must be listed');
      assert.equal(mainRow.project, projectKeyForCwd(mainDir));
      assert.equal(mainRow.active, true, 'the spawned main PTY is the active one');
    } finally {
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
      if (prevProxy === undefined) delete process.env.CCV_PROXY_PORT; else process.env.CCV_PROXY_PORT = prevProxy;
    }
  });

  it('excludes exited processes (only live ones are listed)', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    ptyMgr._resetForTests();
    const out = await callLive();
    assert.ok(Array.isArray(out.processes));
    assert.equal(out.processes.filter(p => p.kind === 'main').length, 0, 'no live main PTY → none listed');
  });
});

describe('POST /api/live-processes/attach', () => {
  const attachRoute = resumeRoutes.find((r) => r.method === 'POST' && r.path === '/api/live-processes/attach').handler;

  function callAttach(bodyObj) {
    return new Promise((resolve) => {
      let payload = '';
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; } };
      const listeners = {};
      const req = {
        on(ev, cb) { listeners[ev] = cb; },
        destroy() {},
      };
      const parsedUrl = new URL('/api/live-processes/attach', 'http://localhost');
      // The handler's `end` listener is async (await import + attach) — resolve
      // when the response actually ends, not on a fixed microtask guess.
      const origEnd = res.end;
      res.end = (b) => { origEnd(b); resolve({ status, body: JSON.parse(payload || '{}') }); };
      attachRoute(req, res, parsedUrl, false, { MAX_POST_BODY: 1 << 20 });
      listeners.data && listeners.data(JSON.stringify(bodyObj ?? {}));
      listeners.end && listeners.end();
    });
  }

  it('attaches to a live project (switches active), idempotent on repeat', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    const { mkdirSync } = await import('node:fs');
    const dirA = join(tmpDir, 'attachA');
    const dirB = join(tmpDir, 'attachB');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    let pid = 40000;
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: pid++ }) }));
    try {
      await ptyMgr.spawnClaude(9999, dirA, [], 'claude');
      await ptyMgr.spawnClaude(9999, dirB, [], 'claude'); // active = B
      const projA = projectKeyForCwd(dirA);
      const r1 = await callAttach({ project: projA });
      assert.equal(r1.status, 200);
      assert.equal(r1.body.ok, true);
      assert.equal(r1.body.running, true);
      assert.equal(r1.body.switched, true, 'first attach switches off the last-spawned project');
      // After attach, no-arg exports target A.
      assert.equal(ptyMgr.getCurrentWorkspace().cwd, dirA);
      const r2 = await callAttach({ project: projA });
      assert.equal(r2.status, 200);
      assert.equal(r2.body.switched, false, 'repeat attach is a no-op switch');
    } finally {
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });

  it('returns 404 for an unknown project and leaves the active PTY untouched', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { mkdirSync } = await import('node:fs');
    const dirA = join(tmpDir, 'attachC');
    mkdirSync(dirA, { recursive: true });
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 41000 }) }));
    try {
      await ptyMgr.spawnClaude(9999, dirA, [], 'claude');
      const before = ptyMgr.getCurrentWorkspace().cwd;
      const r = await callAttach({ project: 'no-such-project' });
      assert.equal(r.status, 404);
      assert.equal(r.body.ok, false);
      assert.equal(ptyMgr.getCurrentWorkspace().cwd, before, 'failed attach must not move the attachment');
    } finally {
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });

  it('400 on missing project field', async () => {
    const r = await callAttach({});
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });
});

describe('POST /api/resume-session', () => {
  const resumeRoute = resumeRoutes.find((r) => r.method === 'POST' && r.path === '/api/resume-session').handler;
  const RESUME_UUID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';

  function callResume(bodyObj, { origin } = {}) {
    return new Promise((resolve) => {
      let payload = '';
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; } };
      const listeners = {};
      const headers = {};
      if (origin) headers.origin = origin;
      const req = {
        headers,
        on(ev, cb) { listeners[ev] = cb; },
        destroy() {},
      };
      const parsedUrl = new URL('/api/resume-session', 'http://localhost');
      const origEnd = res.end;
      res.end = (b) => { origEnd(b); resolve({ status, body: JSON.parse(payload || '{}') }); };
      // isLocal=true → admin; no Origin header → same-origin passes.
      resumeRoute(req, res, parsedUrl, true, { MAX_POST_BODY: 1 << 20 });
      if (listeners.data) listeners.data(JSON.stringify(bodyObj ?? {}));
      if (listeners.end) listeners.end();
    });
  }

  async function spawnClaudeAt(dir) {
    const ptyMgr = await import('../server/pty-manager.js');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    await ptyMgr.spawnClaude(9999, dir, [], 'claude');
  }

  it('403 when not admin / cross-origin', async () => {
    // Not admin: isLocal=false and no ccvIsAdmin flag → forbidden before any inject.
    const r = await new Promise((resolve) => {
      let payload = ''; let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); } };
      resumeRoute({ headers: {}, on() {}, destroy() {} }, res, new URL('/api/resume-session', 'http://localhost'), false, { MAX_POST_BODY: 1 << 20 });
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'forbidden');
  });

  it('400 on missing sessionUuid', async () => {
    const r = await callResume({});
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, 'missing-session');
  });

  it('400 on a non-UUID session id (never reaches the paste buffer)', async () => {
    const r = await callResume({ sessionUuid: 'abc; echo hi' });
    assert.equal(r.status, 400);
    assert.equal(r.body.reason, 'bad-uuid');
  });

  it('404 when the target is not a live claude PTY (and never falls back to active)', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 50000 }) }));
    try {
      await spawnClaudeAt(join(tmpDir, 'resumeBoundProj'));
      // An unknown project must NOT resolve to the active PTY (strict gate).
      const r = await callResume({ sessionUuid: RESUME_UUID, project: 'no-such-proj' });
      assert.equal(r.status, 404);
      assert.equal(r.body.reason, 'not-found');
    } finally {
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });

  it('200 injects /resume <uuid> into the live claude PTY (busy probes stubbed idle)', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    const cq = await import('../server/lib/chat-queue.js');
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 50001 }) }));
    const writes = [];
    cq.__resetForTests();
    cq.initChatQueue({
      writeToPty: () => {},
      writeToPtySequential: (c, cb) => cb && cb(true),
      writeToPtySequentialFor: (chunks, cb, opts, anchor) => { writes.push({ chunks, anchor }); cb && cb(true); },
      getPtyKind: () => 'claude',
      isStreaming: () => false,
      hasPendingApproval: () => false,
      hasExternalInjection: () => false,
      broadcastWs: () => {},
    });
    try {
      const dir = join(tmpDir, 'resumeOkProj');
      await spawnClaudeAt(dir);
      const proj = projectKeyForCwd(dir);
      const r = await callResume({ sessionUuid: RESUME_UUID, project: proj });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].chunks, ['\x1b[200~/resume ' + RESUME_UUID + '\x1b[201~', '\r']);
      assert.equal(writes[0].anchor.project, proj);
    } finally {
      cq.__resetForTests();
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });

  it('409 ambiguous when a project-only resume matches 2+ live same-basename instances', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    const cq = await import('../server/lib/chat-queue.js');
    ptyMgr._resetForTests();
    let pid = 70000;
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: pid++ }) }));
    cq.__resetForTests();
    cq.initChatQueue({
      writeToPty: () => {},
      writeToPtySequential: (c, cb) => cb && cb(true),
      writeToPtySequentialFor: (chunks, cb) => cb && cb(true),
      getPtyKind: () => 'claude',
      isStreaming: () => false,
      hasPendingApproval: () => false,
      hasExternalInjection: () => false,
      broadcastWs: () => {},
    });
    try {
      const dir = join(tmpDir, 'resumeAmbigProj');
      await spawnClaudeAt(dir);
      await spawnClaudeAt(dir); // second live instance, same cwd → same basename project
      const r = await callResume({ sessionUuid: RESUME_UUID, project: projectKeyForCwd(dir) });
      assert.equal(r.status, 409);
      assert.equal(r.body.reason, 'ambiguous');
      assert.ok(Array.isArray(r.body.candidates) && r.body.candidates.length === 2, 'returns both live candidates for disambiguation');
    } finally {
      cq.__resetForTests();
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });

  it('409 busy when the TUI is streaming (never blind-injects)', async () => {
    const ptyMgr = await import('../server/pty-manager.js');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    const cq = await import('../server/lib/chat-queue.js');
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 50002 }) }));
    cq.__resetForTests();
    cq.initChatQueue({
      writeToPty: () => {},
      writeToPtySequential: (c, cb) => cb && cb(true),
      writeToPtySequentialFor: (chunks, cb) => cb && cb(true),
      getPtyKind: () => 'claude',
      isStreaming: () => true,            // stays busy past the 2s poll budget
      hasPendingApproval: () => false,
      hasExternalInjection: () => false,
      broadcastWs: () => {},
    });
    try {
      const dir = join(tmpDir, 'resumeBusyProj');
      await spawnClaudeAt(dir);
      const r = await callResume({ sessionUuid: RESUME_UUID, project: projectKeyForCwd(dir) });
      assert.equal(r.status, 409);
      assert.equal(r.body.reason, 'busy');
    } finally {
      cq.__resetForTests();
      ptyMgr._resetForTests();
      ptyMgr._setPtyImportForTests(null);
    }
  });
});
