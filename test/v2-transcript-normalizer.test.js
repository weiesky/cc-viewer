import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeV2Entries, isV2TranscriptLine, isMetadataRow, buildSyntheticEntry } from '../packages/app/server/lib/v2-transcript-normalizer.js';

// ============================================================================
// Test helpers — build minimal Claude Code 2.x transcript lines
// ============================================================================

let uuidSeq = 0;
function makeLine({ type = 'user', role = 'user', content, sessionId = 'sid-1', ts = '2026-07-30T03:43:40.807Z', sidechain = false, extra = {} } = {}) {
  const line = {
    type,
    uuid: `uuid-${++uuidSeq}`,
    parentUuid: null,
    sessionId,
    timestamp: ts,
    isSidechain: sidechain,
    userType: 'external',
    message: { role, content },
    ...extra,
  };
  return line;
}

function makeLegacyEntry(messages, opts = {}) {
  return {
    timestamp: opts.timestamp || '2026-07-30T01:00:00.000Z',
    url: 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    body: { messages },
    ...opts.extra,
  };
}

// ============================================================================
// isV2TranscriptLine
// ============================================================================

describe('isV2TranscriptLine', () => {
  it('user/assistant 带 message 的行 → true', () => {
    assert.equal(isV2TranscriptLine(makeLine()), true);
    assert.equal(isV2TranscriptLine(makeLine({ type: 'assistant', role: 'assistant', content: [] })), true);
  });
  it('isSidechain 行 → false', () => {
    assert.equal(isV2TranscriptLine(makeLine({ sidechain: true })), false);
  });
  it('元数据行（无 message / 非 user/assistant type）→ false', () => {
    assert.equal(isV2TranscriptLine({ type: 'mode', uuid: 'u' }), false);
    assert.equal(isV2TranscriptLine({ type: 'ai-title', uuid: 'u' }), false);
    assert.equal(isV2TranscriptLine({ type: 'last-prompt', uuid: 'u' }), false);
    assert.equal(isV2TranscriptLine({ type: 'file-history-snapshot', uuid: 'u' }), false);
    assert.equal(isV2TranscriptLine({ type: 'queue-operation', uuid: 'u' }), false);
    assert.equal(isV2TranscriptLine({ type: 'system', uuid: 'u', message: { role: 'system', content: [] } }), false);
    assert.equal(isV2TranscriptLine({ type: 'attachment', uuid: 'u', message: { role: 'user', content: [] } }), false);
    assert.equal(isV2TranscriptLine(null), false);
    assert.equal(isV2TranscriptLine({}), false);
  });
});

// ============================================================================
// normalizeV2Entries — 批量
// ============================================================================

describe('isMetadataRow', () => {
  it('元数据行 → true，v2/旧格式行 → false', () => {
    assert.equal(isMetadataRow({ type: 'mode', uuid: 'u' }), true);
    assert.equal(isMetadataRow({ type: 'ai-title', uuid: 'u' }), true);
    assert.equal(isMetadataRow({ type: 'system', uuid: 'u', message: { role: 'system', content: [] } }), true);
    assert.equal(isMetadataRow(makeLine()), false);
    assert.equal(isMetadataRow(makeLegacyEntry([])), false);
    assert.equal(isMetadataRow({ mainAgent: true, url: 'x' }), false);
  });
});

