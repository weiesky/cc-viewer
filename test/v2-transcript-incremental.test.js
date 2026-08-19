import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createV2IncrementalReconstructor, normalizeV2Entries } from '../packages/app/server/lib/v2-transcript-normalizer.js';

// ============================================================================

let uuidSeq = 0;
function makeLine({ type = 'user', role = 'user', content, sessionId = 'sid-1', ts = '2026-07-30T03:43:40.807Z', id, sidechain = false, extra = {} } = {}) {
  const line = {
    type,
    uuid: `uuid-${++uuidSeq}`,
    parentUuid: null,
    sessionId,
    timestamp: ts,
    isSidechain: sidechain,
    message: { role, content },
    ...extra,
  };
  if (id) line.message.id = id;
  return line;
}

describe('createV2IncrementalReconstructor', () => {
  it('冷启动逐条重建 → 快照单调增长、id 恒定', () => {
    const rec = createV2IncrementalReconstructor();
    assert.equal(rec.empty(), true);
    const e1 = rec.reconstruct(makeLine({ content: 'a', ts: '2026-07-30T03:43:40.000Z' }));
    assert.equal(e1._syntheticV2, true);
    assert.equal(e1.body.messages.length, 1);
    const e2 = rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'hi' }], ts: '2026-07-30T03:43:41.000Z' }));
    assert.equal(e2.body.messages.length, 2);
    assert.equal(e2.timestamp, e1.timestamp); // stable identity
    assert.equal(e2.url, e1.url);
  });

  it('同 uuid 重放 → null（幂等）', () => {
    const rec = createV2IncrementalReconstructor();
    const line = makeLine({ content: 'a' });
    rec.reconstruct(line);
    assert.equal(rec.reconstruct(line), null);
    assert.equal(rec.empty(), false);
  });

  it('isSidechain 行 → null', () => {
    const rec = createV2IncrementalReconstructor();
    assert.equal(rec.reconstruct(makeLine({ content: 't', sidechain: true })), null);
  });

  it('同 message.id 的后续行 append 到已有消息', () => {
    const rec = createV2IncrementalReconstructor();
    rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'thinking', thinking: 't' }], ts: '2026-07-30T03:43:40.000Z' }));
    const e = rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }], ts: '2026-07-30T03:43:41.000Z' }));
    const m = e.body.messages[0];
    assert.deepEqual(m.content.map((b) => b.type), ['thinking', 'tool_use']);
    assert.equal(m._timestamp, '2026-07-30T03:43:40.000Z');
    assert.equal(m._generatedTs, '2026-07-30T03:43:41.000Z');
  });

  it('prime 冷载快照 → 首 flush 续接而非截断', () => {
    const rows = [
      makeLine({ content: 'old1', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ content: 'old2', ts: '2026-07-30T03:43:41.000Z' }),
    ];
    const cold = normalizeV2Entries(rows)[0];

    const rec = createV2IncrementalReconstructor();
    rec.prime(cold);
    assert.equal(rec.empty(), false);
    const e = rec.reconstruct(makeLine({ content: 'new', ts: '2026-07-30T03:44:00.000Z' }));
    assert.equal(e.body.messages.length, 3);
    assert.equal(e.timestamp, cold.timestamp); // seeded identity
    assert.equal(e._seqEpoch, cold._seqEpoch); // same segment epoch → merge appends
    assert.deepEqual(e.body.messages.map((m) => m.content), ['old1', 'old2', 'new']);

    // cold snapshot stays pristine (copy-on-write)
    assert.equal(cold.body.messages.length, 2);
    assert.deepEqual(cold.body.messages.map((m) => m.content), ['old1', 'old2']);
  });

  it('prime 后同 message.id append 不污染冷载快照', () => {
    const rows = [
      makeLine({ content: 'q', ts: '2026-07-30T03:43:40.000Z' }),
      makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: 'cold' }], ts: '2026-07-30T03:43:41.000Z' }),
    ];
    const cold = normalizeV2Entries(rows)[0];

    const rec = createV2IncrementalReconstructor();
    rec.prime(cold);
    const e = rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }], ts: '2026-07-30T03:43:42.000Z' }));
    const liveMsg = e.body.messages.find((m) => m.role === 'assistant');
    assert.equal(liveMsg.content.length, 2); // appended
    assert.equal(cold.body.messages[1].content.length, 1); // cold untouched
  });

  it('reset 清空状态', () => {
    const rec = createV2IncrementalReconstructor();
    rec.reconstruct(makeLine({ content: 'a' }));
    rec.reset();
    assert.equal(rec.empty(), true);
  });

  it('快照为浅拷贝（消息引用共享、数组新壳）', () => {
    const rec = createV2IncrementalReconstructor();
    const e1 = rec.reconstruct(makeLine({ content: 'a' }));
    const e2 = rec.reconstruct(makeLine({ content: 'b' }));
    assert.notEqual(e1.body.messages, e2.body.messages); // new array shell
    assert.equal(e1.body.messages[0], e2.body.messages[0]); // shared message ref
  });

  it('冷启动（无 prime）时新行从空基线开始，快照=已见行', () => {
    const rec = createV2IncrementalReconstructor();
    const e = rec.reconstruct(makeLine({ content: 'mid', ts: '2026-07-30T03:43:40.000Z' }));
    assert.equal(e.body.messages.length, 1);
    assert.equal(e.body.messages[0].content, 'mid');
  });

  it('会话切换（sessionId 变化）→ 从空基线重建、不混入旧会话', () => {
    const rec = createV2IncrementalReconstructor();
    const e1 = rec.reconstruct(makeLine({ content: '旧', sessionId: 'sid-a', ts: '2026-07-30T03:43:40.000Z' }));
    assert.equal(e1.sessionId, 'sid-a');
    assert.equal(e1.body.messages.length, 1);
    const e2 = rec.reconstruct(makeLine({ content: '新', sessionId: 'sid-b', ts: '2026-07-30T03:44:00.000Z' }));
    assert.equal(e2.sessionId, 'sid-b');
    assert.equal(e2.body.messages.length, 1);
    assert.equal(e2.body.messages[0].content, '新');
    assert.equal(e2.url, 'claude-code://session/sid-b:0');
    assert.equal(e2._seqEpoch, 'v2:sid-b:0');
  });

  it('live /clear 行 → 新段（新 epoch）、返回 null（不产生空快照）', () => {
    const rec = createV2IncrementalReconstructor();
    const e1 = rec.reconstruct(makeLine({ content: '第一段', ts: '2026-07-30T03:43:40.000Z' }));
    assert.equal(e1._seqEpoch, 'v2:sid-1:0');
    const r = rec.reconstruct(makeLine({ content: '<command-name>/clear</command-name>', ts: '2026-07-30T03:44:00.000Z' }));
    assert.equal(r, null); // skip — no ghost empty entry sinks into requests
    const e3 = rec.reconstruct(makeLine({ content: '第二段', ts: '2026-07-30T03:44:01.000Z' }));
    assert.equal(e3._seqEpoch, 'v2:sid-1:1'); // epoch bumped to new segment
    assert.deepEqual(e3.body.messages.map((m) => m.content), ['第二段']);
  });

  it('live /clear 后 entry.timestamp === messages[0]._timestamp 不变量保持', () => {
    const rec = createV2IncrementalReconstructor();
    rec.reconstruct(makeLine({ content: '第一段', ts: '2026-07-30T03:43:40.000Z' }));
    rec.reconstruct(makeLine({ content: '<command-name>/clear</command-name>', ts: '2026-07-30T03:44:00.000Z' }));
    const e3 = rec.reconstruct(makeLine({ content: '第二段', ts: '2026-07-30T03:44:01.000Z' }));
    // 段内首条消息 ts 拥有 entry.timestamp（而非 clear 行 ts）
    assert.equal(e3.timestamp, '2026-07-30T03:44:01.000Z');
    assert.equal(e3.timestamp, e3.body.messages[0]._timestamp);
    // 连续 /clear（无新消息）→ 均返回 null，不产生空 entry
    const r = rec.reconstruct(makeLine({ content: '<command-name>/clear</command-name>', ts: '2026-07-30T03:45:00.000Z' }));
    assert.equal(r, null);
  });

  it('live 裸 "clear" 用户消息 → 不切段、正常渲染', () => {
    const rec = createV2IncrementalReconstructor();
    const e1 = rec.reconstruct(makeLine({ content: '第一段', ts: '2026-07-30T03:43:40.000Z' }));
    const e2 = rec.reconstruct(makeLine({ content: 'clear', ts: '2026-07-30T03:43:41.000Z' }));
    assert.equal(e2._seqEpoch, 'v2:sid-1:0'); // epoch unchanged
    assert.deepEqual(e2.body.messages.map((m) => m.content), ['第一段', 'clear']);
  });

  it('live /clear 后同 message.id 行 → 开新段里的新消息（不并入旧段）', () => {
    const rec = createV2IncrementalReconstructor();
    rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'text', text: 'a' }], ts: '2026-07-30T03:43:40.000Z' }));
    rec.reconstruct(makeLine({ content: '<command-name>/clear</command-name>', ts: '2026-07-30T03:44:00.000Z' }));
    const e = rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }], ts: '2026-07-30T03:44:01.000Z' }));
    assert.equal(e.body.messages.length, 1); // new segment, fresh message
    assert.deepEqual(e.body.messages[0].content.map((b) => b.type), ['tool_use']);
  });
});

