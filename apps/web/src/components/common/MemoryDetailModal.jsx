import React from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { renderMarkdown } from '../../utils/markdown';
import { parseMemoryLink } from '../../utils/memoryLinkParser';
import styles from './sharedChrome.module.css';

// 持久记忆条目明细 Modal（PC + iPad + 手机三处都需要 mount 一份）。
// zIndex 1100 跨过 popover 的 1030 —— 不需要先关 popover。
// 内容里点其它 .md 链接通过 onOpenMemoryDetail(name) 回到父级 loadMemoryDetail，
// 父级负责 seq 防快慢回包乱序、setState 切换当前 detail。
//
// linkMode:
//   'memory'      (默认) → 用 parseMemoryLink 拦截：命中 .md basename 切明细，其他一律 preventDefault。
//   'passthrough' → 不拦截，浏览器原生处理（CLAUDE.md 等场景需要 https:// / 相对链接正常打开）。
export default function MemoryDetailModal({ detail, onClose, onOpenMemoryDetail, linkMode = 'memory' }) {
  if (!detail) return null;
  const { name, content, error, loading } = detail;

  // 链接拦截：规则统一在 parseMemoryLink；命中 .md basename 切到对应明细。
  // passthrough 模式（CLAUDE.md 视图）：外链在新 tab 打开（noopener），其他链接吃掉防止 SPA 误导航。
  // 安全：协议白名单(^https?://)是 utils/markdown.js 里 DOMPurify 之外的第二道闸 ——
  // DOMPurify 默认会剥 javascript:/data: URL，但若未来 markdown pipeline 替换/降级，
  // 这里仍是底线防御。切勿移除此白名单。
  const handleLinkClick = (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const hrefRaw = a.getAttribute('href') || '';
    if (linkMode === 'passthrough') {
      e.preventDefault();
      if (/^https?:\/\//i.test(hrefRaw)) {
        // SSR 守卫: typeof window 检查避免 server render / 测试场景下 window 未定义即崩
        if (typeof window !== 'undefined') {
          try { window.open(hrefRaw, '_blank', 'noopener,noreferrer'); } catch {}
        }
      }
      // 相对路径 / 其它协议 → 阻止默认行为（不在 SPA 内做 routing），不打开
      return;
    }
    const r = parseMemoryLink(hrefRaw);
    if (r.allow) return;
    e.preventDefault();
    if (r.open) onOpenMemoryDetail?.(r.open);
  };

  let body;
  if (loading) {
    body = <div className={styles.cachePopoverEmpty}>{t('ui.memoryLoading')}</div>;
  } else if (error) {
    body = <div className={styles.cachePopoverEmpty}>{t('ui.memoryLoadError')}: {error}</div>;
  } else if (!content || !content.trim()) {
    body = <div className={styles.cachePopoverEmpty}>{t('ui.memoryEmpty')}</div>;
  } else {
    body = (
      <div
        className={`${styles.detailMarkdownCard} ${styles.memoryMarkdown}`}
        onClick={handleLinkClick}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    );
  }
  return (
    <Modal
      open={true}
      title={name}
      onCancel={onClose}
      footer={null}
      width={720}
      zIndex={1100}
      destroyOnClose
    >
      {body}
    </Modal>
  );
}
