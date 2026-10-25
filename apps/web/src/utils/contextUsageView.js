import { parseMemoryLink } from './memoryLinkParser.js';
import { projectKeyFromCwd } from './projectKeyFromCwd.js';

/**
 * Pure view-model builders for the SDK-mode "Context usage" panel (SdkContextUsageTab).
 * No React — every function takes the raw SDKControlGetContextUsageResponse and returns
 * render-ready plain data, so the whole mapping is node:test-able.
 *
 * Defensive by contract: the panel renders against a live CLI whose fields may drift, so
 * every optional field (`?` in sdk.d.ts) and every out-of-range value is normalized here
 * rather than in the component.
 */

// The CLI reports Ink theme keys, not CSS colors. Category identity must take
// precedence: System prompt and Free space both use promptBorder in the CLI.
const CATEGORY_COLORS = new Map(Object.entries({
  'system prompt': 'system-prompt',
  'system tools': 'system-tools',
  'mcp tools': 'mcp-tools',
  'custom agents': 'custom-agents',
  'memory files': 'memory-files',
  skills: 'skills',
  messages: 'messages',
  'free space': 'free-space',
  'autocompact buffer': 'buffer',
  'compact buffer': 'buffer',
}));
const TOKEN_COLORS = new Map(Object.entries({
  promptborder: 'system-prompt',
  inactive: 'system-tools',
  cyan_for_subagents_only: 'mcp-tools',
  permission: 'custom-agents',
  claude: 'memory-files',
  warning: 'skills',
  purple_for_subagents_only: 'messages',
}));

function canonicalCategory(name) {
  return typeof name === 'string'
    ? name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ \(deferred\)$/, '')
    : '';
}

function stableColorIndex(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % 7;
}

export const CATEGORY_COLOR_ROLES = Object.freeze([
  ...new Set([...CATEGORY_COLORS.values(), ...TOKEN_COLORS.values()]),
  ...Array.from({ length: 7 }, (_, i) => String(i)),
]);

/** Numeric token field, tolerant of missing/non-finite values. Shared by all builders. */
function tok(v) { return (typeof v === 'number' && Number.isFinite(v) ? v : 0); }

/** Resolve one category color shared by the composition bar, legend, and grid. */
export function resolveCategoryColor(categoryName, colorToken) {
  const name = canonicalCategory(categoryName);
  const role = CATEGORY_COLORS.get(name)
    ?? (name ? stableColorIndex(name) : TOKEN_COLORS.get(String(colorToken || '').trim().toLowerCase()));
  return `var(--context-category-${role ?? stableColorIndex(String(colorToken || ''))})`;
}

