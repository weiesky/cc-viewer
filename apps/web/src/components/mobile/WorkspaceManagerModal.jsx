import { useEffect, useState } from 'react';
import { Modal, Button, Tag, Empty } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { buildWorkspaceListModel } from '../../utils/resumeSessions';
import { reportSwallowed } from '../../utils/errorReport';
import Loading from '../common/Loading';
import styles from './WorkspaceManagerModal.module.css';

// Mobile workspace manager (2026-11): the hamburger menu's single entry for both
// workspace actions. Section 1 lists the LIVE workspaces (GET /api/live-processes,
// polled every 5s while open — same shape as the desktop HeaderProjectSwitcher poll
// at AppHeader.jsx) and switches the view; section 2 hands off to the shared
// NewProjectModal for creating/launching another workspace.
//
// Row classification lives in buildWorkspaceListModel (utils/resumeSessions.js),
// which carries the two invariants this UI depends on:
//   1. The BOUND project's row routes to onDetachView, never onActivateChip —
//      mirrors HeaderProjectTabs.onTabClick (AppHeader.jsx:308-325).
//   2. The bound project is always listed (synthesized when its PTY is dead) —
//      mobile-only: there is no header tab strip here, so without the fallback row
//      switching to a parallel workspace would leave no way back.
export default function WorkspaceManagerModal({
  open,
  onClose,
  currentProject,
  viewedProject,
  viewedInstance,
  resumeSwitch,
  onActivateChip,
  onDetachView,
  onOpenNewProject,
}) {
  // null = not loaded yet (spinner); { processes, currentProject, currentInstanceKey }.
  const [live, setLive] = useState(null);
  // Render-phase open-transition reset (React's "adjust state when a prop changes"):
  // the component stays mounted while closed (destroyOnHidden only drops the Modal's
  // panel), so without this the first reopened render would compute rows — and the
  // dead-view heal below — from the PREVIOUS open's snapshot. A useEffect reset would
  // land one commit too late (the heal effect shares that commit's stale closure).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLive(null);
  }

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const load = () => {
      fetch(apiUrl('/api/live-processes'))
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(data => { if (!cancelled) setLive(data || {}); })
        .catch(err => { if (!cancelled) reportSwallowed('workspaceManager.fetch', err); });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open]);

  // The prop wins over the poll's currentProject: state.projectName updates on
  // workspace_started immediately, while the snapshot can be a poll interval stale
  // (a stale bound name would misroute the new bound row to activate).
  const model = buildWorkspaceListModel({
    processes: live && Array.isArray(live.processes) ? live.processes : [],
    currentProject: currentProject || (live && live.currentProject) || '',
    currentInstanceKey: (live && live.currentInstanceKey) || null,
    viewedProject,
    viewedInstance,
    resumeSwitch: !!resumeSwitch,
  });

  // Dead-view self-heal: mobile has no always-on live-processes consumer, so a
  // viewed parallel project whose process died would sit frozen indefinitely.
  // Opening this modal is the natural moment to notice and detach back.
  useEffect(() => {
    if (open && live && model.healNeeded && onDetachView) onDetachView();
  }, [open, live, model.healNeeded, onDetachView]);

  const handleRowClick = (row) => {
    if (model.isBoundRow(row)) {
      if (onDetachView) onDetachView();
    } else if (onActivateChip) {
      // cwd feeds the viewedWorkspace persistence on mobile, where
      // _lastProjectTabs is empty (no header poll) and resolveCwdForView finds nothing.
      onActivateChip({ project: row.project, instanceKey: row.instanceKey || null, cwd: row.cwd || null });
    }
    onClose();
  };

  let body;
  if (!live) {
    body = <div className={styles.center}><Loading /></div>;
  } else if (model.rows.length === 0) {
    // Defensive: cur is only empty when nothing is bound at all (workspaceMode is
    // rendered as a full page elsewhere, so this modal never opens there).
    body = <Empty description={t('ui.workspaceManager.emptyLive')} />;
  } else {
    body = (
      <div className={styles.list}>
        {model.rows.map(row => {
          const isViewing = model.isViewing(row);
          return (
            <button
              key={row.key}
              type="button"
              className={`${styles.row}${isViewing ? ` ${styles.rowViewing}` : ''}`}
              disabled={isViewing}
              aria-current={isViewing ? 'true' : undefined}
              onClick={() => handleRowClick(row)}
            >
              <span className={styles.rowMain}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{row.project}</span>
                  {row.suffix && <span className={styles.rowSuffix}>{row.suffix}</span>}
                </span>
                {row.cwd && <span className={styles.rowCwd} title={row.cwd}>{row.cwd}</span>}
              </span>
              {isViewing && <Tag color="blue">{t('ui.workspaceManager.currentTag')}</Tag>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Modal
      title={t('ui.workspaceManager.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(560px, calc(100vw - 8px))"
      destroyOnHidden
      styles={{ body: { padding: '12px 16px' } }}
    >
      <p className={styles.sectionTitle}>{t('ui.workspaceManager.switchTitle')}</p>
      {body}
      <div className={styles.divider} />
      <Button
        className={styles.createRow}
        icon={<PlusOutlined />}
        onClick={onOpenNewProject}
        size="large"
      >
        {t('ui.resume.newProject')}
      </Button>
    </Modal>
  );
}
