import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { t as i18n } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import styles from './ImageViewer.module.css';

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.25;

export default function ImageViewer({ filePath, onClose, editorSession }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState(null);
  const [fileSize, setFileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [svgContent, setSvgContent] = useState(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const isSvg = (filePath || '').toLowerCase().endsWith('.svg');
  const imgSrc = apiUrl(`/api/file-raw?path=${encodeURIComponent(filePath)}${editorSession ? '&editorSession=true' : ''}`);

  // SVG: fetch raw text for inline rendering (CSS background shows through transparent areas)
  useEffect(() => {
    if (!isSvg) { setSvgContent(null); return; }
    setLoading(true);
    fetch(imgSrc).then(r => r.text()).then(text => {
      setSvgContent(DOMPurify.sanitize(text, { USE_PROFILES: { svg: true } }));
      // SVG viewBox 通常很小（如 24x24），用合理的渲染基准尺寸避免 fitToWindow 过度放大
      const vb = text.match(/viewBox=["']([^"']+)["']/);
      const vbW = vb ? (vb[1].split(/[\s,]+/).map(Number)[2] || 24) : 24;
      const vbH = vb ? (vb[1].split(/[\s,]+/).map(Number)[3] || 24) : 24;
      const aspect = vbW / vbH;
      const baseSize = 200;
      setNaturalSize({ w: Math.round(baseSize * aspect), h: baseSize });
      setLoading(false);
    }).catch(() => { setError('Failed to load SVG'); setLoading(false); });
  }, [isSvg, imgSrc]);

  // Fetch file size
  useEffect(() => {
    fetch(imgSrc, { method: 'HEAD' })
      .then(r => {
        const len = r.headers.get('content-length');
        if (len) setFileSize(parseInt(len, 10));
      })
      .catch(() => {});
  }, [filePath, editorSession, imgSrc]);

  const fitToWindow = useCallback(() => {
    if (!naturalSize || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = (rect.width - 40) / naturalSize.w;
    const scaleY = (rect.height - 40) / naturalSize.h;
    const fit = Math.min(scaleX, scaleY);
    setZoom(fit);
    setOffset({
      x: (rect.width - naturalSize.w * fit) / 2,
      y: (rect.height - naturalSize.h * fit) / 2,
    });
  }, [naturalSize]);

  const handleImageLoad = useCallback((e) => {
    const img = e.target;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setLoading(false);
  }, []);

  // Fit to window once natural size is known, and on resize
  useEffect(() => {
    if (!naturalSize) return;
    // Delay to ensure layout is settled
    const raf = requestAnimationFrame(() => fitToWindow());
    let resizeRaf;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => fitToWindow());
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
    };
  }, [naturalSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImageError = useCallback(() => {
    setError('Failed to load image');
    setLoading(false);
  }, []);

  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom(prev => {
      const next = clampZoom(prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      const ratio = next / prev;
      setOffset(o => ({
        x: mx - ratio * (mx - o.x),
        y: my - ratio * (my - o.y),
      }));
      return next;
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: offset.x, startOy: offset.y };
    const canvas = canvasRef.current;
    canvas.classList.add(styles.dragging);

    const onMove = (ev) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.startOx + ev.clientX - dragRef.current.startX,
        y: dragRef.current.startOy + ev.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      canvas.classList.remove(styles.dragging);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [offset]);

  const zoomIn = () => {
    setZoom(prev => {
      const next = clampZoom(prev + ZOOM_STEP);
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const ratio = next / prev;
      setOffset(o => ({ x: cx - ratio * (cx - o.x), y: cy - ratio * (cy - o.y) }));
      return next;
    });
  };

  const zoomOut = () => {
    setZoom(prev => {
      const next = clampZoom(prev - ZOOM_STEP);
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const ratio = next / prev;
      setOffset(o => ({ x: cx - ratio * (cx - o.x), y: cy - ratio * (cy - o.y) }));
      return next;
    });
  };

  const resetZoom = () => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const w = naturalSize ? naturalSize.w : 0;
    const h = naturalSize ? naturalSize.h : 0;
    setZoom(1);
    setOffset({ x: (rect.width - w) / 2, y: (rect.height - h) / 2 });
  };

  return (
    <div className={styles.imageViewer}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onClose} title={i18n('ui.backToChat')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className={styles.filePath}>{filePath}</span>
        </div>
        <div className={styles.headerRight}>
          {fileSize > 0 && <span className={styles.fileSize}>{formatFileSize(fileSize)}</span>}
          <button className={styles.closeBtn} onClick={onClose} title={i18n('ui.backToChat')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button className={styles.toolBtn} onClick={zoomIn} title={i18n('ui.imageViewer.zoomIn')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={zoomOut} title={i18n('ui.imageViewer.zoomOut')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={resetZoom} title={i18n('ui.imageViewer.resetZoom')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M3 14h7v7H3z"/><path d="M14 14h7v7h-7z"/>
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={fitToWindow} title={i18n('ui.imageViewer.fitToWindow')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </button>
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
      </div>

      <div
        className={styles.canvasArea}
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {loading && !error && <div className={styles.loading}>{i18n('ui.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}
        <div
          className={styles.imageWrap}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        >
          {isSvg && svgContent ? (
            <div
              className={styles.svgInline}
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : (
            <img
              src={imgSrc}
              onLoad={handleImageLoad}
              onError={handleImageError}
              alt={filePath}
              draggable={false}
              style={{ display: loading ? 'none' : 'block' }}
            />
          )}
        </div>
      </div>

      {naturalSize && (
        <div className={styles.statusBar}>
          <span>{naturalSize.w} × {naturalSize.h}</span>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      )}
    </div>
  );
}
