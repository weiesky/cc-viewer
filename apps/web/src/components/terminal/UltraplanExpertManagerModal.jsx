import React, { useRef, useState } from 'react';
import { Modal, Switch, message } from 'antd';
import { t } from '../../i18n';
import { buildExpertList, reorderKeys, canHideOne } from '../../utils/ultraplanExperts';
import styles from './UltraplanExpertManagerModal.module.css';

// UltraPlan「管理专家」弹窗：统一管理内置(代码/调研)与自定义专家的「显示/隐藏」与「拖拽排序」。
// 数据真源 = buildExpertList(customExperts, order, hidden)(纯函数，src/utils/ultraplanExperts.js)。
// 受控组件：每次显隐/排序都立即 onPersist({order,hidden})，父级落服务端 preferences 后回灌 props。
// 列表展示「全部」专家(含已隐藏，便于重新显示)；只有可见者才会出现在 popover 的 tab 条上。

// 内置专家在列表里的标题 / 描述 i18n key + 图标。
const BUILTIN_META = {
  codeExpert: {
    titleKey: 'ui.ultraplan.roleCodeExpert',
    descKey: 'ui.ultraplan.roleCodeExpertDesc',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  },
  researchExpert: {
    titleKey: 'ui.ultraplan.roleResearchExpert',
    descKey: 'ui.ultraplan.roleResearchExpertDesc',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  },
};
const CUSTOM_ICON = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>;

export default function UltraplanExpertManagerModal({ open, customExperts, order, hidden, onPersist, onClose }) {
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);
  const [, forceRender] = useState(0);

  const list = buildExpertList(customExperts, order, hidden);

  const persist = (nextOrderKeys, nextHidden) => {
    onPersist({ order: nextOrderKeys, hidden: nextHidden });
  };

  // 显示/隐藏：受控,立即持久化。护栏:不允许隐藏最后一个可见专家(canHideOne)。
  const handleToggle = (key, nextVisible) => {
    if (!nextVisible && !canHideOne(list)) {
      message.warning(t('ui.ultraplan.keepOneVisible'));
      return;
    }
    const hiddenSet = new Set(Array.isArray(hidden) ? hidden : []);
    if (nextVisible) hiddenSet.delete(key); else hiddenSet.add(key);
    persist(list.map(d => d.key), [...hiddenSet]);
  };

  // 拖拽排序(照搬 PresetModal 的原生 HTML5 范式)。
  const handleDragStart = (idx, e) => { e.stopPropagation(); dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => forceRender(n => n + 1)); };
  const handleDragOver = (idx, e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (dragOverIdx.current !== idx) { dragOverIdx.current = idx; forceRender(n => n + 1); } };
  const handleDragEnd = () => { dragIdx.current = null; dragOverIdx.current = null; forceRender(n => n + 1); };
  const handleDragLeave = (idx, e) => { e.stopPropagation(); if (dragOverIdx.current === idx) { dragOverIdx.current = null; forceRender(n => n + 1); } };
  const handleDrop = (idx, e) => {
    e.preventDefault(); e.stopPropagation();
    const from = dragIdx.current;
    if (from === null || from === idx) { handleDragEnd(); return; }
    const keys = reorderKeys(list.map(d => d.key), from, idx);
    persist(keys, Array.isArray(hidden) ? hidden : []);
    handleDragEnd();
  };

  return (
    <Modal
      title={t('ui.ultraplan.manageExperts')}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(560px, calc(100vw - 80px))"
      zIndex={1300}
      destroyOnHidden
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      <div
        className={styles.list}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); }}
      >
        {list.map((d, idx) => {
          const meta = d.kind === 'builtin' ? BUILTIN_META[d.key] : null;
          const title = meta ? t(meta.titleKey) : (d.item?.title || '');
          const desc = meta ? t(meta.descKey) : '';
          const icon = meta ? meta.icon : CUSTOM_ICON;
          return (
            <div
              key={d.key}
              className={`${styles.row} ${dragIdx.current === idx ? styles.rowDragging : ''} ${dragOverIdx.current === idx && dragIdx.current !== idx ? styles.rowDragOver : ''} ${d.hidden ? styles.rowHidden : ''}`}
              onDragOver={e => handleDragOver(idx, e)}
              onDragLeave={e => handleDragLeave(idx, e)}
              onDrop={e => handleDrop(idx, e)}
              onDragEnd={handleDragEnd}
            >
              <span className={styles.dragHandle} draggable onDragStart={e => handleDragStart(idx, e)} aria-hidden="true">
                <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>
              </span>
              <span className={styles.icon}>{icon}</span>
              <span className={styles.meta}>
                <span className={styles.title} title={title}>{title}</span>
                {desc && <span className={styles.desc} title={desc}>{desc}</span>}
              </span>
              <Switch
                className={styles.switch}
                size="small"
                checked={!d.hidden}
                aria-label={`${title} — ${t('ui.ultraplan.expertShow')}`}
                onChange={(checked) => handleToggle(d.key, checked)}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
