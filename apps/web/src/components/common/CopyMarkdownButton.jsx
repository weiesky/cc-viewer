import React, { useState } from 'react';
import { message, Tooltip } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './CopyMarkdownButton.module.css';

// Title-inline "copy the markdown source of this document" affordance.
// Embeds in modal titles, panel headers, doc toolbars — anywhere a small
// copy glyph should sit next to a heading. Caller supplies the raw markdown
// via a `getText` getter so the latest value is read at click time (no
// stale closure); success surfaces the shared `ui.copySuccess` toast and
// swaps the glyph to a check for ~1.2s as inline feedback.
export default function CopyMarkdownButton({ getText, title, className }) {
  const [justCopied, setJustCopied] = useState(false);

  const fire = (e) => {
    if (e) e.stopPropagation();
    const text = typeof getText === 'function' ? getText() : getText;
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {
        message.success(t('ui.copySuccess'));
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 1200);
      })
      .catch((err) => reportSwallowed('copyMarkdown.writeText', err));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fire(e);
    }
  };

  const Icon = justCopied ? CheckOutlined : CopyOutlined;
  const tipTitle = title || t('ui.copy');

  return (
    <Tooltip title={tipTitle}>
      <span
        role="button"
        tabIndex={0}
        onClick={fire}
        onKeyDown={handleKeyDown}
        aria-label={tipTitle}
        className={`${styles.btn}${justCopied ? ` ${styles.btnCopied}` : ''}${className ? ` ${className}` : ''}`}
      >
        <Icon className={styles.glyph} />
      </span>
    </Tooltip>
  );
}
