import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import { reportSwallowed } from '../lib/error-report.js';

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

function allowed(req, res, parsedUrl, isLocal) {
  if (isAdminReq(req, isLocal) && isSameOriginBrowserRequest(req, parsedUrl)) return true;
  json(res, 403, { error: 'Forbidden: admin and same-origin required' });
  return false;
}

async function status(req, res, parsedUrl, isLocal, deps) {
  if (!allowed(req, res, parsedUrl, isLocal)) return;
  json(res, 200, deps.updateJob.getState());
}

async function check(req, res, parsedUrl, isLocal, deps) {
  if (!allowed(req, res, parsedUrl, isLocal)) return;
  const state = await deps.updateJob.check();
  json(res, state.status === 'error' ? 502 : 200, state);
}

async function start(req, res, parsedUrl, isLocal, deps) {
  if (!allowed(req, res, parsedUrl, isLocal)) return;
  if (deps.isRuntimeStopping) { json(res, 409, { error: 'Server is stopping' }); return; }
  if (!deps.canRestartProcess && deps.updateJob.getState().status !== 'restart_required') {
    json(res, 409, { error: 'Restart is unavailable for this launch mode' });
    return;
  }
  if (['checking', 'downloading', 'installing', 'restarting', 'restart_required'].includes(deps.updateJob.getState().status)) {
    json(res, 200, deps.updateJob.getState());
    return;
  }
  deps.updateJob.start().catch((err) => reportSwallowed('update.start', err));
  json(res, 202, deps.updateJob.getState());
}

async function restart(req, res, parsedUrl, isLocal, deps) {
  if (!allowed(req, res, parsedUrl, isLocal)) return;
  if (deps.isRuntimeStopping) { json(res, 409, { error: 'Server is stopping', code: 'stopping' }); return; }
  if (!['restart_required', 'restarting'].includes(deps.updateJob.getState().status)) { json(res, 409, { error: 'No verified update is ready', code: 'not_ready' }); return; }
  if (!deps.canRestartProcess) { json(res, 409, { error: 'Restart is unavailable for this launch mode' }); return; }
  try {
    await deps.updateJob.restart(deps.restartProcess);
    if (!res.writableEnded) json(res, 200, { ok: true, status: 'restarting' });
  } catch (err) { reportSwallowed('update.restart', err); if (!res.writableEnded) json(res, 500, { error: err.message }); }
}

export const updateRoutes = [
  { method: 'GET', match: 'exact', path: '/api/update/status', handler: status },
  { method: 'POST', match: 'exact', path: '/api/update/check', handler: check },
  { method: 'POST', match: 'exact', path: '/api/update/start', handler: start },
  { method: 'POST', match: 'exact', path: '/api/update/restart', handler: restart },
];
