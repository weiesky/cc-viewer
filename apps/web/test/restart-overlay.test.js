/**
 * RestartOverlay + the restart-wait flow wiring.
 *
 * The full-screen overlay is the only "still alive" signal while the updater restarts
 * the service (the old process tears down, the detached helper runs `npm install -g`,
 * then the new process re-listens — every request fails in between). These tests lock
 * in:
 *   1. the 3 new ui.update.restartOverlay* keys exist in all 18 locales;
 *   2. the component renders nothing when closed, the ~2-minute hint when open, and
 *      the "still waiting" line once `slow` flips;
 *   3. App.jsx drives the overlay: state reset on entry, the slow deadline inside the
 *      poll loop, and the RestartOverlay mount;
 *   4. UpdateModal can't be dismissed mid-restart (busy includes local `restarting`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const overlaySource = readFileSync(join(here, '../src/components/update/RestartOverlay.jsx'), 'utf8');
const overlayCss = readFileSync(join(here, '../src/components/update/RestartOverlay.module.css'), 'utf8');
const modalSource = readFileSync(join(here, '../src/components/update/UpdateModal.jsx'), 'utf8');
const appSource = readFileSync(join(here, '../src/App.jsx'), 'utf8');
const i18n = readFileSync(join(here, '../src/i18n.js'), 'utf8');

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

describe('RestartOverlay i18n — all 18 locales', () => {
  for (const key of ['restartOverlayTitle', 'restartOverlayHint', 'restartOverlaySlow']) {
    it(`ui.update.${key} translated in every locale`, () => {
      const match = i18n.match(new RegExp(`"ui\\.update\\.${key}": \\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(match, `missing ui.update.${key}`);
      for (const locale of LOCALES) assert.ok(match[1].includes(`"${locale}":`), `${key} missing ${locale}`);
    });
  }
  it('restartOverlayTitle keeps exactly one {version} placeholder in every locale', () => {
    const match = i18n.match(/"ui\.update\.restartOverlayTitle": \{([\s\S]*?)\n  \}/);
    assert.ok(match, 'missing ui.update.restartOverlayTitle');
    for (const locale of LOCALES) {
      const value = match[1].match(new RegExp(`"${locale}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      assert.ok(value, `title missing ${locale}`);
      assert.equal((value[1].match(/\{version\}/g) || []).length, 1, `${locale} must keep exactly one {version}`);
    }
  });
});

describe('RestartOverlay component', () => {
  it('renders nothing when closed and the overlay card when open', () => {
    assert.ok(overlaySource.includes('if (!open) return null;'), 'closed state must render null');
    assert.ok(overlaySource.includes("styles.overlay"), 'open state must render the fixed overlay');
    assert.ok(overlaySource.includes('Loading'), 'must reuse the shared Loading spinner');
    assert.ok(overlaySource.includes('size="large"'), 'spinner is the large variant');
  });
  it('sets the ~2-minute expectation up front and swaps copy when slow', () => {
    assert.ok(overlaySource.includes("t('ui.update.restartOverlayTitle'"), 'title shown');
    // The slow flag switches the hint, so the fixed "2 minutes" claim never outlives reality.
    assert.ok(overlaySource.includes("slow ? t('ui.update.restartOverlaySlow') : t('ui.update.restartOverlayHint')"), 'slow swaps the hint copy');
  });
  it('falls back to the plain restarting line when no target version is known', () => {
    // version is always present on the normal path, but a missing one must not render a dangling "v".
    assert.ok(overlaySource.includes("version ? t('ui.update.restartOverlayTitle', { version }) : t('ui.update.restarting')"), 'empty version falls back to ui.update.restarting');
    assert.ok(!overlaySource.includes("version || ''"), 'must not interpolate an empty version into the title');
  });
  it('announces the wait to screen readers via a live region', () => {
    assert.ok(overlaySource.includes('role="status"'), 'card needs role=status');
    assert.ok(overlaySource.includes('aria-live="polite"'), 'card needs aria-live=polite');
  });
  it('stays above the UpdateModal and the static restart confirm, below the drag layer, without !important', () => {
    assert.ok(overlayCss.includes('position: fixed'), 'full-screen fixed overlay');
    assert.ok(overlayCss.includes('inset: 0'), 'covers the whole viewport');
    const z = overlayCss.match(/z-index:\s*(\d+)/);
    assert.ok(z, 'overlay needs an explicit z-index');
    const zIndex = Number(z[1]);
    // antd's static Modal.confirm computes zIndexPopupBase+CONTAINER_MAX_OFFSET ≈ 2000 and stays
    // mounted for the whole restart (it awaits onOk), so the overlay must clear that layer.
    assert.ok(zIndex > 2000, `z-index ${zIndex} must beat the static confirm (~2000)`);
    assert.ok(zIndex < 9999, `z-index ${zIndex} must stay under the drag overlay (9999)`);
    assert.ok(!overlayCss.includes('!important'), 'no !important (project rule)');
    assert.ok(overlayCss.includes('var(--overlay-dark-strong)'), 'reuses the themed mask color');
    assert.ok(overlayCss.includes('-webkit-backdrop-filter'), 'Safari <18 needs the prefixed blur');
  });
});

describe('App restart flow wiring', () => {
  it('mounts the overlay bound to the restart state', () => {
    assert.ok(appSource.includes("import RestartOverlay from './components/update/RestartOverlay'"));
    assert.ok(appSource.includes('open={this.state.restarting}'), 'overlay follows the restarting flag');
    assert.ok(appSource.includes('version={this.state.updateJob?.version}'), 'overlay receives the target version');
    assert.ok(appSource.includes('slow={this.state.restartOverlaySlow}'), 'overlay receives the slow flag');
    assert.ok(appSource.includes('restartOverlaySlow: false'), 'slow flag resets with the restart state');
  });
  it('flips the slow flag only after the ~2-minute deadline inside the poll loop', () => {
    assert.ok(appSource.includes('const slowDeadline = Date.now() + 2 * 60 * 1000;'), 'slow deadline is ~2 minutes');
    assert.ok(appSource.includes('Date.now() > slowDeadline'), 'slow flips on the deadline');
    // Readiness detection itself is unchanged: still the /api/version-info processId poll.
    assert.ok(appSource.includes("restartPollDecision({ info, previousProcessId: this.state.updateProcessId, targetVersion: this.state.updateJob.version })"));
  });
  it('guards the modal close while a restart is in flight', () => {
    assert.ok(appSource.includes('if (!this.state.restarting) this.setState({ updateModalVisible: false })'), 'onCancel must no-op during restart');
  });
});

describe('UpdateModal restart lock', () => {
  it('treats local restarting as busy so the modal cannot be dismissed mid-restart', () => {
    assert.ok(modalSource.includes(".includes(state?.status) || restarting"), 'busy must include the local restarting flag');
    assert.ok(modalSource.includes('maskClosable={!busy}'), 'busy drives maskClosable');
    assert.ok(modalSource.includes('closable={!busy}'), 'busy drives closable (the X button)');
    assert.ok(modalSource.includes('keyboard={!busy}'), 'busy drives keyboard (Esc)');
    assert.ok(modalSource.includes('onCancel={busy ? undefined : onCancel}'), 'onCancel is dropped while busy');
  });
  it('does not keep the restart confirm open by returning the onOk promise', () => {
    // Returning the promise makes antd hold the confirm (z-index ~2000) for the whole restart,
    // which would cover the overlay. The restart confirm must close immediately.
    assert.ok(modalSource.includes('onOk: () => { onRestart(); }'), 'restart confirm must not await onRestart');
  });
});
