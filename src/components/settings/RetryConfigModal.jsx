import React, { useState, useEffect } from 'react';
import { Modal, Segmented, Select, InputNumber, Tooltip, Button, message } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { isMobile } from '../../env';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import ConceptHelp from '../common/ConceptHelp';
import styles from './RetryConfigModal.module.css';
import appStyles from '../../App.module.css';
import MobileDrawerCloseButton from '../mobile/MobileDrawerCloseButton';

// Proxy retry config Modal — shared by PC + mobile, mirrors ProxyModal's semi-controlled style.
// config/defaults come from AppBase state (injected via GET /api/retry-config); a local editable draft form is held here.
// Changes bubble up via onConfigChange(config) to the parent's POST, then refresh on SSE push-back (same pattern as proxy_profile).
//
// Design tradeoff: 8 knobs laid out flat in a single Modal (unlike ProxyModal, which needs a secondary edit dialog — retry has few fields and no list).
// "Reset to default" returns to DEFAULT_RETRY_CONFIG (mode=off, for backward-compatible semantics), not ccv-retry.sh's recommended serial.
// streamIdleTimeoutMs has no consumer in the current version, so it is greyed out read-only with a tooltip note, to avoid confusion from editing something that won't take effect.

const MODE_OPTIONS = [
  { label: 'off', value: 'off' },
  { label: 'serial', value: 'serial' },
  { label: 'race', value: 'race' },
  { label: 'stagger', value: 'stagger' },
];

// Candidate status codes that trigger a retry (covers common gateway overload / rate-limit / timeout)
const STATUS_CODE_OPTIONS = [429, 500, 502, 503, 504, 508, 529, 408];

// Editable numeric field metadata: [key, unit, min, max]
const NUMERIC_FIELDS = [
  { key: 'retryIntervalMs', unit: 'ms', min: 0, max: 600000 },
  { key: 'retryInterval429Ms', unit: 'ms', min: 0, max: 600000 },
  { key: 'maxRetries', unit: '', min: 0, max: 1000 },
  { key: 'maxConcurrent', unit: '', min: 1, max: 100 },
  { key: 'connectTimeoutMs', unit: 'ms', min: 0, max: 600000 },
];

