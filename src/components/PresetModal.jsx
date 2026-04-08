import React, { useState, useRef, useCallback } from 'react';
import { Modal, Button, Checkbox } from 'antd';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import styles from './TerminalPanel.module.css';

function savePresets(items, dismissed) {
  const payload = {
    presetShortcuts: items.map(i => {
      const o = { teamName: i.teamName, description: i.description };
      if (i.builtinId) o.builtinId = i.builtinId;
      if (i.modified) o.modified = true;
      return o;
    }),
  };
  if (dismissed) payload.dismissedBuiltinPresets = [...dismissed];
  fetch(apiUrl('/api/preferences'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(() => {
    window.dispatchEvent(new Event('ccv-presets-changed'));
  }).catch(() => {});
}

export default function PresetModal({ open, onClose, items, onItemsChange, dismissedBuiltinPresets }) {
  const [selected, setSelected] = useState(new Set());
  const [addVisible, setAddVisible] = useState(false);
  const [addName, setAddName] = useState('');
  const [addText, setAddText] = useState('');
  const [editId, setEditId] = useState(null);
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);
  const [, forceRender] = useState(0);
  const dismissed = useRef(new Set(dismissedBuiltinPresets || []));

  const handleClose = useCallback(() => { setSelected(new Set()); onClose(); }, [onClose]);

  const handleToggle = useCallback((id) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const handleDelete = useCallback(() => {
    if (selected.size === 0) return;
    const d = new Set(dismissed.current);
    for (const item of items) { if (selected.has(item.id) && item.builtinId) d.add(item.builtinId); }
    dismissed.current = d;
    const next = items.filter(i => !selected.has(i.id));
    setSelected(new Set());
    onItemsChange(next);
    savePresets(next, d);
  }, [items, selected, onItemsChange]);

  const handleAdd = useCallback(() => {
    const description = addText.trim();
    const teamName = addName.trim();
    if (!description && !teamName) return;
    let next;
    if (editId) {
      next = items.map(i => {
        if (i.id !== editId) return i;
        const updated = { ...i, teamName, description };
        if (i.builtinId) updated.modified = true;
        return updated;
      });
    } else {
      next = [...items, { id: Date.now(), teamName, description }];
    }
    onItemsChange(next);
    savePresets(next);
    setAddVisible(false); setAddName(''); setAddText(''); setEditId(null);
  }, [items, addName, addText, editId, onItemsChange]);

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
    onItemsChange(arr); savePresets(arr); handleDragEnd();
  };

  return (
    <>
      <Modal title={t('ui.terminal.presetShortcuts')} open={open} onCancel={handleClose} footer={null} width={800}
        styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}>
        <div className={styles.presetSectionHeader}><span className={styles.presetSectionTitle}>{t('ui.terminal.agentTeamCustom')}</span></div>
        <div className={styles.presetList} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); }}>
          {items.length === 0 ? <div className={styles.presetListEmptyHint}>—</div> : items.map((item, idx) => {
            const isBuiltinRaw = item.builtinId && !item.modified;
            const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
            const desc = isBuiltinRaw ? t(item.description) : item.description;
            return (
              <div key={item.id} className={`${styles.presetRow} ${dragIdx.current === idx ? styles.presetRowDragging : ''} ${dragOverIdx.current === idx && dragIdx.current !== idx ? styles.presetRowDragOver : ''}`}
                onDragOver={e => handleDragOver(idx, e)} onDragLeave={e => handleDragLeave(idx, e)} onDrop={e => handleDrop(idx, e)} onDragEnd={handleDragEnd}>
                <span className={styles.dragHandle} draggable onDragStart={e => handleDragStart(idx, e)}>
                  <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>
                </span>
                <Checkbox checked={selected.has(item.id)} onChange={() => handleToggle(item.id)} />
                <span className={styles.presetName} title={name}>{name || '—'}</span>
                <span className={styles.presetText} title={desc}>{desc}</span>
                <Button size="small" type="link" onClick={() => { setAddVisible(true); setAddName(isBuiltinRaw ? t(item.teamName) : item.teamName); setAddText(isBuiltinRaw ? t(item.description) : item.description); setEditId(item.id); }}>{t('ui.terminal.editItem')}</Button>
              </div>
            );
          })}
        </div>
        <div className={styles.presetActions}>
          <Button size="small" danger disabled={selected.size === 0} onClick={handleDelete}>{t('ui.terminal.deleteSelected')}</Button>
          <Button size="small" onClick={() => { setAddVisible(true); setAddName(''); setAddText(''); setEditId(null); }}>{t('ui.terminal.addItem')}</Button>
        </div>
      </Modal>
      <Modal title={editId ? t('ui.terminal.editItem') : t('ui.terminal.addItem')} open={addVisible}
        onCancel={() => { setAddVisible(false); setAddName(''); setAddText(''); setEditId(null); }}
        onOk={handleAdd} okText={editId ? t('ui.ok') : t('ui.terminal.addItem')} cancelText={t('ui.cancel')}
        okButtonProps={{ disabled: !addText.trim() && !addName.trim() }} width="fit-content"
        styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}>
        <div className={styles.presetFormField}>
          <label className={styles.presetFormLabel}>Team {t('ui.terminal.teamName')}</label>
          <input className={styles.presetInput} placeholder={t('ui.terminal.teamNamePlaceholder')} value={addName} onChange={e => setAddName(e.target.value)} />
        </div>
        <div>
          <label className={styles.presetFormLabel}>Team {t('ui.terminal.teamDesc')}</label>
          <textarea className={styles.presetTextarea} rows={6} placeholder={t('ui.terminal.presetInputPlaceholder')} value={addText} onChange={e => setAddText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.stopPropagation(); }} />
        </div>
      </Modal>
    </>
  );
}
