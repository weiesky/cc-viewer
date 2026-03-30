import React, { useState } from 'react';
import { uploadFileAndGetPath } from './TerminalPanel';
import { isMobile } from '../env';
import { t } from '../i18n';
import styles from './ChatInputBar.module.css';

function ChatInputBar({ inputRef, inputEmpty, inputSuggestion, terminalVisible, onKeyDown, onChange, onSend, onSuggestionClick, onUploadPath, presetItems, onPresetSend, isStreaming, streamingFading }) {
  const [plusOpen, setPlusOpen] = useState(false);

  if (terminalVisible) {
    if (!inputSuggestion) return null;
    return (
      <div className={styles.suggestionChip} onClick={onSuggestionClick}>
        <span className={styles.suggestionChipText}>{inputSuggestion}</span>
        <span className={styles.suggestionChipAction}>↵</span>
      </div>
    );
  }

  return (
    <div className={styles.chatInputBar}>
      <div className={`${styles.chatInputWrapper}${isStreaming ? ` ${styles.streaming}` : ''}${streamingFading ? ` ${styles.streamingFading}` : ''}`}>
        {(isStreaming || streamingFading) && (
          <svg className={`${styles.streamingSvg}${streamingFading ? ` ${styles.streamingSvgFading}` : ''}`}>
            <defs>
              <filter id="ccv-streamGlow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* 5层渐变拖尾：头亮尾淡，所有层头部对齐 */}
            {[
              { da: '20 30', op: 0.08, off: 0 },
              { da: '16 34', op: 0.15, off: -4 },
              { da: '11 39', op: 0.3,  off: -9 },
              { da: '6 44',  op: 0.6,  off: -14 },
              { da: '3 47',  op: 1,    off: -17 },
            ].map((l, i, arr) => (
              <rect key={i} x="0" y="0" width="100%" height="100%" rx="16" ry="16"
                pathLength="100" fill="none" strokeWidth="1.5"
                stroke="#60a5fa" strokeOpacity={l.op}
                strokeLinecap="round" strokeDasharray={l.da}
                filter={i === arr.length - 1 ? 'url(#ccv-streamGlow)' : undefined}>
                <animate attributeName="stroke-dashoffset"
                  from={l.off} to={l.off - 100} dur="2.5s" repeatCount="indefinite" />
              </rect>
            ))}
          </svg>
        )}
        <div className={styles.chatTextareaWrap}>
          <textarea
            ref={inputRef}
            className={styles.chatTextarea}
            placeholder={inputSuggestion ? '' : t('ui.chatInput.placeholder')}
            rows={1}
            onKeyDown={onKeyDown}
            onInput={onChange}
          />
          {inputSuggestion && inputEmpty && (
            <div className={styles.ghostText}>{inputSuggestion}</div>
          )}
        </div>
        <div className={styles.chatInputBottom}>
          <div className={styles.plusArea}>
            <button className={`${styles.plusBtn}${plusOpen ? ` ${styles.plusBtnOpen}` : ''}`} onClick={() => setPlusOpen(p => !p)} title={t('ui.chatInput.more')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {plusOpen && (
              <>
              <div className={styles.plusOverlay} onClick={() => setPlusOpen(false)} />
              <div className={styles.plusMenu}>
                {presetItems && presetItems.length > 0 && presetItems.map(item => {
                  const isBuiltinRaw = item.builtinId && !item.modified;
                  const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                  const desc = isBuiltinRaw ? t(item.description) : item.description;
                  return (
                    <button key={item.id} className={styles.plusMenuItem} onClick={() => {
                      setPlusOpen(false);
                      onPresetSend?.(desc);
                    }} title={desc}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span className={styles.presetLabel}>{name || desc}</span>
                    </button>
                  );
                })}
                <button className={styles.plusMenuItem} onClick={() => {
                  setPlusOpen(false);
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.onchange = async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const path = await uploadFileAndGetPath(file);
                      onUploadPath(path);
                    } catch (err) {
                      console.error('[CC Viewer] Upload failed:', err);
                    }
                  };
                  input.click();
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>{t('ui.terminal.upload')}</span>
                </button>
              </div>
              </>
            )}
          </div>
          <div className={isMobile ? styles.chatInputHintMobile : styles.chatInputHint}>
            {isMobile
              ? t('ui.chatInput.hintMobile')
              : (inputSuggestion && inputEmpty
                ? t('ui.chatInput.hintTab')
                : t('ui.chatInput.hintEnter'))}
          </div>
          <button
            className={`${styles.sendBtn} ${inputEmpty ? styles.sendBtnDisabled : ''}`}
            onClick={onSend}
            disabled={inputEmpty}
            title={t('ui.chatInput.send')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatInputBar;
