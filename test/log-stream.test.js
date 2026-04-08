/**
 * log-stream.js 单元测试
 * 验证 countLogEntries 和 streamReconstructedEntries 的正确性，
 * 并与 readLogFile 的全量重建结果对比确保一致。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countLogEntries, streamReconstructedEntries, streamRawEntriesAsync, readPagedEntries } from '../lib/log-stream.js';
import { readLogFile } from '../lib/log-watcher.js';
import { reconstructSegment, reconstructEntries } from '../lib/delta-reconstructor.js';

// ============================================================================
// Helpers
// ============================================================================

function msg(role, text) {
  return { role, content: text };
}

const CHECKPOINT_INTERVAL = 10;

/** 模拟 interceptor 写入 delta 日志（与 delta-e2e.test.js 一致） */
function simulateInterceptorWrites(logFile, turns) {
  let lastMessagesCount = 0;
  let deltaCount = 0;
  const fullConversation = [];

  for (const turn of turns) {
    fullConversation.push(...turn.newMessages);
    const allMessages = [...fullConversation];
    deltaCount++;

    const needsCheckpoint =
      lastMessagesCount === 0 ||
      allMessages.length < lastMessagesCount ||
      (deltaCount % CHECKPOINT_INTERVAL === 0);

    const entry = {
      timestamp: new Date(Date.now() + deltaCount * 1000).toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: turn.mainAgent !== undefined ? turn.mainAgent : true,
      body: {
        model: 'claude-opus-4-6',
        system: [{ type: 'text', text: 'You are helpful.' }],
      },
      response: {
        status: 200,
        body: {
          content: [{ type: 'text', text: `response-${deltaCount}` }],
          usage: { input_tokens: 100, output_tokens: 50 }
        }
      },
      duration: 100,
    };

    if (turn.mainAgent === false) {
      entry.body.messages = [...allMessages];
      entry.teammate = turn.teammate || 'worker-1';
      entry.teamName = 'test-team';
    } else if (needsCheckpoint) {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = true;
      entry.body.messages = [...allMessages];
    } else {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = false;
      entry.body.messages = allMessages.slice(lastMessagesCount);
    }

    // inProgress + completed
    const inProgressEntry = { ...entry, inProgress: true, requestId: `req_${deltaCount}` };
    appendFileSync(logFile, JSON.stringify(inProgressEntry) + '\n---\n');
    appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    if (entry.mainAgent !== false) {
      lastMessagesCount = allMessages.length;
    }
  }

  return fullConversation;
}

/** 收集 streamReconstructedEntries 的所有输出 */
function collectStreamEntries(filePath, opts = {}) {
  const all = [];
  streamReconstructedEntries(filePath, (segment) => {
    all.push(...segment);
  }, opts);
  return all;
}

// ============================================================================
// Tests
// ============================================================================

let tmpDir;
let logFile;

describe('countLogEntries', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回 0', () => {
    assert.equal(countLogEntries(join(tmpDir, 'nope.jsonl')), 0);
  });

  it('空文件返回 0', () => {
    writeFileSync(logFile, '');
    assert.equal(countLogEntries(logFile), 0);
  });

  it('单条目（无尾部分隔符）', () => {
    writeFileSync(logFile, '{"a":1}');
    assert.equal(countLogEntries(logFile), 1);
  });

  it('单条目（有尾部分隔符）', () => {
    writeFileSync(logFile, '{"a":1}\n---\n');
    assert.equal(countLogEntries(logFile), 1);
  });

  it('多条目', () => {
    writeFileSync(logFile, '{"a":1}\n---\n{"b":2}\n---\n{"c":3}\n---\n');
    assert.equal(countLogEntries(logFile), 3);
  });

  it('与实际 delta 写入一致', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);
    // 15 turns × 2 (inProgress + completed) = 30 条目
    assert.equal(countLogEntries(logFile), 30);
  });
});

