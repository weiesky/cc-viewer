/**
 * chat-queue-resume.test.js — unit tests for injectResumeCommand (server/lib/chat-queue.js),
 * the TRUE /resume inject path (2026-10-06).
 *
 * Conventions mirror chat-queue.test.js: node:test + assert/strict; env (CCV_LOG_DIR /
 * CLAUDE_CONFIG_DIR) pinned to a private mkdtemp BEFORE the dynamic import; fake injected
 * deps (no node-pty); mock.timers narrowed to setTimeout/setInterval and reset in finally.
 *
 * injectResumeCommand injects `/resume <uuid>` into an anchor-routed PTY via
 * writeToPtySequentialFor, only when the TUI is observably idle (or after a bounded idle
 * poll), and refuses busy instead of ever blind-injecting.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UUID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';

let tmpDir;
let cq;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-chat-queue-resume-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  cq = await import('../server/lib/chat-queue.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  cq.__resetForTests();
});

/**
 * Fake injected deps with the anchor-routed writer injectResumeCommand uses. captures.seq
 * records { chunks, anchor }; state holds the busy/idle probes.
 */
function makeDeps() {
  const captures = { seq: [] };
  const state = {
    streaming: false, pending: false, ptyKind: 'claude', external: false,
    seqOk: true, holdSeq: false, pendingComplete: null,
  };
  const deps = {
    writeToPty: () => {},
    writeToPtySequential: (chunks, onComplete) => { if (onComplete) onComplete(state.seqOk); },
    writeToPtySequentialFor: (chunks, onComplete, opts, anchor) => {
      captures.seq.push({ chunks, anchor });
      if (state.holdSeq) { state.pendingComplete = onComplete; return; }
      if (onComplete) onComplete(state.seqOk);
    },
    getPtyKind: () => state.ptyKind,
    isStreaming: () => state.streaming,
    hasPendingApproval: () => state.pending,
    hasExternalInjection: () => state.external,
    broadcastWs: () => {},
  };
  return { deps, captures, state };
}

describe('injectResumeCommand — payload + target routing', () => {
  it('injects the bracket-pasted `/resume <uuid>` into the anchored PTY when idle', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    const anchor = { project: 'proj-a', instanceKey: 'ccv-abc123' };
    const r = await cq.injectResumeCommand(UUID, anchor);
    assert.deepEqual(r, { ok: true });
    assert.equal(captures.seq.length, 1);
    assert.deepEqual(captures.seq[0].chunks, ['\x1b[200~/resume ' + UUID + '\x1b[201~', '\r']);
    assert.deepEqual(captures.seq[0].anchor, anchor, 'routes by the caller-supplied anchor');
  });

  it('rejects a non-UUID session id before anything is written', async () => {
    const { deps, captures } = makeDeps();
    cq.initChatQueue(deps);
    for (const bad of ['', 'not-a-uuid', '/resume; rm -rf', '12345', UUID.slice(1)]) {
      const r = await cq.injectResumeCommand(bad, {});
      assert.deepEqual(r, { ok: false, reason: 'bad-uuid' }, `bad uuid: ${JSON.stringify(bad)}`);
    }
    assert.equal(captures.seq.length, 0, 'nothing is pasted for a bad uuid');
  });

  it('resolves no-deps when initChatQueue never ran', async () => {
    const r = await cq.injectResumeCommand(UUID, {});
    assert.deepEqual(r, { ok: false, reason: 'no-deps' });
  });
});

describe('injectResumeCommand — busy / shared-slot discipline', () => {
  it('refuses busy while streaming (never blind-injects)', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, captures, state } = makeDeps();
      state.streaming = true; // turn in flight — stays busy past the poll budget
      cq.initChatQueue(deps);
      const p = cq.injectResumeCommand(UUID, {});
      mock.timers.tick(3000); // exceed INJECT_POLL_MAX_MS (2000)
      const r = await p;
      assert.deepEqual(r, { ok: false, reason: 'busy' });
      assert.equal(captures.seq.length, 0, 'no paste while busy');
    } finally {
      mock.timers.reset();
    }
  });

  it('waits out a brief busy window and injects once the TUI goes idle', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, captures, state } = makeDeps();
      state.streaming = true;
      cq.initChatQueue(deps);
      const p = cq.injectResumeCommand(UUID, {});
      mock.timers.tick(300);            // a few poll ticks while busy
      state.streaming = false;          // turn ends
      mock.timers.tick(300);            // next poll observes idle → inject
      const r = await p;
      assert.deepEqual(r, { ok: true });
      assert.equal(captures.seq.length, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('refuses busy when an inject slot is already owned (write in flight)', async () => {
    const { deps, captures, state } = makeDeps();
    cq.initChatQueue(deps);
    // Park the FIRST resume's write in flight (_injecting stays true) by holding its callback.
    state.holdSeq = true;
    const first = cq.injectResumeCommand(UUID, {});
    // While that inject owns the slot, a second resume must refuse busy (sendNow's guard:
    // `_injecting || _pollTimer`), never clobber the in-flight paste.
    const r2 = await cq.injectResumeCommand(UUID, {});
    assert.deepEqual(r2, { ok: false, reason: 'busy' });
    assert.equal(captures.seq.length, 1, 'only the first paste was attempted');
    // Complete the held write; the first inject resolves ok and the slot frees up.
    state.pendingComplete(true);
    const r1 = await first;
    assert.deepEqual(r1, { ok: true });
    // And the slot is genuinely free afterwards.
    state.holdSeq = false;
    const r3 = await cq.injectResumeCommand(UUID, {});
    assert.deepEqual(r3, { ok: true });
  });

  it('resets the inject slot even when the write throws', async () => {
    const { deps } = makeDeps();
    deps.writeToPtySequentialFor = () => { throw new Error('dead pty'); };
    cq.initChatQueue(deps);
    const r = await cq.injectResumeCommand(UUID, {});
    assert.deepEqual(r, { ok: false, reason: 'write-failed' });
    // A subsequent inject is not wedged by the prior throw.
    const r2 = await cq.injectResumeCommand(UUID, {});
    assert.deepEqual(r2, { ok: false, reason: 'write-failed' });
  });
});
