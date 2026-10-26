import { projectKeyFromCwd } from './projectKeyFromCwd.js';

// Match the existing SDK frame view guard so an auto-action cannot outlive its view.
export function sdkPlanMatchesView(pending, viewProject, viewInstance) {
  const frameProject = pending?.cwd ? projectKeyFromCwd(pending.cwd) : pending?.project || '';
  if (viewProject && frameProject && frameProject !== viewProject) return false;
  if (viewInstance && pending?.instanceKey && pending.instanceKey !== viewInstance) return false;
  return true;
}

// Select the pending plan owned by the active transport. Never fall back to the
// other channel: PTY keystrokes cannot resolve an SDK permission request.
export function resolvePlanAutoApproveTarget({ sdkMode, pendingPlanApproval, pendingPtyPlan, viewProject, viewInstance }) {
  // An unresolved view is not ownership: never auto-answer a background session
  // while project/instance hydration is still in flight.
  if (sdkMode && (!viewProject || !sdkPlanMatchesView(pendingPlanApproval, viewProject, viewInstance))) return null;
  const pending = sdkMode ? pendingPlanApproval : pendingPtyPlan;
  if (!pending?.id) return null;
  return { id: pending.id, channel: sdkMode ? 'sdk' : 'pty' };
}
