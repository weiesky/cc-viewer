import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMainAgentEntry,
  extractCachedContent,
  extractToolResultText,
} from '../lib/kv-cache-analyzer.js';

// ============================================================================
// Helpers
// ============================================================================

function makeTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}

function makeMainAgentEntry(overrides = {}) {
  return {
    mainAgent: true,
    body: {
      system: [{ type: 'text', text: 'You are Claude Code, an AI assistant.' }],
      tools: makeTools(),
      messages: [{ role: 'user', content: 'hello' }],
    },
    response: { body: { usage: {} } },
    ...overrides,
  };
}

// ============================================================================
// isMainAgentEntry
// ============================================================================

describe('isMainAgentEntry', () => {
  it('returns true for standard MainAgent entry', () => {
    assert.equal(isMainAgentEntry(makeMainAgentEntry()), true);
  });

  it('returns false for null/undefined entry', () => {
    assert.equal(isMainAgentEntry(null), false);
    assert.equal(isMainAgentEntry(undefined), false);
  });

  it('returns false for SubAgent (command execution specialist)', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code, a command execution specialist.' }],
        tools: makeTools(),
        messages: [],
      },
    });
    assert.equal(isMainAgentEntry(entry), false);
  });

  it('returns false for SubAgent (file search specialist)', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code, a file search specialist.' }],
        tools: makeTools(),
        messages: [],
      },
    });
    assert.equal(isMainAgentEntry(entry), false);
  });

  it('returns false for teammate entry (has teammate field)', () => {
    const entry = { ...makeMainAgentEntry(), teammate: 'worker-1' };
    assert.equal(isMainAgentEntry(entry), false);
  });

  it('returns false for teammate entry (system contains Agent Teammate Communication)', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [
          { type: 'text', text: 'You are Claude Code.' },
          { type: 'text', text: 'Agent Teammate Communication\nIMPORTANT: You are running as an agent in a team.' },
        ],
        tools: makeTools(),
        messages: [],
      },
    });
    assert.equal(isMainAgentEntry(entry), false);
  });

  it('returns true for heuristic detection (no mainAgent flag, old arch)', () => {
    const entry = {
      body: {
        system: [{ type: 'text', text: 'You are Claude Code, an AI assistant.' }],
        tools: makeTools(),
        messages: [],
      },
    };
    assert.equal(isMainAgentEntry(entry), true);
  });

  it('returns true for heuristic detection (new arch with ToolSearch + deferred-tools)', () => {
    const entry = {
      body: {
        system: [{ type: 'text', text: 'You are Claude Code' }],
        tools: [{ name: 'ToolSearch' }, { name: 'Bash' }],
        messages: [{ role: 'user', content: 'some text <available-deferred-tools> list' }],
      },
    };
    assert.equal(isMainAgentEntry(entry), true);
  });

  it('returns false for heuristic detection without system', () => {
    const entry = { body: { tools: makeTools(), messages: [] } };
    assert.equal(isMainAgentEntry(entry), false);
  });

  it('returns false for empty entry object', () => {
    assert.equal(isMainAgentEntry({}), false);
  });
});

// ============================================================================
// extractToolResultText
// ============================================================================

describe('extractToolResultText', () => {
  it('extracts text from string content', () => {
    assert.equal(extractToolResultText({ content: 'hello world' }), 'hello world');
  });

  it('extracts text from array content with text blocks', () => {
    const block = {
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    };
    assert.equal(extractToolResultText(block), 'line one\nline two');
  });

  it('returns empty string for array with no text blocks', () => {
    const block = { content: [{ type: 'image', source: {} }] };
    assert.equal(extractToolResultText(block), '');
  });

  it('returns empty string for null/undefined content', () => {
    assert.equal(extractToolResultText({ content: null }), '');
    assert.equal(extractToolResultText({ content: undefined }), '');
  });

  it('returns JSON string for non-string non-array content', () => {
    const block = { content: { type: 'unknown' } };
    assert.equal(extractToolResultText(block), JSON.stringify({ type: 'unknown' }));
  });
});

// ============================================================================
// extractCachedContent
// ============================================================================