describe('streamReconstructedEntries', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回 0 个条目', () => {
    const entries = collectStreamEntries(join(tmpDir, 'nope.jsonl'));
    assert.equal(entries.length, 0);
  });

  it('空文件返回 0 个条目', () => {
    writeFileSync(logFile, '');
    const entries = collectStreamEntries(logFile);
    assert.equal(entries.length, 0);
  });

  it('5 轮对话：与 readLogFile 输出一致', () => {
    writeFileSync(logFile, '');
    const turns = [
      { newMessages: [msg('user', 'hello')] },
      { newMessages: [msg('assistant', 'hi'), msg('user', 'how are you')] },
      { newMessages: [msg('assistant', 'good'), msg('user', 'joke')] },
      { newMessages: [msg('assistant', 'why...')] },
      { newMessages: [msg('user', 'haha')] },
    ];

    const expectedConversation = simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length,
      `条目数不一致: stream=${streamEntries.length}, batch=${batchEntries.length}`);

    // 逐条比较 mainAgent 条目的 messages
    for (let i = 0; i < streamEntries.length; i++) {
      const s = streamEntries[i];
      const b = batchEntries[i];
      assert.equal(s.timestamp, b.timestamp, `Entry ${i} timestamp mismatch`);
      if (s.mainAgent && Array.isArray(s.body?.messages)) {
        assert.equal(s.body.messages.length, b.body.messages.length,
          `Entry ${i} messages length mismatch: stream=${s.body.messages.length}, batch=${b.body.messages.length}`);
      }
    }

    // 最后一条 mainAgent 条目应有完整对话
    const lastMain = streamEntries.filter(e => e.mainAgent && !e.inProgress).pop();
    assert.equal(lastMain.body.messages.length, expectedConversation.length);
  });

  it('跨越 checkpoint 边界（15 轮）：与 readLogFile 一致', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }

    simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length);

    // 逐条比较 mainAgent messages
    const streamMains = streamEntries.filter(e => e.mainAgent && !e.inProgress);
    const batchMains = batchEntries.filter(e => e.mainAgent && !e.inProgress);

    assert.equal(streamMains.length, batchMains.length);
    for (let i = 0; i < streamMains.length; i++) {
      assert.equal(streamMains[i].body.messages.length, batchMains[i].body.messages.length,
        `MainAgent entry ${i} messages length mismatch`);
      // 验证每条 message 内容
      for (let j = 0; j < streamMains[i].body.messages.length; j++) {
        assert.equal(streamMains[i].body.messages[j].content, batchMains[i].body.messages[j].content,
          `MainAgent entry ${i}, msg ${j} content mismatch`);
      }
    }
  });

  it('穿插 teammate 条目：与 readLogFile 一致', () => {
    writeFileSync(logFile, '');
    const turns = [
      { newMessages: [msg('user', 'start')] },
      { newMessages: [msg('assistant', 'ok')], mainAgent: false, teammate: 'worker-1' },
      { newMessages: [msg('user', 'next')] },
      { newMessages: [msg('assistant', 'done')] },
    ];

    simulateInterceptorWrites(logFile, turns);

    const streamEntries = collectStreamEntries(logFile);
    const batchEntries = readLogFile(logFile);

    assert.equal(streamEntries.length, batchEntries.length);
  });

  it('分段回调被多次调用', () => {
    writeFileSync(logFile, '');
    // 写入 25 轮以确保跨越多个 checkpoint（每 10 条一个）
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let segmentCount = 0;
    streamReconstructedEntries(logFile, () => { segmentCount++; });
    // 25 轮 = 至少 2 个 checkpoint 边界 = 至少 3 段
    assert.ok(segmentCount >= 2, `Expected multiple segments, got ${segmentCount}`);
  });

  it('since 过滤：只返回时间戳之后的条目', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 5; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const allEntries = collectStreamEntries(logFile);
    // 取中间某条的时间戳作为 since
    const midTimestamp = allEntries[Math.floor(allEntries.length / 2)].timestamp;
    const filtered = collectStreamEntries(logFile, { since: midTimestamp });

    assert.ok(filtered.length < allEntries.length, 'Filtered should have fewer entries');
    assert.ok(filtered.length > 0, 'Filtered should have some entries');
    // 所有 filtered 条目的时间戳应大于 since
    for (const e of filtered) {
      assert.ok(new Date(e.timestamp).getTime() > new Date(midTimestamp).getTime(),
        `Entry timestamp ${e.timestamp} should be after since ${midTimestamp}`);
    }
  });

  it('旧格式（无 delta）条目正确处理', () => {
    // 直接写入旧格式全量条目
    const entries = [
      { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] } },
      { timestamp: '2026-01-01T00:01:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd')] } },
    ];
    writeFileSync(logFile, entries.map(e => JSON.stringify(e)).join('\n---\n') + '\n---\n');

    const streamEntries = collectStreamEntries(logFile);
    assert.equal(streamEntries.length, 2);
    assert.equal(streamEntries[0].body.messages.length, 2);
    assert.equal(streamEntries[1].body.messages.length, 4);
  });

  it('去重：同一 timestamp|url 保留最后一个', () => {
    const entry1 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, inProgress: true, body: { messages: [msg('user', 'hello')] } };
    const entry2 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'hello')], response: { text: 'world' } } };
    writeFileSync(logFile, [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n---\n') + '\n---\n');

    const streamEntries = collectStreamEntries(logFile);
    assert.equal(streamEntries.length, 1, 'Should deduplicate to 1 entry');
    assert.ok(!streamEntries[0].inProgress, 'Should keep the completed entry');
  });
});

