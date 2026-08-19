/**
 * Unit tests for src/utils/clearCheckpoint.js
 * Direct branch coverage for isPostClearCheckpoint(entry, prevMessageCount).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPostClearCheckpoint, isCompactContinuation, isSessionBoundary } from '../packages/app/src/utils/clearCheckpoint.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function userMsg(blocks) {
  return { role: 'user', content: blocks };
}
function textBlock(text) {
  return { type: 'text', text };
}
const CLEAR_MARKER = '<command-name>/clear</command-name>';

function makeCheckpointEntry({ msgs, isCheckpoint = true } = {}) {
  return {
    _isCheckpoint: isCheckpoint,
    _deltaFormat: 1,
    _totalMessageCount: Array.isArray(msgs) ? msgs.length : 0,
    body: { messages: msgs, metadata: { user_id: 'user-1' } },
    timestamp: '2026-04-25T08:12:11.330Z',
  };
}

// ─── Early-return branches ────────────────────────────────────────────────────

describe('isPostClearCheckpoint — early returns', () => {
  it('returns false when entry is null', () => {
    assert.equal(isPostClearCheckpoint(null, 10), false);
  });

  it('returns false when entry is undefined', () => {
    assert.equal(isPostClearCheckpoint(undefined, 10), false);
  });

  it('returns false when _isCheckpoint is false', () => {
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])], isCheckpoint: false });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when _isCheckpoint is undefined', () => {
    const entry = { body: { messages: [userMsg([textBlock(CLEAR_MARKER)])] } };
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when _isCheckpoint is truthy non-strictly (e.g. 1)', () => {
    // 严格相等 === true，防止字段被异常类型污染
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])] });
    entry._isCheckpoint = 1;
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when body is missing', () => {
    const entry = { _isCheckpoint: true };
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when messages is not an array', () => {
    const entry = { _isCheckpoint: true, body: { messages: null } };
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when messages is empty', () => {
    const entry = makeCheckpointEntry({ msgs: [] });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });
});

// ─── Shrink-check branch ──────────────────────────────────────────────────────

describe('isPostClearCheckpoint — shrink check', () => {
  it('returns false when msgs.length === prevMessageCount (incremental re-snapshot)', () => {
    // 真实 fixture：L643 的 17 条再快照（msg[0] 仍含 /clear，但不是新 /clear）
    const entry = makeCheckpointEntry({
      msgs: [
        userMsg([textBlock(`prefix ${CLEAR_MARKER} suffix`)]),
        ...Array.from({ length: 16 }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', content: [textBlock(`m${i}`)] })),
      ],
    });
    assert.equal(isPostClearCheckpoint(entry, 17), false);
  });

  it('returns false when msgs.length > prevMessageCount', () => {
    const entry = makeCheckpointEntry({
      msgs: [
        userMsg([textBlock(CLEAR_MARKER)]),
        ...Array.from({ length: 4 }, () => ({ role: 'assistant', content: [textBlock('x')] })),
      ],
    });
    assert.equal(isPostClearCheckpoint(entry, 2), false);
  });

  it('returns true when msgs.length < prevMessageCount and other conditions hold', () => {
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])] });
    assert.equal(isPostClearCheckpoint(entry, 33), true);
  });

  it('returns true when prevMessageCount is 0 (first session ever)', () => {
    // prevMessageCount 默认 0 表示无前置 session；shrink check 应被跳过
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])] });
    assert.equal(isPostClearCheckpoint(entry, 0), true);
    assert.equal(isPostClearCheckpoint(entry), true); // default arg
  });

  it('returns true when prevMessageCount is omitted', () => {
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])] });
    assert.equal(isPostClearCheckpoint(entry), true);
  });
});

// ─── msg[0] structure branches ────────────────────────────────────────────────

describe('isPostClearCheckpoint — msg[0] structure', () => {
  it('returns false when msg[0] is null', () => {
    const entry = makeCheckpointEntry({ msgs: [null] });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when msg[0] role is assistant', () => {
    const entry = makeCheckpointEntry({
      msgs: [{ role: 'assistant', content: [textBlock(CLEAR_MARKER)] }],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when msg[0] role is system', () => {
    const entry = makeCheckpointEntry({
      msgs: [{ role: 'system', content: [textBlock(CLEAR_MARKER)] }],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when msg[0].content is a string (not array)', () => {
    const entry = makeCheckpointEntry({
      msgs: [{ role: 'user', content: `some text ${CLEAR_MARKER}` }],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false when msg[0].content is missing', () => {
    const entry = makeCheckpointEntry({ msgs: [{ role: 'user' }] });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });
});

// ─── /clear marker detection ──────────────────────────────────────────────────

describe('isPostClearCheckpoint — /clear marker detection', () => {
  it('returns false when msg[0] has no /clear marker', () => {
    const entry = makeCheckpointEntry({
      msgs: [userMsg([textBlock('hello'), textBlock('world')])],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });

  it('returns false for /compact summary (no /clear marker)', () => {
    // 真实 /compact fixture：msg[0] 是 user 的 summary block
    const entry = makeCheckpointEntry({
      msgs: [
        userMsg([textBlock("The following is the user's CLAUDE.md configuration. Treat it as authoritative...")]),
        userMsg([textBlock('continue')]),
      ],
    });
    assert.equal(isPostClearCheckpoint(entry, 30), false);
  });

  it('returns true when /clear marker is in any text block (not just block[0])', () => {
    // 真实 fixture：CC 把 system-reminder + /clear + stdout + 用户输入塞在 8 个 text block 里
    const entry = makeCheckpointEntry({
      msgs: [userMsg([
        textBlock('<system-reminder>MCP instructions...</system-reminder>'),
        textBlock('<system-reminder>skills...</system-reminder>'),
        textBlock('<local-command-caveat>...</local-command-caveat>'),
        textBlock(`${CLEAR_MARKER}\n<command-message>clear</command-message>\n<command-args></command-args>`),
        textBlock('<local-command-stdout></local-command-stdout>'),
        textBlock('"/tmp/cc-viewer-uploads/image.png" PC上，我们对数据统计..."'),
      ])],
    });
    assert.equal(isPostClearCheckpoint(entry, 33), true);
  });

  it('skips non-text blocks safely (image, tool_use)', () => {
    const entry = makeCheckpointEntry({
      msgs: [userMsg([
        { type: 'image', source: { type: 'base64', data: 'xxx' } },
        textBlock(CLEAR_MARKER),
      ])],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), true);
  });

  it('returns false when block.text is not a string', () => {
    const entry = makeCheckpointEntry({
      msgs: [userMsg([{ type: 'text', text: null }, { type: 'text', text: undefined }])],
    });
    assert.equal(isPostClearCheckpoint(entry, 10), false);
  });
});

// ─── Real-world fixture parity ────────────────────────────────────────────────

describe('isPostClearCheckpoint — real-world fixture parity (cc-viewer_20260425_102916.jsonl L351)', () => {
  it('matches the actual L351 entry shape', () => {
    // 复刻自 ~/.claude/cc-viewer/cc-viewer/cc-viewer_20260425_102916.jsonl 第 351 行
    const realLikeEntry = {
      timestamp: '2026-04-25T08:12:11.330Z',
      mainAgent: true,
      _deltaFormat: 1,
      _isCheckpoint: true,
      _totalMessageCount: 1,
      _conversationId: 'mainAgent-anthropic-cc-viewer',
      body: {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>\n# MCP Server Instructions\n...\n</system-reminder>' },
            { type: 'text', text: '<system-reminder>\nThe following skills are available...\n</system-reminder>' },
            { type: 'text', text: '<system-reminder>\n## Auto Mode Active\n...\n</system-reminder>' },
            { type: 'text', text: "<system-reminder>\nAs you answer the user's questions...\n# claudeMd\n...\n</system-reminder>" },
            { type: 'text', text: '<local-command-caveat>...</local-command-caveat>\n' },
            { type: 'text', text: '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>\n' },
            { type: 'text', text: '<local-command-stdout></local-command-stdout>\n' },
            { type: 'text', text: '<system-reminder>\n[SCOPED INSTRUCTION] ...\n</system-reminder>\n\n"/tmp/cc-viewer-uploads/image-1777104708588.png" PC上，我们对数据统计对入口做一次迁移，从Header迁移到左侧，侧边栏目上。' },
          ],
        }],
        metadata: { user_id: '{"device_id":"cf728b4e6aeec70437fbb2038ebca671398c50a1ba50143579b66575b952c250","account_uuid":"ad64cb9b-cd0d-4694-b875-..."}' },
      },
      response: { status: 200, body: {} },
    };
    // 前置 session 是 deepseek 的 33 条
    assert.equal(isPostClearCheckpoint(realLikeEntry, 33), true,
      'L351 真实结构必须被识别为 post-/clear checkpoint');
  });
});

// ─── isCompactContinuation ──────────────────────────────────────────────────
// 区分「大幅缩短的 checkpoint」是 /compact 续写(同会话延续) 还是全新终端会话。
// 同机器多终端 user_id 完全相同，无法据此区分，故靠 msg[0] 的 CLI 合成 summary 开头判定。

describe('isCompactContinuation', () => {
  const AUTO_COMPACT = 'This session is being continued from a previous conversation that ran out of context. The summary below...';
  const MANUAL_COMPACT = 'Your task is to create a detailed summary of the conversation so far, paying close attention to...';

  it('true — auto-compact continuation (array content)', () => {
    const entry = { body: { messages: [userMsg([textBlock(AUTO_COMPACT)])] } };
    assert.equal(isCompactContinuation(entry), true);
  });

  it('true — manual /compact summary prompt (array content)', () => {
    const entry = { body: { messages: [userMsg([textBlock(MANUAL_COMPACT)])] } };
    assert.equal(isCompactContinuation(entry), true);
  });

  it('true — string content form', () => {
    const entry = { body: { messages: [{ role: 'user', content: AUTO_COMPACT }] } };
    assert.equal(isCompactContinuation(entry), true);
  });

  it('true — leading whitespace before marker is tolerated', () => {
    const entry = { body: { messages: [userMsg([textBlock('\n\n  ' + AUTO_COMPACT)])] } };
    assert.equal(isCompactContinuation(entry), true);
  });

  it('true — marker split across multiple text blocks (concatenated)', () => {
    const entry = { body: { messages: [userMsg([
      textBlock('This session is being continued '),
      textBlock('from a previous conversation ...'),
    ])] } };
    assert.equal(isCompactContinuation(entry), true);
  });

  it('false — fresh terminal session: genuine user first message', () => {
    const entry = { body: { messages: [userMsg([textBlock('帮我看下这个 bug')])] } };
    assert.equal(isCompactContinuation(entry), false);
  });

  it('false — marker appears mid-text, not at the start', () => {
    const entry = { body: { messages: [userMsg([textBlock('note: This session is being continued from a previous conversation')])] } };
    assert.equal(isCompactContinuation(entry), false);
  });

  it('false — /clear checkpoint (has clear marker, not a compact summary)', () => {
    const entry = { body: { messages: [userMsg([textBlock(CLEAR_MARKER)])] } };
    assert.equal(isCompactContinuation(entry), false);
  });

  it('false — msg[0] is not a user message', () => {
    const entry = { body: { messages: [{ role: 'assistant', content: [textBlock(AUTO_COMPACT)] }] } };
    assert.equal(isCompactContinuation(entry), false);
  });

  it('false — empty / missing messages', () => {
    assert.equal(isCompactContinuation({ body: { messages: [] } }), false);
    assert.equal(isCompactContinuation({ body: {} }), false);
    assert.equal(isCompactContinuation(null), false);
    assert.equal(isCompactContinuation(undefined), false);
  });
});

// ─── isSessionBoundary ────────────────────────────────────────────────────────
// Shared batch/live session-boundary predicate — single source of truth for
// session segmentation, so stable ids match across reload and live streaming
// ("only show current session" pin depends on this).

describe('isSessionBoundary', () => {
  const AUTO_COMPACT = 'This session is being continued from a previous conversation that ran out of context. The summary below...';

  function plainEntry(msgCount, { userId = 'u1', firstText = 'hello' } = {}) {
    const msgs = [userMsg([textBlock(firstText)])];
    for (let i = 1; i < msgCount; i++) {
      msgs.push({ role: i % 2 ? 'assistant' : 'user', content: [textBlock(`m${i}`)] });
    }
    return { body: { messages: msgs, metadata: { user_id: userId } }, timestamp: '2026-07-03T10:00:00.000Z' };
  }

  it('true — post-/clear checkpoint always splits (even same user, tiny count)', () => {
    const entry = makeCheckpointEntry({ msgs: [userMsg([textBlock(CLEAR_MARKER)])] });
    assert.equal(isSessionBoundary(entry, { prevCount: 40, count: 1, prevUserId: 'u1', userId: 'u1' }), true);
  });

  it('false — big drop but msg[0] is a /compact continuation summary', () => {
    const entry = plainEntry(10, { firstText: AUTO_COMPACT });
    assert.equal(isSessionBoundary(entry, { prevCount: 100, count: 10, prevUserId: 'u1', userId: 'u1' }), false);
  });

  it('false — big drop on a SLIMMED entry carrying _compactContinuation:true (messages emptied)', () => {
    // P0 regression: the batch slim pass runs before boundary detection and empties
    // body.messages, so isCompactContinuation() alone can no longer see the summary.
    const entry = { _slimmed: true, _messageCount: 10, _compactContinuation: true, body: { messages: [], metadata: { user_id: 'u1' } } };
    assert.equal(isSessionBoundary(entry, { prevCount: 100, count: 10, prevUserId: 'u1', userId: 'u1' }), false);
  });

  it('true — big drop with a genuine new-terminal first prompt (same user)', () => {
    const entry = plainEntry(3, { firstText: 'fix this bug please' });
    assert.equal(isSessionBoundary(entry, { prevCount: 40, count: 3, prevUserId: 'u1', userId: 'u1' }), true);
  });

  it('true — user_id change without a count drop (prevCount > 0)', () => {
    const entry = plainEntry(50, { userId: 'u2' });
    assert.equal(isSessionBoundary(entry, { prevCount: 45, count: 50, prevUserId: 'u1', userId: 'u2' }), true);
  });

  it('false — prevCount 0 (first entry) even with differing userId, unless postClear', () => {
    const entry = plainEntry(5, { userId: 'u2' });
    assert.equal(isSessionBoundary(entry, { prevCount: 0, count: 5, prevUserId: 'u1', userId: 'u2' }), false);
  });

  it('false — no signals: normal same-session growth', () => {
    const entry = plainEntry(42);
    assert.equal(isSessionBoundary(entry, { prevCount: 40, count: 42, prevUserId: 'u1', userId: 'u1' }), false);
  });

  it('false — shrink too small to be a bigDrop (drop <= 4)', () => {
    const entry = plainEntry(4);
    assert.equal(isSessionBoundary(entry, { prevCount: 8, count: 4, prevUserId: 'u1', userId: 'u1' }), false);
  });

  it('false — shrink >= 50% of prev is not a bigDrop', () => {
    const entry = plainEntry(20);
    assert.equal(isSessionBoundary(entry, { prevCount: 30, count: 20, prevUserId: 'u1', userId: 'u1' }), false);
  });

  it('true — compact-flagged entry still splits on user_id change', () => {
    // The compact exclusion only guards the bigDrop signal; a device/account change
    // is a session boundary regardless.
    const entry = { _slimmed: true, _messageCount: 10, _compactContinuation: true, body: { messages: [], metadata: { user_id: 'u2' } } };
    assert.equal(isSessionBoundary(entry, { prevCount: 100, count: 10, prevUserId: 'u1', userId: 'u2' }), true);
  });

  it('false — null/missing userIds never trigger the user_id branch', () => {
    const entry = plainEntry(42);
    assert.equal(isSessionBoundary(entry, { prevCount: 40, count: 42, prevUserId: null, userId: 'u1' }), false);
    assert.equal(isSessionBoundary(entry, { prevCount: 40, count: 42, prevUserId: 'u1', userId: null }), false);
  });
});
