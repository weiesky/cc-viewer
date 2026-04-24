/**
 * Unit tests for src/utils/sessionMerge.js
 * Covers incremental push, checkpoint, response-only update, new session, transient, _timestamp, and streaming dedup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMainAgentSessions } from '../src/utils/sessionMerge.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMsg(role, text, opts = {}) {
  return { role, content: text, ...opts };
}

function makeEntry(messages, opts = {}) {
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    body: {
      messages,
      metadata: { user_id: 'userId' in opts ? opts.userId : 'user-1' },
    },
    response: opts.response || { status: 200, body: { content: [] } },
  };
}

function makeSession(messages, opts = {}) {
  return {
    userId: 'userId' in opts ? opts.userId : 'user-1',
    messages,
    response: opts.response || { status: 200, body: {} },
    entryTimestamp: opts.entryTimestamp || null,
  };
}

// ─── 1. Incremental push ──────────────────────────────────────────────────────

describe('incremental push', () => {
  it('pushes new messages and preserves messages reference', () => {
    const existingMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const session = makeSession(existingMsgs);
    const originalRef = session.messages;

    const newMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1'), makeMsg('user', 'q2'), makeMsg('assistant', 'a2')];
    const entry = makeEntry(newMsgs);

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 1);
    assert.equal(result[0].messages.length, 4);
    // messages reference must be STABLE (same array)
    assert.equal(result[0].messages, originalRef);
    // new messages are appended
    assert.equal(result[0].messages[2].content, 'q2');
    assert.equal(result[0].messages[3].content, 'a2');
  });

  it('sets _timestamp on new messages only', () => {
    const ts1 = '2026-04-01T10:00:00Z';
    const ts2 = '2026-04-01T10:05:00Z';
    const existingMsgs = [makeMsg('user', 'q1', { _timestamp: ts1 })];
    const session = makeSession(existingMsgs);

    const newMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const entry = makeEntry(newMsgs, { timestamp: ts2 });

    mergeMainAgentSessions([session], entry);

    // Old message _timestamp preserved
    assert.equal(session.messages[0]._timestamp, ts1);
    // New message gets entry timestamp
    assert.equal(session.messages[1]._timestamp, ts2);
  });
});

// ─── 2. Checkpoint ────────────────────────────────────────────────────────────

describe('checkpoint (messages shrink)', () => {
  it('replaces messages reference when newLen < currentLen (newLen > 4 to bypass transient filter)', () => {
    const existingMsgs = Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(existingMsgs);
    const originalRef = session.messages;

    // Simulate /compact: 6 messages remain (> 4 to bypass transient filter, < 10 = 20*0.5 for isNewConversation)
    const newMsgs = Array.from({ length: 6 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `new_m${i}`));
    const entry = makeEntry(newMsgs);

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 1);
    assert.equal(result[0].messages.length, 6);
    // messages reference must be REPLACED (different array)
    assert.notEqual(result[0].messages, originalRef);
    assert.equal(result[0].messages[0].content, 'new_m0');
  });
});

// ─── 3. Response-only update ──────────────────────────────────────────────────

describe('response-only update (same message count)', () => {
  it('updates response without changing messages', () => {
    const existingMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const session = makeSession(existingMsgs);
    const originalRef = session.messages;
    const originalLen = session.messages.length;

    const newResponse = { status: 200, body: { content: [{ type: 'text', text: 'final answer' }] } };
    const newMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const entry = makeEntry(newMsgs, { response: newResponse });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, originalLen);
    assert.equal(result[0].messages, originalRef);
    assert.equal(result[0].response, newResponse);
  });
});

// ─── 4. New session ───────────────────────────────────────────────────────────

describe('new session (different user)', () => {
  it('creates a new session when userId differs', () => {
    const session = makeSession([makeMsg('user', 'q1')], { userId: 'user-A' });
    const entry = makeEntry([makeMsg('user', 'q2')], { userId: 'user-B' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 2);
    assert.equal(result[0].userId, 'user-A');
    assert.equal(result[1].userId, 'user-B');
  });
});

// ─── 5. Transient filter ──────────────────────────────────────────────────────

describe('transient filter', () => {
  it('skips merge when isNewConversation with <= 4 messages and prevCount > 4', () => {
    const existingMsgs = Array.from({ length: 10 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(existingMsgs, { userId: null });

    // 3 messages, prevCount=10 → isNewConversation=true (3 < 5 && diff=7 > 4), newMessages.length <= 4 → skip
    const newMsgs = [makeMsg('user', 'q'), makeMsg('assistant', 'a'), makeMsg('user', 'q2')];
    const entry = makeEntry(newMsgs, { userId: null });

    const result = mergeMainAgentSessions([session], entry);

    // Should return prevSessions unchanged
    assert.equal(result.length, 1);
    assert.equal(result[0].messages.length, 10);
  });

  it('skipTransientFilter=true creates new session for /clear → short chat (SSE path)', () => {
    // 真实场景：用户在长对话里 /clear 后说 "hi"，SSE 推送的 entry 只有 2 条消息
    const existingMsgs = Array.from({ length: 10 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(existingMsgs, { userId: null });

    const newMsgs = [makeMsg('user', 'hi'), makeMsg('assistant', 'Hi! How can I help?')];
    const entry = makeEntry(newMsgs, { userId: null });

    const result = mergeMainAgentSessions([session], entry, { skipTransientFilter: true });

    // 旧 session 保留，新 session 被追加（不再被 transient 过滤器丢弃）
    assert.equal(result.length, 2);
    assert.equal(result[0].messages.length, 10);
    assert.equal(result[1].messages.length, 2);
    assert.equal(result[1].messages[0].content, 'hi');
  });
});

// ─── 6. First session creation ────────────────────────────────────────────────

describe('first session', () => {
  it('creates initial session from empty prevSessions', () => {
    const msgs = [makeMsg('user', 'hello'), makeMsg('assistant', 'hi')];
    const entry = makeEntry(msgs);

    const result = mergeMainAgentSessions([], entry);

    assert.equal(result.length, 1);
    assert.equal(result[0].messages, msgs);
    assert.equal(result[0].response, entry.response);
  });
});

// ─── 7. Streaming dedup sequence ──────────────────────────────────────────────

describe('streaming dedup sequence', () => {
  it('incrementally pushes through inProgress → completed', () => {
    const ts = '2026-04-01T12:00:00Z';

    // T1: inProgress entry with 2 messages
    const msgs1 = [makeMsg('user', 'q1'), makeMsg('assistant', 'partial')];
    const entry1 = makeEntry(msgs1, { timestamp: ts, response: null });
    let sessions = mergeMainAgentSessions([], entry1);
    const ref = sessions[0].messages;

    assert.equal(sessions[0].messages.length, 2);

    // T2: inProgress update (dedup) with 3 messages
    const msgs2 = [makeMsg('user', 'q1'), makeMsg('assistant', 'partial'), makeMsg('user', 'q2')];
    const entry2 = makeEntry(msgs2, { timestamp: ts, response: null });
    sessions = mergeMainAgentSessions(sessions, entry2);

    assert.equal(sessions[0].messages.length, 3);
    assert.equal(sessions[0].messages, ref); // same reference
    assert.equal(sessions[0].messages[2].content, 'q2');

    // T3: completed entry with 4 messages + response
    const finalResponse = { status: 200, body: { content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 100 } } };
    const msgs3 = [makeMsg('user', 'q1'), makeMsg('assistant', 'partial'), makeMsg('user', 'q2'), makeMsg('assistant', 'final')];
    const entry3 = makeEntry(msgs3, { timestamp: ts, response: finalResponse });
    sessions = mergeMainAgentSessions(sessions, entry3);

    assert.equal(sessions[0].messages.length, 4);
    assert.equal(sessions[0].messages, ref); // still same reference
    assert.equal(sessions[0].messages[3].content, 'final');
    assert.equal(sessions[0].response, finalResponse);
  });
});

// ─── 8. Shallow copy trigger ──────────────────────────────────────────────────

describe('shallow copy for React update', () => {
  it('returns a new array reference (not same as prevSessions)', () => {
    const session = makeSession([makeMsg('user', 'q1')]);
    const prevSessions = [session];

    const entry = makeEntry([makeMsg('user', 'q1'), makeMsg('assistant', 'a1')]);
    const result = mergeMainAgentSessions(prevSessions, entry);

    // New array reference for React
    assert.notEqual(result, prevSessions);
    // But same session object inside
    assert.equal(result[0], prevSessions[0]);
  });
});

// ─── 9. Multi-session append ──────────────────────────────────────────────────

describe('multi-session append', () => {
  it('appends new session when multiple sessions exist', () => {
    const s1 = makeSession([makeMsg('user', 'q1')], { userId: 'A' });
    const s2 = makeSession([makeMsg('user', 'q2')], { userId: 'B' });
    const entry = makeEntry([makeMsg('user', 'q3')], { userId: 'C' });

    const result = mergeMainAgentSessions([s1, s2], entry);

    assert.equal(result.length, 3);
    assert.equal(result[0].userId, 'A');
    assert.equal(result[1].userId, 'B');
    assert.equal(result[2].userId, 'C');
  });

  it('pushes to last session in multi-session list', () => {
    const s1 = makeSession([makeMsg('user', 'q1')], { userId: 'A' });
    const s2 = makeSession([makeMsg('user', 'q2')], { userId: 'B' });
    const ref = s2.messages;
    const entry = makeEntry([makeMsg('user', 'q2'), makeMsg('assistant', 'a2')], { userId: 'B' });

    const result = mergeMainAgentSessions([s1, s2], entry);

    assert.equal(result.length, 2);
    assert.equal(result[1].messages.length, 2);
    assert.equal(result[1].messages, ref);
  });
});

// ─── 10. userId null handling ─────────────────────────────────────────────────

describe('userId null handling', () => {
  it('treats both null userId as different (sameUser=false)', () => {
    const session = makeSession(
      Array.from({ length: 6 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)),
      { userId: null }
    );
    const entry = makeEntry([makeMsg('user', 'new')], { userId: null });

    const result = mergeMainAgentSessions([session], entry);

    // userId=null → sameUser=false, but userId===lastSession.userId (null===null) → true
    // !isNewConversation (1 < 3 = false) → same session update
    // Actually: isNewConversation = 1 < 6*0.5(=3) && (6-1)>4 → true, and newLen<=4 && prevCount>4 → transient skip
    assert.equal(result.length, 1);
    assert.equal(result[0].messages.length, 6); // unchanged (transient skip)
  });

  it('null userId with enough messages creates new session', () => {
    const session = makeSession(
      Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)),
      { userId: null }
    );
    // 6 messages: isNewConversation=true (6 < 10, diff=14 > 4), newLen > 4 → NOT transient
    // sameUser=false (null), userId===lastSession.userId (null===null) && !isNewConversation(true) → false
    // → new session
    const newMsgs = Array.from({ length: 6 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `new${i}`));
    const entry = makeEntry(newMsgs, { userId: null });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 2);
    assert.equal(result[1].messages.length, 6);
  });
});

// ─── 11. isNewConversation with newLen > 4 ────────────────────────────────────

describe('isNewConversation with newLen > 4', () => {
  it('creates new session when isNewConversation=true and different user', () => {
    const session = makeSession(
      Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)),
      { userId: 'A' }
    );
    // 6 messages, different user → new session
    const newMsgs = Array.from({ length: 6 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `new${i}`));
    const entry = makeEntry(newMsgs, { userId: 'B' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 2);
  });

  it('does checkpoint when isNewConversation=true but sameUser', () => {
    const session = makeSession(
      Array.from({ length: 20 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)),
      { userId: 'A' }
    );
    const originalRef = session.messages;
    // sameUser=true, newLen=6 < currentLen=20 → checkpoint (not new session because sameUser)
    const newMsgs = Array.from({ length: 6 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `new${i}`));
    const entry = makeEntry(newMsgs, { userId: 'A' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 1);
    assert.equal(result[0].messages.length, 6);
    assert.notEqual(result[0].messages, originalRef); // reference replaced
  });
});

// ─── 12. Long push chain ──────────────────────────────────────────────────────

describe('long push chain', () => {
  it('handles 10 consecutive pushes with stable reference', () => {
    const initial = [makeMsg('user', 'q0')];
    let sessions = mergeMainAgentSessions([], makeEntry(initial));
    const ref = sessions[0].messages;

    for (let round = 1; round <= 10; round++) {
      const msgs = Array.from({ length: round + 1 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `r${round}_m${i}`));
      sessions = mergeMainAgentSessions(sessions, makeEntry(msgs));
    }

    assert.equal(sessions[0].messages.length, 11);
    assert.equal(sessions[0].messages, ref); // same reference through all pushes
  });
});

// ─── 13. Cold session null safety ─────────────────────────────────────────────

describe('cold session null safety', () => {
  it('handles lastSession.messages=null without crash', () => {
    const coldSession = { userId: 'A', messages: null, response: null, entryTimestamp: null };
    const entry = makeEntry([makeMsg('user', 'q1'), makeMsg('assistant', 'a1')], { userId: 'A' });

    // Should not throw
    const result = mergeMainAgentSessions([coldSession], entry);

    assert.equal(result[0].messages.length, 2);
  });
});

// ─── 14. Boundary edge cases (code review P2) ────────────────────────────────

describe('empty newMessages array', () => {
  it('treats empty messages as transient and skips merge', () => {
    const existingMsgs = Array.from({ length: 20 }, (_, i) => makeMsg('user', `q${i}`));
    const session = makeSession(existingMsgs);
    const entry = makeEntry([], { userId: 'user-1' });

    const result = mergeMainAgentSessions([session], entry);

    // 0 < 20*0.5 && 20-0 > 4 → isNewConversation=true
    // 0 <= 4 && 20 > 4 → transient → skip
    assert.equal(result[0].messages.length, 20, 'should keep existing messages');
    assert.strictEqual(result[0].messages, existingMsgs, 'reference should be unchanged');
  });
});

describe('exact-length match with different response', () => {
  it('updates response without touching messages', () => {
    const msgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const oldResponse = { status: 200, body: { content: [{ type: 'text', text: 'old' }] } };
    const newResponse = { status: 200, body: { content: [{ type: 'text', text: 'new' }] } };
    const session = makeSession(msgs, { response: oldResponse });

    const entry = makeEntry(
      [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')],
      { userId: 'user-1', response: newResponse }
    );

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, 2, 'message count unchanged');
    assert.strictEqual(result[0].messages, msgs, 'messages reference unchanged');
    assert.strictEqual(result[0].response, newResponse, 'response should be updated');
  });
});

describe('transient boundary: exactly 5 messages', () => {
  it('does NOT skip merge for 5 messages (above transient threshold)', () => {
    const existingMsgs = Array.from({ length: 20 }, (_, i) => makeMsg('user', `q${i}`));
    const session = makeSession(existingMsgs);
    const newMsgs = Array.from({ length: 5 }, (_, i) => makeMsg('user', `new${i}`));
    // userId null → isNewConversation triggers new session, not transient
    const entry = makeEntry(newMsgs, { userId: null });

    const result = mergeMainAgentSessions([session], entry);

    // 5 < 20*0.5=10 && 20-5=15 > 4 → isNewConversation=true
    // 5 <= 4 is FALSE → NOT transient → new session should be created
    assert.equal(result.length, 2, 'should create a new session');
    assert.equal(result[1].messages.length, 5);
  });
});

describe('null timestamp in entry', () => {
  it('assigns null _timestamp to new messages without crashing', () => {
    const existingMsgs = [makeMsg('user', 'q1')];
    const session = makeSession(existingMsgs);
    const entry = makeEntry(
      [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')],
      { userId: 'user-1', timestamp: null }
    );
    // Override timestamp to null (makeEntry defaults to Date string)
    entry.timestamp = null;

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, 2);
    assert.equal(result[0].messages[1]._timestamp, null, '_timestamp should be null, not undefined');
    assert.equal(result[0].entryTimestamp, null);
  });
});
