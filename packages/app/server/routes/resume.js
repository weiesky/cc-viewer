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
//       project has no record. The record is kept for a later re-launch. When the
//       killed project WAS the bound one and a survivor is still live, the server
//       re-binds its workspace identity (_projectName + CCV_PROJECT_DIR) to that
//       survivor (a same-name/same-cwd twin degrades this to a dir-only rebind),
//       broadcasts workspace_started(rebound:true) so every client lands on the
//       survivor, and the response carries `rebound: { project, cwd }`.
//
//   POST /api/resume-session  { sessionUuid, project?, instanceKey? }
//       TRUE /resume (2026-10-06): inject `/resume <uuid>` into the target
//       project's running claude PTY so the process switches INTO that session
//       in place (Claude Code's native SessionStart hook then re-binds the v2
//       writer). Destructive-ish (re-points a live conversation), so admin +
//       same-origin gated like /close. 409 busy when the TUI isn't observably
//       idle, 409 ambiguous when a project-only target has 2+ live instances,
//       404 when the target isn't a live claude PTY, 400 on a bad uuid.
//
// Boundary note (verify:boundaries): routes (L3) may import lib/ (L1) and
// interceptor (L2) per the existing house pattern (session-pin.js / logs.js).
// The aggregation itself lives in lib/v2/resume-list.js (pure, unit-tested);
// this handler is a thin HTTP wrapper.

import { LOG_DIR } from '../../findcc.js';
import { _projectName, _v2Writer, initForWorkspace } from '../interceptor.js';
// Static import (not the route-local dynamic import) so the close-rebind helper
// can call listLivePtys synchronously — a static import keeps the single shared
// module instance, and module state is shared either way.
import { listLivePtys } from '../pty-manager.js';
import { listResumeSessions } from '../lib/v2/resume-list.js';
import { projectKeyForCwd } from '../lib/system-prompt-snapshots.js';
import { readClaudeProjectModel } from '../lib/context-watcher.js';
import { bumpWorkspacesVersion } from '../lib/file-access-policy.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import { sseWrite } from '../lib/wire-compress.js';
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
  let currentInstanceKey = null;
  try {
    const { listLivePtys } = await import('../pty-manager.js');
    const live = listLivePtys();
    // Bound project's own instanceKey (pure-client viewing, 2026-10-07): the identity of
    // the BOUND project — the live record whose cwd equals the server's bound root. This
    // is per-server and single-valued, deliberately NOT the shared `active` pointer (that
    // is the terminal attachment, which lags and differs per client). The header uses it
    // to single out THE bound tab among same-basename tabs without reading `active`.
    const boundCwd = process.env.CCV_PROJECT_DIR || process.cwd();
    for (const p of live) {
      // Multi-project (2026-10, review P1): only CLAUDE main PTYs become project
      // tabs. A scratch/$EDITOR shell (ptyKind 'shell') in a differently-named
      // cwd would otherwise surface as a closable "project" tab and flip the
      // Header into the multi-project tab-bar form on its own — violating the
      // single-project parity contract.
      if (p.ptyKind && p.ptyKind !== 'claude') continue;
      if (!currentInstanceKey && p.instanceKey && (p.cwd || '') === boundCwd) {
        currentInstanceKey = p.instanceKey;
      }
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
  sendJson(res, 200, { processes, currentProject: _projectName || '', currentInstanceKey });
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
// response). When the killed project WAS the bound one and a survivor is still
// live, the server ALSO re-binds its workspace identity (_projectName +
// CCV_PROJECT_DIR) to that survivor and broadcasts workspace_started(rebound:true)
// so every client lands on the survivor (the "当前项目" label would otherwise
// stay on the just-closed project); the response then carries `rebound`.
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
      // Bound-project rebound (2026-10): when the closed PTY WAS the server's bound
      // project, the binding (projectName / CCV_PROJECT_DIR / log dir) would otherwise
      // keep pointing at a dead project — the "当前项目" label stays on the just-closed
      // name while the survivor is left as a mere chip. Rebind to a survivor and
      // broadcast workspace_started so every client (including the closing tab) lands
      // on the survivor. Judgment is by the killed record's ORIGINAL cwd vs
      // CCV_PROJECT_DIR — never by basename, or a same-name twin close would false-hit.
      let rebound = null;
      try {
        rebound = _maybeRebindAfterClose(r, deps);
      } catch (err) { reportSwallowed('resume-route.close-rebind', err); }
      sendJson(res, 200, { ok: true, project, instanceKey: r.key || instanceKey || null, killedActive: r.killedActive === true, rebound });
    } catch (err) {
      reportSwallowed('resume-route.close', err);
      sendJson(res, 500, { ok: false, reason: 'close-failed' });
    }
  });
}

