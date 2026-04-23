import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// src/utils 是 Vite 前端模块（无扩展名 import）。Node 直接跑需要内联同款逻辑。
// 与 test/teammate-classification.test.js 同样的做法：把 requestType.js 的关键分支
// 抄一份出来跑断言，改源码时两处要保持同步。
//
// KEEP IN SYNC: 本文件内联的 SUBAGENT_SYSTEM_RE / TEAMMATE_SYSTEM_RE / isMainAgent /
// SYNTHETIC_PROMPTS / getSyntheticSubType / classifyRequest / formatRequestTag 必须与
// src/utils/contentFilter.js 和 src/utils/requestType.js 的对应定义保持一致。
// 改源码时请同步改本文件的 inline 副本；简化版 isMainAgent 不覆盖新架构检测
// （v2.1.69+ 延迟工具加载、v2.1.81+ 轻量 init），依赖此路径的断言应使用 mainAgent:true
// 走早期 return 分支。

// ============================================================================
// 从 contentFilter.js / requestType.js 复制的核心逻辑
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
  const body = req.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;
  const sysText = getSystemText(body);
  if (!sysText.includes('You are Claude Code')) return false;
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
  return true;
}

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

const SYNTHETIC_PROMPTS = [
  { subType: 'Recap',   pattern: /^The user stepped away and is coming back\. Recap in under/i },
  { subType: 'Title',   pattern: /^(Based on the above conversation, generate a|Please write a)\s+(short|concise)\s+title/i },
  { subType: 'Compact', pattern: /^(Your task is to create a detailed summary of the conversation|This session is being continued from a previous conversation)/i },
  { subType: 'Topic',   pattern: /^Analyze if this message indicates a new/i },
  { subType: 'Summary', pattern: /^Summarize this coding session/i },
];

function getSyntheticSubType(req) {
  if (!isMainAgent(req)) return null;
  const msgs = req.body?.messages || [];
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return null;
  const text = getMessageText(last).trim();
  if (!text) return null;
  for (const { subType, pattern } of SYNTHETIC_PROMPTS) {
    if (pattern.test(text)) return subType;
  }
  return null;
}

function classifyRequest(req) {
  if (isTeammate(req)) return { type: 'Teammate', subType: req.teammate || null };
  const syntheticSub = getSyntheticSubType(req);
  if (syntheticSub) return { type: 'Synthetic', subType: syntheticSub };
  if (isMainAgent(req)) return { type: 'MainAgent', subType: null };
  return { type: 'Other', subType: null };
}

// KEEP IN SYNC: 与 src/utils/contentFilter.js 的 isSyntheticPromptText / isSystemText 同步。
function isSyntheticPromptText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const { pattern } of SYNTHETIC_PROMPTS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  if (isSyntheticPromptText(trimmed)) return true;
  return false;
}

function formatRequestTag(type, subType) {
  if (type === 'Teammate' && subType) return `Teammate:${subType}`;
  if (type === 'Synthetic' && subType) return `Synthetic:${subType}`;
  return type;
}

// ============================================================================
// Fixtures
// ============================================================================

