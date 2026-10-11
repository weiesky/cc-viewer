/**
 * Pure view-model builders for the SDK-mode "Context usage" panel (SdkContextUsageTab).
 * No React — every function takes the raw SDKControlGetContextUsageResponse and returns
 * render-ready plain data, so the whole mapping is node:test-able.
 *
 * Defensive by contract: the panel renders against a live CLI whose fields may drift, so
 * every optional field (`?` in sdk.d.ts) and every out-of-range value is normalized here
 * rather than in the component.
 */

// Fixed fallback palette — the CLI's category color may be a terminal color name or an
// otherwise invalid CSS value; unknown colors cycle through this stable list instead.
const FALLBACK_PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48a9a6',
];

const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.,%\s]+\)|[a-zA-Z]+)$/;

/** Numeric token field, tolerant of missing/non-finite values. Shared by all builders. */
function tok(v) { return (typeof v === 'number' && Number.isFinite(v) ? v : 0); }

/** Pass through valid CSS colors; map anything else to a stable palette slot by index. */
export function normalizeColor(color, index = 0) {
  if (typeof color === 'string' && CSS_COLOR_RE.test(color.trim())) return color.trim();
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

/** percentage may arrive as 0-1 or 0-100; normalize to a clamped 0-100 number. */
export function normalizePercent(p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || Number.isNaN(p)) return 0;
  const v = p <= 1 ? p * 100 : p;
  return Math.min(100, Math.max(0, v));
}

/** Composition bar: one segment per category + a summary line. */
export function buildUsageBar(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const total = typeof usage.totalTokens === 'number' ? usage.totalTokens : 0;
  const max = typeof usage.maxTokens === 'number' && usage.maxTokens > 0 ? usage.maxTokens : 0;
  const categories = Array.isArray(usage.categories) ? usage.categories : [];
  const segments = categories
    .filter((c) => c && typeof c.tokens === 'number' && c.tokens > 0)
    .map((c, i) => ({
      name: typeof c.name === 'string' ? c.name : `#${i + 1}`,
      tokens: c.tokens,
      color: normalizeColor(c.color, i),
      isDeferred: c.isDeferred === true,
      pct: max > 0 ? Math.min(100, (c.tokens / max) * 100) : 0,
    }));
  return {
    segments,
    totalTokens: total,
    maxTokens: max,
    rawMaxTokens: typeof usage.rawMaxTokens === 'number' ? usage.rawMaxTokens : max,
    percentage: normalizePercent(usage.percentage),
    autoCompactThreshold: typeof usage.autoCompactThreshold === 'number' ? usage.autoCompactThreshold : null,
    isAutoCompactEnabled: usage.isAutoCompactEnabled === true,
  };
}

/** Flatten gridRows (2-D) into render rows; cap oversized grids to bound DOM nodes. */
const MAX_GRID_CELLS = 4000;
export function gridToRows(usage) {
  const grid = usage && Array.isArray(usage.gridRows) ? usage.gridRows : [];
  const rows = [];
  let cells = 0;
  let truncated = false;
  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    const outRow = [];
    for (const cell of row) {
      if (cells >= MAX_GRID_CELLS) { truncated = true; break; }
      if (!cell || typeof cell !== 'object') continue;
      outRow.push({
        color: normalizeColor(cell.color, cells),
        isFilled: cell.isFilled !== false,
        fullness: typeof cell.squareFullness === 'number' ? Math.min(1, Math.max(0, cell.squareFullness)) : 1,
        categoryName: typeof cell.categoryName === 'string' ? cell.categoryName : '',
        tokens: typeof cell.tokens === 'number' ? cell.tokens : 0,
        percentage: normalizePercent(cell.percentage),
      });
      cells++;
    }
    if (outRow.length) rows.push(outRow);
    if (truncated) break;
  }
  return { rows, truncated, cellCount: cells };
}

