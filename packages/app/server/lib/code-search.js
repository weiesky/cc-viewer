// Codebase text search — VS Code-style "search across files".
//
// Two interchangeable engines behind one `searchCode()` shape:
//   - ripgrep  (`rg --json`): fast, respects .gitignore, skips hidden + binary natively.
//   - node     (pure walker): fallback when rg is absent; deliberately mirrors rg's file
//                selection (gitignore-aware via `git ls-files`, hidden skipped) so both
//                engines return the SAME results.
//
// Security: the node engine reads arbitrary project files, so every candidate is gated
// through isReadAllowed(realpath) and symlinks are skipped — a symlinked file must not be
// able to exfiltrate secrets (e.g. notes.txt -> ~/.ssh/id_rsa). rg does not follow symlinks.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isReadAllowed } from './file-access-policy.js';

// Directory/entry names never searched (superset of server IGNORED_PATTERNS + node_modules).
export const IGNORED_NAMES = new Set(['.git', '.svn', '.hg', '.DS_Store', '.idea', '.vscode', 'node_modules']);

export const DEFAULTS = {
  maxResults: 2000,
  maxMatchesPerFile: 200,
  maxFileSize: 1024 * 1024, // 1 MB
  nodeTimeBudgetMs: 8000,
  maxLineLength: 5000,
  binarySniffBytes: 8192,
};

// Kill a hung `git ls-files` (index.lock contention, slow/NFS mount). Unrelated to nodeTimeBudgetMs.
const GIT_LS_FILES_TIMEOUT_MS = 8000;

// ─── Pure helpers (exported for tests) ──────────────────────────────

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the match RegExp honoring the toggles. Throws on invalid regex (regex mode).
 * whole-word wraps the pattern in \b…\b (approximates rg -w).
 */
export function buildQueryRegExp({ query, regex, wholeWord, caseSensitive }) {
  let pattern = regex ? query : escapeRegExp(query);
  if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  return new RegExp(pattern, flags);
}

/**
 * Conservative guard against classic exponential-backtracking patterns — a quantified group
 * whose body already contains a quantifier, e.g. (a+)+, (.*)*, (a+){2,}. The node engine scans
 * with JS RegExp (backtracking) and runs in the single server process, so one such pattern on a
 * modest line can pin the event loop. ripgrep uses a linear engine and needs no guard. Not
 * exhaustive — defense-in-depth for the fallback path; matched patterns are rejected as invalid.
 */
export function looksCatastrophic(pattern) {
  return /\([^()]*[+*}][^()]*\)\s*[+*]/.test(pattern)
    || /\([^()]*[+*][^()]*\)\{\d/.test(pattern);
}

/**
 * Translate a gitignore-style glob into a RegExp matched against a forward-slash,
 * project-relative path. A glob with no '/' matches at any depth (rg `-g` semantics),
 * so it is prefixed with `**​/`. Supports *, **, ?, {a,b}, [..], and literal escaping.
 * Leading '!' must be stripped by the caller (it denotes negation).
 */
export function globToRegExp(glob) {
  let g = glob.trim();
  if (g.startsWith('!')) g = g.slice(1);
  // dir-only trailing slash → match everything beneath it
  if (g.endsWith('/')) g += '**';
  // no slash → match at any depth
  if (!g.includes('/')) g = '**/' + g;

  let re = '';
  let inClass = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (inClass) {
      if (c === ']') inClass = false;
      re += c;
      continue;
    }
    if (c === '[') { inClass = true; re += c; continue; }
    if (c === '*') {
      if (g[i + 1] === '*') {
        // ** — match across path separators
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } // **/  → zero or more segments
        else re += '.*';
      } else {
        re += '[^/]*'; // *  → within a segment
      }
      continue;
    }
    if (c === '?') { re += '[^/]'; continue; }
    if (c === '{') { re += '(?:'; continue; }
    if (c === '}') { re += ')'; continue; }
    if (c === ',') { re += '|'; continue; }
    if ('.+^$()|\\'.includes(c)) { re += '\\' + c; continue; }
    re += c;
  }
  return new RegExp('^' + re + '$');
}

