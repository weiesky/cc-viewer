/**
 * forceNew "New Workspace (Session)" empty-view switch (2026-11) — the
 * handleActivateChip `opts.blankView` branch.
 *
 * Background: after a forceNew launch on the current project root, the pin branch calls
 * handleActivateChip({project, instanceKey: <new key>}, { blankView: true }). The new instance
 * is a brand-new conversation, so its view must start empty; without blanking the visible
 * slice at switch time, the old conversation would linger until the new instance's empty cold
 * load (load_start{empty:true}) lands.
 *
 * AppBase is a React class and cannot be imported directly; per house precedent
 * (detach-view-reset.test.js) this uses a "mirrored state machine + source-anchor assertions"
 * contract test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

/** Mirrors the key actions of handleActivateChip(chip, opts) (setState made synchronous). */
function mkHost({ chip, opts } = {}) {
  return {
    state: {
      viewedProject: null,
      viewedInstance: null,
      attachedSid: 'old-sid',
      pinnedSessionTs: 'pin-old',
      projectName: 'proj',
      requests: [{ timestamp: 't1', url: '/v1/messages' }],
      thinkingRequests: [{ timestamp: 't1' }],
      mainAgentSessions: [{ messages: [] }],
      v2Rows: [{ timestamp: 't1', sessionId: 's', seq: 1 }],
      v2RowsMeta: { totalCount: 1, hasMore: false, oldestTs: '' },
      selectedIndex: 0,
      contextWindow: { total_input_tokens: 100 },
      serverCachedContent: 'cached',
      contextBarLocked: true,
      contextBarOptimistic: true,
      streamingLatest: { id: 's1' },
      isStreaming: true,
      turnActive: true,
      resumeSwitch: null,
    },
    calls: [],
    snapshotted: null,
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); },
    _snapshotCurrentView() {
      this.calls.push('snapshot');
      // The snapshot reads this.state BEFORE the blank (program order; React batches, so the
      // blank has not been applied yet).
      this.snapshotted = { requests: this.state.requests.slice(), v2Rows: this.state.v2Rows.slice() };
    },
    _activateScope(scope) { this.calls.push('activate'); this.activatedScope = scope; },
    // Mirrors the fixed handleActivateChip(chip, opts = {}).
    handleActivateChip(chipArg, optsArg = {}) {
      if (!chipArg || !chipArg.project) return;
      const chipInstance = (typeof chipArg.instanceKey === 'string' && chipArg.instanceKey) || null;
      if (chipArg.project === this.state.viewedProject && chipInstance === (this.state.viewedInstance || null)) return;
      if (!this.state.resumeSwitch) this._snapshotCurrentView();
      if (optsArg && optsArg.blankView) {
        this.setState({
          requests: [], thinkingRequests: [], mainAgentSessions: [], v2Rows: [],
          v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' }, selectedIndex: null,
          pinnedSessionTs: null, contextWindow: null, serverCachedContent: null,
          contextBarLocked: false, contextBarOptimistic: false,
          streamingLatest: null, isStreaming: false, turnActive: false,
        });
      }
      this.setState({ viewedProject: chipArg.project, viewedInstance: chipInstance, attachedSid: null, pinnedSessionTs: null });
      this._activateScope({ sid: null, project: chipArg.project, instance: chipInstance });
    },
    run() { this.handleActivateChip(chip, opts); },
  };
}

const freshChip = { project: 'proj', instanceKey: 'ccv-fresh123', cwd: '/x/proj' };

