/**
 * 文件/文件夹图标 — 按文件类型渲染统一风格的 SVG。
 *
 * 设计:所有文件共享一个「折角文档」母形(strokeWidth 2 + round cap/join,
 * 与全库其它图标一致),内部按类型嵌入一个简单符号;目录是特例,用实心文件夹。
 * 类型分类逻辑在 fileTypes.js(getFileType),颜色在本文件按扩展名/类别给定。
 *
 * FileExplorer、GitChanges、FileBrowserModal、MobileFileExplorer、MobileGitDiff
 * 共用此模块;新增类型颜色改 EXT_COLORS / CATEGORY_COLORS,新增符号改 GLYPH。
 */
import React from 'react';
import { getFileType, getExt } from './fileTypes';

// Per-extension colors (languages share the `</>` code glyph, told apart by hue).
// Values are CSS variable references, not hex: the same token resolves per-theme
// (dark/light) in global.css, so no runtime theme check is needed (see
// teammateAvatars.js — "运行时不做主题判定").
const EXT_COLORS = {
  js: 'var(--file-icon-js)', jsx: 'var(--file-icon-jsx)', ts: 'var(--file-icon-ts)', tsx: 'var(--file-icon-tsx)',
  py: 'var(--file-icon-py)', go: 'var(--file-icon-go)', rs: 'var(--file-icon-rs)', rb: 'var(--file-icon-rb)',
  java: 'var(--file-icon-java)', c: 'var(--file-icon-c)', cpp: 'var(--file-icon-cpp)', h: 'var(--file-icon-h)',
  sh: 'var(--file-icon-sh)', bash: 'var(--file-icon-sh)', zsh: 'var(--file-icon-sh)',
  php: 'var(--file-icon-php)', sql: 'var(--file-icon-sql)', vue: 'var(--file-icon-vue)', svelte: 'var(--file-icon-svelte)',
  kt: 'var(--file-icon-kt)', swift: 'var(--file-icon-swift)', lua: 'var(--file-icon-lua)', r: 'var(--file-icon-r)',
  html: 'var(--file-icon-html)', htm: 'var(--file-icon-html)', xml: 'var(--file-icon-html)',
  css: 'var(--file-icon-css)', less: 'var(--file-icon-less)', scss: 'var(--file-icon-scss)', sass: 'var(--file-icon-scss)',
  json: 'var(--file-icon-json)', yml: 'var(--file-icon-yml)', yaml: 'var(--file-icon-yml)', toml: 'var(--file-icon-toml)',
  md: 'var(--file-icon-md)', svg: 'var(--file-icon-svg)',
};

// Category fallback colors when an extension has no per-ext entry.
const CATEGORY_COLORS = {
  code: 'var(--file-icon-code)', markup: 'var(--file-icon-markup)', data: 'var(--file-icon-data)', document: 'var(--file-icon-document)',
  image: 'var(--file-icon-image)', video: 'var(--file-icon-video)', audio: 'var(--file-icon-audio)', archive: 'var(--file-icon-archive)',
  pdf: 'var(--file-icon-pdf)', office: 'var(--file-icon-office)', font: 'var(--file-icon-font)', binary: 'var(--file-icon-binary)',
  plain: 'var(--file-icon-plain)',
};

// Office sub-type accent colors (shared badge glyph, told apart by hue).
const OFFICE_COLORS = {
  doc: 'var(--file-icon-office-word)', docx: 'var(--file-icon-office-word)', odt: 'var(--file-icon-office-word)',
  xls: 'var(--file-icon-office-excel)', xlsx: 'var(--file-icon-office-excel)', ods: 'var(--file-icon-office-excel)',
  ppt: 'var(--file-icon-office-ppt)', pptx: 'var(--file-icon-office-ppt)', odp: 'var(--file-icon-office-ppt)',
};

// The knocked-out (badge-interior) strokes read against the surface color.
const KNOCKOUT = 'var(--bg-container)';

