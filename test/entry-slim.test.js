/**
 * Unit tests for src/utils/entry-slim.js
 * 覆盖 createIncrementalSlimmer 和 restoreSlimmedEntry 的防御检查。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIncrementalSlimmer,
  createEntrySlimmer,
  restoreSlimmedEntry,
} from '../src/utils/entry-slim.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const isMainAgent = (entry) => !!entry.mainAgent;

function makeMainAgent(msgCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
  }
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    body: {
      messages,
      metadata: { user_id: opts.userId || 'user-1' },
      model: 'claude-opus-4-6',
    },
    response: { status: 200, body: {} },
  };
}

function makeSubAgent(msgCount) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: 'user', content: `sub-${i}` });
  }
  return {
    timestamp: new Date().toISOString(),
    url: 'https://api.anthropic.com/v1/messages',
    mainAgent: false,
    body: { messages, model: 'claude-sonnet-4-6' },
    response: { status: 200, body: {} },
  };
}

// ─── createIncrementalSlimmer ─────────────────────────────────────────────────

describe('createIncrementalSlimmer', () => {
  it('should slim previous MainAgent entries in the same session', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);
    assert.equal(e0._slimmed, undefined, 'first entry should not be slimmed');

    // Entry 1: 15 messages (same session, cumulative)
    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true, 'entry 0 should be slimmed');
    assert.equal(requests[0].body.messages.length, 0, 'entry 0 messages should be empty');
    assert.equal(requests[0]._messageCount, 10);
    assert.equal(requests[0]._fullEntryIndex, 1, 'entry 0 should point to entry 1');

    // Entry 2: 20 messages (same session)
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);
    assert.equal(requests[1]._slimmed, true, 'entry 1 should be slimmed');
    assert.equal(requests[1]._fullEntryIndex, 2, 'entry 1 should point to entry 2');
    // Entry 0 should also be updated to point to entry 2 (cascade)
    assert.equal(requests[0]._fullEntryIndex, 2, 'entry 0 should cascade to entry 2');
    // Entry 2 should remain full
    assert.equal(requests[2]._slimmed, undefined);
    assert.equal(requests[2].body.messages.length, 20);
  });

  it('should clear sessionSlimmedIndices on session boundary', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Session 1: entries 0, 1
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Session 2: entry 2 has 6 messages with different userId (new session, not transient)
    const e2 = makeMainAgent(6, { userId: 'user-2' });
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 should still point to entry 1 (not updated to entry 2 — different session)
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Session 2: entry 3 (12 messages)
    const e3 = makeMainAgent(12, { userId: 'user-2' });
    slimmer.processEntry(e3, requests, 3);
    requests.push(e3);
    assert.equal(requests[2]._slimmed, true, 'session 2 entry should be slimmed');
    assert.equal(requests[2]._fullEntryIndex, 3);
    // Entry 0 from session 1 should NOT be updated
    assert.equal(requests[0]._fullEntryIndex, 1);
  });

  it('should remove index from sessionSlimmedIndices on dedup', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Entry 1: 15 messages — slims entry 0
    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Dedup replaces entry 0 with a completed version
    const e0completed = makeMainAgent(10);
    requests[0] = e0completed;
    slimmer.onDedup(0);

    // Entry 2: 20 messages — should NOT try to update entry 0's _fullEntryIndex
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 (completed) should NOT have _fullEntryIndex (it was removed from set)
    assert.equal(requests[0]._fullEntryIndex, undefined, 'deduped entry should not have _fullEntryIndex');
    // Entry 1 should be slimmed and point to entry 2
    assert.equal(requests[1]._slimmed, true);
    assert.equal(requests[1]._fullEntryIndex, 2);
  });

  it('should skip transient requests', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 15 messages
    const e0 = makeMainAgent(15);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Transient entry: only 2 messages, looks like new session but prevCount > 10
    const eTransient = makeMainAgent(2, { userId: 'user-2' });
    slimmer.processEntry(eTransient, requests, 1);
    requests.push(eTransient);

    // Entry 0 should NOT be slimmed (transient was skipped)
    assert.equal(requests[0]._slimmed, undefined);

    // Entry 2: 20 messages (same session as entry 0, continues normally)
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);
    assert.equal(requests[0]._slimmed, true, 'entry 0 should now be slimmed');
    assert.equal(requests[0]._fullEntryIndex, 2);
  });

  it('should not slim non-MainAgent entries', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const sub = makeSubAgent(5);
    slimmer.processEntry(sub, requests, 1);
    requests.push(sub);

    // SubAgent should not affect slim state; entry 0 should not be slimmed
    assert.equal(requests[0]._slimmed, undefined);
    assert.equal(sub._slimmed, undefined);
  });

  it('should detect session boundary by message count drop (same userId)', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Session 1: 20 messages
    const e0 = makeMainAgent(20);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(25);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);

    // Session 2: message count drops from 25 to 5 (same userId) → new session
    const e2 = makeMainAgent(5);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 should still point to entry 1 (session 1), not entry 2 (session 2)
    assert.equal(requests[0]._fullEntryIndex, 1, 'session 1 entries should not cascade to session 2');

    // Session 2 continues: entry 3 slims entry 2
    const e3 = makeMainAgent(10);
    slimmer.processEntry(e3, requests, 3);
    requests.push(e3);
    assert.equal(requests[2]._slimmed, true);
    assert.equal(requests[2]._fullEntryIndex, 3);
  });

  it('should slim entries with _deltaFormat after reconstruction', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const eDelta = makeMainAgent(15);
    eDelta._deltaFormat = true;
    slimmer.processEntry(eDelta, requests, 1);
    requests.push(eDelta);

    // After reconstruction, delta entries have full messages and should be slimmed
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0].body.messages.length, 0);
    assert.equal(requests[0]._fullEntryIndex, 1);
  });
});

// ─── restoreSlimmedEntry defensive check ──────────────────────────────────────

describe('restoreSlimmedEntry', () => {
  it('should restore slimmed entry from fullEntry', () => {
    const full = makeMainAgent(20);
    const slimmed = {
      ...makeMainAgent(10),
      _slimmed: true,
      _messageCount: 10,
      _fullEntryIndex: 1,
    };
    slimmed.body.messages = [];
    const requests = [slimmed, full];

    const restored = restoreSlimmedEntry(slimmed, requests);
    assert.equal(restored.body.messages.length, 10);
    assert.notEqual(restored, slimmed, 'should return new object');
  });

  it('should return original entry when fullEntry has fewer messages than _messageCount', () => {
    const full = makeMainAgent(5); // only 5 messages, but slimmed expects 10
    const slimmed = {
      ...makeMainAgent(10),
      _slimmed: true,
      _messageCount: 10,
      _fullEntryIndex: 1,
    };
    slimmed.body.messages = [];
    const requests = [slimmed, full];

    const result = restoreSlimmedEntry(slimmed, requests);
    assert.equal(result, slimmed, 'should return original when fullEntry has insufficient messages');
  });

  it('should return original entry when not slimmed', () => {
    const entry = makeMainAgent(10);
    const requests = [entry];
    assert.equal(restoreSlimmedEntry(entry, requests), entry);
  });

  it('should return original entry when _fullEntryIndex is null', () => {
    const entry = makeMainAgent(10);
    entry._slimmed = true;
    entry._fullEntryIndex = null;
    const requests = [entry];
    assert.equal(restoreSlimmedEntry(entry, requests), entry);
  });

  it('should restore cascaded slimmed entry using cascaded _fullEntryIndex', () => {
    // Build entries via the slimmer so cascade is applied correctly
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: MainAgent, 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Entry 1: non-MainAgent — should not affect slim state
    const e1 = makeSubAgent(5);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // Entry 2: MainAgent, 20 messages — slims entry 0 and cascades _fullEntryIndex to 2
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Verify cascade happened: entry 0 points to entry 2
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 2, 'entry 0 should cascade to entry 2');

    // restoreSlimmedEntry should slice entry 2's messages down to entry 0's original count (10)
    const restored = restoreSlimmedEntry(requests[0], requests);
    assert.notEqual(restored, requests[0], 'should return new object');
    assert.equal(restored.body.messages.length, 10, 'restored entry should have original 10 messages sliced from entry 2');
  });
});
