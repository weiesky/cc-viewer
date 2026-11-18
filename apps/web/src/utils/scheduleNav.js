// Pure helpers for the scheduled-task sidebar nav button (ScheduleNavButton).
// Extracted from the component so they are unit-testable under plain node --test
// (the web test suite has no JSX transform).

/**
 * Filter to "pending" tasks: enabled, has a finite nextRunAt, not currently running.
 * Sorted by nextRunAt ascending (soonest first).
 * Paused tasks (enabled === false) are excluded even though the server keeps their
 * nextRunAt — the user explicitly does not want them in the nav list.
 * Running recurring tasks are excluded: the server advances their nextRunAt to the
 * next occurrence on claim, so `enabled && nextRunAt` alone would still show them.
 */
export function pendingTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t && t.enabled !== false && Number.isFinite(t.nextRunAt) && !t.running)
    .sort((a, b) => a.nextRunAt - b.nextRunAt);
}

/**
 * Row preview text: first line, 60 chars max, falling back to an em dash when empty.
 * Uses promptSummary when present (summary shape from unresolved projects) and falls
 * back to prompt (full shape from resolved projects) — mirrors the modal list row
 * rendering in ScheduleTaskModal.
 */
export function taskPreview(task) {
  const raw = String(task?.promptSummary || task?.prompt || '');
  return raw.split('\n')[0].slice(0, 60) || '—';
}

/**
 * Clock offset between server and client (serverTime - clientNow), used to correct
 * countdown deadlines for client clock skew. Returns 0 when serverTime is missing
 * or non-finite so the countdown degrades to uncorrected wall-clock time.
 */
export function serverClockOffset(serverTime, clientNow = Date.now()) {
  return Number.isFinite(serverTime) ? serverTime - clientNow : 0;
}
