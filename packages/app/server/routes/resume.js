// /resume feature routes (2026-10).
//
//   GET  /api/resume-sessions?limit=5
//       Recent-session list for the CURRENT project only (ccv's own v2 store).
//       Powers the header's current-project hover dropdown. Read-only; no
//       loopback gate (view state).
//
//   GET  /api/live-processes
//       Live main claude PTYs this server owns (one per activated project), for
//       the Header's parallel-project chips. Read-only.
//
//   POST /api/live-processes/attach  { project }
//       Attach the main view's PTY stream to that project's record (multi-PTY
//       view switch, 2026-10). Idempotent; never spawns/kills. 404 when the
//       project has no live record (caller degrades silently).
//
//   POST /api/live-processes/close  { project }
//       Kill that project's main PTY (the web header tab's × button). Admin-only
//       (loopback or authenticated remote admin); 403 otherwise, 404 when the
//       project has no record. The record is kept for a later re-launch.
//
// Boundary note (verify:boundaries): routes (L3) may import lib/ (L1) and
// interceptor (L2) per the existing house pattern (session-pin.js / logs.js).
// The aggregation itself lives in lib/v2/resume-list.js (pure, unit-tested);
// this handler is a thin HTTP wrapper.

import { LOG_DIR } from '../../findcc.js';
import { _projectName, _v2Writer } from '../interceptor.js';
import { listResumeSessions } from '../lib/v2/resume-list.js';
import { projectKeyForCwd } from '../lib/system-prompt-snapshots.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import { reportSwallowed } from '@ccv/core/error-report';

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function getSessionsHandler(req, res, parsedUrl) {
  // parsedUrl is a URL object (server.js handleRequest) — read via searchParams.
  const limitRaw = Number(parsedUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 50) : 10;
  try {
    // Multi-project (2026-10): the viewed tab's hover dropdown may ask for the
    // VIEWED project's sessions via ?project= (name-sanitized by
    // listResumeSessions itself); absent ⇒ the bound project (the header's
    // current-project dropdown, the pre-multi-project behavior).
    const projectParam = parsedUrl.searchParams.get('project');
    const project = (typeof projectParam === 'string' && projectParam) ? projectParam : (_projectName || '');
    const { items, total } = listResumeSessions(LOG_DIR, { project, limit });
    // currentSessionUuid: the single live session the main process is running.
    // The client marks exactly ONE row "current" (its sessionUuid === this).
    // Null before the first sid-bearing request.
    let currentSessionUuid = null;
    try { currentSessionUuid = _v2Writer && typeof _v2Writer.currentSessionId === 'function' ? _v2Writer.currentSessionId() : null; } catch (err) { reportSwallowed('resume-route.current-sid', err); }
    sendJson(res, 200, { items, total, currentSessionUuid });
  } catch (err) {
    reportSwallowed('resume-route.list', err);
    sendJson(res, 500, { error: 'list failed' });
  }
}

// GET /api/live-processes — enumerate the LIVE main claude PTYs this server owns
// (one per activated project, kept alive across project switches), for the Header's
// parallel-project chips. Each entry: { kind:'main', project, cwd, pid, active }.
// `project` is derived from cwd via projectKeyForCwd (same mapping the interceptor
// uses for write routing). Read-only; a probe failure degrades to an empty list.
async function getLiveProcessesHandler(req, res, parsedUrl) {
  const processes = [];
  try {
    const { listLivePtys } = await import('../pty-manager.js');
    for (const p of listLivePtys()) {
      // Multi-project (2026-10, review P1): only CLAUDE main PTYs become project
      // tabs. A scratch/$EDITOR shell (ptyKind 'shell') in a differently-named
      // cwd would otherwise surface as a closable "project" tab and flip the
      // Header into the multi-project tab-bar form on its own — violating the
      // single-project parity contract.
      if (p.ptyKind && p.ptyKind !== 'claude') continue;
      processes.push({
        kind: 'main',
        project: projectKeyForCwd(p.cwd),
        cwd: p.cwd,
        pid: p.pid,
        active: p.isActive === true,
        // Multi-instance (2026-10-06): surface the per-process instanceKey so the web tab bar
        // can tell two concurrent same-cwd instances apart and target attach/close precisely.
        instanceKey: p.instanceKey || null,
      });
    }
  } catch (err) { reportSwallowed('resume-route.live-main', err); }
  sendJson(res, 200, { processes, currentProject: _projectName || '' });
}

