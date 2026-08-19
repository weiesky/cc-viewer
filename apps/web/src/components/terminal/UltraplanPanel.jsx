// UltraPlan 弹层面板（共享）—— TerminalPanel 终端工具栏与 ChatInputBar 对话输入框
// 两个入口的 antd Popover content 共用此组件，单一事实源防止「同款弹层」迭代漂移。
// 完全受控：内容三态与全部行为经 props 注入；lightbox / confirming 留 host
// （host 的 Popover onOpenChange 守卫必须同步读这两个状态，经 onPreviewImage /
// onConfirmingChange 上报）；resize 拖拽逻辑内置（两入口共享 localStorage 尺寸记忆）。
import React, { useRef, useState } from 'react';
import { t } from '../../i18n';
import { isMobile, isPad } from '../../env';
import { apiUrl } from '../../utils/apiUrl';
import { buildExpertList } from '../../utils/ultraplanExperts';
import { calcResizedSize } from '../../utils/resizeCalc';
import ConceptHelp from '../common/ConceptHelp';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import styles from './UltraplanPanel.module.css';

// 拖拽尺寸持久化:与 UltraPlanModal 共享语义但 key 分开,因为
// popover 几何/位置约束不同(浮锚 trigger 按钮、最大约 70vh,modal 居中可到 90vh)。
// 终端工具栏与输入栏两个入口共用同一对 key —— 一处调过尺寸另一处同步记忆。
const _ULTRAPLAN_POPOVER_W_KEY = 'cc-viewer-ultraplan-popover-width';
const _ULTRAPLAN_POPOVER_H_KEY = 'cc-viewer-ultraplan-popover-height';

export function readUltraplanPopoverSize() {
  try {
    const w = parseFloat(localStorage.getItem(_ULTRAPLAN_POPOVER_W_KEY));
    const h = parseFloat(localStorage.getItem(_ULTRAPLAN_POPOVER_H_KEY));
    if (Number.isFinite(w) || Number.isFinite(h)) {
      return { w: Number.isFinite(w) ? w : null, h: Number.isFinite(h) ? h : null };
    }
  } catch {}
  return null;
}

function writeUltraplanPopoverSize(size) {
  try {
    if (size?.w) localStorage.setItem(_ULTRAPLAN_POPOVER_W_KEY, String(size.w));
    if (size?.h) localStorage.setItem(_ULTRAPLAN_POPOVER_H_KEY, String(size.h));
  } catch {}
}

// 两个 host 的 Popover overlayInnerStyle 同源构造
export function ultraplanOverlayInnerStyle(size) {
  return {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-hover)',
    borderRadius: 8,
    padding: 0,
    // popover 宽高由 host state 驱动;拖拽期直接改 .ant-popover-inner inline style
    // (避免高频 setState),pointerup 经 onSizeChange 落 state。
    width: size?.w || 560,
    height: size?.h || 480,
  };
}

// tab 条上每个专家的图标：内置 code=<> / research=放大镜，自定义=星形。
function expertIcon(d) {
  if (d.kind === 'custom') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>;
  }
  if (d.key === 'codeExpert') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  }
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}

