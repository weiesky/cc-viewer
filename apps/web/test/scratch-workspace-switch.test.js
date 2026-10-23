// Scratch workspace-following (multi-project 2026-10-12) — source-anchor tests for the
// wiring that cannot run under node (no DOM renderer in this suite). House precedent:
// detach-view-reset.test.js. Each assertion pins a load-bearing snippet so a future
// refactor that drops the wiring fails loudly here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(here, '..', 'src', rel), 'utf8');
const serverSrc = (rel) => readFileSync(join(here, '..', '..', '..', 'packages', 'app', 'server', rel), 'utf8');

const terminalPanel = src('components/terminal/TerminalPanel.jsx');
const scratchTerminal = src('components/terminal/ScratchTerminal.jsx');
const chatView = src('components/chat/ChatView.jsx');
const mobile = src('Mobile.jsx');
const serverJs = serverSrc('server.js');
const scratchStorage = src('utils/scratchTabsStorage.js');

describe('scratch workspace switch: TerminalPanel wiring', () => {
  it('swaps tab groups on (viewProject, viewInstance) change', () => {
    assert.ok(
      terminalPanel.includes('_scratchGroupKeyOf(prevProps)') && terminalPanel.includes('_scratchGroupKeyOf(this.props)'),
      'componentDidUpdate must compare the group key derived from both prev/current props',
    );
    assert.ok(
      terminalPanel.includes('prevScratchKey !== nextScratchKey'),
      'swap must be keyed on the group key (project\x00instance aware)',
    );
    assert.ok(
      terminalPanel.includes('groupKeyOf(props.viewProject, props.viewInstance)'),
      'group key must combine viewProject + viewInstance (same-basename twins)',
    );
  });

  it('persists via the per-group storage helpers (never the old global writers)', () => {
    assert.ok(terminalPanel.includes("from '../../utils/scratchTabsStorage.js'"), 'must use scratchTabsStorage');
    assert.ok(terminalPanel.includes('_applyScratchGroup'), 'group applier must exist');
    assert.ok(terminalPanel.includes('persistScratchGroup('), 'mutations must persist per group');
    assert.ok(!terminalPanel.includes('writeScratchTabs('), 'old global writer must be gone');
    assert.ok(!terminalPanel.includes('readScratchTabs('), 'old global reader must be gone');
  });

  it('boot merge: pending bucket merged into the first resolved workspace', () => {
    assert.ok(terminalPanel.includes('isPendingGroupKey(prevScratchKey)'), 'pending detection required');
    assert.ok(terminalPanel.includes('mergePendingScratchGroup('), 'boot must merge (not rename) the pending bucket');
    assert.ok(!terminalPanel.includes('renameScratchGroup'), 'rename is superseded by merge (steady-state stray-shell fix)');
  });

  it('P0: boot pending tabs never connect (no orphan bound-root shell)', () => {
    // The core leak fix: TerminalPanel marks the boot pending bucket and passes
    // allowBoundScope=false, so ScratchTerminal._hasScope() is false and the tab never
    // connects (and never spawns a bound-root shell the merge would orphan).
    assert.ok(terminalPanel.includes('this._scratchPending'), 'panel must track the pending-boot state');
    assert.ok(
      terminalPanel.includes('allowBoundScope={!this._scratchPending}'),
      'pending tabs must be denied a bound-root connection',
    );
    assert.ok(scratchTerminal.includes('_hasScope()'), 'ScratchTerminal must gate its connection on scope');
    assert.ok(
      scratchTerminal.includes('if (this._hasScope()) this.connectWebSocket()'),
      'mount must defer connecting until a real scope exists',
    );
    // The swap clears the flag so the resolved group's tabs connect.
    assert.ok(terminalPanel.includes('this._scratchPending = false'), 'swap must release the pending gate');
  });

  it('merge path still adopts the legacy archive (single adoption point)', () => {
    // Regression anchor (review): the ctor seeds a pending tab every boot, so pending is
    // non-empty at merge time; if pending outranked legacy the pre-feature archive would
    // strand and drift into whichever OTHER workspace the user opens first. The merge
    // must order named > legacy > pending and report the adoption so the caller claims.
    assert.ok(terminalPanel.includes('mergedLegacy'), 'caller must thread the merge-reported legacy flag');
    assert.ok(
      terminalPanel.includes('if (mergedLegacy) claimLegacyScratch()'),
      'merge path must claim the legacy archive after adopting it',
    );
    assert.ok(
      !terminalPanel.includes('mergedFromPendingOnly'),
      'the short-circuited post-merge loadScratchGroup adoption must be gone',
    );
    // The storage module must rank legacy ABOVE pending (upgrade boot: pending is just
    // the ctor's worthless seed).
    const legacyIdx = scratchStorage.indexOf('storage.getItem(LEGACY_TABS_KEY)');
    const pendingIdx = scratchStorage.indexOf('pending.tabs.length > 0');
    assert.ok(legacyIdx > 0 && pendingIdx > 0, 'merge must consult both the legacy archive and the pending bucket');
    assert.ok(legacyIdx < pendingIdx, 'merge must consult the legacy archive before the pending bucket');
  });

  it('never kills PTYs on switch (groups survive switch-away) and resets focus ring', () => {
    const swapIdx = terminalPanel.indexOf('prevScratchKey !== nextScratchKey');
    assert.ok(swapIdx > 0);
    const swapBlock = terminalPanel.slice(swapIdx, swapIdx + 4000);
    assert.ok(!swapBlock.includes('requestKill'), 'swap block must not kill any scratch PTY');
    assert.ok(swapBlock.includes('scratchFocused: false'), 'swap must reset the focus ring');
  });

  it('threads project+instance to both ScratchTerminal render sites', () => {
    // ≥2 (not ===2): the scheduled-task modal also passes project/instance (2026-10-23),
    // which is a legitimate third+ site. The invariant is that BOTH ScratchTerminal
    // render sites still thread project/instance, so assert the floor, not the ceiling.
    const occurrences = terminalPanel.split('project={this.props.viewProject || null}').length - 1;
    assert.ok(occurrences >= 2, `scratchOnly + normal branches must both pass project (got ${occurrences})`);
    const instOccurrences = terminalPanel.split('instance={this.props.viewInstance || null}').length - 1;
    assert.ok(instOccurrences >= 2, `both branches must pass instance (got ${instOccurrences})`);
  });

  it('persists on unmount (workspace-list round trip has no swap)', () => {
    const unmountIdx = terminalPanel.indexOf('componentWillUnmount()');
    assert.ok(unmountIdx > 0);
    const head = terminalPanel.slice(unmountIdx, unmountIdx + 600);
    assert.ok(head.includes('persistScratchGroup('), 'unmount must persist the current group');
  });
});

