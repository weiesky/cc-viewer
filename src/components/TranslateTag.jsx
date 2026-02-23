import React, { useState, useCallback, useRef } from 'react';
import { t, getLang } from '../i18n';
import styles from './TranslateTag.module.css';

/**
 * 翻译标签组件 - 点击调用 /api/translate 翻译文本
 * @param {string} text - 要翻译的原文
 * @param {function} onTranslated - 翻译完成回调 (translatedText: string | null)，null 表示切回原文
 */
export default function TranslateTag({ text, onTranslated }) {
  const [state, setState] = useState('idle'); // idle | loading | done
  const cacheRef = useRef(null);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (state === 'loading') return;

    if (state === 'done') {
      // 切回原文
      setState('idle');
      onTranslated?.(null);
      return;
    }

    // 有缓存直接用
    if (cacheRef.current) {
      setState('done');
      onTranslated?.(cacheRef.current);
      return;
    }

    setState('loading');
    const port = window.location.port || '7008';
    const baseUrl = `${window.location.protocol}//${window.location.hostname}:${port}`;
    fetch(`${baseUrl}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, to: getLang() }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        const translated = data.text || '';
        cacheRef.current = translated;
        setState('done');
        onTranslated?.(translated);
      })
      .catch(() => {
        setState('idle');
      });
  }, [state, text, onTranslated]);

  const label = state === 'loading' ? t('ui.translating') : t('ui.translate');

  return (
    <span
      className={`${styles.tag} ${state === 'done' ? styles.tagActive : ''} ${state === 'loading' ? styles.tagLoading : ''}`}
      onClick={handleClick}
    >
      {state === 'loading' && <span className={styles.spinner} />}
      {label}
    </span>
  );
}
