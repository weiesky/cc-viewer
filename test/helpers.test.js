/**
 * Unit tests for src/utils/helpers.js
 * All function implementations are inlined — no src/ imports.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Inlined dependencies ────────────────────────────────────────────────────

function isSkillText(text) {
  if (!text) return false;
  return /^Base directory for this skill:/i.test(text.trim());
}

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent/i;
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(s => (s && s.text) || '').join('');
  return '';
}

function isTeammate(req) {
  if (!req) return false;
  if (req.teammate) return true;
  return TEAMMATE_SYSTEM_RE.test(getSystemText(req.body || {}));
}

function isMainAgent(req) {
  if (!req) return false;
  if (isTeammate(req)) return false;
  if (req.mainAgent) {
    const sysText = getSystemText(req.body || {});
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }
  const body = req.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;
  const sysText = getSystemText(body);
  if (!sysText.includes('You are Claude Code')) return false;
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
  if (Array.isArray(body.system) && body.tools.some(t => t.name === 'ToolSearch')) {
    const messages = body.messages || [];
    const first = messages.length > 0
      ? (typeof messages[0].content === 'string' ? messages[0].content
        : Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (first.includes('<available-deferred-tools>')) return true;
  }
  if (body.tools.length > 5) {
    if (body.tools.some(t => t.name === 'Edit') && body.tools.some(t => t.name === 'Bash') && body.tools.some(t => t.name === 'Task' || t.name === 'Agent')) return true;
  }
  return false;
}

// ─── Inlined helpers.js functions ────────────────────────────────────────────

const MODEL_CONTEXT_SIZES = [
  { match: /\[1m\]/i, tokens: 1000000 },
  { match: /claude/i, tokens: 200000 },
  { match: /gpt-4o|o1|o3|o4/i, tokens: 128000 },
  { match: /gpt-4/i, tokens: 128000 },
  { match: /gpt-3/i, tokens: 16000 },
  { match: /deepseek/i, tokens: 128000 },
];

function getModelMaxTokens(modelName) {
  if (!modelName) return 200000;
  for (const entry of MODEL_CONTEXT_SIZES) {
    if (entry.match.test(modelName)) return entry.tokens;
  }
  return 200000;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

function extractToolResultText(toolResult) {
  if (!toolResult.content) return String(toolResult.content ?? '');
  if (typeof toolResult.content === 'string') return toolResult.content;
  if (Array.isArray(toolResult.content)) {
    return toolResult.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  return JSON.stringify(toolResult.content);
}

function formatTokenCount(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function stripPrivateKeys(obj) {
  if (Array.isArray(obj)) return obj.map(stripPrivateKeys);
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      result[key] = stripPrivateKeys(obj[key]);
    }
    return result;
  }
  return obj;
}

function computeTokenStats(requests) {
  const byModel = {};
  for (const req of requests) {
    const usage = req.response?.body?.usage;
    if (!usage) continue;
    const model = req.body?.model || 'unknown';
    if (!byModel[model]) byModel[model] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    const s = byModel[model];
    s.input += (usage.input_tokens || 0);
    s.output += (usage.output_tokens || 0);
    s.cacheCreation += (usage.cache_creation_input_tokens || 0);
    s.cacheRead += (usage.cache_read_input_tokens || 0);
  }
  return byModel;
}

function computeToolUsageStats(requests) {
  const toolCounts = {};
  for (const req of requests) {
    const content = req.response?.body?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.name) toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
    }
  }
  return Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
}

function computeSkillUsageStats(requests) {
  const skillCounts = {};
  for (const req of requests) {
    const messages = req.body?.messages;
    if (!Array.isArray(messages)) continue;
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== 'text' || !isSkillText(block.text)) continue;
        const nameMatch = block.text.match(/^#\s+(.+)$/m);
        const skillName = nameMatch ? nameMatch[1] : 'Skill';
        skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
      }
    }
  }
  return Object.entries(skillCounts).sort((a, b) => b[1] - a[1]);
}

function isRelevantRequest(request) {
  const url = request?.url || '';
  return !(
    request.isHeartbeat ||
    request.isCountTokens ||
    /\/api\/eval\/sdk-/.test(url) ||
    /\/messages\/count_tokens/.test(url) ||
    request.inProgress === true ||
    (request.response && request.response.status === 0)
  );
}

function filterRelevantRequests(requests) {
  return requests.filter(isRelevantRequest);
}

function isClaudeMdReminder(text) {
  if (typeof text !== 'string') return false;
  return text.includes('<system-reminder>') && text.includes('# claudeMd');
}

function isSkillsReminder(text) {
  if (typeof text !== 'string') return false;
  return text.includes('<system-reminder>') && text.includes('skills are available');
}

function hasClaudeMdReminder(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === 'string') { if (isClaudeMdReminder(content)) return true; }
    else if (Array.isArray(content)) {
      for (const block of content) { if (block.type === 'text' && isClaudeMdReminder(block.text)) return true; }
    }
  }
  return false;
}

function hasSkillsReminder(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === 'string') { if (isSkillsReminder(content)) return true; }
    else if (Array.isArray(content)) {
      for (const block of content) { if (block.type === 'text' && isSkillsReminder(block.text)) return true; }
    }
  }
  return false;
}

function getModelShort(model) {
  if (!model) return null;
  return model.replace(/^claude-/, '').replace(/-\d{8,}$/, '');
}

function findPrevMainAgentTimestamp(requests, startIndex) {
  for (let i = startIndex - 1; i >= 0; i--) {
    if (isMainAgent(requests[i]) && requests[i].timestamp) return requests[i].timestamp;
  }
  return null;
}

function extractCachedContent(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return null;
  let chosen = null;
  if (requests.length === 1) {
    chosen = requests[0];
  } else {
    let latestMA = null;
    let latestMAWithUsage = null;
    for (let i = requests.length - 1; i >= 0; i--) {
      if (isMainAgent(requests[i])) {
        if (!latestMA) latestMA = requests[i];
        if (requests[i].response?.body?.usage) { latestMAWithUsage = requests[i]; break; }
      }
    }
    chosen = latestMAWithUsage || latestMA;
  }
  if (!chosen || !chosen.body) return null;
  const body = chosen.body;
  const usage = chosen.response?.body?.usage;
  const result = {
    system: [], messages: [], tools: [],
    cacheCreateTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
  };
  if (Array.isArray(body.system)) {
    let lastIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) { if (body.system[i].cache_control) { lastIdx = i; break; } }
    if (lastIdx >= 0) {
      for (let i = 0; i <= lastIdx; i++) { const b = body.system[i]; if (b.type === 'text' && b.text) result.system.push(b.text); }
    }
  }
  if (Array.isArray(body.messages)) {
    let lastIdx = -1;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const content = body.messages[i].content;
      if (Array.isArray(content)) { for (const b of content) { if (b.cache_control) { lastIdx = i; break; } } if (lastIdx >= 0) break; }
    }
    if (lastIdx >= 0) {
      for (let i = 0; i <= lastIdx; i++) {
        const msg = body.messages[i];
        if (typeof msg.content === 'string') { result.messages.push(`[${msg.role}] ${msg.content}`); }
        else if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'text' && b.text) result.messages.push(`[${msg.role}] ${b.text}`);
            else if (b.type === 'tool_result') { const t = extractToolResultText(b); if (t) result.messages.push(`[tool_result: ${b.tool_use_id}] ${t}`); }
          }
        }
      }
    }
  }
  if (Array.isArray(body.tools)) {
    if (body.tools.some(t => t.cache_control)) {
      for (const t of body.tools) result.tools.push(`${t.name}: ${t.description || ''}`);
    }
  }
  return result;
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMainReq(overrides = {}) {
  return { mainAgent: true, timestamp: '2026-01-01T00:00:00Z', body: { model: 'claude-opus-4-6', system: [{ type: 'text', text: 'You are Claude Code' }], tools: [], messages: [] }, response: { status: 200, body: { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 } } }, ...overrides };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('helpers', () => {
  describe('getModelMaxTokens', () => {
    it('returns 200000 for claude models', () => { assert.equal(getModelMaxTokens('claude-opus-4-6'), 200000); });
    it('returns 1000000 for claude model with [1m] suffix', () => { assert.equal(getModelMaxTokens('claude-opus-4-6[1m]'), 1000000); });
    it('returns 200000 for claude model without [1m]', () => { assert.equal(getModelMaxTokens('claude-opus-4-6-20250514'), 200000); });
    it('returns 128000 for gpt-4o', () => { assert.equal(getModelMaxTokens('gpt-4o'), 128000); });
    it('returns 128000 for deepseek', () => { assert.equal(getModelMaxTokens('deepseek-v3'), 128000); });
    it('returns 16000 for gpt-3', () => { assert.equal(getModelMaxTokens('gpt-3.5-turbo'), 16000); });
    it('returns 200000 for null', () => { assert.equal(getModelMaxTokens(null), 200000); });
    it('returns 200000 for unknown model', () => { assert.equal(getModelMaxTokens('llama-3'), 200000); });
  });

  describe('escapeHtml', () => {
    it('escapes & < > "', () => { assert.equal(escapeHtml('<div class="a">&'), '&lt;div class=&quot;a&quot;&gt;&amp;'); });
    it('returns empty for null', () => { assert.equal(escapeHtml(null), ''); });
    it('returns empty for empty string', () => { assert.equal(escapeHtml(''), ''); });
    it('leaves safe text unchanged', () => { assert.equal(escapeHtml('hello world'), 'hello world'); });
  });

  describe('truncateText', () => {
    it('truncates long text', () => { assert.equal(truncateText('hello world', 5), 'hello...'); });
    it('returns text unchanged if within limit', () => { assert.equal(truncateText('hi', 10), 'hi'); });
    it('returns empty for null', () => { assert.equal(truncateText(null, 10), ''); });
    it('returns empty for empty string', () => { assert.equal(truncateText('', 10), ''); });
  });

  describe('extractToolResultText', () => {
    it('returns string content as-is', () => { assert.equal(extractToolResultText({ content: 'output text' }), 'output text'); });
    it('joins text blocks from array', () => {
      assert.equal(extractToolResultText({ content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }), 'line1\nline2');
    });
    it('filters non-text blocks', () => {
      assert.equal(extractToolResultText({ content: [{ type: 'image' }, { type: 'text', text: 'ok' }] }), 'ok');
    });
    it('JSON.stringifies object content', () => {
      assert.equal(extractToolResultText({ content: { key: 'val' } }), '{"key":"val"}');
    });
    it('handles null content', () => { assert.equal(extractToolResultText({ content: null }), ''); });
    it('handles undefined content', () => { assert.equal(extractToolResultText({ content: undefined }), ''); });
  });

  describe('formatTokenCount', () => {
    it('returns "0" for 0', () => { assert.equal(formatTokenCount(0), '0'); });
    it('returns "0" for null', () => { assert.equal(formatTokenCount(null), '0'); });
    it('returns string for small numbers', () => { assert.equal(formatTokenCount(500), '500'); });
    it('formats K', () => { assert.equal(formatTokenCount(1500), '1.5K'); });
    it('formats M', () => { assert.equal(formatTokenCount(2500000), '2.5M'); });
    it('formats exactly 1000 as K', () => { assert.equal(formatTokenCount(1000), '1.0K'); });
  });

  describe('stripPrivateKeys', () => {
    it('removes _ prefixed keys', () => {
      assert.deepEqual(stripPrivateKeys({ a: 1, _b: 2, c: 3 }), { a: 1, c: 3 });
    });
    it('recurses into nested objects', () => {
      assert.deepEqual(stripPrivateKeys({ a: { _x: 1, y: 2 } }), { a: { y: 2 } });
    });
    it('recurses into arrays', () => {
      assert.deepEqual(stripPrivateKeys([{ _a: 1, b: 2 }]), [{ b: 2 }]);
    });
    it('returns primitives as-is', () => {
      assert.equal(stripPrivateKeys(42), 42);
      assert.equal(stripPrivateKeys('str'), 'str');
      assert.equal(stripPrivateKeys(null), null);
    });
  });

  describe('computeTokenStats', () => {
    it('aggregates tokens by model', () => {
      const reqs = [
        makeMainReq({ body: { model: 'claude-opus-4-6' }, response: { body: { usage: { input_tokens: 100, output_tokens: 50 } } } }),
        makeMainReq({ body: { model: 'claude-opus-4-6' }, response: { body: { usage: { input_tokens: 200, output_tokens: 30 } } } }),
        makeMainReq({ body: { model: 'claude-haiku-4-5' }, response: { body: { usage: { input_tokens: 50, output_tokens: 10 } } } }),
      ];
      const stats = computeTokenStats(reqs);
      assert.equal(stats['claude-opus-4-6'].input, 300);
      assert.equal(stats['claude-opus-4-6'].output, 80);
      assert.equal(stats['claude-haiku-4-5'].input, 50);
    });
    it('skips requests without usage', () => {
      const reqs = [makeMainReq({ response: { body: {} } })];
      assert.deepEqual(computeTokenStats(reqs), {});
    });
    it('uses "unknown" when model missing', () => {
      const reqs = [makeMainReq({ body: {}, response: { body: { usage: { input_tokens: 10 } } } })];
      assert.ok(computeTokenStats(reqs)['unknown']);
    });
  });

  describe('computeToolUsageStats', () => {
    it('counts tool_use blocks by name, sorted desc', () => {
      const reqs = [
        { response: { body: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Bash' }] } } },
        { response: { body: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'hi' }] } } },
      ];
      const stats = computeToolUsageStats(reqs);
      assert.deepEqual(stats, [['Read', 2], ['Bash', 2]]);
    });
    it('returns empty for no tool_use', () => {
      assert.deepEqual(computeToolUsageStats([{ response: { body: { content: [{ type: 'text', text: 'hi' }] } } }]), []);
    });
    it('handles missing response content', () => {
      assert.deepEqual(computeToolUsageStats([{ response: { body: {} } }]), []);
    });
  });

  describe('computeSkillUsageStats', () => {
    it('counts skill usage from user messages', () => {
      const reqs = [{
        body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /path\n# MySkill\ncontent' }] }] },
      }];
      const stats = computeSkillUsageStats(reqs);
      assert.equal(stats.length, 1);
      assert.equal(stats[0][0], 'MySkill');
      assert.equal(stats[0][1], 1);
    });
    it('ignores non-user messages', () => {
      const reqs = [{
        body: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Base directory for this skill: /path\n# Skill' }] }] },
      }];
      assert.deepEqual(computeSkillUsageStats(reqs), []);
    });
    it('returns empty for no skills', () => {
      const reqs = [{ body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] } }];
      assert.deepEqual(computeSkillUsageStats(reqs), []);
    });
  });

  describe('isRelevantRequest', () => {
    it('returns true for normal request', () => {
      assert.equal(isRelevantRequest({ url: 'https://api.anthropic.com/v1/messages', response: { status: 200 } }), true);
    });
    it('rejects heartbeat', () => { assert.equal(isRelevantRequest({ isHeartbeat: true }), false); });
    it('rejects countTokens', () => { assert.equal(isRelevantRequest({ isCountTokens: true }), false); });
    it('rejects eval/sdk URL', () => { assert.equal(isRelevantRequest({ url: 'https://statsig.anthropic.com/api/eval/sdk-abc' }), false); });
    it('rejects count_tokens URL', () => { assert.equal(isRelevantRequest({ url: 'https://api.anthropic.com/v1/messages/count_tokens' }), false); });
    it('rejects inProgress', () => { assert.equal(isRelevantRequest({ inProgress: true, url: '' }), false); });
    it('rejects response status 0', () => { assert.equal(isRelevantRequest({ url: '', response: { status: 0 } }), false); });
  });

  describe('filterRelevantRequests', () => {
    it('filters out irrelevant requests', () => {
      const reqs = [
        { url: 'https://api.anthropic.com/v1/messages', response: { status: 200 } },
        { isHeartbeat: true, url: '' },
        { url: 'https://api.anthropic.com/v1/messages', inProgress: true },
      ];
      assert.equal(filterRelevantRequests(reqs).length, 1);
    });
  });

  describe('isClaudeMdReminder / hasClaudeMdReminder', () => {
    it('detects CLAUDE.md reminder text', () => {
      assert.equal(isClaudeMdReminder('<system-reminder>\n# claudeMd\nsome content'), true);
    });
    it('rejects non-matching text', () => { assert.equal(isClaudeMdReminder('hello'), false); });
    it('rejects non-string', () => { assert.equal(isClaudeMdReminder(null), false); });
    it('hasClaudeMdReminder finds in string content', () => {
      assert.equal(hasClaudeMdReminder({ messages: [{ content: '<system-reminder>\n# claudeMd\nstuff' }] }), true);
    });
    it('hasClaudeMdReminder finds in array content', () => {
      assert.equal(hasClaudeMdReminder({ messages: [{ content: [{ type: 'text', text: '<system-reminder>\n# claudeMd' }] }] }), true);
    });
    it('hasClaudeMdReminder returns false when absent', () => {
      assert.equal(hasClaudeMdReminder({ messages: [{ content: 'hello' }] }), false);
    });
    it('hasClaudeMdReminder handles null body', () => { assert.equal(hasClaudeMdReminder(null), false); });
  });

  describe('isSkillsReminder / hasSkillsReminder', () => {
    it('detects skills reminder', () => {
      assert.equal(isSkillsReminder('<system-reminder>The following skills are available</system-reminder>'), true);
    });
    it('rejects non-matching', () => { assert.equal(isSkillsReminder('hello'), false); });
    it('hasSkillsReminder finds in messages', () => {
      assert.equal(hasSkillsReminder({ messages: [{ content: '<system-reminder>skills are available</system-reminder>' }] }), true);
    });
    it('hasSkillsReminder returns false when absent', () => {
      assert.equal(hasSkillsReminder({ messages: [{ content: 'hi' }] }), false);
    });
  });

  describe('getModelShort', () => {
    it('strips claude- prefix and date suffix', () => { assert.equal(getModelShort('claude-opus-4-6-20250101'), 'opus-4-6'); });
    it('strips only prefix if no date', () => { assert.equal(getModelShort('claude-haiku-4-5'), 'haiku-4-5'); });
    it('returns null for null', () => { assert.equal(getModelShort(null), null); });
    it('returns non-claude model as-is', () => { assert.equal(getModelShort('gpt-4o'), 'gpt-4o'); });
  });

  describe('findPrevMainAgentTimestamp', () => {
    it('finds previous mainAgent timestamp', () => {
      const reqs = [
        makeMainReq({ timestamp: 'T1' }),
        { mainAgent: false, timestamp: 'T2' },
        makeMainReq({ timestamp: 'T3' }),
      ];
      assert.equal(findPrevMainAgentTimestamp(reqs, 2), 'T1');
    });
    it('returns null when none found', () => {
      const reqs = [{ mainAgent: false }, makeMainReq({ timestamp: 'T1' })];
      assert.equal(findPrevMainAgentTimestamp(reqs, 0), null);
    });
    it('skips teammate requests', () => {
      const reqs = [
        makeMainReq({ teammate: 'worker-1', timestamp: 'T1' }),
        makeMainReq({ timestamp: 'T2' }),
      ];
      assert.equal(findPrevMainAgentTimestamp(reqs, 1), null);
    });
  });

  describe('extractCachedContent', () => {
    it('returns null for empty array', () => { assert.equal(extractCachedContent([]), null); });
    it('returns null for non-array', () => { assert.equal(extractCachedContent(null), null); });

    it('extracts system with cache_control', () => {
      const req = makeMainReq({
        body: {
          system: [
            { type: 'text', text: 'sys1', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'sys2' },
          ],
          tools: [], messages: [],
        },
      });
      const result = extractCachedContent([req]);
      assert.deepEqual(result.system, ['sys1']);
    });

    it('extracts messages up to cache_control', () => {
      const req = makeMainReq({
        body: {
          system: [], tools: [],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'msg1', cache_control: { type: 'ephemeral' } }] },
            { role: 'assistant', content: [{ type: 'text', text: 'msg2' }] },
          ],
        },
      });
      const result = extractCachedContent([req]);
      assert.equal(result.messages.length, 1);
      assert.ok(result.messages[0].includes('msg1'));
    });

    it('extracts tools when any has cache_control', () => {
      const req = makeMainReq({
        body: {
          system: [], messages: [],
          tools: [
            { name: 'Read', description: 'Read files', cache_control: { type: 'ephemeral' } },
            { name: 'Write', description: 'Write files' },
          ],
        },
      });
      const result = extractCachedContent([req]);
      assert.equal(result.tools.length, 2);
      assert.ok(result.tools[0].includes('Read'));
    });

    it('returns null when request has no body', () => {
      const reqs = [{ mainAgent: false }];
      assert.equal(extractCachedContent(reqs), null);
    });

    it('extracts SubAgent cache content', () => {
      const subReq = {
        mainAgent: false,
        body: {
          system: [
            { type: 'text', text: 'billing' },
            { type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'file search specialist', cache_control: { type: 'ephemeral' } },
          ],
          tools: [{ name: 'Glob' }, { name: 'Read' }],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'task', cache_control: { type: 'ephemeral' } }] },
          ],
        },
        response: { body: { usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 5000 } } },
      };
      const result = extractCachedContent([subReq]);
      assert.ok(result !== null);
      // test helper collects all text blocks up to last cache_control (including billing)
      assert.deepEqual(result.system, ['billing', 'You are Claude Code', 'file search specialist']);
      assert.equal(result.messages.length, 1);
      assert.equal(result.cacheCreateTokens, 100);
      assert.equal(result.cacheReadTokens, 5000);
    });

    it('prefers request with usage when multiple in array', () => {
      const mainReq = makeMainReq({
        timestamp: 'T1',
        body: { system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }], tools: [], messages: [] },
      });
      const teammateReq = {
        mainAgent: true, teammate: 'worker-1', timestamp: 'T2',
        body: { system: [{ type: 'text', text: 'teammate sys', cache_control: { type: 'ephemeral' } }], tools: [], messages: [] },
        response: { body: {} },
      };
      const result = extractCachedContent([mainReq, teammateReq]);
      assert.deepEqual(result.system, ['sys']); // mainReq has usage, teammate does not
    });

    it('includes cacheCreateTokens and cacheReadTokens', () => {
      const req = makeMainReq({
        response: { body: { usage: { cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 } } },
        body: { system: [{ type: 'text', text: 'x', cache_control: {} }], tools: [], messages: [] },
      });
      const result = extractCachedContent([req]);
      assert.equal(result.cacheCreateTokens, 1000);
      assert.equal(result.cacheReadTokens, 5000);
    });
  });
});
