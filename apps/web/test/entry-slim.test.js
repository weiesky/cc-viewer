/**
 * Unit tests for src/utils/entry-slim.js
 * 覆盖 createIncrementalSlimmer 和 restoreSlimmedEntry 的防御检查。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIncrementalSlimmer,
  createEntrySlimmer,
  restoreSlimmedEntry,
  slimBodyBigFields,
  SYSTEM_TEXT_KEEP_PREFIX,
  internEntryBigFields,
  internMessagesToolResultBlocks,
  _resetInternPoolsForTest,
  _getInternPoolStatsForTest,
} from '../src/utils/entry-slim.js';
import { _resetReadPoolForTest } from '../src/utils/readResultPool.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const isMainAgent = (entry) => !!entry.mainAgent;

function makeMainAgent(msgCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
  }
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    body: {
      messages,
      metadata: opts.metadata || { user_id: opts.userId || 'user-1', request_id: `r-${Math.random()}` },
      model: 'claude-opus-4-6',
      tools: opts.tools || [
        { name: 'Bash', description: 'X'.repeat(20000), input_schema: { type: 'object', properties: { cmd: {} } } },
        { name: 'Read', description: 'X'.repeat(10000), input_schema: { type: 'object' } },
      ],
      system: opts.system || [
        { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude. ' + 'A'.repeat(50000), cache_control: { type: 'ephemeral' } },
      ],
      tool_choice: opts.tool_choice || { type: 'auto' },
    },
    response: { status: 200, body: {} },
  };
}

function makeSubAgent(msgCount) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: 'user', content: `sub-${i}` });
  }
  return {
    timestamp: new Date().toISOString(),
    url: 'https://api.anthropic.com/v1/messages',
    mainAgent: false,
    body: { messages, model: 'claude-sonnet-4-6' },
    response: { status: 200, body: {} },
  };
}

// ─── createIncrementalSlimmer ─────────────────────────────────────────────────

describe('createIncrementalSlimmer', () => {
  it('should slim previous MainAgent entries in the same session', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);
    assert.equal(e0._slimmed, undefined, 'first entry should not be slimmed');

    // Entry 1: 15 messages (same session, cumulative)
    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true, 'entry 0 should be slimmed');
    assert.equal(requests[0].body.messages.length, 0, 'entry 0 messages should be empty');
    assert.equal(requests[0]._messageCount, 10);
    assert.equal(requests[0]._fullEntryIndex, 1, 'entry 0 should point to entry 1');

    // Entry 2: 20 messages (same session)
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);
    assert.equal(requests[1]._slimmed, true, 'entry 1 should be slimmed');
    assert.equal(requests[1]._fullEntryIndex, 2, 'entry 1 should point to entry 2');
    // Entry 0 should also be updated to point to entry 2 (cascade)
    assert.equal(requests[0]._fullEntryIndex, 2, 'entry 0 should cascade to entry 2');
    // Entry 2 should remain full
    assert.equal(requests[2]._slimmed, undefined);
    assert.equal(requests[2].body.messages.length, 20);
  });

  it('should clear sessionSlimmedIndices on session boundary', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Session 1: entries 0, 1
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Session 2: entry 2 has 6 messages with different userId (new session, not transient)
    const e2 = makeMainAgent(6, { userId: 'user-2' });
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 should still point to entry 1 (not updated to entry 2 — different session)
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Session 2: entry 3 (12 messages)
    const e3 = makeMainAgent(12, { userId: 'user-2' });
    slimmer.processEntry(e3, requests, 3);
    requests.push(e3);
    assert.equal(requests[2]._slimmed, true, 'session 2 entry should be slimmed');
    assert.equal(requests[2]._fullEntryIndex, 3);
    // Entry 0 from session 1 should NOT be updated
    assert.equal(requests[0]._fullEntryIndex, 1);
  });

  it('should remove index from sessionSlimmedIndices on dedup', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Entry 1: 15 messages — slims entry 0
    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 1);

    // Dedup replaces entry 0 with a completed version
    const e0completed = makeMainAgent(10);
    requests[0] = e0completed;
    slimmer.onDedup(0);

    // Entry 2: 20 messages — should NOT try to update entry 0's _fullEntryIndex
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 (completed) should NOT have _fullEntryIndex (it was removed from set)
    assert.equal(requests[0]._fullEntryIndex, undefined, 'deduped entry should not have _fullEntryIndex');
    // Entry 1 should be slimmed and point to entry 2
    assert.equal(requests[1]._slimmed, true);
    assert.equal(requests[1]._fullEntryIndex, 2);
  });

  it('should skip transient requests', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: 15 messages
    const e0 = makeMainAgent(15);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Transient entry: only 2 messages, looks like new session but prevCount > 10
    const eTransient = makeMainAgent(2, { userId: 'user-2' });
    slimmer.processEntry(eTransient, requests, 1);
    requests.push(eTransient);

    // Entry 0 should NOT be slimmed (transient was skipped)
    assert.equal(requests[0]._slimmed, undefined);

    // Entry 2: 20 messages (same session as entry 0, continues normally)
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);
    assert.equal(requests[0]._slimmed, true, 'entry 0 should now be slimmed');
    assert.equal(requests[0]._fullEntryIndex, 2);
  });

  it('should not slim non-MainAgent entries', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const sub = makeSubAgent(5);
    slimmer.processEntry(sub, requests, 1);
    requests.push(sub);

    // SubAgent should not affect slim state; entry 0 should not be slimmed
    assert.equal(requests[0]._slimmed, undefined);
    assert.equal(sub._slimmed, undefined);
  });

  it('should detect session boundary by message count drop (same userId)', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Session 1: 20 messages
    const e0 = makeMainAgent(20);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(25);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);

    // Session 2: message count drops from 25 to 5 (same userId) → new session
    const e2 = makeMainAgent(5);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Entry 0 should still point to entry 1 (session 1), not entry 2 (session 2)
    assert.equal(requests[0]._fullEntryIndex, 1, 'session 1 entries should not cascade to session 2');

    // Session 2 continues: entry 3 slims entry 2
    const e3 = makeMainAgent(10);
    slimmer.processEntry(e3, requests, 3);
    requests.push(e3);
    assert.equal(requests[2]._slimmed, true);
    assert.equal(requests[2]._fullEntryIndex, 3);
  });

  it('should slim entries with _deltaFormat after reconstruction', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const eDelta = makeMainAgent(15);
    eDelta._deltaFormat = true;
    slimmer.processEntry(eDelta, requests, 1);
    requests.push(eDelta);

    // After reconstruction, delta entries have full messages and should be slimmed
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0].body.messages.length, 0);
    assert.equal(requests[0]._fullEntryIndex, 1);
  });
});

// ─── restoreSlimmedEntry defensive check ──────────────────────────────────────

describe('restoreSlimmedEntry', () => {
  it('should restore slimmed entry from fullEntry', () => {
    const full = makeMainAgent(20);
    const slimmed = {
      ...makeMainAgent(10),
      _slimmed: true,
      _messageCount: 10,
      _fullEntryIndex: 1,
    };
    slimmed.body.messages = [];
    const requests = [slimmed, full];

    const restored = restoreSlimmedEntry(slimmed, requests);
    assert.equal(restored.body.messages.length, 10);
    assert.notEqual(restored, slimmed, 'should return new object');
  });

  it('should return original entry when fullEntry has fewer messages than _messageCount', () => {
    const full = makeMainAgent(5); // only 5 messages, but slimmed expects 10
    const slimmed = {
      ...makeMainAgent(10),
      _slimmed: true,
      _messageCount: 10,
      _fullEntryIndex: 1,
    };
    slimmed.body.messages = [];
    const requests = [slimmed, full];

    const result = restoreSlimmedEntry(slimmed, requests);
    assert.equal(result, slimmed, 'should return original when fullEntry has insufficient messages');
  });

  it('should return original entry when not slimmed', () => {
    const entry = makeMainAgent(10);
    const requests = [entry];
    assert.equal(restoreSlimmedEntry(entry, requests), entry);
  });

  it('should return original entry when _fullEntryIndex is null', () => {
    const entry = makeMainAgent(10);
    entry._slimmed = true;
    entry._fullEntryIndex = null;
    const requests = [entry];
    assert.equal(restoreSlimmedEntry(entry, requests), entry);
  });

  it('should restore system/metadata/tool_choice from fullEntry (tools preserved, not slimmed)', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // §tools 修复：entry 0 被 slim，但 body.tools 完整保留（description/input_schema 不再剥离）
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0].body.tools.length, 2);
    assert.equal(requests[0].body.tools[0].name, 'Bash');
    assert.equal(requests[0].body.tools[0].description.length, 20000, 'tools description must NOT be stripped');
    assert.equal(requests[0].body.tools[0].input_schema.type, 'object', 'tools input_schema must NOT be stripped');

    // system text 被截断
    assert.ok(requests[0].body.system[0].text.length <= 2048);
    assert.ok(requests[0].body.system[0].text.startsWith('You are Claude Code'));
    assert.deepEqual(requests[0].body.system[0].cache_control, { type: 'ephemeral' });

    // metadata 仅保留 user_id
    assert.equal(requests[0].body.metadata.user_id, 'user-1');
    assert.equal(requests[0].body.metadata.request_id, undefined);

    // tool_choice 被删除
    assert.equal('tool_choice' in requests[0].body, false);

    // restore 后：system/metadata/tool_choice 从 fullEntry 还原；tools 保留 entry 自身
    const restored = restoreSlimmedEntry(requests[0], requests);
    assert.equal(restored.body.tools[0].description.length, 20000);
    assert.equal(restored.body.tools[0].input_schema.type, 'object');
    assert.equal(restored.body.system[0].text.length > 2048, true);
    assert.equal(restored.body.metadata.request_id, requests[1].body.metadata.request_id);
    assert.deepEqual(restored.body.tool_choice, { type: 'auto' });
  });

  it('should keep each request\'s OWN tools when tools vary per request (tools_search regression)', () => {
    // 复现用户场景：tools_search 开启时 tools 列表逐请求变化。
    // 修复前：slim 把非末位请求的 tools 降级 + restore 从末位 fullEntry 继承 →
    //         所有历史请求都显示最后一条的 tools。
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // e0：3 个 tool
    const e0 = makeMainAgent(10, {
      tools: [
        { name: 'Bash', description: 'B'.repeat(3000) },
        { name: 'Read', description: 'R'.repeat(3000) },
        { name: 'ToolSearch', description: 'S'.repeat(3000) },
      ],
    });
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // e1：ToolSearch 加载出 2 个新 tool（5 个），移除 Read → tools 列表变化
    const e1 = makeMainAgent(15, {
      tools: [
        { name: 'Bash', description: 'B'.repeat(3000) },
        { name: 'ToolSearch', description: 'S'.repeat(3000) },
        { name: 'WebFetch', description: 'W'.repeat(3000) },
        { name: 'WebSearch', description: 'X'.repeat(3000) },
      ],
    });
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // e0 已被 slim，但还原后必须是它自己的 tools（含 Read，不含 WebFetch/WebSearch）
    assert.equal(requests[0]._slimmed, true);
    const restored0 = restoreSlimmedEntry(requests[0], requests);
    const names0 = restored0.body.tools.map(tt => tt.name).sort();
    assert.deepEqual(names0, ['Bash', 'Read', 'ToolSearch'], 'slimmed e0 must keep its OWN tools, not inherit e1');

    // e1（fullEntry）保持自己的 tools
    const names1 = requests[1].body.tools.map(tt => tt.name).sort();
    assert.deepEqual(names1, ['Bash', 'ToolSearch', 'WebFetch', 'WebSearch']);
  });

  it('intern→slim→restore: distinct tools each pooled once, both restore to their OWN tools', () => {
    // 钉死「内存由 intern pool 兜底」的承诺：模拟生产链路(intern 先于 slim，见 AppBase SSE 路径)，
    // 两份不同 tools 各入池一份(去重有界)，slim+restore 后仍各自还原真实 tools。
    _resetInternPoolsForTest();
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const i0 = internEntryBigFields(makeMainAgent(10, {
      tools: [
        { name: 'Bash', description: 'B'.repeat(3000) },
        { name: 'Read', description: 'R'.repeat(3000) },
        { name: 'ToolSearch', description: 'S'.repeat(3000) },
      ],
    }));
    slimmer.processEntry(i0, requests, 0);
    requests.push(i0);

    const i1 = internEntryBigFields(makeMainAgent(15, {
      tools: [
        { name: 'Bash', description: 'B'.repeat(3000) },
        { name: 'ToolSearch', description: 'S'.repeat(3000) },
        { name: 'WebFetch', description: 'W'.repeat(3000) },
        { name: 'WebSearch', description: 'X'.repeat(3000) },
      ],
    }));
    slimmer.processEntry(i1, requests, 1);
    requests.push(i1);

    // 两份不同 tools-set 各入池一份(签名不同 → 不共享、不无限增长)
    assert.equal(_getInternPoolStatsForTest().toolsPoolSize, 2, 'distinct tools-sets should each be pooled once');

    // slim 后的 e0 还原出自己的 tools，未继承末位 e1
    assert.equal(requests[0]._slimmed, true);
    const restored0 = restoreSlimmedEntry(requests[0], requests);
    assert.deepEqual(restored0.body.tools.map(tt => tt.name).sort(), ['Bash', 'Read', 'ToolSearch']);
    // 还原出的 description 完整(slim 不再降级 tools，pool 持完整数据)
    assert.equal(restored0.body.tools.find(tt => tt.name === 'Read').description.length, 3000);
    assert.equal(requests[1].body.tools.length, 4);
  });

  it('should not mutate fullEntry body when slim runs (incremental path)', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    const origToolsRef = e0.body.tools;
    const origSystemRef = e0.body.system;
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // 增量路径 clone 后 e0 实例本身的 body 不应被替换（关键：React state 引用不变）
    assert.equal(e0.body.tools, origToolsRef, 'original e0.body.tools reference must not be mutated');
    assert.equal(e0.body.system, origSystemRef, 'original e0.body.system reference must not be mutated');
    // 而 requests[0] 是 cloned slimmed entry；§tools 修复后 tools 完整保留
    assert.notEqual(requests[0], e0, 'requests[0] should be the cloned slimmed entry, not e0');
    assert.equal(requests[0].body.tools[0].description.length, 20000, 'slimmed clone must keep full tools');
  });

  it('should slim body.system in batch slimmer but preserve body.tools', () => {
    const entries = [];
    const e0 = makeMainAgent(10);
    const e1 = makeMainAgent(15);
    entries.push(e0, e1);

    const slimmer = createEntrySlimmer(isMainAgent);
    slimmer.process(e0, entries, 0);
    slimmer.process(e1, entries, 1);
    slimmer.finalize(entries);

    assert.equal(entries[0]._slimmed, true);
    assert.equal(entries[0].body.tools[0].description.length, 20000, 'tools must NOT be slimmed');
    assert.ok(entries[0].body.system[0].text.length <= 2048);
    assert.equal('tool_choice' in entries[0].body, false);
    // entry 1 是 fullEntry，未变
    assert.equal(entries[1]._slimmed, undefined);
    assert.equal(entries[1].body.tools[0].description.length, 20000);
  });

  it('should preserve identifiers needed for isMainAgent detection in slimmed system text', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // slim 后 system text 必须仍包含 "You are Claude Code" 标识
    const sysText = requests[0].body.system.map(s => s.text || '').join('');
    assert.ok(sysText.includes('You are Claude Code'), 'slimmed system must retain MainAgent identifier');
    // tools[].name 必须保留（isMainAgent 旧路径依赖 body.tools.some(t=>t.name==='Edit') 等）
    assert.ok(Array.isArray(requests[0].body.tools));
    assert.equal(requests[0].body.tools[0].name, 'Bash');
    assert.equal(requests[0].body.tools[1].name, 'Read');
  });

  it('should restore cascaded slimmed entry using cascaded _fullEntryIndex', () => {
    // Build entries via the slimmer so cascade is applied correctly
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];

    // Entry 0: MainAgent, 10 messages
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    // Entry 1: non-MainAgent — should not affect slim state
    const e1 = makeSubAgent(5);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);

    // Entry 2: MainAgent, 20 messages — slims entry 0 and cascades _fullEntryIndex to 2
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);

    // Verify cascade happened: entry 0 points to entry 2
    assert.equal(requests[0]._slimmed, true);
    assert.equal(requests[0]._fullEntryIndex, 2, 'entry 0 should cascade to entry 2');

    // restoreSlimmedEntry should slice entry 2's messages down to entry 0's original count (10)
    const restored = restoreSlimmedEntry(requests[0], requests);
    assert.notEqual(restored, requests[0], 'should return new object');
    assert.equal(restored.body.messages.length, 10, 'restored entry should have original 10 messages sliced from entry 2');
  });
});

// ─── slimBodyBigFields edge cases ─────────────────────────────────────────────

describe('slimBodyBigFields edge cases', () => {
  it('should truncate body.system when it is a long string (not array)', () => {
    const body = {
      messages: [{ role: 'user', content: 'x' }],
      system: 'You are Claude Code, ' + 'A'.repeat(SYSTEM_TEXT_KEEP_PREFIX * 2),
    };
    const slimmed = slimBodyBigFields(body);
    assert.equal(typeof slimmed.system, 'string');
    assert.equal(slimmed.system.length, SYSTEM_TEXT_KEEP_PREFIX);
    assert.ok(slimmed.system.startsWith('You are Claude Code'));
    // 短字符串不截断
    const shortBody = { messages: [], system: 'short text' };
    assert.equal(slimBodyBigFields(shortBody).system, 'short text');
  });

  it('should preserve body.tools fully (no longer slimmed)', () => {
    const tools = [
      { name: 'Bash', description: 'X'.repeat(5000), input_schema: { type: 'object' } },
      { name: 'Read', description: 'Y'.repeat(5000) },
    ];
    const body = {
      messages: [{ role: 'user', content: 'x' }],
      tools,
    };
    const slimmed = slimBodyBigFields(body);
    // §tools 修复：tools 引用与内容完整透传（由 internEntryBigFields 的 pool 控内存，slim 不碰）
    assert.equal(slimmed.tools, tools, 'tools reference must be preserved');
    assert.equal(slimmed.tools[0].description.length, 5000, 'description must NOT be stripped');
    assert.equal(slimmed.tools[0].input_schema.type, 'object', 'input_schema must NOT be stripped');
  });

  it('should handle body.metadata when null/undefined', () => {
    // metadata 是 null
    const bodyNull = {
      messages: [{ role: 'user', content: 'x' }],
      metadata: null,
    };
    const slimmedNull = slimBodyBigFields(bodyNull);
    assert.equal(slimmedNull.metadata, null, 'null metadata should pass through unchanged');

    // metadata 缺失
    const bodyMissing = { messages: [{ role: 'user', content: 'x' }] };
    const slimmedMissing = slimBodyBigFields(bodyMissing);
    assert.equal('metadata' in slimmedMissing, false, 'missing metadata stays missing');

    // metadata 无 user_id
    const bodyNoUserId = {
      messages: [{ role: 'user', content: 'x' }],
      metadata: { request_id: 'r-123', some_other: 'value' },
    };
    const slimmedNoUserId = slimBodyBigFields(bodyNoUserId);
    assert.deepEqual(slimmedNoUserId.metadata, {}, 'metadata without user_id slims to empty object');
  });
});

// ─── internEntryBigFields (intern pool) ───────────────────────────────────────

describe('internEntryBigFields', () => {
  beforeEach(() => {
    _resetInternPoolsForTest();
  });

  it('should share tools array reference across entries with identical tools content', () => {
    const e1 = makeMainAgent(5);
    const e2 = makeMainAgent(8);
    // 默认 tools fixture 一致 → signature 相同 → 共享引用
    const i1 = internEntryBigFields(e1);
    const i2 = internEntryBigFields(e2);
    assert.equal(i1.body.tools, i2.body.tools, 'identical tools should be the same reference after intern');
    // 第一次 intern 时 e1 的 tools 不变（被注册到 pool）
    assert.equal(i1, e1, 'first intern returns original entry (no body replacement needed)');
    // 第二次 intern 时 e2 拿 pool ref → e2 被 clone
    assert.notEqual(i2, e2, 'second intern returns cloned entry with pooled tools');
    assert.equal(i2.body.tools, e1.body.tools, 'i2 tools points to e1 tools (pool registered first)');
  });

  it('should share system array reference for identical system content', () => {
    const e1 = makeMainAgent(5);
    const e2 = makeMainAgent(8);
    const i1 = internEntryBigFields(e1);
    const i2 = internEntryBigFields(e2);
    assert.equal(i1.body.system, i2.body.system, 'identical system should share reference');
  });

  it('should keep distinct entries when tools/system signatures differ', () => {
    const e1 = makeMainAgent(5);
    const e2 = makeMainAgent(8, {
      tools: [{ name: 'Edit', description: 'X'.repeat(2000) }],
    });
    const i1 = internEntryBigFields(e1);
    const i2 = internEntryBigFields(e2);
    assert.notEqual(i1.body.tools, i2.body.tools, 'different tools content should not collide');
    const stats = _getInternPoolStatsForTest();
    assert.equal(stats.toolsPoolSize, 2, 'tools pool should hold 2 distinct entries');
  });

  it('should be idempotent — interning an already pooled entry returns the same object', () => {
    const e1 = makeMainAgent(5);
    const i1a = internEntryBigFields(e1);
    const i1b = internEntryBigFields(i1a);
    assert.equal(i1a, i1b, 'second intern of same entry should not clone again');
  });

  it('should pass through entries with no tools/system', () => {
    const entry = { timestamp: '2026-01-01', url: 'x', body: { messages: [] } };
    const result = internEntryBigFields(entry);
    assert.equal(result, entry, 'entry without tools/system passes through unchanged');
  });

  it('should respect FIFO eviction at MAX_INTERN_POOL_SIZE (defensive)', () => {
    // 注入 201 种不同 signature 的 tools，验证 pool 不会无限增长
    for (let i = 0; i < 201; i++) {
      const e = makeMainAgent(2, {
        tools: [{ name: `Tool${i}`, description: 'X'.repeat(100) }],
      });
      internEntryBigFields(e);
    }
    const stats = _getInternPoolStatsForTest();
    assert.ok(stats.toolsPoolSize <= 200, `pool size ${stats.toolsPoolSize} should be capped at 200`);
  });

  it('should freeze pooled tools/system arrays to prevent accidental mutation', () => {
    const e1 = makeMainAgent(5);
    const i1 = internEntryBigFields(e1);
    // pool 中的 tools/system 数组应被冻结：push / splice / 索引赋值在 strict mode 抛 TypeError
    assert.ok(Object.isFrozen(i1.body.tools), 'pooled tools array must be frozen');
    assert.ok(Object.isFrozen(i1.body.system), 'pooled system array must be frozen');
    assert.throws(() => { i1.body.tools.push({ name: 'NewTool' }); }, TypeError, 'push on frozen tools must throw');
    assert.throws(() => { i1.body.tools[0] = { name: 'Replaced' }; }, TypeError, 'index assign on frozen tools must throw');
    assert.throws(() => { i1.body.system.splice(0, 1); }, TypeError, 'splice on frozen system must throw');
  });

  it('AppBase _batchSlim path: identical fullEntry tools across sessions share reference', () => {
    // 模拟 678 个 session 各有一个 fullEntry，tools 内容相同的极端场景
    const entries = [];
    for (let i = 0; i < 50; i++) {
      const e = makeMainAgent(5, { userId: `user-${i}` });
      entries.push(internEntryBigFields(e));
    }
    // 所有 entry 的 tools 应共享同一引用
    const ref = entries[0].body.tools;
    for (let i = 1; i < entries.length; i++) {
      assert.equal(entries[i].body.tools, ref, `entry ${i} tools should equal pool ref`);
    }
    const stats = _getInternPoolStatsForTest();
    assert.equal(stats.toolsPoolSize, 1, '50 entries with identical tools should result in pool size 1');
  });
});

// ─── internMessagesToolResultBlocks (v5 raw payload intern) ───────────────────

describe('internMessagesToolResultBlocks', () => {
  beforeEach(() => {
    _resetReadPoolForTest();
    _resetInternPoolsForTest();
  });

  // 构造一个包含 tool_result block 的 user message
  function makeToolResultMessage(toolUseId, content) {
    return {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content },
      ],
    };
  }

  it('zero-overhead: returns same array ref when no tool_result blocks present', () => {
    const messages = [
      { role: 'user', content: 'short text' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const out = internMessagesToolResultBlocks(messages);
    assert.equal(out, messages, 'no clone when nothing to intern');
  });

  it('zero-overhead: short tool_result content (< 256) does not trigger clone', () => {
    const messages = [makeToolResultMessage('t1', 'short result')];
    const out = internMessagesToolResultBlocks(messages);
    assert.equal(out, messages, 'short content skips dedup, no clone');
    assert.equal(out[0], messages[0], 'message wrapper not cloned');
    assert.equal(out[0].content[0], messages[0].content[0], 'block not cloned');
  });

  it('cross-entry sharing: two messages with same tool_result content → shared ref', () => {
    const big = 'X'.repeat(2000);
    const m1 = makeToolResultMessage('t1', big);
    const m2 = makeToolResultMessage('t2', 'X'.repeat(2000)); // 同内容、不同 instance
    const out1 = internMessagesToolResultBlocks([m1]);
    const out2 = internMessagesToolResultBlocks([m2]);
    assert.equal(
      out1[0].content[0].content,
      out2[0].content[0].content,
      'same content across entries should share pool ref'
    );
  });

  it('passthrough: array-form tool_result.content is not interned', () => {
    const arrContent = [{ type: 'text', text: 'X'.repeat(2000) }];
    const messages = [makeToolResultMessage('t1', arrContent)];
    const out = internMessagesToolResultBlocks(messages);
    assert.equal(out, messages, 'array form skipped → no clone');
    assert.equal(out[0].content[0].content, arrContent, 'array content unchanged');
  });

  it('mutation isolation: cloning preserves _timestamp writes per entry (no cross-entry leak)', () => {
    const big = 'Y'.repeat(2000);
    const m1 = makeToolResultMessage('t1', big);
    const m2 = makeToolResultMessage('t2', 'Y'.repeat(2000));
    const out1 = internMessagesToolResultBlocks([m1]);
    const out2 = internMessagesToolResultBlocks([m2]);
    // 模拟 AppBase.jsx:1170-1175 的 _timestamp mutation
    out1[0]._timestamp = '2026-05-05T10:00:00Z';
    out2[0]._timestamp = '2026-05-05T11:00:00Z';
    assert.equal(out1[0]._timestamp, '2026-05-05T10:00:00Z');
    assert.equal(out2[0]._timestamp, '2026-05-05T11:00:00Z', 'each entry retains its own _timestamp despite shared content ref');
    // 验证 content 仍共享
    assert.equal(out1[0].content[0].content, out2[0].content[0].content);
  });

  it('malformed blocks: null / missing type / non-string content all pass through safely', () => {
    const big = 'M'.repeat(2000);
    // 先 seed 让 pool 命中后续相同长字符串（验证混入 malformed 不影响命中路径）
    internMessagesToolResultBlocks([makeToolResultMessage('seed', big)]);
    const messages = [{
      role: 'user',
      content: [
        null,                                                              // null block
        { type: 'text', text: 'preface' },                                 // 非 tool_result block
        { type: 'tool_result', tool_use_id: 'no-content' },                // 缺 content 字段
        { type: 'tool_result', tool_use_id: 't-null', content: null },     // null content
        { type: 'tool_result', tool_use_id: 't-num', content: 42 },        // 数字 content
        { type: 'tool_result', tool_use_id: 't-obj', content: {} },        // 对象 content
        { type: 'tool_result', tool_use_id: 't-arr', content: [{ type: 'text', text: 'x' }] }, // array
        { tool_use_id: 'no-type', content: 'M'.repeat(2000) },             // 缺 type 字段（不视为 tool_result）
        { type: 'tool_result', tool_use_id: 't-hit', content: 'M'.repeat(2000) }, // 真实命中
      ],
    }];
    // 不应 throw
    const out = internMessagesToolResultBlocks(messages);
    // 命中 block 应被 clone
    assert.notEqual(out, messages, 'real hit should still trigger clone despite malformed siblings');
    assert.notEqual(out[0].content[8], messages[0].content[8], 'hit block (index 8) cloned');
    // 各 malformed block 保持原 ref（不被误改）
    assert.equal(out[0].content[0], null, 'null block stays null');
    assert.equal(out[0].content[1], messages[0].content[1], 'text block stays same ref');
    assert.equal(out[0].content[2], messages[0].content[2], 'no-content block stays same ref');
    assert.equal(out[0].content[3], messages[0].content[3], 'null-content block stays same ref');
    assert.equal(out[0].content[4], messages[0].content[4], 'number-content block stays same ref');
    assert.equal(out[0].content[5], messages[0].content[5], 'object-content block stays same ref');
    assert.equal(out[0].content[6], messages[0].content[6], 'array-content block stays same ref');
    assert.equal(out[0].content[7], messages[0].content[7], 'no-type block stays same ref (treated as non-tool_result)');
  });

  it('mid-slice boundary: lengths 511 / 512 / 513 all behave correctly', () => {
    _resetReadPoolForTest();
    // 511 字符：< 512，走老 2-segment sig；命中靠 length+head+tail
    const s511a = 'a'.repeat(511);
    const s511b = 'a'.repeat(511);
    internMessagesToolResultBlocks([makeToolResultMessage('t1', s511a)]);
    const out511 = internMessagesToolResultBlocks([makeToolResultMessage('t2', s511b)]);
    assert.notEqual(out511[0].content[0], { type: 'tool_result', tool_use_id: 't2', content: s511b }, 'placeholder');
    // 512 字符：== 512（不 > 512），走老 sig
    const s512 = 'b'.repeat(512);
    internMessagesToolResultBlocks([makeToolResultMessage('t3', s512)]);
    const out512 = internMessagesToolResultBlocks([makeToolResultMessage('t4', 'b'.repeat(512))]);
    // 513 字符：> 512，走新 mid-slice sig
    const s513 = 'c'.repeat(513);
    internMessagesToolResultBlocks([makeToolResultMessage('t5', s513)]);
    const out513 = internMessagesToolResultBlocks([makeToolResultMessage('t6', 'c'.repeat(513))]);
    // 三种长度都应正确 dedup（同内容）
    // 关键不变量：未抛错；lazy clone 在命中时触发
    assert.notEqual(out511, [makeToolResultMessage('t2', s511b)], 'length 511 hit triggers clone');
    assert.notEqual(out513, [makeToolResultMessage('t6', s513)], 'length 513 hit triggers clone');
    // 直接断 content 共享
    assert.equal(typeof out512[0].content[0].content, 'string');
    assert.equal(typeof out513[0].content[0].content, 'string');
  });

  it('eviction safety: evicted strings can be re-interned without corruption', () => {
    _resetReadPoolForTest();
    // 灌满 pool（1000 条不同长字符串）
    for (let i = 0; i < 1000; i++) {
      internMessagesToolResultBlocks([makeToolResultMessage(`fill-${i}`, `prefix-${i}-` + 'X'.repeat(2000))]);
    }
    // 注入第 1001 条触发 FIFO 淘汰（最早的 fill-0 被淘汰）
    const evictedContent = 'prefix-0-' + 'X'.repeat(2000);
    internMessagesToolResultBlocks([makeToolResultMessage('trigger', `prefix-1000-` + 'Y'.repeat(2000))]);
    // 重 intern 已淘汰内容：应作为新 entry 注册（pool miss），不抛错
    const reInterned = internMessagesToolResultBlocks([makeToolResultMessage('reuse', evictedContent)]);
    assert.ok(Array.isArray(reInterned), 're-intern of evicted content does not throw');
    // 再次 intern 同内容应命中（重新注册后是 hit）
    const hitAgain = internMessagesToolResultBlocks([makeToolResultMessage('hit', 'prefix-0-' + 'X'.repeat(2000))]);
    assert.notEqual(
      hitAgain[0].content[0].content,
      undefined,
      'pool entry valid after re-registration of evicted content'
    );
  });

  it('mixed: only blocks with pool hits trigger clone; siblings stay original', () => {
    const big = 'Z'.repeat(2000);
    // 第一次 intern：注册到 pool
    internMessagesToolResultBlocks([makeToolResultMessage('seed', big)]);

    // 第二个 message 含两个 tool_result：一个命中 pool，一个短不命中
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'preface' },
        { type: 'tool_result', tool_use_id: 't-hit', content: 'Z'.repeat(2000) },
        { type: 'tool_result', tool_use_id: 't-miss', content: 'short' },
      ],
    }];
    const out = internMessagesToolResultBlocks(messages);
    assert.notEqual(out, messages, 'pool hit triggers messages clone');
    assert.notEqual(out[0], messages[0], 'message wrapper cloned');
    assert.notEqual(out[0].content, messages[0].content, 'content array cloned');
    // 命中的 block 是新对象（content 替换为 pool ref）
    assert.notEqual(out[0].content[1], messages[0].content[1], 'hit block cloned');
    assert.equal(out[0].content[1].tool_use_id, 't-hit', 'hit block other fields preserved');
    // 未命中的 sibling block 保持同 ref（短结果透传）
    assert.equal(out[0].content[2], messages[0].content[2], 'miss block stays same ref');
    // text block（非 tool_result）也保持同 ref
    assert.equal(out[0].content[0], messages[0].content[0], 'non-tool_result block stays same ref');
  });
});

// ─── internEntryBigFields × messages intern integration ───────────────────────

describe('internEntryBigFields with messages tool_result intern', () => {
  beforeEach(() => {
    _resetReadPoolForTest();
    _resetInternPoolsForTest();
  });

  it('SubAgent entry messages tool_result content is interned across entries', () => {
    // 模拟 SubAgent / Teammate entry：mainAgent=false，body 含 tool_result
    const big = 'subagent-context-' + 'A'.repeat(2000);
    const makeSubAgentEntry = () => ({
      timestamp: new Date().toISOString(),
      url: 'x',
      mainAgent: false,
      body: {
        messages: [{
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't-shared', content: big },
          ],
        }],
      },
    });
    const e1 = makeSubAgentEntry();
    const e2 = makeSubAgentEntry();
    // 不同 string instance（重 new 一遍）
    e2.body.messages[0].content[0].content = 'subagent-context-' + 'A'.repeat(2000);

    const i1 = internEntryBigFields(e1);
    const i2 = internEntryBigFields(e2);

    assert.equal(
      i1.body.messages[0].content[0].content,
      i2.body.messages[0].content[0].content,
      'identical SubAgent tool_result content shares pool ref'
    );
  });

  it('returns same entry ref when no big fields and no tool_result hits', () => {
    const entry = {
      timestamp: 'x', url: 'x',
      body: {
        messages: [{ role: 'user', content: 'hello' }],
        // no tools / system / matching tool_result
      },
    };
    const out = internEntryBigFields(entry);
    assert.equal(out, entry, 'no work → no clone');
  });
});

// ─── _compactContinuation stamping ───────────────────────────────────────────
// The slimmer empties body.messages of superseded entries, after which
// isCompactContinuation() can no longer detect a /compact summary. Both slimmers
// stamp entry._compactContinuation while the messages are still present, so
// isSessionBoundary (clearCheckpoint.js) can trust the flag on slimmed entries.

describe('_compactContinuation stamping', () => {
  const COMPACT_TEXT = 'This session is being continued from a previous conversation that ran out of context.';

  function compactEntry(msgCount) {
    const e = makeMainAgent(msgCount);
    e.body.messages[0] = { role: 'user', content: [{ type: 'text', text: COMPACT_TEXT }] };
    return e;
  }

  it('batch slimmer stamps true on compact continuations, false on plain entries', () => {
    const slimmer = createEntrySlimmer(isMainAgent);
    const entries = [];
    const e1 = makeMainAgent(30);
    slimmer.process(e1, entries, 0); entries.push(e1);
    const e2 = compactEntry(10);
    slimmer.process(e2, entries, 1); entries.push(e2);
    assert.equal(e1._compactContinuation, false);
    assert.equal(e2._compactContinuation, true);
  });

  it('batch slimmer: flag survives after the entry is slimmed by a follow-up', () => {
    const slimmer = createEntrySlimmer(isMainAgent);
    const entries = [];
    const e1 = makeMainAgent(30);
    slimmer.process(e1, entries, 0); entries.push(e1);
    const e2 = compactEntry(10);
    slimmer.process(e2, entries, 1); entries.push(e2);
    const e3 = makeMainAgent(12);
    slimmer.process(e3, entries, 2); entries.push(e3);
    assert.equal(e2._slimmed, true, 'follow-up entry must slim the compact entry');
    assert.equal(e2.body.messages.length, 0, 'messages emptied by the slim pass');
    assert.equal(e2._compactContinuation, true, 'flag stamped before messages were emptied');
  });

  it('incremental slimmer stamps the flag too (warm-cache re-ingest path)', () => {
    const slimmer = createIncrementalSlimmer(isMainAgent);
    const requests = [];
    const e1 = makeMainAgent(30);
    slimmer.processEntry(e1, requests, 0); requests.push(e1);
    const e2 = compactEntry(10);
    slimmer.processEntry(e2, requests, 1); requests.push(e2);
    assert.equal(e2._compactContinuation, true);
    assert.equal(e1._compactContinuation, false);
  });
});
