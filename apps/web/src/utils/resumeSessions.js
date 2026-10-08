// Pure view-model mapping for the /resume hover list (2026-10), split out of
// ResumeSessionsPopover.jsx so the row logic is unit-testable without React.
//
// A raw row comes from GET /api/resume-sessions (lib/v2/resume-list.js), scoped to
// the CURRENT project:
//   { source:'ccv', project, file, sessionUuid, startTs, turns, preview[],
//     running, pinnedId, aiTitle? }
// The display contract: a status dot (current / inactive), a one-line summary
// (aiTitle preferred, else first user prompt), and a last-activity time.
//
// Two-state status dot (TaskProgressHud-style glyphs in the component):
//   current  — the session the main view is on (pinnedId matches, blue filled disc)
//   inactive — any other recent session (hollow grey ring)
// `running` (mtime heuristic, or isStreaming for the current row) layers a pulse.

/**
 * Map a raw resume-list row to the hover-list view model.
 * @param {object} raw - one row from /api/resume-sessions.
 * @param {string|null} currentSessionUuid - the single live session UUID the main
 *   process is running (top-level field on the GET response). A row is `selected`
 *   (the "current" blue dot) when its sessionUuid matches — exactly one row can
 *   match.
 * @param {{ attachedUuid?: string|null, isStreaming?: boolean }} [opts] -
 *   `attachedUuid` is the session the main view is currently ATTACHED to: it wins
 *   the "current" blue dot over the server's `currentSessionUuid`, because while
 *   attached the session the user is looking at is the attached one, not the
 *   primary live session. `isStreaming` is the ground-truth "current session is
 *   mid-stream" flag, used to force the current row's running pulse even when its
 *   journal mtime has aged out.
 * @returns {{ key:string, project:string, summary:string, timeLabel:string,
 *   running:boolean, selected:boolean, statusKind:'current'|'inactive',
 *   tooltipKey:string, source:string, isCurrentLive:boolean }}
 */
export function mapResumeRow(raw, currentSessionUuid, opts = {}) {
  const r = raw || {};
  const { attachedUuid = null, isStreaming = false } = opts || {};
  const project = (typeof r.project === 'string' && r.project) || '—';
  // Summary: ai-title (CC-generated) preferred, else the first user prompt
  // preview, else a generic placeholder key the renderer resolves via t().
  let summary = '';
  if (typeof r.aiTitle === 'string' && r.aiTitle) summary = r.aiTitle;
  else if (Array.isArray(r.preview) && r.preview.length) summary = String(r.preview[0] || '');
  const uuid = typeof r.sessionUuid === 'string' && r.sessionUuid ? r.sessionUuid : null;
  // The "current" blue dot: the attached session wins while the view is attached
  // (that IS the session the user is looking at); otherwise fall back to the
  // single live session the main process is running (server `currentSessionUuid`).
  // Matched by uuid, not the project-level pinnedId (shared by every same-project
  // row). Case-insensitive on both.
  const selected = uuid != null && (
    (attachedUuid != null && uuid.toLowerCase() === String(attachedUuid).toLowerCase())
    || (currentSessionUuid != null && uuid.toLowerCase() === String(currentSessionUuid).toLowerCase())
  );
  // `running` is a coarse server mtime heuristic (journal appended <5min ago);
  // it goes stale within a single long stream (no file is appended mid-turn).
  // For the CURRENT session the client has the ground truth — isStreaming — so
  // a live stream forces running=true even when the mtime has aged out. Other
  // (background) sessions keep the mtime heuristic.
  const running = (r.running === true) || (selected && isStreaming === true);

  const statusKind = selected ? 'current' : 'inactive';
  const tooltipKey = statusKind === 'current'
    ? 'ui.resume.statusCurrent'
    : (running ? 'ui.resume.statusRunning' : 'ui.resume.statusInactive');

  return {
    key: `${r.source || 'ccv'}:${uuid || r.file || project}`,
    project,
    summary,
    timeLabel: formatRelativeTime(r.startTs),
    running,
    selected,
    statusKind,
    tooltipKey,
    source: r.source || 'ccv',
    // Whether this row is the live session currently running in the main process.
    // Clicking it is a no-op (highlight only) — it is already the view.
    isCurrentLive: selected,
  };
}

