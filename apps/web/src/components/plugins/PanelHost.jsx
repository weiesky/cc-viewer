import React from 'react';
import { App as AntApp, Button } from 'antd';
import { loadPanelScript, loadPanelStyles } from '../../utils/panelLoader';
import { panelAssetUrl, pluginApiUrl, pluginWsUrl } from '../../utils/pluginPanels';
import { getBasePath, apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { t } from '../../i18n';
import styles from './PanelHost.module.css';

// Error boundary around every remote panel: a panel render error must never crash the
// host app. Retry re-executes the bundle (a fresh component type is the only way the
// same broken component does not throw again).
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    reportSwallowed('plugin-panel.render', error, { componentStack: info?.componentStack?.slice(0, 500) });
  }
  render() {
    if (this.state.error) {
      return (
        <div className={styles.stateBox} data-ccv-panel-error={this.props.name}>
          <div className={styles.stateTitle}>{t('ui.pluginPanel.renderFailed')}</div>
          <div className={styles.stateDetail}>{String(this.state.error && this.state.error.message || this.state.error)}</div>
          <div className={styles.stateActions}>
            <Button size="small" type="primary" onClick={this.props.onRetry}>{t('ui.pluginPanel.retry')}</Button>
            <Button size="small" onClick={this.props.onClose}>{t('ui.pluginPanel.close')}</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * PanelHost: loads a panel bundle + optional css, then renders the registered component
 * with the panel contract props. Loading is an explicit effect state machine (NOT
 * React.lazy/Suspense — we need wait cancellation on close, css lifecycle and retry
 * control; the script itself cannot be aborted once it starts executing).
 */
export default function PanelHost({
  panel,
  attempt = 0,
  onRetry,
  onClose,
  theme,
  lang,
  isMobile,
  project,
  instance,
}) {
  const [state, setState] = React.useState({ phase: 'loading', component: null, error: null });
  const styleRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading', component: null, error: null });

    const entryUrl = panelAssetUrl(panel.entryUrl);
    if (!entryUrl) {
      setState({ phase: 'error', component: null, error: { code: 'invalid-component', message: 'invalid entryUrl' } });
      return undefined;
    }

    // Load CSS in parallel with JS to prevent FOUC; failures are non-blocking
    if (panel.cssUrl) {
      const cssUrl = panelAssetUrl(panel.cssUrl);
      if (cssUrl) {
        styleRef.current?.dispose();
        styleRef.current = loadPanelStyles(cssUrl, { name: panel.name });
      }
    }

    const pending = loadPanelScript(entryUrl, { name: panel.name, attempt });
    pending
      .then(({ component }) => {
        if (cancelled) return;
        setState({ phase: 'ready', component, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        reportSwallowed('plugin-panel.load', err, { panel: panel.name, code: err.code });
        setState({ phase: 'error', component: null, error: err });
      });

    return () => {
      // Cancel our wait on unmount/panel switch: clears the timer + error listener, removes
      // the script and tombstones the loadId so a late registration cannot leak into the
      // next attempt. The script itself may still finish executing (browser semantics).
      cancelled = true;
      pending.abort?.();
    };
  }, [panel.name, panel.entryUrl, panel.cssUrl, attempt]);

  // Remove the CSS link on unmount (container already unmounted, no animation conflict - during
  // the mobile overlay slide-out PanelHost still renders; see PluginPanelModal's open control)
  React.useEffect(() => {
    return () => {
      styleRef.current?.dispose();
      styleRef.current = null;
    };
  }, []);

  if (state.phase === 'loading') {
    return (
      <div className={styles.stateBox}>
        <div className={styles.stateTitle}>{t('ui.pluginPanel.loading')}</div>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className={styles.stateBox} data-ccv-panel-load-error={state.error?.code}>
        <div className={styles.stateTitle}>{t('ui.pluginPanel.loadFailed')}</div>
        <div className={styles.stateDetail}>{state.error?.message}</div>
        <div className={styles.stateActions}>
          <Button size="small" type="primary" onClick={onRetry}>{t('ui.pluginPanel.retry')}</Button>
          <Button size="small" onClick={onClose}>{t('ui.pluginPanel.close')}</Button>
        </div>
      </div>
    );
  }

  const Component = state.component;
  const panelProps = {
    name: panel.name,
    version: panel.version,
    hostVersion: window.CCV?.hostVersion,
    apiVersion: window.CCV?.apiVersion,
    theme,
    lang,
    isMobile,
    project: project ?? null,
    instance: instance ?? null,
    // null means the runtime has no record (e.g. before it boots) — report 'unknown'
    // rather than lying to the panel that its service is ready.
    status: panel.serviceStatus ?? (panel.prefix ? 'unknown' : 'none'),
    basePath: getBasePath().replace(/\/$/, ''),
    assetBaseUrl: panel.assetBaseUrl ? panelAssetUrl(panel.assetBaseUrl) : null,
    apiUrl: (path) => apiUrl(path),
    pluginApiUrl: panel.prefix ? (path) => pluginApiUrl(panel, path) : null,
    pluginWsUrl: panel.prefix ? (path) => pluginWsUrl(panel, path) : null,
    onClose,
  };

  return (
    <AntApp component={false}>
      <div className={styles.panelRoot} data-ccv-panel={panel.name}>
        <PanelErrorBoundary
          key={`${panel.name}@${panel.version || '0'}#${attempt}`}
          name={panel.name}
          onRetry={onRetry}
          onClose={onClose}
        >
          <Component {...panelProps} />
        </PanelErrorBoundary>
      </div>
    </AntApp>
  );
}