describe('handleActivateChip blankView (forceNew empty view)', () => {
  it('blankView:true clears the visible conversation slice AFTER the snapshot, BEFORE activate', () => {
    const h = mkHost({ chip: freshChip, opts: { blankView: true } });
    h.run();
    // Order: snapshot → (blank) → activate.
    assert.deepEqual(h.calls, ['snapshot', 'activate'], 'snapshot must precede activate');
    // The snapshot captured the PRE-blank departing conversation (so a warm switch-back works).
    assert.equal(h.snapshotted.requests.length, 1, 'snapshot read the pre-blank conversation');
    assert.equal(h.snapshotted.v2Rows.length, 1);
    // The visible slice is cleared after the blank.
    assert.deepEqual(h.state.requests, []);
    assert.deepEqual(h.state.thinkingRequests, []);
    assert.deepEqual(h.state.mainAgentSessions, []);
    assert.deepEqual(h.state.v2Rows, []);
    assert.deepEqual(h.state.v2RowsMeta, { totalCount: 0, hasMore: false, oldestTs: '' });
    assert.equal(h.state.selectedIndex, null);
    assert.equal(h.state.pinnedSessionTs, null);
    assert.equal(h.state.contextWindow, null, 'context-bar usage is cleared too (no stale residue)');
    assert.equal(h.state.serverCachedContent, null);
    assert.equal(h.state.contextBarLocked, false);
    assert.equal(h.state.contextBarOptimistic, false);
    assert.equal(h.state.streamingLatest, null, 'mid-stream typewriter bubble cleared');
    assert.equal(h.state.isStreaming, false);
    assert.equal(h.state.turnActive, false);
    // The view anchors to the new instance.
    assert.equal(h.state.viewedProject, 'proj');
    assert.equal(h.state.viewedInstance, 'ccv-fresh123');
    assert.equal(h.state.attachedSid, null);
  });

  it('without blankView (a normal chip click) the visible slice is NOT cleared', () => {
    const h = mkHost({ chip: freshChip });
    h.run();
    assert.equal(h.state.requests.length, 1, 'a normal click keeps content (the cold load replaces it)');
    assert.equal(h.state.contextBarLocked, true, 'context bar untouched');
  });

  it('same project+instance early-returns: no blank, no activate', () => {
    const h = mkHost({ chip: freshChip, opts: { blankView: true } });
    h.state.viewedProject = 'proj';
    h.state.viewedInstance = 'ccv-fresh123'; // already viewing this instance
    h.run();
    assert.deepEqual(h.calls, [], 'same-instance early return: no snapshot/activate');
    assert.equal(h.state.requests.length, 1, 'view not cleared');
  });

  it('a chip with no project returns immediately', () => {
    const h = mkHost({ chip: { instanceKey: 'ccv-x' }, opts: { blankView: true } });
    h.run();
    assert.deepEqual(h.calls, []);
    assert.equal(h.state.requests.length, 1);
  });
});

describe('AppBase.jsx source anchors (forceNew blankView drift guard)', () => {
  it('the handleWorkspaceLaunch pin branch passes blankView:true', () => {
    assert.ok(/handleActivateChip\(\{ project: projectName, instanceKey: pinInstance, cwd: path \}, \{ blankView: true \}\)/.test(APPBASE_SRC),
      'the pin branch must pass blankView:true');
  });

  it('blankView appears exactly once as a call-site argument (only the forceNew pin branch)', () => {
    const occurrences = APPBASE_SRC.match(/\{ blankView: true \}/g) || [];
    assert.equal(occurrences.length, 1, 'blankView:true must come from exactly one call site');
  });

  it('the blank uses plain setState (NOT _commitChannel), after _snapshotCurrentView, before _activateScope', () => {
    const m = APPBASE_SRC.match(/handleActivateChip = \(chip, opts = \{\}\) => \{([\s\S]*?)\n  \};/);
    assert.ok(m, 'handleActivateChip body found');
    const body = m[1];
    const iSnap = body.indexOf('_snapshotCurrentView()');
    const iBlank = body.indexOf('opts.blankView');
    const iActivate = body.indexOf('this._activateScope(');
    assert.ok(iSnap !== -1 && iBlank !== -1 && iActivate !== -1, 'all three landmarks present');
    assert.ok(iSnap < iBlank && iBlank < iActivate, 'order must be snapshot → blank → activate');
    // The blank branch uses this.setState and must NOT use _commitChannel (which would write the
    // rendered channel's vm and corrupt the departing view's committed baseline).
    const blankBlock = body.slice(iBlank, iActivate);
    assert.ok(/this\.setState\(/.test(blankBlock), 'blank uses setState');
    assert.ok(!/_commitChannel\(/.test(blankBlock), 'blank must not use _commitChannel');
    // Pin the load-bearing field list (the two fields the implementation comment justifies).
    assert.ok(/thinkingRequests: \[\]/.test(blankBlock), 'blank clears thinkingRequests');
    assert.ok(/contextWindow: null/.test(blankBlock), 'blank clears contextWindow');
    assert.ok(/serverCachedContent: null/.test(blankBlock), 'blank clears serverCachedContent');
    assert.ok(/pinnedSessionTs: null/.test(blankBlock), 'blank clears pinnedSessionTs');
  });
});
