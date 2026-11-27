/**
 * chat-queue-inject-command.test.js — unit tests for injectCommand (server/lib/chat-queue.js),
 * the /compact context-compaction inject path (2026-11).
 *
 * Conventions mirror chat-queue-resume.test.js: node:test + assert/strict; CCV_LOG_DIR /
 * CLAUDE_CONFIG_DIR pinned to a private mkdtemp BEFORE the dynamic import; fake injected deps
 * (no node-pty); mock.timers narrowed to setTimeout/setInterval, reset in finally.
 *
 * injectCommand is STRICTER than injectResumeCommand: strict:true is always passed (a dead /
 * unresolved anchor must fail rather than fall back to the active PTY), the target is
 * liveness-probed up front, a non-empty FIFO returns busy, and the busy probe is target-scoped
 * (isStreamingFor/isTurnActiveFor), not the globally-bound streaming flag.
 */
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let cq;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-chat-queue-compact-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  cq = await import('../server/lib/chat-queue.js');
});

after(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });
beforeEach(() => { cq.__resetForTests(); });

const ANCHOR = { project: 'proj', instanceKey: 'ccv-abc123' };

/**
 * Fake deps with the target-scoped probes injectCommand prefers. captures.seq records
 * { chunks, anchor, opts } so the test can assert strict:true routing + bracket-paste shape.
 */
function makeDeps() {
  const captures = { seq: [] };
  const state = {
    streaming: false, turnActive: false, ptyKind: 'claude', pending: false, external: false,
    live: true, queueLen: 0, seqOk: true, holdSeq: false, pendingComplete: null,
  };
  const deps = {
    writeToPty: () => {},
    writeToPtySequential: (c, cb) => { if (cb) cb(state.seqOk); },
    writeToPtySequentialFor: (chunks, onComplete, opts, anchor) => {
      captures.seq.push({ chunks, anchor, opts });
      if (state.holdSeq) { state.pendingComplete = onComplete; return; }
      if (onComplete) onComplete(state.seqOk);
    },
    getPtyKind: () => state.ptyKind,
    isStreaming: () => state.streaming,
    isStreamingFor: (anchor) => state.streaming,
    isTurnActiveFor: (anchor) => state.turnActive,
    getPtyKindFor: (anchor) => state.ptyKind,
    hasLivePtyFor: (anchor) => state.live,
    getQueueSnapshot: (anchor) => Array.from({ length: state.queueLen }, (_, i) => ({ id: 'q' + i, text: 'm' + i, status: 'queued' })),
    hasPendingApproval: () => state.pending,
    hasExternalInjection: () => state.external,
    broadcastWs: () => {},
  };
  return { deps, captures, state };
}

describe('injectCommand — payload + strict routing', () => {
  it('writes bracket-pasted /compact <script> to the anchored PTY when idle, with strict:true', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    const r = await cq.injectCommand('/compact keep decisions', ANCHOR);
    assert.deepEqual(r, { ok: true });
    assert.equal(captures.seq.length, 1);
    assert.deepEqual(captures.seq[0].chunks, ['\x1b[200~/compact keep decisions\x1b[201~', '\r']);
    assert.equal(captures.seq[0].anchor.project, 'proj');
    assert.equal(captures.seq[0].opts.strict, true);
  });

  it('the caller guarantees the script already starts with /compact; here only the /compact prefix is validated', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    const r = await cq.injectCommand('/compact', ANCHOR);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(captures.seq[0].chunks, ['\x1b[200~/compact\x1b[201~', '\r']);
  });
});

describe('injectCommand — validation', () => {
  it('empty text / non-/compact / overlong → bad-text', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    for (const bad of ['', '   ', 'hello', '/clear', 'x'.repeat(20001)]) {
      const r = await cq.injectCommand(bad, ANCHOR);
      assert.deepEqual(r, { ok: false, reason: 'bad-text' }, `expect bad-text for ${JSON.stringify(String(bad).slice(0, 20))}`);
    }
    assert.equal(captures.seq.length, 0);
  });

  it('no anchor → no-anchor', async () => {
    const { deps } = makeDeps();
    cq.initChatQueue(deps);
    assert.deepEqual(await cq.injectCommand('/compact x', {}), { ok: false, reason: 'no-anchor' });
    assert.deepEqual(await cq.injectCommand('/compact x', null), { ok: false, reason: 'no-anchor' });
  });

  it('a forged bracket-paste end (\\x1b[201~) is stripped by sanitizeInbound', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    const r = await cq.injectCommand('/compact good\x1b[201~\x1b[200~/evil', ANCHOR);
    assert.deepEqual(r, { ok: true });
    // control bytes stripped, no second paste frame is formed
    assert.equal(captures.seq[0].chunks[0].includes('\x1b[201~/evil'), false);
  });
});