describe('reconstructSegment', () => {
  it('单条 checkpoint 段', () => {
    const entry = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 3,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')] }
    };
    const result = reconstructSegment([entry], null);
    assert.equal(result.length, 1);
    assert.equal(result[0].body.messages.length, 3);
  });

  it('checkpoint + delta 段', () => {
    const cp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 2,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] }
    };
    const delta = {
      _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 4,
      mainAgent: true, body: { messages: [msg('user', 'c'), msg('assistant', 'd')] }
    };
    const result = reconstructSegment([cp, delta], null);
    assert.equal(result[1].body.messages.length, 4);
    assert.equal(result[1].body.messages[0].content, 'a');
    assert.equal(result[1].body.messages[3].content, 'd');
  });

  it('broken delta 用 nextCheckpoint 修复', () => {
    const cp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 2,
      mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] }
    };
    // delta 声称总共 6 条，但只追加了 2 条（缺了中间的）
    const brokenDelta = {
      _deltaFormat: 1, _isCheckpoint: false, _totalMessageCount: 6,
      mainAgent: true, body: { messages: [msg('user', 'e'), msg('assistant', 'f')] }
    };
    // nextCheckpoint 有完整的 8 条
    const nextCp = {
      _deltaFormat: 1, _isCheckpoint: true, _totalMessageCount: 8,
      mainAgent: true, body: { messages: [
        msg('user', 'a'), msg('assistant', 'b'),
        msg('user', 'c'), msg('assistant', 'd'),
        msg('user', 'e'), msg('assistant', 'f'),
        msg('user', 'g'), msg('assistant', 'h'),
      ] }
    };

    const result = reconstructSegment([cp, brokenDelta], nextCp);
    // broken delta 应被修复为 6 条（从 nextCp 截取前 6 条）
    assert.equal(result[1].body.messages.length, 6);
    assert.equal(result[1].body.messages[0].content, 'a');
    assert.equal(result[1].body.messages[5].content, 'f');
  });
});

// ============================================================================
// streamRawEntriesAsync — 异步原始条目流（server SSE 热路径）
// ============================================================================