function makeGlobFilter(includeGlobs, excludeGlobs) {
  // Parity with rg: a '!'-prefixed entry in the include field is a negation (exclude),
  // mirroring rg's `-g !glob`. globToRegExp strips the leading '!'.
  const inc = [];
  const exc = [];
  for (const g of includeGlobs || []) { if (!g) continue; (g.startsWith('!') ? exc : inc).push(globToRegExp(g)); }
  for (const g of excludeGlobs || []) { if (!g) continue; exc.push(globToRegExp(g)); }
  return (relPath) => {
    if (inc.length && !inc.some((r) => r.test(relPath))) return false;
    if (exc.some((r) => r.test(relPath))) return false;
    return true;
  };
}

export function normRel(p) {
  let s = String(p).replace(/\\/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

function byteToChar(buf, byteOffset) {
  const b = Math.max(0, Math.min(byteOffset, buf.length));
  return buf.slice(0, b).toString('utf8').length;
}

function rgTextOf(obj) {
  // rg emits {text} for valid UTF-8, {bytes: base64} for invalid UTF-8.
  if (!obj) return null;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.bytes === 'string') return Buffer.from(obj.bytes, 'base64').toString('utf8');
  return null;
}

/**
 * Parse an array of rg `--json` stdout lines into flat match records.
 * Handles byte→char submatch offsets, the {bytes} invalid-UTF-8 variant, CRLF trailing
 * newlines, and zero-width / out-of-range submatches. Pure — unit-tested with canned lines.
 */
export function parseRgJsonLines(lines) {
  const out = [];
  for (const raw of lines) {
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    if (!obj || obj.type !== 'match' || !obj.data) continue;
    const rec = rgMatchToRecord(obj.data);
    if (rec) out.push(rec);
  }
  return out;
}

function rgMatchToRecord(data) {
  const file = rgTextOf(data.path);
  if (file == null) return null;
  const rawText = rgTextOf(data.lines);
  if (rawText == null) return null;
  const byteBuf = Buffer.from(rawText, 'utf8');
  const display = rawText.replace(/\r?\n$/, '');
  const displayLen = display.length;
  const submatches = [];
  for (const sm of data.submatches || []) {
    const start = Math.min(byteToChar(byteBuf, sm.start), displayLen);
    const end = Math.min(byteToChar(byteBuf, sm.end), displayLen);
    if (end > start) submatches.push({ start, end });
  }
  return { file: normRel(file), line: data.line_number, text: display.slice(0, DEFAULTS.maxLineLength), submatches };
}

// ─── Result grouping ────────────────────────────────────────────────

function createGrouper(maxResults, maxMatchesPerFile) {
  const byFile = new Map();
  let total = 0;
  let capped = false; // a per-file or global cap dropped some matches
  return {
    /** @returns {boolean} true if still under the global cap, false once maxResults is hit */
    add(file, match) {
      if (total >= maxResults) { capped = true; return false; }
      let entry = byFile.get(file);
      if (!entry) { entry = []; byFile.set(file, entry); }
      if (entry.length >= maxMatchesPerFile) { capped = true; return true; }
      entry.push(match);
      total++;
      return total < maxResults;
    },
    get total() { return total; },
    get capped() { return capped; },
    results() {
      return [...byFile.entries()].map(([file, matches]) => ({ file, matches }));
    },
  };
}

// ─── ripgrep engine ─────────────────────────────────────────────────

let _rgProbe = null;
export function hasRipgrep() {
  if (_rgProbe) return _rgProbe;
  _rgProbe = new Promise((resolve) => {
    try {
      const child = spawn('rg', ['--version'], { windowsHide: true });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
  return _rgProbe;
}

function rgArgs(opts) {
  const args = ['--json'];
  if (!opts.regex) args.push('-F');
  args.push(opts.caseSensitive ? '-s' : '-i');
  if (opts.wholeWord) args.push('-w');
  if (opts.maxFileSize) args.push('--max-filesize', String(opts.maxFileSize));
  for (const g of opts.includeGlobs || []) if (g) args.push('-g', g);
  for (const g of opts.excludeGlobs || []) if (g) args.push('-g', g.startsWith('!') ? g : `!${g}`);
  // -e guards against a pattern starting with '-'; '.' scopes the search to cwd (root).
  args.push('-e', opts.query, '.');
  return args;
}

function rgSearch(opts) {
  const maxResults = opts.maxResults ?? DEFAULTS.maxResults;
  const maxPerFile = opts.maxMatchesPerFile ?? DEFAULTS.maxMatchesPerFile;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('rg', rgArgs(opts), { cwd: opts.root, signal: opts.signal, windowsHide: true });
    } catch (err) { reject(err); return; }

    const grouper = createGrouper(maxResults, maxPerFile);
    const files = new Set();
    let truncated = false;
    let killed = false;
    let stderr = '';
    let buf = '';
    const decoder = new StringDecoder('utf8'); // preserves multibyte runs across chunk boundaries

    const consume = (line) => {
      if (killed) return;
      const recs = parseRgJsonLines([line]);
      for (const rec of recs) {
        files.add(rec.file);
        const ok = grouper.add(rec.file, { line: rec.line, text: rec.text, submatches: rec.submatches });
        if (!ok) {
          truncated = true;
          killed = true;
          try { child.kill(); } catch { /* already gone */ }
          return;
        }
      }
    };

    child.stdout.on('data', (d) => {
      buf += decoder.write(d);
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consume(line);
      }
    });
    child.stderr.on('data', (d) => { if (stderr.length < 4096) stderr += d.toString('utf8'); });
    // Guard stream-level 'error' (e.g. EPIPE after child.kill on cap) so it can't become an
    // unhandled 'error' event that crashes the process.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      buf += decoder.end();
      if (buf) consume(buf);
      // 0 = matches, 1 = no matches (success), null = killed (cap/abort) → all fine.
      if (code === 2 && !killed) {
        if (/regex parse error|error parsing|unclosed|repetition/i.test(stderr)) {
          const e = new Error('invalid regex'); e.code = 'INVALID_REGEX'; reject(e); return;
        }
        const e = new Error('ripgrep failed'); e.code = 'RG_ERROR'; reject(e); return;
      }
      resolve({ results: grouper.results(), truncated: truncated || grouper.capped, filesScanned: files.size });
    });
  });
}