function gridFillState(categoryName, isFilled, fullness) {
  if (!isFilled || fullness <= 0) return 'empty';
  const name = canonicalCategory(categoryName);
  if (name === 'autocompact buffer' || name === 'compact buffer') return 'buffer';
  if (name === 'free space') return 'empty';
  return fullness >= 0.7 ? 'full' : 'partial';
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
      color: resolveCategoryColor(c.name, c.color),
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
      const isFilled = cell.isFilled !== false;
      const fullness = typeof cell.squareFullness === 'number' && Number.isFinite(cell.squareFullness)
        ? Math.min(1, Math.max(0, cell.squareFullness)) : (isFilled ? 0.5 : 0);
      outRow.push({
        color: resolveCategoryColor(cell.categoryName, cell.color),
        isFilled,
        fullness,
        fill: gridFillState(cell.categoryName, isFilled, fullness),
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

function panelDetail(snapshot) {
  return {
    usage: snapshot.usage,
    ts: snapshot.ts,
    receivedAt: snapshot.receivedAt || Date.now(),
    trigger: snapshot.trigger,
    sessionId: snapshot.sessionId || null,
    cwd: snapshot.cwd || null,
    instanceKey: snapshot.instanceKey || null,
  };
}

function snapshotIsStale(prev, snapshot) {
  const ts = typeof snapshot?.ts === 'number' ? snapshot.ts : 0;
  return ts < Math.max(prev.lastTs || 0, prev.detail?.ts || 0);
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
  const p = prev && typeof prev === 'object' ? prev : { detail: null, status: 'loading', lastTs: 0 };
  if (!event || typeof event !== 'object') return p;
  if (event.kind === 'disabled') return { detail: null, status: 'disabled', lastTs: 0 };
  if (event.kind === 'reset') return { detail: null, status: event.status || 'loading', lastTs: 0 };

  if (event.kind === 'ws') {
    const frame = event.frame;
    if (!frame || typeof frame !== 'object' || snapshotIsStale(p, frame)) return p;
    const lastTs = Math.max(p.lastTs || 0, typeof frame.ts === 'number' ? frame.ts : 0);
    if (!frame.usage) return { detail: null, status: 'inactive', lastTs }; // clear frame
    return { detail: panelDetail(frame), status: 'ready', lastTs };
  }

  if (event.kind === 'http') {
    const body = event.body;
    if (body && body.ok && body.snapshot && body.snapshot.usage) {
      const s = body.snapshot;
      if (snapshotIsStale(p, s)) return p;
      return { detail: panelDetail(s), status: 'ready', lastTs: Math.max(p.lastTs || 0, typeof s.ts === 'number' ? s.ts : 0) };
    }
    if (body && body.reason === 'session-inactive') {
      if (p.detail && typeof event.startedAt === 'number' && event.startedAt < (p.detail.receivedAt || 0)) return p;
      return { detail: null, status: 'inactive', lastTs: p.lastTs || 0 };
    }
    return { ...p, status: 'error' };
  }

  if (event.kind === 'http-error') return { ...p, status: 'error' };
  return p;
}

export const SDK_CONTEXT_DISABLED = Object.freeze({
  enabled: false,
  locked: false,
  optimistic: false,
  awaitingFresh: false,
  status: 'disabled',
  detail: null,
  refreshing: false,
  refresh: null,
});

/** Second-line routing guard for both WS frames and anchored HTTP responses. */
export function sdkContextFrameMatchesView(frame, { project, instance } = {}) {
  if (!frame || typeof frame !== 'object' || !project) return false;
  if (projectKeyFromCwd(frame.cwd) !== project) return false;
  const expected = instance || null;
  if (expected) return frame.instanceKey === expected;
  return !frame.instanceKey;
}

export function sdkContextPath(project, instance) {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  if (instance) params.set('instance', instance);
  const query = params.toString();
  return `/api/sdk-context-usage${query ? `?${query}` : ''}`;
}

/** Blood-bar precedence. The SDK never changes the caller's request-derived fallback. */
export function mergeSdkContextBar({ sdk = SDK_CONTEXT_DISABLED, fallbackPercent = 0, fallbackTokens = 0 } = {}) {
  const fallback = { percent: fallbackPercent, tokens: fallbackTokens, sdkActive: false, bar: null };
  if (!sdk?.enabled) return fallback;
  if (sdk.locked || sdk.awaitingFresh || sdk.clearConfirmed === false) return { percent: 0, tokens: 0, sdkActive: true, bar: null };
  const usage = sdk.detail?.usage;
  if (!usage || sdk.status !== 'ready') return fallback;
  const bar = buildUsageBar(usage);
  if (!bar) return fallback;
  return {
    percent: sdk.optimistic ? 5 : bar.percentage,
    tokens: usage.totalTokens,
    sdkActive: true,
    bar,
  };
}

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Skill frontmatter is the SDK's context cost, not the cost of loading SKILL.md. */
export function buildSkillUsageIndex(usage, skills) {
  const rows = Array.isArray(usage?.skills?.skillFrontmatter) ? usage.skills.skillFrontmatter : [];
  const tokensByName = new Map();
  const candidates = Array.isArray(skills) ? skills : [];
  for (const row of rows) {
    const name = normalizedName(row?.name);
    if (!name || tokensByName.has(name)) continue;
    let displayName = candidates.find((skill) => normalizedName(skill?.name) === name)?.name;
    if (!displayName && String(row?.source || '').toLowerCase().split(':')[0] === 'plugin' && !name.includes(':')) {
      const aliases = candidates.filter((skill) => skill?.source === 'plugin' && normalizedName(skill.name).endsWith(`:${name}`));
      if (aliases.length === 1) displayName = aliases[0].name;
    }
    if (displayName) tokensByName.set(displayName, tok(row.tokens));
  }
  return {
    tokensByName,
    totalTokens: usage?.skills && typeof usage.skills === 'object' ? tok(usage.skills.tokens) : null,
  };
}

function normalizedPath(value) {
  let path = String(value || '').replace(/\\/g, '/');
  try { path = decodeURIComponent(path); } catch { /* Keep the raw path for comparison. */ }
  return path.replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
}

/** Per-link costs are only safe for direct children of the current memory directory. */
export function buildMemoryUsageIndex(usage, memoryDir) {
  const rows = Array.isArray(usage?.memoryFiles) ? usage.memoryFiles : [];
  const uniquePaths = new Map();
  for (const row of rows) {
    const path = normalizedPath(row?.path);
    if (path) uniquePaths.set(path, tok(row?.tokens));
  }
  const totalTokens = rows.length ? [...uniquePaths.values()].reduce((sum, tokens) => sum + tokens, 0) : null;
  const tokensByName = new Map();
  const dir = normalizedPath(memoryDir);
  if (dir) {
    for (const [path, tokens] of uniquePaths) {
      if (!path.startsWith(`${dir}/`) || path.slice(dir.length + 1).includes('/')) continue;
      const name = path.slice(dir.length + 1);
      if (!parseMemoryLink(name).open) continue;
      if (tokensByName.has(name)) tokensByName.set(name, null);
      else tokensByName.set(name, tokens);
    }
  }
  return { tokensByName, totalTokens };
}

export function memoryTokensForLink(index, href, memory) {
  const name = parseMemoryLink(href).open;
  const tokens = name ? index?.tokensByName?.get(normalizedPath(name)) : null;
  if (typeof tokens === 'number') return { tokens, estimated: false };
  const estimate = name ? memory?.memoryTokenEstimates?.[name] : null;
  return typeof estimate?.tokens === 'number' ? { tokens: estimate.tokens, estimated: true } : null;
}
