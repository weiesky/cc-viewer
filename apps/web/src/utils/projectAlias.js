// Per-project alias persistence.
//
// User-facing UI:
//   header「当前项目 cc-viewer」 hover → pencil icon → modal → input → save
//
// Effects when set:
//   - document.title overrides projectName (handled by AppBase._applyDocTitle)
//   - header / mobile ctx label append " (alias)" after projectName
//
// Storage: localStorage, keyed by projectName. Stale aliases for projects no
// longer present are harmless (inert until matched projectName reappears).
//
// Cross-tab sync: native `storage` event fires in OTHER tabs only. Same-tab
// updates need explicit pubsub — we expose an EventTarget so AppHeader / Mobile
// / AppBase pick up local mutations without a full reload.

// Key prefix mirrors existing `ccv_` convention (cf. ccv_themeColor / ccv_viewMode).
// Known limitation: keyed by projectName basename (not full path; cf. interceptor.js _projectName),
// so two projects sharing a basename (~/work/cc-viewer + ~/tmp/cc-viewer) collide on one alias.
// Accepted for v1; real fix would key on a full-path hash (server must also send projectPath).
const KEY_PREFIX = 'ccv_projectAlias_';
const MAX_LEN = 32; // taskbar typically truncates 30-50; 32 is the realistic cap.

// Same-tab pubsub channel. EventTarget is native everywhere we ship (Electron,
// modern web) — no library, no leaked listeners on module reload.
// Event payload: { detail: { projectName, alias } }
let _bus = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
const EVT_CHANGE = 'change';

function _keyFor(projectName) {
  if (!projectName || typeof projectName !== 'string') return null;
  return `${KEY_PREFIX}${projectName}`;
}

// Normalise user input. Strips:
//   - C0/C1 control characters U+0000-U+001F, U+007F-U+009F (render as garbage / NUL)
//   - Standard whitespace controls (\r \n \t are within C0)
//   - Unicode line/paragraph separators
//   - BiDi overrides ‪-‮ and ⁦-⁩ — a paste containing
//     RIGHT-TO-LEFT-OVERRIDE flips surrounding chrome text direction tab-wide.
//     No current exploit but trivial to block (review P1-A).
// Stripped sequences collapse to a single space, then trim + truncate to MAX_LEN.
// Empty result → caller treats as "clear".
export function normalizeAlias(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

export function getProjectAlias(projectName) {
  const key = _keyFor(projectName);
  if (!key) return '';
  try {
    const v = localStorage.getItem(key);
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

// Returns true on success, false on failure (quota / private mode / disabled).
// Normalisation happens here so callers (Modal save handler / migrations) can't
// store malformed values. Empty after normalisation → clearProjectAlias path.
export function setProjectAlias(projectName, raw) {
  const key = _keyFor(projectName);
  if (!key) return false;
  const value = normalizeAlias(raw);
  try {
    if (value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    _emitChange(projectName, value);
    return true;
  } catch { return false; }
}

export function clearProjectAlias(projectName) {
  const key = _keyFor(projectName);
  if (!key) return false;
  try {
    localStorage.removeItem(key);
    _emitChange(projectName, '');
    return true;
  } catch { return false; }
}

function _emitChange(projectName, alias) {
  if (!_bus) return;
  try {
    _bus.dispatchEvent(new CustomEvent(EVT_CHANGE, { detail: { projectName, alias } }));
  } catch {
    // Subscriber threw — swallowed so the localStorage write isn't undone.
    // dispatchEvent itself can also fail in some environments where CustomEvent
    // isn't a real constructor; both cases are non-fatal for persistence.
  }
}

// Subscribe to alias changes for a specific project — fires for both
// same-tab updates (via internal EventTarget) and cross-tab updates
// (via window 'storage' event).
//   onChange(alias) — called with the new alias string ('' = cleared).
// Returns an unsubscribe function.
export function subscribeToAlias(projectName, onChange) {
  if (!projectName || typeof onChange !== 'function') return () => {};
  const targetKey = _keyFor(projectName);

  const sameTabHandler = (e) => {
    if (e?.detail?.projectName === projectName) onChange(e.detail.alias || '');
  };
  const crossTabHandler = (e) => {
    if (e?.key === targetKey) onChange(e.newValue || '');
  };

  if (_bus) _bus.addEventListener(EVT_CHANGE, sameTabHandler);
  if (typeof window !== 'undefined') window.addEventListener('storage', crossTabHandler);

  return () => {
    if (_bus) _bus.removeEventListener(EVT_CHANGE, sameTabHandler);
    if (typeof window !== 'undefined') window.removeEventListener('storage', crossTabHandler);
  };
}

// Test-only: replaces the internal EventTarget bus so a test run starts with
// no leftover listeners from prior test files. Also useful in dev for HMR
// recovery (review P1-C). Never call from production code — listeners on the
// old bus stop receiving updates.
export function __resetBusForTest() {
  _bus = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
}

// Exported for tests — lets unit tests assert key shape without poking at
// localStorage internals.
export const _internals = { KEY_PREFIX, MAX_LEN, _keyFor };
