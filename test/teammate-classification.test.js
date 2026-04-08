import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// src/utils 是 Vite 前端模块，import 路径无扩展名，Node 直接运行会报错。
// 这里直接内联被测逻辑的核心部分进行单元测试，避免依赖 Vite 的模块解析。

// ============================================================================
// 从 contentFilter.js 提取的核心逻辑（与源码保持一致）
// ============================================================================

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent/i;
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

function isTeammate(req) {
  if (!req) return false;
  if (req.teammate) return true;
  const sysText = getSystemText(req.body || {});
  return TEAMMATE_SYSTEM_RE.test(sysText);
}

function isMainAgent(req) {
  if (!req) return false;
  if (isTeammate(req)) return false;
  if (req.mainAgent) {
    const sysText = getSystemText(req.body || {});
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }
  return false; // simplified for test — full logic has additional checks
}

// From requestType.js — full implementation
function getMessageText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (const block of c) {
      if (block?.type === 'text' && block.text) return block.text;
    }
  }
  return '';
}

function getSubAgentSubType(req) {
  const body = req.body || {};
  const sysText = getSystemText(body);
  if (/Extract any file paths/i.test(sysText)) return 'Bash';
  if (/process Bash commands/i.test(sysText)) return 'Bash';
  if (/command execution specialist/i.test(sysText)) return 'Bash';
  if (/file search specialist/i.test(sysText)) return 'Search';
  if (/planning specialist/i.test(sysText)) return 'Plan';
  if (/general-purpose agent/i.test(sysText)) return 'General';
  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue;
    const text = getMessageText(msgs[i]);
    if (/^Command:/m.test(text)) return 'Bash';
    break;
  }
  return null;
}

function isCountRequest(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length !== 1) return false;
  const msg = msgs[0];
  return msg.role === 'user' && msg.content === 'count';
}

function isPreflightRequest(req, nextReq) {
  const body = req.body || {};
  const tools = body.tools;
  const msgs = body.messages || [];
  if (Array.isArray(tools) && tools.length > 0) return false;
  if (msgs.length !== 1 || msgs[0].role !== 'user') return false;
  const text = getMessageText(msgs[0]);
  if (!text) return false;
  if (text.trim() === 'count') return false;
  const trimmed = text.trim();
  if (/^Command:/m.test(text) || /^<policy_spec>/i.test(trimmed) || /^<task-notification>/i.test(trimmed)) return false;
  const sysText = getSystemText(body);
  if (!sysText.includes('Claude Code')) return false;
  if (/process Bash commands/i.test(sysText)) return false;
  if (/Extract any file paths/i.test(sysText)) return false;
  if (nextReq) {
    const nextMsgs = nextReq.body?.messages || [];
    const sig = text.slice(0, 80);
    const found = nextMsgs.some(m => {
      const c = m?.content;
      if (typeof c === 'string') return c.includes(sig);
      if (Array.isArray(c)) return c.some(b => b?.type === 'text' && b.text && b.text.includes(sig));
      return false;
    });
    if (found) return true;
  }
  return false;
}

function extractTeammateName(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const content = msgs[i].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const items = Array.isArray(block.content) ? block.content : [block];
      for (const item of items) {
        const text = item.text || (typeof item.content === 'string' ? item.content : '');
        if (!text || !text.includes('"sender"')) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.routing?.sender) return parsed.routing.sender;
        } catch { /* not JSON, skip */ }
      }
    }
  }
  return null;
}

function classifyRequest(req, nextReq) {
  if (isTeammate(req)) return { type: 'Teammate', subType: req.teammate || extractTeammateName(req.body) || null };
  if (isMainAgent(req)) return { type: 'MainAgent', subType: null };
  if (req.isCountTokens || isCountRequest(req)) return { type: 'Count', subType: null };
  if (isPreflightRequest(req, nextReq)) {
    const text = getMessageText((req.body?.messages || [])[0]);
    if (/^Implement the following plan:/i.test(text.trim())) return { type: 'Plan', subType: 'Prompt' };
    return { type: 'Preflight', subType: null };
  }
  return { type: 'SubAgent', subType: getSubAgentSubType(req) };
}

