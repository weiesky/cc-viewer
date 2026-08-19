/**
 * Unit tests for the shared client-safe module server/lib/session-boundary.js
 * (wire-v2 S1: verbatim moves from src/utils/clearCheckpoint.js and
 * src/utils/sessionMerge.js).
 *
 * Boundary-predicate behavior is already covered end-to-end by
 * test/clearCheckpoint.test.js (through the src re-export shell) and
 * test/session-boundary-parity.test.js; this file (a) pins the new canonical
 * import path, (b) adds the first DIRECT tests for findReverseAnchor, which
 * was previously module-private in sessionMerge.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isPostClearCheckpoint,
  isCompactContinuation,
  isSessionBoundary,
  messageFingerprint,
  findReverseAnchor,
} from '../packages/app/server/lib/session-boundary.js';

const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const clearMsg = () => textMsg('user', '<command-name>/clear</command-name>');

describe('canonical import path exposes the full shared surface', () => {
  it('all five exports are functions', () => {
    for (const fn of [isPostClearCheckpoint, isCompactContinuation, isSessionBoundary, messageFingerprint, findReverseAnchor]) {
      assert.equal(typeof fn, 'function');
    }
  });

  it('src/utils/clearCheckpoint.js shell re-exports the same function objects', async () => {
    const shell = await import('../packages/app/src/utils/clearCheckpoint.js');
    assert.equal(shell.isPostClearCheckpoint, isPostClearCheckpoint);
    assert.equal(shell.isCompactContinuation, isCompactContinuation);
    assert.equal(shell.isSessionBoundary, isSessionBoundary);
  });

  it('src/utils/sessionMerge.js re-exports the same messageFingerprint', async () => {
    const merge = await import('../apps/web/src/utils/sessionMerge.js');
    assert.equal(merge.messageFingerprint, messageFingerprint);
  });
});

describe('isPostClearCheckpoint (moved behavior pin)', () => {
  it('detects a shrunk checkpoint whose msg[0] carries the /clear marker', () => {
    const entry = { _isCheckpoint: true, body: { messages: [clearMsg(), textMsg('assistant', 'ok')] } };
    assert.equal(isPostClearCheckpoint(entry, 50), true);
  });

  it('rejects non-checkpoint, non-shrunk, and marker-less entries', () => {
    const msgs = [clearMsg()];
    assert.equal(isPostClearCheckpoint({ _isCheckpoint: false, body: { messages: msgs } }, 50), false);
    assert.equal(isPostClearCheckpoint({ _isCheckpoint: true, body: { messages: msgs } }, 1), false, 'length >= prevCount is not a shrink');
    assert.equal(isPostClearCheckpoint({ _isCheckpoint: true, body: { messages: [textMsg('user', 'hi')] } }, 50), false);
  });
});

describe('isCompactContinuation (moved behavior pin)', () => {
  it('matches both CLI summary/continuation prompt heads, string or block content', () => {
    assert.equal(isCompactContinuation({ body: { messages: [{ role: 'user', content: 'Your task is to create a detailed summary of the conversation so far' }] } }), true);
    assert.equal(isCompactContinuation({ body: { messages: [textMsg('user', 'This session is being continued from a previous conversation…')] } }), true);
  });

  it('rejects ordinary first messages', () => {
    assert.equal(isCompactContinuation({ body: { messages: [textMsg('user', 'fix the bug please')] } }), false);
  });
});

describe('isSessionBoundary (moved behavior pin)', () => {
  const plain = (n) => ({ _isCheckpoint: true, body: { messages: Array.from({ length: n }, (_, i) => textMsg(i % 2 ? 'assistant' : 'user', `m${i}`)) } });

  it('big drop is a boundary unless compact-like', () => {
    const entry = plain(10);
    assert.equal(isSessionBoundary(entry, { prevCount: 100, count: 10, prevUserId: 'u', userId: 'u' }), true);
    assert.equal(isSessionBoundary({ ...entry, _compactContinuation: true }, { prevCount: 100, count: 10, prevUserId: 'u', userId: 'u' }), false);
  });

  it('user_id change with established previous session is a boundary', () => {
    const entry = plain(120);
    assert.equal(isSessionBoundary(entry, { prevCount: 100, count: 120, prevUserId: 'a', userId: 'b' }), true);
    assert.equal(isSessionBoundary(entry, { prevCount: 0, count: 120, prevUserId: 'a', userId: 'b' }), false, 'no previous session established');
  });
});

describe('findReverseAnchor (first direct tests)', () => {
  const mk = (...texts) => texts.map((t, i) => textMsg(i % 2 ? 'assistant' : 'user', t));

  it('anchors at the tail: new sequence extends the current one', () => {
    const cur = mk('a', 'b', 'c');
    const neu = [cur[2], textMsg('assistant', 'd')]; // starts at cur tail, adds one
    const res = findReverseAnchor(neu, cur);
    assert.deepEqual(res, { anchorIdx: 2, overlapLen: 1 });
  });

  it('full-overlap suffix subset reports overlapLen === newLen', () => {
    const cur = mk('a', 'b', 'c', 'd');
    const neu = [cur[2], cur[3]];
    const res = findReverseAnchor(neu, cur);
    assert.deepEqual(res, { anchorIdx: 2, overlapLen: 2 });
  });

  it('returns null on empty inputs and on empty-fp anchor candidates', () => {
    const cur = mk('a', 'b');
    assert.equal(findReverseAnchor([], cur), null);
    assert.equal(findReverseAnchor(cur, []), null);
    // msg with empty content array → fp 'user|empty' → rejected as anchor
    assert.equal(findReverseAnchor([{ role: 'user', content: [] }, cur[1]], cur), null);
  });

  it('skips a colliding candidate that fails multi-block verification and finds the real anchor', () => {
    // cur: X a b X a — anchor fp ('user|t|…X…') matches at idx 3? No: build a
    // genuine collision: same first message content appears at idx 0 and idx 2,
    // but only idx 2 is followed by the rest of the new sequence.
    const x1 = textMsg('user', 'X');
    const a1 = textMsg('assistant', 'follow-1');
    const x2 = textMsg('user', 'X'); // same fp as x1
    const a2 = textMsg('assistant', 'follow-2');
    const cur = [x1, a1, x2, a2];
    const neu = [textMsg('user', 'X'), textMsg('assistant', 'follow-1')];
    // reverse scan hits idx 2 first (fp match) but neu[1] ≠ cur[3] → verification
    // fails → continues left and locks onto idx 0.
    const res = findReverseAnchor(neu, cur);
    assert.deepEqual(res, { anchorIdx: 0, overlapLen: 2 });
  });

  it('honors precomputed newFps and a shared curMsgs fp cache', () => {
    const cur = mk('a', 'b', 'c');
    const neu = [cur[1], cur[2]];
    const newFps = neu.map(messageFingerprint);
    const cache = new Array(cur.length);
    const res = findReverseAnchor(neu, cur, newFps, cache);
    assert.deepEqual(res, { anchorIdx: 1, overlapLen: 2 });
    assert.equal(typeof cache[1], 'string', 'shared cache was populated during the scan');
  });
});
