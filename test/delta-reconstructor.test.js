import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructEntries, createIncrementalReconstructor } from '../lib/delta-reconstructor.js';

// ============================================================================
// Test helpers
// ============================================================================

/** 创建旧格式全量条目（无 _deltaFormat） */
function makeOldFormatEntry(messages, opts = {}) {
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    mainAgent: opts.mainAgent !== undefined ? opts.mainAgent : true,
    body: { messages: [...messages], model: 'claude-opus-4-6' },
    response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } },
    ...opts.extra,
  };
}

/** 创建 delta 条目 */
function makeDeltaEntry(deltaMessages, totalCount, opts = {}) {
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    _deltaFormat: 1,
    _totalMessageCount: totalCount,
    _conversationId: 'mainAgent',
    _isCheckpoint: opts.isCheckpoint || false,
    body: { messages: [...deltaMessages], model: 'claude-opus-4-6' },
    response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } },
    ...opts.extra,
  };
}

/** 创建 checkpoint 条目（完整 messages） */
function makeCheckpointEntry(messages, opts = {}) {
  return makeDeltaEntry(messages, messages.length, { ...opts, isCheckpoint: true });
}

function msg(role, text) {
  return { role, content: text };
}

// ============================================================================
// reconstructEntries — 批量重建
// ============================================================================