export default function UltraplanPanel({
  variant, prompt, files,
  customExperts, expertOrder, expertHidden,
  onVariantChange, onPromptChange,
  onSend, onUpload, onPaste, onRemoveFile,
  onClose, onOpenManager, onOpenCustomEditor,
  onPreviewImage, onConfirmingChange, onSizeChange,
}) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  // 输入框聚焦时才在 footer 显示浅色粘贴提示（仅 iPad/PC，见下方 footer 渲染）
  const [inputFocused, setInputFocused] = useState(false);

  // popover resize:左上 handle → 拖拽改 popover overlay 的 width/height。
  // 拖拽期直接改 .ant-popover-inner 的 inline style 不走 setState(避免高频 re-render);
  // pointerup 回调 onSizeChange + 落 localStorage。AbortController 一刀清 listener,
  // 防中途关 popover 留残;setPointerCapture 保所有 pointer 事件落 handle 元素。
  const handleResizePointerDown = (e) => {
    const panel = panelRef.current;
    if (!panel) return;
    const inner = panel.closest('.ant-popover-inner');
    if (!inner || dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    const controller = new AbortController();
    const clamp = {
      minW: 360,
      minH: 280,
      maxW: Math.round(window.innerWidth * 0.9),
      maxH: Math.round(window.innerHeight * 0.7),
    };
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: inner.offsetWidth, startH: inner.offsetHeight,
      clamp,
      pointerId: e.pointerId,
      handle: e.currentTarget,
      controller,
      inner,
    };

    let pendingXY = null;
    let rafScheduled = false;
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      pendingXY = { x: ev.clientX, y: ev.clientY };
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        const p = pendingXY;
        pendingXY = null;
        const dd = dragRef.current;
        if (!dd || !p) return;
        const { w, h } = calcResizedSize({
          startX: dd.startX, startY: dd.startY,
          curX: p.x, curY: p.y,
          startW: dd.startW, startH: dd.startH,
          dirX: -1, dirY: -1,
          clamp: dd.clamp,
        });
        dd.inner.style.width = `${w}px`;
        dd.inner.style.height = `${h}px`;
      });
    };

    const onEnd = () => {
      const d = dragRef.current;
      if (!d) return;
      const finalW = d.inner.offsetWidth;
      const finalH = d.inner.offsetHeight;
      try { d.handle?.releasePointerCapture?.(d.pointerId); } catch {}
      d.controller.abort();
      dragRef.current = null;
      const size = { w: finalW, h: finalH };
      writeUltraplanPopoverSize(size);
      onSizeChange?.(size);
    };

    const signal = controller.signal;
    document.addEventListener('pointermove', onMove, { signal });
    document.addEventListener('pointerup', onEnd, { signal });
    document.addEventListener('pointercancel', onEnd, { signal });
  };

  return (
    <div className={styles.ultraplanPanel} ref={panelRef}>
      <div
        className={styles.ultraplanResizeHandle}
        onPointerDown={handleResizePointerDown}
        aria-label={t('ui.ultraplan.resizeHandle')}
        role="separator"
        tabIndex={-1}
      >
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M 4 0 L 16 0 L 0 16 L 0 4 A 4 4 0 0 1 4 0 Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className={styles.ultraplanContent}>
      <div className={styles.ultraplanHeader}>
        <span className={styles.ultraplanHeaderTitle}>
          {t('ui.ultraplan.title')}
          <ConceptHelp doc="UltraPlan" zIndex={1100} />
          <button
            type="button"
            className={styles.ultraplanManageBtn}
            title={t('ui.ultraplan.manageExperts')}
            aria-label={t('ui.ultraplan.manageExperts')}
            onClick={onOpenManager}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
        </span>
        <button
          type="button"
          className={styles.ultraplanCloseBtn}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className={styles.ultraplanVariantRow}>
        {buildExpertList(customExperts, expertOrder, expertHidden)
          .filter(d => !d.hidden)
          .map(d => {
            const active = variant === d.key;
            if (d.kind === 'builtin') {
              return (
                <button
                  key={d.key}
                  className={`${styles.ultraplanRoleBtn} ${active ? styles.ultraplanRoleBtnActive : ''}`}
                  onClick={() => onVariantChange(d.key)}
                >{expertIcon(d)}{t(d.key === 'codeExpert' ? 'ui.ultraplan.roleCodeExpert' : 'ui.ultraplan.roleResearchExpert')}</button>
              );
            }
            const item = d.item;
            return (
              <span key={d.key} className={styles.ultraplanCustomWrap}>
                <button
                  className={`${styles.ultraplanRoleBtn} ${active ? styles.ultraplanRoleBtnActive : ''}`}
                  onClick={() => onVariantChange(d.key)}
                  title={item.title}
                >
                  {expertIcon(d)}
                  <span className={styles.ultraplanCustomTitle}>{item.title}</span>
                </button>
                <span
                  className={styles.ultraplanEditPencil}
                  onClick={(e) => { e.stopPropagation(); onOpenCustomEditor(item); }}
                  title={t('ui.ultraplan.customEditTitle')}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                </span>
              </span>
            );
          })}
        <button
          type="button"
          className={styles.ultraplanAddExpertBtn}
          onClick={() => onOpenCustomEditor(null)}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('ui.ultraplan.customExpert')}
        </button>
      </div>
      <div className={styles.ultraplanInputBox}>
        <textarea
          className={styles.ultraplanTextarea}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (prompt.trim() || files.length > 0)) { e.preventDefault(); onSend(); } }}
          onPaste={onPaste}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder={t('ui.ultraplan.placeholder')}
          /* rows={1} 让 CSS flex 完全控制高度,避免 rows*line-height 作 intrinsic baseline 干扰 grow */
          rows={1}
          autoFocus
        />
        {files.length > 0 && (
          <div className={styles.ultraplanFileList}>
            {files.map((f, i) => {
              const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(f.name);
              const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(f.path)}`);
              return isImage ? (
                <div key={i} className={styles.ultraplanImageItem} title={f.name}>
                  <img
                    src={src}
                    className={styles.ultraplanImageThumb}
                    alt={f.name}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onPreviewImage({ src, alt: f.name }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreviewImage({ src, alt: f.name }); } }}
                  />
                  <ConfirmRemoveButton
                    title={t('ui.chatInput.confirmRemoveImage')}
                    onConfirm={() => onRemoveFile(i)}
                    onPopupOpenChange={onConfirmingChange}
                    className={styles.ultraplanImageRemove}
                    ariaLabel={t('ui.chatInput.removeImage')}
                  >&times;</ConfirmRemoveButton>
                </div>
              ) : (
                <span key={i} className={styles.ultraplanFileChip} title={f.name}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span className={styles.ultraplanFileName}>{f.name}</span>
                  <ConfirmRemoveButton
                    tag="span"
                    title={t('ui.chatInput.confirmRemoveFile')}
                    onConfirm={() => onRemoveFile(i)}
                    onPopupOpenChange={onConfirmingChange}
                    className={styles.ultraplanFileRemove}
                    ariaLabel={t('ui.chatInput.removeImage')}
                  >&times;</ConfirmRemoveButton>
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.ultraplanFooter}>
        <button className={styles.ultraplanSendBtn} disabled={!prompt.trim() && files.length === 0} onClick={onSend}>{t('ui.ultraplan.send')}</button>
        {!(isMobile && !isPad) && (
          <span className={`${styles.ultraplanPasteHint}${inputFocused ? ` ${styles.ultraplanPasteHintVisible}` : ''}`}>
            {t('ui.ultraplan.pasteImageHint')}
          </span>
        )}
        <button className={styles.ultraplanUploadBtn} onClick={onUpload}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>{t('ui.ultraplan.upload')}</button>
      </div>
      </div>
    </div>
  );
}
