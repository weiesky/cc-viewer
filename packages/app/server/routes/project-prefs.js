// Per-project independent-preferences routes.
//
// Lets a project keep its own forked copy of the preferences (so several developers
// sharing one ccv over the LAN don't stomp each other's global prefs):
//   - POST /api/project-prefs/toggle  {enabled}        — fork/unfork the CURRENT project
//   - POST /api/project-prefs/update  {project?, patch} — edit a fork (current, or any project from loopback)
//   - POST /api/project-prefs/delete  {project}         — delete a fork (loopback admin only)
//   - GET  /api/project-prefs                           — list every fork + contents (loopback admin only)
//
// Forks never carry secrets (auth / IM creds are stripped on snapshot AND on read). All
// writes go through prefs-store.mutatePrefs (locked + atomic). Admin operations on an
// arbitrary project are loopback-gated server-side regardless of the client UI.
import { basename } from 'node:path';
import { LOG_DIR } from '../../findcc.js';
import { reconcileVoicePackPrefs as vpReconcile } from '../lib/voice-pack-manager.js';
import { mutatePrefs, applyPrefsPatch, readPrefsRaw } from '../lib/prefs-store.js';
import {
  getCurrentProjectKey, hasActiveProject, snapshotForFork, stripSensitive,
} from '../lib/project-prefs.js';

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req, deps) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad-json')); } });
    req.on('error', reject);
  });
}

/** Sanitize an incoming patch: no secrets, no machine-level paths, no internal/meta keys. */
function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  const out = { ...patch };
  for (const k of Object.keys(out)) if (k[0] === '_') delete out[k];
  stripSensitive(out); // 含 auth/IM + logDir/claudeConfigDir + prefsByProject（单一来源）
  return out;
}

// POST /api/project-prefs/toggle — fork (snapshot global) or unfork the current project.
// Scoped to the current project only (no privilege escalation), so allowed from any client.
async function toggleHandler(req, res, parsedUrl, isLocal, deps) {
  let body;
  try { body = await readBody(req, deps); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  if (!hasActiveProject()) return sendJson(res, 409, { error: 'no-active-project' });
  const key = getCurrentProjectKey();
  const enabled = !!body.enabled;
  await mutatePrefs((p) => {
    if (!p.prefsByProject || typeof p.prefsByProject !== 'object') p.prefsByProject = {};
    if (enabled) {
      if (!Object.prototype.hasOwnProperty.call(p.prefsByProject, key)) {
        p.prefsByProject[key] = snapshotForFork(p);
      }
    } else if (Object.prototype.hasOwnProperty.call(p.prefsByProject, key)) {
      delete p.prefsByProject[key];
    }
    if (Object.keys(p.prefsByProject).length === 0) delete p.prefsByProject;
  });
  sendJson(res, 200, { ok: true, projectScoped: enabled });
}

// POST /api/project-prefs/update — merge a patch into a fork. project omitted ⇒ current
// (any client, requires an existing fork); project given ⇒ loopback admin only.
async function updateHandler(req, res, parsedUrl, isLocal, deps) {
  let body;
  try { body = await readBody(req, deps); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  // 指定 project（改任意项目 fork）仅限本机；按"存在且为非空字符串"判定，避免 {project:""}/{project:{}}
  // 绕过门禁或误入当前项目分支（与 deleteHandler 的类型校验对齐）。鉴权早于 cleanPatch。
  const hasProject = typeof body.project === 'string' && body.project;
  let key;
  if (hasProject) {
    if (!isLocal) return sendJson(res, 403, { error: 'forbidden' });
    key = body.project;
  } else {
    if (!hasActiveProject()) return sendJson(res, 409, { error: 'no-active-project' });
    key = getCurrentProjectKey();
  }
  const patch = cleanPatch(body.patch);
  let found = false;
  await mutatePrefs((p) => {
    if (p.prefsByProject && Object.prototype.hasOwnProperty.call(p.prefsByProject, key)) {
      applyPrefsPatch(p.prefsByProject[key], patch, { logDir: LOG_DIR });
      found = true;
    }
  });
  if (!found) return sendJson(res, 404, { error: 'no-fork' });
  sendJson(res, 200, { ok: true });
}

// POST /api/project-prefs/delete — remove a fork. Loopback admin only.
async function deleteHandler(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) return sendJson(res, 403, { error: 'forbidden' });
  let body;
  try { body = await readBody(req, deps); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
  const key = body.project;
  if (!key || typeof key !== 'string') return sendJson(res, 400, { error: 'project-required' });
  await mutatePrefs((p) => {
    if (p.prefsByProject && Object.prototype.hasOwnProperty.call(p.prefsByProject, key)) {
      delete p.prefsByProject[key];
      if (Object.keys(p.prefsByProject).length === 0) delete p.prefsByProject;
    }
  });
  sendJson(res, 200, { ok: true });
}

// GET /api/project-prefs — every fork + contents (for the loopback management modal).
function listHandler(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) return sendJson(res, 403, { error: 'forbidden' });
  const prefs = readPrefsRaw();
  const forks = (prefs && prefs.prefsByProject && typeof prefs.prefsByProject === 'object') ? prefs.prefsByProject : {};
  const currentKey = getCurrentProjectKey();
  const projects = {};
  for (const [dir, fork] of Object.entries(forks)) {
    const clean = stripSensitive(JSON.parse(JSON.stringify(fork || {})));
    if (clean.approvalModal?.voicePack) {
      clean.approvalModal.voicePack = vpReconcile(LOG_DIR, clean.approvalModal.voicePack);
    }
    projects[dir] = { name: basename(dir), dir, prefs: clean, isCurrent: dir === currentKey };
  }
  sendJson(res, 200, { projects });
}

export const projectPrefsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/project-prefs', handler: listHandler },
  { method: 'POST', match: 'exact', path: '/api/project-prefs/toggle', handler: toggleHandler },
  { method: 'POST', match: 'exact', path: '/api/project-prefs/update', handler: updateHandler },
  { method: 'POST', match: 'exact', path: '/api/project-prefs/delete', handler: deleteHandler },
];
