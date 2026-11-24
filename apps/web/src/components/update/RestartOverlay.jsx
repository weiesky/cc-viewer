import React from 'react';
import { t } from '../../i18n';
import Loading from '../common/Loading';
import styles from './RestartOverlay.module.css';

// Full-screen overlay shown while the updater restarts the service. The old process
// tears down, a detached helper runs `npm install -g` (up to 15 min), then the new
// process re-listens — every request fails in between, so the page would otherwise
// look alive but hang. The overlay sets the expectation (about 2 minutes, auto
// refresh) and swaps to a "still waiting" line once `slow` kicks in. The actual
// readiness detection lives in App.restartForUpdate's /api/version-info polling;
// this component is purely presentational.
export default function RestartOverlay({ open, version, slow }) {
  if (!open) return null;
  return (
    <div className={styles.overlay}>
      {/* role=status + aria-live so screen readers announce both the initial
          "restarting, ~2 min" expectation and the later "still waiting" switch. */}
      <div className={styles.card} role="status" aria-live="polite" aria-atomic="true">
        <Loading size="large" />
        <div className={styles.title}>{version ? t('ui.update.restartOverlayTitle', { version }) : t('ui.update.restarting')}</div>
        <div className={styles.hint}>{slow ? t('ui.update.restartOverlaySlow') : t('ui.update.restartOverlayHint')}</div>
      </div>
    </div>
  );
}