// Bound-project rebound helper (2026-10). After killPtyFor removed the BOUND
// project's PTY, pick a surviving live claude record and re-bind the server's
// workspace identity to it, then broadcast workspace_started (with
// `rebound:true`) so every SSE client re-scopes to the survivor. Returns
// { project, cwd } when a rebind happened, else null (closed project was not
// the bound one / no survivor / a same-cwd twin still lives / Electron
// multi-tab).
// May throw only BEFORE the rebind is applied (a pre-state-change failure →
// the caller wraps it into a 200 with rebound:null, which is accurate then);
// after the broadcast it never throws (the restart side-effects are each
// wrapped), so a returned rebound always matches reality.
//
// ORDERING INVARIANT: the broadcast is emitted BEFORE the best-effort
// feed/timer restarts, and the whole kill→rebind→broadcast block is
// synchronous (no await) — under Node's single thread no interleaved request
// can observe a half-applied rebind, and a throwing side-effect can no longer
// strand the "binding moved but nobody was told" state (the broadcast has
// already gone out by then).
function _maybeRebindAfterClose(killResult, deps) {
  // Electron multi-tab: the manager process does NOT own log init (the tab
  // workers do); mirroring workspaces.js:56, skip rebind entirely there.
  if (process.env.CCV_ELECTRON_MULTITAB === '1') return null;
  const killedCwd = typeof killResult.cwd === 'string' ? killResult.cwd : '';
  const boundCwd = process.env.CCV_PROJECT_DIR || process.cwd();
  // Exact-cwd equality, no realpath — both sides stay in the same path space
  // (a realpath would split /tmp vs /private/tmp and miss the hit).
  if (!killedCwd || killedCwd !== boundCwd) return null;

  // Pick the survivor: a still-live CLAUDE record (listLivePtys also returns
  // 'shell' scratch PTYs, which /api/live-processes itself filters out of its
  // own processes[]), preferring the record killPtyFor just re-anchored the
  // terminal attachment to (reattachedTo), then the terminal's live attachment
  // (isActive — preserves the launch-time invariant bound == attached), else
  // the first live claude record in Map order.
  const live = listLivePtys().filter((p) => p && p.cwd && (!p.ptyKind || p.ptyKind === 'claude'));
  if (!live.length) return null;
  // A same-cwd TWIN of the closed bound project still lives → the bound
  // identity (same project name, same log dir) is already correct for it;
  // rebinding away would only wipe that twin's session bindings for nothing.
  if (live.some((p) => p.cwd === killedCwd)) return null;
  const survivor = live.find((p) => p.key === killResult.reattachedTo)
    || live.find((p) => p.isActive)
    || live[0];
  if (!survivor || !survivor.cwd) return null;

  const killedName = projectKeyForCwd(killedCwd);
  const survivorProject = projectKeyForCwd(survivor.cwd);
  // initForWorkspace's scoped resetSessions keys on the SANITIZED project name
  // (v2-writer.js). So any time the CLOSED project's name still has a live
  // record (a same-name twin in another dir, or the survivor itself is a
  // same-name twin), running initForWorkspace would wipe that LIVE project's
  // session bindings. In every such case the project NAME (and thus the log
  // dir) does not change — so do a DIR-ONLY rebind instead: point
  // CCV_PROJECT_DIR at the survivor (file-tree/git/skills/allowlist roots follow
  // the live project) while skipping initForWorkspace entirely.
  const closedNameStillLive = live.some((p) => projectKeyForCwd(p.cwd) === killedName);
  const survivorIsSameName = survivorProject === killedName;
  const dirOnly = closedNameStillLive || survivorIsSameName;

  let result;
  if (dirOnly) {
    // _projectName / _logDir stay (same sanitized name — already correct);
    // only the bound ROOT moves to the surviving twin's directory.
    result = { projectName: killedName };
  } else {
    result = initForWorkspace(survivor.cwd);
  }
  process.env.CCV_PROJECT_DIR = survivor.cwd;
  // The file-access allowlist caches its roots (including the bound project
  // dir) and is only invalidated on register/remove or LOG_DIR change — none of
  // which fire on a close-rebind. Bump it so the survivor's dir is an allowed
  // root even when it never went through this server's registerWorkspace.
  try { bumpWorkspacesVersion(); } catch (err) { reportSwallowed('resume-route.close-rebind.roots', err); }

  // Broadcast workspace_started to EVERY SSE client (same fan-out as launch,
  // workspaces.js:101-107) BEFORE the throwable side-effects below, so a
  // failure there can't leave "binding moved but clients untold". Deliberately
  // NO load_start/load_chunk/load_end replay: those handlers have no project
  // guard on the client (AppBase.jsx:1990-2148) and would pour the survivor's
  // transcript into a tab that is viewing a THIRD project. Each client
  // re-scopes and cold-loads its own view on receipt (the `rebound:true`
  // marker triggers the SSE reconnect).
  const payload = `event: workspace_started\ndata: ${JSON.stringify({
    projectName: result.projectName,
    path: survivor.cwd,
    claudeProjectModel: readClaudeProjectModel(survivor.cwd),
    rebound: true,
  })}\n\n`;
  const clients = (deps && deps.clients) || [];
  clients.forEach((client) => {
    try { sseWrite(client, payload); } catch (err) { reportSwallowed('resume-route.close-rebind.write', err); }
  });

  // Best-effort feed/timer restarts for the new bound project. Without
  // startLogWatch the survivor's writer activity hits "no feed → drop" and the
  // real-time pane never updates until a manual refresh; statsWorker/
  // streamingStatusTimer mirror workspaces.js:71-75. All deps.* are
  // optional-chained so unit tests need only stub what they assert on. Each is
  // individually wrapped AND runs AFTER the broadcast: if one throws it is
  // reported and swallowed, never turning the (already-applied) rebind into a
  // misleading rebound:null on the 200 response.
  if (deps && typeof deps.startLogWatch === 'function') {
    try { deps.startLogWatch(); } catch (err) { reportSwallowed('resume-route.close-rebind.logwatch', err); }
  }
  if (deps && !deps.statsWorker && typeof deps.startStatsWorker === 'function') {
    try { deps.startStatsWorker(); } catch (err) { reportSwallowed('resume-route.close-rebind.stats', err); }
  }
  if (deps && typeof deps.startStreamingStatusTimer === 'function') {
    try { deps.startStreamingStatusTimer(); } catch (err) { reportSwallowed('resume-route.close-rebind.stream', err); }
  }
  return { project: result.projectName, cwd: survivor.cwd };
}