describe('scratch workspace switch: ScratchTerminal wiring', () => {
  it('ws URL carries project+instance via withViewParams', () => {
    assert.ok(scratchTerminal.includes('withViewParams('), 'connectWebSocket must scope the URL');
    assert.ok(
      scratchTerminal.includes("project: this.props.project || null") && scratchTerminal.includes("instance: this.props.instance || null"),
      'props must feed withViewParams',
    );
  });

  it('restarts the connection on project/instance prop change, never killing', () => {
    assert.ok(scratchTerminal.includes('componentDidUpdate(prevProps)'), 'prop-change watcher required');
    assert.ok(scratchTerminal.includes('prevProps.project !== this.props.project'), 'project change triggers restart');
    assert.ok(scratchTerminal.includes('_restartConnection()'), 'restart path must exist');
    const restartIdx = scratchTerminal.indexOf('_restartConnection() {');
    assert.ok(restartIdx > 0);
    const body = scratchTerminal.slice(restartIdx, restartIdx + 1200);
    assert.ok(!body.includes("type: 'kill'"), 'restart must never kill the old PTY');
    assert.ok(body.includes('INBAND_RESET'), 'restart must reset the screen before replay');
    assert.ok(body.includes('_wsReconnectTimer'), 'restart must cancel the pending reconnect timer');
  });

  it('has a re-entry guard so two sockets can never stack', () => {
    assert.ok(
      scratchTerminal.includes('readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING'),
      'connectWebSocket must bail when a socket is already live/opening',
    );
  });

  it('fatal toast stops the reconnect loop and writes an i18n line', () => {
    assert.ok(scratchTerminal.includes('msg.fatal'), 'fatal frame must be handled');
    assert.ok(scratchTerminal.includes('this._fatal = true'), 'fatal flag must be set');
    assert.ok(scratchTerminal.includes('this._closing || this._fatal'), 'onclose must respect the fatal flag');
    assert.ok(scratchTerminal.includes("t('ui.terminal.scratchUnavailable'"), 'fatal path must render the i18n hint');
  });
});

