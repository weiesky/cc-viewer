import React from 'react';
import { Alert, Button, Modal, Progress } from 'antd';
import { t } from '../../i18n';
import { formatSize } from '../../utils/formatters';
import styles from './UpdateModal.module.css';

export function downloadPercent({ downloaded, total } = {}) {
  return Number.isFinite(downloaded) && Number.isFinite(total) && total > 0 ? Math.min(100, Math.floor(downloaded / total * 100)) : null;
}

export default function UpdateModal({ open, onCancel, currentVersion, method, state, updateInfo, onCheck, onStart, onRestart, restarting, restartError, canRestart }) {
  const busy = ['checking', 'downloading', 'installing', 'restarting'].includes(state?.status);
  const version = state?.version || updateInfo?.version;
  const percent = downloadPercent(state);
  const restartingState = restarting || state?.status === 'restarting';
  const codeStyle = { display: 'block', background: 'var(--bg-code)', padding: '8px 12px', borderRadius: 6, fontSize: 13 };
  let content;
  if (method === 'electron') {
    content = <><p><strong>{t('ui.update.electron')}</strong></p><p className={styles.muted}>{t('ui.update.electronDesc')}</p><ol className={styles.muted}><li>{t('ui.update.step1')}</li><li>{t('ui.update.step2')}</li><li>{t('ui.update.step3')}</li></ol></>;
  } else if (method === 'brew') {
    content = <><p><strong>{t('ui.update.brew')}</strong></p><code style={codeStyle}>brew upgrade cc-viewer</code></>;
  } else if (method === 'pnpm') {
    content = <><p><strong>{t('ui.update.pnpm')}</strong></p><code style={codeStyle}>pnpm add -g cc-viewer@latest</code></>;
  } else {
    content = <>
      <p><strong>{t('ui.update.npm')}</strong></p>
      {!version && !busy && <p className={styles.muted}>{t('ui.update.checkHint')}</p>}
      {version && <p><strong>{t('ui.update.latest')}:</strong> v{version}</p>}
      {state?.status === 'latest' && <Alert type="success" showIcon message={t('ui.update.upToDate')} />}
      {state?.status === 'checking' && <Progress percent={0} status="active" showInfo={false} />}
      {state?.status === 'downloading' && <><p>{t('ui.update.downloading')}</p><Progress percent={percent ?? 0} status="active" showInfo={percent !== null} /><p className={styles.muted}>{formatSize(state.downloaded || 0)}{state.total ? ` / ${formatSize(state.total)}` : ''}</p></>}
      {state?.status === 'installing' && <><p>{t('ui.update.installing')}</p><Progress percent={0} status="active" showInfo={false} /></>}
      {state?.status === 'restart_required' && <Alert type="success" showIcon message={t('ui.update.ready', { version })} description={canRestart === false ? t('ui.update.manualRestart') : t('ui.update.restartWarning')} />}
      {state?.status === 'error' && <Alert type="error" showIcon message={t('ui.update.failed')} description={state.error} />}
      {restartError && <Alert type="error" showIcon message={restartError} />}
    </>;
  }
  return <Modal title={t('ui.update.title')} open={open} onCancel={onCancel} footer={null} width={560} maskClosable={!busy}>
    <div className={styles.content}>
      <p><strong>{t('ui.update.current')}:</strong> v{currentVersion}</p>
      {version && <p><strong>{t('ui.update.latest')}:</strong> v{version}</p>}
      {content}
      <div className={styles.actions}>
        {method === 'npm' && !restarting && state?.status !== 'restart_required' && <Button onClick={onCheck} loading={state?.status === 'checking'} disabled={busy}>{t('ui.update.check')}</Button>}
        {method === 'npm' && !restarting && version && state?.status !== 'restart_required' && <Button type="primary" onClick={onStart} disabled={busy} loading={state?.status === 'downloading' || state?.status === 'installing'}>{state?.status === 'error' ? t('ui.update.retry') : t('ui.update.start')}</Button>}
        {method === 'npm' && state?.status === 'restart_required' && !restarting && canRestart !== false && <Button type="primary" danger onClick={() => Modal.confirm({ title: t('ui.update.restart'), content: t('ui.update.restartWarning'), okText: t('ui.update.restart'), okButtonProps: { danger: true }, cancelText: t('ui.update.later'), onOk: onRestart })}>{t('ui.update.restart')}</Button>}
        {restartingState && <span className={styles.muted}>{t('ui.update.restarting')}</span>}
        <Button href="https://github.com/weiesky/cc-viewer/releases" target="_blank" rel="noopener noreferrer">{t('ui.update.goReleases')}</Button>
      </div>
    </div>
  </Modal>;
}
