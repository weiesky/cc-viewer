/**
 * Unit tests for src/utils/sessionMerge.js
 * Covers incremental push, checkpoint, response-only update, new session, transient, _timestamp, and streaming dedup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMainAgentSessions, messageFingerprint } from '../src/utils/sessionMerge.js';

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

  it('passes mid-conversation role:"system" string messages through unchanged', () => {
    // mid-conversation-system beta: deltas may append [assistant, user, system]
    const existingMsgs = [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')];
    const session = makeSession(existingMsgs);
    const originalRef = session.messages;

    const newMsgs = [
      makeMsg('user', 'q1'), makeMsg('assistant', 'a1'),
      makeMsg('user', 'q2'), makeMsg('assistant', 'a2'), makeMsg('system', 'gentle reminder'),
    ];
    const result = mergeMainAgentSessions([session], makeEntry(newMsgs));

    assert.equal(result.length, 1);
    assert.equal(result[0].messages, originalRef);
    assert.equal(result[0].messages.length, 5);
    assert.equal(result[0].messages[4].role, 'system');
    assert.equal(result[0].messages[4].content, 'gentle reminder');
    // fingerprint handles system role + string content (anchor validity)
    const fp = messageFingerprint(makeMsg('system', 'gentle reminder'));
    assert.ok(fp.startsWith('system|'), `unexpected fingerprint: ${fp}`);
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

// ─── 8.5 Plan Mode CLI 上下文压缩窗口（messageFingerprint 内容感知合并） ─────────────────
// 真实场景：ExitPlanMode 审批前后，CLI 把累积历史压缩成 [latest assistant, latest tool_result]
// 两条 sliding window 重复发起请求。原 sessionMerge 仅看长度无法区分流式 vs 新片段。

describe('Plan Mode compression: exact-length but different content', () => {
  it('appends new conversation fragment when newLen===currentLen but content differs', () => {
    // 模拟 jsonl 真实时序：01:45:42 entry messages=[Write tool_use, Write tool_result]
    // 紧接 01:45:57 entry messages=[ExitPlanMode tool_use, ExitPlanMode tool_result]，长度同样为 2 但内容完全不同。
    const writeTu = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_write', name: 'Write' }] };
    const writeTr = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_write', content: 'ok' }] };
    const session = makeSession([writeTu, writeTr], { userId: 'u1' });

    const planTu = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_plan', name: 'ExitPlanMode' }] };
    const planTr = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_plan', content: 'User has approved your plan.\n## Approved Plan:\n# X' }] };
    const entry = makeEntry([planTu, planTr], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 4, 'should append to 4 messages');
    assert.equal(result[0].messages[2].content[0].id, 'tu_plan', 'ExitPlanMode tool_use appended');
    assert.equal(result[0].messages[3].content[0].tool_use_id, 'tu_plan', 'tool_result appended');
  });

  it('skips overlapping prefix when newLen===currentLen and first K fingerprints match tail', () => {
    // CLI 偶发场景：新窗口前 K 条与历史末尾 K 条重复（前缀重叠），末尾不同
    // 修复后应只 push newMessages[K..]，不重复 push 重叠部分
    const a = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_a', name: 'Read' }] };
    const b = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_a', content: 'r' }] };
    const c = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_c', name: 'Bash' }] };
    const d = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_c', content: 'r2' }] };
    const session = makeSession([a, b, c, d], { userId: 'u1' });

    // newMessages: 前 2 条 fp 与末尾 2 条相同，后 2 条全新
    const c2 = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_c', name: 'Bash' }] };
    const d2 = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_c', content: 'r2' }] };
    const e = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_e', name: 'Edit' }] };
    const f = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_e', content: 'r3' }] };
    const entry = makeEntry([c2, d2, e, f], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 6, 'should be 4 + 2 (only non-overlap part appended)');
    assert.equal(result[0].messages[4].content[0].id, 'tu_e', 'tu_e appended');
    assert.equal(result[0].messages[5].content[0].tool_use_id, 'tu_e', 'tu_e tool_result appended');
  });

  it('keeps stable reference when newLen===currentLen and content matches (streaming)', () => {
    // 同 entry 流式更新：messages 内容完全一致、仅 response 增量。原行为必须保留。
    const tu = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'Read' }] };
    const tr = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_x', content: 'ok' }] };
    const session = makeSession([tu, tr], { userId: 'u1' });
    const ref = session.messages;

    const tu2 = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'Read' }] };
    const tr2 = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_x', content: 'ok' }] };
    const entry = makeEntry([tu2, tr2], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 2, 'no append');
    assert.strictEqual(result[0].messages, ref, 'reference stable');
  });
});

describe('Plan Mode compression: newLen<currentLen but is suffix subset', () => {
  it('preserves history when newMessages is suffix of lastSession.messages', () => {
    // 模拟 currentLen=148 末尾两条 = [EnterPlanMode tu, tr]，CLI 下一轮发的窗口也是同样 [EnterPlanMode tu, tr]。
    // 原代码会触发 newLen<currentLen → 重建路径，把累积 148 条历史抹掉。修复后应识别为压缩窗口、保留。
    const enterTu = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_enter', name: 'EnterPlanMode' }] };
    const enterTr = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_enter', content: 'ok' }] };
    const head = Array.from({ length: 146 }, (_, i) => makeMsg('user', `q${i}`));
    const fullMsgs = [...head, enterTu, enterTr];
    const session = makeSession(fullMsgs, { userId: 'u1' });
    const ref = session.messages;

    const entry = makeEntry([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_enter', name: 'EnterPlanMode' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_enter', content: 'ok' }] },
    ], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 148, 'history preserved');
    assert.strictEqual(result[0].messages, ref, 'reference stable, no rebuild');
  });

  it('rebuilds when newLen<currentLen and content does NOT match (real /compact)', () => {
    // /compact summary 替换：messages 缩短且内容是新 summary。fingerprint 跟原历史末尾不匹配 → 走重建（保持原行为）。
    const oldMsgs = Array.from({ length: 20 }, (_, i) => makeMsg('user', `old${i}`));
    const session = makeSession(oldMsgs, { userId: 'u1' });
    const newMsgs = Array.from({ length: 6 }, (_, i) => makeMsg('user', `summary${i}`));
    const entry = makeEntry(newMsgs, { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 6, 'rebuilt to new length');
    assert.strictEqual(result[0].messages, newMsgs, 'reference replaced with new');
  });
});

// ─── 9. /clear checkpoint detection (regression for 16:12:11 → 16:15:11 misplacement) ──

describe('post-/clear checkpoint creates new session entry', () => {
  // 构造 /clear 后的真实首请求结构：
  // _isCheckpoint=true, msg[0] 含 <command-name>/clear</command-name>。
  // 同 device → sameUser=true，旧逻辑会被吞进同 session（或被 transient 丢掉），
  // 新逻辑必须创建新 session 且 _timestamp 用 entry 自己的 ts。
  function makeClearEntry(opts = {}) {
    const userBlock = {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>session start</system-reminder>' },
        { type: 'text', text: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>\n' },
        { type: 'text', text: '<local-command-stdout></local-command-stdout>' },
        { type: 'text', text: 'hello after clear' },
      ],
    };
    return {
      timestamp: opts.timestamp || '2026-04-25T08:12:11.330Z',
      mainAgent: true,
      _deltaFormat: 1,
      _isCheckpoint: true,
      _totalMessageCount: 1,
      body: {
        messages: [userBlock],
        metadata: { user_id: 'userId' in opts ? opts.userId : 'user-1' },
      },
      response: opts.response || { status: 200, body: { content: [] } },
    };
  }

  it('creates a new session entry under batch path (default options) when prev is long same-user session', () => {
    const longPrev = Array.from({ length: 33 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`, { _timestamp: '2026-04-25T05:28:00.000Z' }));
    const session = makeSession(longPrev, { userId: 'user-1', entryTimestamp: '2026-04-25T05:29:00.000Z' });

    const entry = makeClearEntry({ timestamp: '2026-04-25T08:12:11.330Z' });

    // 旧逻辑：transient 过滤吞掉（newLen=1, prev=33）→ 旧 session 不动，新 entry 丢失。
    // 新逻辑：必须先于 transient 过滤识别为 /clear，创建新 session。
    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 2, '应当生成两个 session（旧 deepseek + 新 /clear）');
    assert.equal(result[0].messages.length, 33, '旧 session 不动');
    assert.equal(result[1].messages.length, 1, '新 session 包含 /clear 那条 msg');
    assert.equal(result[1].messages[0]._timestamp, '2026-04-25T08:12:11.330Z', '_timestamp 必须是 entry 自己的 ts');
    assert.equal(result[1].entryTimestamp, '2026-04-25T08:12:11.330Z');
    assert.equal(result[1].userId, 'user-1');
  });

  it('also creates a new session under SSE path with skipTransientFilter:true', () => {
    const longPrev = Array.from({ length: 33 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(longPrev, { userId: 'user-1' });
    const entry = makeClearEntry({ timestamp: '2026-04-25T08:12:11.330Z' });

    const result = mergeMainAgentSessions([session], entry, { skipTransientFilter: true });

    assert.equal(result.length, 2);
    assert.equal(result[1].messages[0]._timestamp, '2026-04-25T08:12:11.330Z');
  });

  it('does NOT split when checkpoint shrinks but msg[0] lacks /clear marker (e.g. /compact summary)', () => {
    const longPrev = Array.from({ length: 30 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(longPrev, { userId: 'user-1' });

    // /compact 后的首请求：msg[0] 是 user 的 summary block，没有 /clear 命令标记
    const compactEntry = {
      timestamp: '2026-04-25T08:14:35.954Z',
      mainAgent: true,
      _deltaFormat: 1,
      _isCheckpoint: true,
      _totalMessageCount: 2,
      body: {
        messages: [
          { role: 'user', content: [{ type: 'text', text: "The following is the user's CLAUDE.md configuration..." }] },
          { role: 'user', content: [{ type: 'text', text: 'continue' }] },
        ],
        metadata: { user_id: 'user-1' },
      },
      response: { status: 200, body: {} },
    };

    const result = mergeMainAgentSessions([session], compactEntry, { skipTransientFilter: true });

    // 不是 /clear → 走原 same-session checkpoint 分支（替换 messages，不创建新 session）
    assert.equal(result.length, 1, '/compact 不应该创建新 session');
    assert.equal(result[0].messages.length, 2);
  });

  it('does NOT split for incremental re-snapshot (count >= prevCount, even if msg[0] still has /clear)', () => {
    // 已经有一个 /clear 后的 session（2 条 msg）
    const m0WithClear = { role: 'user', content: [{ type: 'text', text: '<command-name>/clear</command-name>\nhello' }] };
    const prevMsgs = [m0WithClear, makeMsg('assistant', 'hi')];
    const session = makeSession(prevMsgs, { userId: 'user-1' });

    // 后续的 17-msg 再快照：msg[0] 还是含 /clear（CC 始终重发会话前缀），
    // 但 count(17) >= prevCount(2) → 同会话的再快照，不是新 /clear
    const grew = [m0WithClear, ...Array.from({ length: 16 }, (_, i) => makeMsg(i % 2 === 0 ? 'assistant' : 'user', `g${i}`))];
    const reSnapshot = {
      timestamp: '2026-04-25T08:16:48.846Z',
      mainAgent: true,
      _deltaFormat: 1,
      _isCheckpoint: true,
      _totalMessageCount: 17,
      body: { messages: grew, metadata: { user_id: 'user-1' } },
      response: { status: 200, body: {} },
    };

    const result = mergeMainAgentSessions([session], reSnapshot, { skipTransientFilter: true });

    assert.equal(result.length, 1, '同会话再快照不应该创建新 session');
    assert.equal(result[0].messages.length, 17);
  });

  it('two consecutive /clear commands create two distinct sessions', () => {
    // 罕见但合理：用户在 /clear 后立即又 /clear
    // 第一个 /clear 创建 session #2，messages.length=1。
    // 第二个 /clear（_isCheckpoint=true, msg.length=1, msg[0] 含 /clear marker）
    // 必须满足 isPostClearCheckpoint 的 shrink 条件：msgs.length(1) < prevCount(1) → FALSE
    // → 不应再创建 session #3，而是走 same-session checkpoint 替换 messages 引用。
    // 这条用例锁死该语义：连续 /clear 不会无限增殖 session 条目。
    const longPrev = Array.from({ length: 33 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(longPrev, { userId: 'user-1' });

    const firstClear = makeClearEntry({ timestamp: '2026-04-25T08:12:11.330Z' });
    const afterFirst = mergeMainAgentSessions([session], firstClear);
    assert.equal(afterFirst.length, 2, '第一次 /clear 创建新 session');
    assert.equal(afterFirst[1].messages.length, 1);

    const secondClear = makeClearEntry({ timestamp: '2026-04-25T08:13:00.000Z' });
    const afterSecond = mergeMainAgentSessions(afterFirst, secondClear);

    // 期望：sessions 仍是 2 条（不再分裂），第二条 session 被 same-session checkpoint 替换为新 msgs
    assert.equal(afterSecond.length, 2, '连续 /clear 不应无限增殖 session');
    assert.equal(afterSecond[1].messages.length, 1);
    assert.equal(afterSecond[1].entryTimestamp, '2026-04-25T08:13:00.000Z', 'entryTimestamp 更新到第二次 /clear');
  });

  it('handles entry.timestamp === null gracefully in /clear path', () => {
    const longPrev = Array.from({ length: 30 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(longPrev, { userId: 'user-1' });

    const entry = makeClearEntry({ timestamp: null });
    entry.timestamp = null; // 明确 null

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result.length, 2);
    assert.equal(result[1].messages[0]._timestamp, null, '_timestamp 应为 null（非 undefined）');
    assert.equal(result[1].entryTimestamp, null);
  });

  it('does NOT split when entry has no _isCheckpoint flag (legacy non-delta log)', () => {
    const longPrev = Array.from({ length: 30 }, (_, i) => makeMsg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const session = makeSession(longPrev, { userId: 'user-1' });

    // 旧格式日志：没有 _isCheckpoint，但 msg[0] 含 /clear
    const legacyEntry = {
      timestamp: '2026-04-25T08:12:11.330Z',
      mainAgent: true,
      body: {
        messages: [{ role: 'user', content: [{ type: 'text', text: '<command-name>/clear</command-name>\nhi' }] }],
        metadata: { user_id: 'user-1' },
      },
      response: { status: 200, body: {} },
    };

    const result = mergeMainAgentSessions([session], legacyEntry, { skipTransientFilter: true });

    // 没有 _isCheckpoint → 不触发新逻辑，走原 same-session checkpoint 替换
    assert.equal(result.length, 1, '旧格式日志保持原行为');
    assert.equal(result[0].messages.length, 1);
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

// ─── reverse anchor regression — 锁死「反向锚点 + fp 三元组」对正向 prefix-overlap 翻车场景的修复
// 来源：commit 9711024 在分支 claude/fix-mainagent-copy-bug-nq4m8 上写好但未合并到 main 的 6 case。
// 主合并路径已切换为反向锚点算法后，这 6 case 锁死核心翻车场景。

describe('reverse anchor regression', () => {
  it('does NOT misjudge overlap when text-only msgs share 64-char prefix but differ overall', () => {
    // 旧"正向 prefix-overlap"用 slice(0, 64) 做 fp，遇到这种共有头部的 text 会
    // 误判成 K=2 overlap、把后两条真新增切掉。新算法多块连续校验 + len/last32 加固，
    // anchor 不应命中，整段 append。
    // sharedHead + commonPart 必须 ≥ 64 字符以真触发旧 slice(0,64) 共有前缀碰撞场景；
    // 否则旧算法在 64 字符内就能区分两边，这条 case 实际未在 1.6.245 路径上验证过翻车。
    const sharedHead = '<system-reminder>MCP Server instructions follow</system-reminder>'; // 64 chars
    const commonPart = ' shared prefix block before any differentiator '; // 47 chars
    const cur = [
      { role: 'user', content: sharedHead + commonPart + 'user prompt one body Q1' },
      { role: 'assistant', content: sharedHead + commonPart + 'assistant reply one body A1' },
      { role: 'user', content: sharedHead + commonPart + 'user prompt two body Q2' },
      { role: 'assistant', content: sharedHead + commonPart + 'assistant reply two body A2' },
    ];
    const session = makeSession(cur, { userId: 'u1' });

    const newMsgs = [
      { role: 'user', content: sharedHead + commonPart + 'user prompt three body Q3' },
      { role: 'assistant', content: sharedHead + commonPart + 'assistant reply three body A3' },
      { role: 'user', content: sharedHead + commonPart + 'user prompt four body Q4' },
      { role: 'assistant', content: sharedHead + commonPart + 'assistant reply four body A4' },
    ];
    const entry = makeEntry(newMsgs, { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    // newLen===curLen===4，无真重叠 → anchor 未命中 → 整段 append → 8
    // 旧算法（slice(0,64) 单条 fp）会取大 K=4 overlap → 4 条新增全丢；新算法 length+last32 区分。
    assert.equal(result[0].messages.length, 8, '应当整段 append 不被前 64 字符共有前缀骗到');
  });

  it('appends only non-overlap suffix when newLen>curLen with K-msg tail overlap', () => {
    // 用户报的核心翻车：CLI Plan Mode 后偶发发出 "K 条与末尾重叠 + 后段新增" 但
    // newLen > curLen 的窗口；旧 newLen>curLen 分支盲推 newMsgs[curLen..] →
    // 重叠 K 条会被当新内容再 push 一遍、同对话出现两次相同消息（"复制"翻车）。
    const a = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_a', name: 'Read' }] };
    const b = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_a', content: 'r' }] };
    const c = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_c', name: 'Bash' }] };
    const d = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_c', content: 'r2' }] };
    const session = makeSession([a, b, c, d], { userId: 'u1' });
    const ref = session.messages;

    const c2 = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_c', name: 'Bash' }] };
    const d2 = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_c', content: 'r2' }] };
    const e = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_e', name: 'Edit' }] };
    const f = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_e', content: 'r3' }] };
    const g = { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_g', name: 'Write' }] };
    const entry = makeEntry([c2, d2, e, f, g], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, 7, '只 push 非重叠尾段，不重 push 重叠 c d');
    assert.strictEqual(result[0].messages, ref, 'messages 引用稳定保 WeakMap 缓存');
    assert.equal(result[0].messages[4].content[0].id, 'tu_e');
    assert.equal(result[0].messages[6].content[0].id, 'tu_g');
  });

  it('strict prefix extension still works (newMsgs[0..curLen]==curMsgs)', () => {
    // 经典流式：curMsgs=[a,b]，newMsgs=[a,b,c,d,e]。anchor 命中 p=0 / L=2 → push [c,d,e]。
    const a = { role: 'user', content: 'q1' };
    const b = { role: 'assistant', content: 'a1' };
    const session = makeSession([a, b], { userId: 'u1' });
    const ref = session.messages;

    const a2 = { role: 'user', content: 'q1' };
    const b2 = { role: 'assistant', content: 'a1' };
    const c = { role: 'user', content: 'q2' };
    const d = { role: 'assistant', content: 'a2' };
    const e = { role: 'user', content: 'q3' };
    const entry = makeEntry([a2, b2, c, d, e], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, 5);
    assert.strictEqual(result[0].messages, ref, '严格前缀扩展引用稳定');
    assert.equal(result[0].messages[2].content, 'q2');
  });

  it('suffix-subset window keeps reference stable (anchor.overlapLen === newLen no-op)', () => {
    // CLI 上下文压缩窗口：newMsgs 是 lastSession.messages 末尾 N 条。anchor 命中、L===newLen → no-op。
    const head = Array.from({ length: 8 }, (_, i) => makeMsg('user', `h${i}`));
    const xy = [makeMsg('user', 'X-content'), makeMsg('assistant', 'Y-content')];
    const session = makeSession([...head, ...xy], { userId: 'u1' });
    const ref = session.messages;
    const lenBefore = ref.length;

    const entry = makeEntry([
      makeMsg('user', 'X-content'),
      makeMsg('assistant', 'Y-content'),
    ], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, lenBefore, '保留累积历史不动');
    assert.strictEqual(result[0].messages, ref, '引用稳定');
  });

  it('null/empty content does not crash and falls through to length-based fallback', () => {
    // newMsgs[0] 是空 content 数组——fp 形如 'role|empty'，反向 anchor 必须不当锚点（否则
    // 会和 curMsgs 中任何空 content 误命中）。
    const cur = Array.from({ length: 3 }, (_, i) => makeMsg('user', `m${i}`));
    const session = makeSession(cur, { userId: 'u1' });

    const empty = { role: 'user', content: [] };
    const real = { role: 'assistant', content: 'real reply' };
    const entry = makeEntry([empty, real], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    // newLen=2 < curLen=3 且 anchor 未命中 → /compact rebuild 路径，messages 替换。
    assert.equal(result[0].messages.length, 2, 'rebuild 替换为 newMsgs');
    assert.equal(result[0].messages[1].content, 'real reply');
  });

  it('reverse scan picks rightmost candidate when multiple text msgs share fp', () => {
    // curMsgs 中有 3 条相同 text，newMsgs[0] fp 与之相同。反向扫从末尾开始，
    // 必须命中最右那条（p=2），从而 overlapLen=min(newLen, curLen-2)=1，append 余下。
    const cur = [
      { role: 'user', content: 'TTT' },
      { role: 'user', content: 'TTT' },
      { role: 'user', content: 'TTT' },
    ];
    const session = makeSession(cur, { userId: 'u1' });
    const ref = session.messages;

    const T2 = { role: 'user', content: 'TTT' };
    const U = { role: 'assistant', content: 'after' };
    const entry = makeEntry([T2, U], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry);

    assert.equal(result[0].messages.length, 4);
    assert.strictEqual(result[0].messages, ref);
    assert.equal(result[0].messages[3].content, 'after');
  });
});

// ─── 短消息 fp 三元组健壮性 — 防 length<32 时 first32===last32 重叠引发抗碰撞退化

describe('short-message fp robustness', () => {
  it('1-character message does not collide with completely different 1-char message', () => {
    // length=1 时 first32===last32===原文，fp 仍含 length 字段，相异内容必产生不同 fp。
    const session = makeSession([makeMsg('user', 'a'), makeMsg('assistant', 'b')], { userId: 'u1' });

    // 用 newLen===curLen 末位差异路径检验 fp 区分能力
    const entry = makeEntry([makeMsg('user', 'x'), makeMsg('assistant', 'y')], { userId: 'u1' });
    const result = mergeMainAgentSessions([session], entry);

    // newMsgs[0]='x' fp 与 curMsgs 中所有 fp 都不同 → anchor null →
    // newLen===curLen 等长 fallback → 整段 append → 4
    assert.equal(result[0].messages.length, 4, '短消息无重叠应整段 append');
    assert.equal(result[0].messages[2].content, 'x');
    assert.equal(result[0].messages[3].content, 'y');
  });

  it('16-char message: anchor correctly detects identical content, distinguishes different content', () => {
    const A = 'aaaaaaaaaaaaaaaa'; // 16 chars
    const B = 'bbbbbbbbbbbbbbbb'; // 16 chars
    const session = makeSession([makeMsg('user', A), makeMsg('assistant', B)], { userId: 'u1' });
    const ref = session.messages;

    // newMsgs 完全等于 curMsgs → anchor p=0 overlapLen=2 === newLen → no-op
    const entry = makeEntry([makeMsg('user', A), makeMsg('assistant', B)], { userId: 'u1' });
    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 2, '16 字符等同内容 anchor 命中走 no-op');
    assert.strictEqual(result[0].messages, ref, '引用稳定');
  });

  it('31-char message at boundary: fp triple still distinguishes different content', () => {
    // 31 chars 仍触 first32===last32 重叠。验证 length+content 三元组在边界仍工作。
    const A = 'a'.repeat(31);
    const B = 'b'.repeat(31);
    const C = 'c'.repeat(30) + 'X'; // 31 chars 但末位不同
    const session = makeSession([makeMsg('user', A), makeMsg('assistant', B)], { userId: 'u1' });
    const ref = session.messages;

    // newMsgs[0]=A 锚点命中 p=0，overlapLen=min(2,2)=2，校验 newMsgs[1]=C vs curMsgs[1]=B
    // fp 异（两 string 长度都 31 但 last32 不同）→ anchor 验证失败 → 继续向左找无结果 → null
    // newLen===curLen 等长 fallback → 整段 append
    const entry = makeEntry([makeMsg('user', A), makeMsg('assistant', C)], { userId: 'u1' });
    const result = mergeMainAgentSessions([session], entry);
    assert.equal(result[0].messages.length, 4, '31 字符末位差异 fp 应能区分');
    assert.equal(result[0].messages[3].content, C);
    // 引用变化（push 进了新内容）
    assert.strictEqual(result[0].messages, ref, 'push 模式引用稳定');
  });
});

// ─── 末尾消息重排序场景 — review R1 D3 边界 case

describe('reordered tail anchor disambiguation', () => {
  it('reordered tail [m147, m146] does not falsely anchor to [m146, m147]', () => {
    // 如果 newMsgs=[m147, m146]（重排序）且 curMsgs 末尾正好是 [m146, m147]
    // 反向锚点找 newMsgs[0]=m147 在 curMsgs 末尾 p=last 命中，overlapLen=min(2,1)=1
    // → push newMsgs[1..]=[m146] → curMsgs 变成 [..., m146, m147, m146]
    // 该结果不"复制"也不"丢"—— m146 出现两次，但这是用户重发 m146 的合理后果（CLI 偶发）。
    //
    // 用 skipTransientFilter:true 模拟 SSE 实时路径，否则 newLen=2 + isNewConversation 命中 transient 过滤。
    const head = Array.from({ length: 145 }, (_, i) => makeMsg('user', `h${i}`));
    const m146 = makeMsg('user', 'msg146-distinct-content-X');
    const m147 = makeMsg('assistant', 'msg147-distinct-content-Y');
    const session = makeSession([...head, m146, m147], { userId: 'u1' });

    // newMsgs 把末尾两条颠倒
    const m147new = makeMsg('assistant', 'msg147-distinct-content-Y');
    const m146new = makeMsg('user', 'msg146-distinct-content-X');
    const entry = makeEntry([m147new, m146new], { userId: 'u1' });

    const result = mergeMainAgentSessions([session], entry, { skipTransientFilter: true });
    // anchor 找 m147 命中 p=146（最右），overlapLen=min(2, 147-146)=1
    // → push newMsgs[1..]=[m146new]，长度 147+1=148
    assert.equal(result[0].messages.length, 148, '反向锚点处理重排序时只 push 非重叠 tail');
    // 末位是 m146new
    assert.equal(result[0].messages[147].content, 'msg146-distinct-content-X');
  });
});

// ─── fuzzy invariant — review R3 任务 2 提出的不变量测试

describe('fuzzy invariant: no fp-equivalent consecutive duplicates', () => {
  it('100 rounds of streaming/checkpoint/reset entries never produce two consecutive fp-equivalent msgs', () => {
    // 不变量：任何调用序列后，结果 lastSession.messages 中相邻消息 fp 不应连续相等
    // （tool_use/tool_result 配对场景下 fp 不同，文本相邻消息内容也应有 length 差异）。
    //
    // RNG 使用固定种子 0xdeadbeef + LCG 算法（参数取自 glibc rand），
    // 失败时直接重跑该 case 即可复现完全相同的随机序列。
    let sessions = [];
    let counter = 0;
    const rng = (() => {
      let seed = 0xdeadbeef;
      return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    })();

    for (let round = 0; round < 100; round++) {
      const action = rng();
      let msgs;
      if (action < 0.6) {
        // streaming append: 用累积历史 + 1-3 新消息
        const lastSession = sessions[sessions.length - 1];
        const lastMsgs = lastSession && lastSession.messages ? lastSession.messages : [];
        const additions = Math.floor(rng() * 3) + 1;
        msgs = [...lastMsgs];
        for (let i = 0; i < additions; i++) {
          counter++;
          msgs.push(makeMsg(counter % 2 === 0 ? 'user' : 'assistant', `r${round}-m${counter}-content-padding-text`));
        }
      } else if (action < 0.85) {
        // suffix subset (Plan Mode 压缩窗口): 末尾 1-3 条
        const lastSession = sessions[sessions.length - 1];
        const lastMsgs = lastSession && lastSession.messages ? lastSession.messages : [];
        if (lastMsgs.length === 0) {
          counter++;
          msgs = [makeMsg('user', `r${round}-m${counter}-content`)];
        } else {
          const tailLen = Math.min(lastMsgs.length, Math.floor(rng() * 3) + 1);
          msgs = lastMsgs.slice(-tailLen);
        }
      } else {
        // 全新片段（异 user 或 /clear 后）
        counter++;
        msgs = [makeMsg('user', `r${round}-fresh-${counter}-content-padding`)];
      }
      sessions = mergeMainAgentSessions(sessions, makeEntry(msgs, { userId: 'u1' }), { skipTransientFilter: true });
    }

    // 校验：所有 session 的相邻消息 fp 不应连续相等。复用 sessionMerge.js 的 messageFingerprint
    // 保持单一真理源；测试旁路自定义 fp 函数会出现"两边维护"的技术债。
    for (const s of sessions) {
      if (!s.messages) continue;
      for (let i = 1; i < s.messages.length; i++) {
        const fpA = messageFingerprint(s.messages[i - 1]);
        const fpB = messageFingerprint(s.messages[i]);
        if (fpA && fpB && fpA === fpB) {
          assert.fail(`session ${sessions.indexOf(s)} 相邻消息 fp 重复 at index ${i - 1}/${i}: ${fpA}`);
        }
      }
    }
  });
});
