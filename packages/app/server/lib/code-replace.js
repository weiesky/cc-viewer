// Codebase replace-in-files — the write half of the Search view.
//
// Safety model (see plan review): isReadAllowed() is NOT a sufficient WRITE gate — its
// allowlist spans ~/.claude, workspaces and tmp dirs. Every target additionally must pass an
// in-project realpath containment check (like deleteFile/moveFile), protected-dir refusal, and
// the search's own hidden/ignored filters, so a client-named scope:'file'/'match' path cannot
// escape the project or hit .git/node_modules/.env. Writes are atomic (tmp+rename), preserve
// file mode, verify UTF-8 round-trip (never corrupt Latin-1), and never 500 the whole batch.
import {
  readFileSync, writeFileSync, statSync, lstatSync, realpathSync, chmodSync, unlinkSync,
} from 'node:fs';
import { join, dirname, basename, sep, isAbsolute } from 'node:path';
import { isReadAllowed } from './file-access-policy.js';
import { renameSyncWithRetry } from './file-api.js';
import {
  buildQueryRegExp, looksCatastrophic, isHidden, hasIgnoredSegment, normRel, DEFAULTS, searchCode, isBinary,
} from './code-search.js';

const REPLACE_TIME_BUDGET_MS = 15000;
// Match COUNT cap for enumerating scope:'all' candidate FILES. Set high (not the search default of
// 2000) so replace-all touches every matching file in normal repos; `truncated` is surfaced only
// on pathological scale so the UI can warn the user matches remain.
const REPLACE_CANDIDATE_CAP = 1000000;

// ─── Pure replacement primitive (mirrored verbatim on the client) ───

/**
 * Compute the replacement text for a single matched substring.
 * regex mode → native JS $-substitution ($1/$&/$$…); literal mode → the string verbatim.
 * Using native String.replace on BOTH client and server guarantees preview === what's written.
 */
export function applyMatch(matchedText, reNoG, regex, replacement) {
  if (!regex) return replacement;
  return matchedText.replace(reNoG, replacement);
}

/**
 * Apply the replacement to file content.
 * @param {RegExp} reG   global query regex (from buildQueryRegExp)
 * @param {RegExp} reNoG same regex without the 'g' flag (for native $-expansion of one match)
 * @param {{regex:boolean, target:'all-in-file'|{line:number,col:number}, expectText?:string}} o
 * @returns {{newContent:string, count:number}}
 */
export function replaceInContent(content, reG, reNoG, replacement, { regex, target, expectText }) {
  // Split preserving exact line terminators (even = line text, odd = \r\n|\n) so CRLF/LF are
  // kept and ^/$ stay line-scoped, matching the search's line-by-line semantics.
  const parts = content.split(/(\r?\n)/);
  let count = 0;

  const replaceWholeLine = (line) => {
    if (line.length > DEFAULTS.maxLineLength) return line; // parity with search (skips long lines)
    reG.lastIndex = 0;
    return line.replace(reG, (m0) => {
      if (m0 === '') return m0; // skip zero-width (consistent with search display)
      const rep = applyMatch(m0, reNoG, regex, replacement);
      // Count only real changes: a context-dependent pattern (lookahead/lookbehind, $`/$')
      // re-run against the isolated match can no-op — don't report/write those.
      if (rep !== m0) count++;
      return rep;
    });
  };

  if (target === 'all-in-file') {
    for (let i = 0; i < parts.length; i += 2) parts[i] = replaceWholeLine(parts[i]);
  } else {
    const idx = (target.line - 1) * 2;
    if (idx >= 0 && idx < parts.length) {
      const line = parts[idx];
      reG.lastIndex = 0;
      let m;
      while ((m = reG.exec(line)) !== null) {
        if (m.index === target.col) {
          // Re-verify: the match at this column must still be the exact text the user saw.
          if (m[0] !== '' && (expectText == null || m[0] === expectText)) {
            const rep = applyMatch(m[0], reNoG, regex, replacement);
            if (rep !== m[0]) {
              parts[idx] = line.slice(0, m.index) + rep + line.slice(m.index + m[0].length);
              count = 1;
            }
          }
          break;
        }
        if (m.index === reG.lastIndex) reG.lastIndex++; // zero-width guard
      }
      reG.lastIndex = 0;
    }
  }
  return { newContent: parts.join(''), count };
}

// ─── Orchestrator ───────────────────────────────────────────────────

const PROTECTED = new Set(['node_modules', '.git', '.svn', '.hg']);
function isProtected(rel) {
  return rel.split('/').some((seg) => PROTECTED.has(seg));
}

function makeTmpPath(real) {
  const rand = Math.random().toString(36).slice(2, 10);
  // leading dot → isHidden() skips any crash-orphaned tmp; same dir → same-fs atomic rename.
  return join(dirname(real), `.${basename(real)}.ccv-tmp-${process.pid}-${rand}`);
}

