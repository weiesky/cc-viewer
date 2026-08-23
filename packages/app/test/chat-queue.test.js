/**
 * chat-queue.test.js — unit tests for server/lib/chat-queue.js (PTY-mode busy queue).
 *
 * Conventions (branch-lib-sdk-manager.test.js parity): node:test + assert/strict; env
 * (CCV_LOG_DIR/CLAUDE_CONFIG_DIR) pointed at a private mkdtemp BEFORE the dynamic import
 * (findcc.js resolves LOG_DIR at import time); fake deps injected — no node-pty; mock.timers
 * narrowed to setTimeout/setInterval and always reset in finally so no fake timer leaks
 * across cases.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let cq;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-chat-queue-'));
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
 * Fake injected deps. state.holdSeq=true captures writeToPtySequential's onComplete instead
 * of calling it (simulates an in-flight injection; complete via state.pendingComplete(ok)).
 */
function makeDeps() {
  const calls = { write: [], seq: [] };
  const broadcasts = [];
  const state = {
    streaming: false, pending: false, ptyKind: 'claude', external: false,
    seqOk: true, holdSeq: false, pendingComplete: null,
  };
  const deps = {
    writeToPty: (d) => calls.write.push(d),
    writeToPtySequential: (chunks, onComplete) => {
      calls.seq.push(chunks);
      if (state.holdSeq) { state.pendingComplete = onComplete; return; }
      if (onComplete) onComplete(state.seqOk);
    },
    getPtyKind: () => state.ptyKind,
    isStreaming: () => state.streaming,
    hasPendingApproval: () => state.pending,
    hasExternalInjection: () => state.external,
    broadcastWs: (msg) => broadcasts.push(msg),
  };
  return { deps, calls, state, broadcasts };
}

const pasteOf = (text) => ['\x1b[200~' + text + '\x1b[201~', '\r'];

describe('chat-queue: lifecycle guards', () => {
  it('no-ops safely before initChatQueue', () => {
    assert.equal(cq.enqueue('x'), null);
    assert.equal(cq.sendNow('q_nope'), false);
    assert.equal(cq.remove('q_nope'), false);
    cq.onTurnEnd(); // must not throw
    cq.clear();
    cq.stop();
  });
});

describe('chat-queue: enqueue', () => {
  it('sanitizes control bytes, assigns id, broadcasts snapshot', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true; // keep the rescue timer out of this case
    const item = cq.enqueue('hi\x1b[201~ there\r\n');
    assert.ok(item.id);
    assert.equal(item.text, 'hi there');
    assert.deepEqual(cq.getSnapshot().map((i) => i.id), [item.id]);
    const last = broadcasts.at(-1);
    assert.equal(last.type, 'queue-state');
    assert.equal(last.items.length, 1);
    assert.equal(last.items[0].text, 'hi there');
  });

  it('rejects empty-after-trim and over-cap messages, with a negative ack on full', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    assert.equal(cq.enqueue('  \x1b[200~  '), null);
    for (let i = 0; i < 50; i += 1) cq.enqueue('m' + i);
    assert.equal(cq.getSnapshot().length, 50);
    assert.equal(cq.enqueue('one too many'), null);
    assert.equal(cq.getSnapshot().length, 50);
    const states = broadcasts.filter((b) => b.type === 'queue-state');
    assert.equal(states.length, 50, 'one queue-state per accepted enqueue');
    const last = broadcasts.at(-1);
    assert.equal(last.type, 'queue-rejected', 'a full queue must negatively ack (composer was already cleared)');
    assert.equal(last.reason, 'full');
  });
});

