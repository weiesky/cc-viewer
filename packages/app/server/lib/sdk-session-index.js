// Synchronous read-only projection of the SDK session registry. Generic view
// routing must not import sdk-manager (and eagerly load the Agent SDK) in PTY mode.
import { reportSwallowed } from '../lib/error-report.js';

let _listSessions = null;

export function registerSdkSessionLister(lister) {
  _listSessions = typeof lister === 'function' ? lister : null;
}

export function listSdkSessionInstances() {
  if (!_listSessions) return [];
  try {
    const rows = _listSessions();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    reportSwallowed('sdk-session-index.list', err);
    return [];
  }
}

export function findSdkSessionByInstance(instanceKey) {
  if (typeof instanceKey !== 'string' || !/^ccv-[0-9a-f]+$/.test(instanceKey)) return null;
  return listSdkSessionInstances().find((s) => s && s.instanceKey === instanceKey) || null;
}
