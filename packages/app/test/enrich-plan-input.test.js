/**
 * enrichPlanInput 单元测试
 *
 * 复用 sessionTranscriptReader 的 sandbox（CCV_PROJECTS_DIR），合成 transcript +
 * 合成 entry，验证 enrichEntry / enrichRawIfNeeded / rawHasEmptyExitPlanMode。
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-enrich-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { enrichEntry, enrichRawIfNeeded, rawHasEmptyExitPlanMode } =
  await import('../server/lib/enrich-plan-input.js');
const { clearCache } = await import('../server/lib/session-transcript-reader.js');

function writeTranscript(dir, sid, blocks) {
  const projDir = join(TMP, dir);
  mkdirSync(projDir, { recursive: true });
  const lines = blocks.map(b => JSON.stringify({
    type: 'assistant',
    sessionId: sid,
    message: { role: 'assistant', content: [b] },
  }));
  writeFileSync(join(projDir, `${sid}.jsonl`), lines.join('\n') + '\n');
}

function entryWithExitPlanMode({ sid, tuId, where = 'response', input = {} }) {
  const block = { type: 'tool_use', id: tuId, name: 'ExitPlanMode', input };
  const entry = {
    timestamp: new Date().toISOString(),
    project: 'cc-viewer',
    headers: { 'x-claude-code-session-id': sid },
    body: { messages: [] },
    response: { body: { content: [] } },
  };
  if (where === 'response') entry.response.body.content.push(block);
  else entry.body.messages.push({ role: 'assistant', content: [block] });
  return entry;
}

after(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
});

beforeEach(() => clearCache());

// ============================================================================
describe('rawHasEmptyExitPlanMode', () => {
  it('精确字节序列命中 → true', () => {
    const raw = '{"name":"Read"}{"name":"ExitPlanMode","input":{}}';
    assert.equal(rawHasEmptyExitPlanMode(raw), true);
  });
  it('input 不为空 → false', () => {
    const raw = '{"name":"ExitPlanMode","input":{"plan":"P"}}';
    assert.equal(rawHasEmptyExitPlanMode(raw), false);
  });
  it('非 ExitPlanMode → false', () => {
    assert.equal(rawHasEmptyExitPlanMode('{"name":"Read","input":{}}'), false);
  });
  it('空字符串 / null → false', () => {
    assert.equal(rawHasEmptyExitPlanMode(''), false);
    assert.equal(rawHasEmptyExitPlanMode(null), false);
  });
});

// ============================================================================
describe('enrichEntry', () => {
  it('空 input ExitPlanMode（response.body.content）→ enrich 后 input.plan 非空', () => {
    const sid = 'sid-resp';
    writeTranscript('-resp', sid, [
      { type: 'tool_use', id: 'tu_a', name: 'ExitPlanMode', input: { plan: 'P-content', planFilePath: '/p/a.md' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_a', where: 'response' });
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 1);
    assert.equal(r.missed, 0);
    assert.equal(entry.response.body.content[0].input.plan, 'P-content');
    assert.equal(entry.response.body.content[0].input.planFilePath, '/p/a.md');
  });

  it('空 input ExitPlanMode（body.messages）→ 也补', () => {
    const sid = 'sid-msg';
    writeTranscript('-msg', sid, [
      { type: 'tool_use', id: 'tu_b', name: 'ExitPlanMode', input: { plan: 'P2' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_b', where: 'messages' });
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 1);
    assert.equal(entry.body.messages[0].content[0].input.plan, 'P2');
  });

  it('已有 input.plan → 不动（幂等）', () => {
    const sid = 'sid-idem';
    writeTranscript('-idem', sid, [
      { type: 'tool_use', id: 'tu_c', name: 'ExitPlanMode', input: { plan: 'NEW' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_c', where: 'response', input: { plan: 'OLD' } });
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 0);
    assert.equal(entry.response.body.content[0].input.plan, 'OLD');
  });

  it('非 ExitPlanMode tool_use → 不动', () => {
    const sid = 'sid-other';
    const entry = {
      headers: { 'x-claude-code-session-id': sid },
      body: { messages: [] },
      response: { body: { content: [{ type: 'tool_use', id: 'tu_r', name: 'Read', input: {} }] } },
    };
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 0);
    assert.equal(r.missed, 0);
    assert.deepEqual(entry.response.body.content[0].input, {});
  });

  it('transcript 不存在 → enriched=0, missed=1，原 entry 不变', () => {
    const entry = entryWithExitPlanMode({ sid: 'sid-no-file', tuId: 'tu_x', where: 'response' });
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 0);
    assert.equal(r.missed, 1);
    assert.deepEqual(entry.response.body.content[0].input, {});
  });

  it('entry.headers 缺 sessionId → 早返回 missed=0', () => {
    const entry = {
      body: { messages: [] },
      response: { body: { content: [{ type: 'tool_use', id: 'tu', name: 'ExitPlanMode', input: {} }] } },
    };
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 0);
    assert.equal(r.missed, 0);
    assert.deepEqual(entry.response.body.content[0].input, {});
  });

  it('mainAgent === false（sub-agent entry）→ 早返回不 enrich', () => {
    const sid = 'sid-subagent';
    writeTranscript('-sa', sid, [
      { type: 'tool_use', id: 'tu_sa', name: 'ExitPlanMode', input: { plan: 'MAIN-PLAN' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_sa', where: 'response' });
    entry.mainAgent = false;
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 0);
    assert.equal(r.missed, 0);
    assert.deepEqual(entry.response.body.content[0].input, {});
  });

  it('header 必须小写：Title-Case 不识别（与 WHATWG Headers 规范一致）', () => {
    const sid = 'sid-case';
    writeTranscript('-case', sid, [
      { type: 'tool_use', id: 'tu_d', name: 'ExitPlanMode', input: { plan: 'D' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_d', where: 'response' });
    delete entry.headers['x-claude-code-session-id'];
    entry.headers['X-Claude-Code-Session-Id'] = sid;
    assert.equal(enrichEntry(entry).enriched, 0);
    assert.equal(enrichEntry(entry).missed, 0);
  });

  it('response.body 为空 / 为 undefined → 不抛', () => {
    const entry = { headers: { 'x-claude-code-session-id': 'sid-empty' }, body: { messages: [] }, response: {} };
    assert.doesNotThrow(() => enrichEntry(entry));
    const entry2 = { headers: { 'x-claude-code-session-id': 'sid-empty' }, body: {} };
    assert.doesNotThrow(() => enrichEntry(entry2));
  });

  it('一条 entry 多个 ExitPlanMode（response + messages）一起补', () => {
    const sid = 'sid-multi';
    writeTranscript('-multi', sid, [
      { type: 'tool_use', id: 'tu_x', name: 'ExitPlanMode', input: { plan: 'X' } },
      { type: 'tool_use', id: 'tu_y', name: 'ExitPlanMode', input: { plan: 'Y', planFilePath: '/y.md' } },
    ]);
    const entry = {
      headers: { 'x-claude-code-session-id': sid },
      body: { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'ExitPlanMode', input: {} }] }] },
      response: { body: { content: [{ type: 'tool_use', id: 'tu_y', name: 'ExitPlanMode', input: {} }] } },
    };
    const r = enrichEntry(entry);
    assert.equal(r.enriched, 2);
    assert.equal(entry.body.messages[0].content[0].input.plan, 'X');
    assert.equal(entry.response.body.content[0].input.plan, 'Y');
  });
});

// ============================================================================
describe('enrichRawIfNeeded', () => {
  it('raw 不含 ExitPlanMode 空 input → 原样返回（pointer 相等）', () => {
    const raw = '{"name":"Read","input":{}}';
    assert.equal(enrichRawIfNeeded(raw), raw);
  });

  it('raw 含但解析失败 → 原样返回', () => {
    const raw = 'not-json{"name":"ExitPlanMode","input":{}}';
    assert.equal(enrichRawIfNeeded(raw), raw);
  });

  it('raw 含且补全成功 → 返回新 JSON 字符串', () => {
    const sid = 'sid-raw';
    writeTranscript('-raw', sid, [
      { type: 'tool_use', id: 'tu_raw', name: 'ExitPlanMode', input: { plan: 'RAW-OK', planFilePath: '/r.md' } },
    ]);
    const entry = entryWithExitPlanMode({ sid, tuId: 'tu_raw', where: 'response' });
    const raw = JSON.stringify(entry);
    const out = enrichRawIfNeeded(raw);
    assert.notEqual(out, raw);
    const parsed = JSON.parse(out);
    assert.equal(parsed.response.body.content[0].input.plan, 'RAW-OK');
  });

  it('raw 含但 transcript 缺失 → 原样返回（不浪费 stringify）', () => {
    const entry = entryWithExitPlanMode({ sid: 'sid-noraw', tuId: 'tu', where: 'response' });
    const raw = JSON.stringify(entry);
    assert.equal(enrichRawIfNeeded(raw), raw);
  });
});

// ============================================================================
// 集成：模拟真实 cc-viewer*.jsonl 条目形态走完整 enrichRawIfNeeded 链路
// 验证 server.js 三个端点 + log-watcher.js 的 wire-in 拿到的就是 enriched 版本
describe('集成：真实形态条目', () => {
  it('CC 2.x 真实形态 raw 字符串走 enrichRawIfNeeded 后 input.plan 被回填', () => {
    const sid = 'sid-realistic';
    writeTranscript('-realistic', sid, [
      { type: 'tool_use', id: 'toolu_01ABC', name: 'ExitPlanMode', input: {
        plan: '# 我的计划\n\n1. 第一步\n2. 第二步',
        planFilePath: '/Users/x/.claude/plans/groovy-coalescing-patterson.md',
      } },
    ]);
    // 模拟 cc-viewer 拦截器写入的真实形态：headers 全小写、body.messages 含
    // 历史轮 ExitPlanMode（empty input）、response.body.content 也含
    const entry = {
      timestamp: '2026-05-04T09:05:23.039Z',
      project: 'cc-viewer',
      url: 'https://api.anthropic.com/v1/messages?beta=true',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'claude-cli/2.1.126 (external, cli)',
        'x-claude-code-session-id': sid,
      },
      body: {
        model: 'claude-opus-4-7',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          { role: 'assistant', content: [
            { type: 'tool_use', id: 'toolu_prev', name: 'Read', input: { file_path: '/x' } },
            { type: 'tool_use', id: 'toolu_01ABC', name: 'ExitPlanMode', input: {} },
          ] },
        ],
      },
      response: {
        status: 200,
        body: {
          model: 'claude-opus-4-7',
          content: [{ type: 'tool_use', id: 'toolu_01ABC', name: 'ExitPlanMode', input: {} }],
        },
      },
      isStream: true,
      mainAgent: true,
      _deltaFormat: 1,
    };
    const raw = JSON.stringify(entry);
    // 预过滤匹配（精确 byte sequence）
    assert.equal(rawHasEmptyExitPlanMode(raw), true);
    const out = enrichRawIfNeeded(raw);
    assert.notEqual(out, raw);
    const parsed = JSON.parse(out);
    // response 当前轮被补
    assert.equal(parsed.response.body.content[0].input.plan, '# 我的计划\n\n1. 第一步\n2. 第二步');
    assert.equal(parsed.response.body.content[0].input.planFilePath, '/Users/x/.claude/plans/groovy-coalescing-patterson.md');
    // body.messages 历史轮也被补
    const histBlk = parsed.body.messages[1].content[1];
    assert.equal(histBlk.input.plan, '# 我的计划\n\n1. 第一步\n2. 第二步');
  });

  it('log-watcher 路径：parsed entry 共享引用 mutation 对后续 entry 自动跳过', async () => {
    // 模拟 delta-reconstructor 把同一 tool_use block 在两个连续 entry 间共享
    const sid = 'sid-share';
    writeTranscript('-share', sid, [
      { type: 'tool_use', id: 'tu_share', name: 'ExitPlanMode', input: { plan: 'SHARED' } },
    ]);
    const sharedBlock = { type: 'tool_use', id: 'tu_share', name: 'ExitPlanMode', input: {} };
    const entry1 = {
      headers: { 'x-claude-code-session-id': sid },
      body: { messages: [{ role: 'assistant', content: [sharedBlock] }] },
      response: { body: { content: [] } },
    };
    const entry2 = {
      headers: { 'x-claude-code-session-id': sid },
      body: { messages: [{ role: 'assistant', content: [sharedBlock] }] }, // 同一引用
      response: { body: { content: [] } },
    };
    const r1 = enrichEntry(entry1);
    assert.equal(r1.enriched, 1);
    assert.equal(sharedBlock.input.plan, 'SHARED');
    // 第二条已经看到 shared block 不空 input → enriched=0（in-place mutation 是
    // 故意的，避免重复查盘；详见 enrichEntry JSDoc）
    const r2 = enrichEntry(entry2);
    assert.equal(r2.enriched, 0);
    assert.equal(r2.missed, 0);
  });
});