describe('normalizeV2Entries', () => {
  it('纯 v2 文件 → 单合成 entry，字段齐全', () => {
    const rows = [
      makeLine({ content: 'hello', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'hi' }], ts: '2026-07-30T03:43:41.000Z' }),
      makeLine({ content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'text', text: 'done' }] }], ts: '2026-07-30T03:43:42.000Z' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 1);
    const e = out[0];
    assert.equal(e.mainAgent, true);
    assert.equal(e._syntheticV2, true);
    assert.equal(e.body.messages.length, 3);
    assert.equal(e._seqEpoch, 'v2:sid-1:0');
    assert.equal(e.url, 'claude-code://session/sid-1:0');
    assert.equal(e.timestamp, '2026-07-30T03:43:40.000Z');
    assert.equal(e._messageCount, 3);
    assert.equal(e.timestamp, e.body.messages[0]._timestamp); // invariant
    assert.equal(e.body.messages[0]._entryTs, e.timestamp);
    assert.equal(e.body.messages[1]._entryTs, e.timestamp);
  });

  it('ts 乱序 → 按 ts 重排', () => {
    const rows = [
      makeLine({ content: 'B', ts: '2026-07-30T03:43:42.000Z' }),
      makeLine({ content: 'A', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: 'C', ts: '2026-07-30T03:43:41.000Z' }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.deepEqual(e.body.messages.map((m) => m.content), ['A', 'C', 'B']);
  });

  it('同 ts 保持文件序（sort 稳定）', () => {
    const rows = [
      makeLine({ content: 'X', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: 'Y', ts: '2026-07-30T03:43:40.000Z' }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.deepEqual(e.body.messages.map((m) => m.content), ['X', 'Y']);
  });

  it('/clear 行切段 → 每段一个 entry', () => {
    const rows = [
      makeLine({ content: '第一段', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'a' }], ts: '2026-07-30T03:43:41.000Z' }),
      makeLine({ content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>', ts: '2026-07-30T03:44:00.000Z' }),
      makeLine({ content: '第二段', ts: '2026-07-30T03:44:01.000Z' }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'b' }], ts: '2026-07-30T03:44:02.000Z' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e._seqEpoch), ['v2:sid-1:0', 'v2:sid-1:1']);
    assert.equal(out[0].body.messages.length, 2);
    assert.equal(out[1].body.messages.length, 2);
    assert.equal(out[1].body.messages[0].content, '第二段');
  });

  it('裸 "clear"/"compact" 用户消息不切段（不是命令标记）', () => {
    const rows = [
      makeLine({ content: '第一句', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: 'clear', ts: '2026-07-30T03:43:41.000Z' }),
      makeLine({ content: 'compact', ts: '2026-07-30T03:43:42.000Z' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 1); // 不切段
    assert.deepEqual(out[0].body.messages.map((m) => m.content), ['第一句', 'clear', 'compact']);
  });

  it('clear 行在末尾 → 不产生空段 entry', () => {
    const rows = [
      makeLine({ content: '第一段', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: '<command-name>/clear</command-name>', ts: '2026-07-30T03:44:00.000Z' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].body.messages.length, 1);
    assert.equal(out[0].body.messages[0].content, '第一段');
  });

  it('同 message.id 的 assistant 行合并为一条消息（content concat）', () => {
    const rows = [
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: 't' }], ts: '2026-07-30T03:43:40.000Z', extra: { message: { role: 'assistant', id: 'msg-1', content: [{ type: 'thinking', thinking: 't' }] } } }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'hi' }], ts: '2026-07-30T03:43:41.000Z', extra: { message: { role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: 'hi' }] } } }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }], ts: '2026-07-30T03:43:42.000Z', extra: { message: { role: 'assistant', id: 'msg-1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }], model: 'k3', usage: { input_tokens: 5 } } } }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.equal(e.body.messages.length, 1);
    const m = e.body.messages[0];
    assert.equal(m.role, 'assistant');
    assert.deepEqual(m.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
    assert.equal(m._timestamp, '2026-07-30T03:43:40.000Z'); // first row ts
    assert.equal(m._generatedTs, '2026-07-30T03:43:42.000Z'); // last row ts
    assert.equal(m.model, 'k3');
    assert.equal(m.usage.input_tokens, 5);
  });

  it('isSidechain 行被排除', () => {
    const rows = [
      makeLine({ content: 'main', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: 'teammate', ts: '2026-07-30T03:43:41.000Z', sidechain: true }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.equal(e.body.messages.length, 1);
    assert.equal(e.body.messages[0].content, 'main');
  });

  it('元数据行被剔除，不残留请求行', () => {
    const rows = [
      { type: 'mode', uuid: 'u1' },
      { type: 'ai-title', uuid: 'u2' },
      { type: 'last-prompt', uuid: 'u3' },
      { type: 'file-history-snapshot', uuid: 'u4' },
      { type: 'queue-operation', uuid: 'u5' },
      makeLine({ content: 'real', ts: '2026-07-30T03:43:40.000Z' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0]._syntheticV2, true);
    assert.equal(out[0].body.messages.length, 1);
  });

  it('toolUseResult 冗余字段被忽略', () => {
    const rows = [
      makeLine({
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
        ts: '2026-07-30T03:43:40.000Z',
        extra: { toolUseResult: { type: 'image', file: { base64: 'AAAA' } } },
      }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.equal('toolUseResult' in e, false);
    assert.equal(e.body.messages[0].content[0].content[0].source.data, 'AAAA'); // image lives in content only
  });

  it('无 v2 行 → 原引用直通（===）', () => {
    const legacy = [makeLegacyEntry([{ role: 'user', content: 'hi' }])];
    const out = normalizeV2Entries(legacy);
    assert.equal(out, legacy);
  });

  it('混合格式：旧格式行保序、合成 entry 追加末尾', () => {
    const legacy1 = makeLegacyEntry([{ role: 'user', content: '旧1' }], { timestamp: '2026-07-30T01:00:00.000Z' });
    const legacy2 = makeLegacyEntry([{ role: 'user', content: '旧2' }], { timestamp: '2026-07-30T02:00:00.000Z' });
    const v2 = makeLine({ content: '新', ts: '2026-07-30T03:00:00.000Z' });
    const out = normalizeV2Entries([legacy1, v2, legacy2]);
    assert.equal(out.length, 3);
    assert.equal(out[0], legacy1);
    assert.equal(out[1], legacy2);
    assert.equal(out[2]._syntheticV2, true);
  });

  it('多 sessionId → 每 session 一个合成 entry', () => {
    const rows = [
      makeLine({ content: 'a', sessionId: 'sid-a' }),
      makeLine({ content: 'b', sessionId: 'sid-b' }),
      makeLine({ content: 'a2', sessionId: 'sid-a' }),
    ];
    const out = normalizeV2Entries(rows);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.sessionId).sort(), ['sid-a', 'sid-b']);
  });

  it('合成 entry 通过 isMainAgent 判定', async () => {
    await import('./_shims/register.mjs');
    const { isMainAgent } = await import('../packages/app/src/utils/contentFilter.js');
    const rows = [makeLine({ content: 'hi' })];
    const e = normalizeV2Entries(rows)[0];
    assert.equal(isMainAgent(e), true);
    assert.equal(isMainAgent(rows[0]), false); // raw v2 line stays invisible
  });
});

// ============================================================================
// buildSyntheticEntry — response 合成
// ============================================================================

describe('buildSyntheticEntry', () => {
  it('从最后一条 assistant 行取 model/usage 合成 response', () => {
    const rows = [
      makeLine({ content: 'q', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'a' }], ts: '2026-07-30T03:43:41.000Z', extra: { message: { role: 'assistant', id: 'm1', content: [{ type: 'text', text: 'a' }], model: 'k3', usage: { input_tokens: 1 } } } }),
    ];
    const e = buildSyntheticEntry(rows, 'sid-1', 0);
    assert.deepEqual(e.response.body, { model: 'k3', usage: { input_tokens: 1 } });
  });
});

