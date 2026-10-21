// `/` skill menu — a grouped listbox (personal / builtin) anchored above the composer
// textarea. Purely presentational: ChatView owns all state (open/query/activeIndex) and the
// data sources; this component only renders the model and forwards hover/select/close.
import React, { useEffect, useRef } from 'react';
import { t } from '../../i18n.js';
import styles from './SlashCommandMenu.module.css';

function PersonalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  );
}

function BuiltinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

const GROUP_ICONS = { personal: PersonalIcon, builtin: BuiltinIcon };

export default function SlashCommandMenu({
  open, groups, activeIndex, loading, onHover, onSelect, onClose,
}) {
  const listRef = useRef(null);
  const activeRef = useRef(null);

  // Keep the keyboard-active row in view (block:'nearest' avoids page-level scroll jumps).
  useEffect(() => {
    if (open && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  if (!open) return null;

  const hasItems = (groups || []).some(g => g.items && g.items.length > 0);

  return (
    <>
      {/* Click-outside dismiss. mousedown preventDefault keeps the textarea focused. */}
      <div className={styles.overlay} onMouseDown={(e) => { e.preventDefault(); onClose(); }} />
      <div className={styles.menu} role="listbox" aria-label={t('ui.slashMenu.ariaLabel')} ref={listRef}>
        {loading && <div className={styles.statusRow}>{t('ui.slashMenu.loading')}</div>}
        {!loading && !hasItems && <div className={styles.statusRow}>{t('ui.slashMenu.noResults')}</div>}
        {!loading && (groups || []).map((group) => {
          const GroupIcon = GROUP_ICONS[group.key];
          return (
            <div className={styles.group} key={group.key}>
              <div className={styles.groupTitle}>
                {GroupIcon ? <GroupIcon /> : null}
                <span>{t(group.titleKey)}</span>
              </div>
              {group.items.map((item) => {
                const active = item.flatIndex === activeIndex;
                return (
                  <button
                    type="button"
                    key={item.name}
                    ref={active ? activeRef : null}
                    role="option"
                    aria-selected={active}
                    className={`${styles.item}${active ? ` ${styles.itemActive}` : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => onHover(item.flatIndex)}
                    onClick={() => onSelect(item.flatIndex)}
                  >
                    <span className={styles.itemName}>
                      /{item.name}
                      {item.argumentHint ? <span className={styles.itemHint}> {item.argumentHint}</span> : null}
                    </span>
                    {item.description ? <span className={styles.itemDesc}>{item.description}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
        {!loading && hasItems && (
          <div className={styles.footer}>{t('ui.slashMenu.footerHint')}</div>
        )}
      </div>
    </>
  );
}
