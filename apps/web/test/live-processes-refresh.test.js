/**
 * Immediate live-processes refresh after a project-tab close (2026-10).
 *
 * Bug: the Header's multi-vs-single decision is `tabs.length >= 2` over local
 * useState that is only refreshed by a 5s /api/live-processes poll. Closing a
 * tab down to one remaining left the Header in multi-tab form for up to 5s.
 *
 * Fix: AppBase bumps a monotonically-increasing `liveProcessRefreshToken` on
 * every successful close; the token threads AppBase -> App.jsx -> AppHeader ->
 * HeaderProjectSwitcher and lands in the poll effect's dep array, so a bump
 * re-runs the effect and re-fetches immediately (the 5s poll stays a backstop).
 *
 * AppBase is a React class that cannot be imported into node:test directly, so
 * per house precedent we mirror the state machine and add source-anchor
 * assertions that fail if a future refactor drops any link of the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');
const APP_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/App.jsx'), 'utf8');
const APPHEADER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/dashboard/AppHeader.jsx'), 'utf8');

/** Mirror the handleCloseProject state machine relevant to the token bump. */
function mkCloseHost({ closeResult, viewedProject = null, viewedInstance = null } = {}) {
  return {
    state: { viewedProject, viewedInstance, liveProcessRefreshToken: 0 },
    _unmounted: false,
    calls: [],
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); },
    handleActivateChip() { this.calls.push('activate'); },
    handleDetachView() { this.calls.push('detach'); },
    // Mirrors the fixed handleCloseProject success path (token bump placed
    // after the !r.ok guard and before the closedIsViewed early return).
    _onCloseResolved(project, r, instanceKey) {
      if (this._unmounted) return;
      if (!r || !r.ok) { this.calls.push('error'); return; }
      this.setState((prev) => ({ liveProcessRefreshToken: (prev.liveProcessRefreshToken || 0) + 1 }));
      const closedIsViewed = this.state.viewedProject === project
        && (instanceKey ? (this.state.viewedInstance || null) === instanceKey : true);
      if (!closedIsViewed) return;
      this.calls.push('repair');
    },
    run(project, instanceKey) { this._onCloseResolved(project, closeResult, instanceKey); },
  };
}

describe('handleCloseProject bumps liveProcessRefreshToken (mirror)', () => {
  it('bumps on a successful NON-viewed close (the early-return path)', () => {
    const h = mkCloseHost({ closeResult: { ok: true }, viewedProject: 'other' });
    h.run('closing-project', null);
    assert.equal(h.state.liveProcessRefreshToken, 1, 'token must bump even though we early-return');
    assert.deepEqual(h.calls, [], 'no view repair for a non-viewed close');
  });

  it('bumps on a successful VIEWED close (and still repairs the view)', () => {
    const h = mkCloseHost({ closeResult: { ok: true }, viewedProject: 'closing-project' });
    h.run('closing-project', null);
    assert.equal(h.state.liveProcessRefreshToken, 1);
    assert.deepEqual(h.calls, ['repair'], 'view repair still runs alongside the refresh');
  });

  it('bumps on a same-cwd twin close (instanceKey mismatch = non-viewed)', () => {
    const h = mkCloseHost({ closeResult: { ok: true }, viewedProject: 'p', viewedInstance: 'inst-a' });
    h.run('p', 'inst-b');
    assert.equal(h.state.liveProcessRefreshToken, 1);
    assert.deepEqual(h.calls, [], 'a twin close does not move the view');
  });

  it('does NOT bump on a failed close', () => {
    const h = mkCloseHost({ closeResult: { ok: false } });
    h.run('p', null);
    assert.equal(h.state.liveProcessRefreshToken, 0);
    assert.deepEqual(h.calls, ['error']);
  });

  it('does NOT bump on a forbidden close', () => {
    const h = mkCloseHost({ closeResult: { ok: false, reason: 'forbidden' } });
    h.run('p', null);
    assert.equal(h.state.liveProcessRefreshToken, 0);
    assert.deepEqual(h.calls, ['error']);
  });

  it('increments monotonically across rapid successive closes', () => {
    const h = mkCloseHost({ closeResult: { ok: true }, viewedProject: 'other' });
    h.run('a', null);
    h.run('b', null);
    assert.equal(h.state.liveProcessRefreshToken, 2, 'functional updater survives back-to-back closes');
  });
});

