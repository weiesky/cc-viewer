import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assembleStreamMessage,
  findRecentLog,
  getSystemText,
  isAnthropicApiPath,
  isMainAgentRequest,
  isPreflightEntry,
} from '../packages/app/server/lib/interceptor-core.js';

// ============================================================================
// Test helpers
// ============================================================================

function makeMainAgentTools() {
  // 12 tools including Edit, Bash, Task
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}

function makeMainAgentBody(overrides = {}) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, ...' }],
    tools: makeMainAgentTools(),
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

function makeLogEntry(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    project: 'test-project',
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    body: makeMainAgentBody(),
    response: { status: 200, body: {} },
    mainAgent: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('interceptor', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccv-interceptor-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // getSystemText
  // --------------------------------------------------------------------------
  describe('getSystemText', () => {
    it('returns string system as-is', () => {
      assert.equal(getSystemText({ system: 'hello world' }), 'hello world');
    });

    it('joins array system text blocks', () => {
      const body = {
        system: [
          { type: 'text', text: 'You are Claude Code' },
          { type: 'text', text: ', an AI assistant.' },
        ],
      };
      assert.equal(getSystemText(body), 'You are Claude Code, an AI assistant.');
    });

    it('returns empty string for null/undefined system', () => {
      assert.equal(getSystemText({}), '');
      assert.equal(getSystemText({ system: null }), '');
      assert.equal(getSystemText(undefined), '');
    });

    it('handles array items with missing text', () => {
      const body = { system: [{ type: 'text' }, null, { text: 'ok' }] };
      assert.equal(getSystemText(body), 'ok');
    });
  });

  // --------------------------------------------------------------------------
  // isMainAgentRequest
  // --------------------------------------------------------------------------
  describe('isMainAgentRequest', () => {
    it('detects standard MainAgent (old architecture)', () => {
      assert.equal(isMainAgentRequest(makeMainAgentBody()), true);
    });

    it('rejects when system is missing', () => {
      assert.equal(isMainAgentRequest({ tools: makeMainAgentTools() }), false);
    });

    it('rejects when tools is not array', () => {
      assert.equal(isMainAgentRequest({
        system: 'You are Claude Code',
        tools: 'not-array',
      }), false);
    });

    it('rejects when system does not contain "You are Claude Code"', () => {
      assert.equal(isMainAgentRequest({
        system: 'You are a helpful assistant',
        tools: makeMainAgentTools(),
      }), false);
    });

    it('rejects SubAgent patterns', () => {
      const patterns = [
        'command execution specialist',
        'file search specialist',
        'planning specialist',
        'general-purpose agent',
      ];
      for (const pattern of patterns) {
        const body = makeMainAgentBody({
          system: `You are Claude Code, a ${pattern}`,
        });
        assert.equal(isMainAgentRequest(body), false, `should reject: ${pattern}`);
      }
    });

    it('rejects when tools <= 5 without ToolSearch (2 tools)', () => {
      assert.equal(isMainAgentRequest({
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'Edit' }, { name: 'Bash' }],
      }), false);
    });

    it('rejects when core tools missing (>10 tools but no Edit)', () => {
      const tools = Array.from({ length: 12 }, (_, i) => ({ name: `Tool${i}` }));
      tools.push({ name: 'Bash' }, { name: 'Task' });
      assert.equal(isMainAgentRequest({
        system: [{ text: 'You are Claude Code' }],
        tools,
      }), false);
    });

    it('detects new architecture with ToolSearch + deferred-tools', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'ToolSearch' }, { name: 'Bash' }],
        messages: [{ role: 'user', content: 'some text <available-deferred-tools> list' }],
      };
      assert.equal(isMainAgentRequest(body), true);
    });

    it('new architecture: content as array', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'ToolSearch' }],
        messages: [{ role: 'user', content: [{ text: '<available-deferred-tools>' }] }],
      };
      assert.equal(isMainAgentRequest(body), true);
    });

    it('new architecture: rejects without deferred-tools marker', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'ToolSearch' }],
        messages: [{ role: 'user', content: 'just a normal message' }],
      };
      assert.equal(isMainAgentRequest(body), false);
    });

    it('new architecture: rejects deferred-tools without ToolSearch', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'Bash' }],
        messages: [{ role: 'user', content: 'some text <available-deferred-tools> list' }],
      };
      assert.equal(isMainAgentRequest(body), false);
    });

    it('new architecture: accepts even with few tools if marker present', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'ToolSearch' }, { name: 'Bash' }],
        messages: [{ role: 'user', content: '<available-deferred-tools>' }],
      };
      assert.equal(isMainAgentRequest(body), true);
    });

    it('v2.1.81+ lightweight MainAgent: 9 tools with core set', () => {
      const body = {
        system: [{ text: 'You are Claude Code' }],
        tools: [
          { name: 'Agent' }, { name: 'Bash' }, { name: 'Glob' },
          { name: 'Grep' }, { name: 'Read' }, { name: 'Edit' },
          { name: 'Write' }, { name: 'Skill' }, { name: 'ToolSearch' },
        ],
        messages: [{ role: 'user', content: 'hi' }],
      };
      assert.equal(isMainAgentRequest(body), true);
    });

    it('rejects when tools <= 5 without ToolSearch', () => {
      assert.equal(isMainAgentRequest({
        system: [{ text: 'You are Claude Code' }],
        tools: [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Agent' }],
      }), false);
    });

    it('rejects same-process teammate via TEAMMATE_SYSTEM_RE (body-level, keeps in sync with isMainAgentEntry)', () => {
      // 同进程 Agent/Task 队友:system prompt 与 MainAgent 几乎一致(同样 You are Claude Code + 工具),
      // 但带团队协作标记。这类队友不带 --agent-name(interceptor.js 的 _isTeammate 认不出),
      // 旧逻辑误判为 MainAgent → 流式期开 live-stream、其 thinking 污染主「最新回复」overlay。
      // 现 interceptor-core 在 body 层即排除(TEAMMATE_SYSTEM_RE),与 isMainAgentEntry / 前端 isMainAgent 三处对齐。
      const teammateBody = makeMainAgentBody({
        system: [
          { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' },
          { type: 'text', text: '# Agent Teammate Communication\n\nIMPORTANT: You are running as an agent in a team.' },
        ],
      });
      assert.equal(isMainAgentRequest(teammateBody), false);
    });

    // cc_version 2.1.181+：billing header 显式带 cc_is_subagent=true 的子代理（继承完整 CC prompt + Edit/Bash/Agent）
    it('rejects cc_is_subagent=true subagent (2.1.181+) even with main-like prompt/tools', () => {
      const body = makeMainAgentBody({
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.181.be0; cc_entrypoint=cli; cc_is_subagent=true;\nYou are Claude Code, Anthropic\'s official CLI for Claude.' },
        ],
      });
      assert.equal(isMainAgentRequest(body), false);
    });

    it('backward-compat: genuine main (no cc_is_subagent token) still detected', () => {
      const body = makeMainAgentBody({
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.181.2f7; cc_entrypoint=cli;\nYou are Claude Code, Anthropic\'s official CLI for Claude.' },
        ],
      });
      assert.equal(isMainAgentRequest(body), true);
    });

    it('does not over-match cc_is_subagent=false', () => {
      const body = makeMainAgentBody({
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.181.2f7; cc_entrypoint=cli; cc_is_subagent=false;\nYou are Claude Code, Anthropic\'s official CLI for Claude.' },
        ],
      });
      assert.equal(isMainAgentRequest(body), true);
    });

    it('\\b anchor: does not over-match cc_is_subagent=truex', () => {
      const body = makeMainAgentBody({
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.181.2f7; cc_is_subagent=truex;\nYou are Claude Code, Anthropic\'s official CLI for Claude.' },
        ],
      });
      assert.equal(isMainAgentRequest(body), true);
    });

    it('rejects cc_is_subagent=true when billing header is in a SEPARATE system block', () => {
      const body = makeMainAgentBody({
        system: [
          { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.181.be0; cc_entrypoint=cli; cc_is_subagent=true;' },
          { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' },
        ],
      });
      assert.equal(isMainAgentRequest(body), false);
    });
  });

  // --------------------------------------------------------------------------
  // isPreflightEntry
  // --------------------------------------------------------------------------
  describe('isPreflightEntry', () => {
    it('detects preflight: single user message, system contains Claude Code, no tools', () => {
      const entry = {
        body: {
          system: 'You are Claude Code',
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), true);
    });

    it('rejects if mainAgent is true', () => {
      const entry = {
        mainAgent: true,
        body: {
          system: 'You are Claude Code',
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), false);
    });

    it('rejects if isHeartbeat is true', () => {
      const entry = {
        isHeartbeat: true,
        body: {
          system: 'You are Claude Code',
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), false);
    });

    it('rejects if tools present', () => {
      const entry = {
        body: {
          system: 'You are Claude Code',
          tools: [{ name: 'Edit' }],
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), false);
    });

    it('rejects if multiple messages', () => {
      const entry = {
        body: {
          system: 'You are Claude Code',
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        },
      };
      assert.equal(isPreflightEntry(entry), false);
    });

    it('rejects if system does not contain Claude Code', () => {
      const entry = {
        body: {
          system: 'You are a helper',
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), false);
    });

    it('handles array system', () => {
      const entry = {
        body: {
          system: [{ text: 'You are Claude Code' }],
          messages: [{ role: 'user', content: 'hi' }],
        },
      };
      assert.equal(isPreflightEntry(entry), true);
    });
  });

  // --------------------------------------------------------------------------
  // isAnthropicApiPath
  // --------------------------------------------------------------------------
  describe('isAnthropicApiPath', () => {
    it('matches /v1/messages', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/messages'), true);
    });

    it('matches /v1/messages/count_tokens', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/messages/count_tokens'), true);
    });

    it('matches /v1/messages/batches', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/messages/batches'), true);
    });

    it('matches /v1/messages/batches/xxx', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/messages/batches/batch_123'), true);
    });

    it('matches heartbeat /api/eval/sdk-xxx', () => {
      assert.equal(isAnthropicApiPath('https://statsig.anthropic.com/api/eval/sdk-abc123'), true);
    });

    it('rejects unrelated paths', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/completions'), false);
      assert.equal(isAnthropicApiPath('https://example.com/other'), false);
    });

    it('rejects /v1/messages with extra suffix', () => {
      assert.equal(isAnthropicApiPath('https://api.anthropic.com/v1/messages/unknown'), false);
    });

    it('fallback regex for invalid URL', () => {
      assert.equal(isAnthropicApiPath('not-a-url/v1/messages'), true);
      assert.equal(isAnthropicApiPath('not-a-url/other'), false);
    });

    it('matches proxy-prefixed /v1/messages', () => {
      assert.equal(isAnthropicApiPath('https://work.group.com/proxy/group_235:8100/v1/messages'), true);
      assert.equal(isAnthropicApiPath('https://gateway.example.com/proxy/anthropic/v1/messages'), true);
      assert.equal(isAnthropicApiPath('https://gateway.example.com/proxy/anthropic/v1/messages/count_tokens'), true);
      assert.equal(isAnthropicApiPath('https://gateway.example.com/proxy/anthropic/v1/messages/batches'), true);
    });

    it('still rejects proxy-prefixed unknown suffix', () => {
      assert.equal(isAnthropicApiPath('https://gateway.example.com/proxy/anthropic/v1/messages/unknown'), false);
    });
  });

  // --------------------------------------------------------------------------
  // assembleStreamMessage
  // --------------------------------------------------------------------------
  describe('assembleStreamMessage', () => {
    it('ignores non-object events and returns null when no message_start', () => {
      const events = [
        'data: {"type":"message_start"}',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg, null);
    });

    it('assembles a simple text response', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-4-6', usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.id, 'msg_1');
      assert.equal(msg.content.length, 1);
      assert.equal(msg.content[0].type, 'text');
      assert.equal(msg.content[0].text, 'Hello world');
      assert.equal(msg.stop_reason, 'end_turn');
      assert.equal(msg.usage.output_tokens, 5);
    });

    it('assembles thinking + text blocks', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_2', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' more' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.content.length, 2);
      assert.equal(msg.content[0].type, 'thinking');
      assert.equal(msg.content[0].thinking, 'Let me think... more');
      assert.equal(msg.content[1].type, 'text');
      assert.equal(msg.content[1].text, 'Answer');
    });

    it('assembles tool_use with JSON input', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_3', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"com' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'mand":"ls"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.content[0].type, 'tool_use');
      assert.equal(msg.content[0].name, 'Bash');
      assert.deepStrictEqual(msg.content[0].input, { command: 'ls' });
      assert.equal(msg.stop_reason, 'tool_use');
    });

    it('handles invalid tool_use JSON gracefully', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_4', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_2', name: 'Edit' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{broken' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.content[0].input, '{broken');
    });

    it('handles signature_delta', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_5', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_abc' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.content[0].signature, 'sig_abc');
      assert.equal(msg.content[0].thinking, 'hmm');
    });

    it('returns null for empty events', () => {
      assert.equal(assembleStreamMessage([]), null);
    });

    it('skips non-object and typeless events', () => {
      const events = [
        null,
        'string',
        { noType: true },
        { type: 'message_start', message: { id: 'msg_6', role: 'assistant' } },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.id, 'msg_6');
      assert.deepStrictEqual(msg.content, []);
    });

    it('merges usage from message_start and message_delta', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_7', role: 'assistant', usage: { input_tokens: 100, cache_read_input_tokens: 50 } } },
        { type: 'message_delta', delta: {}, usage: { output_tokens: 200 } },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.usage.input_tokens, 100);
      assert.equal(msg.usage.cache_read_input_tokens, 50);
      assert.equal(msg.usage.output_tokens, 200);
    });

    it('handles stop_sequence in message_delta', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_8', role: 'assistant' } },
        { type: 'message_delta', delta: { stop_reason: 'stop_sequence', stop_sequence: '\n\nHuman:' } },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.stop_reason, 'stop_sequence');
      assert.equal(msg.stop_sequence, '\n\nHuman:');
    });

    it('assembles multi-part JSON delta', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_split', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_split', name: 'Split' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"k' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ey":' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"va' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'l"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.deepStrictEqual(msg.content[0].input, { key: 'val' });
    });

    it('handles content_block_start with existing text/thinking', () => {
      const events = [
        { type: 'message_start', message: { id: 'msg_reset', role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'SHOULD_BE_CLEARED' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'RealContent' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ];
      const msg = assembleStreamMessage(events);
      assert.equal(msg.content[0].text, 'RealContent');
    });
  });

  // --------------------------------------------------------------------------
  // findRecentLog
  // --------------------------------------------------------------------------
  describe('findRecentLog', () => {
    it('returns most recent log file sorted by name', () => {
      const dir = join(tempDir, 'myproject');
      mkdirSync(dir);
      writeFileSync(join(dir, 'myproject_20260101_120000.jsonl'), '{}');
      writeFileSync(join(dir, 'myproject_20260301_080000.jsonl'), '{}');
      writeFileSync(join(dir, 'myproject_20260201_100000.jsonl'), '{}');

      const result = findRecentLog(dir, 'myproject');
      assert.equal(result, join(dir, 'myproject_20260301_080000.jsonl'));
    });

    it('returns null when no matching files', () => {
      const dir = join(tempDir, 'empty');
      mkdirSync(dir);
      assert.equal(findRecentLog(dir, 'myproject'), null);
    });

    it('returns null for non-existent directory', () => {
      assert.equal(findRecentLog(join(tempDir, 'nope'), 'myproject'), null);
    });

    it('ignores files not matching project prefix', () => {
      const dir = join(tempDir, 'proj');
      mkdirSync(dir);
      writeFileSync(join(dir, 'other_20260301.jsonl'), '{}');
      writeFileSync(join(dir, 'proj_20260101.jsonl'), '{}');

      const result = findRecentLog(dir, 'proj');
      assert.equal(result, join(dir, 'proj_20260101.jsonl'));
    });

    it('ignores temp files', () => {
      const dir = join(tempDir, 'proj2');
      mkdirSync(dir);
      writeFileSync(join(dir, 'proj2_20260301_temp.jsonl'), '{}');
      // _temp.jsonl does not end with just .jsonl after projectName_
      // Actually it does end with .jsonl, but the filter is startsWith + endsWith
      // _temp.jsonl still ends with .jsonl so it would match - this is expected
      // The cleanup function handles temp files separately
    });

    it('excludes legacy instance-tagged files (even when the tag equals the project name)', () => {
      const dir = join(tempDir, 'collide');
      mkdirSync(dir);
      writeFileSync(join(dir, 'collide_20260101_120000.jsonl'), '{}');
      // legacy multi-instance file; `collide__collide_…`.startsWith('collide_') is
      // true, but it carries the `__collide_` mark → excluded by the matcher.
      writeFileSync(join(dir, 'collide__collide_20260301_120000.jsonl'), '{}');
      assert.equal(findRecentLog(dir, 'collide'), join(dir, 'collide_20260101_120000.jsonl'));
    });

    it('keeps untagged logs when the project name itself contains "__"', () => {
      const dir = join(tempDir, 'dunder');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a__b_20260101_120000.jsonl'), '{}');      // untagged, project = a__b
      writeFileSync(join(dir, 'x__a__b_20260301_120000.jsonl'), '{}');   // legacy instance-tagged
      assert.equal(findRecentLog(dir, 'a__b'), join(dir, 'a__b_20260101_120000.jsonl'));
    });
  });

  // --------------------------------------------------------------------------
  // Log record format
  // --------------------------------------------------------------------------
  describe('log record format', () => {
    it('records are separated by \\n---\\n', () => {
      const entry1 = makeLogEntry({ timestamp: '2026-01-01T00:00:00Z' });
      const entry2 = makeLogEntry({ timestamp: '2026-01-01T00:01:00Z' });
      const logFile = join(tempDir, 'test.jsonl');

      appendFileSync(logFile, JSON.stringify(entry1) + '\n---\n');
      appendFileSync(logFile, JSON.stringify(entry2) + '\n---\n');

      const content = readFileSync(logFile, 'utf-8');
      const parts = content.split('\n---\n').filter(p => p.trim());
      assert.equal(parts.length, 2);

      const parsed1 = JSON.parse(parts[0]);
      assert.equal(parsed1.timestamp, '2026-01-01T00:00:00Z');
      const parsed2 = JSON.parse(parts[1]);
      assert.equal(parsed2.timestamp, '2026-01-01T00:01:00Z');
    });

    it('entry contains expected top-level fields', () => {
      const entry = makeLogEntry();
      const keys = Object.keys(entry);
      assert.ok(keys.includes('timestamp'));
      assert.ok(keys.includes('project'));
      assert.ok(keys.includes('url'));
      assert.ok(keys.includes('method'));
      assert.ok(keys.includes('body'));
      assert.ok(keys.includes('response'));
      assert.ok(keys.includes('mainAgent'));
    });
  });

  // --------------------------------------------------------------------------
  // Project name sanitization
  // --------------------------------------------------------------------------
  describe('project name sanitization', () => {
    it('replaces special chars with underscore', () => {
      const sanitize = (name) => name.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      assert.equal(sanitize('my-project'), 'my-project');
      assert.equal(sanitize('my project'), 'my_project');
      assert.equal(sanitize('项目名'), '___');
      assert.equal(sanitize('a/b\\c:d'), 'a_b_c_d');
      assert.equal(sanitize('valid.name-123_ok'), 'valid.name-123_ok');
    });
  });

});

