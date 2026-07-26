import React, { useState } from 'react';
import { Segmented } from 'antd';
import { t } from '../../i18n';
import ConceptHelp from '../common/ConceptHelp';
import ProxyStatsDashboard from './ProxyStatsDashboard';
import { RetryConfigForm } from '../settings/RetryConfigModal';
import styles from './ProxyStatsModal.module.css';

// Tabbed proxy-retry panel: Config (default) | Stats, switched via a Segmented
// control in the toolbar. Both tabs live in one shell on every viewport; the
// parent antd Modal (App.jsx) owns the mask/close-button, so this shell renders
// no Modal of its own.
export default function ProxyStatsModal({ retryConfig, retryDefaults, onRetryConfigChange }) {
  const [tab, setTab] = useState('config');

  const handleConfigSave = async (formData) => {
    await onRetryConfigChange(formData);
  };

  return (
    <div className={styles.shell}>
      <div className={styles.toolbar}>
        <h3 className={styles.toolbarTitle}>{t('ui.proxyStats.title')}</h3>
        <div className={styles.toolbarActions}>
          <Segmented
            size="small"
            value={tab}
            onChange={setTab}
            options={[
              { label: t('ui.proxyStats.tabConfig'), value: 'config' },
              { label: t('ui.proxyStats.tabStats'), value: 'stats' },
            ]}
          />
        </div>
      </div>
      <div className={styles.body}>
        {tab === 'config' ? (
          <div className={styles.configScroll}>
            <div className={styles.configFormWrap}>
              <div className={styles.configHeader}>
                <span className={styles.configHeaderTitle}>{t('ui.retryConfig.title')}</span>
                <ConceptHelp doc="RetryConfig" zIndex={1100} />
              </div>
              <RetryConfigForm
                config={retryConfig}
                defaults={retryDefaults}
                onSave={handleConfigSave}
              />
            </div>
          </div>
        ) : (
          <ProxyStatsDashboard />
        )}
      </div>
    </div>
  );
}