describe('chat-queue: turn-end drain gating', () => {
  it('waits for streaming to stop, then injects the head as bracket paste', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('follow up');
      cq.onTurnEnd();
      mock.timers.tick(200);
      assert.equal(calls.seq.length, 0); // still streaming
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(calls.seq[0], pasteOf('follow up'));
      assert.equal(cq.getSnapshot().length, 0);
    } finally { mock.timers.reset(); }
  });

  it('defers while an approval modal is pending', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('queued');
      state.streaming = false;
      state.pending = true;
      cq.onTurnEnd();
      mock.timers.tick(500);
      assert.equal(calls.seq.length, 0);
      state.pending = false;
      mock.timers.tick(100);
      assert.equal(calls.seq.length, 1);
    } finally { mock.timers.reset(); }
  });

  it('never injects into a non-claude PTY, even after poll timeout', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.ptyKind = 'shell'; // claude exited; bare shell behind
      state.streaming = true;
      cq.enqueue('do not run');
      cq.onTurnEnd();
      mock.timers.tick(5000); // way past the 2s poll cap
      assert.equal(calls.seq.length, 0);
      assert.equal(cq.getSnapshot().length, 1); // still parked, not lost
    } finally { mock.timers.reset(); }
  });

  it('defers while an external (IM) injection holds the PTY', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('queued');
      state.streaming = false;
      state.external = true;
      cq.onTurnEnd();
      mock.timers.tick(300);
      assert.equal(calls.seq.length, 0);
      state.external = false;
      mock.timers.tick(100);
      assert.equal(calls.seq.length, 1);
    } finally { mock.timers.reset(); }
  });

  it('does not clobber a pending send-now poll', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('one');
      cq.enqueue('two');
      cq.sendNow(a.id);
      mock.timers.tick(50); // ESC sent; send-now poll pending
      cq.onTurnEnd();       // must return early instead of clearing that poll
      state.streaming = false;
      mock.timers.tick(100);
      assert.equal(calls.seq.length, 1);
      assert.deepEqual(calls.seq[0], pasteOf('one')); // the send-now item, not a head drain
      assert.deepEqual(cq.getSnapshot().map((i) => i.text), ['two']);
    } finally { mock.timers.reset(); }
  });
});

describe('chat-queue: sendNow', () => {
  it('busy path: focus-in → ESC → idle poll → inject; item leaves the snapshot immediately', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('first');
      const b = cq.enqueue('second');
      assert.equal(cq.sendNow(b.id), true);
      assert.deepEqual(cq.getSnapshot().map((i) => i.id), [a.id]);
      assert.deepEqual(calls.write, ['\x1b[I']);
      mock.timers.tick(50);
      assert.deepEqual(calls.write, ['\x1b[I', '\x1b']);
      mock.timers.tick(200);
      assert.equal(calls.seq.length, 0); // turn not observably over yet
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(calls.seq[0], pasteOf('second'));
    } finally { mock.timers.reset(); }
  });

  it('idle path injects immediately without ESC bytes', () => {
    const { deps, calls, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true; // suppress the rescue timer arming on enqueue
    const a = cq.enqueue('parked');
    state.streaming = false;
    assert.equal(cq.sendNow(a.id), true);
    assert.deepEqual(calls.write, []);
    assert.deepEqual(calls.seq[0], pasteOf('parked'));
    assert.equal(cq.getSnapshot().length, 0);
  });

  it('refuses while another injection is in flight, leaving the queue untouched', () => {
    const { deps, calls, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('aaa');
    const b = cq.enqueue('bbb');
    state.streaming = false;
    state.holdSeq = true; // first inject never completes → _injecting stays true
    assert.equal(cq.sendNow(a.id), true);
    assert.equal(calls.seq.length, 1);
    assert.equal(cq.sendNow(b.id), false);
    assert.deepEqual(cq.getSnapshot().map((i) => i.id), [b.id]);
    state.pendingComplete(true); // first inject finishes
    state.holdSeq = false;
    assert.equal(cq.sendNow(b.id), true);
    assert.equal(calls.seq.length, 2);
  });

  it('returns false for an unknown id without any side effect', () => {
    const { deps, calls, broadcasts, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    cq.enqueue('x');
    const before = broadcasts.length;
    assert.equal(cq.sendNow('q_unknown'), false);
    assert.equal(calls.write.length, 0);
    assert.equal(broadcasts.length, before);
  });

  it('poll timeout restores the item to the head instead of blind-injecting', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true; // never stops within the poll window
      const a = cq.enqueue('stuck');
      assert.equal(cq.sendNow(a.id), true);
      assert.equal(cq.getSnapshot().length, 0); // removed optimistically
      mock.timers.tick(50);
      mock.timers.tick(2500); // past the 2s poll cap
      assert.equal(calls.seq.length, 0);
      assert.deepEqual(cq.getSnapshot().map((i) => i.id), [a.id]); // parked back
    } finally { mock.timers.reset(); }
  });

  it('requeues the head when the PTY write reports failure', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('oops');
    state.streaming = false;
    state.seqOk = false;
    assert.equal(cq.sendNow(a.id), true);
    assert.deepEqual(cq.getSnapshot().map((i) => i.id), [a.id]);
    assert.equal(broadcasts.at(-1).items.length, 1);
  });

  it('refuses a second send-now while the first is still polling (P0 regression: poll clobber lost the message)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('A');
      const b = cq.enqueue('B');
      assert.equal(cq.sendNow(a.id), true);
      mock.timers.tick(50); // ESC sent; A's idle poll now pending
      assert.equal(cq.sendNow(b.id), false, 'second send-now must be refused, not clobber the pending poll');
      assert.deepEqual(cq.getSnapshot().map((i) => i.id), [b.id], 'B stays queued and actionable');
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(calls.seq[0], pasteOf('A'), 'A still injects via its own poll');
    } finally { mock.timers.reset(); }
  });

  it('clear() mid-inject invalidates the completion so a stale failure cannot re-park', () => {
    const { deps, calls, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('one');
    state.streaming = false;
    state.holdSeq = true; // completion held → injection in flight
    assert.equal(cq.sendNow(a.id), true);
    assert.equal(calls.seq.length, 1);
    cq.clear(); // session switch mid-flight
    assert.equal(cq.getSnapshot().length, 0);
    state.pendingComplete(false); // write fails AFTER the clear
    assert.equal(cq.getSnapshot().length, 0, 'stale failure must not re-park into the cleared queue');
    assert.equal(cq.sendNow(a.id), false, 'the stale id is gone for good');
  });

  it('clear() cancels a send-now pending ESC before it lands', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('x');
      assert.equal(cq.sendNow(a.id), true);
      cq.clear();
      mock.timers.tick(200);
      assert.deepEqual(calls.write, ['\x1b[I'], 'focus-in went out but the ESC was cancelled');
      assert.equal(calls.seq.length, 0);
    } finally { mock.timers.reset(); }
  });
});

