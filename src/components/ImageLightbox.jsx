import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { t as i18n } from '../i18n';
import styles from './ImageLightbox.module.css';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const FADE_MS = 150;

export default function ImageLightbox({ src, alt, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [closing, setClosing] = useState(false);
  const dragRef = useRef(null);
  const imgRef = useRef(null);
  const touchRef = useRef(null);
  const overlayRef = useRef(null);
  const stateRef = useRef({ zoom: 1, offset: { x: 0, y: 0 } });
  const mountedRef = useRef(true);

  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  useEffect(() => { stateRef.current.zoom = zoom; }, [zoom]);
  useEffect(() => { stateRef.current.offset = offset; }, [offset]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Animated close — set closing state, useEffect handles the delayed onClose
  const doClose = useCallback(() => {
    setClosing(true);
  }, []);

  // Fade-out timer: fires onClose after animation, cleaned up on unmount
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(() => {
      if (mountedRef.current) onClose();
    }, FADE_MS);
    return () => clearTimeout(id);
  }, [closing, onClose]);

  // ESC to close + body scroll lock with scrollbar-gutter
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') doClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    const prevScrollbarGutter = document.body.style.scrollbarGutter;
    document.body.style.overflow = 'hidden';
    document.body.style.scrollbarGutter = 'stable';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.scrollbarGutter = prevScrollbarGutter;
    };
  }, [doClose]);

  // Auto-fit large images to viewport on load
  const handleImageLoad = useCallback((e) => {
    setLoaded(true);
    const img = e.target;
    const vw = window.innerWidth * 0.9;
    const vh = window.innerHeight * 0.9;
    if (img.naturalWidth > vw || img.naturalHeight > vh) {
      const fit = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
      const initial = Math.min(1, fit);
      setZoom(initial);
    }
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setZoom(prev => {
      const next = clampZoom(prev * (e.deltaY < 0 ? 1.06 : 1 / 1.06));
      const ratio = next / prev;
      setOffset(o => ({ x: o.x * ratio, y: o.y * ratio }));
      return next;
    });
  }, []);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Mouse drag pan
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { offset: cur } = stateRef.current;
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: cur.x, oy: cur.y };
    setDragging(true);

    const onMove = (ev) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.ox + ev.clientX - dragRef.current.startX,
        y: dragRef.current.oy + ev.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      if (mountedRef.current) setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Touch: pinch-to-zoom + single-finger pan
  const handleTouchStart = useCallback((e) => {
    const { zoom: z, offset: o } = stateRef.current;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current = { dist: Math.hypot(dx, dy), zoom: z, ox: o.x, oy: o.y, isPinch: true };
    } else if (e.touches.length === 1) {
      touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, ox: o.x, oy: o.y, isPinch: false, moved: false };
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchRef.current) return;
    e.preventDefault();
    if (touchRef.current.isPinch && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / touchRef.current.dist;
      setZoom(clampZoom(touchRef.current.zoom * scale));
    } else if (e.touches.length === 1) {
      if (touchRef.current.isPinch) {
        const { offset: o } = stateRef.current;
        touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, ox: o.x, oy: o.y, isPinch: false, moved: false };
        return;
      }
      const dx = e.touches[0].clientX - touchRef.current.startX;
      const dy = e.touches[0].clientY - touchRef.current.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchRef.current.moved = true;
      setOffset({ x: touchRef.current.ox + dx, y: touchRef.current.oy + dy });
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!touchRef.current) return;
    if (e.touches.length > 0) {
      touchRef.current = null;
      return;
    }
    if (!touchRef.current.isPinch && !touchRef.current.moved && e.changedTouches.length === 1) {
      const target = e.target;
      if (target === overlayRef.current || target.classList.contains(styles.imageArea)) {
        doClose();
      }
    }
    touchRef.current = null;
  }, [doClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current || e.target.classList.contains(styles.imageArea)) {
      doClose();
    }
  }, [doClose]);

  // Double-click to toggle zoom
  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    setZoom(prev => {
      setOffset({ x: 0, y: 0 });
      return prev > 1.1 ? 1 : 2.5;
    });
  }, []);

  const closeLabel = i18n('ui.imageLightbox.close');

  const overlayClass = [
    styles.overlay,
    dragging && styles.dragging,
    closing && styles.closing,
  ].filter(Boolean).join(' ');

  const content = (
    <div
      className={overlayClass}
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image preview'}
      onClick={handleOverlayClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <button className={styles.closeBtn} onClick={doClose} title={closeLabel} aria-label={closeLabel}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <div className={styles.imageArea}>
        {error ? (
          <div className={styles.errorMsg}>Failed to load image</div>
        ) : (
          <>
            {!loaded && <div className={styles.spinner} />}
            <img
              ref={imgRef}
              className={styles.image}
              src={src}
              alt={alt || ''}
              draggable={false}
              onLoad={handleImageLoad}
              onError={() => setError(true)}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClick}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                opacity: loaded ? 1 : 0,
              }}
            />
          </>
        )}
      </div>

      {zoom !== 1 && (
        <div className={styles.zoomLabel}>{Math.round(zoom * 100)}%</div>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
