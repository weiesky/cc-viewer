// Panel bundle loader: injects classic <script> / <link> for plugin panels and pairs
// each load with a unique loadId. The bundle registers via window.CCV.registerPanel
// during its synchronous execution; we only accept the registration whose loadId
// matches THIS attempt (stale/late/foreign registrations are rejected).
//
// abort() cancels OUR WAIT (timer + listeners + script element + loadId tombstone), not
// script execution: a classic script that already started may still run after removal.
// The loadId also rides in the URL, so every attempt has a distinct src — a delayed
// window error from an earlier load can never match (and fail) a newer one.
import { reportSwallowed } from './errorReport';

export const PANEL_LOAD_TIMEOUT_MS = 15000;

let loadCounter = 0;

function nextLoadId(name, attempt) {
  loadCounter += 1;
  return `${name}:${attempt}:${Date.now().toString(36)}:${loadCounter}`;
}

/**
 * Load a panel JS bundle.
 * @param {string} url   bundle URL (already carries the ?v= fingerprint)
 * @param {object} opts  { name, attempt, timeoutMs, doc, win }
 * @returns {Promise<{ component: Function, dispose(): void }> & { abort(): void }}
 *   Call abort() on unmount/panel switch to cancel the pending wait.
 *   rejected Errors carry .code:
 *   host-unavailable | load-failed | timeout | not-registered | invalid-component | aborted
 */
export function loadPanelScript(url, opts = {}) {
  const {
    name,
    attempt = 0,
    timeoutMs = PANEL_LOAD_TIMEOUT_MS,
    doc = document,
    win = window,
  } = opts;
  let abortPending = null;
  const promise = new Promise((resolve, reject) => {
    const fail = (code, message, extra) => {
      const err = new Error(message || code);
      err.code = code;
      if (extra) err.detail = extra;
      reject(err);
    };
    if (!win.CCV || typeof win.CCV.registerPanel !== 'function' || typeof win.CCV._consumeRegistration !== 'function') {
      fail('host-unavailable', 'window.CCV runtime is not installed');
      return;
    }
    const loadId = nextLoadId(name, attempt);
    const sep = url.includes('?') ? '&' : '?';
    // The per-load nonce makes every attempt's URL distinct, so same-panel retries (attempt
    // reset to 0 after a close) cannot alias each other's window 'error' events.
    const finalUrl = `${url}${sep}r=${attempt}&lid=${encodeURIComponent(loadId)}`;
    const script = doc.createElement('script');
    script.async = true;
    script.setAttribute('data-ccv-load', loadId);
    script.src = finalUrl;

    let settled = false;
    let onWindowError = null;
    const cleanup = () => {
      if (onWindowError) win.removeEventListener('error', onWindowError);
      clearTimeout(timer);
      try { script.remove(); } catch { /* already removed */ }
    };
    const settleOk = (component) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        component,
        dispose() {
          // cleanup already removed the script element; module-level side effects cannot be reclaimed (documented contract)
        },
      });
    };
    const settleErr = (code, message, extra) => {
      if (settled) return;
      settled = true;
      cleanup();
      win.CCV._dropRegistration(loadId);
      fail(code, message, extra);
    };
    // Real cancellation of our wait: clears the timer, detaches the window error listener,
    // removes the script element, and tombstones the loadId so a late registration from a
    // bundle that still executes is dropped instead of satisfying a future attempt.
    abortPending = () => settleErr('aborted', `panel "${name}" load aborted`);

    const timer = setTimeout(() => {
      settleErr('timeout', `panel "${name}" did not load within ${timeoutMs}ms`);
    }, timeoutMs);

    // Syntax/evaluation errors: script.onerror only covers network/MIME failures; runtime
    // throws surface on window 'error'. Match the FULL URL including this attempt's `r=`
    // marker — a delayed error from an older attempt must not fail the current one.
    onWindowError = (event) => {
      if (!event || !event.filename) return;
      if (event.filename !== script.src) return;
      settleErr('load-failed', `panel "${name}" threw during evaluation`, event.message);
    };
    win.addEventListener('error', onWindowError);

    script.onload = () => {
      // A classic script's onload fires after synchronous execution - registration should have happened; fail fast if not
      const reg = win.CCV._consumeRegistration(loadId);
      if (!reg) {
        settleErr('not-registered', `panel "${name}" did not call window.CCV.registerPanel synchronously`);
        return;
      }
      if (reg.name !== name) {
        settleErr('not-registered', `panel registered name "${reg.name}" but "${name}" was expected`);
        return;
      }
      settleOk(reg.component);
    };
    script.onerror = () => {
      settleErr('load-failed', `panel "${name}" failed to load (network or MIME error)`);
    };
    doc.head.appendChild(script);
  });
  // Attached after construction because settleErr is defined inside the executor.
  promise.abort = () => { if (abortPending) abortPending(); };
  return promise;
}

/**
 * Load panel CSS (non-blocking, report only). Returns { dispose } (idempotent).
 */
export function loadPanelStyles(url, opts = {}) {
  const { doc = document, name = 'unknown' } = opts;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('data-ccv-panel-style', name);
  link.href = url;
  link.onerror = () => {
    reportSwallowed('plugin-panel.css', new Error(`panel stylesheet failed to load: ${url}`));
  };
  doc.head.appendChild(link);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      try { link.remove(); } catch { /* already removed */ }
    },
  };
}
