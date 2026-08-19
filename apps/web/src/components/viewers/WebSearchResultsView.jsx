import React, { useState } from 'react';
import { t } from '../../i18n';
import { isMobile } from '../../env';
import { safeHref, getHostname } from '../../utils/webSearchGrouping';
import styles from './WebSearchResultsView.module.css';

const MOBILE_PREVIEW_COUNT = 3;

function WebSearchResultCard({ result }) {
  if (!result || typeof result !== 'object') return null;
  const title = typeof result.title === 'string' && result.title ? result.title : result.url || '(no title)';
  const href = safeHref(result.url);
  const hostname = getHostname(result.url);
  const pageAge = typeof result.page_age === 'string' ? result.page_age : '';

  const titleNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.title}
      aria-label={`${title} (${t('ui.openInNewTab')})`}
    >
      {title}
    </a>
  ) : (
    <span className={styles.title}>{title}</span>
  );

  return (
    <div className={styles.card}>
      {titleNode}
      <div className={styles.metaRow}>
        {hostname && <span className={styles.urlDomain}>{hostname}</span>}
        {pageAge && <span className={styles.pageAge}>{pageAge}</span>}
      </div>
    </div>
  );
}

export default function WebSearchResultsView({ results }) {
  const [expanded, setExpanded] = useState(false);
  if (!Array.isArray(results) || results.length === 0) return null;

  const collapsible = isMobile && results.length > MOBILE_PREVIEW_COUNT;
  const visible = collapsible && !expanded ? results.slice(0, MOBILE_PREVIEW_COUNT) : results;
  const hiddenCount = results.length - visible.length;

  return (
    <div className={styles.cardList}>
      {visible.map((r, i) => (
        <WebSearchResultCard key={`${r?.url || 'r'}-${i}`} result={r} />
      ))}
      {collapsible && hiddenCount > 0 && (
        <button
          type="button"
          className={styles.showMoreBtn}
          onClick={() => setExpanded(true)}
        >
          {t('ui.webSearchShowMore', { count: hiddenCount })}
        </button>
      )}
      {collapsible && expanded && results.length > MOBILE_PREVIEW_COUNT && (
        <button
          type="button"
          className={styles.showMoreBtn}
          onClick={() => setExpanded(false)}
        >
          {t('ui.webSearchShowLess')}
        </button>
      )}
    </div>
  );
}