describe('AppBase.jsx source anchors (refactor guard)', () => {
  it('declares liveProcessRefreshToken in the state initializer', () => {
    assert.ok(/liveProcessRefreshToken: 0,/.test(APPBASE_SRC),
      'state init must declare liveProcessRefreshToken: 0');
  });

  it('bumps the token after the !r.ok guard and before the closedIsViewed early return', () => {
    // The bump must sit inside handleCloseProject's success branch, between the
    // failure guard and the closedIsViewed check, so it fires for viewed AND
    // non-viewed closes but never for failed/forbidden ones.
    const re = /handleCloseProject = \(project, fallbackProject, instanceKey\) => \{[\s\S]{0,1600}?liveProcessRefreshToken: \(prev\.liveProcessRefreshToken \|\| 0\) \+ 1[\s\S]{0,900}?const closedIsViewed/;
    assert.ok(re.test(APPBASE_SRC),
      'token bump must appear after the failure guard and before closedIsViewed');
    // And the failure guard must come BEFORE the bump.
    const guardFirst = /if \(!r \|\| !r\.ok\) \{[\s\S]{0,700}?liveProcessRefreshToken: \(prev/;
    assert.ok(guardFirst.test(APPBASE_SRC),
      'failure guard (!r || !r.ok) must precede the token bump');
  });

  it('uses the functional setState updater (survives rapid closes)', () => {
    assert.ok(/setState\(\(prev\) => \(\{ liveProcessRefreshToken: \(prev\.liveProcessRefreshToken \|\| 0\) \+ 1 \}\)\)/.test(APPBASE_SRC),
      'must use setState((prev) => ...) functional updater');
  });
});

describe('App.jsx source anchor (refactor guard)', () => {
  it('forwards the token from state into AppHeader (the AppBase->AppHeader link)', () => {
    // The one wiring point the other anchors can't cover: if this JSX line is
    // dropped, AppBase still bumps and AppHeader still has its SCU/forward/
    // destructure/dep entries, yet the token never reaches the Header and the
    // fix goes inert — a silent regression this anchor exists to catch.
    assert.ok(/liveProcessRefreshToken=\{this\.state\.liveProcessRefreshToken\}/.test(APP_SRC),
      'App.jsx must pass liveProcessRefreshToken from state into AppHeader');
  });
});

describe('AppBase.jsx workspace_started rebound wiring (2026-10)', () => {
  // Anchor on the handler's function boundary first, then assert within it —
  // a bare `rebound === true[\s\S]{0,N}` window is comment-length sensitive and
  // has silently punched through when the surrounding commentary grew.
  const handler = (() => {
    const start = APPBASE_SRC.indexOf("addEventListener('workspace_started'");
    assert.notEqual(start, -1, 'workspace_started handler present');
    const end = APPBASE_SRC.indexOf("addEventListener('workspace_stopped'", start);
    return end === -1 ? APPBASE_SRC.slice(start) : APPBASE_SRC.slice(start, end);
  })();

  it('gates the reset/reconnect on the shared view-domain predicate (reboundScope.js)', () => {
    // Closing the BOUND project makes the server re-bind to a survivor and
    // broadcast workspace_started(rebound:true, reboundFrom). WITHOUT the gate
    // every tab — including ones viewing an unrelated third project — is
    // force-detached and blanked. WITH it, only affected tabs reset.
    assert.ok(handler.includes('reboundAffectsView({'),
      'the handler must decide via the shared reboundAffectsView predicate');
    assert.ok(/const isRebound = data\.rebound === true;/.test(handler), 'rebound marker read');
    assert.ok(/const shouldReset = !isRebound \|\| reboundAffectsThisTab;/.test(handler),
      'a normal switch resets unconditionally; a rebound only when it affects this tab');
  });

  it('reconnects the SSE (explicit empty scope) only for an affected rebound', () => {
    // A rebound-afflicted tab's SSE stays stamped with the OLD bound name, so
    // the survivor's live feed never arrives (label updates, pane stays silent).
    const re = /if \(isRebound\) \{\s*this\._sseReconnectCount = 0;\s*this\.initSSE\(\{ sid: null, project: null, instance: null \}\);/;
    assert.ok(re.test(handler),
      'an affected rebound must clear the reconnect budget and initSSE({sid:null,project:null,instance:null})');
  });

  it('does not reconnect on a normal workspace_started (server replays on the live connection)', () => {
    // The reconnect lives INSIDE the shouldReset block and is rebound-guarded;
    // a normal launch keeps relying on the server's own full_reload/replay.
    const resetAt = handler.indexOf('if (shouldReset) {');
    const reconnectAt = handler.indexOf('if (isRebound) {');
    assert.notEqual(resetAt, -1, 'shouldReset block present');
    assert.ok(reconnectAt > resetAt, 'the reconnect is inside the shouldReset block, not before it');
  });
});

describe('AppHeader.jsx source anchors (refactor guard)', () => {
  it('lists liveProcessRefreshToken in shouldComponentUpdate (P0: non-viewed close re-render)', () => {
    const re = /shouldComponentUpdate\(nextProps, nextState\) \{[\s\S]{0,4000}?nextProps\.liveProcessRefreshToken !== this\.props\.liveProcessRefreshToken/;
    assert.ok(re.test(APPHEADER_SRC),
      'without the SCU entry AppHeader never re-renders on a non-viewed close and the fix is inert');
  });

  it('forwards the token to HeaderProjectSwitcher', () => {
    assert.ok(/liveProcessRefreshToken=\{this\.props\.liveProcessRefreshToken\}/.test(APPHEADER_SRC),
      'HeaderProjectSwitcher instantiation must forward liveProcessRefreshToken');
  });

  it('destructures the token in HeaderProjectSwitcher', () => {
    const re = /const \{[^}]*onLiveProjectsChange[^}]*liveProcessRefreshToken[^}]*\} = props;/;
    assert.ok(re.test(APPHEADER_SRC), 'HeaderProjectSwitcher must destructure liveProcessRefreshToken');
  });

  it('includes the token in the poll useEffect dep array', () => {
    const re = /\}, \[onActivateChip, isLocalLog, currentProject, onLiveProjectsChange, liveProcessRefreshToken\]\);/;
    assert.ok(re.test(APPHEADER_SRC),
      'the token must be a dep of the poll effect so a bump re-runs load() immediately');
  });
});