describe('streamRawEntriesAsync', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-raw-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空文件返回 0', async () => {
    writeFileSync(logFile, '');
    const raws = [];
    const result = await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(result.sentCount, 0);
    assert.equal(result.totalCount, 0);
    assert.equal(raws.length, 0);
  });

  it('不存在的文件返回 0', async () => {
    const result = await streamRawEntriesAsync(join(tmpDir, 'nope.jsonl'), () => {});
    assert.equal(result.sentCount, 0);
    assert.equal(result.totalCount, 0);
  });

  it('发送原始 JSON 字符串（不是 parsed 对象）', async () => {
    const entry = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [] } };
    writeFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1);
    assert.equal(typeof raws[0], 'string', 'Should be raw string, not parsed object');
    // 解析后应与原始条目一致
    const parsed = JSON.parse(raws[0]);
    assert.equal(parsed.timestamp, '2026-01-01T00:00:00Z');
  });

  it('去重：inProgress 被 completed 覆盖', async () => {
    const ip = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', inProgress: true, body: {} };
    const done = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', body: { response: 'ok' } };
    writeFileSync(logFile, [JSON.stringify(ip), JSON.stringify(done)].join('\n---\n') + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1, 'Should deduplicate to 1');
    const parsed = JSON.parse(raws[0]);
    assert.ok(!parsed.inProgress, 'Should keep completed entry');
  });

  it('无 timestamp/url 的条目也能发送', async () => {
    const entry = { type: 'special', data: 'test' };
    writeFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1);
  });

  it('与 readLogFile + reconstructEntries 结果一致（端到端）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // streamRawEntriesAsync → parse → reconstructEntries（模拟客户端流程）
    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    const parsed = raws.map(r => JSON.parse(r));
    const clientResult = reconstructEntries(parsed);

    // readLogFile（旧全量路径）
    const serverResult = readLogFile(logFile);

    // 比较 mainAgent 条目数和最终 messages
    const clientMains = clientResult.filter(e => e.mainAgent && !e.inProgress);
    const serverMains = serverResult.filter(e => e.mainAgent && !e.inProgress);
    assert.equal(clientMains.length, serverMains.length, 'MainAgent entry count should match');

    // 最后一条的 messages 应完全一致
    const cLast = clientMains[clientMains.length - 1];
    const sLast = serverMains[serverMains.length - 1];
    assert.equal(cLast.body.messages.length, sLast.body.messages.length, 'Last entry messages count should match');
    for (let i = 0; i < cLast.body.messages.length; i++) {
      assert.equal(cLast.body.messages[i].content, sLast.body.messages[i].content, `Message ${i} content mismatch`);
    }
  });

  it('yield 确实被调用（多条目时不会同步阻塞）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let yieldCount = 0;
    const origSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = (cb) => { yieldCount++; origSetImmediate(cb); };
    try {
      await streamRawEntriesAsync(logFile, () => {});
      assert.ok(yieldCount > 0, 'Should have yielded at least once via setImmediate');
    } finally {
      globalThis.setImmediate = origSetImmediate;
    }
  });

  it('返回 { sentCount, totalCount } 而非数字', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
      { newMessages: [msg('user', 'q2')] },
    ]);
    const result = await streamRawEntriesAsync(logFile, () => {});
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.sentCount, 'number');
    assert.equal(typeof result.totalCount, 'number');
    assert.equal(result.sentCount, result.totalCount, 'Without since, sentCount === totalCount');
    assert.ok(result.totalCount > 0);
  });

  it('since 过滤：只发送 timestamp >= since 的条目', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
      { newMessages: [msg('user', 'q2')] },
      { newMessages: [msg('user', 'q3')] },
      { newMessages: [msg('user', 'q4')] },
      { newMessages: [msg('user', 'q5')] },
    ]);

    // 先获取所有条目
    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));
    const allParsed = allRaws.map(r => JSON.parse(r));
    const timestamps = allParsed.map(e => e.timestamp).sort();

    // 用中间时间戳作为 since
    const since = timestamps[Math.floor(timestamps.length / 2)];
    const filteredRaws = [];
    const result = await streamRawEntriesAsync(logFile, (r) => filteredRaws.push(r), { since });

    assert.ok(filteredRaws.length < allRaws.length, 'Filtered should have fewer entries');
    assert.ok(filteredRaws.length > 0, 'Filtered should have some entries');
    assert.equal(result.sentCount, filteredRaws.length, 'sentCount should match emitted count');
    assert.equal(result.totalCount, allRaws.length, 'totalCount should match full deduped count');

    // 所有 filtered 条目的时间戳应 >= since
    for (const raw of filteredRaws) {
      const parsed = JSON.parse(raw);
      assert.ok(parsed.timestamp >= since,
        `Entry timestamp ${parsed.timestamp} should be >= since ${since}`);
    }
  });

  it('since 在所有条目之后：返回空 delta', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
    ]);
    const raws = [];
    const result = await streamRawEntriesAsync(logFile, (r) => raws.push(r), {
      since: '2099-01-01T00:00:00Z',
    });
    assert.equal(raws.length, 0);
    assert.equal(result.sentCount, 0);
    assert.ok(result.totalCount > 0, 'totalCount should reflect all deduped entries');
  });

  it('onScan 对全量条目调用（不受 since 影响）', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
      { newMessages: [msg('user', 'q2')] },
      { newMessages: [msg('user', 'q3')] },
    ]);

    // 先计算全量原始条目数
    const rawCount = countLogEntries(logFile);

    let scanCount = 0;
    const filteredRaws = [];
    await streamRawEntriesAsync(logFile, (r) => filteredRaws.push(r), {
      since: '2099-01-01T00:00:00Z', // 过滤掉所有条目
      onScan: () => { scanCount++; },
    });

    assert.equal(filteredRaws.length, 0, 'since filter should exclude all entries');
    assert.equal(scanCount, rawCount, 'onScan should be called for every raw entry (before dedup)');
  });

  it('onReady 在 onRawEntry 之前调用', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
    ]);

    const callOrder = [];
    await streamRawEntriesAsync(logFile,
      () => { callOrder.push('rawEntry'); },
      {
        onReady: ({ totalCount }) => {
          callOrder.push('ready');
          assert.ok(totalCount > 0, 'totalCount should be available in onReady');
        },
      }
    );

    assert.equal(callOrder[0], 'ready', 'onReady should be called before any onRawEntry');
    assert.ok(callOrder.includes('rawEntry'), 'onRawEntry should be called');
  });

  it('onReady 空文件也会调用', async () => {
    writeFileSync(logFile, '');
    let readyCalled = false;
    await streamRawEntriesAsync(logFile, () => {}, {
      onReady: () => { readyCalled = true; },
    });
    assert.ok(readyCalled, 'onReady should be called even for empty files');
  });

  it('向后兼容：无 opts 参数仍正常工作', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
    ]);
    const raws = [];
    // 只传两个参数，不传 opts
    const result = await streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.ok(raws.length > 0);
    assert.equal(result.sentCount, raws.length);
  });

  it('since + reconstruct 端到端：增量合并后与全量一致', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 10; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // 模拟"缓存"：全量加载前 5 轮的数据
    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));
    const allParsed = allRaws.map(r => JSON.parse(r));
    const cached = reconstructEntries([...allParsed]);

    // 取缓存最后条目的时间戳作为 since
    const lastTs = cached[cached.length - 1].timestamp;

    // 模拟增量加载
    const deltaRaws = [];
    await streamRawEntriesAsync(logFile, (r) => deltaRaws.push(r), { since: lastTs });
    const delta = deltaRaws.map(r => JSON.parse(r));

    // Map 去重合并（模拟客户端逻辑）
    const map = new Map();
    for (const e of cached) map.set(`${e.timestamp}|${e.url}`, e);
    for (const e of delta) map.set(`${e.timestamp}|${e.url}`, e);
    const merged = Array.from(map.values());

    // 重建
    const mergedResult = reconstructEntries(merged);

    // 对比全量重建
    const fullResult = reconstructEntries(allParsed.map(r => ({ ...r })));

    // mainAgent 条目数应一致
    const mergedMains = mergedResult.filter(e => e.mainAgent && !e.inProgress);
    const fullMains = fullResult.filter(e => e.mainAgent && !e.inProgress);
    assert.equal(mergedMains.length, fullMains.length, 'MainAgent count should match');

    // 最终 messages 应一致
    const mLast = mergedMains[mergedMains.length - 1];
    const fLast = fullMains[fullMains.length - 1];
    assert.equal(mLast.body.messages.length, fLast.body.messages.length, 'Final messages count should match');
  });

  it('since 边界：timestamp === since 的条目应被包含（>= 语义）', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
      { newMessages: [msg('user', 'q2')] },
      { newMessages: [msg('user', 'q3')] },
    ]);

    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));
    const allParsed = allRaws.map(r => JSON.parse(r));

    // 选择某条的精确时间戳作为 since
    const target = allParsed[Math.floor(allParsed.length / 2)];
    const since = target.timestamp;

    const filteredRaws = [];
    await streamRawEntriesAsync(logFile, (r) => filteredRaws.push(r), { since });

    // 该条目应被包含（>= 而非 >）
    const filteredParsed = filteredRaws.map(r => JSON.parse(r));
    const found = filteredParsed.some(e => e.timestamp === since);
    assert.ok(found, `Entry with timestamp === since (${since}) should be included`);
  });

  it('无 timestamp 的 __nokey_ 条目不受 since 过滤影响', async () => {
    // 写入一条有 timestamp 的和一条无 timestamp 的
    const normal = { timestamp: '2026-01-01T00:00:00.000Z', url: '/v1/messages', body: {} };
    const noTs = { type: 'special', data: 'no-timestamp-entry' };
    writeFileSync(logFile, [JSON.stringify(normal), JSON.stringify(noTs)].join('\n---\n') + '\n---\n');

    const raws = [];
    const result = await streamRawEntriesAsync(logFile, (r) => raws.push(r), {
      since: '2099-01-01T00:00:00.000Z', // 排除所有有 timestamp 的条目
    });

    // 无 timestamp 条目应始终被包含
    assert.equal(raws.length, 1, 'Entry without timestamp should always be included');
    const parsed = JSON.parse(raws[0]);
    assert.equal(parsed.type, 'special');
    assert.equal(result.totalCount, 2, 'totalCount should include all deduped entries');
  });

  it('since 边界去重：inProgress 被 completed 替代', async () => {
    // 模拟：缓存有 inProgress，delta 有同 timestamp 的 completed
    const ts = '2026-06-15T12:00:00.000Z';
    const ip = { timestamp: ts, url: '/v1/messages', inProgress: true, mainAgent: true, body: { messages: [msg('user', 'hello')] } };
    const done = { timestamp: ts, url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'hello')] }, response: { status: 200, body: { content: [{ type: 'text', text: 'hi' }] } } };
    // 写入 inProgress 然后 completed（模拟正常日志流）
    writeFileSync(logFile, [JSON.stringify(ip), JSON.stringify(done)].join('\n---\n') + '\n---\n');

    // since = 该时间戳，应包含 completed 版本
    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r), { since: ts });

    assert.equal(raws.length, 1, 'Should emit exactly 1 entry (deduped)');
    const parsed = JSON.parse(raws[0]);
    assert.ok(!parsed.inProgress, 'Should be the completed version, not inProgress');
    assert.ok(parsed.response, 'Completed entry should have response');
  });

  it('limit 裁剪：只发送最新 N 条（去重后）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // 先获取全量条目数
    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));
    const totalDeduped = allRaws.length;

    // 用 limit=5 加载
    const limitRaws = [];
    const result = await streamRawEntriesAsync(logFile, (r) => limitRaws.push(r), { limit: 5 });

    assert.ok(limitRaws.length >= 5, `Should send at least limit entries, got ${limitRaws.length}`);
    assert.ok(limitRaws.length < totalDeduped, `Should send fewer than total (${totalDeduped}), got ${limitRaws.length}`);
    assert.equal(result.totalCount, totalDeduped, 'totalCount should reflect all deduped entries');
  });

  it('limit 裁剪：向前扩展到 checkpoint 边界', async () => {
    writeFileSync(logFile, '');
    // 写入足够多轮以确保有多个 checkpoint（每 10 条一个）
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const limitRaws = [];
    await streamRawEntriesAsync(logFile, (r) => limitRaws.push(r), { limit: 3 });

    // 第一条应该是 checkpoint（_isCheckpoint:true 或无 _deltaFormat）
    const first = JSON.parse(limitRaws[0]);
    const isCheckpoint = first._isCheckpoint === true || !first._deltaFormat;
    assert.ok(isCheckpoint, 'First entry after limit+alignment should be a checkpoint');
  });

  it('limit onReady 回调包含 hasMore 和 oldestTs', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let readyInfo = null;
    await streamRawEntriesAsync(logFile, () => {}, {
      limit: 5,
      onReady: (info) => { readyInfo = info; },
    });

    assert.ok(readyInfo, 'onReady should be called');
    assert.equal(typeof readyInfo.hasMore, 'boolean');
    assert.ok(readyInfo.hasMore, 'hasMore should be true when limit < total');
    assert.equal(typeof readyInfo.oldestTs, 'string');
    assert.ok(readyInfo.oldestTs.length > 0, 'oldestTs should be non-empty');
  });

  it('limit >= totalCount 时不裁剪', async () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
      { newMessages: [msg('user', 'q2')] },
    ]);

    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));

    const limitRaws = [];
    let readyInfo = null;
    await streamRawEntriesAsync(logFile, (r) => limitRaws.push(r), {
      limit: 9999,
      onReady: (info) => { readyInfo = info; },
    });

    assert.equal(limitRaws.length, allRaws.length, 'Should send all entries when limit >= total');
    assert.equal(readyInfo.hasMore, false, 'hasMore should be false when limit >= total');
  });

  it('limit 与 since 互相独立（limit 裁剪后 since 再过滤）', async () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // 获取全量条目
    const allRaws = [];
    await streamRawEntriesAsync(logFile, (r) => allRaws.push(r));
    const allTs = allRaws.map(r => JSON.parse(r).timestamp).filter(Boolean).sort();
    // since 设为接近末尾的时间戳
    const since = allTs[allTs.length - 3];

    // limit=5 + since 同时使用
    const raws = [];
    await streamRawEntriesAsync(logFile, (r) => raws.push(r), { limit: 5, since });

    // since 过滤应在 limit 裁剪后生效
    for (const raw of raws) {
      const parsed = JSON.parse(raw);
      if (parsed.timestamp) {
        assert.ok(parsed.timestamp >= since, `Entry ${parsed.timestamp} should be >= since ${since}`);
      }
    }
  });
});

