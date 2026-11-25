/**
 * Source-anchor guards for the mobile workspace manager (WorkspaceManagerModal)
 * and its Mobile.jsx wiring. The repo's web test suite has no DOM/jsdom — wiring is
 * guarded by exact source anchors (same pattern as plugin-panel-host.test.js /
 * modal-mask.test.js), while the row-classification LOGIC lives in
 * utils/resumeSessions.js buildWorkspaceListModel and is unit-tested for real in
 * resume-sessions-map.test.js.
 *
 * The two invariants (carried by buildWorkspaceListModel):
 *   - the BOUND project's row must route to onDetachView, never onActivateChip
 *     (mirrors HeaderProjectTabs.onTabClick);
 *   - the bound project must always be listed (synthesized when its PTY is dead) —
 *     mobile-only: no header tab strip here, so otherwise no way back.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

const modal = read('src/components/mobile/WorkspaceManagerModal.jsx');
const mobile = read('src/Mobile.jsx');

// Slice [startNeedle, endNeedle) so an assertion cannot be satisfied by unrelated
// code later in the file (a slice-to-EOF stays green when the handler body moves).
function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `anchor not found: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `end anchor not found after ${startNeedle}: ${endNeedle}`);
  return src.slice(start, end);
}

describe('WorkspaceManagerModal anchors', () => {
  it('polls /api/live-processes only while open, cleans up, reports failures', () => {
    const effect = sliceBetween(modal, 'if (!open) return undefined', '}, [open]);');
    assert.ok(effect.includes("apiUrl('/api/live-processes')"), 'must fetch the live-processes endpoint');
    assert.ok(effect.includes('setInterval(load, 5000)'), 'must poll every 5s like the header switcher');
    assert.ok(effect.includes('clearInterval(timer)'), 'cleanup must clear the poll');
    assert.ok(effect.includes('cancelled'), 'cleanup must suppress post-close/late setState');
    assert.ok(effect.includes("reportSwallowed('workspaceManager.fetch'"), 'fetch failures must not be swallowed silently');
  });

  it('resets the stale snapshot during the open transition, before any effect runs', () => {
    // A useEffect-only reset lands one commit too late: the heal effect shares that
    // commit's stale closure. The reset must be render-phase (adjust-on-prop-change).
    const adjust = sliceBetween(modal, 'const [wasOpen, setWasOpen]', 'useEffect(() => {');
    assert.ok(adjust.includes('if (open !== wasOpen) {'), 'must detect the open transition during render');
    assert.ok(adjust.includes('setLive(null);'), 'reopen must drop the previous snapshot synchronously');
  });

  it('delegates row classification to buildWorkspaceListModel with prop-first currentProject', () => {
    assert.ok(modal.includes('buildWorkspaceListModel({'), 'must use the shared pure model');
    assert.ok(modal.includes("currentProject: currentProject || (live && live.currentProject) || ''"),
      'the bound prop must win over the poll snapshot (the poll lags a rebind)');
    assert.ok(modal.includes('resumeSwitch: !!resumeSwitch'), 'an in-flight switch must suppress the heal');
  });

  it('rows render from the model and tap through handleRowClick', () => {
    assert.ok(modal.includes('model.rows.map(row => {'), 'rows must come from the model');
    assert.ok(modal.includes('const isViewing = model.isViewing(row);'), 'viewing flag must come from the model');
    assert.ok(modal.includes('onClick={() => handleRowClick(row)}'), 'row tap must reach the click handler');
  });

  it('routes bound rows to onDetachView and other rows to onActivateChip with cwd', () => {
    const handler = sliceBetween(modal, 'const handleRowClick = (row) => {', 'onClose();');
    assert.ok(/if \(model\.isBoundRow\(row\)\) \{\s*if \(onDetachView\) onDetachView\(\);\s*\} else if \(onActivateChip\)/.test(handler),
      'bound row → onDetachView; others → onActivateChip (inverting these breaks the return path)');
    assert.ok(handler.includes('onActivateChip({ project: row.project, instanceKey: row.instanceKey || null, cwd: row.cwd || null })'),
      'activate must carry project + instanceKey + cwd (cwd feeds mobile viewedWorkspace persistence)');
  });

  it('heals a dead parallel view on open via the model verdict', () => {
    assert.ok(modal.includes('if (open && live && model.healNeeded && onDetachView) onDetachView();'),
      'a vanished viewed instance must trigger onDetachView once fresh data is in');
  });

  it('marks the viewing row disabled with aria-current and the current tag; suffix never ellipsizes', () => {
    assert.ok(modal.includes('disabled={isViewing}'), 'viewing row must be disabled');
    assert.ok(modal.includes("aria-current={isViewing ? 'true' : undefined}"), 'viewing row must carry aria-current');
    assert.ok(modal.includes("t('ui.workspaceManager.currentTag')"), 'viewing row must show the current tag');
    assert.ok(modal.includes('styles.rowName'), 'project name needs its own ellipsizing span so the [n] suffix survives (AppHeader parity)');
  });

  it('stays on the default modal layer (no zIndex override, no blur mask)', () => {
    assert.ok(!modal.includes('zIndex'), 'menu-level modal keeps the antd default zIndex (1000) so the NewProjectModal handoff is level');
    assert.ok(!modal.includes('BLUR_MASK_STYLE'), 'mobile modals use the default mask; adding BLUR_MASK_STYLE requires modal-mask.test.js updates');
  });

  it('section 2 hands off to the shared new-project picker via onOpenNewProject', () => {
    assert.ok(modal.includes('onClick={onOpenNewProject}'), 'create row must call onOpenNewProject');
    assert.ok(modal.includes("t('ui.resume.newProject')"), 'create row reuses the existing newProject label');
  });
});

describe('Mobile.jsx workspace-manager wiring', () => {
  it('menu item closes all overlays and opens the manager with the new label', () => {
    assert.ok(mobile.includes("{t('ui.workspaceManager.title')}"), 'menu label must be the manager title');
    assert.ok(mobile.includes('...this._closeAllMobileOverlays(), workspaceManagerVisible: true'),
      'menu click must close sibling overlays and open the manager');
  });

  it('state + _closeAllMobileOverlays both know workspaceManagerVisible', () => {
    const helper = sliceBetween(mobile, '_closeAllMobileOverlays() {', '};');
    assert.ok(helper.includes('workspaceManagerVisible: false'), 'closeAll must reset the manager flag');
  });

  it('mounts WorkspaceManagerModal with the full handler + context surface', () => {
    const mount = sliceBetween(mobile, '<WorkspaceManagerModal', '/>');
    for (const prop of [
      'open={this.state.workspaceManagerVisible}',
      'onClose={() => this.setState({ workspaceManagerVisible: false })}',
      'onActivateChip={this.handleActivateChip}',
      'onDetachView={this.handleDetachView}',
      'currentProject={this.state.projectName}',
      'viewedProject={this.state.viewedProject}',
      'viewedInstance={this.state.viewedInstance}',
      'resumeSwitch={this.state.resumeSwitch}',
    ]) {
      assert.ok(mount.includes(prop), `mount must pass ${prop}`);
    }
    assert.ok(mount.includes('workspaceManagerVisible: false, newProjectOpen: true'),
      'new-project handoff must close the manager and open the shared picker in one setState');
  });

  it('header project label follows the viewed project after a switch', () => {
    assert.ok(mobile.includes('projectName={this.state.viewedProject || this.state.projectName}'),
      'MobileContextTag must render viewedProject || projectName or the header shows the departed project');
  });
});
