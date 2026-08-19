import analystSvg from '../img/teammates/analyst.svg?raw';
import auditorSvg from '../img/teammates/auditor.svg?raw';
import builderSvg from '../img/teammates/builder.svg?raw';
import defaultSvg from '../img/teammates/default.svg?raw';
import designerSvg from '../img/teammates/designer.svg?raw';
import executorSvg from '../img/teammates/executor.svg?raw';
import expertSvg from '../img/teammates/expert.svg?raw';
import explorerSvg from '../img/teammates/explorer.svg?raw';
import implementerSvg from '../img/teammates/implementer.svg?raw';
import investigatorSvg from '../img/teammates/investigator.svg?raw';
import researcherSvg from '../img/teammates/researcher.svg?raw';
import reviewerSvg from '../img/teammates/reviewer.svg?raw';
import scannerSvg from '../img/teammates/scanner.svg?raw';
import securitySvg from '../img/teammates/security.svg?raw';
import tracerSvg from '../img/teammates/tracer.svg?raw';
import translatorSvg from '../img/teammates/translator.svg?raw';
import workerSvg from '../img/teammates/worker.svg?raw';

export const ROLE_MAP = {
  worker:       { svg: workerSvg },
  reviewer:     { svg: reviewerSvg },
  researcher:   { svg: researcherSvg },
  explorer:     { svg: explorerSvg },
  analyst:      { svg: analystSvg },
  tracer:       { svg: tracerSvg },
  investigator: { svg: investigatorSvg },
  builder:      { svg: builderSvg },
  implementer:  { svg: implementerSvg },
  auditor:      { svg: auditorSvg },
  translator:   { svg: translatorSvg },
  security:     { svg: securitySvg },
  scanner:      { svg: scannerSvg },
  expert:       { svg: expertSvg },
  executor:     { svg: executorSvg },
  designer:     { svg: designerSvg },
  default:      { svg: defaultSvg },
};

const PREFIX_RULES = [
  { prefix: 'worker-',       role: 'worker' },
  { prefix: 'reviewer-',     role: 'reviewer' },
  { prefix: 'researcher-',   role: 'researcher' },
  { prefix: 'explorer-',     role: 'explorer' },
  { prefix: 'explore-',      role: 'explorer' },
  { prefix: 'translator-',   role: 'translator' },
  { prefix: 'svg-creator-',  role: 'designer' },
];

const SUFFIX_RULES = [
  { suffix: '-reviewer',      role: 'reviewer' },
  { suffix: '-analyst',       role: 'analyst' },
  { suffix: '-tracer',        role: 'tracer' },
  { suffix: '-investigator',  role: 'investigator' },
  { suffix: '-builder',       role: 'builder' },
  { suffix: '-impl',          role: 'implementer' },
  { suffix: '-auditor',       role: 'auditor' },
  { suffix: '-scanner',       role: 'scanner' },
  { suffix: '-expert',        role: 'expert' },
  { suffix: '-executor',      role: 'executor' },
];

const CONTAINS_RULES = [
  { keyword: 'security',     role: 'security' },
  { keyword: 'implementer',  role: 'implementer' },
  { keyword: 'review',       role: 'reviewer' },
  { keyword: 'explor',       role: 'explorer' },
  { keyword: 'research',     role: 'researcher' },
  { keyword: 'analy',        role: 'analyst' },
  { keyword: 'trac',         role: 'tracer' },
  { keyword: 'investigat',   role: 'investigator' },
  { keyword: 'build',        role: 'builder' },
  { keyword: 'audit',        role: 'auditor' },
  { keyword: 'translat',     role: 'translator' },
  { keyword: 'scan',         role: 'scanner' },
  { keyword: 'expert',       role: 'expert' },
  { keyword: 'execut',       role: 'executor' },
  { keyword: 'design',       role: 'designer' },
  { keyword: 'work',         role: 'worker' },
];

const ABBREV_PREFIX_RULES = [
  { prefix: 'cr-', role: 'reviewer' },
  { prefix: 'r-',  role: 'reviewer' },
  { prefix: 'ui-', role: 'reviewer' },
  { prefix: 'ux-', role: 'reviewer' },
];

// Hash-based fallback: deterministic role from name (visual variety for unmatched names)
const ROLE_KEYS = Object.keys(ROLE_MAP).filter(k => k !== 'default');

