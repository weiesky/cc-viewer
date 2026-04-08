/**
 * 文件打开策略 — 统一管理哪些文件类型应由系统默认应用打开。
 *
 * 所有需要判断"是否用系统应用打开"的调用方都通过此模块，
 * 以后新增类型只需修改这里。
 */

import { apiUrl } from './apiUrl';

/** 需要系统默认应用打开的扩展名 */
const SYSTEM_OPEN_EXTS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'pdf',
]);

/**
 * 尝试用系统默认应用打开文件。
 * 如果文件扩展名匹配 SYSTEM_OPEN_EXTS，调用 /api/open-file 并返回 true；
 * 否则返回 false，由调用方自行处理。
 *
 * @param {string} path - 文件路径
 * @param {string} source - 调用来源，用于区分不同场景的潜在交互差异
 *   'file-explorer' | 'git-changes' | 'git-diff' | 'chat-message'
 * @returns {boolean} 是否已处理
 */
export function tryOpenWithSystem(path, source) {
  const ext = (path || '').split('.').pop().toLowerCase();
  if (!SYSTEM_OPEN_EXTS.has(ext)) return false;

  fetch(apiUrl('/api/open-file'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, source }),
  }).catch(() => {});

  return true;
}
