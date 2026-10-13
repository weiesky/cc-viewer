// Server-side "current session" pin — replaces the old per-browser localStorage pin so a
// project's current-session pointer is shared across every device hitting THIS ccv process.
// View state only → no loopback gating.
//   - GET  /api/session-pin                                  → { pinnedSessionId }
//   - POST /api/session-pin {pinnedSessionId: string|null}   → persist + SSE-broadcast
// `_logDir` is the live per-project dir ('' = no active project → GET null / POST no-op).
import { _logDir, _projectName } from '../interceptor.js';
import { readPin, writePin } from '../lib/session-pin-store.js';
import { sendEventToClients } from '../lib/log-watcher.js';
import { filterClientsByViewProject } from '../lib/v2/view-router.js';

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function getHandler(req, res) {
  sendJson(res, 200, { pinnedSessionId: readPin(_logDir) });
}

function postHandler(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let incoming;
    try { incoming = body ? JSON.parse(body) : {}; }
    catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    const raw = incoming.pinnedSessionId;
    const pinnedSessionId = (typeof raw === 'string' && raw) ? raw : null;
    writePin(_logDir, pinnedSessionId);
    // Broadcast to THIS process's SSE clients so every device stays in sync.
    // Per-workspace: the pin file is the BOUND project's (`_logDir`), so the
    // frame must reach only bound-project viewers — a parallel view's pin must
    // not be clobbered by it (and vice versa). Payload carries the project so
    // the client can guard in depth.
    const bound = _projectName || '';
    sendEventToClients(
      filterClientsByViewProject(deps.clients, bound, bound),
      'session_pin',
      { pinnedSessionId, project: bound },
    );
    sendJson(res, 200, { ok: true, pinnedSessionId });
  });
  req.on('error', () => { try { sendJson(res, 400, { error: 'read-error' }); } catch {} });
}

export const sessionPinRoutes = [
  { method: 'GET', match: 'exact', path: '/api/session-pin', handler: getHandler },
  { method: 'POST', match: 'exact', path: '/api/session-pin', handler: postHandler },
];