/**
 * Compact relative time for the row's last-activity column (e.g. "3m", "2h",
 * "5d", or a HH:MM for today). ISO strings compare/parse directly.
 * @param {string} iso
 * @param {number} [now] - injectable for tests.
 * @returns {string}
 */
export function formatRelativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const diffMs = now - t;
  if (diffMs < 0) return '';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Identity of a deduped live-process row. Unique across the deduped rows under the
// byKey invariant (legacy non-instance rows survive only when unique by basename, so
// at most one reaches here per basename; instance rows are per-spawn instanceKey). This
// is the same value the public `key` field is built from.
const rowId = (r) => r.instanceKey || r.cwd || r.project;

/**
 * Same-name tab/chip disambiguation (2026-10-06). Two live main PTYs can share a
 * basename `project` AFTER dedup: two different dirs both named `finqa-remote-cc`
 * (distinct cwd, distinct instanceKey), or two concurrent instances of the SAME dir
 * (same cwd, distinct instanceKey). Both survive the byKey dedup (keyed per-instance),
 * yet would render as two identical bare `label`s — ambiguous to the user. When a
 * `project` has exactly ONE surviving row, its label stays the bare basename (no
 * suffix noise). When 2+ rows share a `project`, suffix each with a 1-based ordinal.
 *
 * Ordinal key = cwd lexicographic, tie-break instanceKey. Deliberately NOT pid: the
 * self-heal respawn re-runs claude in the SAME record/instanceKey under a NEW pid
 * (pty-manager), so a pid-ordered ordinal would silently SWAP two tabs' `[n]` mid-
 * session on every respawn. cwd is immutable for a cross-dir tab's identity, and
 * instanceKey is stable across respawn for same-cwd twins — so the `[n]` a user has
 * learned stays put across the 5s poll AND across respawns. cwd-lex also makes the
 * tab strip's left-to-right order match the numbers (same-name rows are adjacent and
 * already cwd-ordered by the caller's stable sort). Pure + deterministic: no
 * Date.now()/Math.random(); a missing cwd/instanceKey degrades to a stable '' compare.
 * @param {Array<{ project:string, cwd:string|null, instanceKey:string|null }>} rows
 *   — already deduped + alphabetically sorted by `project`.
 * @returns {Map<string,string>} row identity (`rowId`) → display label.
 */
function applySameNameIndex(rows) {
  // Group surviving rows by basename. Iteration order matches the input (already
  // alphabetically sorted), so groups read left-to-right as the renderer will.
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || !r.project) continue;
    let g = groups.get(r.project);
    if (!g) { g = []; groups.set(r.project, g); }
    g.push(r);
  }
  const labelByRow = new Map();
  for (const group of groups.values()) {
    if (group.length === 1) {
      const r = group[0];
      labelByRow.set(rowId(r), r.project);
      continue;
    }
    // Copy before sorting: the input array's order is untouched, so the caller's
    // final `.map` keeps the alphabetical layout; the sort here only decides ordinals.
    const ordered = [...group].sort((a, b) => {
      const ca = String(a.cwd || '');
      const cb = String(b.cwd || '');
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.instanceKey || '').localeCompare(String(b.instanceKey || ''));
    });
    ordered.forEach((r, i) => {
      labelByRow.set(rowId(r), `${r.project} [${i + 1}]`);
    });
  }
  return labelByRow;
}

