// Scheduled-task REST routes (L3).
//
//   GET  /api/scheduled-tasks?project=&instance=   → list (+ serverTime/timezone/spawnAvailable)
//   POST /api/scheduled-tasks                      → create
//   POST /api/scheduled-tasks/update               → update / pause / resume
//   POST /api/scheduled-tasks/delete               → delete
//   POST /api/scheduled-tasks/run                  → Run now
//   POST /api/scheduled-tasks/preview              → next 3 base fire times for a schedule
//   GET  /api/scheduled-tasks/runs?id=&project=    → recent runs for one task
//
// Auth: reads need only a logged-in viewer; WRITES are admin + same-origin (a scheduled
// task injects a prompt into a session / spawns a headless agent — same trust level as
// the resume/upload writers, mirroring routes/resume.js:492).
//
// project → cwd resolution (a task stores an ABSOLUTE cwd, not just a project name, so
// same-basename workspaces never cross-execute — review §6): explicit project → the
// bound project when it matches, else an instance/registry match; ambiguous → 409;
// unresolvable → 404 (never silently fall back to the server's process cwd — P1-6).
//
// Boundary: L3 may import L1 (lib/*) and L2 (pty-manager/interceptor). The scheduler
// singleton is imported directly (L3→L1); server.js owns its init/start/stop.

import { _projectName } from '../interceptor.js';
import { LOG_DIR } from '../../findcc.js';
import { listLivePtys } from '../pty-manager.js';
import { sendEventToClients } from '../lib/log-watcher.js';
import { filterClientsByViewProject } from '../lib/v2/view-router.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import { reportSwallowed } from '../lib/error-report.js';
import { normalizeSchedule, nextBaseFor } from '../lib/schedule-model.js';
import {
  createTask, updateTask, deleteTask, getTask, readScheduledTasks,
} from '../lib/scheduled-task-store.js';
import { readScheduledTaskRuns } from '../lib/scheduled-task-runs-store.js';
import { runTaskNow, spawnAvailable } from '../lib/scheduled-task-scheduler.js';
import { loadWorkspaces } from '../workspace-registry.js';
import { listSdkSessionInstances } from '../lib/sdk-session-index.js';

const MAX_BODY = 1 << 20;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function _readBody(req, res, deps, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > (deps?.MAX_POST_BODY || MAX_BODY)) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = body ? JSON.parse(body) : {}; }
    catch { sendJson(res, 400, { ok: false, error: 'invalid_json' }); return; }
    cb(parsed);
  });
  req.on('error', () => { try { sendJson(res, 400, { ok: false, error: 'invalid_json' }); } catch {} });
}

function _guardWrite(req, res, parsedUrl, isLocal) {
  if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' });
    return false;
  }
  return true;
}

/** Broadcast a task_changed frame to the project's viewers. */
function _broadcastChanged(deps, project, taskId, action) {
  try {
    sendEventToClients(
      filterClientsByViewProject(deps.clients, project, _projectName || ''),
      'scheduled_tasks',
      { type: 'task_changed', project, taskId, action },
    );
  } catch (err) { reportSwallowed('scheduled-tasks.broadcast', err); }
}

/**
 * Resolve a project name (or explicit instance) to an ABSOLUTE cwd. Returns
 * { ok:true, cwd } | { ok:false, status, error }.
 */
function _resolveProjectToCwd(project, instance) {
  const bound = _projectName || '';
  // 1. An explicit instance (SDK session / live PTY) pins the cwd EXACTLY — it wins over
  //    the project name so two same-basename workspaces never cross-execute (review: the
  //    bound-project branch must not shadow a deliberate instance pick).
  if (instance) {
    try {
      const sdkHit = listSdkSessionInstances().find(s => s.instanceKey === instance);
      if (sdkHit && sdkHit.cwd) {
        // Consistency: the instance's cwd must actually belong to the named project,
        // else this is a forged/mismatched project+instance pair (security review).
        if (!project || project === bound || _projectNameOf(sdkHit.cwd) === project) return { ok: true, cwd: sdkHit.cwd };
        return { ok: false, status: 409, error: 'project_ambiguous' };
      }
    } catch { /* fall through */ }
    const ptyHit = listLivePtys().find(p => p.instanceKey === instance && p.ptyKind === 'claude');
    if (ptyHit) {
      if (!project || project === bound || _projectNameOf(ptyHit.cwd) === project) return { ok: true, cwd: ptyHit.cwd };
      return { ok: false, status: 409, error: 'project_ambiguous' };
    }
    // An explicit instance that resolves to nothing is an error, not a silent fallback.
    return { ok: false, status: 404, error: 'project_unresolved' };
  }
  // 2. The bound project (the common case) → the server's own cwd / CCV_PROJECT_DIR.
  if (!project || project === bound) {
    const cwd = process.env.CCV_PROJECT_DIR || (bound ? process.cwd() : null);
    // P1-6: no bound project AND no explicit project → unresolvable (never process.cwd()).
    if (!cwd) return { ok: false, status: 404, error: 'project_unresolved' };
    return { ok: true, cwd };
  }
  // 3. The workspace registry: a unique projectName match → its path.
  let matches = [];
  try {
    matches = loadWorkspaces().filter(w => w.projectName === project && w.path);
  } catch (err) { reportSwallowed('scheduled-tasks.registry', err); }
  if (matches.length === 1) return { ok: true, cwd: matches[0].path };
  if (matches.length > 1) return { ok: false, status: 409, error: 'project_ambiguous' };
  return { ok: false, status: 404, error: 'project_unresolved' };
}

