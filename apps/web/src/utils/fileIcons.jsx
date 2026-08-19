/**
 * 文件/文件夹图标 — 统一管理扩展名颜色和 SVG 渲染。
 *
 * FileExplorer、GitChanges 等组件共用此模块，
 * 新增文件类型颜色只需修改 EXT_COLORS。
 */
import React from 'react';

const EXT_COLORS = {
  js: '#e8d44d', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
  json: '#999', md: '#519aba', css: '#a86fd9', scss: '#cd6799', less: '#a86fd9',
  html: '#e34c26', htm: '#e34c26', xml: '#e34c26',
  py: '#3572a5', go: '#00add8', rs: '#dea584', rb: '#cc342d',
  java: '#b07219', c: '#555', cpp: '#f34b7d', h: '#555',
  sh: '#4eaa25', bash: '#4eaa25', zsh: '#4eaa25',
  yml: '#cb171e', yaml: '#cb171e', toml: '#999',
  svg: '#e34c26', png: '#a86fd9', jpg: '#a86fd9', jpeg: '#a86fd9', gif: '#a86fd9', bmp: '#a86fd9', ico: '#a86fd9', icns: '#a86fd9', webp: '#a86fd9', avif: '#a86fd9',
};

export function getFileIcon(name, type) {
  if (type === 'directory') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-accent-yellow)" stroke="none">
        <path d="M2 6c0-1.1.9-2 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
      </svg>
    );
  }
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const color = EXT_COLORS[ext] || '#888';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}