/**
 * Build the Header "parallel project" chips from GET /api/live-processes — the
 * OTHER live projects the view can switch to. One chip per live main PTY (bare
 * project name). The CURRENT project is EXCLUDED: its identity already shows in
 * the dedicated "当前项目:X" label to the left (a duplicate chip there is
 * redundant and non-actionable), so its main chip is dropped. Projects order
 * alphabetically for a stable, predictable layout. Pure + unit-tested.
 * @param {Array} processes - raw /api/live-processes `processes` rows:
 *   { kind:'main', project, cwd, pid, active?, instanceKey? }.
 * @param {string|null} currentProject - the bound project (top-level field);
 *   its main chip is excluded.
 * @returns {Array<{ key:string, project:string, label:string, suffix:string|null, cwd:string|null, pid:number, instanceKey:string|null }>}
 */
export function deriveActiveProcessChips(processes, currentProject) {
  // Multi-instance (2026-10-06): key by the per-process instanceKey when present so two
  // concurrent same-cwd instances become TWO chips instead of collapsing onto one basename.
  // Rows WITHOUT an instanceKey (legacy/older server) keep the OLD basename-dedup semantics —
  // a cross-dir same-basename collision (/a/proj vs /b/proj) stays merged, not split.
  const byKey = new Map();
  for (const p of processes || []) {
    if (!p) continue;
    const proj = (typeof p.project === 'string' && p.project) || null;
    if (!proj || proj === currentProject) continue;
    const hasInst = typeof p.instanceKey === 'string' && p.instanceKey;
    const id = hasInst ? p.instanceKey : proj; // instanceKey distinguishes instances; else basename (legacy)
    if (!byKey.has(id)) byKey.set(id, { project: proj, cwd: p.cwd || null, instanceKey: hasInst || null, pid: p.pid });
  }
  const rows = [...byKey.values()].sort((a, b) => String(a.project).localeCompare(String(b.project)));
  const labels = applySameNameIndex(rows);
  return rows.map((r) => {
    const label = labels.get(rowId(r)) || r.project;
    return {
      key: `main:${rowId(r)}`,
      project: r.project,
      label,
      // ` [n]` split out so the tab bar can render it as a non-shrinking span (ellipsis
      // would otherwise clip the discriminator off a long basename). null when unsuffixed.
      suffix: label.length > r.project.length ? label.slice(r.project.length) : null,
      cwd: r.cwd,
      pid: r.pid,
      instanceKey: r.instanceKey,
    };
  });
}

/**
 * Build the multi-project TAB model from GET /api/live-processes (2026-10) —
 * one tab per live project INCLUDING the current one (the tab strip replaces
 * the "当前项目:X" label + chips when 2+ projects are live, so the current
 * project must be a tab too). Same dedupe/sort/key scheme as
 * deriveActiveProcessChips. The VIEWING tab is derived client-side from
 * viewedProject || currentProject — an attached parallel view matches by
 * instanceKey, NOT by `active` (that flag is the shared terminal attachment,
 * which may differ from this client's view). But `active` IS carried for one
 * narrow case: when NO parallel view is attached (viewedProject null), the
 * viewed process IS the bound project's attached PTY, i.e. exactly the
 * `active` row — so its instanceKey singles out ONE same-basename bound tab
 * instead of lighting up both. The header shows the tab strip only when the
 * result has ≥2 entries.
 * @param {Array} processes - raw /api/live-processes `processes` rows:
 *   { kind:'main', project, cwd, pid, active?, instanceKey? }.
 * @returns {Array<{ key:string, project:string, label:string, suffix:string|null, cwd:string|null, pid:number, instanceKey:string|null, active:boolean }>}
 */
