/**
 * CompactionSettingsModal.jsx — "context compaction settings" list management panel.
 *
 * Interaction structure mirrors PresetModal (quick commands): list (drag handle + Checkbox
 * multi-select + enable Switch + title + threshold summary + script preview + edit) + bottom
 * "Delete selected / Add command" + a secondary add/edit Modal.
 *
 * Differences from PresetModal: compaction commands have no built-in presets / no builtinId /
 * dismissed concept; each item additionally has threshold (percent|tokens) and enabled fields.
 *
 * props (controlled):
 *   open, onClose,
 *   items        — normalized array with frontend-temporary ids [{id,title,script,threshold,enabled}]
 *   onItemsChange(items) — updates local state only (intermediate states of sorting/selection/enable toggles)
 *   onSave(payload)      — persists; payload is produced by buildContextCompactionPayload
 *   autoCompactThreshold — optional; the built-in auto-compact threshold (tokens) from the SDK snapshot, used for the conflict hint
 */
import React, { useState, useRef, useCallback } from 'react';
import { Modal, Button, Checkbox, Switch, Select, InputNumber } from 'antd';
import { t } from '../../i18n';
import styles from '../terminal/TerminalPanel.module.css';
import { useSdkContextUsage } from '../dashboard/SdkContextUsageProvider';
import {
  COMPACTION_DEFAULTS,
  buildContextCompactionPayload,
  normalizeCompactionItem,
} from '../../utils/contextCompaction';

