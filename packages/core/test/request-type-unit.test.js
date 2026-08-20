import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// 覆盖目标: @ccv/core/requestType (packages/core/src/requestType.js, 真实模块 — plain ESM,
//   内部 import './contentFilter.js' 带扩展名, 无需 vite-loader shim)
//   导出: classifyRequest(req, nextReq) / formatRequestTag(type, subType) /
//         formatTeammateLabel(name, model)
// 此处用【动态 import】加载真实源文件 (而非内联副本), 直接驱动真实的
// contentFilter / teammateDetector / clearCheckpoint 依赖链, 测的是真实行为。
//
// classifyRequest 内部分支:
//   Teammate (interceptor req.teammate / native SendMessage / proxy system marker /
//             _cachedTeammateName 缓存)
//   -> Synthetic (Recap/Title/Compact/Topic/Summary, 仅 MainAgent)
//   -> MainAgent (含新架构 ToolSearch / >5 工具集 检测)
//   -> Count (isCountTokens / content==='count')
//   -> Count:Quota (max_tokens===1 且 content==='quota')
//   -> Preflight (nextReq 含本条文本) / Plan:Prompt
//   -> SubAgent (Bash/Search/Plan/General/Advisor/WebSearch / Command: / null)
// ============================================================================

let classifyRequest, formatRequestTag, formatTeammateLabel;

before(async () => {
  const mod = await import('../src/requestType.js');
  classifyRequest = mod.classifyRequest;
  formatRequestTag = mod.formatRequestTag;
  formatTeammateLabel = mod.formatTeammateLabel;
});

// ------------------------- fixtures -------------------------

// 一个能通过真实 isMainAgent "v2.1.81+ 轻量" 路径 (tools.length>5 + Edit + Bash + Task) 的工具集
function mainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' },
  ];
}

function mainReq(lastUserText, before = [], overrides = {}) {
  return {
    mainAgent: true,
    timestamp: '2026-06-06T00:00:00Z',
    body: {
      system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI." }],
      tools: mainAgentTools(),
      messages: [...before, { role: 'user', content: lastUserText }],
    },
    ...overrides,
  };
}

// MainAgent without the interceptor mainAgent flag — exercises real detection logic
function mainReqNoFlag(lastUserText, overrides = {}) {
  return {
    timestamp: '2026-06-06T00:00:00Z',
    body: {
      system: "You are Claude Code, Anthropic's official CLI.",
      tools: mainAgentTools(),
      messages: [{ role: 'user', content: lastUserText }],
    },
    ...overrides,
  };
}

// ============================================================================
describe('requestType.classifyRequest — Teammate', () => {
  it('interceptor mode: req.teammate -> Teammate with that subType', () => {
    const req = {
      teammate: 'worker-1',
      body: { system: [{ type: 'text', text: 'sys' }], messages: [{ role: 'user', content: 'hi' }] },
    };
    assert.deepEqual(classifyRequest(req), { type: 'Teammate', subType: 'worker-1' });
  });

  it('proxy mode: "running as an agent in a team" marker -> Teammate, subType from extractTeammateName', () => {
    const req = {
      body: {
        system: [{ type: 'text', text: 'You are running as an agent in a team.' }],
        tools: [{ name: 'SendMessage' }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result', tool_use_id: 'tu_1',
                content: [{ type: 'text', text: JSON.stringify({ routing: { sender: 'researcher' } }) }],
              },
            ],
          },
        ],
      },
    };
    const r = classifyRequest(req);
    assert.equal(r.type, 'Teammate');
    assert.equal(r.subType, 'researcher');
  });

  it('proxy mode with no resolvable name -> Teammate, subType null (and caches null)', () => {
    const req = {
      body: {
        system: [{ type: 'text', text: 'Agent Teammate Communication protocol.' }],
        messages: [{ role: 'user', content: 'work on it' }],
      },
    };
    assert.deepEqual(classifyRequest(req), { type: 'Teammate', subType: null });
    // _cachedTeammateName 已被写为 null; 二次调用走缓存分支, 结果一致
    assert.equal(req._cachedTeammateName, null);
    assert.deepEqual(classifyRequest(req), { type: 'Teammate', subType: null });
  });

  it('native teammate: "You are a Claude agent" + SendMessage tool -> Teammate, name extracted', () => {
    // isTeammate -> isNativeTeammate true -> 注入 req.teammate = extractNativeTeammateName
    const req = {
      body: {
        system: [{ type: 'text', text: "You are a Claude agent, built on Anthropic's Claude Agent SDK." }],
        tools: [{ name: 'SendMessage' }, { name: 'Edit' }],
        messages: [{ role: 'user', content: 'You are CRer2, please review.' }],
      },
    };
    const r = classifyRequest(req);
    assert.equal(r.type, 'Teammate');
    assert.equal(r.subType, 'CRer2');
    assert.equal(req.teammate, 'CRer2'); // 被 isTeammate 注入
  });

  it('"You are a Claude agent" WITHOUT SendMessage is a plain subagent, NOT teammate', () => {
    const req = {
      body: {
        system: [{ type: 'text', text: 'You are a Claude agent for searching files.' }],
        tools: [{ name: 'Read' }, { name: 'Glob' }],
        messages: [{ role: 'user', content: 'find foo' }],
      },
    };
    assert.notEqual(classifyRequest(req).type, 'Teammate');
  });

  it('Teammate beats MainAgent even when mainAgent=true (interceptor marks both)', () => {
    const req = mainReq('do task', [], { teammate: 'lead' });
    assert.equal(req.mainAgent, true);
    assert.equal(classifyRequest(req).type, 'Teammate');
  });
});