// Project key (sanitized basename) for a cwd, matching the store/UI naming.
function _projectNameOf(cwd) {
  const base = String(cwd || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return base.replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

/** Public list for a project (bound project when omitted). */
function listHandler(req, res, parsedUrl) {
  const project = parsedUrl.searchParams.get('project') || (_projectName || '');
  const root = LOG_DIR;
  let reg = { tasks: [], corrupt: false };
  try {
    reg = readScheduledTasks(root);
  } catch (err) {
    reportSwallowed('scheduled-tasks.list', err);
    reg = { tasks: [], corrupt: true };
  }
  if (reg.corrupt) reportSwallowed('scheduled-tasks.list.corrupt', new Error('preferences.json scheduledTasks is corrupt'));
  // Prompt secrecy (review): a project query only earns full prompts when it actually
  // resolves to a known project (bound / registry / live). Otherwise fall back to the
  // summary shape so an arbitrary ?project= can't pull another project's prompt text.
  const resolved = project ? _resolveProjectToCwd(project, parsedUrl.searchParams.get('instance') || '') : { ok: false };
  const fullPrompt = !!project && resolved.ok;
  const tasks = (reg.tasks || []).filter(t => !project || t.project === project);
  const running = new Set();
  for (const t of tasks) if (t.claim) running.add(t.id);
  const shaped = fullPrompt
    ? tasks.map(t => ({ ..._publicTask(t), running: running.has(t.id), ...(reg.legacy ? { legacy: true } : {}) }))
    : tasks.map(t => ({ ..._listTask(t), running: running.has(t.id), ...(reg.legacy ? { legacy: true } : {}) }));
  sendJson(res, 200, {
    tasks: shaped,
    serverTime: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    spawnAvailable: _spawnAvailableSafe(),
    storeCorrupt: !!reg.corrupt,
  });
}

function _publicTask(t) {
  const { runs, claim, ...rest } = t;
  return rest;
}

// List payload keeps the full prompt OUT (it may carry secrets and every logged-in
// viewer can read the list — security P2-3). Full prompts only ship when the project
// resolves (bound / registry / live instance — see listHandler's fullPrompt gate).
function _listTask(t) {
  const p = _publicTask(t);
  p.promptSummary = String(t.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  delete p.prompt;
  return p;
}

function _spawnAvailableSafe() {
  try { return spawnAvailable(); } catch { return false; }
}

function createHandler(req, res, parsedUrl, isLocal, deps) {
  if (!_guardWrite(req, res, parsedUrl, isLocal)) return;
  _readBody(req, res, deps, async (body) => {
    const project = (typeof body.project === 'string' && body.project) || (_projectName || '');
    const resolved = _resolveProjectToCwd(project, body.instance);
    if (!resolved.ok) return sendJson(res, resolved.status, { ok: false, error: resolved.error });
    if (body.mode === 'spawn' && !_spawnAvailableSafe()) {
      return sendJson(res, 400, { ok: false, error: 'spawn_unavailable' });
    }
    let out;
    try {
      out = await createTask(LOG_DIR, {
        project, cwd: resolved.cwd, prompt: body.prompt, mode: body.mode,
        schedule: body.schedule, enabled: body.enabled,
      }, Date.now());
    } catch (err) {
      reportSwallowed('scheduled-tasks.create', err);
      return sendJson(res, 500, { ok: false, error: 'store_corrupt' });
    }
    if (!out.ok) return sendJson(res, 400, { ok: false, error: out.reason, detail: out.detail });
    _broadcastChanged(deps, project, out.task.id, 'created');
    sendJson(res, 200, { ok: true, task: _publicTask(out.task) });
  });
}

function updateHandler(req, res, parsedUrl, isLocal, deps) {
  if (!_guardWrite(req, res, parsedUrl, isLocal)) return;
  _readBody(req, res, deps, async (body) => {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return sendJson(res, 400, { ok: false, error: 'task_not_found' });
    let out;
    try {
      out = await updateTask(LOG_DIR, id, {
        prompt: body.prompt, mode: body.mode, schedule: body.schedule, enabled: body.enabled,
      }, Date.now());
    } catch (err) {
      reportSwallowed('scheduled-tasks.update', err);
      return sendJson(res, 500, { ok: false, error: 'store_corrupt' });
    }
    if (!out.ok) return sendJson(res, out.reason === 'task_not_found' ? 404 : 400, { ok: false, error: out.reason, detail: out.detail });
    _broadcastChanged(deps, out.task.project, id, 'updated');
    sendJson(res, 200, { ok: true, task: _publicTask(out.task) });
  });
}

function deleteHandler(req, res, parsedUrl, isLocal, deps) {
  if (!_guardWrite(req, res, parsedUrl, isLocal)) return;
  _readBody(req, res, deps, async (body) => {
    const id = typeof body.id === 'string' ? body.id : '';
    let task = null;
    try { task = getTask(LOG_DIR, id); } catch { /* tolerate */ }
    let out;
    try { out = await deleteTask(LOG_DIR, id, Date.now()); }
    catch (err) {
      reportSwallowed('scheduled-tasks.delete', err);
      return sendJson(res, 500, { ok: false, error: 'store_corrupt' });
    }
    if (!out.ok) {
      const status = out.reason === 'task_not_found' ? 404 : (out.reason === 'task_running' ? 409 : 400);
      return sendJson(res, status, { ok: false, error: out.reason });
    }
    _broadcastChanged(deps, (task && task.project) || body.project || (_projectName || ''), id, 'deleted');
    sendJson(res, 200, { ok: true });
  });
}

function runHandler(req, res, parsedUrl, isLocal, deps) {
  if (!_guardWrite(req, res, parsedUrl, isLocal)) return;
  _readBody(req, res, deps, async (body) => {
    const id = typeof body.id === 'string' ? body.id : '';
    let out;
    try { out = await runTaskNow(id, { manual: true }); }
    catch (err) {
      reportSwallowed('scheduled-tasks.run', err);
      return sendJson(res, 503, { ok: false, error: 'scheduler_unavailable' });
    }
    if (!out.ok) {
      const status = out.reason === 'scheduler_unavailable' ? 503
        : out.reason === 'running' ? 409
        : out.reason === 'not-found' ? 404 : 400;
      return sendJson(res, status, { ok: false, error: out.reason === 'not-found' ? 'task_not_found' : out.reason });
    }
    sendJson(res, 202, { ok: true, runId: out.runId ?? null });
  });
}

function previewHandler(req, res, parsedUrl, isLocal, deps) {
  if (!_guardWrite(req, res, parsedUrl, isLocal)) return;
  _readBody(req, res, deps, (body) => {
    const now = Date.now();
    const norm = normalizeSchedule(body.schedule, now);
    if (!norm.ok) return sendJson(res, 400, { ok: false, error: norm.error, detail: norm.detail });
    const next = [];
    let cursor = now;
    for (let i = 0; i < 3; i++) {
      const t = nextBaseFor(norm.schedule, cursor);
      if (t === null) break;
      next.push(t);
      cursor = t;
    }
    sendJson(res, 200, {
      ok: true, next,
      serverTime: now,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  });
}

function runsHandler(req, res, parsedUrl) {
  const id = parsedUrl.searchParams.get('id') || '';
  const reqProject = parsedUrl.searchParams.get('project') || (_projectName || '');
  let task = null;
  try { task = getTask(LOG_DIR, id); } catch (err) { reportSwallowed('scheduled-tasks.runs', err); }
  if (!task) return sendJson(res, 404, { ok: false, error: 'task_not_found' });
  // Runs carry the prompt summary + sessionId — scope them to the task's own project so a
  // viewer of project A can't read project B's run history by id (security P2-3).
  if (reqProject && task.project !== reqProject) return sendJson(res, 403, { ok: false, error: 'forbidden' });
  let runs = [];
  try { runs = readScheduledTaskRuns(LOG_DIR, id); }
  catch (err) { reportSwallowed('scheduled-tasks.runs.read', err); }
  sendJson(res, 200, { ok: true, runs: runs.slice(-20), serverTime: Date.now() });
}

export const scheduledTasksRoutes = [
  { method: 'GET', match: 'exact', path: '/api/scheduled-tasks', handler: listHandler },
  { method: 'GET', match: 'exact', path: '/api/scheduled-tasks/runs', handler: runsHandler },
  { method: 'POST', match: 'exact', path: '/api/scheduled-tasks', handler: createHandler },
  { method: 'POST', match: 'exact', path: '/api/scheduled-tasks/update', handler: updateHandler },
  { method: 'POST', match: 'exact', path: '/api/scheduled-tasks/delete', handler: deleteHandler },
  { method: 'POST', match: 'exact', path: '/api/scheduled-tasks/run', handler: runHandler },
  { method: 'POST', match: 'exact', path: '/api/scheduled-tasks/preview', handler: previewHandler },
];