export default function CompactionSettingsModal({ open, onClose, items, onItemsChange, onSave, autoCompactThreshold: autoCompactThresholdProp }) {
  // Built-in auto-compact threshold: prefer the prop (passed by the ChatView host), otherwise read from the SDK usage context
  // (TerminalPanel is a class component and cannot hook, so fetch it inside this function component to eliminate the dead prop).
  const sdkCtx = useSdkContextUsage();
  const sdkUsage = sdkCtx?.detail?.usage;
  const autoCompactThreshold = (typeof autoCompactThresholdProp === 'number' && autoCompactThresholdProp > 0)
    ? autoCompactThresholdProp
    : (sdkUsage?.autoCompactThreshold ?? null);
  // Context window limit (used to convert the threshold into a percentage): maxTokens/rawMaxTokens from the SDK snapshot.
  const maxTokens = (typeof sdkUsage?.maxTokens === 'number' && sdkUsage.maxTokens > 0)
    ? sdkUsage.maxTokens
    : (typeof sdkUsage?.rawMaxTokens === 'number' && sdkUsage.rawMaxTokens > 0 ? sdkUsage.rawMaxTokens : null);
  // Threshold as a percentage of the window (e.g. 967K / 1000K ≈ 96.7%); null without window data, degrading the hint to K only.
  const autoCompactPercent = (autoCompactThreshold > 0 && maxTokens)
    ? Math.round((autoCompactThreshold / maxTokens) * 1000) / 10
    : null;
  const save = useCallback((nextItems) => {
    if (typeof onSave === 'function') onSave(buildContextCompactionPayload(nextItems));
  }, [onSave]);

  const [selected, setSelected] = useState(new Set());
  const [formVisible, setFormVisible] = useState(false);
  const [editId, setEditId] = useState(null);
  // Form draft
  const [fTitle, setFTitle] = useState('');
  const [fScript, setFScript] = useState('');
  const [fMode, setFMode] = useState('percent');
  const [fValue, setFValue] = useState(COMPACTION_DEFAULTS.percentDefault);
  const [fEnabled, setFEnabled] = useState(true);
  const [fTiming, setFTiming] = useState('user');
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);
  const [, forceRender] = useState(0);

  const resetForm = useCallback(() => {
    setFormVisible(false); setEditId(null);
    setFTitle(''); setFScript(''); setFMode('percent'); setFValue(COMPACTION_DEFAULTS.percentDefault); setFEnabled(true); setFTiming('user');
  }, []);

  const handleClose = useCallback(() => { setSelected(new Set()); resetForm(); onClose(); }, [onClose, resetForm]);

  const handleToggle = useCallback((id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // Built-in rules (builtinId, e.g. the default compaction rule): NOT read-only — fully editable
  // (title/script/threshold/enabled/timing) but NOT deletable, so the 960K forced compaction always
  // has a default rule to run. Only the delete path is locked.
  const isBuiltin = (item) => item && item.builtinId != null;

  const handleDelete = useCallback(() => {
    if (selected.size === 0) return;
    // Built-in rows are never deleted (their Checkbox is disabled in the UI); strip them as a safeguard.
    const builtinIds = new Set(items.filter(isBuiltin).map(i => i.id));
    const next = items.filter(i => !selected.has(i.id) || builtinIds.has(i.id));
    setSelected(new Set());
    onItemsChange(next);
    save(next);
  }, [items, selected, onItemsChange, save]);

  const handleToggleEnabled = useCallback((id, enabled) => {
    const next = items.map(i => i.id === id ? { ...i, enabled } : i);
    onItemsChange(next);
    save(next);
  }, [items, onItemsChange, save]);

  const openEdit = useCallback((item) => {
    setEditId(item.id);
    setFTitle(item.title || '');
    setFScript(item.script || '');
    setFMode(item.threshold?.mode === 'tokens' ? 'tokens' : 'percent');
    setFValue(item.threshold?.value ?? COMPACTION_DEFAULTS.percentDefault);
    setFEnabled(item.enabled !== false);
    setFTiming(item.executionTiming || 'user');
    setFormVisible(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const editing = editId != null ? items.find(i => i.id === editId) : null;
    const editingBuiltin = editing && editing.builtinId != null;
    const draft = normalizeCompactionItem({
      ...(editingBuiltin ? { builtinId: editing.builtinId } : {}),
      // 内置规则标题不可编辑(表单已隐藏该字段):始终置空,展示层统一用 i18n 内置名。
      title: editingBuiltin ? '' : fTitle, script: fScript,
      threshold: { mode: fMode, value: fValue },
      enabled: fEnabled,
      executionTiming: fTiming,
    });
    if (!draft) return; // empty script; OK is already disabled, double safeguard
    let next;
    if (editId != null) {
      next = items.map(i => i.id === editId ? { ...i, ...draft } : i);
    } else {
      next = [...items, { id: Date.now(), ...draft }];
    }
    onItemsChange(next);
    save(next);
    resetForm();
  }, [items, editId, fTitle, fScript, fMode, fValue, fEnabled, onItemsChange, save, resetForm]);

  const handleDragStart = (idx, e) => { e.stopPropagation(); dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => forceRender(n => n + 1)); };
  const handleDragOver = (idx, e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (dragOverIdx.current !== idx) { dragOverIdx.current = idx; forceRender(n => n + 1); } };
  const handleDragEnd = () => { dragIdx.current = null; dragOverIdx.current = null; forceRender(n => n + 1); };
  const handleDragLeave = (idx, e) => { e.stopPropagation(); if (dragOverIdx.current === idx) { dragOverIdx.current = null; forceRender(n => n + 1); } };
  const handleDrop = (idx, e) => {
    e.preventDefault(); e.stopPropagation();
    const from = dragIdx.current;
    if (from === null || from === idx) { handleDragEnd(); return; }
    const arr = [...items]; const [moved] = arr.splice(from, 1);
    arr.splice(from < idx ? idx - 1 : idx, 0, moved);
    onItemsChange(arr); save(arr); handleDragEnd();
  };

  // Built-in auto-compact hint: give a reference when the SDK snapshot threshold exists; in tokens mode, use a warning color when the user threshold ≥ it.
  const showBuiltinHint = autoCompactThreshold > 0;
  const conflictWithBuiltin = showBuiltinHint && fMode === 'tokens' && fValue * 1000 >= autoCompactThreshold;

  const modalSkin = {
    content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' },
    header: { background: 'var(--bg-elevated)', borderBottom: 'none' },
  };

  return (
    <>
      <Modal title={t('ui.contextCompaction.title')} open={open} onCancel={handleClose} footer={null} width={800} styles={modalSkin}>
        <div style={{ color: 'var(--text-secondary, #888)', fontSize: 12, margin: '4px 0 10px' }}>{t('ui.contextCompaction.hint')}</div>
        <div className={styles.presetList} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); }}>
          {items.length === 0 ? <div className={styles.presetListEmptyHint}>{t('ui.contextCompaction.empty')}</div> : items.map((item, idx) => {
            const builtin = isBuiltin(item);
            // Built-in rule: title may be empty (we don't persist a localized default); fall back to
            // the dedicated i18n name. A user-edited title is shown verbatim (it's editable).
            const name = builtin
              ? (item.title || t('ui.contextCompaction.builtinDefaultTitle'))
              : (item.title || t('ui.contextCompaction.defaultTitle'));
            return (
              <div key={item.id} className={`${styles.presetRow} ${dragIdx.current === idx ? styles.presetRowDragging : ''} ${dragOverIdx.current === idx && dragIdx.current !== idx ? styles.presetRowDragOver : ''}`}
                onDragOver={e => handleDragOver(idx, e)} onDragLeave={e => handleDragLeave(idx, e)} onDrop={e => handleDrop(idx, e)} onDragEnd={handleDragEnd}>
                <span className={styles.dragHandle} draggable onDragStart={e => handleDragStart(idx, e)}>
                  <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>
                </span>
                <Checkbox checked={selected.has(item.id)} onChange={() => handleToggle(item.id)} disabled={builtin} />
                <Switch size="small" checked={item.enabled !== false} onChange={(v) => handleToggleEnabled(item.id, v)} title={t('ui.contextCompaction.enabled')} />
                <span className={styles.presetName} title={name}>
                  {name}
                  {builtin && <span className={styles.compactionBuiltinTag}>{t('ui.contextCompaction.locked')}</span>}
                </span>
                <span className={styles.presetText} title={item.script}>
                  {item.threshold?.mode === 'tokens'
                    ? t('ui.contextCompaction.thresholdSummaryTokens', { tokens: item.threshold.value })
                    : t('ui.contextCompaction.thresholdSummaryPercent', { percent: item.threshold?.value })}
                  {' · '}{t(`ui.contextCompaction.timingSummary_${item.executionTiming || 'user'}`)}
                  {' · '}{item.script}
                </span>
                <Button size="small" type="link" onClick={() => openEdit(item)}>{t('ui.contextCompaction.edit')}</Button>
              </div>
            );
          })}
        </div>
        <div className={styles.presetActions}>
          <Button size="small" danger disabled={selected.size === 0} onClick={handleDelete}>{t('ui.contextCompaction.deleteSelected')}</Button>
          <Button size="small" onClick={() => { resetForm(); setFormVisible(true); }}>{t('ui.contextCompaction.add')}</Button>
        </div>
      </Modal>

      <Modal title={editId != null ? t('ui.contextCompaction.edit') : t('ui.contextCompaction.add')} open={formVisible}
        onCancel={resetForm} onOk={handleSubmit}
        okText={editId != null ? t('ui.ok') : t('ui.contextCompaction.add')} cancelText={t('ui.cancel')}
        okButtonProps={{ disabled: !fScript.trim() }} width={560} styles={modalSkin}
        className={styles.compactionFormModal}>
        {/* 内置(默认)规则的标题固定为「默认压缩规则」,不可编辑——编辑内置项时不显示标题字段。 */}
        {!(editId != null && isBuiltin(items.find(i => i.id === editId))) && (
          <div className={styles.presetFormField}>
            <label className={styles.presetFormLabel}>{t('ui.contextCompaction.titleLabel')}</label>
            <input className={styles.presetInput} placeholder={t('ui.contextCompaction.titlePlaceholder')} value={fTitle} onChange={e => setFTitle(e.target.value)} maxLength={COMPACTION_DEFAULTS.maxTitleLen} />
          </div>
        )}
        <div className={styles.presetFormField}>
          <label className={styles.presetFormLabel}>{t('ui.contextCompaction.scriptLabel')}</label>
          <textarea className={styles.presetTextarea} rows={8} placeholder={t('ui.contextCompaction.scriptPlaceholder')} value={fScript} onChange={e => setFScript(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.stopPropagation(); }} />
        </div>
        <div className={styles.presetFormField}>
          <label className={styles.presetFormLabel}>{t('ui.contextCompaction.thresholdLabel')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select value={fMode} onChange={setFMode} style={{ width: 170 }}
              options={[
                { value: 'percent', label: t('ui.contextCompaction.modePercent') },
                { value: 'tokens', label: t('ui.contextCompaction.modeTokens') },
              ]} />
            <InputNumber value={fValue} onChange={(v) => setFValue(v)}
              min={fMode === 'tokens' ? COMPACTION_DEFAULTS.minTokensK : COMPACTION_DEFAULTS.minPercent}
              max={fMode === 'tokens' ? COMPACTION_DEFAULTS.maxTokensK : COMPACTION_DEFAULTS.maxPercent}
              addonAfter={fMode === 'tokens' ? 'K' : '%'} style={{ width: 140 }} />
            <span style={{ color: 'var(--text-secondary, #888)', fontSize: 12 }}>{t('ui.contextCompaction.enabled')}</span>
            <Switch size="small" checked={fEnabled} onChange={setFEnabled} />
          </div>
          {showBuiltinHint && (
            <div style={{ color: conflictWithBuiltin ? 'var(--warning, #d48806)' : 'var(--text-secondary, #888)', fontSize: 12, marginTop: 6 }}>
              {autoCompactPercent != null
                ? t('ui.contextCompaction.autoCompactHintPct', { tokens: Math.round(autoCompactThreshold / 1000), percent: autoCompactPercent })
                : t('ui.contextCompaction.autoCompactHint', { tokens: Math.round(autoCompactThreshold / 1000) })}
            </div>
          )}
        </div>
        <div className={styles.presetFormField}>
          <label className={styles.presetFormLabel}>{t('ui.contextCompaction.executionTimingLabel')}</label>
          <Select value={fTiming} onChange={setFTiming} style={{ width: 240 }}
            options={[
              { value: 'user', label: t('ui.contextCompaction.timingUser') },
              { value: 's30', label: t('ui.contextCompaction.timingS30') },
              { value: 'm3', label: t('ui.contextCompaction.timingM3') },
              { value: 'auto', label: t('ui.contextCompaction.timingAuto') },
            ]} />
          <div style={{ color: 'var(--text-secondary, #888)', fontSize: 12, marginTop: 6 }}>
            {t(`ui.contextCompaction.timingHint_${fTiming}`)}
          </div>
        </div>
      </Modal>
    </>
  );
}
