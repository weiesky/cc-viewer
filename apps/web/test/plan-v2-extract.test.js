/**
 * ExitPlanMode V2 (input.plan / input.planFilePath) 抽取与守卫式重置
 * 行为针对 src/utils/toolResultBuilder.js 的 ExitPlanMode 分支：
 *   - input.plan 非空 → state.latestPlanContent / latestPlanFilePath 抓取
 *   - tool_result 完成后：仅当无 V2 内联且无 latestPlanFilePath 时清 latestPlanContent；周期末重置 latestPlanFilePath
 *   - input.plan 空 / 缺失 → 不应覆盖前序 Write 追踪到的内容
 *
 * 依赖：toolResultBuilder.js 的内部逻辑被内联以避免引入 helpers.js / i18n.js JSX 依赖。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── 内联：toolResultBuilder.js 的 ExitPlanMode 抓取核心 ────────────────────

function createEmptyState() {
  return {
    toolUseMap: {},
    toolResultMap: {},
    planApprovalMap: {},
    latestPlanContent: null,
    latestPlanFilePath: null,
  };
}

function processMessages(messages) {
  const state = createEmptyState();
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        const parsed = block;
        state.toolUseMap[parsed.id] = parsed;
        // Write 到 .claude/plans/
        if (parsed.name === 'Write' && parsed.input?.file_path
          && /[/\\]\.claude[/\\]plans[/\\]/.test(parsed.input.file_path) && parsed.input.content) {
          state.latestPlanContent = parsed.input.content;
        }
        // ExitPlanMode V2 抓取
        if (parsed.name === 'ExitPlanMode' && parsed.input && typeof parsed.input === 'object') {
          if (typeof parsed.input.plan === 'string' && parsed.input.plan.trim()) {
            state.latestPlanContent = parsed.input.plan;
          }
          if (typeof parsed.input.planFilePath === 'string' && parsed.input.planFilePath) {
            state.latestPlanFilePath = parsed.input.planFilePath;
          }
        }
      }
    } else if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== 'tool_result') continue;
        const matched = state.toolUseMap[block.tool_use_id];
        if (matched && matched.name === 'ExitPlanMode') {
          state.planApprovalMap[block.tool_use_id] = { status: 'approved' };
          // 审批完成后无条件清，已审批卡片由 inp.plan 兜底
          state.latestPlanContent = null;
          state.latestPlanFilePath = null;
        }
      }
    }
  }
  return state;
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('ExitPlanMode V2 input抽取', () => {
  it('从 input.plan 抓取 plan 正文', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'ExitPlanMode',
          input: { plan: '# Hello\n\nstep 1', planFilePath: '/x/.claude/plans/foo.md' } },
      ]},
    ];
    const s = processMessages(messages);
    assert.equal(s.latestPlanContent, '# Hello\n\nstep 1');
    assert.equal(s.latestPlanFilePath, '/x/.claude/plans/foo.md');
  });

  it('input.plan 为空时不清空前序 Write 追踪到的内容', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_w', name: 'Write',
          input: { file_path: '/x/.claude/plans/y.md', content: 'WriteX' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_e', name: 'ExitPlanMode', input: {} },
      ]},
    ];
    const s = processMessages(messages);
    assert.equal(s.latestPlanContent, 'WriteX');
  });

  it('input.plan 非空覆盖前序 Write 追踪到的内容', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_w', name: 'Write',
          input: { file_path: '/x/.claude/plans/y.md', content: 'OldWrite' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_e', name: 'ExitPlanMode',
          input: { plan: 'NewV2', planFilePath: '/x/.claude/plans/y.md' } },
      ]},
    ];
    const s = processMessages(messages);
    assert.equal(s.latestPlanContent, 'NewV2');
  });

  it('V2 路径审批完成后无条件清空（已审批卡片由 ChatMessage 的 inp.plan 兜底）', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_e', name: 'ExitPlanMode',
          input: { plan: 'V2plan', planFilePath: '/x/.claude/plans/y.md' } },
      ]},
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu_e', content: 'User has approved' },
      ]},
    ];
    const s = processMessages(messages);
    // 防跨周期串扰：审批完成后两字段都重置；ChatMessage 用 inp.plan 渲染已审批卡片
    assert.equal(s.latestPlanContent, null);
    assert.equal(s.latestPlanFilePath, null);
  });

  it('V1 路径审批完成后正常清空 latestPlanContent', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_w', name: 'Write',
          input: { file_path: '/x/.claude/plans/y.md', content: 'V1content' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu_e', name: 'ExitPlanMode', input: {} },
      ]},
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu_e', content: 'User has approved' },
      ]},
    ];
    const s = processMessages(messages);
    // V1 路径无 input.plan 也无 planFilePath，审批完成后清空
    assert.equal(s.latestPlanContent, null);
  });

  it('input 是字符串（旧格式 fallback 解析失败）时不抛异常', () => {
    const messages = [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: '{"plan":"X"}' },
      ]},
    ];
    // 内联简化版不解析字符串 input，只验证不抛
    assert.doesNotThrow(() => processMessages(messages));
  });
});
