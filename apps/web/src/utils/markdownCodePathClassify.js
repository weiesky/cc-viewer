/**
 * Decide whether an inline code span's text (`xxx` in chat markdown) looks
 * like a local file path, and if so return `{ path, line }` — the normalized
 * candidate path plus the start line parsed from a `:N` / `:N-M` suffix
 * (null when absent). Callers that only need the path read `.path`.
 *
 * Pure, stateless, zero-dependency — same contract as markdownHrefClassify.js:
 * renderMarkdown's output cache is keyed by raw text, so this must never depend
 * on locale, project dir, env, or whether the file actually exists. Existence
 * is checked asynchronously after mount (see mdCodePathVerify.js); here we only
 * answer "is it plausible enough to probe?".
 *
 * Deliberately stricter than classifyMdHref: for link hrefs every schemeless
 * string is a local file (the SPA has no in-site navigation), but codespan text
 * is arbitrary prose/code (`true`, `npm run build`, `useState`) — so we require
 * a separator or a filename-like extension, and reject shapes that can never
 * resolve (schemes, `..` segments the server would 400, `//` UNC prefixes).
 *
 * Candidates pass through safeDecode + normalizeLocalPath (shared with link
 * classification) so the probe, the data attribute, and the eventual click all
 * use one identical value.
 */
import { safeDecode, normalizeLocalPath } from './markdownHrefClassify.js';

// A Windows drive-letter path (C:\x or C:/x) must be detected BEFORE the
// scheme regex, which would otherwise read "C:" as a scheme.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// Must look like a path: contains a separator, or ends with a plausible
// extension (".md", ".js", ".gitignore"). This alone rejects `true`,
// `npm run build`, `foo bar` — none have a separator or trailing extension.
const HAS_SEPARATOR_RE = /[\\/]/;
const HAS_EXTENSION_RE = /\.[A-Za-z0-9]{1,16}$/;
// Version/date dot-chains (`v1.2.3`, `2026.09.09`) pass the extension rule but
// are almost never files — skip the probe entirely.
const NUMERIC_DOT_CHAIN_RE = /^v?\d+(\.\d+)+$/;
const CONTROL_CHARS_RE = /[\x00-\x1f]/;
const MAX_CANDIDATE_LEN = 1024; // server enforces the same cap

export function resolveMdCodePath(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw || raw.length > MAX_CANDIDATE_LEN) return null;
  if (CONTROL_CHARS_RE.test(raw)) return null;
  if (raw.startsWith('//')) return null;
  if (WINDOWS_DRIVE_RE.test(raw)) return finalize(raw);
  if (SCHEME_RE.test(raw)) return null;
  if (!HAS_SEPARATOR_RE.test(raw) && !HAS_EXTENSION_RE.test(raw)) return null;
  if (NUMERIC_DOT_CHAIN_RE.test(raw)) return null;
  // A relative `..` can never open: /api/file-content rejects it with 400, so
  // probing would always resolve to "not clickable" anyway.
  if (raw.split(/[\\/]/).includes('..')) return null;
  // 允许内部空白(`src/my file.md` 合法);`~/...` 不展开(与链接行为一致,服务端
  // resolve 后不存在 → false)。
  // 返回 { path, line }: path 经 safeDecode + normalizeLocalPath 规范化(与链接 href
  // 同一契约), line 是 `:N` / `:N-M` 行号后缀解析出的起始行(无后缀为 null)。
  return finalize(raw);
}

// `path:3012` / `path:3012-3015`(文件引用惯例)。要求行号紧贴末尾、前面含分隔符
// 或扩展名,避免误吞 `foo:bar` 之外的形态(scheme 已在上面拒掉)。
const LINE_SUFFIX_RE = /:(\d+)(?:-\d+)?$/;

function finalize(raw) {
  let line = null;
  const m = LINE_SUFFIX_RE.exec(raw);
  let base = raw;
  if (m && /[\\/]|\.\w+$/.test(raw.slice(0, m.index))) {
    line = parseInt(m[1], 10);
    base = raw.slice(0, m.index);
  }
  const normalized = normalizeLocalPath(safeDecode(base));
  if (!normalized) return null;
  return { path: normalized, line: line > 0 ? line : null };
}
