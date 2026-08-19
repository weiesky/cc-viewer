import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile, isPad } from '../../env';
import { calcResizedSize } from '../../utils/resizeCalc';
import { buildExpertList } from '../../utils/ultraplanExperts';
import ImageLightbox from '../common/ImageLightbox';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import styles from './UltraPlanModal.module.css';

// 真手机不启用自定义 handle(保留原生 resize: vertical);PC + iPad 启用。
// iPad 走 Mobile.jsx 入口但 isPad=true,通过 `!isMobile || isPad` 命中。
const ENABLE_RESIZE_HANDLE = !isMobile || isPad;

// Modal 尺寸 clamp:宽 [400, 90vw](modal 太窄 chip 行会挤),高 [240, 90vh]。
// 拖拽改的是 modal 自己,maxW/maxH 在 pointerdown 时按 window 现尺寸算。
const SIZE_CLAMP = {
  minW: 400,
  minH: 240,
};

// 中止当前正在进行的拖拽:abort listener + 释放 pointer capture + 清 ref。
// useEffect cleanup 调用(open 变 false / 卸载),也兼容 onEnd 内同步调用。
// 返回 () => void 形式方便 useEffect cleanup 直接 return。
function _abortActiveDrag(dragRef) {
  return () => {
    const d = dragRef.current;
    if (!d) return;
    try { d.handle?.releasePointerCapture?.(d.pointerId); } catch {}
    try { d.controller?.abort(); } catch {}
    dragRef.current = null;
  };
}

// tab 条上每个专家的图标：内置 code=<> / research=放大镜，自定义=星形。
function _expertIcon(d) {
  if (d.kind === 'custom') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>;
  }
  if (d.key === 'codeExpert') {
    return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
  }
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}

