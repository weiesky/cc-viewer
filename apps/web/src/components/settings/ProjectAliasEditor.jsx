import React, { useEffect, useState } from 'react';
import { Modal, Button, Input, Tooltip, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { useProjectAlias } from '../../hooks/useProjectAlias.js';
import { setProjectAlias, clearProjectAlias, normalizeAlias, _internals } from '../../utils/projectAlias.js';
import styles from './ProjectAliasEditor.module.css';

// Single source of truth — kept in sync with utils/projectAlias.js MAX_LEN so a
// future bump only needs editing one place (review P1-B).
const ALIAS_MAX_LEN = _internals.MAX_LEN;

// Header-inline editor for per-project alias. Renders:
//   - pencil button hidden by default (opacity:0), revealed on hover/focus
//   - antd Modal with input + Save/Cancel/Clear footer
//
// Why a self-contained component (not state on AppHeader): AppHeader is ~1700
// lines of class component; threading alias modal state through there is
// noisy. This component owns its own open/draft state; the persisted alias
// itself is read via useProjectAlias so other places (AppBase title, Mobile
// label) stay in sync without prop drilling.
//
// Hidden when projectName is falsy or in isLocalLog mode (the "project" is a
// log file path, not a workspace name — aliasing it is confusion-prone).
export default function ProjectAliasEditor({ projectName, isLocalLog = false }) {
  const alias = useProjectAlias(projectName);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // Track whether the user has touched the input since the modal opened.
  // While untouched, draft tracks the latest alias (so a cross-tab edit
  // doesn't get silently overwritten on Save). Once the user types, draft
  // stops following alias — their in-flight edit isn't clobbered by remote
  // changes either. Either way, "save the value I see" is honored.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) {
      setDirty(false);
      return;
    }
    // While the modal is open, re-seed draft on every alias change *unless*
    // the user already started editing (dirty). This fixes the cross-tab
    // stale-draft regression flagged in review P0-A.
    if (!dirty) setDraft(alias || '');
  }, [open, alias, dirty]);

  if (!projectName || isLocalLog) return null;

  const normalized = normalizeAlias(draft);
  const valueDiffers = normalized !== (alias || '');

  const handleSave = () => {
    const ok = setProjectAlias(projectName, draft);
    if (!ok) {
      message.error(t('ui.projectAlias.saveFailed'));
      return;
    }
    setOpen(false);
  };

  const handleClear = () => {
    const ok = clearProjectAlias(projectName);
    if (!ok) {
      message.error(t('ui.projectAlias.saveFailed'));
      return;
    }
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (valueDiffers) handleSave();
    }
  };

  const tooltipLabel = t('ui.projectAlias.tooltip');

  return (
    <>
      <Tooltip title={tooltipLabel} placement="top">
        <button
          type="button"
          className={styles.editButton}
          aria-label={tooltipLabel}
          onClick={() => setOpen(true)}
          /* data attr — lets the parent header CSS (AppHeader.module.css)
             reveal the button on its own :hover without needing to know the
             CSS-Modules-hashed editButton class name. */
          data-alias-edit-trigger=""
        >
          <EditOutlined />
        </button>
      </Tooltip>
      <Modal
        title={t('ui.projectAlias.modalTitle')}
        open={open}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={420}
        footer={
          <div className={styles.footer}>
            <div className={styles.footerLeft}>
              {alias ? (
                <Button danger onClick={handleClear}>
                  {t('ui.projectAlias.clear')}
                </Button>
              ) : null}
            </div>
            <div className={styles.footerRight}>
              <Button onClick={() => setOpen(false)}>
                {t('ui.projectAlias.cancel')}
              </Button>
              <Button type="primary" disabled={!valueDiffers} onClick={handleSave}>
                {t('ui.projectAlias.save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className={styles.projectNameRow}>
          <span className={styles.projectNameLabel}>{t('ui.projectAlias.projectLabel')}</span>
          <span className={styles.projectNameValue}>{projectName}</span>
        </div>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          onKeyDown={handleKeyDown}
          placeholder={t('ui.projectAlias.placeholder')}
          maxLength={ALIAS_MAX_LEN}
          showCount
          allowClear
        />
      </Modal>
    </>
  );
}
