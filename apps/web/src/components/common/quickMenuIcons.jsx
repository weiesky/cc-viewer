// 四芒星快捷设置菜单共用图标 —— TerminalPanel 终端工具栏与 ChatInputBar 对话输入框
// 两处「同款菜单」共享，单一事实源防止迭代漂移。全部为零依赖纯 SVG 组件；
// 菜单行内尺寸由共享样式 .quickMenuRowIcon svg { 14px } 统一约束。

// Shared geometry constants: the SVG components below AND the CSS-mask data-URIs
// (used by TerminalPanel's gradient-shimmer glyphs) both render from these, so the
// shapes cannot drift apart.
const SPARKLE_PATH = 'M12 0.5 C12.4 9 15 11.6 23.5 12 C15 12.4 12.4 15 12 23.5 C11.6 15 9 12.4 0.5 12 C9 11.6 11.6 9 12 0.5 Z';
// UltraPlan glyph: single filled silhouette (viewBox 0 0 1024 1024). Rendered both as
// an alpha mask (opaque #fff on transparent → picks up currentColor + shimmer) and as
// a plain currentColor <svg> fallback, so the two can't drift apart. Default nonzero
// fill-rule reproduces the source's shield/orbit cut-outs.
const ULTRAPLAN_VIEWBOX = '0 0 1024 1024';
const ULTRAPLAN_PATH = 'M941.60719644 82.39280356c93.34484006 93.34484006 77.54802062 259.15620567-16.29392086 429.60719644 93.89717553 170.45099076 109.63876092 336.31759042 16.29392086 429.60719644-93.34484006 93.34484006-259.15620567 77.54802062-429.60719644-16.29392086-170.45099076 93.89717553-336.31759042 109.63876092-429.60719644 16.29392086-93.34484006-93.34484006-77.54802062-259.15620567 16.29392086-429.60719644-93.89717553-170.45099076-109.63876092-336.31759042-16.29392086-429.60719644 93.34484006-93.34484006 259.15620567-77.54802062 429.60719644 16.29392086 170.45099076-93.89717553 336.31759042-109.63876092 429.60719644-16.29392086zM403.96301401 168.44680279c-107.15324743-47.33522299-199.28294715-52.14054905-243.46985436-7.95364314-78.92886188 78.92886188-1.65700898 310.85488608 195.30612687 507.70755383 50.81494186 50.81494186 103.94969759 93.67624187 156.20071348 127.92109384a989.62100149 989.62100149 0 0 0 156.20071348-127.92109384c20.21550965-20.16027558 39.10541211-40.70718703 56.78017549-61.41979938 19.05560336 33.02971292 33.91345019 65.28615411 44.07643908 95.71988542 1.76747583 5.30242877 3.36925203 10.49439069 4.80532606 15.46541764a1135.87966103 1135.87966103 0 0 1-153.82566812 137.58698005c107.15324743 47.33522299 199.28294715 52.14054905 243.46985436 7.95364314 78.92886188-78.92886188 1.65700898-310.85488608-195.30612687-507.70755383A991.71987911 991.71987911 0 0 0 512 227.82295861a993.76352396 993.76352396 0 0 0-156.20071348 127.97632791c-20.21550965 20.16027558-39.10541211 40.70718703-56.78017549 61.41979938a526.10035358 526.10035358 0 0 1-44.07643908-95.71988542l-4.80532606-15.46541764a1140.29835124 1140.29835124 0 0 1 146.36912768-132.00838225l7.45654044-5.5785978z m-235.57144398 451.5901832l-5.24719599 12.31710058c-42.36419602 101.85081868-45.12587852 188.67808962-2.65121439 231.15275378 44.18690591 44.18690591 136.31660562 39.38157984 243.46985436-7.95364314a1134.66452068 1134.66452068 0 0 1-126.31931893-109.19689229c-32.587843-32.587843-62.46923884-66.2803595-89.47848533-100.52521277l-19.77363972-25.79410616z m347.4747847-273.24078206a14.80261406 14.80261406 0 0 1 10.43915663 10.43915662l14.41597819 53.13475445a103.72876263 103.72876263 0 0 0 72.90839545 72.90839545l53.13475445 14.41597819a14.80261406 14.80261406 0 0 1 0 28.61102272l-53.13475445 14.41597819a103.72876263 103.72876263 0 0 0-72.90839545 72.90839545l-14.41597819 53.13475445a14.80261406 14.80261406 0 0 1-28.61102272 0l-14.41597819-53.13475445a103.72876263 103.72876263 0 0 0-72.90839545-72.90839545l-53.13475445-14.41597819a14.80261406 14.80261406 0 0 1 0-28.61102272l53.13475445-14.41597819a103.72876263 103.72876263 0 0 0 72.90839545-72.90839545l14.41597819-53.13475445a14.80261406 14.80261406 0 0 1 18.22709887-10.43915662z m113.56034844-182.43668953l-9.38971718 4.03205563c43.08223369 31.98027346 85.6121306 68.54493802 126.31931893 109.25212505 40.70718703 40.7624211 77.32708566 83.23708524 109.25212505 126.31931893 47.27999022-107.15324743 52.08531628-199.28294715 7.89841038-243.46985436-41.03858882-41.03858882-123.39193552-39.82344977-220.71359716-1.54654087l-13.36654002 5.41289562z';

// Mask data-URIs (alpha masks: opaque white shapes on transparent), pre-wrapped as
// url("...") so they can be assigned directly to style.maskImage / WebkitMaskImage.
export const SPARKLE_MASK_URI = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${SPARKLE_PATH}' fill='#fff'/></svg>`)}")`;
export const ULTRAPLAN_MASK_URI = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${ULTRAPLAN_VIEWBOX}'><path d='${ULTRAPLAN_PATH}' fill='#fff'/></svg>`)}")`;

// Ready-made inline-style objects for the mask glyph <span>s (mask-image must ride
// inline so the shape stays single-sourced here; the shimmer CSS supplies the rest).
export const SPARKLE_MASK_STYLE = { WebkitMaskImage: SPARKLE_MASK_URI, maskImage: SPARKLE_MASK_URI };
export const ULTRAPLAN_MASK_STYLE = { WebkitMaskImage: ULTRAPLAN_MASK_URI, maskImage: ULTRAPLAN_MASK_URI };

// 快捷设置按钮图标：纤细四芒星（凹弧四角，实心）。
// 菜单打开时整体旋转 45° 变为斜向星，作为开合状态反馈。
export function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d={SPARKLE_PATH} />
    </svg>
  );
}

// 菜单行图标：权限自动审批（盾牌+对勾）
export function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

// 菜单行图标：Plan 自动审批（剪贴板）
export function PlanClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

export function AgentTeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function UltraplanIcon() {
  // Same ULTRAPLAN_PATH the mask URI uses, filled with currentColor so this fallback
  // (mobile chat button) stays geometry-identical to the masked glyph.
  return (
    <svg viewBox={ULTRAPLAN_VIEWBOX} width="14" height="14" fill="currentColor">
      <path d={ULTRAPLAN_PATH} />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
