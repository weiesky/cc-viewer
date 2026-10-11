/**
 * Unit tests for src/utils/contextUsageView.js — the pure view-model builders behind the
 * SDK-mode "Context usage" panel. Covers normalization (color / percent), the composition
 * bar, the 2-D grid flatten (incl. truncation), detail sections (optional fields), and the
 * apiUsage footer (null-able).
 *
 * src/utils is Vite-style (extensionless relative imports), so the shims loader registers
 * first, then the target is dynamically imported.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let normalizeColor, normalizePercent, buildUsageBar, gridToRows, buildDetailSections, buildApiUsage, nextPanelState;

before(async () => {
  const m = await import('../src/utils/contextUsageView.js');
  ({ normalizeColor, normalizePercent, buildUsageBar, gridToRows, buildDetailSections, buildApiUsage, nextPanelState } = m);
});

const FULL = {
  categories: [
    { name: 'System prompt', tokens: 3000, color: '#5470c6' },
    { name: 'Tools', tokens: 1000, color: '#91cc75', isDeferred: true },
    { name: 'Messages', tokens: 4000, color: 'not-a-color' },
  ],
  totalTokens: 8000, maxTokens: 200000, rawMaxTokens: 200000,
  percentage: 4, gridRows: [], model: 'claude-opus-4-test',
  memoryFiles: [{ path: '/a/CLAUDE.md', type: 'project', tokens: 500 }],
  mcpTools: [{ name: 'web_search', serverName: 'tavily', tokens: 200, isLoaded: true }],
  agents: [{ agentType: 'Explore', source: 'built-in', tokens: 800 }],
  isAutoCompactEnabled: true, autoCompactThreshold: 180000,
  apiUsage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 },
};

describe('contextUsageView — normalizeColor', () => {
  it('合法 CSS 色直用;非法色回落调色板(按 index 稳定)', () => {
    assert.equal(normalizeColor('#abc', 0), '#abc');
    assert.equal(normalizeColor('#A1B2C3D4', 0), '#A1B2C3D4');
    assert.equal(normalizeColor('rgb(1,2,3)', 0), 'rgb(1,2,3)');
    assert.equal(normalizeColor('red', 0), 'red');
    const a = normalizeColor('not a color!!', 0);
    const b = normalizeColor(undefined, 0);
    assert.equal(a, b, 'same index → same fallback slot');
    assert.notEqual(normalizeColor(undefined, 0), normalizeColor(undefined, 1), 'different index → different slot');
  });
});

describe('contextUsageView — normalizePercent', () => {
  it('0-1 量纲 ×100;0-100 直用;超界钳到 0-100;非数字归 0', () => {
    assert.equal(normalizePercent(0.6), 60);
    assert.equal(normalizePercent(4), 4);
    assert.equal(normalizePercent(150), 100);
    assert.equal(normalizePercent(-5), 0);
    assert.equal(normalizePercent(NaN), 0);
    assert.equal(normalizePercent('x'), 0);
    assert.equal(normalizePercent(undefined), 0);
  });
});

describe('contextUsageView — buildUsageBar', () => {
  it('构成条:分段 pct 按 maxTokens 归一,percentage 归一,阈值保留', () => {
    const bar = buildUsageBar(FULL);
    assert.equal(bar.segments.length, 3);
    assert.equal(bar.segments[0].pct, 1.5); // 3000/200000
    assert.equal(bar.segments[1].isDeferred, true);
    assert.equal(bar.percentage, 4);
    assert.equal(bar.autoCompactThreshold, 180000);
    assert.equal(bar.isAutoCompactEnabled, true);
    assert.equal(bar.rawMaxTokens, 200000);
  });

  it('兜底:空/缺 categories / 缺 maxTokens / null 输入不崩', () => {
    assert.equal(buildUsageBar(null), null);
    assert.equal(buildUsageBar(undefined), null);
    const empty = buildUsageBar({});
    assert.equal(empty.segments.length, 0);
    assert.equal(empty.percentage, 0);
    const noMax = buildUsageBar({ categories: [{ name: 'a', tokens: 10 }], totalTokens: 10 });
    assert.equal(noMax.segments[0].pct, 0, 'no maxTokens → pct 0 (no div-by-zero)');
  });
});

describe('contextUsageView — gridToRows', () => {
  it('二维网格拍平成行;isFilled/squareFullness/百分比归一', () => {
    const usage = {
      gridRows: [
        [
          { color: '#fff', isFilled: true, categoryName: 'Sys', tokens: 100, percentage: 50, squareFullness: 1 },
          { color: '#000', isFilled: false, categoryName: 'Free', tokens: 0, percentage: 0, squareFullness: 0.5 },
        ],
      ],
    };
    const { rows, truncated, cellCount } = gridToRows(usage);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].length, 2);
    assert.equal(rows[0][0].isFilled, true);
    assert.equal(rows[0][1].isFilled, false);
    assert.equal(rows[0][1].fullness, 0.5);
    assert.equal(truncated, false);
    assert.equal(cellCount, 2);
  });

  it('空/畸形 gridRows → 空;超 MAX_GRID_CELLS 截断+truncated', () => {
    assert.deepEqual(gridToRows({}).rows, []);
    assert.deepEqual(gridToRows(null).rows, []);
    const big = { gridRows: [Array.from({ length: 5000 }, () => ({ color: '#fff', tokens: 1 }))] };
    const r = gridToRows(big);
    assert.equal(r.truncated, true);
    assert.ok(r.cellCount <= 4000);
  });
});

describe('contextUsageView — buildDetailSections', () => {
  it('非空节按序返回;缺 optional 字段不崩', () => {
    const sections = buildDetailSections(FULL);
    const keys = sections.map((s) => s.key);
    assert.ok(keys.includes('memoryFiles'));
    assert.ok(keys.includes('mcpTools'));
    assert.ok(keys.includes('agents'));
    assert.deepEqual(buildDetailSections({}), []);
    assert.deepEqual(buildDetailSections(null), []);
  });

  it('skills/slashCommands/messageBreakdown 汇总节', () => {
    const usage = {
      skills: { totalSkills: 5, includedSkills: 3, tokens: 200, skillFrontmatter: [{ name: 'pdf', source: 'plugin', tokens: 100 }] },
      slashCommands: { totalCommands: 20, includedCommands: 12, tokens: 300 },
      messageBreakdown: { toolCallTokens: 1, toolResultTokens: 2, attachmentTokens: 3, assistantMessageTokens: 4, userMessageTokens: 5, redirectedContextTokens: 6, unattributedTokens: 7, toolCallsByType: [{ name: 'Bash', callTokens: 1, resultTokens: 2 }], attachmentsByType: [] },
    };
    const keys = buildDetailSections(usage).map((s) => s.key);
    assert.ok(keys.includes('skills'));
    assert.ok(keys.includes('slashCommands'));
    assert.ok(keys.includes('messageBreakdown'));
  });
});

describe('contextUsageView — buildApiUsage', () => {
  it('apiUsage 齐全映射;null/缺失 → null', () => {
    assert.deepEqual(buildApiUsage(FULL), { input: 100, output: 50, cacheCreate: 10, cacheRead: 5 });
    assert.equal(buildApiUsage({}), null);
    assert.equal(buildApiUsage({ apiUsage: null }), null);
    assert.equal(buildApiUsage(null), null);
  });
});

describe('contextUsageView — nextPanelState 面板状态机', () => {
  const SNAP = (ts) => ({ type: 'sdk-context-usage', ts, trigger: 'turn-end', usage: { totalTokens: 10 } });

  it('WS 帧 → ready;清帧(usage:null)→ inactive', () => {
    const s0 = { detail: null, status: 'loading' };
    const s1 = nextPanelState(s0, { kind: 'ws', frame: SNAP(100) });
    assert.equal(s1.status, 'ready');
    assert.equal(s1.detail.ts, 100);
    const s2 = nextPanelState(s1, { kind: 'ws', frame: { type: 'sdk-context-usage', ts: 200, usage: null } });
    assert.equal(s2.status, 'inactive');
    assert.equal(s2.detail, null);
  });

  it('HTTP inactive → inactive(区别于 error)', () => {
    const s = nextPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: false, reason: 'session-inactive' } });
    assert.equal(s.status, 'inactive');
  });

  it('HTTP 500/非 ok → error;http-error → error', () => {
    const s1 = nextPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: false, reason: 'control-failed' } });
    assert.equal(s1.status, 'error');
    const s2 = nextPanelState({ detail: null, status: 'loading' }, { kind: 'http-error' });
    assert.equal(s2.status, 'error');
  });

  it('HTTP ok → ready;snapshot.usage 透传', () => {
    const s = nextPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: true, snapshot: SNAP(50) } });
    assert.equal(s.status, 'ready');
    assert.deepEqual(s.detail.usage, { totalTokens: 10 });
  });

  it('ts 单调守卫:落后帧被拒(WS 与 HTTP 两路)', () => {
    const ready = { detail: { usage: { totalTokens: 10 }, ts: 100, trigger: 'turn-end' }, status: 'ready' };
    const staleWs = nextPanelState(ready, { kind: 'ws', frame: SNAP(50) });
    assert.equal(staleWs.detail.ts, 100, 'older WS frame rejected');
    const staleHttp = nextPanelState(ready, { kind: 'http', body: { ok: true, snapshot: SNAP(80) } });
    assert.equal(staleHttp.detail.ts, 100, 'older HTTP snapshot rejected');
    const newer = nextPanelState(ready, { kind: 'ws', frame: SNAP(150) });
    assert.equal(newer.detail.ts, 150, 'newer frame advances');
  });
});
