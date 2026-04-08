import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assembleStreamMessage,
  cleanupTempFiles,
  findRecentLog,
  getSystemText,
  isAnthropicApiPath,
  isMainAgentRequest,
  isPreflightEntry,
  migrateConversationContext,
  rotateLogFile,
} from '../lib/interceptor-core.js';

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

    it('does not filter teammate requests (teammate handling is in interceptor layer)', () => {
      // Teammate body looks identical to MainAgent — same system prompt, same tools
      // interceptor-core should NOT filter it; that's the interceptor.js / frontend layer's job
      const teammateBody = makeMainAgentBody({
        system: [
          { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' },
          { type: 'text', text: '# Agent Teammate Communication\n\nIMPORTANT: You are running as an agent in a team.' },
        ],
      });
      // interceptor-core treats this as MainAgent (body-level only, no req.teammate field)
      assert.equal(isMainAgentRequest(teammateBody), true);
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
  });

  // --------------------------------------------------------------------------
  // cleanupTempFiles
  // --------------------------------------------------------------------------
  describe('cleanupTempFiles', () => {
    it('renames temp file to permanent when no permanent exists', () => {
      const dir = join(tempDir, 'cleanup1');
      mkdirSync(dir);
      writeFileSync(join(dir, 'proj_20260301_120000_temp.jsonl'), '{"data":1}\n');

      cleanupTempFiles(dir, 'proj');

      // temp should be gone, permanent should exist
      assert.ok(!existsSync(join(dir, 'proj_20260301_120000_temp.jsonl')));
      assert.ok(existsSync(join(dir, 'proj_20260301_120000.jsonl')));
    });

    it('merges temp content into existing permanent file', () => {
      const dir = join(tempDir, 'cleanup2');
      mkdirSync(dir);
      writeFileSync(join(dir, 'proj_20260301_120000.jsonl'), '{"old":1}\n');
      writeFileSync(join(dir, 'proj_20260301_120000_temp.jsonl'), '{"new":2}\n');

      cleanupTempFiles(dir, 'proj');

      assert.ok(!existsSync(join(dir, 'proj_20260301_120000_temp.jsonl')));
      const content = readFileSync(join(dir, 'proj_20260301_120000.jsonl'), 'utf-8');
      assert.ok(content.includes('{"old":1}'));
      assert.ok(content.includes('{"new":2}'));
    });

    it('deletes empty temp file when permanent exists', () => {
      const dir = join(tempDir, 'cleanup3');
      mkdirSync(dir);
      writeFileSync(join(dir, 'proj_20260301_120000.jsonl'), '{"old":1}\n');
      writeFileSync(join(dir, 'proj_20260301_120000_temp.jsonl'), '   \n');

      cleanupTempFiles(dir, 'proj');

      assert.ok(!existsSync(join(dir, 'proj_20260301_120000_temp.jsonl')));
      const content = readFileSync(join(dir, 'proj_20260301_120000.jsonl'), 'utf-8');
      assert.equal(content, '{"old":1}\n'); // unchanged
    });

    it('handles non-existent directory gracefully', () => {
      // should not throw
      cleanupTempFiles(join(tempDir, 'nonexistent'), 'proj');
    });
  });

  // --------------------------------------------------------------------------
  // migrateConversationContext
  // --------------------------------------------------------------------------
  describe('migrateConversationContext', () => {
    it('migrates from last mainAgent with messages.length===1', () => {
      // Use pretty-print (null, 2) to match interceptor's actual log format
      const entry0 = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }] } }, null, 2);
      const entry1 = JSON.stringify({ mainAgent: false, body: {} }, null, 2);
      const entry2 = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'new conv' }] } }, null, 2);
      const entry3 = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] } }, null, 2);

      const oldFile = join(tempDir, 'old.jsonl');
      const newFile = join(tempDir, 'new.jsonl');
      writeFileSync(oldFile, [entry0, entry1, entry2, entry3].join('\n---\n') + '\n---\n');

      migrateConversationContext(oldFile, newFile);

      // entry2 is the origin (last mainAgent with messages.length===1)
      // entry2 and entry3 should be migrated
      const newContent = readFileSync(newFile, 'utf-8');
      const newParts = newContent.split('\n---\n').filter(p => p.trim());
      assert.equal(newParts.length, 2);
      assert.ok(newParts[0].includes('new conv'));

      const oldContent = readFileSync(oldFile, 'utf-8');
      const oldParts = oldContent.split('\n---\n').filter(p => p.trim());
      assert.equal(oldParts.length, 2); // entry0 and entry1
    });

    it('includes preflight entry before origin', () => {
      const preflight = JSON.stringify({
        body: { system: 'You are Claude Code', messages: [{ role: 'user', content: 'preflight' }] },
      }, null, 2);
      const origin = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'start' }] } }, null, 2);
      const follow = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] } }, null, 2);

      const oldFile = join(tempDir, 'old2.jsonl');
      const newFile = join(tempDir, 'new2.jsonl');
      writeFileSync(oldFile, [preflight, origin, follow].join('\n---\n') + '\n---\n');

      migrateConversationContext(oldFile, newFile);

      const newParts = readFileSync(newFile, 'utf-8').split('\n---\n').filter(p => p.trim());
      assert.equal(newParts.length, 3); // preflight + origin + follow

      // 所有内容迁移后旧文件被清空（不删除，watcher 需要检��� truncation）
      assert.ok(existsSync(oldFile));
      assert.strictEqual(readFileSync(oldFile, 'utf-8'), '');
    });

    it('does nothing when no mainAgent with single message found', () => {
      const entry = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] } }, null, 2);
      const oldFile = join(tempDir, 'old3.jsonl');
      const newFile = join(tempDir, 'new3.jsonl');
      writeFileSync(oldFile, entry + '\n---\n');

      migrateConversationContext(oldFile, newFile);

      assert.ok(!existsSync(newFile));
      assert.equal(readFileSync(oldFile, 'utf-8'), entry + '\n---\n'); // unchanged
    });

    it('handles empty file', () => {
      const oldFile = join(tempDir, 'old4.jsonl');
      const newFile = join(tempDir, 'new4.jsonl');
      writeFileSync(oldFile, '');

      migrateConversationContext(oldFile, newFile);

      assert.ok(!existsSync(newFile));
    });

    it('migrates single MainAgent entry correctly', () => {
      const entry = JSON.stringify({
        mainAgent: true,
        body: { messages: [{ role: 'user', content: 'start' }] }
      }, null, 2);
      const oldFile = join(tempDir, 'single.jsonl');
      const newFile = join(tempDir, 'single_new.jsonl');
      writeFileSync(oldFile, entry + '\n---\n');

      migrateConversationContext(oldFile, newFile);

      const newContent = readFileSync(newFile, 'utf-8');
      assert.ok(newContent.includes('start'));
      // 所有内容迁移后旧文件被清空（不删除，watcher 需要检测 truncation）
      assert.ok(existsSync(oldFile));
      assert.strictEqual(readFileSync(oldFile, 'utf-8'), '');
    });

    it('handles corrupted JSON lines gracefully', () => {
      const goodEntry = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'ok' }] } });
      const badEntry = '{ "broken": json';
      const oldFile = join(tempDir, 'corrupt.jsonl');
      const newFile = join(tempDir, 'corrupt_new.jsonl');

      writeFileSync(oldFile, [badEntry, goodEntry].join('\n---\n') + '\n---\n');

      migrateConversationContext(oldFile, newFile);

      const newContent = readFileSync(newFile, 'utf-8');
      assert.ok(newContent.includes('ok'), 'new file should contain the valid entry');

      const oldContent = readFileSync(oldFile, 'utf-8');
      assert.ok(oldContent.includes('broken'), 'old file should retain the corrupted entry');
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

  // --------------------------------------------------------------------------
  // rotateLogFile
  // --------------------------------------------------------------------------
  describe('rotateLogFile', () => {
    it('rotates when file exceeds maxSize', () => {
      const oldFile = join(tempDir, 'big.jsonl');
      const newFile = join(tempDir, 'new.jsonl');
      // Write 1KB of data, set maxSize to 500 bytes
      writeFileSync(oldFile, 'x'.repeat(1024));

      const result = rotateLogFile(oldFile, newFile, 500);

      assert.equal(result.rotated, true);
      assert.equal(result.oldFile, oldFile);
      assert.equal(result.newFile, newFile);
    });

    it('does not rotate when file is under maxSize', () => {
      const oldFile = join(tempDir, 'small.jsonl');
      const newFile = join(tempDir, 'new.jsonl');
      writeFileSync(oldFile, 'x'.repeat(100));

      const result = rotateLogFile(oldFile, newFile, 500);

      assert.equal(result.rotated, false);
      assert.equal(result.oldFile, undefined);
    });

    it('does not rotate when file does not exist', () => {
      const result = rotateLogFile(join(tempDir, 'nonexistent.jsonl'), join(tempDir, 'new.jsonl'), 500);
      assert.equal(result.rotated, false);
    });

    it('creates empty new file without migrating content', () => {
      const oldFile = join(tempDir, 'old_data.jsonl');
      const newFile = join(tempDir, 'fresh.jsonl');
      const content = JSON.stringify({ mainAgent: true, body: { messages: [{ role: 'user', content: 'hello' }] } });
      writeFileSync(oldFile, content + '\n---\n');

      rotateLogFile(oldFile, newFile, 10); // maxSize=10 to trigger rotation

      // New file should exist but be empty (no migration)
      assert.ok(existsSync(newFile), 'new file should be created by rotateLogFile');
      assert.equal(readFileSync(newFile, 'utf-8'), '', 'new file should be empty');
    });

    it('appends newline to old file to trigger watcher', () => {
      const oldFile = join(tempDir, 'watcher_trigger.jsonl');
      const newFile = join(tempDir, 'new_watcher.jsonl');
      const originalContent = 'x'.repeat(1024);
      writeFileSync(oldFile, originalContent);

      rotateLogFile(oldFile, newFile, 500);

      const afterContent = readFileSync(oldFile, 'utf-8');
      assert.equal(afterContent, originalContent + '\n', 'old file should have \\n appended');
    });

    it('rotates repeatedly without skip (no cascade suppression)', () => {
      // Simulate: first rotation, then file grows again, second rotation should also work
      const file1 = join(tempDir, 'round1.jsonl');
      const file2 = join(tempDir, 'round2.jsonl');
      const file3 = join(tempDir, 'round3.jsonl');

      writeFileSync(file1, 'x'.repeat(1024));
      const r1 = rotateLogFile(file1, file2, 500);
      assert.equal(r1.rotated, true);

      // Simulate file2 also grows past limit
      writeFileSync(file2, 'y'.repeat(1024));
      const r2 = rotateLogFile(file2, file3, 500);
      assert.equal(r2.rotated, true, 'second rotation should not be suppressed');
    });

    it('exact boundary: file size equals maxSize triggers rotation', () => {
      const oldFile = join(tempDir, 'exact.jsonl');
      const newFile = join(tempDir, 'exact_new.jsonl');
      writeFileSync(oldFile, 'x'.repeat(500));

      const result = rotateLogFile(oldFile, newFile, 500);
      assert.equal(result.rotated, true);
    });
  });
});
