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

let normalizePercent, buildUsageBar, gridToRows, buildDetailSections, buildApiUsage, nextPanelState, resolveCategoryColor;
let mergeSdkContextBar, buildSkillUsageIndex, buildMemoryUsageIndex, memoryTokensForLink;
let sdkContextFrameMatchesView, sdkContextPath;

before(async () => {
  const m = await import('../src/utils/contextUsageView.js');
  ({ normalizePercent, buildUsageBar, gridToRows, buildDetailSections, buildApiUsage, nextPanelState, resolveCategoryColor } = m);
  ({ mergeSdkContextBar, buildSkillUsageIndex, buildMemoryUsageIndex, memoryTokensForLink,
    sdkContextFrameMatchesView, sdkContextPath } = m);
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

describe('contextUsageView — CLI category colors', () => {
  const categories = [
    { name: 'System prompt', tokens: 161, color: 'promptBorder' },
    { name: 'System tools', tokens: 19444, color: 'inactive' },
    { name: 'MCP tools', tokens: 200, color: 'cyan_FOR_SUBAGENTS_ONLY' },
    { name: 'Custom agents', tokens: 54, color: 'permission' },
    { name: 'Memory files', tokens: 1244, color: 'claude' },
    { name: 'Skills', tokens: 2688, color: 'warning' },
    { name: 'Messages', tokens: 152124, color: 'purple_FOR_SUBAGENTS_ONLY' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive' },
    { name: 'Free space', tokens: 824339, color: 'promptBorder' },
  ];

  it('resolves every observed CLI token to a fixed category role', () => {
    const segments = buildUsageBar({ categories, maxTokens: 1000000 }).segments;
    assert.deepEqual(segments.map((s) => s.color), [
      'var(--context-category-system-prompt)',
      'var(--context-category-system-tools)',
      'var(--context-category-mcp-tools)',
      'var(--context-category-custom-agents)',
      'var(--context-category-memory-files)',
      'var(--context-category-skills)',
      'var(--context-category-messages)',
      'var(--context-category-buffer)',
      'var(--context-category-free-space)',
    ]);
    assert.ok(segments.every((s) => s.color.startsWith('var(--context-category-')));
  });

  it('uses category identity before shared tokens and survives omitted categories', () => {
    const all = buildUsageBar({ categories, maxTokens: 1000000 }).segments;
    const reduced = buildUsageBar({ categories: categories.filter((c) => c.name !== 'System tools'), maxTokens: 1000000 }).segments;
    for (const segment of reduced) {
      assert.equal(segment.color, all.find((s) => s.name === segment.name).color);
    }
    assert.notEqual(all[0].color, all.at(-1).color, 'System prompt and Free space share promptBorder but not identity');
  });

  it('reuses base colors for deferred categories and stable hashes for unknown names', () => {
    const deferred = buildUsageBar({ categories: [
      { name: 'MCP tools (deferred)', tokens: 1, color: 'inactive', isDeferred: true },
      { name: 'System tools (deferred)', tokens: 1, color: 'inactive', isDeferred: true },
    ], maxTokens: 100 }).segments;
    assert.equal(deferred[0].color, 'var(--context-category-mcp-tools)');
    assert.equal(deferred[1].color, 'var(--context-category-system-tools)');
    const a = buildUsageBar({ categories: [{ name: 'Future category', tokens: 1, color: 'inactive' }], maxTokens: 100 }).segments[0];
    const b = buildUsageBar({ categories: [{ name: 'Future category', tokens: 1, color: 'transparent' }], maxTokens: 100 }).segments[0];
    assert.equal(a.color, b.color, 'unknown names do not change color when the CLI token drifts');
    assert.match(a.color, /^var\(--context-category-\d\)$/);
  });

  it('matches bar and grid colors by category rather than cell index', () => {
    const usage = {
      categories,
      maxTokens: 1000000,
      gridRows: [[
        { color: 'promptBorder', isFilled: true, categoryName: 'System prompt', tokens: 161, squareFullness: 0.0322 },
        { color: 'purple_FOR_SUBAGENTS_ONLY', isFilled: true, categoryName: 'Messages', tokens: 152124, squareFullness: 1 },
        { color: 'promptBorder', isFilled: true, categoryName: 'Free space', tokens: 824339, squareFullness: 1 },
      ], [
        { color: 'purple_FOR_SUBAGENTS_ONLY', isFilled: true, categoryName: 'Messages', tokens: 152124, squareFullness: 1 },
      ]],
    };
    const cells = gridToRows(usage).rows.flat();
    const bar = buildUsageBar(usage).segments;
    assert.equal(cells[0].color, bar[0].color);
    assert.equal(cells[1].color, cells[3].color);
    assert.equal(cells[1].color, bar.find((s) => s.name === 'Messages').color);
    assert.equal(cells[0].fill, 'partial');
    assert.equal(cells[1].fill, 'full');
    assert.equal(cells[2].fill, 'empty', 'real Free space cells can be isFilled:true and fullness:1');
  });

  it('keeps partial cells visible and handles buffer and malformed fullness', () => {
    const cells = gridToRows({ gridRows: [[
      { categoryName: 'Skills', color: 'warning', squareFullness: 0.7 },
      { categoryName: 'Skills', color: 'warning', squareFullness: 0.6999 },
      { categoryName: 'Skills', color: 'warning', squareFullness: 0 },
      { categoryName: 'Skills', color: 'warning', squareFullness: NaN },
      { categoryName: 'Skills', color: 'warning', squareFullness: 0.5, isFilled: false },
      { categoryName: 'Autocompact buffer', color: 'inactive', squareFullness: 1 },
      { categoryName: 'Compact buffer', color: 'inactive', squareFullness: 1 },
      { categoryName: 'Autocompact buffer', color: 'inactive', squareFullness: 1, isFilled: false },
    ]] }).rows[0];
    assert.deepEqual(cells.map((c) => c.fill), ['full', 'partial', 'empty', 'partial', 'empty', 'buffer', 'buffer', 'empty']);
    assert.equal(cells[5].color, cells[6].color);
    assert.equal(cells[5].color, 'var(--context-category-buffer)');
    const bufferBar = buildUsageBar({ categories, maxTokens: 1000000 }).segments.find((s) => s.name === 'Autocompact buffer');
    assert.equal(bufferBar.color, cells[5].color);
  });

  it('keeps token and missing-fullness fallbacks safe for drifted data', () => {
    assert.equal(resolveCategoryColor('', 'warning'), 'var(--context-category-skills)');
    for (const name of ['constructor', '__proto__']) {
      assert.match(resolveCategoryColor(name, 'inactive'), /^var\(--context-category-\d\)$/);
    }
    const big = gridToRows({ gridRows: [Array.from({ length: 5000 }, () => ({ categoryName: 'Skills', color: 'warning', tokens: 1 }))] });
    assert.equal(big.truncated, true);
    assert.equal(big.rows[0][0].fill, 'partial', 'filled cells with unknown fullness stay visible');
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
    const ready = { detail: { usage: { totalTokens: 10 }, ts: 100, receivedAt: 1000, trigger: 'turn-end' }, status: 'ready' };
    const staleWs = nextPanelState(ready, { kind: 'ws', frame: SNAP(50) });
    assert.equal(staleWs.detail.ts, 100, 'older WS frame rejected');
    const staleHttp = nextPanelState(ready, { kind: 'http', body: { ok: true, snapshot: SNAP(80) } });
    assert.equal(staleHttp.detail.ts, 100, 'older HTTP snapshot rejected');
    const newer = nextPanelState(ready, { kind: 'ws', frame: SNAP(150) });
    assert.equal(newer.detail.ts, 150, 'newer frame advances');
    const staleClear = nextPanelState(newer, { kind: 'ws', frame: { ts: 100, usage: null } });
    assert.equal(staleClear.detail.ts, 150, 'older clear cannot wipe newer detail');
    const cleared = nextPanelState(newer, { kind: 'ws', frame: { ts: 200, usage: null } });
    assert.equal(cleared.lastTs, 200, 'watermark survives a clear');
    assert.equal(nextPanelState(cleared, { kind: 'http', body: { ok: true, snapshot: SNAP(150) } }).status, 'inactive');
    assert.equal(nextPanelState(cleared, { kind: 'reset' }).lastTs, 0, 'new scope gets a fresh watermark');
    const staleInactive = nextPanelState({ ...newer, detail: { ...newer.detail, receivedAt: 1000 } }, { kind: 'http', body: { ok: false, reason: 'session-inactive' }, startedAt: 50 });
    assert.equal(staleInactive.detail.ts, 150, 'old inactive response cannot wipe newer WS data');
  });
});

describe('contextUsageView — SDK blood-bar merge', () => {
  const sdk = (overrides = {}) => ({
    enabled: true, status: 'ready', detail: { usage: FULL }, ...overrides,
  });

  it('uses SDK totals only when enabled; PTY fallback stays byte-identical', () => {
    const merged = mergeSdkContextBar({ sdk: sdk(), fallbackPercent: 88, fallbackTokens: 1234 });
    assert.equal(merged.percent, 4);
    assert.equal(merged.tokens, 8000);
    assert.equal(merged.sdkActive, true);
    assert.deepEqual(mergeSdkContextBar({ sdk: sdk({ enabled: false }), fallbackPercent: 88, fallbackTokens: 1234 }), {
      percent: 88, tokens: 1234, sdkActive: false, bar: null,
    });
    assert.equal(mergeSdkContextBar({ sdk: sdk({ status: 'loading', detail: null }), fallbackPercent: 88 }).percent, 88);
    assert.equal(mergeSdkContextBar({ sdk: sdk({ locked: true }) }).tokens, 0);
    assert.equal(mergeSdkContextBar({ sdk: sdk({ awaitingFresh: true }) }).percent, 0);
    assert.equal(mergeSdkContextBar({ sdk: sdk({ optimistic: true }) }).percent, 5);
    assert.equal(mergeSdkContextBar({ sdk: sdk({ status: 'error' }) }).sdkActive, false, 'failed refresh falls back rather than hiding calibration');
    assert.equal(mergeSdkContextBar({ sdk: sdk({ status: 'ready' }) }).sdkActive, true);
  });
});

describe('contextUsageView — scoped SDK usage indexes and routing', () => {
  it('matches exact and unique plugin skills, never ambiguous aliases', () => {
    const usage = { skills: { tokens: 600, skillFrontmatter: [
      { name: 'pdf', source: 'project', tokens: 100 },
      { name: 'reader', source: 'plugin:demo', tokens: 200 },
      { name: 'shared', source: 'plugin', tokens: 300 },
    ] } };
    const skills = [
      { name: 'pdf', source: 'project' },
      { name: 'demo:reader', source: 'plugin' },
      { name: 'one:shared', source: 'plugin' },
      { name: 'two:shared', source: 'plugin' },
    ];
    const index = buildSkillUsageIndex(usage, skills);
    assert.equal(index.totalTokens, 600);
    assert.equal(index.tokensByName.get('pdf'), 100);
    assert.equal(index.tokensByName.get('demo:reader'), 200);
    assert.equal(index.tokensByName.has('one:shared'), false);
  });

  it('scopes memory links to direct children of memory.dir and totals unique SDK files', () => {
    const usage = { memoryFiles: [
      { path: '/home/u/.claude/projects/p/memory/a.md', tokens: 100 },
      { path: '/home/u/.claude/projects/p/memory/b%20b.md', tokens: 200 },
      { path: '/tmp/p/CLAUDE.md', tokens: 300 },
      { path: '/home/u/.claude/projects/p/memory/a.md', tokens: 100 },
    ] };
    const index = buildMemoryUsageIndex(usage, '/home/u/.claude/projects/p/memory/');
    assert.equal(index.totalTokens, 600);
    assert.deepEqual(memoryTokensForLink(index, 'a.md'), { tokens: 100, estimated: false });
    assert.deepEqual(memoryTokensForLink(index, 'b%20b.md'), { tokens: 200, estimated: false });
    assert.equal(memoryTokensForLink(index, 'CLAUDE.md'), null);
    assert.equal(memoryTokensForLink(buildMemoryUsageIndex(usage), 'a.md'), null);
    assert.deepEqual(memoryTokensForLink(index, 'linked.md', { memoryTokenEstimates: { 'linked.md': { tokens: 23 } } }), { tokens: 23, estimated: true });
    const windows = buildMemoryUsageIndex({ memoryFiles: [{ path: 'C:\\u\\memory\\a.md', tokens: 7 }] }, 'c:\\u\\memory');
    assert.deepEqual(memoryTokensForLink(windows, 'a.md'), { tokens: 7, estimated: false });
  });

  it('requires a matching view and exact instance when identified', () => {
    const frame = { cwd: '/tmp/my project', instanceKey: 'a', ts: 1 };
    assert.equal(sdkContextFrameMatchesView(frame, { project: 'my_project', instance: 'a' }), true);
    assert.equal(sdkContextFrameMatchesView(frame, { project: 'my_project', instance: 'b' }), false);
    assert.equal(sdkContextFrameMatchesView(frame, { project: 'my_project' }), false, 'unknown twin never flaps');
    assert.equal(sdkContextFrameMatchesView(frame, {}), false);
    assert.equal(sdkContextPath('my project', 'a'), '/api/sdk-context-usage?project=my+project&instance=a');
  });
});