export function deriveProjectTabs(processes) {
  // Multi-instance (2026-10-06): key by instanceKey when present so two concurrent same-cwd
  // instances become TWO tabs with unique React keys. Rows WITHOUT an instanceKey keep the OLD
  // basename-dedup semantics (a cross-dir same-basename collision stays merged, not split).
  const byKey = new Map();
  for (const p of processes || []) {
    if (!p) continue;
    const proj = (typeof p.project === 'string' && p.project) || null;
    if (!proj) continue; // no usable name → no meaningful tab (same rule as chips)
    const hasInst = typeof p.instanceKey === 'string' && p.instanceKey;
    const id = hasInst ? p.instanceKey : proj; // instanceKey distinguishes instances; else basename (legacy)
    if (!byKey.has(id)) byKey.set(id, { project: proj, cwd: p.cwd || null, instanceKey: hasInst || null, pid: p.pid, active: p.active === true });
  }
  const rows = [...byKey.values()].sort((a, b) => String(a.project).localeCompare(String(b.project)));
  const labels = applySameNameIndex(rows);
  return rows.map((r) => {
    const label = labels.get(rowId(r)) || r.project;
    return {
      key: `main:${rowId(r)}`,
      project: r.project,
      label,
      // ` [n]` split out so the tab bar can render it as a non-shrinking span (ellipsis
      // would otherwise clip the discriminator off a long basename). null when unsuffixed.
      suffix: label.length > r.project.length ? label.slice(r.project.length) : null,
      cwd: r.cwd,
      pid: r.pid,
      instanceKey: r.instanceKey,
      active: r.active,
    };
  });
}

/**
 * Bound-view instanceKey tiebreak (pure-client viewing, 2026-10-07): which
 * instanceKey singles out the BOUND project's tab among same-basename tabs —
 * WITHOUT the shared server `active` pointer (that is the terminal attachment,
 * not this client's view: it lags the 5s poll AND two clients viewing different
 * projects cannot both be "the viewed one", so `active` can never be a view
 * source). The decision, encoded:
 *   - bound name appears on <2 tabs  → return null (plain name-match suffices:
 *     a unique bound tab needs no instance tiebreak);
 *   - bound name duplicated AND `currentInstanceKey` actually resolves to one of
 *     those tabs → return it (lights exactly the bound tab);
 *   - key missing/stale (matches none) → return null, degrading to name-match
 *     (may briefly light both same-name bound tabs — never blanks the bound tab).
 * Pure + deterministic. `currentInstanceKey` comes from GET /api/live-processes
 * (the bound project's per-server identity, derived from the bound cwd).
 * @param {Array} tabs - deriveProjectTabs rows ({ project, instanceKey }).
 * @param {string} currentProject - the bound project name.
 * @param {string|null} currentInstanceKey - the bound project's instanceKey.
 * @returns {string|null}
 */
export function resolveBoundInstance(tabs, currentProject, currentInstanceKey) {
  if (!currentProject || !currentInstanceKey) return null;
  const bound = (tabs || []).filter((t) => t && t.project === currentProject);
  if (bound.length < 2) return null;
  const hit = bound.some((t) => (t.instanceKey || null) === currentInstanceKey);
  return hit ? currentInstanceKey : null;
}

/**
 * Attach the server's main PTY stream to a project (multi-PTY view switch,
 * 2026-10). Fire-and-forget: the terminal stays on the old project if the
 * attach fails (e.g. no live record yet), which is the pre-fix behavior — the
 * user can still see/interact, just scoped wrong. Never throws; failures go to
 * reportSwallowed per the CLAUDE.md swallowed-catch convention.
 */
export function attachMainPty(project, { fetchImpl, reportImpl, instanceKey } = {}) {
  if ((!project || typeof project !== 'string') && !instanceKey) return Promise.resolve(false);
  // Injected seams keep this module unit-testable without a DOM/fetch; the
  // production path lazily imports apiUrl + the reportSwallowed shell so the
  // module graph stays side-effect-free at import time.
  const doFetch = fetchImpl || ((path, init) => import('./apiUrl.js').then(({ apiUrl }) => fetch(apiUrl(path), init)));
  const doReport = reportImpl || ((tag, err) => import('./errorReport.js').then(({ reportSwallowed }) => reportSwallowed(tag, err)));
  return Promise.resolve()
    .then(() => doFetch('/api/live-processes/attach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Multi-instance: carry the instanceKey when known so the server pins THIS exact process
      // (two same-cwd instances share a basename and cannot be told apart by `project`).
      body: JSON.stringify(instanceKey ? { project, instanceKey } : { project }),
    }))
    .then((r) => !!(r && r.ok !== false))
    .catch((err) => { doReport('pty.attach', err); return false; });
}

