// Current view scope — the single source of truth for "which project/instance the UI is
// looking at", mirrored from the App-level React state so non-React consumers (apiUrl's
// withViewParams fallback) can resolve the same scope without prop-drilling.
//
// Why a module singleton: dozens of view-scoped READ call sites build `?project=` via
// withViewParams. When the BOUND view is one of two same-basename projects, those calls
// carry no `?instance=` and the server's view-root 400s "ambiguous project name". Routing
// every call site through React props is the "逐个改" we want to avoid; instead the App
// layer writes the scope here once per update, and withViewParams falls back to it.
//
// The instance rule mirrors App.jsx's viewInstanceForChat: an attached parallel view uses
// its own viewedInstance; the BOUND view (viewedProject null) falls back to the
// Header-reported bound instance ONLY when the viewed name IS the bound name (a same-name
// bound view) — a single/different project keeps null (no spurious instance).

const _scope = {
  projectName: null,     // the BOUND project name (currentProject)
  viewedProject: null,   // the attached parallel view's project (null = bound view)
  viewedInstance: null,  // the attached parallel view's instanceKey (null = bound view)
  boundInstance: null,   // the bound project's instanceKey (only set when duplicated+resolvable)
};

/** Merge the latest view scope. Called from App-level componentDidUpdate. */
export function setViewScope(partial) {
  if (!partial || typeof partial !== 'object') return;
  for (const k of Object.keys(_scope)) {
    if (k in partial) _scope[k] = partial[k] || null;
  }
}

/**
 * Resolve the current view scope for a view-scoped READ request.
 * @returns {{ project: string|null, instance: string|null }}
 *   project — the project the UI is looking at (viewedProject else bound projectName).
 *   instance — viewedInstance when set; else boundInstance ONLY on a same-name bound view
 *   (viewed name === bound name); else null.
 */
export function resolveViewScope() {
  const project = _scope.viewedProject || _scope.projectName || null;
  const viewedName = _scope.viewedProject || _scope.projectName;
  const instance = _scope.viewedInstance
    || (viewedName && viewedName === _scope.projectName ? _scope.boundInstance : null);
  return { project, instance: instance || null };
}

/** Test hook: reset the singleton to its empty state (node:test isolation). */
export function _resetViewScopeForTests() {
  for (const k of Object.keys(_scope)) _scope[k] = null;
}
