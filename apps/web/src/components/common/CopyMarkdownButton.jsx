import React, { useEffect, useRef, useState } from 'react';
import { message, Tooltip } from 'antd';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { copyTextToClipboard } from '../../utils/terminalClipboard';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './CopyMarkdownButton.module.css';

// Title-inline "copy the markdown source of this document" affordance.
// Embeds in modal titles, panel headers, doc toolbars — anywhere a small
// copy glyph should sit next to a heading. Caller supplies the raw markdown
// via a `getText` getter so the latest value is read at click time (no
// stale closure). Goes through copyTextToClipboard so the click keeps
// working over plain HTTP (non-secure contexts lack navigator.clipboard);
// success surfaces the shared `ui.copySuccess` toast and swaps the glyph to
// a check for ~1.2s as inline feedback.
export default function CopyMarkdownButton({ getText, title, className }) {
  const [justCopied, setJustCopied] = useState(false);
  // RefreshIcon-style timer lifecycle: re-arming clears the previous timer
  // (no early flip on rapid clicks) and unmount clears it (no setState on
  // an unmounted component).
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const fire = (e) => {
    if (e) e.stopPropagation();
    if (justCopied) return; // cooldown: a second click inside the feedback window is a no-op
    const text = typeof getText === 'function' ? getText() : getText;
    if (!text) return;
    copyTextToClipboard(text)
      .then((ok) => {
        if (ok) {
          message.success(t('ui.copySuccess'));
          setJustCopied(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setJustCopied(false), 1200);
        } else {
          message.error(t('ui.copyFailed'));
          reportSwallowed('copyMarkdown.writeText', new Error('copyTextToClipboard returned false'));
        }
      })
      .catch((err) => {
        message.error(t('ui.copyFailed'));
        reportSwallowed('copyMarkdown.writeText', err);
      });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fire(e);
    }
  };

  const Icon = justCopied ? CheckOutlined : CopyOutlined;
  const tipTitle = title || t('ui.copyMarkdown');

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