// Category glyphs drawn inside the shared folded-document base shape, in the
// x∈[7,17] y∈[11,20] clear zone (the dog-ear occupies the top-right). Simple
// geometry only, strokeWidth 2, so they stay legible at 14px (tree rows).
const GLYPH = {
  code: (c) => (
    <>
      <polyline points="10 12.5 8 14.5 10 16.5" />
      <polyline points="14 12.5 16 14.5 14 16.5" />
    </>
  ),
  markup: (c) => (
    <>
      <polyline points="11 12 9 14.5 11 17" />
      <polyline points="13 12 15 14.5 13 17" />
    </>
  ),
  data: (c) => (
    <>
      <path d="M10 12c-1 0-1 .8-1 1.6v1.2c0 .8-.4 1.2-1 1.2.6 0 1 .4 1 1.2v1.2c0 .8 0 1.6 1 1.6" />
      <path d="M14 12c1 0 1 .8 1 1.6v1.2c0 .8.4 1.2 1 1.2-.6 0-1 .4-1 1.2v1.2c0 .8 0 1.6-1 1.6" />
    </>
  ),
  document: (c) => (
    <>
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="15" x2="15.5" y2="15" />
      <line x1="8.5" y1="17.5" x2="13" y2="17.5" />
    </>
  ),
  image: (c) => (
    <>
      <rect x="7.5" y="11.5" width="9" height="7.5" rx="1" />
      <circle cx="10.2" cy="14" r="0.9" />
      <polyline points="8.5 18 11 15.4 12.6 16.8 14.8 14.6 16.5 18" />
    </>
  ),
  video: (c) => <path d="M10 12.2v5l4.5-2.5z" fill={c} stroke="none" />,
  audio: (c) => (
    <>
      <circle cx="9.8" cy="17" r="1.4" />
      <polyline points="11.2 17 11.2 12 15.5 12 15.5 13.5" />
    </>
  ),
  archive: (c) => (
    <>
      <line x1="12" y1="11.5" x2="12" y2="18.5" />
      <line x1="11" y1="12.5" x2="13" y2="12.5" />
      <line x1="11" y1="14.5" x2="13" y2="14.5" />
      <line x1="11" y1="16.5" x2="13" y2="16.5" />
      <rect x="11" y="17.6" width="2" height="2" rx="0.4" fill={c} stroke="none" />
    </>
  ),
  pdf: (c) => (
    <>
      <rect x="11.5" y="14.5" width="5.5" height="4.5" rx="1" fill={c} stroke="none" />
      <line x1="13" y1="15.7" x2="13" y2="17.8" stroke={KNOCKOUT} />
      <line x1="14.4" y1="15.7" x2="14.4" y2="17.8" stroke={KNOCKOUT} />
      <line x1="15.8" y1="15.7" x2="15.8" y2="17.8" stroke={KNOCKOUT} />
    </>
  ),
  office: (c, ext) => {
    const badge = <rect x="11" y="14" width="6" height="5" rx="1" fill={c} stroke="none" />;
    let mark;
    if (ext === 'xls' || ext === 'xlsx' || ext === 'ods') {
      mark = (
        <>
          <line x1="12.2" y1="15.7" x2="15.8" y2="15.7" stroke={KNOCKOUT} />
          <line x1="12.2" y1="17.3" x2="15.8" y2="17.3" stroke={KNOCKOUT} />
          <line x1="14" y1="14.9" x2="14" y2="18.1" stroke={KNOCKOUT} />
        </>
      );
    } else if (ext === 'ppt' || ext === 'pptx' || ext === 'odp') {
      mark = (
        <>
          <path d="M14 16.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0" stroke={KNOCKOUT} fill="none" />
          <line x1="14" y1="16.5" x2="14" y2="14.9" stroke={KNOCKOUT} />
          <line x1="14" y1="16.5" x2="15.4" y2="17.3" stroke={KNOCKOUT} />
        </>
      );
    } else {
      mark = (
        <>
          <line x1="12.2" y1="15.7" x2="15.8" y2="15.7" stroke={KNOCKOUT} />
          <line x1="12.2" y1="17.3" x2="15" y2="17.3" stroke={KNOCKOUT} />
        </>
      );
    }
    return <>{badge}{mark}</>;
  },
  font: (c) => (
    <>
      <polyline points="9 18.5 11.5 11.5 14 18.5" />
      <line x1="10" y1="16" x2="13" y2="16" />
    </>
  ),
  binary: (c) => (
    <>
      <rect x="8" y="12" width="3" height="6" rx="0.8" />
      <rect x="13" y="12" width="3" height="6" rx="0.8" fill={c} stroke="none" />
    </>
  ),
};

export function getFileIcon(name, type, size = 14) {
  if (type === 'directory') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--color-accent-yellow)" stroke="none">
        <path d="M2 6c0-1.1.9-2 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
      </svg>
    );
  }
  const category = getFileType(name, type);
  const ext = getExt(name);
  const color = EXT_COLORS[ext] || OFFICE_COLORS[ext] || CATEGORY_COLORS[category] || 'var(--file-icon-fallback)';
  const glyph = GLYPH[category] ? GLYPH[category](color, ext) : null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      {glyph}
    </svg>
  );
}
