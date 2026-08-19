import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { apiUrl } from '../../utils/apiUrl';
import { imTr as _tr } from '../../utils/imTr';
import { deriveImConnState } from '../../utils/imConnState';
import styles from './ImStatusChip.module.css';

/**
 * Compact, generic IM status chip for the header (one per descriptor). Renders nothing unless the
 * platform's bridge is enabled; otherwise the connection state is conveyed by the brand icon's
 * COLOR — the platform's brand color when connected, grey otherwise (incl. error; the tooltip
 * still spells out the error). Clicking it opens the messaging panel on this platform's tab.
 * Self-contained: probes the platform's status endpoint once on mount, then polls every 5s unless
 * the platform answers as explicitly unconfigured (enabled:false + hasSecret:false). A
 * completely-unconfigured platform — the default state for every platform the user has never set
 * up — sends a single probe and then stays silent instead of hammering /status every 5s; a FAILED
 * probe (endpoint erroring, server restarting) keeps polling so the chip self-heals. Configuring a
 * platform in-app fires `ccv:im-config-changed`, which re-probes here and re-arms the poll without
 * a page reload.
 */
export default function ImStatusChip({ descriptor, onClick, onStatus }) {
  const [enabled, setEnabled] = useState(false);
  const [connection, setConnection] = useState(null);
  const Icon = descriptor.icon;

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(apiUrl(descriptor.endpoints.status));
      // 失败时复位为断连态，绝不保留上一次的「已连接」——状态须以真实为准（否则断连后徽标发霉）。
      if (!r.ok) { setConnection({ running: false, connected: false }); return null; }
      const d = await r.json();
      setEnabled(!!d.enabled);
      setConnection(d.connection || null);
      return d;
    } catch { setConnection({ running: false, connected: false }); return null; }
  }, [descriptor]);

  const intervalRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const disarm = () => { if (intervalRef.current != null) { clearInterval(intervalRef.current); intervalRef.current = null; } };
    // Probe once, then keep the recurring poll armed unless the platform answers as EXPLICITLY
    // unconfigured (enabled:false + hasSecret:false) — that's the only state that goes silent
    // (one request, not a stream, for every platform the user never set up). A null result is a
    // PROBE FAILURE (endpoint erroring, server mid-restart), not "unconfigured": disarming on it
    // would permanently freeze the chip grey with no self-heal, so failures keep polling like the
    // old unconditional 5s poll did. The interval re-runs probe, so a poll that later reaches an
    // unconfigured answer still disarms.
    const probe = async () => {
      const d = await fetchStatus();
      if (cancelled) return;
      const unconfigured = !!d && !d.enabled && !d.hasSecret;
      if (unconfigured) disarm();
      else if (intervalRef.current == null) intervalRef.current = setInterval(probe, 5000);
    };
    probe();
    // Re-probe when this platform's config changes in-app (save/enable/disable/start/stop), so a
    // freshly configured platform re-arms and a de-configured one stops — no page reload needed.
    const onConfigChanged = (e) => { if (!e?.detail?.id || e.detail.id === descriptor.id) probe(); };
    window.addEventListener('ccv:im-config-changed', onConfigChanged);
    return () => { cancelled = true; disarm(); window.removeEventListener('ccv:im-config-changed', onConfigChanged); };
  }, [fetchStatus, descriptor.id]);

  // Process-aware status via deriveImConnState. Each IM runs in a detached worker; the main ccv
  // reports {running, connected, connectionState, lastError} through the manager.
  //   error        — worker reported lastError (grey + red dot)
  //   connected    — process up + adapter connected (brand color)
  //   reconnecting — link dropped, SDK retrying (brand color + reduced opacity + amber dot)
  //   running      — process up but adapter not connected yet (brand color + reduced opacity)
  //   stopped      — process down (grey)
  const state = deriveImConnState(connection);

  // Report status upward (for the Electron tab bar's migrated IM icons; web passes no onStatus).
  useEffect(() => {
    if (!onStatus) return;
    onStatus(descriptor.id, {
      enabled,
      running: !!connection?.running,
      connected: state === 'connected',
      state,
    });
  }, [enabled, connection, state, onStatus, descriptor.id]);

  if (!enabled) return null;

  const statusLabel = state === 'connected'
    ? _tr('ui.im.statusConnected', null, 'Connected')
    : state === 'reconnecting'
      ? `${_tr('ui.im.statusReconnecting', null, 'Reconnecting…')}${connection?.lastError ? `: ${connection.lastError}` : ''}`
      : state === 'running'
        ? _tr('ui.im.statusRunning', null, 'Running, connecting…')
        : state === 'error'
          ? `${_tr('ui.im.statusError', null, 'Error')}: ${connection.lastError}`
          : _tr('ui.im.statusStopped', null, 'Stopped');
  const label = _tr(descriptor.labelKey, null, descriptor.fallback);
  // Brand color when running/connected/reconnecting, grey when stopped/error — driven by the descriptor.
  const color = (state === 'connected' || state === 'running' || state === 'reconnecting') ? descriptor.color : 'var(--text-tertiary, #999)';
  const iconClass = (state === 'running' || state === 'reconnecting') ? `${styles.logo} ${styles.connecting}` : styles.logo;

  return (
    <Tooltip title={`${label} · ${statusLabel}`}>
      <span className={styles.chip} onClick={onClick} role="button" tabIndex={0}
        aria-label={`${label} · ${statusLabel}`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}>
        <Icon size={16} className={iconClass} style={{ color }} />
        {state === 'error' ? <span className={styles.dotError} aria-hidden="true" /> : null}
        {state === 'reconnecting' ? <span className={styles.dotReconnecting} aria-hidden="true" /> : null}
      </span>
    </Tooltip>
  );
}