function resolveRole(name) {
  const lower = name.toLowerCase();

  for (const { prefix, role } of PREFIX_RULES) {
    if (lower.startsWith(prefix)) return role;
  }

  for (const { suffix, role } of SUFFIX_RULES) {
    if (lower.endsWith(suffix)) return role;
  }

  for (const { keyword, role } of CONTAINS_RULES) {
    if (lower.includes(keyword)) return role;
  }

  for (const { prefix, role } of ABBREV_PREFIX_RULES) {
    if (lower.startsWith(prefix)) return role;
  }

  // Hash fallback: same name always maps to same role
  if (lower.length > 0) {
    let hash = 0;
    for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
    return ROLE_KEYS[((hash % ROLE_KEYS.length) + ROLE_KEYS.length) % ROLE_KEYS.length];
  }

  return 'default';
}

// 20 个 CSS 变量引用：背景色由 global.css 按当前主题（曜石黑 / 雪山白）决定。
// 运行时不做主题判定，避免初次渲染时 data-theme 未就绪导致的误判。
// 索引对应 `--avatar-bg-0..19`，顺序由 nameToColorIndex 决定。
const AVATAR_BG_VAR_COUNT = 20;

function nameToColorIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ((hash % AVATAR_BG_VAR_COUNT) + AVATAR_BG_VAR_COUNT) % AVATAR_BG_VAR_COUNT;
}

// Removes SMIL <animate> elements from an avatar SVG string. DESIGN.md's
// degradation rule guarantees the static markup IS the finished portrait
// (all animate elements are self-closing and hold their hidden states inside
// the animate itself), so the stripped string renders the complete image.
// The narrow regex (only self-closing <animate>) is intentionally coupled to
// test/teammate-svg-assets.test.js, whose element allowlist and self-closing
// assertion forbid animateTransform/animateMotion/<set> and open-form
// <animate> — keep both in sync if that allowlist ever relaxes.
export function stripSvgAnimations(svg) {
  return svg.replace(/<animate\b[^>]*\/>/g, '');
}

// Static (animation-stripped) variant per role, computed once so the strip
// regex does not rerun on every render of every old row.
const _staticSvgCache = new Map();

function getStaticSvg(role, svg) {
  let cached = _staticSvgCache.get(role);
  if (cached === undefined) {
    cached = stripSvgAnimations(svg);
    _staticSvgCache.set(role, cached);
  }
  return cached;
}

// Policy: a teammate avatar plays its one-shot draw-in only when its message
// timestamp is within windowMs of the newest item's timestamp. Missing or
// unparseable timestamps animate (today's behavior). latestTs may be an ISO
// string or epoch ms.
export function shouldAnimateTeammateAvatar(msgTs, latestTs, windowMs = 60000) {
  const msgMs = typeof msgTs === 'number' ? msgTs : Date.parse(msgTs);
  const latestMs = typeof latestTs === 'number' ? latestTs : Date.parse(latestTs);
  if (Number.isNaN(msgMs) || Number.isNaN(latestMs)) return true;
  return latestMs - msgMs <= windowMs;
}

// Scan helper for ChatView.buildAllItems: given [{ts, isTeammateAvatar}] in
// render order, returns the max parseable timestamp (epoch ms; NaN entries
// skipped) and the index of the last teammate-avatar row (-1 if none).
export function pickAvatarAnimationTargets(entries) {
  let latestMs = NaN;
  let newestTeammateIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const { ts, isTeammateAvatar } = entries[i];
    const ms = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isNaN(ms) && (Number.isNaN(latestMs) || ms > latestMs)) latestMs = ms;
    if (isTeammateAvatar) newestTeammateIdx = i;
  }
  return { latestMs, newestTeammateIdx };
}

export function getTeammateAvatar(name, { animated = true } = {}) {
  let clean = (name || '').trim();
  // Strip "Teammate: " prefix (from formatTeammateLabel)
  clean = clean.replace(/^Teammate:\s*/i, '');
  // Strip trailing "(model-info)" suffix
  clean = clean.replace(/\([^)]*\)\s*$/, '').trim();
  const role = resolveRole(clean);
  const entry = ROLE_MAP[role];
  // SVG 表达角色，CSS 变量引用表达个体身份——浏览器按当前 [data-theme] 选值
  const color = `var(--avatar-bg-${nameToColorIndex(clean)})`;
  const svg = animated ? entry.svg : getStaticSvg(role, entry.svg);
  return { svg, color, role };
}