describe('injectCommand — liveness + queue fairness', () => {
  it('dead target → target-gone, no polling', async () => {
    const { deps, state, captures } = makeDeps();
    state.live = false;
    cq.initChatQueue(deps);
    assert.deepEqual(await cq.injectCommand('/compact x', ANCHOR), { ok: false, reason: 'target-gone' });
    assert.equal(captures.seq.length, 0);
  });

  it('target FIFO non-empty → busy (compaction does not jump queued user messages)', async () => {
    const { deps, state, captures } = makeDeps();
    state.queueLen = 2;
    cq.initChatQueue(deps);
    assert.deepEqual(await cq.injectCommand('/compact x', ANCHOR), { ok: false, reason: 'busy' });
    assert.equal(captures.seq.length, 0);
  });
});

describe('injectCommand — target-scoped busy probe', () => {
  it('target scope turnActive → busy (turn-level truth covers streaming gaps)', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state, captures } = makeDeps();
      state.turnActive = true; // target is running
      cq.initChatQueue(deps);
      const p = cq.injectCommand('/compact x', ANCHOR);
      mock.timers.tick(3000); // beyond INJECT_POLL_MAX_MS
      const r = await p;
      assert.deepEqual(r, { ok: false, reason: 'busy' });
      assert.equal(captures.seq.length, 0);
    } finally { mock.timers.reset(); }
  });

  it('target scope streaming → busy, never a blind write', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state, captures } = makeDeps();
      state.streaming = true;
      cq.initChatQueue(deps);
      const p = cq.injectCommand('/compact x', ANCHOR);
      mock.timers.tick(3000);
      const r = await p;
      assert.deepEqual(r, { ok: false, reason: 'busy' });
      assert.equal(captures.seq.length, 0);
    } finally { mock.timers.reset(); }
  });

  it('brief busy then idle → inject once', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state, captures } = makeDeps();
      state.turnActive = true;
      cq.initChatQueue(deps);
      const p = cq.injectCommand('/compact x', ANCHOR);
      mock.timers.tick(300);
      state.turnActive = false; // turn ended
      mock.timers.tick(300);
      const r = await p;
      assert.deepEqual(r, { ok: true });
      assert.equal(captures.seq.length, 1);
    } finally { mock.timers.reset(); }
  });

  it('non-claude TUI target → no injection', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state, captures } = makeDeps();
      state.ptyKind = 'bash';
      cq.initChatQueue(deps);
      const p = cq.injectCommand('/compact x', ANCHOR);
      mock.timers.tick(3000);
      const r = await p;
      assert.deepEqual(r, { ok: false, reason: 'busy' });
      assert.equal(captures.seq.length, 0);
    } finally { mock.timers.reset(); }
  });
});

describe('injectCommand — single-flight slot + write failure', () => {
  it('single-flight slot occupied (dispatch/inject in flight) → busy', async () => {
    const { deps, state, captures } = makeDeps();
    cq.initChatQueue(deps);
    state.holdSeq = true; // first write hangs, _injecting holds the slot
    const first = cq.injectCommand('/compact first', ANCHOR);
    const r2 = await cq.injectCommand('/compact second', ANCHOR);
    assert.deepEqual(r2, { ok: false, reason: 'busy' });
    assert.equal(captures.seq.length, 1);
    state.pendingComplete(true);
    assert.deepEqual(await first, { ok: true });
  });

  it('write throws → write-failed, slot resets without wedging', async () => {
    const { deps } = makeDeps();
    deps.writeToPtySequentialFor = () => { throw new Error('dead pty'); };
    cq.initChatQueue(deps);
    assert.deepEqual(await cq.injectCommand('/compact x', ANCHOR), { ok: false, reason: 'write-failed' });
    assert.deepEqual(await cq.injectCommand('/compact x', ANCHOR), { ok: false, reason: 'write-failed' });
  });

  it('no-deps (initChatQueue not called) → no-deps', async () => {
    assert.deepEqual(await cq.injectCommand('/compact x', ANCHOR), { ok: false, reason: 'no-deps' });
  });
});