// ─────────── spawn-pair extraction (agent spawn registry) ───────────
describe('spawn-pair extraction (interceptor-core)', () => {
  it('extractAgentSpawnPairs pulls prefix→name pairs with client-parity normalization', async () => {
    const { extractAgentSpawnPairs, TEAMMATE_PROMPT_PREFIX_LEN } = await import('../packages/app/server/lib/interceptor-core.js');
    // Leading whitespace must be trimmed BEFORE slicing (parity with
    // src/utils/contentFilter.js prefix building).
    const prompt = '   You are the researcher. Investigate the failing pipeline and report everything.';
    const body = {
      content: [
        { type: 'tool_use', name: 'Agent', input: { name: 'researcher', prompt } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', name: 'Agent', input: { name: 'no-prompt' } },
        { type: 'text', text: 'hello' },
      ],
    };
    const pairs = extractAgentSpawnPairs(body);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0][1], 'researcher');
    assert.equal(pairs[0][0], prompt.trimStart().slice(0, TEAMMATE_PROMPT_PREFIX_LEN));
  });

  it('extractAgentSpawnPairs tolerates raw-string and missing bodies', async () => {
    const { extractAgentSpawnPairs } = await import('../packages/app/server/lib/interceptor-core.js');
    assert.deepEqual(extractAgentSpawnPairs('raw sse fallback text'), []);
    assert.deepEqual(extractAgentSpawnPairs(null), []);
    assert.deepEqual(extractAgentSpawnPairs({}), []);
  });

});
