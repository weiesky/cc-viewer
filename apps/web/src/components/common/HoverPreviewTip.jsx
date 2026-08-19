import React, { useState, useCallback, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import styles from './HoverPreviewTip.module.css';

// 单实例预览浮层：createPortal 到 body + position:fixed，绕开祖先 overflow 裁剪与原生 title 失效
// （甘特菱形 :hover scale 会重置浏览器原生 title 计时器、且会与自渲浮层双重弹出，故统一改自渲）。
// useLayoutEffect 测真实尺寸做视口 clamp（上方放不下翻下方），paint 前定位、visibility 防首帧闪。
function PreviewTip({ text, x, y }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const M = 8, GAP = 10;
    const left = Math.max(M, Math.min(x - w / 2, window.innerWidth - w - M));
    let top = y - h - GAP;                 // 优先菱形上方
    if (top < M) top = y + GAP + 14;       // 不够则放下方（+14 ≈ 菱形高）
    top = Math.min(top, window.innerHeight - h - M);
    setPos({ left, top, visible: true });
  }, [text, x, y]);
  return (
    <div
      ref={ref}
      className={styles.previewTip}
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
      role="tooltip"
    >
      {text}
    </div>
  );
}

/**
 * 甘特/时间轴菱形的悬停预览：事件委托读元素的 `data-preview` 属性（零 per-marker 组件开销，
 * 适配 live 每秒重渲、一行可 100+ 菱形的场景），单实例浮层 portal 渲出。
 *
 * 用法：
 *   const { previewHandlers, previewNode } = usePreviewTip();
 *   <div {...previewHandlers}>…内部带 data-preview 的菱形/元素…</div>
 *   {previewNode}
 */
export function usePreviewTip() {
  const [tip, setTip] = useState(null); // { text, x, y } | null
  const onMouseOver = useCallback((e) => {
    const el = e.target.closest('[data-preview]');
    if (!el || !el.dataset.preview) return;
    const r = el.getBoundingClientRect();
    setTip({ text: el.dataset.preview, x: r.left + r.width / 2, y: r.top });
  }, []);
  const onMouseOut = useCallback((e) => {
    // 只在真正离开所有菱形时清除：移到相邻菱形 / 菱形内部移动不清，避免 null→tip 闪烁。
    const to = e.relatedTarget;
    if (!to || typeof to.closest !== 'function' || !to.closest('[data-preview]')) setTip(null);
  }, []);
  const onMouseLeave = useCallback(() => setTip(null), []);
  const previewNode = tip
    ? ReactDOM.createPortal(<PreviewTip text={tip.text} x={tip.x} y={tip.y} />, document.body)
    : null;
  return { previewHandlers: { onMouseOver, onMouseOut, onMouseLeave }, previewNode };
}
