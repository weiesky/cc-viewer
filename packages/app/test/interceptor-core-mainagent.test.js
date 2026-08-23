/**
 * isMainAgentRequest（流式起始判据）回归 + 与 isMainAgentEntry（最终重建判据）一致性守卫。
 *
 * 背景:SSE 流式开关 `liveStreamEnabled = _livePort && requestEntry.mainAgent && !_isTeammate`
 * (server/interceptor.js)。同进程 Agent/Task 队友不带 --agent-name(_isTeammate=false),其请求
 * 又继承「You are Claude Code」+ Edit/Bash/Task,曾因 isMainAgentRequest 缺 TEAMMATE_SYSTEM_RE
 * 检测被误判为 mainAgent → 流式期 thinking 污染主「最新回复」overlay;而最终 isMainAgentEntry 有
 * 该检测,故最终显示正常。本测试锁住修复并互校两处服务端判据(isMainAgentRequest ↔
 * isMainAgentEntry)防漂移;前端 contentFilter 那份由 test/content-filter-unit.test.js 覆盖。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMainAgentRequest } from '../server/lib/interceptor-core.js';
import { isMainAgentEntry } from '../server/lib/kv-cache-analyzer.js';

const MAIN_TOOLS = [
  { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
  { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' },
];

// 标准主代理请求体(继承 "You are Claude Code" + Edit/Bash/Task,过轻量启发式)
const mainBody = (sysText, tools = MAIN_TOOLS, messages = [{ role: 'user', content: 'hi' }]) => ({
  system: [{ type: 'text', text: sysText }],
  tools,
  messages,
});

const CLAUDE_CODE = 'You are Claude Code, Anthropic\'s official CLI for Claude.';

describe('isMainAgentRequest —— 同进程队友排除(核心修复)', () => {
  it('"running as an agent in a team" 队友 → false(改前为 true)', () => {
    const body = mainBody(`${CLAUDE_CODE}\n\nIMPORTANT: You are running as an agent in a team.`);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('"Agent Teammate Communication" 队友 → false', () => {
    const body = mainBody(`${CLAUDE_CODE}\n\n# Agent Teammate Communication\n...`);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('队友标记大小写不敏感 → false', () => {
    const body = mainBody(`${CLAUDE_CODE}\nRUNNING AS AN AGENT IN A TEAM`);
    assert.equal(isMainAgentRequest(body), false);
  });
});

describe('isMainAgentRequest —— 不误伤真·主代理', () => {
  it('标准主代理(无队友短语)→ true', () => {
    assert.equal(isMainAgentRequest(mainBody(CLAUDE_CODE)), true);
  });

  it('deferred-tools 架构主代理(ToolSearch + <available-deferred-tools>)→ true', () => {
    const body = {
      system: [{ type: 'text', text: CLAUDE_CODE }],
      tools: [{ name: 'ToolSearch' }, { name: 'Read' }],
      messages: [{ role: 'user', content: 'context <available-deferred-tools> Edit, Bash' }],
    };
    assert.equal(isMainAgentRequest(body), true);
  });
});

describe('isMainAgentRequest —— 既有行为防回归', () => {
  it('cc_is_subagent=true → false', () => {
    const body = mainBody(`cc_is_subagent=true;\n${CLAUDE_CODE}`);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('cc_is_subagent=truex(词界锚定)不被 billing 排除 → 仍按主代理启发式 true', () => {
    const body = mainBody(`cc_is_subagent=truex;\n${CLAUDE_CODE}`);
    assert.equal(isMainAgentRequest(body), true);
  });

  it('SDK 模式主会话("built on Anthropic\'s Claude Agent SDK" + 全工具含 Task)→ true', () => {
    // SDK 模式(ccv -SDK)主会话 base prompt 不含 "You are Claude Code",而是 SDK 的
    // "You are a Claude agent, built on Anthropic's Claude Agent SDK."。带完整主工具集(含 Task)。
    const body = mainBody('You are a Claude agent, built on Anthropic\'s Claude Agent SDK.');
    assert.equal(isMainAgentRequest(body), true);
  });

  it('SDK 子代理(SDK base prompt 但缺 Task/Agent 生成工具)→ false', () => {
    // 真 SDK 子代理与主会话同用 SDK base prompt,但没有 Agent/Task 生成工具 → 工具启发式挡住。
    const subTools = [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }];
    const body = mainBody('You are a Claude agent, built on Anthropic\'s Claude Agent SDK.', subTools);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('SDK base prompt + cc_is_subagent=true → false(billing 排除优先)', () => {
    const body = mainBody(`cc_is_subagent=true;\nYou are a Claude agent, built on Anthropic's Claude Agent SDK.`);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('native teammate("You are a Claude agent" 无 SDK 子句)→ false', () => {
    const body = mainBody('You are a Claude agent.');
    assert.equal(isMainAgentRequest(body), false);
  });

  it('子代理 specialist 系统提示 → false', () => {
    const body = mainBody(`${CLAUDE_CODE}\nYou are a file search specialist.`);
    assert.equal(isMainAgentRequest(body), false);
  });

  it('无 system / 无 tools → false', () => {
    assert.equal(isMainAgentRequest({ tools: MAIN_TOOLS }), false);
    assert.equal(isMainAgentRequest({ system: [{ type: 'text', text: CLAUDE_CODE }] }), false);
  });
});

describe('一致性守卫: isMainAgentRequest(body) === isMainAgentEntry({ body })', () => {
  // 三处判据(interceptor-core / kv-cache-analyzer / contentFilter)必须同步;此处互校两个服务端实现
  // (前端 contentFilter 用无扩展名 Vite import,需 _shims loader,由 content-filter-unit.test.js 单测覆盖)。
  // 传 { body } 不带 mainAgent 旗标,让 isMainAgentEntry 走与 isMainAgentRequest 同款启发式。
  const cases = {
    '标准主代理': mainBody(CLAUDE_CODE),
    '队友 running-as-agent': mainBody(`${CLAUDE_CODE}\nYou are running as an agent in a team`),
    '队友 teammate-comm': mainBody(`${CLAUDE_CODE}\nAgent Teammate Communication`),
    'cc_is_subagent=true': mainBody(`cc_is_subagent=true;\n${CLAUDE_CODE}`),
    'cc_is_subagent=truex': mainBody(`cc_is_subagent=truex;\n${CLAUDE_CODE}`),
    'native teammate': mainBody('You are a Claude agent.'),
    'SDK 主会话': mainBody('You are a Claude agent, built on Anthropic\'s Claude Agent SDK.'),
    'SDK 子代理(无 Task/Agent)': mainBody('You are a Claude agent, built on Anthropic\'s Claude Agent SDK.', [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }]),
    'specialist 子代理': mainBody(`${CLAUDE_CODE}\nfile search specialist`),
    '非主代理(无 Claude Code)': mainBody('Some other assistant prompt'),
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`一致: ${name}`, () => {
      assert.equal(isMainAgentRequest(body), isMainAgentEntry({ body }), name);
    });
  }
});
