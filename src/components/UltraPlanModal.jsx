import React, { useState } from 'react';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { getModelMaxTokens } from '../utils/helpers';
import ImageLightbox from './ImageLightbox';
import ConfirmRemoveButton from './ConfirmRemoveButton';
import styles from './UltraPlanModal.module.css';

export default function UltraPlanModal({
  open, variant, prompt, files, modelName, agentTeamEnabled, customExperts,
  onClose, onVariantChange, onPromptChange, onSend, onUpload, onPaste, onRemoveFile, onOpenCustomEditor,
}) {
  const [lightbox, setLightbox] = useState(null);
  if (!open) return null;

  const hasContent = (prompt || '').trim() || files.length > 0;
  const lowContext = !modelName || getModelMaxTokens(modelName) < 1000000;
  const experts = Array.isArray(customExperts) ? customExperts : [];

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{t('ui.ultraplan.title')}</span>
          <div className={styles.headerActions}>
            <button className={styles.closeBtn} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {!agentTeamEnabled ? (
          <div className={styles.disabledTip}>{t('ui.ultraplan.agentTeamRequired')}</div>
        ) : (
          <>
            <div className={styles.variantRow}>
              <button
                className={`${styles.roleBtn} ${variant === 'codeExpert' ? styles.roleBtnActive : ''}`}
                onClick={() => onVariantChange('codeExpert')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                {t('ui.ultraplan.roleCodeExpert')}
              </button>
              <button
                className={`${styles.roleBtn} ${variant === 'researchExpert' ? styles.roleBtnActive : ''}`}
                onClick={() => onVariantChange('researchExpert')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                {t('ui.ultraplan.roleResearchExpert')}
              </button>
              {experts.map(item => {
                const vkey = 'custom:' + item.id;
                return (
                  <span key={item.id} className={styles.customWrap}>
                    <button
                      className={`${styles.roleBtn} ${variant === vkey ? styles.roleBtnActive : ''}`}
                      onClick={() => onVariantChange(vkey)}
                      title={item.title}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
                      <span className={styles.customTitle}>{item.title}</span>
                    </button>
                    {onOpenCustomEditor && (
                      <span
                        className={styles.editPencil}
                        onClick={(e) => { e.stopPropagation(); onOpenCustomEditor(item); }}
                        title={t('ui.ultraplan.customEditTitle')}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                      </span>
                    )}
                  </span>
                );
              })}
              {onOpenCustomEditor && (
                <button
                  type="button"
                  className={styles.addExpertBtn}
                  onClick={() => onOpenCustomEditor(null)}
                  title={t('ui.ultraplan.customAdd')}
                  aria-label={t('ui.ultraplan.customAdd')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>

            {lowContext && (
              <div className={styles.contextWarning}>{t('ui.ultraplan.contextWarning')}</div>
            )}

            {files.length > 0 && (
              <div className={styles.fileList}>
                {files.map((f, i) => {
                  const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(f.name);
                  const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(f.path)}`);
                  return isImage ? (
                    <div key={i} className={styles.imageItem} title={f.name}>
                      <img
                        src={src}
                        className={styles.imageThumb}
                        alt={f.name}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setLightbox({ src, alt: f.name }); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ src, alt: f.name }); } }}
                      />
                      <ConfirmRemoveButton
                        title={t('ui.chatInput.confirmRemoveImage')}
                        onConfirm={() => onRemoveFile(i)}
                        className={styles.imageRemove}
                        ariaLabel={t('ui.chatInput.removeImage')}
                      >&times;</ConfirmRemoveButton>
                    </div>
                  ) : (
                    <span key={i} className={styles.fileChip} title={f.name}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span className={styles.fileName}>{f.name}</span>
                      <ConfirmRemoveButton
                        title={t('ui.chatInput.confirmRemoveFile')}
                        onConfirm={() => onRemoveFile(i)}
                        className={styles.fileRemove}
                        ariaLabel={t('ui.chatInput.removeImage')}
                        tag="span"
                      >&times;</ConfirmRemoveButton>
                    </span>
                  );
                })}
              </div>
            )}

            <textarea
              className={styles.textarea}
              value={prompt}
              onChange={e => onPromptChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hasContent) { e.preventDefault(); onSend(); } }}
              onPaste={onPaste}
              placeholder={t('ui.ultraplan.placeholder')}
              rows={5}
              autoFocus
            />

            <div className={styles.footer}>
              <button className={styles.sendBtn} disabled={!hasContent} onClick={onSend}>{t('ui.ultraplan.send')}</button>
              <button className={styles.uploadBtn} onClick={onUpload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                {t('ui.ultraplan.upload')}
              </button>
            </div>
          </>
        )}
      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          zIndex={1150}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
