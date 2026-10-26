/**
 * chat-queue.test.js — unit tests for server/lib/chat-queue.js (PTY-mode busy queue).
 *
 * Conventions (branch-lib-sdk-manager.test.js parity): node:test + assert/strict; env
 * (CCV_LOG_DIR/CLAUDE_CONFIG_DIR) pointed at a private mkdtemp BEFORE the dynamic import
 * (findcc.js resolves LOG_DIR at import time); fake deps injected — no node-pty; mock.timers
 * narrowed to setTimeout/setInterval and always reset in finally so no fake timer leaks
 * across cases.
 *
 * Status contract under test: queued → dispatching (single dispatch slot) → removed on
 * success / restored at the original FIFO position on failure. Snapshots carry status +
 * sanitized anchor; broadcasts carry the triggering item's scope.
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
 * broadcastArgs mirrors broadcasts but keeps the optional trigger item (per-view scope).
 */
function makeDeps() {
  const calls = { write: [], seq: [] };
  const broadcasts = [];
  const broadcastArgs = [];
  const state = {
    streaming: false, pending: false, ptyKind: 'claude', external: false,
    seqOk: true, holdSeq: false, pendingComplete: null,
  };
  const deps = {
    writeToPty: (d) => calls.write.push(d),
    writeToPtyFor: (d, anchor) => { calls.write.push(d); return true; },
    writeToPtySequential: (chunks, onComplete) => {
      calls.seq.push(chunks);
      if (state.holdSeq) { state.pendingComplete = onComplete; return; }
      if (onComplete) onComplete(state.seqOk);
    },
    getPtyKind: () => state.ptyKind,
    isStreaming: () => state.streaming,
    hasPendingApproval: () => state.pending,
    hasExternalInjection: () => state.external,
    broadcastWs: (msg, item) => { broadcasts.push(msg); broadcastArgs.push({ msg, item }); },
  };
  return { deps, calls, state, broadcasts, broadcastArgs };
}

const pasteOf = (text) => ['\x1b[200~' + text + '\x1b[201~', '\r'];

const A = { project: 'proj-a', sessionId: 'sess-a', instanceKey: 'inst-a' };
const B = { project: 'proj-b', sessionId: 'sess-b', instanceKey: 'inst-b' };
const PUBLIC_A = { project: 'proj-a', sessionId: 'sess-a', instanceKey: 'inst-a' };
const PUBLIC_B = { project: 'proj-b', sessionId: 'sess-b', instanceKey: 'inst-b' };

const ids = (snap) => snap.map((i) => i.id);
const statuses = (snap) => snap.map((i) => i.status);

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
    const { deps, state, broadcasts, broadcastArgs } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true; // keep the rescue timer out of this case
    const item = cq.enqueue('hi\x1b[201~ there\r\n');
    assert.ok(item.id);
    assert.equal(item.text, 'hi there');
    const snap = cq.getSnapshot();
    assert.deepEqual(ids(snap), [item.id]);
    assert.equal(snap[0].status, 'queued');
    assert.equal(snap[0].anchor, null);
    const last = broadcasts.at(-1);
    assert.equal(last.type, 'queue-state');
    assert.equal(last.items.length, 1);
    assert.equal(last.items[0].text, 'hi there');
    assert.equal(last.items[0].status, 'queued');
    assert.equal(last.scope, undefined, 'unscoped enqueue adds no scope');
    assert.equal(broadcastArgs.at(-1).item.id, item.id, 'trigger item is passed to broadcastWs');
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

  it('scopes the full-queue negative ack to the rejected anchor', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    for (let i = 0; i < 50; i += 1) cq.enqueue('m' + i, A);
    assert.equal(cq.enqueue('rejected', { project: B.project, instanceKey: B.instanceKey }), null);
    assert.deepEqual(broadcasts.at(-1).scope, { project: B.project, instanceKey: B.instanceKey });
  });
});

