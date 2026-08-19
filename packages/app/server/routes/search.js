// Codebase text search + replace routes — POST /api/search, POST /api/search-replace.
// Scopes to the project root and delegates to lib/code-search.js and lib/code-replace.js.
import { searchCode } from '../lib/code-search.js';
import { searchReplace } from '../lib/code-replace.js';

const VALID_ENGINES = new Set(['auto', 'ripgrep', 'node']);
const VALID_SCOPES = new Set(['all', 'file', 'match']);

// Cap glob count/length to bound compile cost and glob-regex backtracking.
function toGlobs(v) {
  return (Array.isArray(v)
    ? v.map((s) => String(s).trim())
    : String(v || '').split(',').map((s) => s.trim()))
    .filter((s) => s && s.length <= 200)
    .slice(0, 20);
}

// Body reader + disconnect-aborter shared by both handlers. NOTE: aborts on res 'close' guarded
// by writableFinished — the request's own 'close' fires on NORMAL completion once the body is
// read, which would abort every request.
function withBody(req, res, deps, run) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    const ac = new AbortController();
    let aborted = false;
    const onClose = () => { if (!res.writableFinished) { aborted = true; ac.abort(); } };
    res.on('close', onClose);
    try {
      await run(parsed, ac.signal, () => aborted);
    } finally {
      res.off('close', onClose);
    }
  });
}

function searchHandler(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, deps, async (parsed, signal, isAborted) => {
    const query = typeof parsed.query === 'string' ? parsed.query : '';
    if (!query) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [], truncated: false, engine: 'none', filesScanned: 0 }));
      return;
    }

    const engine = VALID_ENGINES.has(parsed.engine) ? parsed.engine : 'auto';
    const root = process.env.CCV_PROJECT_DIR || process.cwd();

    try {
      const result = await searchCode({
        query,
        root,
        caseSensitive: !!parsed.caseSensitive,
        wholeWord: !!parsed.wholeWord,
        regex: !!parsed.regex,
        includeGlobs: toGlobs(parsed.includeGlobs),
        excludeGlobs: toGlobs(parsed.excludeGlobs),
        engine,
        signal,
      });
      if (isAborted() || res.writableEnded) return; // client gone — nothing to send
      if (result.error === 'invalid_regex') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_regex' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      if (isAborted() || res.writableEnded) return;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'search_failed' }));
    }
  });
}

function replaceHandler(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, deps, async (parsed, signal, isAborted) => {
    const query = typeof parsed.query === 'string' ? parsed.query : '';
    const scope = VALID_SCOPES.has(parsed.scope) ? parsed.scope : null;
    if (!query || !scope || typeof parsed.replacement !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
      return;
    }
    const root = process.env.CCV_PROJECT_DIR || process.cwd();
    try {
      const result = await searchReplace({
        query,
        root,
        caseSensitive: !!parsed.caseSensitive,
        wholeWord: !!parsed.wholeWord,
        regex: !!parsed.regex,
        includeGlobs: toGlobs(parsed.includeGlobs),
        excludeGlobs: toGlobs(parsed.excludeGlobs),
        replacement: parsed.replacement,
        scope,
        file: typeof parsed.file === 'string' ? parsed.file : undefined,
        line: Number.isInteger(parsed.line) ? parsed.line : undefined,
        col: Number.isInteger(parsed.col) ? parsed.col : undefined,
        expectText: typeof parsed.expectText === 'string' ? parsed.expectText : undefined,
        skipPaths: Array.isArray(parsed.skipPaths) ? parsed.skipPaths.map(String) : [],
        dryRun: !!parsed.dryRun,
        // Deliberately NOT wired to `signal`: once a destructive batch starts we let it finish
        // rather than leave committed-but-unreported partial writes on a client disconnect. The
        // per-file event-loop yield keeps the server responsive; the wall-clock budget bounds it.
      });
      if (isAborted() || res.writableEnded) return;
      if (result.error === 'invalid_regex') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_regex' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      if (isAborted() || res.writableEnded) return;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'replace_failed' }));
    }
  });
}

export const searchRoutes = [
  { method: 'POST', match: 'exact', path: '/api/search', handler: searchHandler },
  { method: 'POST', match: 'exact', path: '/api/search-replace', handler: replaceHandler },
];