const RESUME_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/resume-session { sessionUuid, project?, instanceKey? } — TRUE /resume:
// inject `/resume <uuid>` into the target project's live claude PTY so the running
// process switches INTO that session in place. Admin + same-origin gated (it re-points
// a live conversation). See the header comment for the status/reason mapping.
function postResumeSessionHandler(req, res, parsedUrl, isLocal, deps) {
  if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
    sendJson(res, 403, { ok: false, reason: 'forbidden' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (deps && body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let sessionUuid = '';
    let project = '';
    let instanceKey = '';
    try {
      const parsed = JSON.parse(body || '{}');
      sessionUuid = typeof parsed.sessionUuid === 'string' ? parsed.sessionUuid.trim() : '';
      project = typeof parsed.project === 'string' ? parsed.project : '';
      instanceKey = typeof parsed.instanceKey === 'string' ? parsed.instanceKey : '';
    } catch {
      sendJson(res, 400, { ok: false, reason: 'bad-json' });
      return;
    }
    if (!sessionUuid) {
      sendJson(res, 400, { ok: false, reason: 'missing-session' });
      return;
    }
    // Shape-validate BEFORE it ever reaches the TUI paste buffer (defense-in-depth;
    // sanitizeInbound alone would still let `;`, quotes, `$()` through).
    if (!RESUME_UUID_RE.test(sessionUuid)) {
      sendJson(res, 400, { ok: false, reason: 'bad-uuid' });
      return;
    }
    try {
      const pm = await import('../pty-manager.js');
      const targetProject = project || (_projectName || '');
      // Multi-instance: a project-name-only resume that matches 2+ live same-basename
      // instances is ambiguous — refuse with the candidates so the client re-issues
      // with an instanceKey (mirror of attach/close).
      if (!instanceKey && targetProject) {
        const live = pm.liveInstancesForProject(targetProject);
        if (live.length > 1) {
          sendJson(res, 409, { ok: false, reason: 'ambiguous', candidates: live });
          return;
        }
      }
      // Strict target-kind gate (no active-PTY fallback): never inject into the wrong
      // project's conversation when the anchor doesn't resolve, and never into a shell.
      if (pm.getPtyKindFor({ project: targetProject || undefined, instanceKey: instanceKey || undefined }) !== 'claude') {
        sendJson(res, 404, { ok: false, reason: 'not-found' });
        return;
      }
      const chatQueue = await import('../lib/chat-queue.js');
      const r = await chatQueue.injectResumeCommand(sessionUuid, { project: targetProject || undefined, instanceKey: instanceKey || undefined });
      if (r.ok) {
        // Session identity just changed — drop any still-queued composer messages so a
        // message typed for the OLD conversation never drains into the resumed one.
        try { chatQueue.clear(); } catch (err) { reportSwallowed('resume-route.clear-queue', err); }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (r.reason === 'busy') { sendJson(res, 409, { ok: false, reason: 'busy' }); return; }
      if (r.reason === 'bad-uuid') { sendJson(res, 400, { ok: false, reason: 'bad-uuid' }); return; }
      if (r.reason === 'no-deps') { sendJson(res, 409, { ok: false, reason: 'unavailable' }); return; }
      sendJson(res, 500, { ok: false, reason: r.reason || 'inject-failed' });
    } catch (err) {
      reportSwallowed('resume-route.resume', err);
      sendJson(res, 500, { ok: false, reason: 'resume-failed' });
    }
  });
}

export const resumeRoutes = [
  { method: 'GET', match: 'exact', path: '/api/resume-sessions', handler: getSessionsHandler },
  { method: 'GET', match: 'exact', path: '/api/live-processes', handler: getLiveProcessesHandler },
  { method: 'POST', match: 'exact', path: '/api/live-processes/attach', handler: postLiveProcessAttachHandler },
  { method: 'POST', match: 'exact', path: '/api/live-processes/close', handler: postLiveProcessCloseHandler },
  { method: 'POST', match: 'exact', path: '/api/resume-session', handler: postResumeSessionHandler },
];
