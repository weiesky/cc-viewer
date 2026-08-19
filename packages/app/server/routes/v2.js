// Wire v3 routes (V3.S1+): on-demand single-entry detail for the metadata-row
// request list. Registered unconditionally — harmless while CCV_WIRE_V3 is off
// (nothing calls it), so the route itself needs no flag gate.
import { join } from 'node:path';
import { LOG_DIR } from '../../findcc.js';
import { validateLogPath } from '../lib/log-management.js';
import { resolveSessionDirName } from '../lib/v2/session-select.js';
import { readV2SingleEntry } from '../lib/v2/adapter.js';
import { sseHead, sseWrite, wireEnd } from '../lib/wire-compress.js';

/**
 * GET /api/v2-entry?file=v2:<project>/<dirToken>&seq=N[&sid=<uuid>]
 * dirToken is normally the session dir basename (`<ts>_<uuid>`); a bare UUID
 * (the client only holds `_seqEpoch="v2:<uuid>"`) is resolved to the basename
 * BEFORE validateLogPath — validation expects an existing directory path.
 * `sid` disambiguates teammate rows: the fold runs over the leader dir, the
 * target is keyed (sid, seq); omitted = match seq in any folded session.
 */
async function v2Entry(req, res, parsedUrl) {
  const file = parsedUrl.searchParams.get('file') || '';
  const seq = parseInt(parsedUrl.searchParams.get('seq'), 10);
  const sid = parsedUrl.searchParams.get('sid') || null;
  const m = /^v2:([^/]+)\/([^/]+)$/.exec(file);
  if (!m || !Number.isInteger(seq) || seq < 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'expected file=v2:<project>/<session>&seq=<n>' }));
    return;
  }
  try {
    // UUID → dir-basename resolution first (rename/-c adoption safe), then the
    // same path validation every other v2 ref goes through.
    const [, project, dirToken] = m;
    const resolved = resolveSessionDirName(join(LOG_DIR, project), dirToken) || dirToken;
    const sessionDir = validateLogPath(LOG_DIR, `v2:${project}/${resolved}`);
    const result = await readV2SingleEntry(sessionDir, { seq, sessionId: sid });
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'entry not found' }));
      return;
    }
    // Whole-stream JSON (like /api/requests): compress without per-event flush.
    sseHead(req, res, 200, { 'Content-Type': 'application/json' }, { flush: false });
    // slots are raw JSON strings — compose without re-parse/re-stringify.
    sseWrite(res, `{"entry":${result.entry},"prevMain":${result.prevMain ?? 'null'}}`);
    wireEnd(res);
  } catch (err) {
    console.error('[v2-entry]', file, err && err.stack || err);
    if (!res.headersSent) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'ACCESS_DENIED' ? 403 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } else {
      wireEnd(res);
    }
  }
}

export const v2Routes = [
  { method: 'GET', match: 'exact', path: '/api/v2-entry', handler: v2Entry },
];