// ============================================================================
describe('requestType.classifyRequest — Synthetic', () => {
  const cases = [
    ['Recap', 'The user stepped away and is coming back. Recap in under 40 words, no markdown.'],
    ['Title', 'Based on the above conversation, generate a short title (under 8 words).'],
    ['Title', 'Please write a concise title for this conversation.'],
    ['Compact', 'Your task is to create a detailed summary of the conversation so far.'],
    ['Compact', 'This session is being continued from a previous conversation that ran out of context.'],
    ['Topic', 'Analyze if this message indicates a new topic of work.'],
    ['Summary', 'Summarize this coding session in a paragraph.'],
  ];
  for (const [subType, text] of cases) {
    it(`detects ${subType} synthetic prompt`, () => {
      const req = mainReq(text, [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }]);
      assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType });
    });
  }

  it('matches synthetic prompt when last user content is array-form', () => {
    const req = mainReq([{ type: 'text', text: 'Summarize this coding session now.' }]);
    assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Summary' });
  });

  it('mid-message synthetic phrase is NOT synthetic (^ anchor) -> MainAgent', () => {
    const req = mainReq('FYI the log line said: The user stepped away and is coming back. Recap...');
    assert.equal(classifyRequest(req).type, 'MainAgent');
  });

  it('leading whitespace trimmed before matching', () => {
    const req = mainReq('   \n Summarize this coding session.');
    assert.deepEqual(classifyRequest(req), { type: 'Synthetic', subType: 'Summary' });
  });

  it('last message is assistant -> not Synthetic -> MainAgent', () => {
    const req = {
      mainAgent: true,
      body: {
        system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI." }],
        tools: mainAgentTools(),
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: [{ type: 'text', text: 'Summarize this coding session.' }] },
        ],
      },
    };
    assert.equal(classifyRequest(req).type, 'MainAgent');
  });

  it('empty messages -> not Synthetic -> MainAgent', () => {
    const req = { mainAgent: true, body: {
      system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI." }],
      tools: mainAgentTools(), messages: [] } };
    assert.equal(classifyRequest(req).type, 'MainAgent');
  });

  it('non-MainAgent matching synthetic text is NOT promoted to Synthetic', () => {
    // SubAgent system: getSyntheticSubType -> isMainAgent false -> null
    const req = {
      body: {
        system: 'You are a file search specialist.',
        tools: [{ name: 'Read' }],
        messages: [{ role: 'user', content: 'Summarize this coding session.' }],
      },
    };
    assert.notEqual(classifyRequest(req).type, 'Synthetic');
  });
});