export default function UltraPlanModal({
  open, variant, prompt, files, customExperts, expertOrder, expertHidden,
  onClose, onVariantChange, onPromptChange, onSend, onUpload, onPaste, onRemoveFile, onOpenCustomEditor, onOpenManager,
  modalSize, onModalSizeChange,
}) {
  const [lightbox, setLightbox] = useState(null);
  const modalRef = useRef(null);
  const textareaRef = useRef(null);
  const dragRef = useRef(null);

  // 首挂载根据 props.modalSize 把 inline width/height 写到 modal;之后拖拽期
  // 直接改 DOM style 不走 setState(避免 ChatView 整棵 re-render)。
  // textarea 通过 flex: 1 1 auto 自动跟随 modal 高度,不需要单独写 height。
  useEffect(() => {
    if (!open || !ENABLE_RESIZE_HANDLE) return;
    const modal = modalRef.current;
    if (!modal) return;
    if (modalSize?.w) {
      modal.style.width = `${modalSize.w}px`;
      // 拖拽 width 超 CSS max-width:560px 时,也要松开 max-width
      modal.style.maxWidth = `${modalSize.w}px`;
    }
    if (modalSize?.h) {
      modal.style.height = `${modalSize.h}px`;
      modal.style.maxHeight = `${modalSize.h}px`;
    }
  }, [open, modalSize]);

  // 拖拽中关闭 modal / 组件卸载时:abort 当前 drag,清掉 document 上的 pointer listener,
  // 释放 pointer capture,避免 listener 残留 + onEnd 在 close 后才触发的 setState 漏。
  useEffect(() => {
    if (open) return undefined;
    return _abortActiveDrag(dragRef);
  }, [open]);
  useEffect(() => () => _abortActiveDrag(dragRef)(), []);

  const handlePointerDown = useCallback((e) => {
    if (!ENABLE_RESIZE_HANDLE) return;
    const modal = modalRef.current;
    if (!modal) return;
    // 同时按住多个 pointer 时只认第一个,后续 pointerdown 忽略
    if (dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    const maxW = Math.round(window.innerWidth * 0.9);
    const maxH = Math.round(window.innerHeight * 0.9);
    const controller = new AbortController();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: modal.offsetWidth, startH: modal.offsetHeight,
      clamp: { ...SIZE_CLAMP, maxW, maxH },
      pointerId: e.pointerId,
      handle: e.currentTarget,
      controller,
    };

    // rAF 节流:120/240Hz 鼠标 pointermove 高于显示帧率,直接每事件写 style 是无用功。
    // 同帧多事件只保留最后一次坐标,下一帧 flush;rafScheduled 防重复 schedule。
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
        modal.style.width = `${w}px`;
        modal.style.maxWidth = `${w}px`;
        modal.style.height = `${h}px`;
        modal.style.maxHeight = `${h}px`;
      });
    };

    const onEnd = () => {
      const d = dragRef.current;
      if (!d) return;
      const finalW = modal.offsetWidth;
      const finalH = modal.offsetHeight;
      try { d.handle?.releasePointerCapture?.(d.pointerId); } catch {}
      d.controller.abort();
      dragRef.current = null;
      if (typeof onModalSizeChange === 'function') {
        onModalSizeChange({ w: finalW, h: finalH });
      }
    };

    const signal = controller.signal;
    document.addEventListener('pointermove', onMove, { signal });
    document.addEventListener('pointerup', onEnd, { signal });
    document.addEventListener('pointercancel', onEnd, { signal });
  }, [onModalSizeChange]);

  if (!open) return null;

  const hasContent = (prompt || '').trim() || files.length > 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} ref={modalRef}>
        {ENABLE_RESIZE_HANDLE && (
          // Modal 左上角 drag handle:拖拽改 modal 整体尺寸,textarea 通过 flex grow 跟随。
          // role=separator + tabIndex=-1:不进 Tab 焦点链,modal 打开时 autoFocus 落 textarea。
          // SVG 直角三角形,左上顶点 rounded(r=4),斜边右上→左下,语义吻合"左上角 resize"。
          <div
            className={styles.resizeHandle}
            onPointerDown={handlePointerDown}
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
        )}
        <div className={styles.modalContent}>
        <div className={styles.header}>
          <span className={styles.title}>{t('ui.ultraplan.title')}</span>
          <div className={styles.headerActions}>
            {onOpenManager && (
              <button className={styles.closeBtn} onClick={onOpenManager} title={t('ui.ultraplan.manageExperts')} aria-label={t('ui.ultraplan.manageExperts')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.variantRow}>
              {buildExpertList(customExperts, expertOrder, expertHidden)
                .filter(d => !d.hidden)
                .map(d => {
                  const active = variant === d.key;
                  if (d.kind === 'builtin') {
                    return (
                      <button
                        key={d.key}
                        className={`${styles.roleBtn} ${active ? styles.roleBtnActive : ''}`}
                        onClick={() => onVariantChange(d.key)}
                      >
                        {_expertIcon(d)}
                        {t(d.key === 'codeExpert' ? 'ui.ultraplan.roleCodeExpert' : 'ui.ultraplan.roleResearchExpert')}
                      </button>
                    );
                  }
                  const item = d.item;
                  return (
                    <span key={d.key} className={styles.customWrap}>
                      <button
                        className={`${styles.roleBtn} ${active ? styles.roleBtnActive : ''}`}
                        onClick={() => onVariantChange(d.key)}
                        title={item.title}
                      >
                        {_expertIcon(d)}
                        <span className={styles.customTitle}>{item.title}</span>
                      </button>
                      {onOpenCustomEditor && (
                        <span
                          className={styles.editPencil}
                          onClick={(e) => { e.stopPropagation(); onOpenCustomEditor(item); }}
                          title={t('ui.ultraplan.customEditTitle')}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                        </span>
                      )}
                    </span>
                  );
                })}
              {onOpenCustomEditor && (
                <button
                  type="button"
                  className={styles.addExpertBtn}
                  onClick={() => onOpenCustomEditor(null)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t('ui.ultraplan.customExpert')}
                </button>
              )}
            </div>

            <div className={styles.textareaWrap}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={prompt}
                onChange={e => onPromptChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hasContent) { e.preventDefault(); onSend(); } }}
                onPaste={onPaste}
                placeholder={t('ui.ultraplan.placeholder')}
                /* 启用自定义 drag handle 时 rows={1} 让 CSS flex 完全控制高度
                   (rows 是 textarea intrinsic 最小高度,在 flex 算法里会被当 baseline
                   干扰 grow);手机模式回原生 resize:vertical,需要 rows=5 起步合理 */
                rows={ENABLE_RESIZE_HANDLE ? 1 : 5}
                autoFocus
                /* 真手机回到原生 resize: vertical(CSS 默认是 none) */
                style={ENABLE_RESIZE_HANDLE ? undefined : { resize: 'vertical' }}
              />
              {files.length > 0 && (
                <div className={styles.fileList}>
                  {files.map((f, i) => {
                    const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(f.name);
                    const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(f.path)}`);
                    return isImage ? (
                      <div key={i} className={styles.imageItem} title={f.name}>
                        <img
                          src={src}
                          className={styles.imageThumb}
                          alt={f.name}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setLightbox({ src, alt: f.name }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ src, alt: f.name }); } }}
                        />
                        <ConfirmRemoveButton
                          title={t('ui.chatInput.confirmRemoveImage')}
                          onConfirm={() => onRemoveFile(i)}
                          className={styles.imageRemove}
                          ariaLabel={t('ui.chatInput.removeImage')}
                        >&times;</ConfirmRemoveButton>
                      </div>
                    ) : (
                      <span key={i} className={styles.fileChip} title={f.name}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span className={styles.fileName}>{f.name}</span>
                        <ConfirmRemoveButton
                          title={t('ui.chatInput.confirmRemoveFile')}
                          onConfirm={() => onRemoveFile(i)}
                          className={styles.fileRemove}
                          ariaLabel={t('ui.chatInput.removeImage')}
                          tag="span"
                        >&times;</ConfirmRemoveButton>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.footer}>
              <button className={styles.sendBtn} disabled={!hasContent} onClick={onSend}>{t('ui.ultraplan.send')}</button>
              <button className={styles.uploadBtn} onClick={onUpload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                {t('ui.ultraplan.upload')}
              </button>
            </div>
        </div>
      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          zIndex={1150}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
