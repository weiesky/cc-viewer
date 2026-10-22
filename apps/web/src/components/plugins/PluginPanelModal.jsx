import React from 'react';
import { Modal, Alert } from 'antd';
import { isMobile } from '../../env';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import { t } from '../../i18n';
import PanelHost from './PanelHost';
import { panelTitle, serviceStateLabel } from '../../utils/pluginPanels';
import appStyles from '../../App.module.css';
import MobileDrawerCloseButton from '../mobile/MobileDrawerCloseButton';

/**
 * PluginPanelModal: dual-shape container for remote plugin panels.
 *  - Desktop: antd Modal (manifest width, blur mask, destroyOnHidden)
 *  - Mobile: full-screen mobileDrawerOverlay (always mounted for the slide animation;
 *    PanelHost only mounts while open, so closing = full unmount + css cleanup)
 */
export default function PluginPanelModal({
  panel,          // panel descriptor | null
  open,
  onClose,
  attempt = 0,
  onRetry,
  theme,
  lang,
  project,
  instance,
}) {
  const title = panel ? panelTitle(panel) : '';

  // The mobile container is a real modal but is always mounted for the slide animation.
  // Focus/Escape handling therefore keys off `open`: focus moves into the dialog on open
  // and returns to the trigger on close (the desktop antd Modal handles this itself).
  const overlayRef = React.useRef(null);
  const restoreFocusRef = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Focus enter/restore is intentionally keyed on `open` ONLY. Callers pass an inline
  // onClose (a new identity every render), so depending on it would tear down and re-run
  // this effect on every streamed update — repeatedly stealing focus from panel inputs.
  React.useEffect(() => {
    if (!isMobile || !open) return undefined;
    const previous = typeof document !== 'undefined' ? document.activeElement : null;
    restoreFocusRef.current = previous;
    const node = overlayRef.current;
    if (node && typeof node.focus === 'function') node.focus();
    return () => {
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && typeof restore.focus === 'function') restore.focus();
    };
  }, [open]);

  // Escape listener is separate for the same reason; it reads the latest onClose via ref.
  React.useEffect(() => {
    if (!isMobile || !open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (isMobile) {
    return (
      <div
        ref={overlayRef}
        className={`${appStyles.mobileDrawerOverlay} ${open ? appStyles.mobileDrawerOverlayVisible : ''}`}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-label={open ? (title || undefined) : undefined}
        aria-hidden={open ? undefined : true}
        // Keep the off-screen container out of the tab order and a11y tree: it is hidden
        // only via translateX, so aria-hidden alone would leave its close button focusable.
        // React 18 passes the empty string through as inert="" (a boolean `true` warns).
        inert={open ? undefined : ''}
        tabIndex={open ? -1 : undefined}
      >
        <div className={appStyles.mobileLogMgmtHeader}>
          <span className={appStyles.mobileLogMgmtTitle}>{title}</span>
          <MobileDrawerCloseButton onClose={onClose} tabIndex={open ? 0 : -1} />
        </div>
        {panel && panel.serviceStatus && panel.serviceStatus !== 'ready' && (
          <Alert
            type="warning"
            showIcon
            style={{ margin: '4px 8px' }}
            message={t('ui.pluginPanel.serviceNotReady', { state: serviceStateLabel(panel.serviceStatus) })}
          />
        )}
        <div className={appStyles.mobilePluginPanelBody}>
          {open && panel && (
            <PanelHost
              panel={panel}
              attempt={attempt}
              onRetry={onRetry}
              onClose={onClose}
              theme={theme}
              lang={lang}
              isMobile
              project={project}
              instance={instance}
            />
          )}
        </div>
      </div>
    );
  }

  const width = Math.min(panel?.width || 1100, Math.max(360, window.innerWidth - 32));
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={width}
      destroyOnHidden
      title={title}
      styles={{
        mask: BLUR_MASK_STYLE,
        body: { padding: 0, maxHeight: '80vh', overflow: 'auto' },
      }}
    >
      {panel && panel.serviceStatus && panel.serviceStatus !== 'ready' && (
        <Alert
          type="warning"
          showIcon
          style={{ margin: '8px' }}
          message={t('ui.pluginPanel.serviceNotReady', { state: serviceStateLabel(panel.serviceStatus) })}
        />
      )}
      {open && panel && (
        <PanelHost
          panel={panel}
          attempt={attempt}
          onRetry={onRetry}
          onClose={onClose}
          theme={theme}
          lang={lang}
          isMobile={false}
          project={project}
          instance={instance}
        />
      )}
    </Modal>
  );
}