// ============================================================================
describe('requestType.classifyRequest — MainAgent detection', () => {
  it('mainAgent flag + Claude Code system -> MainAgent', () => {
    assert.deepEqual(classifyRequest(mainReq('hello there')), { type: 'MainAgent', subType: null });
  });

  it('no flag, real detection via >5 tools (Edit+Bash+Task) -> MainAgent', () => {
    assert.deepEqual(classifyRequest(mainReqNoFlag('hello')), { type: 'MainAgent', subType: null });
  });

  it('new-architecture path: ToolSearch + <available-deferred-tools> first msg -> MainAgent', () => {
    const req = {
      body: {
        system: [{ type: 'text', text: 'You are Claude Code, the CLI.' }],
        tools: [{ name: 'ToolSearch' }],
        messages: [{ role: 'user', content: '<available-deferred-tools>Edit, Bash</available-deferred-tools> go' }],
      },
    };
    assert.equal(classifyRequest(req).type, 'MainAgent');
  });

  it('mainAgent flag but system says "security monitor" -> NOT MainAgent (SUBAGENT_SYSTEM_RE excludes)', () => {
    const req = {
      mainAgent: true,
      body: {
        system: 'You are Claude Code. You are a security monitor for autonomous AI coding agents.',
        tools: mainAgentTools(),
        messages: [{ role: 'user', content: 'check' }],
      },
    };
    const r = classifyRequest(req);
    // 不是 MainAgent; 落入 SubAgent:Advisor
    assert.equal(r.type, 'SubAgent');
    assert.equal(r.subType, 'Advisor');
  });
});

// ============================================================================
describe('requestType.classifyRequest — Count / Quota', () => {
  it('isCountTokens flag -> Count', () => {
    const req = { isCountTokens: true, body: { messages: [{ role: 'user', content: 'whatever' }] } };
    assert.deepEqual(classifyRequest(req), { type: 'Count', subType: null });
  });

  it('single user message content "count" -> Count', () => {
    const req = { body: { messages: [{ role: 'user', content: 'count' }] } };
    assert.deepEqual(classifyRequest(req), { type: 'Count', subType: null });
  });

  it('content "count tokens" (not exact) -> not Count', () => {
    const req = { body: { messages: [{ role: 'user', content: 'count tokens' }] } };
    assert.notEqual(classifyRequest(req).type, 'Count');
  });

  it('quota check (max_tokens 1, no system, no tools, single "quota") -> Count:Quota', () => {
    const req = { body: { max_tokens: 1, messages: [{ role: 'user', content: 'quota' }] } };
    assert.deepEqual(classifyRequest(req), { type: 'Count', subType: 'Quota' });
  });

  it('quota with system present -> not Quota', () => {
    const req = { body: { max_tokens: 1, system: 'x', messages: [{ role: 'user', content: 'quota' }] } };
    assert.notEqual(classifyRequest(req).subType, 'Quota');
  });

  it('quota with non-empty tools -> not Quota', () => {
    const req = { body: { max_tokens: 1, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'quota' }] } };
    assert.notEqual(classifyRequest(req).subType, 'Quota');
  });

  it('quota without max_tokens===1 -> not Quota', () => {
    const req = { body: { max_tokens: 4, messages: [{ role: 'user', content: 'quota' }] } };
    assert.notEqual(classifyRequest(req).subType, 'Quota');
  });

  it('quota with multiple messages -> not Quota', () => {
    const req = { body: { max_tokens: 1, messages: [
      { role: 'user', content: 'quota' }, { role: 'user', content: 'quota' }] } };
    assert.notEqual(classifyRequest(req).subType, 'Quota');
  });
});

