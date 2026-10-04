import React, { useMemo } from 'react';
import orbitingUrl from '../../img/claude/orbiting.svg';
import shimmerUrl from '../../img/claude/shimmer.svg';
import styles from './Loading.module.css';

const SIZE_PX = { small: 20, default: 32, large: 48 };

// App-wide loading indicator: reuses the Claude brand sprite frame animation from the
// chat panel's streaming spinner (orbiting.svg / shimmer.svg). A sprite is picked at
// random per mount — intentionally varied (mirrors the existing streamSpinnerUrl
// behavior). Must render via <object>, not <img> — some WebViews rasterize SMIL
// <animate> to only its first frame, while <object> goes through the SVG document path
// so the animation plays (the established conclusion from ChatView line 67). The sprite
// switches frames by discretely shifting its viewBox, so it scales losslessly to any size.
// Sizes: small=20 / default=32 / large=48.
// Two usages:
//   Bare spinner (default): <Loading size="large" />
//   Wrapper mode (the content-overlay successor to antd <Spin spinning={x}>):
//     <Loading spinning={x}>{children}</Loading>
export default function Loading({ size = 'default', spinning = true, className, style, children }) {
  // Pick a sprite at random on mount (mirrors the existing streamSpinnerUrl behavior).
  const url = useMemo(() => (Math.random() < 0.5 ? orbitingUrl : shimmerUrl), []);
  const px = SIZE_PX[size] || SIZE_PX.default;

  const spinner = (
    <span
      className={`${styles.loading}${className ? ' ' + className : ''}`}
      style={{ width: px, height: px, ...style }}
    >
      <object type="image/svg+xml" data={url} width={px} height={px} aria-hidden="true" tabIndex={-1} />
    </span>
  );

  // No children: bare spinner.
  if (children === undefined || children === null) {
    return spinning ? spinner : null;
  }

  // Wrapper mode: overlay a translucent mask + centered spinner on the children;
  // when spinning=false only the children render.
  return (
    <span className={styles.spinContainer}>
      {children}
      {spinning && (
        <span className={styles.spinOverlay}>
          <span className={styles.loading} style={{ width: px, height: px }}>
            <object type="image/svg+xml" data={url} width={px} height={px} aria-hidden="true" tabIndex={-1} />
          </span>
        </span>
      )}
    </span>
  );
}