describe('reconstructEntries', () => {
  it('纯旧格式条目 → 原样返回', () => {
    const entries = [
      makeOldFormatEntry([msg('user', 'hello')]),
      makeOldFormatEntry([msg('user', 'hello'), msg('assistant', 'hi'), msg('user', 'bye')]),
    ];
    const result = reconstructEntries(entries);
    assert.equal(result.length, 2);
    assert.equal(result[0].body.messages.length, 1);
    assert.equal(result[1].body.messages.length, 3);
  });

  it('纯 delta + checkpoint 混合 → 正确重建', () => {
    const entries = [
      // checkpoint：完整 2 条
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b')]),
      // delta：新增 2 条（总计 4）
      makeDeltaEntry([msg('user', 'c'), msg('assistant', 'd')], 4),
      // delta：新增 1 条（总计 5）
      makeDeltaEntry([msg('user', 'e')], 5),
    ];
    const result = reconstructEntries(entries);

    // checkpoint 条目保持原样
    assert.equal(result[0].body.messages.length, 2);
    // delta 条目重建为完整
    assert.equal(result[1].body.messages.length, 4);
    assert.deepEqual(result[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd']);
    // 第二个 delta
    assert.equal(result[2].body.messages.length, 5);
    assert.deepEqual(result[2].body.messages.map(m => m.content), ['a', 'b', 'c', 'd', 'e']);
  });

  it('混合格式（旧+新共存）→ 兼容处理', () => {
    const entries = [
      // 旧格式
      makeOldFormatEntry([msg('user', 'old1'), msg('assistant', 'old2')]),
      // 新格式 delta（基于旧格式的 2 条累积）
      makeDeltaEntry([msg('user', 'new1')], 3),
      // 新格式 delta
      makeDeltaEntry([msg('assistant', 'new2')], 4),
    ];
    const result = reconstructEntries(entries);

    assert.equal(result[0].body.messages.length, 2); // 旧格式不变
    assert.equal(result[1].body.messages.length, 3); // 重建
    assert.equal(result[2].body.messages.length, 4); // 重建
    assert.deepEqual(result[2].body.messages.map(m => m.content), ['old1', 'old2', 'new1', 'new2']);
  });

  it('messages 缩短（/clear）→ checkpoint 正确重置', () => {
    const entries = [
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd')]),
      makeDeltaEntry([msg('user', 'e')], 5),
      // /clear 后：新 checkpoint，只有 1 条
      makeCheckpointEntry([msg('user', 'fresh start')]),
      makeDeltaEntry([msg('assistant', 'hello again')], 2),
    ];
    const result = reconstructEntries(entries);

    assert.equal(result[1].body.messages.length, 5);
    // /clear 后重置
    assert.equal(result[2].body.messages.length, 1);
    assert.equal(result[3].body.messages.length, 2);
    assert.deepEqual(result[3].body.messages.map(m => m.content), ['fresh start', 'hello again']);
  });

  it('进程重启恢复 → 首条 checkpoint 正确处理', () => {
    // 进程重启后 _lastMessagesCount=0，第一条强制 checkpoint
    const entries = [
      makeCheckpointEntry([msg('user', 'after restart'), msg('assistant', 'ok')]),
      makeDeltaEntry([msg('user', 'next')], 3),
    ];
    const result = reconstructEntries(entries);

    assert.equal(result[0].body.messages.length, 2);
    assert.equal(result[1].body.messages.length, 3);
  });

  it('teammate 条目不受影响', () => {
    const entries = [
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b')]),
      // teammate 全量条目（旧格式，无 _deltaFormat）
      makeOldFormatEntry([msg('user', 'tm1')], { mainAgent: false, extra: { teammate: 'worker-1', teamName: 'my-team' } }),
      // mainAgent delta
      makeDeltaEntry([msg('user', 'c')], 3),
    ];
    const result = reconstructEntries(entries);

    // teammate 条目不变
    assert.equal(result[1].body.messages.length, 1);
    assert.equal(result[1].teammate, 'worker-1');
    // mainAgent delta 正常重建（不受 teammate 条目干扰）
    assert.equal(result[2].body.messages.length, 3);
    assert.deepEqual(result[2].body.messages.map(m => m.content), ['a', 'b', 'c']);
  });

  it('隐式 checkpoint（_totalMessageCount === messages.length）正确识别', () => {
    const entries = [
      // 隐式 checkpoint：_isCheckpoint=false 但 totalCount === messages.length
      makeDeltaEntry([msg('user', 'a'), msg('assistant', 'b')], 2, { isCheckpoint: false }),
      makeDeltaEntry([msg('user', 'c')], 3),
    ];
    const result = reconstructEntries(entries);

    // 第一条被识别为隐式 checkpoint
    assert.equal(result[0].body.messages.length, 2);
    assert.equal(result[1].body.messages.length, 3);
    assert.deepEqual(result[1].body.messages.map(m => m.content), ['a', 'b', 'c']);
  });

  it('空条目数组 → 返回空数组', () => {
    assert.deepEqual(reconstructEntries([]), []);
  });

  it('条目无 body.messages → 跳过', () => {
    const entries = [
      { timestamp: '2026-01-01', url: '/test', mainAgent: true, _deltaFormat: 1, body: null },
      makeCheckpointEntry([msg('user', 'a')]),
    ];
    const result = reconstructEntries(entries);
    assert.equal(result[1].body.messages.length, 1);
  });
});

// ============================================================================
// 补偿修复 — 断裂 delta 链的回填
// ============================================================================

describe('compensation for broken delta chain', () => {
  it('中间 delta 丢失 → 后续 checkpoint 回填', () => {
    const entries = [
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b')]),
      // 跳过了 totalMessageCount=3 的 delta（模拟丢失）
      // 直接出现 totalMessageCount=4 的 delta，accumulated 只有 2+1=3，期望 4 → mismatch
      makeDeltaEntry([msg('user', 'c')], 4),
      // 后续 checkpoint 包含完整历史
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b'), msg('assistant', 'x'), msg('user', 'c'), msg('assistant', 'd'), msg('user', 'e')]),
    ];
    const result = reconstructEntries(entries);

    // 断裂的条目应被后续 checkpoint 补偿：从 6 条中截取前 4 条
    assert.equal(result[1].body.messages.length, 4);
    assert.deepEqual(result[1].body.messages.map(m => m.content), ['a', 'b', 'x', 'c']);
  });

  it('文件首条是 delta（无前置 checkpoint）→ 后续 checkpoint 回填', () => {
    const entries = [
      // 文件开头就是 delta（迁移失败或文件损坏），accumulated 为空
      makeDeltaEntry([msg('user', 'orphan')], 5),
      // 后续 checkpoint
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd'), msg('user', 'e')]),
      makeDeltaEntry([msg('assistant', 'f')], 6),
    ];
    const result = reconstructEntries(entries);

    // 孤立 delta 被补偿：从 checkpoint 的 5 条中截取前 5 条
    assert.equal(result[0].body.messages.length, 5);
    // 后续正常重建
    assert.equal(result[2].body.messages.length, 6);
  });

  it('断裂后无 checkpoint 可补偿 → 保留不完整数据（graceful 降级）', () => {
    const entries = [
      makeCheckpointEntry([msg('user', 'a')]),
      // delta 期望 total=5 但 accumulated 只有 1+1=2
      makeDeltaEntry([msg('user', 'b')], 5),
      // 后续也是 delta，没有 checkpoint 可补偿
      makeDeltaEntry([msg('user', 'c')], 6),
    ];
    const result = reconstructEntries(entries);

    // 无法补偿，保留不完整数据（2 条而非期望的 5 条）
    assert.equal(result[1].body.messages.length, 2);
    // 后续 delta 继续基于不完整的累积拼接
    assert.equal(result[2].body.messages.length, 3);
  });

  it('多个断裂点 → 逐个补偿', () => {
    const entries = [
      // 第一个断裂：无前置 checkpoint
      makeDeltaEntry([msg('user', 'x')], 3),
      // 第一个 checkpoint（补偿第一个断裂）
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd')]),
      // 第二个断裂：跳过了一些 delta
      makeDeltaEntry([msg('user', 'e')], 6),
      // 第二个 checkpoint（补偿第二个断裂）
      makeCheckpointEntry([
        msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'),
        msg('assistant', 'd'), msg('user', 'e'), msg('assistant', 'f'),
        msg('user', 'g'), msg('assistant', 'h'),
      ]),
    ];
    const result = reconstructEntries(entries);

    // 第一个断裂被第一个 checkpoint 补偿
    assert.equal(result[0].body.messages.length, 3);
    // 第二个断裂被第二个 checkpoint 补偿
    assert.equal(result[2].body.messages.length, 6);
  });
});

// ============================================================================
// createIncrementalReconstructor — 增量重建器
// ============================================================================

describe('createIncrementalReconstructor', () => {
  it('逐条重建与批量重建结果一致', () => {
    const entries = [
      makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b')]),
      makeDeltaEntry([msg('user', 'c')], 3),
      makeDeltaEntry([msg('assistant', 'd')], 4),
    ];

    // 批量重建（用复制避免原地修改影响对比）
    const batchEntries = JSON.parse(JSON.stringify(entries));
    reconstructEntries(batchEntries);

    // 增量重建
    const reconstructor = createIncrementalReconstructor();
    const incrResults = entries.map(e => reconstructor.reconstruct(e));

    for (let i = 0; i < entries.length; i++) {
      assert.deepEqual(
        incrResults[i].body.messages.map(m => m.content),
        batchEntries[i].body.messages.map(m => m.content),
        `Entry ${i} mismatch`
      );
    }
  });

  it('reset() 清除累积状态', () => {
    const reconstructor = createIncrementalReconstructor();

    reconstructor.reconstruct(makeCheckpointEntry([msg('user', 'a'), msg('assistant', 'b')]));
    reconstructor.reconstruct(makeDeltaEntry([msg('user', 'c')], 3));

    // reset
    reconstructor.reset();

    // 重建新条目，不应包含之前的累积
    const entry = makeDeltaEntry([msg('user', 'fresh')], 1, { isCheckpoint: false });
    // totalMessageCount=1 === messages.length=1 → 隐式 checkpoint
    const result = reconstructor.reconstruct(entry);
    assert.equal(result.body.messages.length, 1);
    assert.equal(result.body.messages[0].content, 'fresh');
  });

  it('旧格式条目更新累积状态', () => {
    const reconstructor = createIncrementalReconstructor();

    // 旧格式 mainAgent
    reconstructor.reconstruct(makeOldFormatEntry([msg('user', 'old'), msg('assistant', 'resp')]));

    // 后续 delta 应基于旧格式的累积
    const delta = makeDeltaEntry([msg('user', 'new')], 3);
    const result = reconstructor.reconstruct(delta);
    assert.equal(result.body.messages.length, 3);
    assert.deepEqual(result.body.messages.map(m => m.content), ['old', 'resp', 'new']);
  });

  it('teammate 条目不影响 mainAgent 累积', () => {
    const reconstructor = createIncrementalReconstructor();

    reconstructor.reconstruct(makeCheckpointEntry([msg('user', 'a')]));

    // teammate（不影响累积）
    reconstructor.reconstruct(makeOldFormatEntry([msg('user', 'tm')], { mainAgent: false }));

    // mainAgent delta 仍基于 'a'
    const result = reconstructor.reconstruct(makeDeltaEntry([msg('assistant', 'b')], 2));
    assert.equal(result.body.messages.length, 2);
    assert.deepEqual(result.body.messages.map(m => m.content), ['a', 'b']);
  });
});