describe('chat-queue: dispatch slot / status', () => {
  it('sendNow marks the item dispatching before ESC and keeps it visible through poll + write', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state, broadcasts } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('one', A);
      const b = cq.enqueue('two', B);

      assert.equal(cq.sendNow(b.id), true);
      // Item left the queued FIFO and entered the single dispatch slot BEFORE the ESC timer.
      let snap = cq.getSnapshot();
      assert.deepEqual(ids(snap), [a.id, b.id], 'dispatch item keeps its original FIFO position');
      assert.deepEqual(statuses(snap), ['queued', 'dispatching']);
      assert.deepEqual(calls.write, ['\x1b[I'], 'focus-in only; ESC waits for the delay');

      // Replayable per-view snapshots: the dispatch slot is included where it matches.
      assert.deepEqual(ids(cq.getSnapshot(A)), [a.id]);
      assert.deepEqual(statuses(cq.getSnapshot(B)), ['dispatching']);
      assert.deepEqual(cq.getSnapshot({ project: A.project, instanceKey: B.instanceKey }), []);

      // Double click + remove during the ESC delay: rejected, and the snapshot is rebroadcast.
      const beforeRejects = broadcasts.length;
      assert.equal(cq.sendNow(b.id, B), false, 'second send-now on the dispatching item is rejected');
      assert.equal(cq.remove(b.id, B), false, 'remove on the dispatching item is rejected');
      assert.equal(broadcasts.length, beforeRejects + 2, 'both same-scope rejections rebroadcast the snapshot');
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'dispatching']);

      mock.timers.tick(50);
      assert.deepEqual(calls.write, ['\x1b[I', '\x1b'], 'ESC lands after the delay');
      mock.timers.tick(200); // still streaming → idle poll keeps the item visible
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'dispatching']);

      state.streaming = false;
      state.holdSeq = true;
      mock.timers.tick(100); // write starts, completion held → still visible as dispatching
      assert.equal(calls.seq.length, 1);
      assert.deepEqual(calls.seq[0], pasteOf('two'));
      assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id]);
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'dispatching']);

      state.pendingComplete(true); // success removes the item
      assert.deepEqual(ids(cq.getSnapshot()), [a.id]);
      assert.equal(cq.getSnapshot()[0].status, 'queued');
    } finally { mock.timers.reset(); }
  });

  it('drain also broadcasts dispatching before the write and removes on success', () => {
    const { deps, broadcasts, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    cq.enqueue('drain me', A);
    state.streaming = false;
    state.holdSeq = true;
    cq.onTurnEnd(); // idle → immediate _injectHead; the write completion is held
    let snap = cq.getSnapshot();
    assert.deepEqual(statuses(snap), ['dispatching']);
    assert.deepEqual(snap[0].anchor, PUBLIC_A);
    const frames = broadcasts.filter((m) => m.type === 'queue-state');
    assert.ok(
      frames.some((f) => f.items.some((i) => i.status === 'dispatching' && i.anchor.project === A.project)),
      'dispatching state is broadcast before success',
    );
    state.pendingComplete(true);
    assert.equal(cq.getSnapshot().length, 0);
  });

  it('drain write failure restores the item at the head as queued', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('drain me');
    state.streaming = false;
    state.seqOk = false;
    cq.onTurnEnd();
    assert.deepEqual(ids(cq.getSnapshot()), [a.id]);
    assert.deepEqual(statuses(cq.getSnapshot()), ['queued']);
  });

  it('restores the dispatching item at its original FIFO position on poll timeout', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('A');
      const b = cq.enqueue('B');
      assert.equal(cq.sendNow(b.id), true);
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'dispatching']);
      mock.timers.tick(50);   // ESC
      mock.timers.tick(2500); // past the 2s idle-poll cap → restore, never blind-inject
      assert.equal(calls.seq.length, 0);
      assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id], 'B is not promoted to the head');
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'queued']);
    } finally { mock.timers.reset(); }
  });

  it('restores the original FIFO position when the write reports failure', () => {
    const { deps, state, broadcasts } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('A');
    const b = cq.enqueue('B');
    state.streaming = false;
    state.seqOk = false;
    assert.equal(cq.sendNow(b.id), true);
    assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id]);
    assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'queued']);
    assert.equal(broadcasts.at(-1).items.length, 2);
    assert.equal(broadcasts.at(-1).items[1].status, 'queued');
  });

  it('restores the original FIFO position when the write throws', () => {
    const { deps, calls, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('A');
    const b = cq.enqueue('B');
    state.streaming = false;
    deps.writeToPtySequential = (chunks, onComplete) => {
      calls.seq.push(chunks);
      throw new Error('write boom');
    };
    assert.equal(cq.sendNow(b.id), true);
    assert.equal(calls.seq.length, 1);
    assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id]);
    assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'queued']);
    assert.equal(cq.sendNow(b.id), true, 'the restored item is actionable again');
  });

  it('replays the dispatching state from getSnapshot during a held write', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('queued', A);
    const b = cq.enqueue('writing', B);
    state.streaming = false;
    state.holdSeq = true;
    assert.equal(cq.sendNow(b.id), true);
    // A reconnecting client calls getSnapshot() (WS replay): both phases are present.
    assert.deepEqual(cq.getSnapshot().map((i) => [i.id, i.status]), [
      [a.id, 'queued'],
      [b.id, 'dispatching'],
    ]);
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
      const snap = cq.getSnapshot();
      assert.equal(snap.length, 1); // still parked, not lost
      assert.equal(snap[0].status, 'queued');
    } finally { mock.timers.reset(); }
  });

  it('strict (scheduled-task) write failure drops the item instead of requeueing the FIFO head', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, broadcasts, broadcastArgs } = makeDeps();
      // Wire the anchor-aware sequential writer so the strict path engages; make it fail.
      const strictCalls = [];
      deps.writeToPtySequentialFor = (chunks, onComplete, opts, anchor) => {
        strictCalls.push({ chunks, opts, anchor });
        if (onComplete) onComplete(false); // target instance dead → strict failure
      };
      cq.initChatQueue(deps);
      const scheduled = cq.enqueue('scheduled prompt', { project: 'p', instanceKey: 'ccv-dead', strictAnchor: true });
      cq.onTurnEnd();
      mock.timers.tick(200);
      // The strict item was attempted once with strict:true, then DROPPED (not unshifted).
      assert.equal(strictCalls.length, 1);
      assert.equal(strictCalls[0].opts.strict, true, 'strict flag reaches writeToPtySequentialFor');
      assert.equal(cq.getSnapshot().length, 0, 'strict failure drops the item (no FIFO requeue)');

      const states = broadcasts.filter((m) => m.type === 'queue-state');
      assert.ok(states.some((m) => m.items.some((i) => i.id === scheduled.id && i.status === 'dispatching')),
        'the scheduled item is observable as dispatching before the failure');
      for (const m of states) {
        for (const i of m.items) {
          assert.equal(i.anchor && 'strictAnchor' in i.anchor, false, 'strictAnchor never leaks into snapshots');
        }
      }
      const rejected = broadcasts.find((m) => m.type === 'queue-rejected');
      assert.equal(rejected.reason, 'target-gone');
      assert.deepEqual(rejected.scope, { project: 'p', instanceKey: 'ccv-dead' },
        'the negative ack is scoped to the dead target');
      const rejectedArg = broadcastArgs.find((a) => a.msg.type === 'queue-rejected');
      assert.deepEqual(rejectedArg.item.anchor, { project: 'p', instanceKey: 'ccv-dead' });
      // A follow-up normal message is NOT blocked behind the dropped strict item.
      cq.enqueue('next user message');
      cq.onTurnEnd();
      mock.timers.tick(200);
      assert.equal(calls.seq.length, 1, 'FIFO is not wedged by the dropped strict item');
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

  it('does not clobber a pending send-now dispatch', () => {
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
  it('busy path: focus-in → ESC → idle poll → inject; item stays dispatching until success', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      const a = cq.enqueue('first');
      const b = cq.enqueue('second');
      assert.equal(cq.sendNow(b.id), true);
      assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id]);
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued', 'dispatching']);
      assert.deepEqual(calls.write, ['\x1b[I']);
      mock.timers.tick(50);
      assert.deepEqual(calls.write, ['\x1b[I', '\x1b']);
      mock.timers.tick(200);
      assert.equal(calls.seq.length, 0); // turn not observably over yet
      assert.equal(cq.getSnapshot()[1].status, 'dispatching');
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(calls.seq[0], pasteOf('second'));
      assert.deepEqual(ids(cq.getSnapshot()), [a.id]);
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
    assert.deepEqual(statuses(cq.getSnapshot()), ['dispatching', 'queued']);
    assert.equal(cq.sendNow(b.id), false);
    assert.deepEqual(statuses(cq.getSnapshot()), ['dispatching', 'queued']);
    state.pendingComplete(true); // first inject finishes
    state.holdSeq = false;
    assert.deepEqual(ids(cq.getSnapshot()), [b.id]);
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
      assert.deepEqual(statuses(cq.getSnapshot()), ['dispatching']); // remains visible
      mock.timers.tick(50);
      mock.timers.tick(2500); // past the 2s poll cap
      assert.equal(calls.seq.length, 0);
      assert.deepEqual(ids(cq.getSnapshot()), [a.id]); // parked back
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued']);
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
    assert.deepEqual(ids(cq.getSnapshot()), [a.id]);
    assert.equal(cq.getSnapshot()[0].status, 'queued');
    assert.equal(broadcasts.at(-1).items.length, 1);
    assert.equal(broadcasts.at(-1).items[0].status, 'queued');
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
      assert.deepEqual(ids(cq.getSnapshot()), [a.id, b.id], 'B stays queued and actionable');
      assert.deepEqual(statuses(cq.getSnapshot()), ['dispatching', 'queued']);
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(calls.seq[0], pasteOf('A'), 'A still injects via its own poll');
      assert.deepEqual(ids(cq.getSnapshot()), [b.id]);
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
    assert.equal(cq.getSnapshot().length, 0, 'the dispatch slot is dropped by clear');
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

describe('chat-queue: scope', () => {
  it('drops a verified-dead target and drains the successor in the same turn', () => {
    const { deps, calls, state, broadcasts } = makeDeps();
    deps.writeToPtySequentialFor = (chunks, onComplete) => deps.writeToPtySequential(chunks, onComplete);
    deps.hasLivePtyFor = (anchor) => anchor.instanceKey !== A.instanceKey;
    deps.writeToPtySequentialFor = (chunks, onComplete, opts, anchor) => {
      if (anchor.instanceKey === A.instanceKey) { onComplete(false); return; }
      deps.writeToPtySequential(chunks, onComplete, opts);
    };
    cq.initChatQueue(deps);
    const dead = cq.enqueue('dead target', A);
    const live = cq.enqueue('live target', B);
    cq.onTurnEnd();
    assert.deepEqual(ids(cq.getSnapshot()), [], 'both items drained after the dead target is rejected');
    assert.equal(calls.seq.length, 1, 'successor drains immediately after the terminal failure');
    const rejected = broadcasts.find((msg) => msg.type === 'queue-rejected');
    assert.equal(rejected.reason, 'target-gone');
    assert.equal(rejected.id, dead.id);
  });

  it('restores transient failures and liveness probe errors without draining past them', () => {
    const { deps, calls, state } = makeDeps();
    deps.hasLivePtyFor = () => { throw new Error('probe unavailable'); };
    state.holdSeq = true;
    cq.initChatQueue(deps);
    const item = cq.enqueue('transient', A);
    cq.onTurnEnd();
    state.pendingComplete(false);
    assert.deepEqual(ids(cq.getSnapshot()), [item.id]);
    assert.equal(calls.seq.length, 1, 'a transient failure stays queued rather than dropping or skipping');
  });

  it('rejects foreign scoped actions without changing the item, preserving legacy unscoped calls', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const item = cq.enqueue('owned by A', A);
    assert.equal(cq.sendNow(item.id, B), false);
    assert.equal(cq.remove(item.id, B), false);
    assert.deepEqual(ids(cq.getSnapshot()), [item.id]);
    assert.equal(cq.remove(item.id, A), true);
    const legacy = cq.enqueue('legacy', A);
    assert.equal(cq.remove(legacy.id), true);
  });

  it('restores the dispatch slot after an exceptional focus write', () => {
    const { deps, state } = makeDeps();
    deps.writeToPtyFor = () => { throw new Error('write failed'); };
    cq.initChatQueue(deps);
    state.streaming = true;
    const item = cq.enqueue('still actionable', A);
    assert.equal(cq.sendNow(item.id), true);
    assert.equal(cq.getSnapshot()[0].status, 'queued');
    assert.equal(cq.remove(item.id, A), true);
  });

  it('keeps dispatch FIFO position after clearing multiple preceding items from another scope', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('A1', A);
      cq.enqueue('A2', A);
      const first = cq.enqueue('B1', B);
      const second = cq.enqueue('B2', B);
      state.holdSeq = true;
      cq.sendNow(first.id);
      cq.clear({ project: A.project });
      mock.timers.tick(50);
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(cq.getSnapshot(B).map((i) => [i.id, i.status]), [[first.id, 'dispatching'], [second.id, 'queued']]);
      state.pendingComplete(false);
      assert.deepEqual(cq.getSnapshot(B).map((i) => i.id), [first.id, second.id], 'failed dispatch is restored before its successor');
    } finally { mock.timers.reset(); }
  });

  it('restores a queued item when its explicit PTY target is gone instead of falling back', () => {
    const { deps, state } = makeDeps();
    const focus = [];
    const writes = [];
    deps.writeToPtyFor = (data, anchor) => { focus.push({ data, anchor }); return false; };
    deps.writeToPtySequentialFor = (chunks) => { writes.push(chunks); };
    cq.initChatQueue(deps);
    state.streaming = true;
    const item = cq.enqueue('do not misroute', A);
    assert.equal(cq.sendNow(item.id), true);
    assert.equal(cq.getSnapshot(A)[0].status, 'queued');
    assert.deepEqual(writes, [], 'no prompt is written after the target fails');
    assert.equal(focus.length, 1, 'the focus attempt was targeted, never global');
  });

  it('includes project-scoped items in a matching instance-pinned view', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const projectOnly = cq.enqueue('from another device', { project: A.project, sessionId: A.sessionId });
    const other = cq.enqueue('other instance', { project: B.project, sessionId: B.sessionId, instanceKey: B.instanceKey });
    assert.deepEqual(ids(cq.getSnapshot(A)), [projectOnly.id]);
    assert.deepEqual(ids(cq.getSnapshot({ project: B.project, sessionId: B.sessionId, instanceKey: B.instanceKey })), [other.id]);
  });

  it('keeps dispatching before same-scope queued items in filtered FIFO order', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    cq.enqueue('foreign first', { project: 'other' });
    const selected = cq.enqueue('selected', A);
    const following = cq.enqueue('following', A);
    cq.sendNow(selected.id);
    const scoped = cq.getSnapshot(A);
    assert.deepEqual(scoped.map((i) => [i.id, i.status]), [[selected.id, 'dispatching'], [following.id, 'queued']]);
  });

  it('routes send-now focus, ESC, and prompt writes through the item anchor', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, state } = makeDeps();
      const focus = [];
      const writes = [];
      deps.writeToPtyFor = (data, anchor) => focus.push({ data, anchor });
      deps.writeToPtySequentialFor = (chunks, onComplete, opts, anchor) => {
        writes.push({ chunks, anchor });
        onComplete(true);
      };
      cq.initChatQueue(deps);
      state.streaming = true;
      const item = cq.enqueue('only A', A);
      cq.sendNow(item.id);
      mock.timers.tick(50);
      state.streaming = false;
      mock.timers.tick(100);
      assert.deepEqual(focus.map((f) => f.data), ['\x1b[I', '\x1b']);
      assert.ok(focus.every((f) => f.anchor.project === A.project && f.anchor.instanceKey === A.instanceKey));
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].chunks, pasteOf('only A'));
      assert.equal(writes[0].anchor.project, A.project);
      assert.equal(writes[0].anchor.instanceKey, A.instanceKey);
    } finally { mock.timers.reset(); }
  });

  it('snapshots expose sanitized anchors; getSnapshot(anchor) filters per view', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('A message', { ...A, strictAnchor: true });
    const b = cq.enqueue('B message', B);

    const all = cq.getSnapshot();
    assert.deepEqual(ids(all), [a.id, b.id]);
    assert.deepEqual(all.map((i) => i.anchor), [PUBLIC_A, PUBLIC_B]);
    assert.equal('strictAnchor' in all[0].anchor, false, 'internal flags are not exposed');
    assert.deepEqual(ids(cq.getSnapshot(A)), [a.id], 'strictAnchor in the filter is ignored');
    assert.deepEqual(ids(cq.getSnapshot({ instanceKey: B.instanceKey })), [b.id]);
    assert.deepEqual(cq.getSnapshot({ project: A.project, instanceKey: B.instanceKey }), [],
      'every supplied field must match');
    assert.deepEqual(ids(cq.getSnapshot({})), [a.id, b.id], 'an empty anchor preserves the full queue');
  });

  it('broadcasts carry the triggering item scope and item as the second argument', () => {
    const { deps, state, broadcasts, broadcastArgs } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('A message', A);
    assert.deepEqual(broadcasts.at(-1).scope, PUBLIC_A);
    assert.equal(broadcastArgs.at(-1).item.id, a.id);
    assert.deepEqual(broadcastArgs.at(-1).item.anchor, PUBLIC_A);
    assert.equal(broadcastArgs.at(-1).item.status, 'queued');

    assert.equal(cq.remove(a.id), true);
    assert.deepEqual(broadcasts.at(-1).scope, PUBLIC_A);
    assert.equal(broadcastArgs.at(-1).item.id, a.id);
  });

  it('clear(anchor) only clears matching items; other scopes stay dispatchable', () => {
    const { deps, state, broadcasts, broadcastArgs } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    cq.enqueue('A message', A);
    const b = cq.enqueue('B message', B);
    cq.clear({ project: A.project });
    assert.deepEqual(ids(cq.getSnapshot()), [b.id], 'only the matching scope is cleared');
    assert.deepEqual(broadcasts.at(-1).scope, { project: A.project }, 'the clear frame is scoped');
    assert.equal(broadcastArgs.at(-1).item, undefined, 'scope-only clear has no single trigger item');

    state.streaming = false;
    assert.equal(cq.sendNow(b.id), true, 'the untouched scope still injects and succeeds');
    assert.equal(cq.getSnapshot().length, 0);
  });

  it('scoped clear leaves a non-matching dispatch alive and its success still removes it', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    cq.enqueue('A message', A);
    const b = cq.enqueue('B message', B);
    state.streaming = false;
    state.holdSeq = true;
    assert.equal(cq.sendNow(b.id), true); // B dispatching (write held), A still queued
    cq.clear({ project: A.project });    // removes A only; must not invalidate B's generation
    assert.deepEqual(ids(cq.getSnapshot()), [b.id]);
    assert.equal(cq.getSnapshot()[0].status, 'dispatching');
    state.pendingComplete(true);
    assert.equal(cq.getSnapshot().length, 0, 'B still completes normally after the scoped clear');
  });

  it('scoped clear drops a matching dispatch and never requeues it after a late failure', () => {
    const { deps, state } = makeDeps();
    cq.initChatQueue(deps);
    state.streaming = true;
    const a = cq.enqueue('A message', A);
    const b = cq.enqueue('B message', B);
    state.streaming = false;
    state.holdSeq = true;
    assert.equal(cq.sendNow(a.id), true); // A dispatching (held), B queued behind it
    cq.clear({ project: A.project });
    assert.deepEqual(ids(cq.getSnapshot()), [b.id], 'B survives the A-scoped clear');
    state.pendingComplete(false); // stale failure AFTER the clear must not re-park A
    assert.deepEqual(ids(cq.getSnapshot()), [b.id]);
    assert.equal(cq.sendNow(a.id), false);
    state.holdSeq = false;
    assert.equal(cq.sendNow(b.id), true, 'B remains actionable');
  });

  it('stop() clears every scope and invalidates an in-flight dispatch', () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
      const { deps, calls, state } = makeDeps();
      cq.initChatQueue(deps);
      state.streaming = true;
      cq.enqueue('A message', A);
      const b = cq.enqueue('B message', B);
      assert.equal(cq.sendNow(b.id), true);
      cq.stop();
      assert.equal(cq.getSnapshot().length, 0);
      mock.timers.tick(500);
      assert.equal(calls.seq.length, 0, 'the cancelled dispatch never writes');
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
    assert.deepEqual(ids(cq.getSnapshot()), [b.id]);
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
      assert.deepEqual(statuses(cq.getSnapshot()), ['queued']);
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