export default function RetryConfigModal({
  open,
  onClose,
  config,
  defaults,
  onConfigChange,
}) {
  // Local draft: initialized from config when open, reset on close. Avoids an in-flight external SSE refresh clobbering the user's input.
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open && config) {
      setForm({ ...config });
    } else if (!open) {
      setForm(null);
    }
  }, [open, config]);

  const def = defaults || {};

  const patch = (key, value) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  // Reset a single field to its default
  const resetField = (key) => {
    setForm(prev => (prev ? { ...prev, [key]: def[key] } : prev));
  };

  // Reset all fields to defaults
  const resetAll = () => {
    setForm({ ...def });
  };

  const handleSave = async () => {
    if (!form) return;
    // mode whitelist validation (mirrors server-side validateRetryField)
    if (!['off', 'serial', 'race', 'stagger'].includes(form.mode)) {
      message.warning(t('ui.retryConfig.invalidMode'));
      return;
    }
    // Wait until the POST actually succeeds before showing "saved" and closing; on failure AppBase.handleRetryConfigChange
    // rolls back state + message.error, so we keep the Modal open for the user to retry/edit (no false success emitted).
    try {
      await onConfigChange(form);
      message.success(t('ui.retryConfig.saved'));
      onClose();
    } catch {
      // Failure feedback is handled centrally by AppBase; here we just prevent the Modal from closing
    }
  };

  // Whether a field's current value deviates from its default (the "reset to default" button shows only when dirty)
  const isDirty = (key) => JSON.stringify(form?.[key]) !== JSON.stringify(def[key]);

  const titleNode = (
    <span>
      {t('ui.retryConfig.title')}{' '}
      <ConceptHelp doc="RetryConfig" zIndex={1100} />
    </span>
  );

  const renderResetBtn = (key) => (
    isDirty(key) ? (
      <Tooltip title={t('ui.retryConfig.resetDefault')}>
        <Button type="text" size="small" icon={<UndoOutlined />} onClick={() => resetField(key)} />
      </Tooltip>
    ) : null
  );

  const bodyNode = form ? (
    <div className={styles.form}>
      {/* mode selection */}
      <div className={styles.row}>
        <span className={styles.label}>
          {t('ui.retryConfig.mode')}
          {renderResetBtn('mode')}
        </span>
        <Segmented
          size="small"
          value={form.mode || 'off'}
          options={MODE_OPTIONS}
          onChange={v => patch('mode', v)}
        />
        <div className={styles.hint}>{t(`ui.retryConfig.modeHint.${form.mode || 'off'}`)}</div>
      </div>

      <div className={styles.divider} />

      {/* Status codes that trigger a retry */}
      <div className={styles.row}>
        <span className={styles.label}>
          {t('ui.retryConfig.statusCodes')}
          {renderResetBtn('retryStatusCodes')}
        </span>
        <Select
          mode="multiple"
          size="small"
          className={styles.fullWidth}
          value={form.retryStatusCodes || []}
          onChange={v => patch('retryStatusCodes', v.map(Number).filter(n => Number.isFinite(n) && n > 0))}
          options={STATUS_CODE_OPTIONS.map(c => ({ label: String(c), value: c }))}
        />
        <div className={styles.hint}>{t('ui.retryConfig.statusCodesHint')}</div>
      </div>

      <div className={styles.divider} />

      {/* Numeric fields */}
      {NUMERIC_FIELDS.map(f => (
        <div className={styles.row} key={f.key}>
          <span className={styles.label}>
            {t(`ui.retryConfig.${f.key}`)}
            {renderResetBtn(f.key)}
          </span>
          <div className={styles.numField}>
            <InputNumber
              size="small"
              value={form[f.key]}
              min={f.min}
              max={f.max}
              onChange={v => patch(f.key, v)}
            />
            {f.unit && <span className={styles.unit}>{f.unit}</span>}
          </div>
        </div>
      ))}

      {/* streamIdleTimeoutMs: reserved field, greyed out read-only */}
      <div className={styles.row}>
        <span className={styles.label}>
          {t('ui.retryConfig.streamIdleTimeoutMs')}
          <Tooltip title={t('ui.retryConfig.streamIdleReserved')}>
            <span className={styles.reservedTag}>{t('ui.retryConfig.reserved')}</span>
          </Tooltip>
        </span>
        <div className={styles.numField}>
          <InputNumber size="small" value={form.streamIdleTimeoutMs} disabled />
          <span className={styles.unit}>ms</span>
        </div>
      </div>

      <div className={styles.footer}>
        <Button size="small" icon={<UndoOutlined />} onClick={resetAll}>
          {t('ui.retryConfig.resetAll')}
        </Button>
        <div className={styles.footerRight}>
          <Button size="small" onClick={onClose}>{t('ui.retryConfig.cancel')}</Button>
          <Button size="small" type="primary" onClick={handleSave}>{t('ui.retryConfig.save')}</Button>
        </div>
      </div>

      <div className={styles.note}>{t('ui.retryConfig.note')}</div>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className={`${appStyles.mobileDrawerOverlay} ${open ? appStyles.mobileDrawerOverlayVisible : ''}`}>
        <div className={appStyles.mobileLogMgmtHeader}>
          <span className={appStyles.mobileLogMgmtTitle}>{titleNode}</span>
          <MobileDrawerCloseButton onClose={onClose} />
        </div>
        <div className={appStyles.mobileDrawerInner}>
          <div className={styles.scroll}>
            {bodyNode}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Modal
      title={titleNode}
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      styles={{ body: isMobile ? { zoom: 0.6 } : {}, mask: BLUR_MASK_STYLE }}
    >
      {bodyNode}
    </Modal>
  );
}
