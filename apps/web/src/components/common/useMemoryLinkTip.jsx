import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './HoverPreviewTip.module.css';

function MemoryLinkTip({ tip }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: tip.x, top: tip.y, visible: false });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const margin = 8;
    const gap = 10;
    const left = Math.max(margin, Math.min(tip.x - node.offsetWidth / 2, window.innerWidth - node.offsetWidth - margin));
    let top = tip.y - node.offsetHeight - gap;
    if (top < margin) top = tip.y + gap + 14;
    top = Math.min(top, window.innerHeight - node.offsetHeight - margin);
    setPosition({ left, top, visible: true });
  }, [tip]);
  return (
    <div
      ref={ref}
      id={tip.id}
      role="tooltip"
      className={`${styles.previewTip} ${styles.memoryLinkTip}`}
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
    >
      <div className={styles.memoryLinkCost}>{tip.cost}</div>
      {tip.description && <div>{tip.description}</div>}
    </div>
  );
}

/** One delegated hover/focus layer for existing sanitized memory links. */
export default function useMemoryLinkTip() {
  const [tip, setTip] = useState(null);
  const show = useCallback((event) => {
    const anchor = event.target.closest?.('[data-memory-tokens]');
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setTip({
      id: 'memory-link-usage-tip',
      cost: anchor.dataset.memoryTokens,
      description: anchor.dataset.memoryDescription || '',
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const tipId = tip?.id || null;
  return {
    memoryTipHandlers: {
      onMouseOver: show,
      onMouseOut: (event) => {
        if (!event.relatedTarget?.closest?.('[data-memory-tokens]')) hide();
      },
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
    },
    memoryTipNode: tip ? createPortal(<MemoryLinkTip tip={tip} />, document.body) : null,
    memoryTipId: tipId,
  };
}