describe('extractCachedContent', () => {
  it('returns result for non-MainAgent entry with cache_control', () => {
    const entry = {
      mainAgent: false,
      body: {
        system: [{ type: 'text', text: 'SubAgent sys', cache_control: { type: 'ephemeral' } }],
        tools: [],
        messages: [],
      },
    };
    const result = extractCachedContent(entry);
    assert.ok(result !== null);
    assert.deepEqual(result.system, ['SubAgent sys']);
  });

  it('returns null for null entry', () => {
    assert.equal(extractCachedContent(null), null);
  });

  it('returns null when body is missing', () => {
    const entry = { mainAgent: true };
    assert.equal(extractCachedContent(entry), null);
  });

  it('extracts SubAgent cache with system + messages breakpoints', () => {
    const entry = {
      body: {
        system: [
          { type: 'text', text: 'billing header' },
          { type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'file search specialist instructions', cache_control: { type: 'ephemeral' } },
        ],
        tools: [{ name: 'Glob' }, { name: 'Grep' }, { name: 'Read' }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'search task' }, { type: 'text', text: 'details', cache_control: { type: 'ephemeral' } }] },
          { role: 'assistant', content: [{ type: 'text', text: 'found results' }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file content', cache_control: { type: 'ephemeral' } }] },
        ],
      },
      response: { body: { usage: { cache_creation_input_tokens: 500, cache_read_input_tokens: 12000 } } },
    };
    const result = extractCachedContent(entry);
    assert.ok(result !== null);
    assert.deepEqual(result.system, ['billing header', 'You are Claude Code', 'file search specialist instructions']);
    // msg[0]: 'search task' + 'details', msg[1]: 'found results', msg[2]: tool_result
    assert.equal(result.messages.length, 4);
    assert.equal(result.cacheCreateTokens, 500);
    assert.equal(result.cacheReadTokens, 12000);
  });

  it('returns object with empty arrays when no cache_control present', () => {
    const entry = makeMainAgentEntry();
    const result = extractCachedContent(entry);
    assert.ok(result !== null);
    assert.deepEqual(result.system, []);
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.tools, []);
  });

  it('extracts all system blocks up to last cache_control breakpoint', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [
          { type: 'text', text: 'You are Claude Code.' },
          { type: 'text', text: 'Second block.', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Third block (no cache).' },
        ],
        tools: makeTools(),
        messages: [],
      },
    });
    const result = extractCachedContent(entry);
    // prefix cache: all blocks from 0 to last cache_control are cached
    assert.deepEqual(result.system, ['You are Claude Code.', 'Second block.']);
  });

  it('extracts messages up to last message with cache_control', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code.' }],
        tools: makeTools(),
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'first' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'reply', cache_control: { type: 'ephemeral' } }] },
          { role: 'user', content: 'last (no cache)' },
        ],
      },
    });
    const result = extractCachedContent(entry);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0], '[user] first');
    assert.equal(result.messages[1], '[assistant] reply');
  });

  it('extracts tools when any tool has cache_control', () => {
    const tools = [
      { name: 'Edit', description: 'Edit files', cache_control: { type: 'ephemeral' } },
      { name: 'Bash', description: 'Run commands' },
    ];
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code.' }],
        tools,
        messages: [],
      },
    });
    const result = extractCachedContent(entry);
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0], 'Edit: Edit files');
    assert.equal(result.tools[1], 'Bash: Run commands');
  });

  it('returns correct cacheCreateTokens and cacheReadTokens from usage', () => {
    const entry = makeMainAgentEntry({
      response: {
        body: {
          usage: {
            cache_creation_input_tokens: 1234,
            cache_read_input_tokens: 5678,
          },
        },
      },
    });
    const result = extractCachedContent(entry);
    assert.equal(result.cacheCreateTokens, 1234);
    assert.equal(result.cacheReadTokens, 5678);
  });

  it('defaults token counts to 0 when usage is missing', () => {
    const entry = makeMainAgentEntry({ response: undefined });
    const result = extractCachedContent(entry);
    assert.equal(result.cacheCreateTokens, 0);
    assert.equal(result.cacheReadTokens, 0);
  });

  it('handles tool_result blocks in messages', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code.' }],
        tools: makeTools(),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: 'tool output text',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      },
    });
    const result = extractCachedContent(entry);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0], '[tool_result: tu_1] tool output text');
  });

  it('handles empty system/messages/tools arrays', () => {
    const entry = {
      mainAgent: true,
      body: { system: [], tools: [], messages: [] },
      response: { body: { usage: {} } },
    };
    const result = extractCachedContent(entry);
    assert.ok(result !== null);
    assert.deepEqual(result.system, []);
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.tools, []);
  });

  it('handles string message content', () => {
    const entry = makeMainAgentEntry({
      body: {
        system: [{ type: 'text', text: 'You are Claude Code.' }],
        tools: makeTools(),
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'string reply', cache_control: { type: 'ephemeral' } }] },
        ],
      },
    });
    const result = extractCachedContent(entry);
    assert.ok(result.messages.includes('[user] hi'));
    assert.ok(result.messages.includes('[assistant] string reply'));
  });
});