/** Collapsible detail sections — only non-empty ones are returned. */
export function buildDetailSections(usage) {
  if (!usage || typeof usage !== 'object') return [];
  const sections = [];
  const list = (arr, mapItem) => (Array.isArray(arr) ? arr.filter(Boolean).map(mapItem) : []);

  const memoryFiles = list(usage.memoryFiles, (f) => ({ path: String(f?.path ?? ''), type: String(f?.type ?? ''), tokens: tok(f?.tokens) }));
  if (memoryFiles.length) sections.push({ key: 'memoryFiles', items: memoryFiles });

  const mcpTools = list(usage.mcpTools, (t) => ({ name: String(t?.name ?? ''), serverName: String(t?.serverName ?? ''), tokens: tok(t?.tokens), isLoaded: t?.isLoaded !== false }));
  if (mcpTools.length) sections.push({ key: 'mcpTools', items: mcpTools });

  const deferredTools = list(usage.deferredBuiltinTools, (t) => ({ name: String(t?.name ?? ''), tokens: tok(t?.tokens), isLoaded: t?.isLoaded === true }));
  if (deferredTools.length) sections.push({ key: 'deferredTools', items: deferredTools });

  const systemTools = list(usage.systemTools, (t) => ({ name: String(t?.name ?? ''), tokens: tok(t?.tokens) }));
  if (systemTools.length) sections.push({ key: 'systemTools', items: systemTools });

  const promptSections = list(usage.systemPromptSections, (s) => ({ name: String(s?.name ?? ''), tokens: tok(s?.tokens) }));
  if (promptSections.length) sections.push({ key: 'systemPromptSections', items: promptSections });

  const agents = list(usage.agents, (a) => ({ agentType: String(a?.agentType ?? ''), source: String(a?.source ?? ''), tokens: tok(a?.tokens) }));
  if (agents.length) sections.push({ key: 'agents', items: agents });

  if (usage.skills && typeof usage.skills === 'object') {
    sections.push({
      key: 'skills',
      summary: { total: tok(usage.skills.totalSkills), included: tok(usage.skills.includedSkills), tokens: tok(usage.skills.tokens) },
      items: list(usage.skills.skillFrontmatter, (s) => ({ name: String(s?.name ?? ''), source: String(s?.source ?? ''), tokens: tok(s?.tokens) })),
    });
  }

  if (usage.slashCommands && typeof usage.slashCommands === 'object') {
    sections.push({
      key: 'slashCommands',
      summary: { total: tok(usage.slashCommands.totalCommands), included: tok(usage.slashCommands.includedCommands), tokens: tok(usage.slashCommands.tokens) },
      items: [],
    });
  }

  if (usage.messageBreakdown && typeof usage.messageBreakdown === 'object') {
    const mb = usage.messageBreakdown;
    sections.push({
      key: 'messageBreakdown',
      summary: {
        toolCallTokens: tok(mb.toolCallTokens),
        toolResultTokens: tok(mb.toolResultTokens),
        attachmentTokens: tok(mb.attachmentTokens),
        assistantMessageTokens: tok(mb.assistantMessageTokens),
        userMessageTokens: tok(mb.userMessageTokens),
        redirectedContextTokens: tok(mb.redirectedContextTokens),
        unattributedTokens: tok(mb.unattributedTokens),
      },
      toolCallsByType: list(mb.toolCallsByType, (t) => ({ name: String(t?.name ?? ''), callTokens: tok(t?.callTokens), resultTokens: tok(t?.resultTokens) })),
      attachmentsByType: list(mb.attachmentsByType, (a) => ({ name: String(a?.name ?? ''), tokens: tok(a?.tokens) })),
    });
  }

  return sections;
}

/** Footer "last API call" line — apiUsage may be null (sdk.d.ts `| null`). */
export function buildApiUsage(usage) {
  const u = usage && usage.apiUsage;
  if (!u || typeof u !== 'object') return null;
  return {
    input: tok(u.input_tokens),
    output: tok(u.output_tokens),
    cacheCreate: tok(u.cache_creation_input_tokens),
    cacheRead: tok(u.cache_read_input_tokens),
  };
}

/**
 * Panel state machine (extracted pure for testability — DI-controller pattern).
 * prev = { detail: {usage,ts,trigger}|null, status: 'loading'|'ready'|'inactive'|'error' }.
 * event = one of:
 *   { kind:'ws', frame }            — a WS sdk-context-usage frame (usage|null)
 *   { kind:'http', body }           — a GET /api/sdk-context-usage JSON body
 *   { kind:'http-error' }           — fetch throw / non-JSON
 * Returns the next { detail, status }. The ts monotone guard rejects stale frames from
 * either source so an out-of-order HTTP response can't clobber a newer WS push.
 */
export function nextPanelState(prev, event) {
  const p = prev && typeof prev === 'object' ? prev : { detail: null, status: 'loading' };
  if (!event || typeof event !== 'object') return p;

  if (event.kind === 'ws') {
    const frame = event.frame;
    if (!frame || typeof frame !== 'object') return p;
    if (!frame.usage) return { detail: null, status: 'inactive' }; // clear frame
    if (p.detail && typeof frame.ts === 'number' && frame.ts < p.detail.ts) return p; // stale
    return { detail: { usage: frame.usage, ts: frame.ts, trigger: frame.trigger }, status: 'ready' };
  }

  if (event.kind === 'http') {
    const body = event.body;
    if (body && body.ok && body.snapshot && body.snapshot.usage) {
      const s = body.snapshot;
      if (p.detail && typeof s.ts === 'number' && s.ts < p.detail.ts) return p; // stale
      return { detail: { usage: s.usage, ts: s.ts, trigger: s.trigger }, status: 'ready' };
    }
    if (body && body.reason === 'session-inactive') return { detail: null, status: 'inactive' };
    return { ...p, status: 'error' };
  }

  if (event.kind === 'http-error') return { ...p, status: 'error' };
  return p;
}