// ============================================================================
describe('requestType.classifyRequest — Preflight / Plan:Prompt', () => {
  function preReq(text, sysExtra = '') {
    return { body: { system: `You are Claude Code, official CLI.${sysExtra}`, messages: [{ role: 'user', content: text }] } };
  }
  function nextWith(text) {
    return { body: { messages: [{ role: 'user', content: text }] } };
  }

  it('all conditions + next req contains text -> Preflight', () => {
    const t = 'Please implement the feature described above precisely.';
    assert.deepEqual(classifyRequest(preReq(t), nextWith(t + ' more')), { type: 'Preflight', subType: null });
  });

  it('matches on first 80 chars against next req array content', () => {
    const t = 'X'.repeat(120);
    const next = { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'X'.repeat(120) + ' tail' }] }] } };
    assert.equal(classifyRequest(preReq(t), next).type, 'Preflight');
  });

  it('"Implement the following plan:" prefix -> Plan:Prompt', () => {
    const t = 'Implement the following plan:\n1. step';
    assert.deepEqual(classifyRequest(preReq(t), nextWith(t + ' ctx')), { type: 'Plan', subType: 'Prompt' });
  });

  it('case-insensitive plan prefix', () => {
    const t = 'implement the following plan:\nstep 1';
    assert.deepEqual(classifyRequest(preReq(t), nextWith(t)), { type: 'Plan', subType: 'Prompt' });
  });

  it('no nextReq -> not Preflight (falls through to SubAgent)', () => {
    const r = classifyRequest(preReq('Do something unique'), null);
    assert.equal(r.type, 'SubAgent');
  });

  it('nextReq missing the text -> not Preflight', () => {
    const r = classifyRequest(preReq('totally unique sentence here'), nextWith('unrelated content'));
    assert.equal(r.type, 'SubAgent');
  });

  it('non-empty tools disqualifies Preflight', () => {
    const req = preReq('do it');
    req.body.tools = [{ name: 'Bash' }];
    assert.notEqual(classifyRequest(req, nextWith('do it')).type, 'Preflight');
  });

  it('system lacking "Claude Code" disqualifies Preflight', () => {
    const req = { body: { system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'do it' }] } };
    assert.notEqual(classifyRequest(req, nextWith('do it')).type, 'Preflight');
  });

  it('"<policy_spec>" prefix disqualifies Preflight', () => {
    const req = preReq('<policy_spec>rules</policy_spec>');
    assert.notEqual(classifyRequest(req, nextWith('<policy_spec>rules</policy_spec>')).type, 'Preflight');
  });

  it('system "process Bash commands" disqualifies Preflight', () => {
    const req = preReq('run this', ' You process Bash commands.');
    assert.notEqual(classifyRequest(req, nextWith('run this')).type, 'Preflight');
  });

  it('next message with non-string/non-array content -> .some() returns false (not Preflight)', () => {
    // 覆盖 nextMsgs.some 回调里 content 既非 string 也非 array 的兜底 return false 分支。
    const req = preReq('unique sentinel text here');
    const next = { body: { messages: [{ role: 'user', content: { weird: true } }] } };
    assert.notEqual(classifyRequest(req, next).type, 'Preflight');
  });
});

// ============================================================================
describe('requestType.classifyRequest — SubAgent subTypes', () => {
  function sub(system, messages) {
    return { body: { system, messages: messages || [{ role: 'user', content: 'go' }] } };
  }
  const map = [
    ['Extract any file paths from the output', 'Bash'],
    ['You process Bash commands for the agent', 'Bash'],
    ['You are a command execution specialist.', 'Bash'],
    ['You are a file search specialist.', 'Search'],
    ['You are a planning specialist.', 'Plan'],
    ['You are a general-purpose agent.', 'General'],
    ['You are a security monitor for autonomous AI coding agents.', 'Advisor'],
    ['You are an assistant for performing a web search tool use.', 'WebSearch'],
  ];
  for (const [system, expected] of map) {
    it(`system "${system.slice(0, 28)}..." -> SubAgent:${expected}`, () => {
      assert.deepEqual(classifyRequest(sub(system)), { type: 'SubAgent', subType: expected });
    });
  }

  it('last user "Command:" message -> SubAgent:Bash (no system match)', () => {
    const req = sub('Generic system text', [
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'Command: ls -la' },
    ]);
    assert.deepEqual(classifyRequest(req), { type: 'SubAgent', subType: 'Bash' });
  });

  it('no match anywhere -> SubAgent:null', () => {
    assert.deepEqual(classifyRequest(sub('You are a generic helper.')), { type: 'SubAgent', subType: null });
  });

  it('system pattern wins over message "Command:" scan', () => {
    const req = sub('You are a file search specialist.', [{ role: 'user', content: 'Command: find .' }]);
    assert.deepEqual(classifyRequest(req), { type: 'SubAgent', subType: 'Search' });
  });

  it('only the LAST user message is checked for Command: (older Command earlier ignored)', () => {
    const req = sub('Generic', [
      { role: 'user', content: 'Command: earlier' },
      { role: 'assistant', content: 'k' },
      { role: 'user', content: 'just chatting now' },
    ]);
    // loop breaks at first user from the end (no Command:) -> null
    assert.deepEqual(classifyRequest(req), { type: 'SubAgent', subType: null });
  });
});

// ============================================================================
describe('requestType.formatRequestTag', () => {
  it('Teammate with subType', () => assert.equal(formatRequestTag('Teammate', 'w1'), 'Teammate:w1'));
  it('Teammate without subType', () => assert.equal(formatRequestTag('Teammate', null), 'Teammate'));
  it('Plan:Prompt', () => assert.equal(formatRequestTag('Plan', 'Prompt'), 'Plan:Prompt'));
  it('SubAgent:Bash', () => assert.equal(formatRequestTag('SubAgent', 'Bash'), 'SubAgent:Bash'));
  it('Synthetic:Recap', () => assert.equal(formatRequestTag('Synthetic', 'Recap'), 'Synthetic:Recap'));
  it('Count:Quota', () => assert.equal(formatRequestTag('Count', 'Quota'), 'Count:Quota'));
  it('MainAgent (no subType) -> bare type', () => assert.equal(formatRequestTag('MainAgent', null), 'MainAgent'));
  it('Preflight -> bare type', () => assert.equal(formatRequestTag('Preflight', null), 'Preflight'));
  it('Count with null subType -> bare "Count"', () => assert.equal(formatRequestTag('Count', null), 'Count'));
  it('unknown type with subType -> bare type (no prefix rule)', () => assert.equal(formatRequestTag('Weird', 'x'), 'Weird'));
});