function formatRequestTag(type, subType) {
  if (type === 'Teammate' && subType) return `Teammate:${subType}`;
  if (type === 'Plan' && subType) return `Plan:${subType}`;
  if (type === 'SubAgent' && subType) return `SubAgent:${subType}`;
  return type;
}

function formatTeammateLabel(name, model) {
  const displayName = name || 'X';
  if (!model) return `Teammate: ${displayName}`;
  const short = model.replace(/^claude-/i, '').replace(/-\d{8}$/, '');
  return `Teammate: ${displayName}(${short})`;
}

function isSkillText(text) {
  if (!text) return false;
  return /^Base directory for this skill:/i.test(text.trim());
}

function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  return false;
}

function classifyUserContent(content) {
  if (!Array.isArray(content)) return { commands: [], textBlocks: [], skillBlocks: [] };

  const hasCommand = content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));

  const commands = [];
  if (hasCommand) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const m = (b.text || '').match(/<command-name>\s*([^<]*)<\/command-name>/i);
      if (m) {
        const cmd = m[1].trim();
        commands.push(cmd.startsWith('/') ? cmd : `/${cmd}`);
      }
    }
  }

  let textBlocks = content.filter(b => b.type === 'text' && !isSystemText(b.text));

  if (hasCommand) {
    textBlocks = textBlocks.filter(b => !/<command-message>/i.test(b.text || ''));
  }

  const skillBlocks = textBlocks.filter(b => isSkillText(b.text));
  if (skillBlocks.length > 0) {
    textBlocks = textBlocks.filter(b => !isSkillText(b.text));
  }

  return { commands, textBlocks, skillBlocks };
}

// ============================================================================
// Test helpers
// ============================================================================

function makeMainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}

function makeMainAgentReq(overrides = {}) {
  return {
    mainAgent: true,
    timestamp: '2026-03-18T00:00:00Z',
    body: {
      system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
      tools: makeMainAgentTools(),
      messages: [{ role: 'user', content: 'hello' }],
    },
    response: { status: 200, body: {} },
    ...overrides,
  };
}