function makeMainReq(lastUserText, messagesBefore = []) {
  return {
    mainAgent: true,
    body: {
      system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
      tools: [{ name: 'Edit' }, { name: 'Bash' }],
      messages: [
        ...messagesBefore,
        { role: 'user', content: lastUserText },
      ],
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Synthetic classification', () => {
  describe('whitelist matches', () => {
    it('detects idle-return Recap prompt', () => {
      const req = makeMainReq(
        'The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown.',
        [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
      );
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Recap' });
    });

    it('detects Title generation prompt', () => {
      const req = makeMainReq('Based on the above conversation, generate a short title (under 8 words).');
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Title' });
    });

    it('detects Compact summary prompt', () => {
      const req = makeMainReq('Your task is to create a detailed summary of the conversation so far.');
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Compact' });
    });

    it('detects Topic-change prompt', () => {
      const req = makeMainReq('Analyze if this message indicates a new topic.');
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Topic' });
    });

    it('detects Summary prompt', () => {
      const req = makeMainReq('Summarize this coding session in a paragraph.');
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Summary' });
    });
  });

  describe('negative cases', () => {
    it('real user turn quoting the recap phrase is NOT Synthetic', () => {
      // 防 regression：这一整个场景来自 cc-viewer 自身的对话——用户在消息里引用了
      // 合成 prompt 的原文，ChatView 不应把用户的话错当成 Claude Code 内部调用。
      const req = makeMainReq(
        '我感觉你幻觉了，我是指：04-23 02:10:00 这条请求里面 {role:"user", content:"The user stepped away and is coming back. Recap in under 40 words..."} 是不是 claude code 系统生成的？'
      );
      assert.equal(classifyRequest(req).type, 'MainAgent');
    });

    it('prompt in the middle of message is NOT matched (^ anchor)', () => {
      const req = makeMainReq(
        'Hi Claude — here is what happened: The user stepped away and is coming back. Recap in under 40 words...'
      );
      assert.equal(classifyRequest(req).type, 'MainAgent');
    });

    it('last message is assistant, not user → not Synthetic', () => {
      const req = {
        mainAgent: true,
        body: {
          system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
          tools: [{ name: 'Edit' }],
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: [{ type: 'text', text: 'The user stepped away and is coming back. Recap in under...' }] },
          ],
        },
      };
      assert.equal(classifyRequest(req).type, 'MainAgent');
    });

    it('non-mainAgent (SubAgent) request is never upgraded to Synthetic', () => {
      // SubAgent 的 system prompt 不包含 "You are Claude Code"——即便 user message
      // 命中白名单也不应分到 Synthetic（它是 SubAgent 的真实输入，不是主会话合成的）。
      const req = {
        mainAgent: false,
        body: {
          system: [{ type: 'text', text: 'You are a file search specialist.' }],
          tools: [{ name: 'Read' }],
          messages: [
            { role: 'user', content: 'The user stepped away and is coming back. Recap in under 40 words.' },
          ],
        },
      };
      assert.equal(classifyRequest(req).type, 'Other');
    });

    it('Teammate request with matching text is classified as Teammate, not Synthetic', () => {
      const req = {
        mainAgent: true,
        teammate: 'worker-1',
        body: {
          system: [
            { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' },
            { type: 'text', text: '# Agent Teammate Communication\n\nIMPORTANT: You are running as an agent in a team.' },
          ],
          tools: [{ name: 'Edit' }],
          messages: [
            { role: 'user', content: 'The user stepped away and is coming back. Recap in under 40 words.' },
          ],
        },
      };
      assert.equal(classifyRequest(req).type, 'Teammate');
    });

    it('empty messages → not Synthetic', () => {
      const req = {
        mainAgent: true,
        body: {
          system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
          tools: [{ name: 'Edit' }],
          messages: [],
        },
      };
      assert.equal(classifyRequest(req).type, 'MainAgent');
    });

    it('missing messages field → does not crash, not Synthetic', () => {
      // 防御性：body.messages 缺失时 `?.messages || []` 兜底，classifier 不应抛。
      const req = {
        mainAgent: true,
        body: {
          system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
          tools: [{ name: 'Edit' }],
          // messages: undefined
        },
      };
      assert.equal(classifyRequest(req).type, 'MainAgent');
    });
  });

  describe('content-shape robustness', () => {
    it('matches when last user message is array-form content', () => {
      // 真实 Claude Code 请求里 user content 常常是 [{type:'text', text:'...'}] 结构，
      // 而非字符串。getMessageText 要能从 array 里取出首个 text block。
      const req = {
        mainAgent: true,
        body: {
          system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
          tools: [{ name: 'Edit' }],
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
            { role: 'user', content: [{ type: 'text', text: 'The user stepped away and is coming back. Recap in under 40 words.' }] },
          ],
        },
      };
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Recap' });
    });

    it('matches when array content has tool_result before the synthetic text block', () => {
      // 混合 block：text block 跟在 tool_result 之后，getMessageText 按"首个 text block"
      // 取值，合成 prompt 仍应被正确识别。
      const req = {
        mainAgent: true,
        body: {
          system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI.' }],
          tools: [{ name: 'Edit' }],
          messages: [
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 'toolu_x', content: 'stdout' },
                { type: 'text', text: 'Summarize this coding session in a paragraph.' },
              ],
            },
          ],
        },
      };
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Summary' });
    });

    it('matches with leading whitespace (trim before pattern match)', () => {
      // 某些生成路径可能带前导空白，text.trim() 要在正则匹配前起作用。
      const req = makeMainReq('   \n  The user stepped away and is coming back. Recap in under 40 words.');
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Recap' });
    });
  });

  describe('formatRequestTag', () => {
    it('formats Synthetic:Recap', () => {
      assert.equal(formatRequestTag('Synthetic', 'Recap'), 'Synthetic:Recap');
    });
    it('falls back to type name when subType missing', () => {
      assert.equal(formatRequestTag('Synthetic', null), 'Synthetic');
    });
  });

  // isSystemText 级联：ChatView 字符串分支（ChatView.jsx:936）/ Mobile / AppHeader / DetailPanel /
  // teamModalBuilder 共用。1.6.199 只把 Synthetic 挂在 RequestList，ChatView 对话流仍把内部 recap
  // 渲染为用户气泡——本组用例守护"所有 isSystemText 消费方都同步隐藏合成 prompt"的约束。
  describe('isSystemText recognizes synthetic prompts', () => {
    it('Recap prompt → isSystemText=true (hidden from chat bubble)', () => {
      assert.equal(
        isSystemText('The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown.'),
        true
      );
    });

    it('Title prompt → isSystemText=true', () => {
      assert.equal(
        isSystemText('Based on the above conversation, generate a short title (under 8 words).'),
        true
      );
    });

    it('Compact prompt → isSystemText=true', () => {
      assert.equal(
        isSystemText('Your task is to create a detailed summary of the conversation so far.'),
        true
      );
    });

    it('Topic prompt → isSystemText=true', () => {
      assert.equal(
        isSystemText('Analyze if this message indicates a new topic.'),
        true
      );
    });

    it('Summary prompt → isSystemText=true', () => {
      assert.equal(
        isSystemText('Summarize this coding session in a paragraph.'),
        true
      );
    });

    it('real user input quoting recap phrase (not at start) → isSystemText=false', () => {
      // 与 Synthetic classifier 同款 ^ 锚定保护，避免用户引用原文被误过滤
      assert.equal(
        isSystemText('I think you hallucinated — the field {content:"The user stepped away and is coming back. Recap in under 40 words..."} is system-generated?'),
        false
      );
    });

    it('normal user text → isSystemText=false', () => {
      assert.equal(isSystemText('帮我看看这个 bug'), false);
      assert.equal(isSystemText('please refactor the auth middleware'), false);
    });

    it('leading whitespace before Recap → still detected as system', () => {
      assert.equal(
        isSystemText('   \n  The user stepped away and is coming back. Recap in under 40 words.'),
        true
      );
    });

    it('empty / whitespace-only → isSystemText=true (existing behavior)', () => {
      assert.equal(isSystemText(''), true);
      assert.equal(isSystemText('   '), true);
    });

    it('XML-like tag still detected (existing behavior unchanged)', () => {
      assert.equal(isSystemText('<system-reminder>...</system-reminder>'), true);
    });
  });
});
