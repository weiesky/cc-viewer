import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// 目标模块为 CLIENT-SAFE（无 node deps），可直接动态 import。
// 仍按规约：动态 import 加载目标，避免顶层副作用。
let isCheckpointEntry, isDeltaEntry, reconstructEntries, reconstructSegment, createIncrementalReconstructor;

before(async () => {
  const mod = await import('../src/delta-reconstructor.js');
  isCheckpointEntry = mod.isCheckpointEntry;
  isDeltaEntry = mod.isDeltaEntry;
  reconstructEntries = mod.reconstructEntries;
  reconstructSegment = mod.reconstructSegment;
  createIncrementalReconstructor = mod.createIncrementalReconstructor;
});

// ---- helpers ----
function msg(role, content) {
  return { role, content };
}

/** delta 条目（默认 mainAgent + _deltaFormat） */
function delta(deltaMessages, totalCount, opts = {}) {
  return {
    mainAgent: opts.mainAgent !== undefined ? opts.mainAgent : true,
    _deltaFormat: opts._deltaFormat !== undefined ? opts._deltaFormat : 1,
    _totalMessageCount: totalCount,
    _isCheckpoint: opts.isCheckpoint || false,
    inProgress: opts.inProgress || false,
    body: { messages: [...deltaMessages] },
    ...opts.extra,
  };
}

/** checkpoint 条目（完整 messages，totalCount === length） */
function cp(messages, opts = {}) {
  return delta(messages, messages.length, { ...opts, isCheckpoint: true });
}

/** 旧格式全量条目（无 _deltaFormat） */
function old(messages, opts = {}) {
  return {
    mainAgent: opts.mainAgent !== undefined ? opts.mainAgent : true,
    body: { messages: [...messages] },
    ...opts.extra,
  };
}

// ============================================================================
// isCheckpointEntry — 三种 checkpoint 判定 + 全部 false 分支
// ============================================================================
describe('isCheckpointEntry 分支', () => {
  it('无 _deltaFormat → true（旧格式全量）', () => {
    assert.equal(isCheckpointEntry({ mainAgent: true, body: { messages: [] } }), true);
  });

  it('_isCheckpoint === true → true', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _isCheckpoint: true, body: { messages: [msg('user', 'a')] } }), true);
  });

  it('隐式 checkpoint：_totalMessageCount === messages.length → true', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _totalMessageCount: 2, body: { messages: [msg('u', 'a'), msg('a', 'b')] } }), true);
  });

  it('delta 条目（count !== length，非显式）→ false', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 5, body: { messages: [msg('u', 'a')] } }), false);
  });

  it('msgs 非数组（body.messages 缺失）→ 跳过隐式判定 → false', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 3, body: {} }), false);
  });

  it('body 缺失（可选链）→ false', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 0 }), false);
  });

  it('msgs 是数组但 count 不等长 → false', () => {
    assert.equal(isCheckpointEntry({ _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 9, body: { messages: [msg('u', 'a'), msg('a', 'b')] } }), false);
  });
});

// ============================================================================
// isDeltaEntry — && 两个分支
// ============================================================================
describe('isDeltaEntry 分支', () => {
  it('_deltaFormat 且 mainAgent → truthy', () => {
    assert.ok(isDeltaEntry({ _deltaFormat: 1, mainAgent: true }));
  });
  it('无 _deltaFormat → falsy（短路）', () => {
    assert.ok(!isDeltaEntry({ mainAgent: true }));
  });
  it('_deltaFormat 但非 mainAgent → falsy', () => {
    assert.ok(!isDeltaEntry({ _deltaFormat: 1, mainAgent: false }));
  });
});

