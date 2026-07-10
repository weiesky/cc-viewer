/**
 * Delta Storage 端到端验证测试
 * 模拟 interceptor 写入 delta 日志 → readLogFile 读取重建 → 验证正确性
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLogFile } from '../server/lib/log-watcher.js';
import { readLocalLog } from '../server/lib/log-management.js';
import { reconstructEntries, createIncrementalReconstructor } from '../server/lib/delta-reconstructor.js';
import { fingerprintMsg } from '../server/lib/interceptor-core.js';

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
  let lastTailFp = '';
  let deltaCount = 0;
  const fullConversation = []; // 完整的对话历史（用于验证）

  for (const turn of turns) {
    // 三种 turn 类型：
    //   { newMessages: [...] }        —— append（默认）
    //   { replaceLast: msg }           —— in-place last-msg replace（长度不变，末位换内容）
    //   { mainAgent: false, ... }     —— teammate 请求
    if (turn.replaceLast) {
      // 末位原地替换：长度不变，末位元素换成新的
      if (fullConversation.length === 0) throw new Error('replaceLast 需先有 append');
      fullConversation[fullConversation.length - 1] = turn.replaceLast;
    } else if (Array.isArray(turn.newMessages)) {
      fullConversation.push(...turn.newMessages);
    }
    const allMessages = [...fullConversation];
    deltaCount++;

    // 计算当前末位 fp（与 interceptor.js Plan C 一致）
    const currentTailFp = allMessages.length > 0 ? fingerprintMsg(allMessages[allMessages.length - 1]) : '';
    const sameLenInPlaceReplace =
      allMessages.length === lastMessagesCount &&
      lastMessagesCount > 0 &&
      lastTailFp !== '' &&
      currentTailFp !== '' &&
      currentTailFp !== lastTailFp;

    // 模拟 checkpoint 触发逻辑（与 interceptor.js 一致）
    const needsCheckpoint =
      lastMessagesCount === 0 ||
      allMessages.length < lastMessagesCount ||
      (deltaCount % CHECKPOINT_INTERVAL === 0) ||
      sameLenInPlaceReplace;

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
      if (sameLenInPlaceReplace) entry._inPlaceReplaceDetected = true;
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
      lastTailFp = currentTailFp;
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

  it('mid-conversation role:"system" messages survive write→reconstruct at their indices', () => {
    // Observed wire shape (mid-conversation-system beta, CLI 2.1.201): deltas append
    // [assistant, user, system] where the system message is a plain string. Spans a
    // checkpoint (>10 writes) so both delta-append and snapshot paths are exercised.
    const turns = [{ newMessages: [msg('user', 'q-0')] }];
    for (let i = 0; i < 12; i++) {
      turns.push({
        newMessages: i % 3 === 2
          ? [msg('assistant', `a-${i}`), msg('user', `q-${i}`), msg('system', `reminder-${i}`)]
          : [msg('assistant', `a-${i}`), msg('user', `q-${i}`)],
      });
    }

    const expectedConversation = simulateInterceptorWrites(logFile, turns);
    const entries = readLogFile(logFile);
    const mainAgentEntries = entries.filter(e => e.mainAgent && !e.inProgress);
    const lastEntry = mainAgentEntries[mainAgentEntries.length - 1];

    assert.equal(lastEntry.body.messages.length, expectedConversation.length);
    for (let i = 0; i < expectedConversation.length; i++) {
      assert.equal(lastEntry.body.messages[i].role, expectedConversation[i].role, `role mismatch at ${i}`);
      assert.equal(lastEntry.body.messages[i].content, expectedConversation[i].content, `content mismatch at ${i}`);
    }
    // system messages sit at their original indices
    const sysIdx = expectedConversation.map((m, i) => (m.role === 'system' ? i : -1)).filter(i => i >= 0);
    assert.ok(sysIdx.length >= 3, 'fixture should contain several system messages');
    for (const i of sysIdx) {
      assert.equal(lastEntry.body.messages[i].role, 'system');
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

  it('readLocalLog 与 readLogFile 返回一致的重建结果', async () => {
    const turns = [
      { newMessages: [msg('user', 'x')] },
      { newMessages: [msg('assistant', 'y'), msg('user', 'z')] },
    ];
    simulateInterceptorWrites(logFile, turns);

    // readLogFile 直接读
    const fromReadLogFile = readLogFile(logFile);

    // readLocalLog 需要 logDir + relative file
    const fromReadLocalLog = await readLocalLog(tmpDir, 'test.jsonl');

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

  // ==========================================================================
  // Plan C：in-place last-msg replace 端到端验证
  // ==========================================================================

  it('Plan C: in-place replace 触发 checkpoint，重建后末位是新内容（不是被替换前的）', () => {
    // 场景：CLI 注入 SUGGESTION MODE 末位 → 用户真实输入替换末位（长度不变）
    // 旧逻辑：messages.slice(_lastMessagesCount) = []，丢失末位变化 → 重建拿到旧末位
    // Plan C：检测到 in-place 替换，强制 checkpoint，messages 全量写入
    const turns = [
      { newMessages: [msg('user', 'h1'), msg('assistant', 'h2'), msg('user', 'h3')] },
      // CLI 在末位注入 SUGGESTION MODE prompt（长度变 4）
      { newMessages: [{ role: 'user', content: '[SUGGESTION MODE: Suggest what the user might naturally type next...]' }] },
      // 真实用户输入到达，CLI 把末位 SUGGESTION MODE 替换成真实输入（长度仍 4）
      { replaceLast: msg('user', 'real user prompt that replaced the suggestion stub') },
    ];
    simulateInterceptorWrites(logFile, turns);

    const result = readLogFile(logFile);
    assert.equal(result.length, 3);

    // 验证最后一条是 in-place 触发的 checkpoint
    const lastEntry = result[2];
    assert.equal(lastEntry._isCheckpoint, true);
    assert.equal(lastEntry._inPlaceReplaceDetected, true);

    // 验证重建后末位是新内容（"real user prompt..."），不是被替换前的 SUGGESTION MODE
    const reconstructed = lastEntry.body.messages;
    assert.equal(reconstructed.length, 4);
    assert.equal(reconstructed[3].role, 'user');
    assert.equal(reconstructed[3].content, 'real user prompt that replaced the suggestion stub');
    // 没有 doubling：reconstructed 应该是 4 条不是 8 条
    assert.equal(reconstructed.length, 4);
  });

  it('Plan C: doubled-history 回归 —— 反事实证伪（关闭 fp 检测时重建仍取旧末位）', () => {
    // 这条 case 验证：如果不做 in-place 检测，重建会拿到错误的"前态末位"
    // 用一个"老逻辑模拟器"再跑一遍同样序列，验证旧逻辑确实有 bug
    function legacySimulate(logFile, turns) {
      let lastMessagesCount = 0;
      let deltaCount = 0;
      const fullConversation = [];
      for (const turn of turns) {
        if (turn.replaceLast) {
          fullConversation[fullConversation.length - 1] = turn.replaceLast;
        } else if (Array.isArray(turn.newMessages)) {
          fullConversation.push(...turn.newMessages);
        }
        const allMessages = [...fullConversation];
        deltaCount++;
        // 老逻辑：仅按长度 + 周期判断，不看 fp
        const needsCheckpoint =
          lastMessagesCount === 0 ||
          allMessages.length < lastMessagesCount ||
          (deltaCount % CHECKPOINT_INTERVAL === 0);
        const entry = {
          timestamp: new Date(Date.now() + deltaCount * 1000).toISOString(),
          url: 'https://api.anthropic.com/v1/messages',
          mainAgent: true,
          body: { model: 'claude-opus-4-6', system: [{ type: 'text', text: 's' }], tools: [] },
          response: { status: 200, body: { content: [{ type: 'text', text: 'r' }] } },
        };
        if (needsCheckpoint) {
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
        appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');
        lastMessagesCount = allMessages.length;
      }
    }

    const turns = [
      { newMessages: [msg('user', 'h1'), msg('assistant', 'h2'), msg('user', 'h3'), msg('user', '[SUGGESTION MODE: stub]')] },
      { replaceLast: msg('user', 'REAL USER INPUT replacing suggestion') },
    ];

    // 老逻辑：跑出来的日志末位 entry 重建后是 SUGGESTION MODE（错误）
    const legacyLog = join(tmpDir, 'legacy.jsonl');
    writeFileSync(legacyLog, '');
    legacySimulate(legacyLog, turns);
    const legacyResult = readLogFile(legacyLog);
    const legacyLast = legacyResult[legacyResult.length - 1].body.messages;
    // 老逻辑下：第二次请求的 delta=[]，重建 messages = 第一次 ckpt 的 4 条（含 SUGGESTION MODE）
    assert.equal(legacyLast[3].content, '[SUGGESTION MODE: stub]', '老逻辑应该错误地保留 SUGGESTION MODE 在末位');

    // Plan C 逻辑：跑同样序列，重建后末位是真实用户输入（正确）
    simulateInterceptorWrites(logFile, turns);
    const planCResult = readLogFile(logFile);
    const planCLast = planCResult[planCResult.length - 1].body.messages;
    assert.equal(planCLast[3].content, 'REAL USER INPUT replacing suggestion', 'Plan C 应该正确反映末位替换');
    assert.equal(planCResult[planCResult.length - 1]._inPlaceReplaceDetected, true);
  });
});
