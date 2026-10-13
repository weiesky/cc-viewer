// Per-workspace SSE scope keys (2026-10): one scope = one broadcast domain on
// the server, one persistent channel on the client. The BOUND project's scope
// key is the EMPTY STRING sentinel — every producer/state map then collapses to
// exactly one bucket when no parallel workspace exists (byte-identical legacy
// behavior). Pure module, no imports.

/** Bound-scope sentinel: never a real project name (projectKeyForCwd/sanitizePathComponent
 *  never yield ''). */
export const BOUND_SCOPE = '';

/**
 * Build the canonical scope key for a (project, instance) pair.
 * - no project ⇒ BOUND_SCOPE ('')
 * - project alone ⇒ project
 * - project + instance ⇒ `project\x00instance` (NUL-separated — a project name
 *   can never contain NUL, so the composite is collision-free)
 * @param {string|null|undefined} project
 * @param {string|null|undefined} instance
 * @returns {string} '' | project | `project\x00instance`
 */
export function scopeKeyOf(project, instance) {
  const p = (typeof project === 'string' && project) ? project : '';
  if (!p) return BOUND_SCOPE;
  const i = (typeof instance === 'string' && instance) ? instance : '';
  return i ? `${p}\x00${i}` : p;
}

/**
 * Inverse of scopeKeyOf. '' ⇒ the bound scope ({project:'', instance:null}).
 * @param {string} key
 * @returns {{project: string, instance: string|null}}
 */
export function parseScopeKey(key) {
  if (typeof key !== 'string' || !key) return { project: '', instance: null };
  const at = key.indexOf('\x00');
  if (at === -1) return { project: key, instance: null };
  return { project: key.slice(0, at), instance: key.slice(at + 1) || null };
}

/**
 * Normalize a producer-reported scope against the bound project: the bound
 * project (or no project) collapses to the '' sentinel so its state bucket is
 * THE legacy singleton bucket. A foreign project keeps its name; its instance
 * is preserved when present.
 * @param {{project?: string|null, instance?: string|null}} scope
 * @param {string} boundProject - the server's bound project (`_projectName`)
 * @returns {{project: string, instance: string|null}} normalized scope (project
 *   '' ⇒ bound; instance null ⇒ project-wide)
 */
export function normalizeProducerScope(scope, boundProject) {
  const p = (scope && typeof scope.project === 'string' && scope.project) || '';
  const i = (scope && typeof scope.instance === 'string' && scope.instance) || null;
  const bound = boundProject || '';
  if (!p || p === bound) return { project: '', instance: null };
  return { project: p, instance: i };
}

/**
 * Scope key for a producer-reported scope, already normalized against the
 * bound project (normalizeProducerScope + scopeKeyOf in one step).
 * @param {{project?: string|null, instance?: string|null}} scope
 * @param {string} boundProject
 * @returns {string}
 */
export function scopeKeyForProducer(scope, boundProject) {
  const n = normalizeProducerScope(scope, boundProject);
  return scopeKeyOf(n.project, n.instance);
}