// ============================================================================
// readPagedEntries — 分页历史条目（REST 端点用）
// ============================================================================

describe('readPagedEntries', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'log-stream-page-'));
    logFile = join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回空', () => {
    const result = readPagedEntries(join(tmpDir, 'nope.jsonl'), { before: '2099-01-01T00:00:00Z', limit: 10 });
    assert.equal(result.entries.length, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.count, 0);
  });

  it('空文件返回空', () => {
    writeFileSync(logFile, '');
    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 10 });
    assert.equal(result.entries.length, 0);
    assert.equal(result.hasMore, false);
  });

  it('过滤 timestamp < before 的条目', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 10; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // 获取全量条目的时间戳
    const allRaws = [];
    streamRawEntriesAsync(logFile, (r) => allRaws.push(r)).then(() => {});
    // 同步方式：用 readPagedEntries 自身的 before 在远未来
    const allResult = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 9999 });

    // 用中间时间戳作为 before
    const midTs = JSON.parse(allResult.entries[Math.floor(allResult.entries.length / 2)]).timestamp;
    const pageResult = readPagedEntries(logFile, { before: midTs, limit: 9999 });

    // 所有返回条目的 timestamp 应 < before
    for (const raw of pageResult.entries) {
      const entry = JSON.parse(raw);
      if (entry.timestamp) {
        assert.ok(entry.timestamp < midTs, `Entry ${entry.timestamp} should be < before ${midTs}`);
      }
    }
    assert.ok(pageResult.entries.length < allResult.entries.length, 'Should return fewer entries than total');
  });

  it('limit 限制返回条目数', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 20; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 5 });

    // 可能略多于 5（checkpoint 对齐），但不应等于全量
    assert.ok(result.entries.length >= 5, `Should return at least limit entries, got ${result.entries.length}`);
    const allResult = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 9999 });
    assert.ok(result.entries.length < allResult.entries.length, 'Should return fewer than total');
  });

  it('checkpoint 对齐：第一条是 checkpoint', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 25; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 3 });
    assert.ok(result.entries.length > 0, 'Should return some entries');

    // 第一条应该是 checkpoint
    const first = JSON.parse(result.entries[0]);
    const isCheckpoint = first._isCheckpoint === true || !first._deltaFormat;
    assert.ok(isCheckpoint, 'First entry should be a checkpoint after alignment');
  });

  it('hasMore 正确标记', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    // 小 limit → hasMore = true
    const smallResult = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 3 });
    assert.ok(smallResult.hasMore, 'hasMore should be true when there are earlier entries');

    // 大 limit → hasMore = false
    const bigResult = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 9999 });
    assert.equal(bigResult.hasMore, false, 'hasMore should be false when all entries returned');
  });

  it('oldestTimestamp 是返回条目中最早的时间戳', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 10; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 5 });
    assert.ok(result.oldestTimestamp, 'oldestTimestamp should be set');

    // oldestTimestamp 应等于返回条目中最早的 timestamp
    const timestamps = result.entries.map(r => JSON.parse(r).timestamp).filter(Boolean).sort();
    assert.equal(result.oldestTimestamp, timestamps[0], 'oldestTimestamp should match earliest entry');
  });

  it('entries 是原始 JSON 字符串数组', () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
    ]);

    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 10 });
    assert.ok(result.entries.length > 0);
    for (const entry of result.entries) {
      assert.equal(typeof entry, 'string', 'Each entry should be a raw JSON string');
      assert.doesNotThrow(() => JSON.parse(entry), 'Each entry should be valid JSON');
    }
  });

  it('before 早于所有条目时返回空', () => {
    writeFileSync(logFile, '');
    simulateInterceptorWrites(logFile, [
      { newMessages: [msg('user', 'q1')] },
    ]);

    const result = readPagedEntries(logFile, { before: '1970-01-01T00:00:00Z', limit: 10 });
    assert.equal(result.entries.length, 0);
    assert.equal(result.hasMore, false);
  });

  it('count 等于 entries.length', () => {
    writeFileSync(logFile, '');
    const turns = [];
    for (let i = 0; i < 10; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const result = readPagedEntries(logFile, { before: '2099-01-01T00:00:00Z', limit: 5 });
    assert.equal(result.count, result.entries.length, 'count should equal entries.length');
  });
});