describe('chat-queue: remove / clear / suppress', () => {
  it('remove and clear broadcast the resulting snapshots', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('x');
    const b = cq.enqueue('y');
    assert.equal(cq.remove(a.id), true);
    assert.deepEqual(cq.getSnapshot().map((i) => i.id), [b.id]);
    assert.equal(cq.remove('q_nope'), false);
    cq.clear();
    assert.equal(cq.getSnapshot().length, 0);
    assert.equal(broadcasts.at(-1).items.length, 0);
  });

  it('suppressNextDrain parks the queue; a new turn (streaming edge) re-arms it', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('parked');
      cq.suppressNextDrain();
      state.streaming = false;
      cq.onTurnEnd();
      mock.timers.tick(300);
      assert.equal(calls.seq.length, 0);
      assert.equal(cq.getSnapshot().length, 1);
      cq.onStreamingActivated();
      cq.onTurnEnd();
      assert.equal(calls.seq.length, 1);
      assert.equal(cq.getSnapshot().length, 0);
    } finally { mock.timers.reset(); }
  });
});

describe('chat-queue: stale-busy rescue', () => {
  it('injects after the rescue delay when the turn already ended before enqueue', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = false; // frontend guessed busy; server sees an idle TUI
      cq.enqueue('late');
      assert.equal(calls.seq.length, 0);
      mock.timers.tick(3000);
      assert.equal(calls.seq.length, 1);
      assert.equal(cq.getSnapshot().length, 0);
    } finally { mock.timers.reset(); }
  });

  it('rescue respects a suppress that arrived before it fired', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = false;
      cq.enqueue('late');
      cq.suppressNextDrain();
      mock.timers.tick(5000);
      assert.equal(calls.seq.length, 0);
      assert.equal(cq.getSnapshot().length, 1);
    } finally { mock.timers.reset(); }
  });
});
