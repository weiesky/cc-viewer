import React, { useState, useEffect, useRef, useCallback } from 'react';
import { t as i18n } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { sanitizeSvg } from '../utils/svgSanitize';
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
      setSvgContent(sanitizeSvg(text));
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

  // Fetch file size + 校验访问权限。HEAD 失败时再发 GET 拿 JSON reason,显示具体原因。
  useEffect(() => {
    fetch(imgSrc, { method: 'HEAD' })
      .then(r => {
        if (!r.ok) {
          // 403 sensitive / 404 not found 等:再发 GET 取详细 reason 显示给用户
          fetch(imgSrc).then(rr => rr.json()).then(err => {
            const reasonMsg = err && err.reason
              ? (i18n(`ui.fileLoadError.reason.${err.reason}`) || err.error)
              : (err && err.error) || `HTTP ${r.status}`;
            setError(reasonMsg);
            setLoading(false);
          }).catch(() => {
            setError(`HTTP ${r.status}`);
            setLoading(false);
          });
          return;
        }
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
    // 必须 preventDefault 拦下浏览器对 Ctrl+wheel / trackpad pinch 的整页缩放行为；
    // 注意这里依赖下方 useEffect 用 native addEventListener({passive:false}) 绑定——React
    // 的 onWheel 自 v17 起是 passive listener，preventDefault 会静默失败并导致页面与图片同时缩放。
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Mac 触控板 pinch 被浏览器翻译成 wheel + ctrlKey，每秒发数十次小 deltaY（0.5~3px）；
    // 鼠标滚轮稀疏发大 deltaY（~100px）。旧实现「每次事件固定 ×1.15」对 trackpad 累积爆炸
    // ——5 次 pinch 就 ×2.0、10 次就 ×4.0。clamp 到 ±10 把鼠标极端值削掉，再用指数让小 delta
    // 也丝滑：trackpad 单帧 ~2.8%（exp(-2*0.014)≈0.972）、鼠标 wheel ~13%（exp(-10*0.014)≈0.869），
    // 后者接近原 15% 手感保留鼠标用户肌肉记忆，无需检测设备类型；跨 deltaMode (PIXEL/LINE/PAGE)
    // 也被 clamp 兜底，Firefox 行模式 / 各平台精度触控板量级差异自动归一。
    const delta = Math.max(-10, Math.min(10, e.deltaY));
    setZoom(prev => {
      const next = clampZoom(prev * Math.exp(-delta * 0.014));
      const ratio = next / prev;
      setOffset(o => ({
        x: mx - ratio * (mx - o.x),
        y: my - ratio * (my - o.y),
      }));
      return next;
    });
  }, []);

  // React 的 onWheel 自 v17 起是 passive listener，preventDefault 会被忽略——Ctrl+wheel /
  // trackpad pinch 时浏览器会同时整页缩放，让本组件的缩放与页面缩放叠加。这里改用 native
  // addEventListener + {passive:false} 绑定，确保 e.preventDefault() 在 handleWheel 里生效。
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

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