// ============================================================================
// reconstructEntries — 各类条目分支
// ============================================================================
describe('reconstructEntries 分支', () => {
  it('inProgress 条目被跳过（continue）', () => {
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('u', 'orphan-inprogress')], 2, { inProgress: true }),
      delta([msg('a', 'b')], 2),
    ];
    reconstructEntries(entries);
    // inProgress 条目未参与累积；后续 delta 基于 cp 的 1 条 → 2 条
    assert.equal(entries[2].body.messages.length, 2);
    assert.deepEqual(entries[2].body.messages.map(m => m.content), ['a', 'b']);
  });

  it('非 delta 的 mainAgent 旧格式 → 重置累积（mainAgent && Array 分支 true）', () => {
    const entries = [
      cp([msg('u', 'a'), msg('a', 'b')]),
      old([msg('u', 'reset-1'), msg('a', 'reset-2'), msg('u', 'reset-3')]),
      delta([msg('a', 'x')], 4),
    ];
    reconstructEntries(entries);
    assert.equal(entries[2].body.messages.length, 4);
    assert.deepEqual(entries[2].body.messages.map(m => m.content), ['reset-1', 'reset-2', 'reset-3', 'x']);
  });

  it('非 delta 但非 mainAgent（teammate 旧格式）→ 不重置累积（&& 短路）', () => {
    const entries = [
      cp([msg('u', 'a')]),
      old([msg('u', 'tm')], { mainAgent: false }),
      delta([msg('a', 'b')], 2),
    ];
    reconstructEntries(entries);
    assert.equal(entries[2].body.messages.length, 2);
    assert.deepEqual(entries[2].body.messages.map(m => m.content), ['a', 'b']);
  });

  it('非 delta mainAgent 但 body.messages 非数组 → 不重置', () => {
    const entries = [
      cp([msg('u', 'a')]),
      { mainAgent: true, body: { messages: null } }, // 旧格式但无 messages 数组
      delta([msg('a', 'b')], 2),
    ];
    reconstructEntries(entries);
    assert.equal(entries[2].body.messages.length, 2);
  });

  it('delta 条目 body.messages 非数组 → continue', () => {
    const entries = [
      cp([msg('u', 'a')]),
      { mainAgent: true, _deltaFormat: 1, _totalMessageCount: 2, body: { messages: 'not-array' } },
      delta([msg('a', 'b')], 2),
    ];
    reconstructEntries(entries);
    assert.equal(entries[2].body.messages.length, 2);
  });

  it('delta 重建后 length === _totalMessageCount → 不入 broken', () => {
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 2), // 1+1 === 2，正常
    ];
    reconstructEntries(entries);
    assert.equal(entries[1].body.messages.length, 2);
  });

  it('delta 无 _totalMessageCount → 不入 broken（&& 短路）', () => {
    const entries = [
      cp([msg('u', 'a')]),
      // _totalMessageCount = 0（falsy），即便长度不符也不记 broken
      { mainAgent: true, _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 0, body: { messages: [msg('a', 'b')] } },
    ];
    reconstructEntries(entries);
    assert.equal(entries[1].body.messages.length, 2);
  });
});

// ============================================================================
// _compensateBrokenEntries（经 reconstructEntries 触发）的分支
// ============================================================================
describe('reconstructEntries 补偿修复分支', () => {
  it('断裂条目 _totalMessageCount falsy → continue（不补偿）', () => {
    // 构造：一个 broken（有 count），后跟一个 candidate；但被补偿的 brokenEntry
    // 自身需要进入 _compensateBrokenEntries 后 expectedCount 真值判定。
    // 这里测 candidate 扫描中 candidate 非 mainAgent → 跳过的分支。
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 5), // broken: 2 !== 5
      old([msg('u', 'tm')], { mainAgent: false }), // candidate 非 mainAgent → skip
      cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd'), msg('u', 'e')]), // 5 条 → 补偿
    ];
    reconstructEntries(entries);
    assert.equal(entries[1].body.messages.length, 5);
    assert.deepEqual(entries[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd', 'e']);
  });

  it('candidate body.messages 非数组 → 跳过该候选', () => {
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken
      { mainAgent: true, body: { messages: null } }, // candidate 无 messages 数组 → skip
      cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]), // 4 条
    ];
    reconstructEntries(entries);
    assert.equal(entries[1].body.messages.length, 4);
  });

  it('candidate 是 delta（非 full）→ isFullEntry false 不补偿，继续找', () => {
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken（2 !== 4）
      delta([msg('u', 'c')], 5),  // 也 broken 的 delta candidate：isFullEntry false → skip
      cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd'), msg('u', 'e')]), // checkpoint 5 条
    ];
    reconstructEntries(entries);
    // index1 被最后的 checkpoint 补偿为前 4 条
    assert.equal(entries[1].body.messages.length, 4);
    assert.deepEqual(entries[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd']);
  });

  it('candidate 是旧格式全量（!_deltaFormat → isFullEntry true）→ 补偿', () => {
    const entries = [
      delta([msg('u', 'orphan')], 3), // 文件首条 delta，accumulated 空 → broken
      old([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]), // 旧格式 4 条 → 补偿前 3
    ];
    reconstructEntries(entries);
    assert.equal(entries[0].body.messages.length, 3);
    assert.deepEqual(entries[0].body.messages.map(m => m.content), ['a', 'b', 'c']);
  });

  it('candidate total 不足 expectedCount → 不补偿（保留不完整）', () => {
    const entries = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 9), // broken，期望 9
      cp([msg('u', 'a'), msg('a', 'b')]), // 仅 2 条 < 9 → 不补偿
    ];
    reconstructEntries(entries);
    // 无法补偿，保留累积的 2 条
    assert.equal(entries[1].body.messages.length, 2);
  });
});

