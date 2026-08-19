// Mutable "current project name" state — shared leaf (same pattern as findcc's
// LOG_DIR). server/interceptor.js owns the value and pushes it at every rebind
// (module init, initForWorkspace, resetWorkspace); lib readers such as
// project-prefs.js must not import the interceptor (a stateful L2 module), so
// they read through this leaf instead.

let _currentProjectName = '';

export function getProjectName() {
  return _currentProjectName;
}

export function setProjectName(name) {
  _currentProjectName = typeof name === 'string' ? name : '';
}