// ============================================================================
// P1: 分流行合并后 tool_use 能配对上 tool_result（matchedTool 不丢失）
// ============================================================================

describe('live split-row merged tool_use pairing', () => {
  it('合并进已扫描消息的 tool_use 通过 _toolUses 被重新注册', async () => {
    await import('./_shims/register.mjs');
    const { appendToolResultMap } = await import('../apps/web/src/utils/toolResultBuilder.js');
    const { buildSingleToolResultCore } = await import('../apps/web/src/utils/toolResultCore.js');

    const rec = createV2IncrementalReconstructor();
    // 第一行：user 消息 + 请求（先有 tool_use 之前的文本）
    rec.reconstruct(makeLine({ content: '请求', ts: '2026-07-30T03:43:40.000Z' }));
    // assistant thinking 行（id=msg-1）
    rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'thinking', thinking: 't' }], ts: '2026-07-30T03:43:41.000Z' }));
    // assistant tool_use 行（同 id=msg-1，分流行）→ 合并进 msg-1
    const e = rec.reconstruct(makeLine({ type: 'assistant', role: 'assistant', id: 'msg-1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'a.txt' } }], ts: '2026-07-30T03:43:42.000Z' }));
    // 合并后的消息带 _toolUses
    const asst = e.body.messages.find((m) => m.role === 'assistant');
    assert.equal(Array.isArray(asst._toolUses), true);
    assert.equal(asst._toolUses[0].id, 'tu-1');

    // 模拟 ChatView 增量：先扫 3 条（此时合并已发生，用 _toolUses 补扫）
    const state = { toolUseMap: {}, toolResultMap: {}, readContentMap: {}, editSnapshotMap: {}, askAnswerMap: {}, planApprovalMap: {}, _fileState: {}, _editOrder: [] };
    appendToolResultMap(state, e.body.messages, 3, asst._toolUses);
    assert.equal(state.toolUseMap['tu-1'], asst._toolUses[0]); // 已注册

    // tool_result 到达 → matchedTool 能找到 Read + file_path
    const trBlock = { type: 'tool_result', tool_use_id: 'tu-1', content: 'file content' };
    const entry = buildSingleToolResultCore(trBlock, state.toolUseMap['tu-1']);
    assert.equal(entry.toolName, 'Read');
    assert.deepEqual(entry.toolInput, { file_path: 'a.txt' });
  });
});