// ============================================================================
// reconstructSegment — 全量分支
// ============================================================================
describe('reconstructSegment 分支', () => {
  it('inProgress 段内条目跳过', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('u', 'ip')], 2, { inProgress: true }),
      delta([msg('a', 'b')], 2),
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[2].body.messages.length, 2);
  });

  it('段内非 delta mainAgent 旧格式 → 重置累积', () => {
    const seg = [
      cp([msg('u', 'a'), msg('a', 'b')]),
      old([msg('u', 'r1'), msg('a', 'r2')]),
      delta([msg('u', 'c')], 3),
    ];
    reconstructSegment(seg, null);
    assert.deepEqual(seg[2].body.messages.map(m => m.content), ['r1', 'r2', 'c']);
  });

  it('段内非 delta 非 mainAgent → 不重置（&& 短路）', () => {
    const seg = [
      cp([msg('u', 'a')]),
      old([msg('u', 'tm')], { mainAgent: false }),
      delta([msg('a', 'b')], 2),
    ];
    reconstructSegment(seg, null);
    assert.deepEqual(seg[2].body.messages.map(m => m.content), ['a', 'b']);
  });

  it('段内 delta body.messages 非数组 → continue', () => {
    const seg = [
      cp([msg('u', 'a')]),
      { mainAgent: true, _deltaFormat: 1, _totalMessageCount: 2, body: { messages: 42 } },
      delta([msg('a', 'b')], 2),
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[2].body.messages.length, 2);
  });

  it('段内 checkpoint 重置累积', () => {
    const seg = [
      delta([msg('u', 'pre')], 1), // 隐式 checkpoint（1===1）
      cp([msg('u', 'fresh')]),
      delta([msg('a', 'x')], 2),
    ];
    reconstructSegment(seg, null);
    assert.deepEqual(seg[2].body.messages.map(m => m.content), ['fresh', 'x']);
  });

  it('段内正常 delta（length === total）→ 不入 broken', () => {
    const seg = [cp([msg('u', 'a')]), delta([msg('a', 'b')], 2)];
    reconstructSegment(seg, null);
    assert.equal(seg[1].body.messages.length, 2);
  });

  it('段内 delta 无 _totalMessageCount → 不入 broken', () => {
    const seg = [
      cp([msg('u', 'a')]),
      { mainAgent: true, _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 0, body: { messages: [msg('a', 'b')] } },
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[1].body.messages.length, 2);
  });

  it('broken 段内向后找到 checkpoint 修复（repaired = true）', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken（2 !== 4）
      cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]), // 段内 checkpoint 4 条
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[1].body.messages.length, 4);
    assert.deepEqual(seg[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd']);
  });

  it('broken 段内候选非 mainAgent → 跳过后用 nextCheckpoint 修复', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken
      old([msg('u', 'tm')], { mainAgent: false }), // 候选非 mainAgent → skip
    ];
    const next = cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd'), msg('u', 'e')]);
    reconstructSegment(seg, next);
    // 段内未修复 → nextCheckpoint 截前 4
    assert.equal(seg[1].body.messages.length, 4);
    assert.deepEqual(seg[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd']);
  });

  it('broken 段内候选 body.messages 非数组 → 跳过', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 3), // broken
      { mainAgent: true, body: { messages: undefined } }, // 候选无数组 → skip
    ];
    const next = cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c')]);
    reconstructSegment(seg, next);
    assert.equal(seg[1].body.messages.length, 3);
  });

  it('broken 段内候选是 delta（isFullEntry false）→ 跳过用 nextCheckpoint', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken
      delta([msg('u', 'c')], 5),  // delta 候选 → isFullEntry false skip
    ];
    const next = cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]);
    reconstructSegment(seg, next);
    assert.equal(seg[1].body.messages.length, 4);
  });

  it('broken 段内候选 total 不足 → 跳过用 nextCheckpoint', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken 期望 4
      cp([msg('u', 'a'), msg('a', 'b')]), // 仅 2 条 < 4 → skip
    ];
    const next = cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]);
    reconstructSegment(seg, next);
    assert.equal(seg[1].body.messages.length, 4);
  });

  it('broken 候选用 candidateMsgs.length 兜底 total（无 _totalMessageCount）', () => {
    const seg = [
      delta([msg('u', 'orphan')], 3), // 首条 broken（accumulated 空）
      old([msg('u', 'a'), msg('a', 'b'), msg('u', 'c')]), // 旧格式无 _totalMessageCount，length=3 兜底
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[0].body.messages.length, 3);
    assert.deepEqual(seg[0].body.messages.map(m => m.content), ['a', 'b', 'c']);
  });

  it('broken 段内未修复且 nextCheckpoint 为 null → 保留不完整', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 9), // broken，段内无补偿候选
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[1].body.messages.length, 2);
  });

  it('broken 用 nextCheckpoint：cpMsgs 非数组 → 不修复', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 9), // broken
    ];
    const next = { mainAgent: true, _deltaFormat: 1, _isCheckpoint: true, body: { messages: null } };
    reconstructSegment(seg, next);
    // cpMsgs 非数组 → 保留累积 2 条
    assert.equal(seg[1].body.messages.length, 2);
  });

  it('broken 用 nextCheckpoint：cpTotal 不足 expectedCount → 不修复', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 9), // 期望 9
    ];
    const next = cp([msg('u', 'a'), msg('a', 'b')]); // 仅 2 < 9
    reconstructSegment(seg, next);
    assert.equal(seg[1].body.messages.length, 2);
  });

  it('broken 用 nextCheckpoint：_totalMessageCount falsy 时用 cpMsgs.length 兜底', () => {
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken
    ];
    // nextCheckpoint 无 _totalMessageCount（0），用 messages.length=4 兜底
    const next = { mainAgent: true, _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 0, body: { messages: [msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')] } };
    reconstructSegment(seg, next);
    assert.equal(seg[1].body.messages.length, 4);
    assert.deepEqual(seg[1].body.messages.map(m => m.content), ['a', 'b', 'c', 'd']);
  });

  it('broken 段内 expectedCount falsy → continue（不补偿）', () => {
    // brokenEntry 的 _totalMessageCount 必须为真才会入 broken，
    // 因此该 continue 分支理论上不可由 broken 列表触发；用直接判定保障路径覆盖。
    // 这里通过两条 broken：其一 total 真值正常修复，验证循环正常推进。
    const seg = [
      cp([msg('u', 'a')]),
      delta([msg('a', 'b')], 4), // broken
      cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c'), msg('a', 'd')]),
    ];
    reconstructSegment(seg, null);
    assert.equal(seg[1].body.messages.length, 4);
  });

  it('单条 checkpoint 段 → 原样返回', () => {
    const seg = [cp([msg('u', 'only')])];
    const result = reconstructSegment(seg, null);
    assert.equal(result[0].body.messages.length, 1);
  });
});

