import React, { useState, useEffect, useRef } from 'react';
import { Segmented, Select, InputNumber, Tooltip, Button, message, Spin } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './RetryConfigModal.module.css';

// Retry mode options. `value` is the API token (backend validates against
// ['off','serial','race','stagger']); `label` is the i18n'd display name shown
// in the Segmented control, resolved per-render so it follows the active language.
const MODE_VALUES = ['off', 'serial', 'race', 'stagger'];
const modeOptions = () => MODE_VALUES.map(v => ({
  value: v,
  label: t(`ui.retryConfig.modeLabel.${v}`),
}));

const STATUS_CODE_OPTIONS = [429, 500, 502, 503, 504, 508, 529, 408];

const NUMERIC_FIELDS = [
  { key: 'retryIntervalMs', unit: 'ms', min: 0, max: 600000 },
  { key: 'retryInterval429Ms', unit: 'ms', min: 0, max: 600000 },
  { key: 'maxRetries', unit: '', min: 0, max: 1000 },
  { key: 'maxConcurrent', unit: '', min: 1, max: 100 },
  { key: 'connectTimeoutMs', unit: 'ms', min: 0, max: 600000 },
];

// ─── RetryConfigForm (named export) ──────────────────────────────────────────
// Reusable form component with its own state management. Used inline inside the
// unified proxy retry Config & Stats panel, which owns its own close affordance —
// hence no onCancel/embedded props here.
//
// Props:
//   config     - current retry config object
//   defaults   - default values for reset buttons
//   onSave     - async (formData) => Promise — returns a promise; caller handles success/failure feedback
export function RetryConfigForm({ config, defaults, onSave }) {
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (config) {
      if (!initializedRef.current) {
        setForm({ ...config });
        initializedRef.current = true;
      } else if (!dirty) {
        // External config change (SSE push) — sync only if user hasn't edited
        setForm({ ...config });
      }
    }
  }, [config, dirty]);

  const def = defaults || {};

  const patch = (key, value) => {
    setDirty(true);
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const resetField = (key) => {
    setDirty(true);
    setForm(prev => (prev ? { ...prev, [key]: def[key] } : prev));
  };

  const resetAll = () => {
    setDirty(true);
    setForm({ ...def });
  };

  const handleSave = async () => {
    if (!form) return;
    if (!MODE_VALUES.includes(form.mode)) {
      message.warning(t('ui.retryConfig.invalidMode'));
      return;
    }
    try {
      await onSave(form);
      message.success(t('ui.retryConfig.saved'));
      setDirty(false); // allow future SSE syncs
    } catch (err) {
      // AppBase already rolls back state and shows an error toast; keep the
      // form open so the user can retry. Record the failure for diagnostics so
      // intermittent "config didn't persist" reports are traceable.
      reportSwallowed('retryConfig.save', err);
    }
  };

  const isDirty = (key) => JSON.stringify(form?.[key]) !== JSON.stringify(def[key]);

  const renderResetBtn = (key) => (
    isDirty(key) ? (
      <Tooltip title={t('ui.retryConfig.resetDefault')}>
        <Button type="text" size="small" icon={<UndoOutlined />} onClick={() => resetField(key)} />
      </Tooltip>
    ) : null
  );

  if (!form) {
    return (
      <div className={styles.form} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <div className={styles.configGrid}>
        <section className={styles.configGroup}>
          <div className={styles.groupTitle}>{t('ui.retryConfig.groupStrategy')}</div>

          <div className={styles.row}>
            <span className={styles.label}>
              {t('ui.retryConfig.mode')}
              {renderResetBtn('mode')}
            </span>
            <div className={styles.inputCell}>
              <Segmented
                value={form.mode || 'off'}
                options={modeOptions()}
                onChange={v => patch('mode', v)}
              />
              <div className={styles.hint}>{t(`ui.retryConfig.modeHint.${form.mode || 'off'}`)}</div>
            </div>
          </div>

          <div className={styles.row}>
            <span className={styles.label}>
              {t('ui.retryConfig.statusCodes')}
              {renderResetBtn('retryStatusCodes')}
            </span>
            <div className={styles.inputCell}>
              <Select
                mode="multiple"
                className={styles.fullWidth}
                value={form.retryStatusCodes || []}
                onChange={v => patch('retryStatusCodes', v.map(Number).filter(n => Number.isFinite(n) && n > 0))}
                options={STATUS_CODE_OPTIONS.map(c => ({ label: String(c), value: c }))}
              />
              <div className={styles.hint}>{t('ui.retryConfig.statusCodesHint')}</div>
            </div>
          </div>
        </section>

        <section className={styles.configGroup}>
          <div className={styles.groupTitle}>{t('ui.retryConfig.groupExecution')}</div>

          {NUMERIC_FIELDS.map(f => (
            <div className={styles.row} key={f.key}>
              <span className={styles.label}>
                {t(`ui.retryConfig.${f.key}`)}
                {renderResetBtn(f.key)}
              </span>
              <div className={styles.inputCell}>
                <div className={styles.numField}>
                  <InputNumber
                    className={styles.numInput}
                    value={form[f.key]}
                    min={f.min}
                    max={f.max}
                    onChange={v => patch(f.key, v)}
                  />
                  {f.unit && <span className={styles.unit}>{f.unit}</span>}
                </div>
              </div>
            </div>
          ))}

          <div className={styles.row}>
            <span className={styles.label}>
              {t('ui.retryConfig.streamIdleTimeoutMs')}
              <Tooltip title={t('ui.retryConfig.streamIdleReserved')}>
                <span className={styles.reservedTag}>{t('ui.retryConfig.reserved')}</span>
              </Tooltip>
            </span>
            <div className={styles.inputCell}>
              <div className={styles.numField}>
                <InputNumber className={styles.numInput} value={form.streamIdleTimeoutMs} disabled />
                <span className={styles.unit}>ms</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <Button icon={<UndoOutlined />} onClick={resetAll}>
          {t('ui.retryConfig.resetAll')}
        </Button>
        <div className={styles.footerRight}>
          <Button type="primary" onClick={handleSave}>{t('ui.retryConfig.save')}</Button>
        </div>
      </div>

      <div className={styles.note}>{t('ui.retryConfig.note')}</div>
    </div>
  );
}
