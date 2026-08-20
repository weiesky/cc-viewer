/**
 * Synthetic 分类归真版：动态 import 真实 requestType.js / contentFilter.js，不再内联拷贝。
 *
 * Core modules (@ccv/core, packages/core/src/) are plain ESM — all internal imports
 * carry .js extensions and there are no asset imports, so node --test loads them
 * directly. The dynamic import() below is a style choice, not a shim requirement.
 * classifyRequest / isSystemText 行为均驱动真实模块。
 *
 * 真实模块 = 事实源。与旧内联简化副本的唯一行为差异：
 *   - 旧内联 classifyRequest 对「非 MainAgent 且未命中合成」返回 { type:'Other' }；
 *     真实 requestType.js 走完整 SubAgent 子类型判定，对 file-search-specialist 返回
 *     { type:'SubAgent', subType:'Search' }。原断言意图是「SubAgent 不被升级为 Synthetic」，
 *     归真后改断言真实 type 'SubAgent'（仍守护该意图，且更强）。
 *   - 旧内联 isMainAgent 不覆盖新架构检测；真实模块覆盖。本套件 MainAgent fixture 均带
 *     mainAgent:true 走早期 return，结论与真实模块一致。
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let classifyRequest, formatRequestTag, isSystemText;
before(async () => {
  const rt = await import('../src/requestType.js');
  const cf = await import('../src/contentFilter.js');
  classifyRequest = rt.classifyRequest;
  formatRequestTag = rt.formatRequestTag;
  isSystemText = cf.isSystemText;
});

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
      // 真实 requestType.js 进一步判定子类型为 SubAgent:Search（file search specialist）。
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
      const r = classifyRequest(req);
      assert.notEqual(r.type, 'Synthetic');
      assert.deepEqual(r, { type: 'SubAgent', subType: 'Search' });
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

    // 用户拒绝 tool / 中断 Claude 时 CLI 注入的占位 user message —— 多个历史变体都要拦
    it('"[Request interrupted by user for tool use]" → isSystemText=true', () => {
      assert.equal(isSystemText('[Request interrupted by user for tool use]'), true);
    });

    it('"[Request interrupted by user]" (older variant) → isSystemText=true', () => {
      assert.equal(isSystemText('[Request interrupted by user]'), true);
    });

    it('"[Request interrupted...]" (older variant) → isSystemText=true', () => {
      assert.equal(isSystemText('[Request interrupted...]'), true);
    });

    it('user quoting "[Request interrupted..." mid-sentence → isSystemText=false', () => {
      assert.equal(
        isSystemText('Why did claude inject "[Request interrupted by user]" into the log?'),
        false
      );
    });
  });
});
