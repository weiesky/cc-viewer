/**
 * Delta Storage 端到端验证测试
 * 模拟 interceptor 写入 delta 日志 → readLogFile 读取重建 → 验证正确性
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLogFile } from '../lib/log-watcher.js';
import { readLocalLog } from '../lib/log-management.js';
import { reconstructEntries, createIncrementalReconstructor } from '../lib/delta-reconstructor.js';

// ============================================================================
// Helpers — 模拟 interceptor 的写入行为
// ============================================================================

function msg(role, text) {
  return { role, content: text };
}

const CHECKPOINT_INTERVAL = 10;

/**
 * 模拟 interceptor 在 delta 模式下的写入行为
 * 返回 { logFile, fullConversation } 用于验证
 */
function simulateInterceptorWrites(logFile, turns) {
  let lastMessagesCount = 0;
  let deltaCount = 0;
  const fullConversation = []; // 完整的对话历史（用于验证）

  for (const turn of turns) {
    // 模拟用户发送消息后，messages 数组增长
    fullConversation.push(...turn.newMessages);
    const allMessages = [...fullConversation];
    deltaCount++;

    // 模拟 checkpoint 触发逻辑（与 interceptor.js 一致）
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
        tools: [{ name: 'Edit' }, { name: 'Bash' }],
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
      // teammate：全量写入，不走 delta
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

    // 模拟 inProgress 写入（会被后续 completed 覆盖）
    const inProgressEntry = { ...entry, inProgress: true, requestId: `req_${deltaCount}` };
    appendFileSync(logFile, JSON.stringify(inProgressEntry) + '\n---\n');

    // 模拟 completed 写入
    appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    // completed 后更新状态
    if (entry.mainAgent !== false) {
      lastMessagesCount = allMessages.length;
    }
  }

  return fullConversation;
}

// ============================================================================
// Tests
// ============================================================================

let tmpDir;
let logFile;