describe('buildSegmentMessages string-content assistant merge', () => {
  it('双字符串 content 的 assistant 行合并不丢内容（P2）', () => {
    const rows = [
      makeLine({ type: 'assistant', role: 'assistant', content: '第一部分', ts: '2026-07-30T03:43:40.000Z', extra: { message: { role: 'assistant', id: 'msg-s1', content: '第一部分' } } }),
      makeLine({ type: 'assistant', role: 'assistant', content: '第二部分', ts: '2026-07-30T03:43:41.000Z', extra: { message: { role: 'assistant', id: 'msg-s1', content: '第二部分' } } }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.equal(e.body.messages.length, 1);
    assert.equal(e.body.messages[0].content, '第一部分\n第二部分'); // 不再丢内容
  });

  it('string + array 混合：string 被 array 替换（不丢）', () => {
    const rows = [
      makeLine({ type: 'assistant', role: 'assistant', content: '文本', ts: '2026-07-30T03:43:40.000Z', extra: { message: { role: 'assistant', id: 'msg-m1', content: '文本' } } }),
      makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'tu-9', name: 'Read', input: {} }], ts: '2026-07-30T03:43:41.000Z', extra: { message: { role: 'assistant', id: 'msg-m1', content: [{ type: 'tool_use', id: 'tu-9', name: 'Read', input: {} }] } } }),
    ];
    const e = normalizeV2Entries(rows)[0];
    assert.equal(e.body.messages.length, 1);
    assert.deepEqual(e.body.messages[0].content.map((b) => b.type), ['tool_use']);
  });
});