describe('scratch workspace switch: prop threading', () => {
  it('ChatView passes viewProject+viewInstance to both TerminalPanel branches', () => {
    assert.ok(
      chatView.includes('<TerminalPanel scratchOnly scratchOpen={terminalVisible} viewProject={this.props.viewProject} viewInstance={this.props.viewInstance}'),
      'SDK scratchOnly branch must carry both props',
    );
    assert.ok(
      chatView.includes('viewProject={this.props.viewProject}\n                viewInstance={this.props.viewInstance}'),
      'normal branch must carry both props',
    );
    assert.ok(
      chatView.includes('nextProps.viewInstance !== this.props.viewInstance'),
      'shouldComponentUpdate must not starve instance updates',
    );
  });

  it('Mobile TerminalPanel carries both props (iPad renders scratch)', () => {
    const idx = mobile.indexOf('<TerminalPanel');
    assert.ok(idx > 0);
    const block = mobile.slice(idx, idx + 1500);
    assert.ok(block.includes('viewProject={this.state.viewedProject || this.state.projectName || null}'), 'Mobile must pass viewProject');
    // Same derivation as the desktop viewInstanceForChat (bound-instance fallback) so an
    // iPad and a desktop resolve the same cwd — and the same scratch group key.
    assert.ok(block.includes('viewInstance={this.state.viewedInstance'), 'Mobile must pass viewInstance');
    assert.ok(block.includes('this._boundInstance || null'), 'Mobile must mirror the bound-instance fallback');
  });
});

describe('scratch workspace switch: server cap invariants', () => {
  it('server.js enforces per-cwd and total caps at the scratch upgrade', () => {
    assert.ok(serverJs.includes('MAX_SCRATCH_PTYS_PER_CWD'), 'per-cwd cap constant must exist');
    assert.ok(serverJs.includes('MAX_SCRATCH_PTYS_TOTAL'), 'total cap constant must exist');
    assert.ok(
      serverJs.includes('getScratchPtyCount() >= MAX_SCRATCH_PTYS_TOTAL')
        && serverJs.includes('getScratchPtyCountForCwd(scratchCwd) >= MAX_SCRATCH_PTYS_PER_CWD'),
      'upgrade must consult both caps',
    );
    // Reconnect exemption: an existing (id, cwd) bucket must bypass the caps.
    assert.ok(
      serverJs.includes('!hasScratchPty(scratchId, { cwd: scratchCwd })'),
      'existing (id, cwd) reconnects must be exempt from the caps',
    );
  });

  it('per-cwd cap is exactly 2x the client tab cap (same semantics as the old global 16)', () => {
    const perCwd = serverJs.match(/MAX_SCRATCH_PTYS_PER_CWD\s*=\s*(\d+)/);
    const total = serverJs.match(/MAX_SCRATCH_PTYS_TOTAL\s*=\s*(\d+)/);
    const tabMax = scratchStorage.match(/SCRATCH_TAB_MAX\s*=\s*(\d+)/);
    assert.ok(perCwd && total && tabMax, 'cap constants must be literal integers');
    assert.equal(Number(perCwd[1]), 2 * Number(tabMax[1]), 'per-cwd cap must track the client tab cap');
    assert.ok(Number(total[1]) >= 4 * Number(perCwd[1]), 'total cap must cover several workspaces');
  });

  it('resolve failures take the toast-fatal path (never a bare destroy)', () => {
    assert.ok(serverJs.includes('ccvScratchReject'), 'reject hand-off must exist');
    assert.ok(serverJs.includes("fatal: true"), 'reject frame must be marked fatal');
    assert.ok(serverJs.includes('resolveViewRoot({'), 'upgrade must resolve the view root');
    assert.ok(serverJs.includes('realpathSync(vr.root)'), 'resolved root must be normalized before keying');
  });
});
