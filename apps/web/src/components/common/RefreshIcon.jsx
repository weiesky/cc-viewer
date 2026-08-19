import React, { useEffect, useRef, useState } from 'react';
import styles from './RefreshIcon.module.css';

// 标题栏内联刷新图标：<span role="button"> 包壳，跟 OpenFolderIcon 风格一致，避免在
// inline-flex 标题里塞真 <button> 影响节奏。封装 300ms cooldown 防狂点；cooldown 期间
// pointer-events:none + tabIndex=-1 双重拦截连击，避免 fetchChildren 风暴（FileExplorer /
// GitChanges 内部 fetch 无 AbortController，旧 promise 不取消会按响应顺序竞争 setState）。
// 点击时一次性 360° 旋转动效给即时反馈（跟项目 spinner keyframe 同源 0 → 360）。
export default function RefreshIcon({ onClick, title, size = 12 }) {
  const [cooldown, setCooldown] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const fire = (e) => {
    if (e) e.stopPropagation();
    if (cooldown) return;
    setCooldown(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCooldown(false), 300);
    try { onClick && onClick(); } catch { /* swallow */ }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fire(e);
    }
  };

  return (
    <span
      role="button"
      tabIndex={cooldown ? -1 : 0}
      onClick={fire}
      onKeyDown={handleKeyDown}
      title={title}
      aria-label={title}
      aria-busy={cooldown}
      className={`${styles.btn} ${cooldown ? styles.btnBusy : ''}`}
    >
      <svg width={size} height={size} viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
        <path d="M281.6 798.72c-76.8-61.44-122.88-153.6-122.88-261.12 0-153.6 102.4-281.6 245.76-322.56V133.12c-189.44 40.96-327.68 204.8-327.68 404.48 0 122.88 51.2 235.52 138.24 312.32 66.56 61.44 107.52-20.48 66.56-51.2zM752.64 225.28c-40.96-35.84-102.4 25.6-61.44 56.32 76.8 61.44 122.88 153.6 122.88 261.12 0 153.6-102.4 281.6-245.76 322.56v87.04c189.44-40.96 327.68-204.8 327.68-404.48 0-138.24-56.32-250.88-143.36-322.56z"/>
        <path d="M440.32 286.72L573.44 204.8c20.48-10.24 20.48-30.72 0-40.96L440.32 81.92c-20.48-10.24-35.84-5.12-35.84 20.48v163.84c0 25.6 15.36 35.84 35.84 20.48zM532.48 788.48L399.36 870.4c-20.48 10.24-20.48 30.72 0 40.96l133.12 81.92c20.48 10.24 35.84 5.12 35.84-20.48v-163.84c0-25.6-15.36-35.84-35.84-20.48z"/>
      </svg>
    </span>
  );
}