/**
 * Close a project's main PTY via POST /api/live-processes/close (the tab
 * bar's × button, 2026-10). Admin-gated server-side; a 403 comes back as
 * { ok:false, reason:'forbidden' } so the caller can show a permission
 * message instead of a generic failure. Never throws; network/parse failures
 * go to reportSwallowed per the CLAUDE.md swallowed-catch convention.
 * @returns {Promise<{ ok:boolean, reason?:string }>}
 */
export function closeProjectPty(project, { fetchImpl, reportImpl, instanceKey } = {}) {
  if ((!project || typeof project !== 'string') && !instanceKey) return Promise.resolve({ ok: false, reason: 'missing-project' });
  const doFetch = fetchImpl || ((path, init) => import('./apiUrl.js').then(({ apiUrl }) => fetch(apiUrl(path), init)));
  const doReport = reportImpl || ((tag, err) => import('./errorReport.js').then(({ reportSwallowed }) => reportSwallowed(tag, err)));
  return Promise.resolve()
    .then(() => doFetch('/api/live-processes/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Multi-instance: carry the instanceKey when known so the × closes THIS exact process
      // (two same-cwd instances share a basename; project-only would kill an arbitrary one).
      body: JSON.stringify(instanceKey ? { project, instanceKey } : { project }),
    }))
    .then(async (r) => {
      if (!r) return { ok: false, reason: 'no-response' };
      if (r.status === 403) return { ok: false, reason: 'forbidden' };
      let body = null;
      // A non-JSON error page (e.g. an older server without this route → the
      // SPA 404 HTML) must not throw here — degrade to a generic reason.
      try { body = await r.json(); } catch { body = null; }
      if (r.ok && body && body.ok) return { ok: true };
      return { ok: false, reason: (body && body.reason) || ('http-' + r.status) };
    })
    .catch((err) => { doReport('pty.close', err); return { ok: false, reason: 'network' }; });
}

/**
 * TRUE /resume (2026-10-06, star-menu migration): POST /api/resume-session to inject
 * `/resume <uuid>` into the target project's live claude PTY, switching the running
 * process INTO that session (subsequent messages continue it). Carries `project`
 * (the viewed project) and `instanceKey` (multi-instance disambiguation) so the server
 * injects into THIS exact process. Admin/same-origin gated server-side; a 409 'busy'
 * comes back when the TUI is mid-turn/mid-approval so the caller can toast a clear
 * reason. Never throws; network/parse failures go to reportSwallowed per the
 * CLAUDE.md swallowed-catch convention.
 * @returns {Promise<{ ok:boolean, reason?:string }>}
 */
export function resumeSession(sessionUuid, { project, instanceKey, fetchImpl, reportImpl } = {}) {
  if (typeof sessionUuid !== 'string' || !sessionUuid) return Promise.resolve({ ok: false, reason: 'missing-session' });
  const doFetch = fetchImpl || ((path, init) => import('./apiUrl.js').then(({ apiUrl }) => fetch(apiUrl(path), init)));
  const doReport = reportImpl || ((tag, err) => import('./errorReport.js').then(({ reportSwallowed }) => reportSwallowed(tag, err)));
  const payload = { sessionUuid };
  if (typeof project === 'string' && project) payload.project = project;
  if (typeof instanceKey === 'string' && instanceKey) payload.instanceKey = instanceKey;
  return Promise.resolve()
    .then(() => doFetch('/api/resume-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }))
    .then(async (r) => {
      if (!r) return { ok: false, reason: 'no-response' };
      if (r.status === 403) return { ok: false, reason: 'forbidden' };
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      if (r.ok && body && body.ok) return { ok: true };
      return { ok: false, reason: (body && body.reason) || ('http-' + r.status) };
    })
    .catch((err) => { doReport('pty.resume', err); return { ok: false, reason: 'network' }; });
}