// ============================================================================
describe('requestType.formatTeammateLabel', () => {
  it('full claude model -> strips prefix + date suffix', () => {
    assert.equal(formatTeammateLabel('server-dev', 'claude-sonnet-4-6-20250514'), 'Teammate: server-dev(sonnet-4-6)');
  });
  it('null model -> name only', () => {
    assert.equal(formatTeammateLabel('worker-1', null), 'Teammate: worker-1');
  });
  it('undefined model -> name only', () => {
    assert.equal(formatTeammateLabel('worker-1', undefined), 'Teammate: worker-1');
  });
  it('empty model string -> name only', () => {
    assert.equal(formatTeammateLabel('worker-1', ''), 'Teammate: worker-1');
  });
  it('null name + no model -> "Teammate: X"', () => {
    assert.equal(formatTeammateLabel(null, null), 'Teammate: X');
  });
  it('null name + model -> "Teammate: X(short)"', () => {
    assert.equal(formatTeammateLabel(null, 'claude-haiku-4-5-20251001'), 'Teammate: X(haiku-4-5)');
  });
  it('model without claude- prefix', () => {
    assert.equal(formatTeammateLabel('t', 'gpt-4o-20250101'), 'Teammate: t(gpt-4o)');
  });
  it('model without date suffix', () => {
    assert.equal(formatTeammateLabel('t', 'claude-sonnet-4-6'), 'Teammate: t(sonnet-4-6)');
  });
  it('1M descriptor preserved (date regex only strips -8digits at end)', () => {
    assert.equal(formatTeammateLabel('lead', 'claude-opus-4-6[1m]'), 'Teammate: lead(opus-4-6[1m])');
  });
});

// ============================================================================
// 边界: getMessageText 经由 classify 路径间接覆盖到 "无 text block" 分支
// ============================================================================
describe('requestType — getMessageText edge via Preflight path', () => {
  it('user content is array with only tool_result (no text) -> empty text -> not Preflight', () => {
    // getMessageText 返回 '' -> isPreflightRequest 早退 (if !text) -> 落 SubAgent
    const req = { body: {
      system: 'You are Claude Code, official CLI.',
      messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'x' }] }],
    } };
    const r = classifyRequest(req, { body: { messages: [{ role: 'user', content: 'x' }] } });
    assert.equal(r.type, 'SubAgent');
  });
});

// ------------------- _v3Row.typeTag early-exit (server-classified) ----------
describe('classifyRequest _v3Row.typeTag early-exit', () => {
  it('v3-assembled teammate entry returns the server tag verbatim (not SubAgent)', () => {
    const req = {
      _v3Row: { typeTag: { type: 'Teammate', subType: 'frontend-reviewer' } },
      body: { model: 'deepseek-v4-flash', messages: [] },
      // No system/tools — a client re-derivation would mis-tag as SubAgent.
    };
    assert.deepEqual(classifyRequest(req, null), { type: 'Teammate', subType: 'frontend-reviewer' });
  });

  it('v3 tag wins even when the client would derive a different type', () => {
    const req = {
      _v3Row: { typeTag: { type: 'SubAgent', subType: 'Bash' } },
      body: { model: 'm', messages: [] },
    };
    assert.deepEqual(classifyRequest(req, null), { type: 'SubAgent', subType: 'Bash' });
  });

  it('Plan/Preflight tags are NOT excluded (server already applied lookahead)', () => {
    const req = {
      _v3Row: { typeTag: { type: 'Preflight', subType: null } },
      body: { model: 'm', messages: [] },
    };
    assert.deepEqual(classifyRequest(req, null), { type: 'Preflight', subType: null });
  });

  it('legacy entries (no _v3Row) keep the existing classification path', () => {
    const req = {
      teammate: 'frontend-reviewer',
      body: { model: 'm', messages: [] },
    };
    assert.equal(classifyRequest(req, null).type, 'Teammate');
  });
});