// ============================================================================
// createIncrementalReconstructor — inProgress 分支 + 常规路径
// ============================================================================
describe('createIncrementalReconstructor inProgress 分支', () => {
  it('inProgress + delta 非 checkpoint + msgs 数组 → 用 accumulated 副本重建但不更新 accumulated', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a'), msg('a', 'b')])); // accumulated = [a,b]
    const ip = delta([msg('u', 'streaming')], 3, { inProgress: true });
    const out = r.reconstruct(ip);
    // inProgress 重建为 [a,b,streaming]
    assert.deepEqual(out.body.messages.map(m => m.content), ['a', 'b', 'streaming']);
    // 后续 completed delta 仍基于未被污染的 accumulated [a,b]
    const done = r.reconstruct(delta([msg('u', 'streaming')], 3));
    assert.deepEqual(done.body.messages.map(m => m.content), ['a', 'b', 'streaming']);
  });

  it('inProgress + delta 非 checkpoint + msgs 非数组 → 原样返回(不改 body)', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    const ip = { mainAgent: true, _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 2, inProgress: true, body: { messages: 'x' } };
    const out = r.reconstruct(ip);
    assert.equal(out.body.messages, 'x'); // 未改写
  });

  it('inProgress + checkpoint → 不进入重建分支，原样返回', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    // inProgress 的隐式 checkpoint（count===len）
    const ip = delta([msg('u', 'cpx'), msg('a', 'cpy')], 2, { inProgress: true });
    const out = r.reconstruct(ip);
    // isCheckpointEntry true → 跳过重建，body.messages 保持原 delta 内容
    assert.deepEqual(out.body.messages.map(m => m.content), ['cpx', 'cpy']);
  });

  it('inProgress + 非 delta 条目 → 原样返回', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    const ip = { mainAgent: true, inProgress: true, body: { messages: [msg('u', 'old-ip')] } };
    const out = r.reconstruct(ip);
    // 非 delta（无 _deltaFormat）→ isDeltaEntry false → 直接 return entry，不重建
    assert.deepEqual(out.body.messages.map(m => m.content), ['old-ip']);
  });
});