/**
 * Replace matches of `query` with `replacement` across the project.
 * @returns {Promise<{changed:{file,replacements}[], skipped:{file,reason}[], total:number, error?:string}>}
 * reasons: dirty | forbidden | symlink | binary | too_large | encoding | changed | write_failed
 */
export async function searchReplace(opts) {
  const empty = (extra) => ({ changed: [], skipped: [], total: 0, ...extra });
  if (!opts.query || !opts.root || typeof opts.replacement !== 'string') return empty();
  if (opts.regex && looksCatastrophic(opts.query)) return empty({ error: 'invalid_regex' });

  let reG;
  try { reG = buildQueryRegExp(opts); } catch { return empty({ error: 'invalid_regex' }); }
  const reNoG = new RegExp(reG.source, reG.flags.replace('g', ''));
  const regex = !!opts.regex;
  const maxFileSize = opts.maxFileSize ?? DEFAULTS.maxFileSize;
  const dryRun = !!opts.dryRun;

  const root = opts.root;
  let realRoot;
  try { realRoot = realpathSync(root); } catch { realRoot = root; }
  const rootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

  // Candidate files.
  let files;
  let truncated = false;
  if (opts.scope === 'all') {
    const s = await searchCode({
      query: opts.query, root, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord,
      regex: opts.regex, includeGlobs: opts.includeGlobs, excludeGlobs: opts.excludeGlobs,
      engine: 'node', maxResults: REPLACE_CANDIDATE_CAP, signal: opts.signal,
    });
    if (s.error) return empty({ error: s.error });
    files = s.results.map((r) => r.file);
    truncated = !!s.truncated; // matches remain beyond the cap → the UI warns "run again"
  } else {
    if (!opts.file) return empty();
    files = [normRel(opts.file)];
  }

  const skipSet = new Set((opts.skipPaths || []).map(normRel));
  const changed = [];
  const skipped = [];
  let total = 0;
  let processed = 0;
  const started = Date.now();
  const skip = (file, reason) => skipped.push({ file, reason });

  for (const rel of files) {
    if (opts.signal?.aborted) break;
    if (Date.now() - started > REPLACE_TIME_BUDGET_MS) break;
    // Yield to the event loop periodically so a large batch doesn't starve other HTTP/WS requests
    // (the loop is otherwise fully synchronous readFileSync/replace/writeFileSync per file).
    if ((processed++ & 63) === 0) await new Promise((r) => setImmediate(r));
    if (skipSet.has(rel)) { skip(rel, 'dirty'); continue; }
    if (isAbsolute(rel) || rel.split('/').includes('..') || isProtected(rel) || isHidden(rel) || hasIgnoredSegment(rel)) {
      skip(rel, 'forbidden'); continue;
    }

    const full = join(root, rel);
    let lst;
    try { lst = lstatSync(full); } catch { skip(rel, 'changed'); continue; }
    if (lst.isSymbolicLink()) { skip(rel, 'symlink'); continue; }

    let real;
    try { real = realpathSync(full); } catch { skip(rel, 'changed'); continue; }
    if (real !== realRoot && !real.startsWith(rootPrefix)) { skip(rel, 'forbidden'); continue; }
    if (!isReadAllowed(real).ok) { skip(rel, 'forbidden'); continue; }

    let st;
    try { st = statSync(real); } catch { skip(rel, 'changed'); continue; }
    if (!st.isFile()) { skip(rel, 'forbidden'); continue; }
    if (st.size > maxFileSize) { skip(rel, 'too_large'); continue; }

    let raw;
    try { raw = readFileSync(real); } catch { skip(rel, 'changed'); continue; }
    if (isBinary(raw)) { skip(rel, 'binary'); continue; }
    const text = raw.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(raw)) { skip(rel, 'encoding'); continue; } // don't corrupt non-UTF-8

    const target = opts.scope === 'match'
      ? { line: opts.line, col: opts.col }
      : 'all-in-file';
    const expectText = opts.scope === 'match' ? opts.expectText : undefined;
    const { newContent, count } = replaceInContent(text, reG, reNoG, opts.replacement, { regex, target, expectText });
    if (count === 0) { skip(rel, 'changed'); continue; }
    total += count;

    if (dryRun) { changed.push({ file: rel, replacements: count }); continue; }

    const tmp = makeTmpPath(real);
    try {
      writeFileSync(tmp, newContent, 'utf8');
      chmodSync(tmp, st.mode & 0o777); // preserve exec bit / restrictive perms (tmp is created 0644)
      renameSyncWithRetry(tmp, real);
    } catch {
      try { unlinkSync(tmp); } catch { /* nothing to clean */ }
      total -= count;
      skip(rel, 'write_failed');
      continue;
    }
    changed.push({ file: rel, replacements: count });
  }

  return { changed, skipped, total, truncated };
}