function makeTeammateReq(overrides = {}) {
  return {
    mainAgent: true, // interceptor marks this true (body structure is same)
    teammate: 'worker-1',
    teamName: 'fix-ts-errors',
    timestamp: '2026-03-18T00:00:05Z',
    body: {
      system: [
        { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' },
        { type: 'text', text: '# Agent Teammate Communication\n\nIMPORTANT: You are running as an agent in a team.\nUse the SendMessage tool.' },
      ],
      tools: makeMainAgentTools(),
      messages: [{ role: 'user', content: 'work on task #1' }],
    },
    response: { status: 200, body: {} },
    ...overrides,
  };
}

// Teammate in proxy mode: no req.teammate field, only system prompt marker
function makeProxyTeammateReq(overrides = {}) {
  return {
    mainAgent: true,
    timestamp: '2026-03-18T00:00:05Z',
    body: {
      system: [
        { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' },
        { type: 'text', text: '# Agent Teammate Communication\n\nIMPORTANT: You are running as an agent in a team.' },
      ],
      tools: makeMainAgentTools(),
      messages: [{ role: 'user', content: 'work on task #1' }],
    },
    response: { status: 200, body: {} },
    ...overrides,
  };
}

function makeSubAgentReq(overrides = {}) {
  return {
    mainAgent: false,
    timestamp: '2026-03-18T00:00:03Z',
    body: {
      system: 'You are a command execution specialist.',
      tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: 'Command: ls' }],
    },
    response: { status: 200, body: { content: [{ type: 'text', text: 'output' }] } },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('contentFilter', () => {
  // --------------------------------------------------------------------------
  // isTeammate
  // --------------------------------------------------------------------------
  describe('isTeammate', () => {
    it('returns true for interceptor mode teammate (req.teammate field)', () => {
      assert.equal(isTeammate(makeTeammateReq()), true);
    });

    it('returns true for proxy mode teammate (system prompt marker only)', () => {
      assert.equal(isTeammate(makeProxyTeammateReq()), true);
    });

    it('returns false for MainAgent', () => {
      assert.equal(isTeammate(makeMainAgentReq()), false);
    });

    it('returns false for SubAgent', () => {
      assert.equal(isTeammate(makeSubAgentReq()), false);
    });

    it('returns false for null/undefined', () => {
      assert.equal(isTeammate(null), false);
      assert.equal(isTeammate(undefined), false);
    });

    it('detects "Agent Teammate Communication" variant', () => {
      const req = makeProxyTeammateReq();
      req.body.system = [{ type: 'text', text: 'You are Claude Code. Agent Teammate Communication protocol.' }];
      assert.equal(isTeammate(req), true);
    });
  });

  // --------------------------------------------------------------------------
  // isMainAgent with teammate exclusion
  // --------------------------------------------------------------------------
  describe('isMainAgent teammate exclusion', () => {
    it('returns true for normal MainAgent', () => {
      assert.equal(isMainAgent(makeMainAgentReq()), true);
    });

    it('returns false for interceptor mode teammate', () => {
      assert.equal(isMainAgent(makeTeammateReq()), false);
    });

    it('returns false for proxy mode teammate', () => {
      assert.equal(isMainAgent(makeProxyTeammateReq()), false);
    });

    it('solo mode unaffected (no teammate field, no teammate prompt)', () => {
      const solo = makeMainAgentReq();
      assert.equal(isMainAgent(solo), true);
    });
  });

  // --------------------------------------------------------------------------
  // isSkillText
  // --------------------------------------------------------------------------
  describe('isSkillText', () => {
    it('returns true for text starting with "Base directory for this skill:"', () => {
      assert.equal(isSkillText('Base directory for this skill: /some/path'), true);
    });

    it('is case-insensitive', () => {
      assert.equal(isSkillText('BASE DIRECTORY FOR THIS SKILL: /path'), true);
    });

    it('trims leading whitespace before matching', () => {
      assert.equal(isSkillText('  Base directory for this skill: /path'), true);
    });

    it('returns false for unrelated text', () => {
      assert.equal(isSkillText('Hello world'), false);
    });

    it('returns false for empty string', () => {
      assert.equal(isSkillText(''), false);
    });

    it('returns false for null/undefined', () => {
      assert.equal(isSkillText(null), false);
      assert.equal(isSkillText(undefined), false);
    });

    it('returns false when prefix appears mid-string', () => {
      assert.equal(isSkillText('Note: Base directory for this skill: /path'), false);
    });
  });

  // --------------------------------------------------------------------------
  // isSystemText
  // --------------------------------------------------------------------------
  describe('isSystemText', () => {
    it('returns true for null/undefined/empty', () => {
      assert.equal(isSystemText(null), true);
      assert.equal(isSystemText(undefined), true);
      assert.equal(isSystemText(''), true);
      assert.equal(isSystemText('   '), true);
    });

    it('returns true for XML-tag-like text', () => {
      assert.equal(isSystemText('<system-reminder>some content</system-reminder>'), true);
      assert.equal(isSystemText('<available-deferred-tools>'), true);
      assert.equal(isSystemText('<command-message>'), true);
    });

    it('returns true for SUGGESTION MODE prefix', () => {
      assert.equal(isSystemText('[SUGGESTION MODE: something]'), true);
    });

    it('returns true for output truncation message', () => {
      assert.equal(isSystemText('Your response was cut off because it exceeded the output token limit'), true);
    });

    it('returns true for skill text', () => {
      assert.equal(isSystemText('Base directory for this skill: /path'), true);
    });

    it('returns false for normal user text', () => {
      assert.equal(isSystemText('Please fix the bug in main.js'), false);
    });

    it('returns false for text that contains XML tags but does not start with one', () => {
      assert.equal(isSystemText('Here is some <b>bold</b> text'), false);
    });

    it('is case-insensitive for SUGGESTION MODE', () => {
      assert.equal(isSystemText('[suggestion mode: test]'), true);
    });

    it('trims before matching XML pattern', () => {
      assert.equal(isSystemText('  <system-reminder>content</system-reminder>'), true);
    });
  });

  // --------------------------------------------------------------------------
  // classifyUserContent
  // --------------------------------------------------------------------------
  describe('classifyUserContent', () => {
    it('returns empty result for non-array input', () => {
      assert.deepEqual(classifyUserContent(null), { commands: [], textBlocks: [], skillBlocks: [] });
      assert.deepEqual(classifyUserContent('string'), { commands: [], textBlocks: [], skillBlocks: [] });
      assert.deepEqual(classifyUserContent(undefined), { commands: [], textBlocks: [], skillBlocks: [] });
    });

    it('returns empty result for empty array', () => {
      assert.deepEqual(classifyUserContent([]), { commands: [], textBlocks: [], skillBlocks: [] });
    });

    it('puts normal user text into textBlocks', () => {
      const content = [{ type: 'text', text: 'Fix the bug please' }];
      const result = classifyUserContent(content);
      assert.equal(result.textBlocks.length, 1);
      assert.equal(result.textBlocks[0].text, 'Fix the bug please');
      assert.equal(result.commands.length, 0);
      assert.equal(result.skillBlocks.length, 0);
    });

    it('filters out system text from textBlocks', () => {
      const content = [
        { type: 'text', text: 'Fix the bug' },
        { type: 'text', text: '<system-reminder>injected</system-reminder>' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.textBlocks.length, 1);
      assert.equal(result.textBlocks[0].text, 'Fix the bug');
    });

    it('extracts slash command and excludes command blocks from textBlocks', () => {
      const content = [
        { type: 'text', text: '<command-message><command-name>/clear</command-name></command-message>' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.commands.length, 1);
      assert.equal(result.commands[0], '/clear');
      assert.equal(result.textBlocks.length, 0);
    });

    it('prepends "/" to command name if missing', () => {
      const content = [
        { type: 'text', text: '<command-message><command-name>clear</command-name></command-message>' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.commands[0], '/clear');
    });

    it('skill text is excluded from textBlocks (isSystemText filters it first)', () => {
      // isSystemText returns true for skill text, so skill blocks never reach textBlocks or skillBlocks
      const content = [
        { type: 'text', text: 'Do something' },
        { type: 'text', text: 'Base directory for this skill: /skills/autopilot' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.textBlocks.length, 1);
      assert.equal(result.textBlocks[0].text, 'Do something');
      assert.equal(result.skillBlocks.length, 0);
    });

    it('ignores non-text blocks (e.g. tool_result)', () => {
      const content = [
        { type: 'tool_result', content: 'some output' },
        { type: 'text', text: 'User message' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.textBlocks.length, 1);
      assert.equal(result.textBlocks[0].text, 'User message');
    });

    it('handles mixed content: command + skill + user text + system text', () => {
      // skill text is caught by isSystemText, so skillBlocks stays empty;
      // command blocks and system-injected XML are also excluded from textBlocks
      const content = [
        { type: 'text', text: '<command-message><command-name>/autopilot</command-name></command-message>' },
        { type: 'text', text: 'Base directory for this skill: /skills/autopilot\nsome docs' },
        { type: 'text', text: 'Please do the task' },
        { type: 'text', text: '<system-reminder>injected context</system-reminder>' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.commands[0], '/autopilot');
      assert.equal(result.skillBlocks.length, 0);
      assert.equal(result.textBlocks.length, 1);
      assert.equal(result.textBlocks[0].text, 'Please do the task');
    });

    it('returns multiple commands when multiple command-name tags present', () => {
      const content = [
        { type: 'text', text: '<command-message><command-name>/foo</command-name></command-message>' },
        { type: 'text', text: '<command-message><command-name>/bar</command-name></command-message>' },
      ];
      const result = classifyUserContent(content);
      assert.equal(result.commands.length, 2);
      assert.ok(result.commands.includes('/foo'));
      assert.ok(result.commands.includes('/bar'));
    });
  });
});

describe('requestType', () => {
  // --------------------------------------------------------------------------
  // classifyRequest with Teammate
  // --------------------------------------------------------------------------
  describe('classifyRequest teammate classification', () => {
    it('classifies interceptor mode teammate as Teammate with subType', () => {
      const result = classifyRequest(makeTeammateReq());
      assert.equal(result.type, 'Teammate');
      assert.equal(result.subType, 'worker-1');
    });

    it('classifies proxy mode teammate as Teammate with null subType', () => {
      const result = classifyRequest(makeProxyTeammateReq());
      assert.equal(result.type, 'Teammate');
      assert.equal(result.subType, null);
    });

    it('classifies MainAgent correctly (not Teammate)', () => {
      const result = classifyRequest(makeMainAgentReq());
      assert.equal(result.type, 'MainAgent');
    });

    it('classifies SubAgent correctly (not Teammate)', () => {
      const result = classifyRequest(makeSubAgentReq());
      assert.equal(result.type, 'SubAgent');
      assert.equal(result.subType, 'Bash');
    });

    it('Teammate takes priority over MainAgent even with mainAgent=true', () => {
      // Teammate req has mainAgent=true from interceptor, but should be classified as Teammate
      const req = makeTeammateReq();
      assert.equal(req.mainAgent, true); // verify precondition
      const result = classifyRequest(req);
      assert.equal(result.type, 'Teammate');
    });
  });

  // --------------------------------------------------------------------------
  // formatRequestTag
  // --------------------------------------------------------------------------
  describe('formatRequestTag with Teammate', () => {
    it('formats Teammate with subType', () => {
      assert.equal(formatRequestTag('Teammate', 'worker-1'), 'Teammate:worker-1');
    });

    it('formats Teammate without subType', () => {
      assert.equal(formatRequestTag('Teammate', null), 'Teammate');
    });

    it('does not affect SubAgent formatting', () => {
      assert.equal(formatRequestTag('SubAgent', 'Bash'), 'SubAgent:Bash');
    });

    it('does not affect MainAgent formatting', () => {
      assert.equal(formatRequestTag('MainAgent', null), 'MainAgent');
    });

    it('formats Plan:Prompt', () => {
      assert.equal(formatRequestTag('Plan', 'Prompt'), 'Plan:Prompt');
    });

    it('formats Count (no subType)', () => {
      assert.equal(formatRequestTag('Count', null), 'Count');
    });

    it('formats Preflight (no subType)', () => {
      assert.equal(formatRequestTag('Preflight', null), 'Preflight');
    });
  });

  // --------------------------------------------------------------------------
  // getSubAgentSubType
  // --------------------------------------------------------------------------
  describe('getSubAgentSubType', () => {
    function makeReq(system, messages) {
      return { body: { system, messages: messages || [{ role: 'user', content: 'do it' }] } };
    }

    it('"Extract any file paths" → Bash', () => {
      assert.equal(getSubAgentSubType(makeReq('Extract any file paths from the output')), 'Bash');
    });

    it('"process Bash commands" → Bash', () => {
      assert.equal(getSubAgentSubType(makeReq('You process Bash commands for the agent')), 'Bash');
    });

    it('"command execution specialist" → Bash', () => {
      assert.equal(getSubAgentSubType(makeReq('You are a command execution specialist.')), 'Bash');
    });

    it('"file search specialist" → Search', () => {
      assert.equal(getSubAgentSubType(makeReq('You are a file search specialist.')), 'Search');
    });

    it('"planning specialist" → Plan', () => {
      assert.equal(getSubAgentSubType(makeReq('You are a planning specialist.')), 'Plan');
    });

    it('"general-purpose agent" → General', () => {
      assert.equal(getSubAgentSubType(makeReq('You are a general-purpose agent.')), 'General');
    });

    it('last user message starting with "Command:" → Bash', () => {
      const req = makeReq('Some generic system', [
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'Command: ls -la' },
      ]);
      assert.equal(getSubAgentSubType(req), 'Bash');
    });

    it('returns null when nothing matches', () => {
      assert.equal(getSubAgentSubType(makeReq('You are a helpful assistant.')), null);
    });

    it('system pattern match takes priority over message "Command:" check', () => {
      // system says "file search specialist" but last user msg also starts with Command:
      const req = makeReq('You are a file search specialist.', [
        { role: 'user', content: 'Command: find .' },
      ]);
      assert.equal(getSubAgentSubType(req), 'Search');
    });

    it('is case-insensitive for system patterns', () => {
      assert.equal(getSubAgentSubType(makeReq('EXTRACT ANY FILE PATHS here')), 'Bash');
    });
  });

  // --------------------------------------------------------------------------
  // isCountRequest
  // --------------------------------------------------------------------------
  describe('isCountRequest', () => {
    it('returns true for single user message with content "count"', () => {
      const req = { body: { messages: [{ role: 'user', content: 'count' }] } };
      assert.equal(isCountRequest(req), true);
    });

    it('returns false when content is not exactly "count"', () => {
      const req = { body: { messages: [{ role: 'user', content: 'count tokens' }] } };
      assert.equal(isCountRequest(req), false);
    });

    it('returns false when there are multiple messages', () => {
      const req = { body: { messages: [
        { role: 'user', content: 'hello' },
        { role: 'user', content: 'count' },
      ] } };
      assert.equal(isCountRequest(req), false);
    });

    it('returns false when role is not user', () => {
      const req = { body: { messages: [{ role: 'assistant', content: 'count' }] } };
      assert.equal(isCountRequest(req), false);
    });

    it('returns false when messages is missing', () => {
      assert.equal(isCountRequest({ body: {} }), false);
    });

    it('returns false when body is missing', () => {
      assert.equal(isCountRequest({}), false);
    });
  });

  // --------------------------------------------------------------------------
  // isPreflightRequest
  // --------------------------------------------------------------------------
  describe('isPreflightRequest', () => {
    function makePreflightReq(text, systemExtra) {
      return {
        body: {
          system: `You are Claude Code, Anthropic's official CLI.${systemExtra || ''}`,
          messages: [{ role: 'user', content: text }],
          // no tools
        },
      };
    }

    function makeNextReq(text) {
      return {
        body: {
          messages: [
            { role: 'user', content: text },
          ],
        },
      };
    }

    it('returns true when all conditions met and next req contains the text', () => {
      const userText = 'Please implement the feature described above.';
      const req = makePreflightReq(userText);
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), true);
    });

    it('matches on first 80 chars of text against next req', () => {
      const userText = 'A'.repeat(100);
      const req = makePreflightReq(userText);
      const next = makeNextReq('A'.repeat(100) + ' extra context');
      assert.equal(isPreflightRequest(req, next), true);
    });

    it('returns false when tools array is non-empty', () => {
      const userText = 'Do something';
      const req = makePreflightReq(userText);
      req.body.tools = [{ name: 'Bash' }];
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false when there are multiple messages', () => {
      const userText = 'Do something';
      const req = makePreflightReq(userText);
      req.body.messages.push({ role: 'assistant', content: 'ok' });
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false when system lacks "Claude Code"', () => {
      const userText = 'Do something';
      const req = { body: { system: 'You are a helpful assistant.', messages: [{ role: 'user', content: userText }] } };
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false for "count" message', () => {
      const req = makePreflightReq('count');
      const next = makeNextReq('count');
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false for "Command:" message', () => {
      const req = makePreflightReq('Command: ls -la');
      const next = makeNextReq('Command: ls -la');
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false when system contains "process Bash commands"', () => {
      const userText = 'Do something';
      const req = makePreflightReq(userText, ' You process Bash commands.');
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false when system contains "Extract any file paths"', () => {
      const userText = 'Do something';
      const req = makePreflightReq(userText, ' Extract any file paths from output.');
      const next = makeNextReq(userText);
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false when next req does not contain the text', () => {
      const req = makePreflightReq('Do something unique');
      const next = makeNextReq('Completely different content');
      assert.equal(isPreflightRequest(req, next), false);
    });

    it('returns false (not true) when nextReq is absent', () => {
      const req = makePreflightReq('Do something');
      assert.equal(isPreflightRequest(req, null), false);
    });

    it('matches when next req content is an array of text blocks', () => {
      const userText = 'Implement the feature now';
      const req = makePreflightReq(userText);
      const next = {
        body: {
          messages: [{ role: 'user', content: [{ type: 'text', text: userText + ' with more context' }] }],
        },
      };
      assert.equal(isPreflightRequest(req, next), true);
    });
  });

  // --------------------------------------------------------------------------
  // Plan:Prompt classification
  // --------------------------------------------------------------------------
  describe('Plan:Prompt classification', () => {
    it('classifies preflight with "Implement the following plan:" as Plan:Prompt', () => {
      const userText = 'Implement the following plan:\n1. Do X\n2. Do Y';
      const req = {
        body: {
          system: "You are Claude Code, Anthropic's official CLI.",
          messages: [{ role: 'user', content: userText }],
        },
      };
      const next = {
        body: { messages: [{ role: 'user', content: userText + ' additional context' }] },
      };
      const result = classifyRequest(req, next);
      assert.equal(result.type, 'Plan');
      assert.equal(result.subType, 'Prompt');
    });

    it('is case-insensitive for the plan prefix', () => {
      const userText = 'implement the following plan:\nstep 1';
      const req = {
        body: {
          system: "You are Claude Code, Anthropic's official CLI.",
          messages: [{ role: 'user', content: userText }],
        },
      };
      const next = {
        body: { messages: [{ role: 'user', content: userText }] },
      };
      const result = classifyRequest(req, next);
      assert.equal(result.type, 'Plan');
      assert.equal(result.subType, 'Prompt');
    });

    it('regular preflight (no plan prefix) stays as Preflight', () => {
      const userText = 'Please fix the bug in main.js';
      const req = {
        body: {
          system: "You are Claude Code, Anthropic's official CLI.",
          messages: [{ role: 'user', content: userText }],
        },
      };
      const next = {
        body: { messages: [{ role: 'user', content: userText }] },
      };
      const result = classifyRequest(req, next);
      assert.equal(result.type, 'Preflight');
      assert.equal(result.subType, null);
    });
  });

  // --------------------------------------------------------------------------
  // Count classification via isCountTokens flag
  // --------------------------------------------------------------------------
  describe('Count classification', () => {
    it('classifies req with isCountTokens=true as Count', () => {
      const req = { isCountTokens: true, body: { messages: [{ role: 'user', content: 'hello' }] } };
      const result = classifyRequest(req);
      assert.equal(result.type, 'Count');
      assert.equal(result.subType, null);
    });

    it('classifies single user message "count" as Count', () => {
      const req = { body: { messages: [{ role: 'user', content: 'count' }] } };
      const result = classifyRequest(req);
      assert.equal(result.type, 'Count');
      assert.equal(result.subType, null);
    });

    it('isCountTokens takes priority over SubAgent classification', () => {
      const req = {
        isCountTokens: true,
        body: {
          system: 'You are a command execution specialist.',
          messages: [{ role: 'user', content: 'Command: ls' }],
        },
      };
      const result = classifyRequest(req);
      assert.equal(result.type, 'Count');
    });
  });
});

describe('formatTeammateLabel', () => {
  it('returns "Teammate: name(model-short)" for full claude model name', () => {
    assert.equal(formatTeammateLabel('server-dev', 'claude-sonnet-4-6-20250514'), 'Teammate: server-dev(sonnet-4-6)');
  });

  it('strips claude- prefix and date suffix', () => {
    assert.equal(formatTeammateLabel('worker-1', 'claude-opus-4-6-20250514'), 'Teammate: worker-1(opus-4-6)');
  });

  it('returns "Teammate: name" when model is null', () => {
    assert.equal(formatTeammateLabel('worker-1', null), 'Teammate: worker-1');
  });

  it('returns "Teammate: name" when model is undefined', () => {
    assert.equal(formatTeammateLabel('worker-1', undefined), 'Teammate: worker-1');
  });

  it('returns "Teammate: name" when model is empty string', () => {
    assert.equal(formatTeammateLabel('worker-1', ''), 'Teammate: worker-1');
  });

  it('returns "Teammate: X" when name is null and no model', () => {
    assert.equal(formatTeammateLabel(null, null), 'Teammate: X');
  });

  it('returns "Teammate: X(model)" when name is null but model exists', () => {
    assert.equal(formatTeammateLabel(null, 'claude-haiku-4-5-20251001'), 'Teammate: X(haiku-4-5)');
  });

  it('handles model without claude- prefix', () => {
    assert.equal(formatTeammateLabel('test', 'gpt-4o-20250101'), 'Teammate: test(gpt-4o)');
  });

  it('handles model without date suffix', () => {
    assert.equal(formatTeammateLabel('test', 'claude-sonnet-4-6'), 'Teammate: test(sonnet-4-6)');
  });

  it('handles 1M model descriptor', () => {
    assert.equal(formatTeammateLabel('lead', 'claude-opus-4-6[1m]'), 'Teammate: lead(opus-4-6[1m])');
  });
});

// --------------------------------------------------------------------------
// extractTeammateName
// --------------------------------------------------------------------------
describe('extractTeammateName', () => {
  it('extracts sender from SendMessage tool_result with routing.sender', () => {
    const body = {
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    status: 'sent',
                    routing: { sender: 'worker-3', recipient: 'lead' },
                  }),
                },
              ],
            },
          ],
        },
      ],
    };
    assert.equal(extractTeammateName(body), 'worker-3');
  });

  it('returns null when no messages', () => {
    assert.equal(extractTeammateName({}), null);
    assert.equal(extractTeammateName(null), null);
  });

  it('returns null when no tool_result blocks', () => {
    const body = {
      messages: [{ role: 'user', content: 'hello' }],
    };
    assert.equal(extractTeammateName(body), null);
  });

  it('returns null when tool_result has no routing.sender', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [{ type: 'text', text: '{"status":"ok"}' }],
            },
          ],
        },
      ],
    };
    assert.equal(extractTeammateName(body), null);
  });

  it('scans from last message first', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [{ type: 'text', text: JSON.stringify({ routing: { sender: 'old-name' } }) }],
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_2',
              content: [{ type: 'text', text: JSON.stringify({ routing: { sender: 'new-name' } }) }],
            },
          ],
        },
      ],
    };
    assert.equal(extractTeammateName(body), 'new-name');
  });

  it('skips non-JSON text gracefully', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [{ type: 'text', text: 'not json with "sender" in it' }],
            },
            {
              type: 'tool_result',
              tool_use_id: 'tu_2',
              content: [{ type: 'text', text: JSON.stringify({ routing: { sender: 'worker-1' } }) }],
            },
          ],
        },
      ],
    };
    assert.equal(extractTeammateName(body), 'worker-1');
  });

  it('classifyRequest uses extractTeammateName for proxy-mode teammate', () => {
    const req = {
      body: {
        system: [{ type: 'text', text: 'You are running as an agent in a team.' }],
        tools: [{ name: 'SendMessage' }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: [{ type: 'text', text: JSON.stringify({ routing: { sender: 'researcher' } }) }],
              },
            ],
          },
        ],
      },
    };
    const result = classifyRequest(req);
    assert.equal(result.type, 'Teammate');
    assert.equal(result.subType, 'researcher');
  });
});

