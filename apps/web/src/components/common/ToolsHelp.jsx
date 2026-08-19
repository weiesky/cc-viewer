import React, { useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { isMobile, isPad } from '../../env';
import { TOOL_CATALOG } from '../../utils/toolCatalog';
import ConceptHelp from './ConceptHelp';
import styles from './ToolsHelp.module.css';

/**
 * "All tools" catalog help. Renders a small `?` trigger; clicking it opens a
 * modal listing every built-in tool grouped by category (TOOL_CATALOG).
 * Clicking a tool opens its concepts/<lang>/Tool-<name>.md in a *second-level*
 * modal (via ConceptHelp) stacked on top — the catalog stays mounted
 * underneath, so there is no in-place content swap / flicker.
 */
export default function ToolsHelp({ zIndex, closeParent, onOpenChange, children }) {
  const [open, setOpen] = useState(false);
  const compact = isMobile && !isPad;

  // 二级（工具说明）弹窗需叠在目录弹窗之上：目录用 baseZ，内层 ConceptHelp 用更高值。
  const baseZ = zIndex || 1000;
  const innerZ = baseZ + 10;

  // onOpenChange 让宿主感知目录开关:血条 Popover 是「内容随开关换出」型,需借此让其守卫
  // (_isCacheDetailModalOpen)保持展开,否则目录 Modal 会随 Popover 收起被卸载。
  const setCatalogOpen = (next) => {
    setOpen(next);
    if (typeof onOpenChange === 'function') onOpenChange(next);
  };

  // 打开目录弹窗时收起承载本组件的 hover 弹层(token 统计面板),避免「原窗口」残留在底层。
  // 弹层 destroyTooltipOnHide 默认为 false + 目录 Modal portal 到 body,故本组件不会被卸载。
  const openCatalog = () => {
    setCatalogOpen(true);
    if (typeof closeParent === 'function') closeParent();
  };

  // 触发器位于 hover Popover(工具使用统计面板)内,点击不得穿透到外层。
  const triggerHandlers = {
    onClick: (e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); openCatalog(); },
    onMouseDown: (e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
    onPointerDown: (e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openCatalog();
      }
    },
  };

  const modalStyles = compact ? {
    header: { padding: '8px 12px', margin: 0 },
    body: { maxHeight: '80vh', overflow: 'auto', padding: '8px 10px' },
    content: { padding: 0 },
  } : {
    body: { padding: '16px 24px 24px', background: 'var(--bg-container)', borderRadius: '4px' },
    content: { padding: '12px 20px' },
  };

  return (
    <>
      {children
        ? React.cloneElement(children, {
            ...triggerHandlers,
            // 只加指针手势,不改原文案颜色/样式。
            style: { cursor: 'pointer', ...(children.props.style || {}) },
          })
        : (
          <span
            className={styles.helpBtn}
            role="button"
            tabIndex={0}
            aria-label={t('ui.toolCatalog.help')}
            title={t('ui.toolCatalog.help')}
            {...triggerHandlers}
          >?</span>
        )}
      <Modal
        title={t('ui.toolCatalog.title')}
        open={open}
        onCancel={() => setCatalogOpen(false)}
        footer={null}
        width={compact ? '98vw' : 800}
        centered={compact}
        styles={modalStyles}
        zIndex={baseZ}
        wrapProps={{ onMouseDown: (e) => e.stopPropagation() }}
      >
        <div className={styles.catalog}>
          {TOOL_CATALOG.map((group) => (
            <div key={group.key} className={styles.catBlock}>
              <div className={styles.catLabel}>{t(`ui.toolCatalog.cat.${group.key}`)}</div>
              <div className={styles.chipRow}>
                {group.tools.map((name) => (
                  <ConceptHelp key={name} doc={`Tool-${name}`} zIndex={innerZ}>
                    <span
                      className={styles.toolChip}
                      role="button"
                      tabIndex={0}
                      aria-label={name}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                    >{name}</span>
                  </ConceptHelp>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
