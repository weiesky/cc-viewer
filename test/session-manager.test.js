/**
 * Unit tests for src/utils/sessionManager.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOT_SESSION_COUNT,
  buildSessionIndex,
  splitHotCold,
  mergeSessionIndices,
} from '../src/utils/sessionManager.js';

// ─── Test helpers ─────────────────────────────────────────────────��───────────

function makeEntry(sessionId, ts, opts = {}) {
  return {
    _sessionId: sessionId,
    timestamp: ts,
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    ...opts,
  };
}

function makeSession(msgCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content = opts.userText && role === 'user' && i === 0
      ? opts.userText
      : `msg-${i}`;
    messages.push({ role, content });
  }
  return {
    userId: opts.userId || 'user-1',
    messages,
    response: { status: 200, body: {} },
    entryTimestamp: opts.entryTimestamp || null,
  };
}

// ─── HOT_SESSION_COUNT ───────────────────────────────────────────────────────

describe('HOT_SESSION_COUNT', () => {
  it('should be 8', () => {
    assert.equal(HOT_SESSION_COUNT, 8);
  });
});

// ─── buildSessionIndex ───────────────────────────────────────────────────────

describe('buildSessionIndex', () => {
  it('should build index from entries and sessions', () => {
    const sid0 = '2025-01-01T00:00:00Z';
    const sid1 = '2025-01-01T01:00:00Z';
    const entries = [
      makeEntry(sid0, '2025-01-01T00:00:00Z'),
      makeEntry(sid0, '2025-01-01T00:01:00Z'),
      makeEntry(sid1, '2025-01-01T01:00:00Z'),
      makeEntry(sid1, '2025-01-01T01:05:00Z'),
      makeEntry(sid1, '2025-01-01T01:10:00Z'),
    ];
    const sessions = [
      makeSession(4, { userId: 'alice', userText: 'Hello world', entryTimestamp: sid0 }),
      makeSession(6, { userId: 'bob', userText: 'Second session question', entryTimestamp: sid1 }),
    ];

    const index = buildSessionIndex(entries, sessions);

    assert.equal(index.length, 2);

    // Session 0
    assert.equal(index[0].sessionId, sid0);
    assert.equal(index[0].firstTs, '2025-01-01T00:00:00Z');
    assert.equal(index[0].lastTs, '2025-01-01T00:01:00Z');
    assert.equal(index[0].entryCount, 2);
    assert.equal(index[0].msgCount, 4);
    assert.equal(index[0].preview, 'Hello world');
    assert.equal(index[0].userId, 'alice');

    // Session 1
    assert.equal(index[1].sessionId, sid1);
    assert.equal(index[1].firstTs, '2025-01-01T01:00:00Z');
    assert.equal(index[1].lastTs, '2025-01-01T01:10:00Z');
    assert.equal(index[1].entryCount, 3);
    assert.equal(index[1].msgCount, 6);
    assert.equal(index[1].preview, 'Second session question');
    assert.equal(index[1].userId, 'bob');
  });

  it('should handle empty entries', () => {
    const index = buildSessionIndex([], []);
    assert.equal(index.length, 0);
  });

  it('should extract preview from array content blocks', () => {
    const sid = '2025-01-01T00:00:00Z';
    const entries = [makeEntry(sid, '2025-01-01T00:00:00Z')];
    const sessions = [{
      userId: 'u1',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Array content preview' }] },
        { role: 'assistant', content: 'response' },
      ],
      response: {},
      entryTimestamp: sid,
    }];

    const index = buildSessionIndex(entries, sessions);
    assert.equal(index[0].preview, 'Array content preview');
  });

  it('should truncate preview to 80 characters', () => {
    const longText = 'A'.repeat(120);
    const sid = '2025-01-01T00:00:00Z';
    const entries = [makeEntry(sid, '2025-01-01T00:00:00Z')];
    const sessions = [makeSession(2, { userText: longText, entryTimestamp: sid })];

    const index = buildSessionIndex(entries, sessions);
    assert.equal(index[0].preview.length, 80);
  });

  it('should skip entries with null _sessionId', () => {
    const sid0 = '2025-01-01T00:00:00Z';
    const sid1 = '2025-01-01T01:00:00Z';
    const entries = [
      makeEntry(sid0, '2025-01-01T00:00:00Z'),
      { timestamp: '2025-01-01T00:30:00Z', url: 'x', _sessionId: undefined },
      makeEntry(sid1, '2025-01-01T01:00:00Z'),
    ];
    const sessions = [
      makeSession(2, { entryTimestamp: sid0 }),
      makeSession(2, { entryTimestamp: sid1 }),
    ];

    const index = buildSessionIndex(entries, sessions);
    assert.equal(index[0].entryCount, 1);
    assert.equal(index[1].entryCount, 1);
  });

  it('should handle sessions without matching entry groups', () => {
    const sid0 = '2025-01-01T00:00:00Z';
    const sid1 = '2025-01-01T01:00:00Z';
    const entries = [makeEntry(sid0, '2025-01-01T00:00:00Z')];
    const sessions = [
      makeSession(2, { entryTimestamp: sid0 }),
      makeSession(3, { entryTimestamp: sid1 }),
    ];

    const index = buildSessionIndex(entries, sessions);
    assert.equal(index.length, 2);
    assert.equal(index[0].entryCount, 1);
    assert.equal(index[1].entryCount, 0); // no entries for session 1
    assert.equal(index[1].msgCount, 3);
  });

  it('should use entryTimestamp as fallback for lastTs', () => {
    const sid = '2025-06-01T00:00:00Z';
    const entries = [{ _sessionId: sid, url: 'x' }]; // no timestamp
    const sessions = [makeSession(2, { entryTimestamp: sid })];

    const index = buildSessionIndex(entries, sessions);
    // firstTs/lastTs from entries are null, lastTs falls back to entryTimestamp
    assert.equal(index[0].lastTs, '2025-06-01T00:00:00Z');
  });
});

// ─── splitHotCold ────────────────────────────────────────────────────────────

describe('splitHotCold', () => {
  function makeScenario(sessionCount) {
    const entries = [];
    const sessions = [];
    const sessionIndex = [];
    for (let s = 0; s < sessionCount; s++) {
      const ts = `2025-01-${String(s + 1).padStart(2, '0')}T00:00:00Z`;
      entries.push(makeEntry(ts, ts));
      entries.push(makeEntry(ts, ts));
      sessions.push(makeSession(4, { userId: `user-${s}`, userText: `Session ${s}`, entryTimestamp: ts }));
      sessionIndex.push({
        sessionId: ts,
        firstTs: ts,
        lastTs: ts,
        entryCount: 2,
        msgCount: 4,
        preview: `Session ${s}`,
        userId: `user-${s}`,
      });
    }
    return { entries, sessions, sessionIndex };
  }

  it('should return all entries as hot when sessions <= hotCount', () => {
    const { entries, sessions, sessionIndex } = makeScenario(5);
    const result = splitHotCold(entries, sessions, sessionIndex, 8);

    assert.equal(result.hotEntries, entries); // same reference
    assert.equal(result.allSessions, sessions);
    assert.equal(result.coldGroups.size, 0);
  });

  it('should split hot and cold when sessions > hotCount', () => {
    const { entries, sessions, sessionIndex } = makeScenario(12);
    const result = splitHotCold(entries, sessions, sessionIndex, 8);

    // 12 sessions, hot = last 8 (idx 4-11), cold = first 4 (idx 0-3)
    assert.equal(result.hotEntries.length, 16); // 8 sessions * 2 entries each
    assert.equal(result.coldGroups.size, 4);
    assert.equal(result.allSessions.length, 12);

    // Verify cold sessions are placeholders
    for (let i = 0; i < 4; i++) {
      assert.equal(result.allSessions[i]._cold, true);
      assert.equal(result.allSessions[i].messages, null);
      assert.equal(result.allSessions[i].response, null);
      assert.equal(result.allSessions[i].sessionId, sessionIndex[i].sessionId);
      assert.equal(result.allSessions[i].preview, `Session ${i}`);
      assert.equal(result.allSessions[i].userId, `user-${i}`);
    }

    // Verify hot sessions are unchanged
    for (let i = 4; i < 12; i++) {
      assert.equal(result.allSessions[i]._cold, undefined);
      assert.ok(Array.isArray(result.allSessions[i].messages));
    }

    // Verify cold groups contain correct entries
    for (let i = 0; i < 4; i++) {
      const sid = sessionIndex[i].sessionId;
      const group = result.coldGroups.get(sid);
      assert.ok(group);
      assert.equal(group.length, 2);
      assert.equal(group[0]._sessionId, sid);
    }

    // Verify hot entries all have sessionId in hot range
    const hotSids = new Set(sessionIndex.slice(4).map(s => s.sessionId));
    for (const e of result.hotEntries) {
      assert.ok(hotSids.has(e._sessionId));
    }
  });

  it('should handle exact hotCount match', () => {
    const { entries, sessions, sessionIndex } = makeScenario(8);
    const result = splitHotCold(entries, sessions, sessionIndex, 8);

    assert.equal(result.hotEntries, entries);
    assert.equal(result.coldGroups.size, 0);
  });

  it('should handle hotCount of 1', () => {
    const { entries, sessions, sessionIndex } = makeScenario(3);
    const result = splitHotCold(entries, sessions, sessionIndex, 1);

    // Only the last session is hot
    assert.equal(result.hotEntries.length, 2);
    assert.equal(result.coldGroups.size, 2);
    assert.equal(result.allSessions[0]._cold, true);
    assert.equal(result.allSessions[1]._cold, true);
    assert.equal(result.allSessions[2]._cold, undefined);
  });

  it('should pin sessions to prevent eviction', () => {
    const { entries, sessions, sessionIndex } = makeScenario(12);
    // Pin session 0 (cold by default) — it should stay hot
    const pinnedId = sessionIndex[0].sessionId;
    const result = splitHotCold(entries, sessions, sessionIndex, 8, new Set([pinnedId]));

    // Session 0 is pinned, so it should be hot (not cold)
    assert.equal(result.allSessions[0]._cold, undefined);
    assert.ok(Array.isArray(result.allSessions[0].messages));

    // Pinned session's entries should be in hotEntries
    const pinnedEntries = result.hotEntries.filter(e => e._sessionId === pinnedId);
    assert.equal(pinnedEntries.length, 2);

    // One additional session should become cold to make room for the pinned one
    // Total cold should be 4 (12 - 8), with 1 pinned, means 4 cold sessions
    assert.equal(result.coldGroups.size, 4);
    assert.ok(!result.coldGroups.has(pinnedId));
  });
});

// ─── mergeSessionIndices ─────────────────────────────────────────────────────

describe('mergeSessionIndices', () => {
  function idx(sessionId, preview) {
    return { sessionId, preview, firstTs: null, lastTs: null, entryCount: 0, msgCount: 0, userId: null };
  }

  it('should return newIndex when oldIndex is empty', () => {
    const result = mergeSessionIndices([], [idx('ts-a', 'a'), idx('ts-b', 'b')]);
    assert.equal(result.length, 2);
    assert.equal(result[0].preview, 'a');
  });

  it('should return oldIndex when newIndex is empty', () => {
    const result = mergeSessionIndices([idx('ts-a', 'a')], []);
    assert.equal(result.length, 1);
    assert.equal(result[0].preview, 'a');
  });

  it('should return newIndex when oldIndex is null', () => {
    const result = mergeSessionIndices(null, [idx('ts-a', 'a')]);
    assert.equal(result.length, 1);
  });

  it('should return empty array when both are null', () => {
    const result = mergeSessionIndices(null, null);
    assert.equal(result.length, 0);
  });

  it('should merge non-overlapping indices', () => {
    const old = [idx('2025-01-01T00:00:00Z', 'old-0'), idx('2025-01-01T01:00:00Z', 'old-1')];
    const nw = [idx('2025-01-01T02:00:00Z', 'new-2'), idx('2025-01-01T03:00:00Z', 'new-3')];
    const result = mergeSessionIndices(old, nw);

    assert.equal(result.length, 4);
    assert.equal(result[0].preview, 'old-0');
    assert.equal(result[1].preview, 'old-1');
    assert.equal(result[2].preview, 'new-2');
    assert.equal(result[3].preview, 'new-3');
  });

  it('should overwrite overlapping indices with new values', () => {
    const old = [idx('ts-0', 'old-0'), idx('ts-1', 'old-1'), idx('ts-2', 'old-2')];
    const nw = [idx('ts-1', 'new-1'), idx('ts-2', 'new-2'), idx('ts-3', 'new-3')];
    const result = mergeSessionIndices(old, nw);

    assert.equal(result.length, 4);
    assert.equal(result[0].preview, 'old-0');  // kept from old
    assert.equal(result[1].preview, 'new-1');  // overwritten by new
    assert.equal(result[2].preview, 'new-2');  // overwritten by new
    assert.equal(result[3].preview, 'new-3');  // from new
  });

  it('should sort result by sessionId', () => {
    const old = [idx('ts-c', 'old-c')];
    const nw = [idx('ts-a', 'new-a'), idx('ts-b', 'new-b')];
    const result = mergeSessionIndices(old, nw);

    assert.equal(result.length, 3);
    assert.equal(result[0].sessionId, 'ts-a');
    assert.equal(result[1].sessionId, 'ts-b');
    assert.equal(result[2].sessionId, 'ts-c');
  });
});