// POST /api/live-processes/attach { project } — move the main view's PTY
// attachment to the given project's record. Powers the terminal panel after a
// chip view-switch / [+] launch: without it the shared /ws/terminal stream
// stays pinned to the last-spawned project and the viewed project's terminal
// shows the wrong screen (or never starts). Idempotent: re-attaching the
// already-active project is a no-op; unknown projects get 404 and nothing
// changes. Body capped via deps.MAX_POST_BODY like the other POST routes.
function postLiveProcessAttachHandler(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (deps && body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let project = '';
    let instanceKey = '';
    try {
      const parsed = JSON.parse(body || '{}');
      project = typeof parsed.project === 'string' ? parsed.project : '';
      instanceKey = typeof parsed.instanceKey === 'string' ? parsed.instanceKey : '';
    } catch {
      sendJson(res, 400, { ok: false, reason: 'bad-json' });
      return;
    }
    if (!project && !instanceKey) {
      sendJson(res, 400, { ok: false, reason: 'missing-project' });
      return;
    }
    try {
      const { attachPtyFor } = await import('../pty-manager.js');
      const r = attachPtyFor({ project: project || undefined, instanceKey: instanceKey || undefined });
      if (!r.ok) {
        // Multi-instance: an ambiguous project-name-only attach (2+ live same-basename
        // instances) is a 409 with the live candidates, so the client re-issues with an
        // instanceKey instead of silently pinning an arbitrary process.
        if (r.reason === 'ambiguous') {
          sendJson(res, 409, { ok: false, reason: 'ambiguous', candidates: r.candidates || [] });
          return;
        }
        sendJson(res, 404, { ok: false, reason: r.reason || 'not-found' });
        return;
      }
      sendJson(res, 200, { ok: true, project, instanceKey: r.key || instanceKey || null, running: r.running, ptyKind: r.ptyKind, exitCode: r.exitCode, switched: r.switched });
    } catch (err) {
      reportSwallowed('resume-route.attach', err);
      sendJson(res, 500, { ok: false, reason: 'attach-failed' });
    }
  });
}

// POST /api/live-processes/close { project } — kill that project's main PTY
// (the web multi-project tab bar's × button, 2026-10). Destructive, so unlike
// the read-only routes above this is admin-gated: loopback or an authenticated
// remote admin (isAdminReq; killing another user's process over LAN must not be
// possible with a mere view token). 404 when the project has no record. When
// the killed PTY was the terminal's active attachment, the server re-anchors
// the attachment to another live record internally (killedActive in the
// response); the client decides its own view repair from the remaining tab
// list (it does not need the re-anchor target).
function postLiveProcessCloseHandler(req, res, parsedUrl, isLocal, deps) {
  // Two gates, both required: admin identity (loopback or authenticated remote
  // admin) AND same-origin browser context. The server intentionally answers
  // CORS preflight permissively for legacy APIs, so without the second gate a
  // cross-site page could kill a project's process through the user's browser
  // (their token/cookie rides along). Same guard the executable-selection
  // endpoints in routes/preferences.js stack on top of isAdminReq.
  if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
    sendJson(res, 403, { ok: false, reason: 'forbidden' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (deps && body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let project = '';
    let instanceKey = '';
    try {
      const parsed = JSON.parse(body || '{}');
      project = typeof parsed.project === 'string' ? parsed.project : '';
      instanceKey = typeof parsed.instanceKey === 'string' ? parsed.instanceKey : '';
    } catch {
      sendJson(res, 400, { ok: false, reason: 'bad-json' });
      return;
    }
    if (!project && !instanceKey) {
      sendJson(res, 400, { ok: false, reason: 'missing-project' });
      return;
    }
    try {
      const { killPtyFor } = await import('../pty-manager.js');
      const r = killPtyFor({ project: project || undefined, instanceKey: instanceKey || undefined });
      if (!r.ok) {
        // Multi-instance: an ambiguous project-name-only close (2+ live same-basename
        // instances) is a 409 with the live candidates, so the client re-issues with an
        // instanceKey instead of killing an arbitrary process.
        if (r.reason === 'ambiguous') {
          sendJson(res, 409, { ok: false, reason: 'ambiguous', candidates: r.candidates || [] });
          return;
        }
        sendJson(res, 404, { ok: false, reason: r.reason || 'not-found' });
        return;
      }
      sendJson(res, 200, { ok: true, project, instanceKey: r.key || instanceKey || null, killedActive: r.killedActive === true });
    } catch (err) {
      reportSwallowed('resume-route.close', err);
      sendJson(res, 500, { ok: false, reason: 'close-failed' });
    }
  });
}

export const resumeRoutes = [
  { method: 'GET', match: 'exact', path: '/api/resume-sessions', handler: getSessionsHandler },
  { method: 'GET', match: 'exact', path: '/api/live-processes', handler: getLiveProcessesHandler },
  { method: 'POST', match: 'exact', path: '/api/live-processes/attach', handler: postLiveProcessAttachHandler },
  { method: 'POST', match: 'exact', path: '/api/live-processes/close', handler: postLiveProcessCloseHandler },
];