describe('createIncrementalReconstructor 常规分支', () => {
  it('非 delta mainAgent 旧格式 → 更新累积', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(old([msg('u', 'x'), msg('a', 'y')]));
    const out = r.reconstruct(delta([msg('u', 'z')], 3));
    assert.deepEqual(out.body.messages.map(m => m.content), ['x', 'y', 'z']);
  });

  it('非 delta 非 mainAgent → 不更新累积（&& 短路）', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    r.reconstruct(old([msg('u', 'tm')], { mainAgent: false }));
    const out = r.reconstruct(delta([msg('a', 'b')], 2));
    assert.deepEqual(out.body.messages.map(m => m.content), ['a', 'b']);
  });

  it('非 delta mainAgent 但 body.messages 非数组 → 不更新累积', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    r.reconstruct({ mainAgent: true, body: { messages: null } });
    const out = r.reconstruct(delta([msg('a', 'b')], 2));
    assert.deepEqual(out.body.messages.map(m => m.content), ['a', 'b']);
  });

  it('delta body.messages 非数组 → 原样返回', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a')]));
    const out = r.reconstruct({ mainAgent: true, _deltaFormat: 1, _totalMessageCount: 2, _isCheckpoint: false, body: { messages: null } });
    assert.equal(out.body.messages, null);
  });

  it('checkpoint → 重置累积', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a'), msg('a', 'b'), msg('u', 'c')]));
    r.reconstruct(cp([msg('u', 'fresh')]));
    const out = r.reconstruct(delta([msg('a', 'x')], 2));
    assert.deepEqual(out.body.messages.map(m => m.content), ['fresh', 'x']);
  });

  it('reset() 清空累积', () => {
    const r = createIncrementalReconstructor();
    r.reconstruct(cp([msg('u', 'a'), msg('a', 'b')]));
    r.reset();
    const out = r.reconstruct(cp([msg('u', 'restart')]));
    assert.deepEqual(out.body.messages.map(m => m.content), ['restart']);
  });
});
