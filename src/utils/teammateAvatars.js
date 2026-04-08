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

// 20 色调色板：用于区分不同个体（同 SVG 角色 + 不同背景色 = 可区分）
// 深色系，确保白色 SVG 图标可读
const PALETTE = [
  '#5b6abf', '#2a9d8f', '#6366f1', '#d97706', '#3b82f6',
  '#8b5cf6', '#0e7490', '#ea580c', '#059669', '#e11d48',
  '#0284c7', '#dc2626', '#65a30d', '#ca8a04', '#9333ea',
  '#db2777', '#6b7280', '#1d4ed8', '#b45309', '#047857',
];

function nameToColorIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ((hash % PALETTE.length) + PALETTE.length) % PALETTE.length;
}

export function getTeammateAvatar(name) {
  let clean = (name || '').trim();
  // Strip "Teammate: " prefix (from formatTeammateLabel)
  clean = clean.replace(/^Teammate:\s*/i, '');
  // Strip trailing "(model-info)" suffix
  clean = clean.replace(/\([^)]*\)\s*$/, '').trim();
  const role = resolveRole(clean);
  const entry = ROLE_MAP[role];
  // SVG 表达角色，背景色表达个体身份（同角色不同名字 → 不同颜色）
  const color = PALETTE[nameToColorIndex(clean)];
  return { svg: entry.svg, color, role };
}
