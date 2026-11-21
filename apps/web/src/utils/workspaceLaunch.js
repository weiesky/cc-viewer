// Shared workspace launcher used by the workspace picker (WorkspaceList) and the
// file explorer's "New Workspace (Session)" context-menu item, so both stay
// identical:
//  - `-c` is injected iff the folder already has logs (logCount > 0);
//  - Electron multi-tab (workspace view's window.electronAPI.launchWorkspace, tab
//    content's window.tabBridge.launchWorkspace) opens a NEW tab via IPC → the
//    caller must NOT re-anchor its own view (openedElsewhere);
//  - any other caller (browser / CLI web) POSTs /api/workspaces/launch and
//    re-anchors via the returned { projectName }.
import { apiUrl } from './apiUrl.js';

// Transport failures are browser-localized (Chromium "Failed to fetch", Safari
// "Load failed", Firefox "NetworkError…") — string matching is hopeless, so the
// reliable signal is TypeError (fetch's rejection type). Callers use this to
// pick a stable localized fallback instead of leaking raw browser text.
export function isTransportError(err) {
  return err instanceof TypeError || !err?.message || err.message.startsWith('HTTP ');
}

export async function launchWorkspace(path, { logCount = 0 } = {}) {
  const extraArgs = logCount > 0 ? ['-c'] : [];
  const ipcLaunch = window.electronAPI?.launchWorkspace || window.tabBridge?.launchWorkspace;
  if (ipcLaunch) {
    // The IPC goes to main's createTab — the new tab owns the launched workspace.
    // Never POST from a tab: the per-tab worker is NOT under CCV_ELECTRON_MULTITAB,
    // so the route would re-init this tab in place (orphaned PTY, dead channel).
    ipcLaunch(path, extraArgs);
    return { openedElsewhere: true, projectName: '' };
  }
  const res = await fetch(apiUrl('/api/workspaces/launch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, extraArgs }),
  });
  const data = await res.json().catch(() => null);
  if (!data || !res.ok || data.error) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return { openedElsewhere: false, projectName: data.projectName || '' };
}