// ============================================================================
// Teammate 空日志过滤测试
// 验证 ChatView.buildSubAgentEntries 中的核心过滤条件（line 754）
// ============================================================================

/**
 * 与 ChatView 第 754 行一致的过滤条件：
 * if (Array.isArray(respContent) && respContent.length > 0)
 */
function shouldCreateEntry(respContent) {
  return Array.isArray(respContent) && respContent.length > 0;
}

describe('Teammate empty log filtering', () => {
  it('rejects undefined', () => assert.equal(shouldCreateEntry(undefined), false));
  it('rejects null', () => assert.equal(shouldCreateEntry(null), false));
  it('rejects empty array', () => assert.equal(shouldCreateEntry([]), false));
  it('rejects string', () => assert.equal(shouldCreateEntry('text'), false));
  it('rejects number', () => assert.equal(shouldCreateEntry(0), false));
  it('accepts non-empty array', () => assert.equal(shouldCreateEntry([{ type: 'text', text: 'hi' }]), true));

  it('classifyRequest + filter: empty teammate produces no entry', () => {
    const req = {
      timestamp: 1000,
      teammate: 'alpha',
      body: { system: [{ type: 'text', text: 'You are running as an agent in a team.' }], messages: [] },
      response: { body: { content: [] } },
    };
    const cls = classifyRequest(req);
    assert.equal(cls.type, 'Teammate');
    assert.equal(shouldCreateEntry(req.response.body.content), false);
  });

  it('classifyRequest + filter: valid teammate produces entry', () => {
    const req = {
      timestamp: 1000,
      teammate: 'beta',
      body: { system: [{ type: 'text', text: 'You are running as an agent in a team.' }], messages: [] },
      response: { body: { content: [{ type: 'text', text: 'result' }] } },
    };
    const cls = classifyRequest(req);
    assert.equal(cls.type, 'Teammate');
    assert.equal(shouldCreateEntry(req.response.body.content), true);
  });
});