// ─── node engine ────────────────────────────────────────────────────

function gitListFiles(root, signal) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, windowsHide: true, signal });
    } catch { resolve(null); return; }
    let out = '';
    const decoder = new StringDecoder('utf8');
    // Bound a hung git (index.lock contention, slow/NFS mount) so nodeSearch always resolves.
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, GIT_LS_FILES_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += decoder.write(d); });
    child.stdout.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      out += decoder.end();
      if (code !== 0) { resolve(null); return; }
      resolve(out.split('\0').filter(Boolean));
    });
  });
}

function walkDir(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORED_NAMES.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue; // don't follow symlinks (parity + safety)
      if (e.isDirectory()) stack.push(childRel);
      else if (e.isFile()) out.push(childRel);
    }
  }
  return out;
}

export function isHidden(relPath) {
  return relPath.split('/').some((seg) => seg.startsWith('.'));
}

export function hasIgnoredSegment(relPath) {
  return relPath.split('/').some((seg) => IGNORED_NAMES.has(seg));
}

export function isBinary(buf, n = DEFAULTS.binarySniffBytes) {
  const lim = Math.min(buf.length, n);
  for (let i = 0; i < lim; i++) if (buf[i] === 0) return true;
  return false;
}

async function nodeSearch(opts) {
  // Catastrophic-backtracking guard applies ONLY to the JS-backtracking node engine (ripgrep's
  // engine is linear and safe), so it lives here rather than gating the rg path too.
  if (opts.regex && looksCatastrophic(opts.query)) {
    return { results: [], truncated: false, filesScanned: 0, error: 'invalid_regex' };
  }
  const maxResults = opts.maxResults ?? DEFAULTS.maxResults;
  const maxPerFile = opts.maxMatchesPerFile ?? DEFAULTS.maxMatchesPerFile;
  const maxFileSize = opts.maxFileSize ?? DEFAULTS.maxFileSize;
  const timeBudget = opts.nodeTimeBudgetMs ?? DEFAULTS.nodeTimeBudgetMs;
  const started = Date.now();

  let candidates = await gitListFiles(opts.root, opts.signal);
  if (candidates == null) candidates = walkDir(opts.root);
  candidates = candidates.map(normRel).filter((p) => !isHidden(p) && !hasIgnoredSegment(p));

  const passesGlob = makeGlobFilter(opts.includeGlobs, opts.excludeGlobs);
  const grouper = createGrouper(maxResults, maxPerFile);
  const scanned = new Set();
  let truncated = false;
  let processed = 0;

  for (const rel of candidates) {
    if (opts.signal?.aborted) { truncated = true; break; }
    if (Date.now() - started > timeBudget) { truncated = true; break; }
    // Yield to the event loop periodically so a large scan doesn't starve other HTTP/WS
    // requests and a client disconnect (signal) can be observed between files.
    if ((processed++ & 63) === 0) await new Promise((r) => setImmediate(r));
    if (!passesGlob(rel)) continue;

    const full = join(opts.root, rel);
    let lst;
    try { lst = lstatSync(full); } catch { continue; }
    if (lst.isSymbolicLink()) continue; // never follow symlinks

    let real;
    try { real = realpathSync(full); } catch { continue; }
    const policy = isReadAllowed(real);
    if (!policy.ok) continue;

    let st;
    try { st = statSync(real); } catch { continue; }
    if (!st.isFile() || st.size > maxFileSize) continue;

    let raw;
    try { raw = readFileSync(real); } catch { continue; }
    if (isBinary(raw)) continue;

    scanned.add(rel);
    const lines = raw.toString('utf8').split(/\r?\n/);
    let stop = false;
    for (let i = 0; i < lines.length && !stop; i++) {
      const text = lines[i];
      if (!text || text.length > DEFAULTS.maxLineLength) continue; // skip empty / pathological long lines
      opts.queryRe.lastIndex = 0;
      const submatches = [];
      let m;
      while ((m = opts.queryRe.exec(text)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (end > start) submatches.push({ start, end });
        if (m.index === opts.queryRe.lastIndex) opts.queryRe.lastIndex++; // zero-width guard
        if (submatches.length >= 1000) break; // pathological single-line match count
      }
      if (submatches.length) {
        const ok = grouper.add(rel, { line: i + 1, text: text.slice(0, DEFAULTS.maxLineLength), submatches });
        if (!ok) { truncated = true; stop = true; }
      }
    }
    if (stop) break;
  }
  return { results: grouper.results(), truncated: truncated || grouper.capped, filesScanned: scanned.size };
}

// ─── Public entry ───────────────────────────────────────────────────

/**
 * Search the project codebase for `query`.
 * @param {object} opts see fields below
 * @param {string} opts.query        the search term (or regex source when regex=true)
 * @param {string} opts.root         project root to scope the search
 * @param {boolean} [opts.caseSensitive]
 * @param {boolean} [opts.wholeWord]
 * @param {boolean} [opts.regex]
 * @param {string[]} [opts.includeGlobs]
 * @param {string[]} [opts.excludeGlobs]
 * @param {'auto'|'ripgrep'|'node'} [opts.engine='auto']
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{results, truncated, engine, filesScanned, elapsedMs, error?}>}
 */
export async function searchCode(opts) {
  const engine = opts.engine || 'auto';
  const started = Date.now();
  const empty = (extra) => ({ results: [], truncated: false, filesScanned: 0, elapsedMs: Date.now() - started, ...extra });

  if (!opts.query || !opts.root) return empty({ engine: 'none' });

  // Validate the JS regex up front so both engines report invalid_regex consistently.
  // (The catastrophic-backtracking guard is node-only and lives inside nodeSearch.)
  let queryRe;
  try {
    queryRe = buildQueryRegExp(opts);
  } catch {
    return empty({ engine, error: 'invalid_regex' });
  }
  const runOpts = { ...opts, queryRe };

  let useEngine = engine;
  if (engine === 'auto') useEngine = (await hasRipgrep()) ? 'ripgrep' : 'node';

  if (useEngine === 'ripgrep') {
    try {
      const r = await rgSearch(runOpts);
      return { ...r, engine: 'ripgrep', elapsedMs: Date.now() - started };
    } catch (err) {
      if (err.code === 'INVALID_REGEX') return empty({ engine: 'ripgrep', error: 'invalid_regex' });
      // Client disconnected / superseded — don't fall through to a fresh node scan.
      if (err.name === 'AbortError') return empty({ engine: 'ripgrep', truncated: true });
      // Any other rg failure (ENOENT, or an exit-2 whose stderr we couldn't classify — locale/
      // version-dependent wording) → fall back to the node engine when auto selection was allowed,
      // rather than 500-ing a query the fallback would have handled. Explicit engine:'ripgrep'
      // surfaces the error.
      if (engine === 'auto') {
        const r = await nodeSearch(runOpts);
        return { ...r, engine: 'node', elapsedMs: Date.now() - started };
      }
      throw err;
    }
  }

  const r = await nodeSearch(runOpts);
  return { ...r, engine: 'node', elapsedMs: Date.now() - started };
}