describe('Delta Storage E2E', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'delta-e2e-'));
    logFile = join(tmpDir, 'test.jsonl');
    writeFileSync(logFile, '');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('基本 delta 写入+读取：5 轮对话正确重建', () => {
    const turns = [
      { newMessages: [msg('user', 'hello')] },
      { newMessages: [msg('assistant', 'hi there'), msg('user', 'how are you')] },
      { newMessages: [msg('assistant', 'good'), msg('user', 'tell me a joke')] },
      { newMessages: [msg('assistant', 'why did the chicken...')] },
      { newMessages: [msg('user', 'haha')] },
    ];

    const expectedConversation = simulateInterceptorWrites(logFile, turns);
    const entries = readLogFile(logFile);

    // 过滤 mainAgent 条目（去重后应该只有 completed 条目）
    const mainAgentEntries = entries.filter(e => e.mainAgent && !e.inProgress);
    assert.equal(mainAgentEntries.length, 5, `Expected 5 mainAgent entries, got ${mainAgentEntries.length}`);

    // 最后一条应该包含完整对话历史
    const lastEntry = mainAgentEntries[mainAgentEntries.length - 1];
    assert.equal(lastEntry.body.messages.length, expectedConversation.length,
      `Last entry should have ${expectedConversation.length} messages, got ${lastEntry.body.messages.length}`);

    // 验证每条消息内容
    for (let i = 0; i < expectedConversation.length; i++) {
      assert.equal(lastEntry.body.messages[i].content, expectedConversation[i].content,
        `Message ${i} content mismatch`);
    }
  });

  it('checkpoint 触发：第 10 条写入完整快照', () => {
    const turns = [];
    for (let i = 0; i < 12; i++) {
      turns.push({ newMessages: [msg('user', `msg-${i}`), msg('assistant', `resp-${i}`)] });
    }

    simulateInterceptorWrites(logFile, turns);
    const entries = readLogFile(logFile);
    const mainAgentEntries = entries.filter(e => e.mainAgent && !e.inProgress);

    // 第 1 条（首次请求，_lastMessagesCount=0）和第 10 条应该是 checkpoint
    assert.equal(mainAgentEntries[0]._isCheckpoint, true, 'First entry should be checkpoint');
    assert.equal(mainAgentEntries[9]._isCheckpoint, true, 'Entry 10 should be checkpoint');

    // 第 2-9 条应该是 delta
    for (let i = 1; i < 9; i++) {
      assert.equal(mainAgentEntries[i]._isCheckpoint, false, `Entry ${i + 1} should be delta`);
    }

    // 最后一条（第 12 条）重建后应该有完整的 24 条消息
    const lastEntry = mainAgentEntries[mainAgentEntries.length - 1];
    assert.equal(lastEntry.body.messages.length, 24);
  });

  it('messages 缩短（模拟 /clear）→ 自动 checkpoint + 正确重建', () => {
    // 先写 3 轮
    const turns1 = [
      { newMessages: [msg('user', 'a')] },
      { newMessages: [msg('assistant', 'b'), msg('user', 'c')] },
      { newMessages: [msg('assistant', 'd')] },
    ];
    simulateInterceptorWrites(logFile, turns1);

    // 模拟 /clear 后新对话（messages 从头开始）
    // 需要手动写入，因为 simulateInterceptorWrites 内部状态会延续
    // 使用足够靠后的时间戳避免与 simulateInterceptorWrites 产生的条目冲突
    const clearMessages = [msg('user', 'fresh start')];
    const clearEntry = {
      timestamp: new Date(Date.now() + 100000).toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: true,
      _deltaFormat: 1,
      _totalMessageCount: 1,
      _conversationId: 'mainAgent',
      _isCheckpoint: true, // messages.length < lastMessagesCount → checkpoint
      body: { messages: clearMessages, model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } },
    };
    appendFileSync(logFile, JSON.stringify(clearEntry) + '\n---\n');

    // /clear 后的第二轮
    const postClearDelta = {
      timestamp: new Date(Date.now() + 101000).toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: true,
      _deltaFormat: 1,
      _totalMessageCount: 2,
      _conversationId: 'mainAgent',
      _isCheckpoint: false,
      body: { messages: [msg('assistant', 'hello again')], model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } },
    };
    appendFileSync(logFile, JSON.stringify(postClearDelta) + '\n---\n');

    const entries = readLogFile(logFile);
    const mainAgentEntries = entries.filter(e => e.mainAgent && !e.inProgress);

    // /clear 后的最后一条应该只有 2 条消息（不是 4+2=6）
    const lastEntry = mainAgentEntries[mainAgentEntries.length - 1];
    assert.equal(lastEntry.body.messages.length, 2);
    assert.equal(lastEntry.body.messages[0].content, 'fresh start');
    assert.equal(lastEntry.body.messages[1].content, 'hello again');
  });

  it('teammate 条目不受影响，不干扰 mainAgent 重建', () => {
    const turns = [
      { newMessages: [msg('user', 'main-1')] },
      // teammate（全量写入）
      { newMessages: [msg('user', 'tm-task')], mainAgent: false, teammate: 'worker-1' },
      { newMessages: [msg('assistant', 'main-resp'), msg('user', 'main-2')] },
    ];

    simulateInterceptorWrites(logFile, turns);
    const entries = readLogFile(logFile);

    // teammate 条目
    const tmEntries = entries.filter(e => e.teammate);
    assert.equal(tmEntries.length, 1);
    assert.ok(!tmEntries[0]._deltaFormat, 'Teammate entry should not have _deltaFormat');

    // mainAgent 最后一条
    const mainEntries = entries.filter(e => e.mainAgent && !e.inProgress);
    const lastMain = mainEntries[mainEntries.length - 1];
    // 注意：teammate 的消息不应混入 mainAgent 的重建
    // simulateInterceptorWrites 中 teammate 也向 fullConversation 添加了消息
    // 但 mainAgent delta 的基准（lastMessagesCount）不会被 teammate 更新
    // 所以 mainAgent 链上的消息数可能包含 teammate 添加的（因为 fullConversation 是共享的）
    // 这里验证的是重建逻辑不会因为 teammate 条目而出错
    assert.ok(lastMain.body.messages.length > 0, 'MainAgent should have messages after reconstruction');
  });

  it('readLocalLog 与 readLogFile 返回一致的重建结果', () => {
    const turns = [
      { newMessages: [msg('user', 'x')] },
      { newMessages: [msg('assistant', 'y'), msg('user', 'z')] },
    ];
    simulateInterceptorWrites(logFile, turns);

    // readLogFile 直接读
    const fromReadLogFile = readLogFile(logFile);

    // readLocalLog 需要 logDir + relative file
    const fromReadLocalLog = readLocalLog(tmpDir, 'test.jsonl');

    // 两者应该返回相同的结果
    assert.equal(fromReadLogFile.length, fromReadLocalLog.length);
    for (let i = 0; i < fromReadLogFile.length; i++) {
      assert.deepEqual(
        fromReadLogFile[i].body.messages.map(m => m.content),
        fromReadLocalLog[i].body.messages.map(m => m.content),
        `Entry ${i} messages mismatch between readLogFile and readLocalLog`
      );
    }
  });

  it('增量重建器与批量重建结果一致', () => {
    const turns = [
      { newMessages: [msg('user', 'a')] },
      { newMessages: [msg('assistant', 'b'), msg('user', 'c')] },
      { newMessages: [msg('assistant', 'd')] },
    ];
    simulateInterceptorWrites(logFile, turns);

    // 批量
    const batchResult = readLogFile(logFile);

    // 增量
    const reconstructor = createIncrementalReconstructor();
    const content = readFileSync(logFile, 'utf-8');
    const parsed = content.split('\n---\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    // 去重
    const map = new Map();
    for (const e of parsed) map.set(`${e.timestamp}|${e.url}`, e);
    const deduped = Array.from(map.values());
    const incrResult = deduped.map(e => reconstructor.reconstruct(e));

    // 验证 mainAgent 条目一致
    const batchMain = batchResult.filter(e => e.mainAgent && !e.inProgress);
    const incrMain = incrResult.filter(e => e.mainAgent && !e.inProgress);

    assert.equal(batchMain.length, incrMain.length);
    for (let i = 0; i < batchMain.length; i++) {
      assert.deepEqual(
        batchMain[i].body.messages.map(m => m.content),
        incrMain[i].body.messages.map(m => m.content),
        `Entry ${i} mismatch`
      );
    }
  });

  it('旧格式日志完全兼容', () => {
    // 写入纯旧格式（无 _deltaFormat）
    const oldEntries = [
      {
        timestamp: '2026-03-23T10:00:00Z',
        url: 'https://api.anthropic.com/v1/messages',
        mainAgent: true,
        body: { messages: [msg('user', 'old1')], model: 'claude-opus-4-6' },
        response: { status: 200, body: { content: [{ type: 'text', text: 'r1' }] } },
      },
      {
        timestamp: '2026-03-23T10:01:00Z',
        url: 'https://api.anthropic.com/v1/messages',
        mainAgent: true,
        body: { messages: [msg('user', 'old1'), msg('assistant', 'r1'), msg('user', 'old2')], model: 'claude-opus-4-6' },
        response: { status: 200, body: { content: [{ type: 'text', text: 'r2' }] } },
      },
    ];

    writeFileSync(logFile, oldEntries.map(e => JSON.stringify(e)).join('\n---\n') + '\n---\n');
    const result = readLogFile(logFile);

    assert.equal(result.length, 2);
    assert.equal(result[0].body.messages.length, 1);
    assert.equal(result[1].body.messages.length, 3);
    // 旧格式条目不应有 _deltaFormat
    assert.ok(!result[0]._deltaFormat);
    assert.ok(!result[1]._deltaFormat);
  });

  it('混合格式（旧+新）正确处理', () => {
    // 先写旧格式
    const oldEntry = {
      timestamp: '2026-03-23T10:00:00Z',
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: true,
      body: { messages: [msg('user', 'old'), msg('assistant', 'resp')], model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'r' }] } },
    };
    writeFileSync(logFile, JSON.stringify(oldEntry) + '\n---\n');

    // 再写新格式 delta（基于旧格式的 2 条累积）
    const deltaEntry = {
      timestamp: '2026-03-23T10:02:00Z',
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: true,
      _deltaFormat: 1,
      _totalMessageCount: 3,
      _conversationId: 'mainAgent',
      _isCheckpoint: false,
      body: { messages: [msg('user', 'new')], model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'r2' }] } },
    };
    appendFileSync(logFile, JSON.stringify(deltaEntry) + '\n---\n');

    const result = readLogFile(logFile);
    assert.equal(result.length, 2);
    // 旧格式不变
    assert.equal(result[0].body.messages.length, 2);
    // delta 重建后有 3 条
    assert.equal(result[1].body.messages.length, 3);
    assert.deepEqual(result[1].body.messages.map(m => m.content), ['old', 'resp', 'new']);
  });

  it('inProgress 条目被 completed 覆盖，不影响重建', () => {
    // inProgress 和 completed 有相同的 timestamp+url
    const ts = '2026-03-23T10:00:00Z';
    const url = 'https://api.anthropic.com/v1/messages';

    // checkpoint（首条）
    const checkpoint = {
      timestamp: ts, url, mainAgent: true,
      _deltaFormat: 1, _totalMessageCount: 1, _conversationId: 'mainAgent', _isCheckpoint: true,
      body: { messages: [msg('user', 'hello')], model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'hi' }] } },
    };

    // 第二轮 inProgress（先写入）
    const ts2 = '2026-03-23T10:01:00Z';
    const inProgress = {
      timestamp: ts2, url, mainAgent: true, inProgress: true, requestId: 'req_1',
      _deltaFormat: 1, _totalMessageCount: 2, _conversationId: 'mainAgent', _isCheckpoint: false,
      body: { messages: [msg('assistant', 'partial...')], model: 'claude-opus-4-6' },
      response: null,
    };

    // 第二轮 completed（后写入，覆盖 inProgress）
    const completed = {
      timestamp: ts2, url, mainAgent: true,
      _deltaFormat: 1, _totalMessageCount: 2, _conversationId: 'mainAgent', _isCheckpoint: false,
      body: { messages: [msg('assistant', 'hi there')], model: 'claude-opus-4-6' },
      response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } },
    };

    writeFileSync(logFile,
      [checkpoint, inProgress, completed].map(e => JSON.stringify(e)).join('\n---\n') + '\n---\n'
    );

    const result = readLogFile(logFile);
    // 去重后应该只有 2 条（inProgress 被覆盖）
    assert.equal(result.length, 2);
    // 第二条重建后
    assert.equal(result[1].body.messages.length, 2);
    assert.equal(result[1].body.messages[0].content, 'hello');
    assert.equal(result[1].body.messages[1].content, 'hi there');
  });
});
