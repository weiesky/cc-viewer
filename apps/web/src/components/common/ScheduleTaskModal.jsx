import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Button, Input, Radio, Select, Switch, InputNumber, DatePicker, TimePicker, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { subscribeScheduledTasks } from '../../utils/scheduledTaskEvents';
import {
  describeSchedule, deriveTaskUiStatus, formatNextRun, formatTimestamp,
  runStatusLabel, reasonLabel, errorLabel,
} from '../../utils/scheduleDescription';
import styles from './ScheduleTaskModal.module.css';

const KINDS = ['hourly', 'daily', 'weekdays', 'weekly', 'cron', 'once'];

function _emptyDraft() {
  return {
    id: null,
    prompt: '',
    mode: 'inject',
    scheduleKind: 'daily',
    hourlyMinute: 0,
    time: '09:00',
    weeklyDay: 1,
    cronExpr: '',
    onceAt: null,
    enabled: true,
  };
}

// Build the API schedule object from the draft's UI fields. Returns null when invalid.
function _draftToSchedule(draft) {
  switch (draft.scheduleKind) {
    case 'hourly': return { kind: 'hourly', minute: draft.hourlyMinute };
    case 'daily': return { kind: 'daily', time: draft.time };
    case 'weekdays': return { kind: 'weekdays', time: draft.time };
    case 'weekly': return { kind: 'weekly', day: draft.weeklyDay, time: draft.time };
    case 'cron': return { kind: 'cron', expr: draft.cronExpr.trim() };
    case 'once': return draft.onceAt ? { kind: 'once', at: draft.onceAt.valueOf() } : null;
    default: return null;
  }
}

function _taskToDraft(task) {
  const s = task.schedule || {};
  return {
    id: task.id,
    prompt: task.prompt || '',
    mode: task.mode || 'inject',
    scheduleKind: s.kind || 'daily',
    hourlyMinute: s.minute ?? 0,
    time: s.time || '09:00',
    weeklyDay: s.day ?? 1,
    cronExpr: s.expr || '',
    onceAt: s.at ? dayjs(s.at) : null,
    enabled: task.enabled !== false,
  };
}

async function _fetchJson(path, init) {
  const r = await fetch(apiUrl(path), init);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}

export default function ScheduleTaskModal({ open, onClose, project, instance, serverTimezone, onResumeSession }) {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(() => _emptyDraft());
  const [dirty, setDirty] = useState(false);
  const [runs, setRuns] = useState([]);
  const [spawnAvailable, setSpawnAvailable] = useState(false);
  const [tz, setTz] = useState(serverTimezone || '');
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewSeq = useRef(0);
  const previewAbort = useRef(null);

  const isNew = draft.id === null;
  const selectedTask = useMemo(() => tasks.find(t2 => t2.id === selectedId) || null, [tasks, selectedId]);

  // ── data loading ──────────────────────────────────────────────────────────
  const loadTasks = useCallback(async (keepSelection = true) => {
    setLoading(true);
    try {
      const q = project ? `?project=${encodeURIComponent(project)}` : '';
      const { ok, data } = await _fetchJson(`/api/scheduled-tasks${q}`);
      if (!ok) { message.error(t('ui.schedule.loadFailed')); return; }
      setSpawnAvailable(!!data.spawnAvailable);
      if (data.timezone) setTz(data.timezone);
      setTasks(data.tasks || []);
      // Don't clobber a dirty draft when the list refreshes (review P1-7).
      setSelectedId(prev => {
        if (!keepSelection) return prev;
        if (prev && (data.tasks || []).some(t2 => t2.id === prev)) return prev;
        return (data.tasks && data.tasks[0] && data.tasks[0].id) || null;
      });
    } catch (err) {
      reportSwallowed('schedule-modal.load', err);
      message.error(t('ui.schedule.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  const loadRuns = useCallback(async (id) => {
    if (!id) { setRuns([]); return; }
    try {
      const q = `?id=${encodeURIComponent(id)}${project ? `&project=${encodeURIComponent(project)}` : ''}`;
      const { ok, data } = await _fetchJson(`/api/scheduled-tasks/runs${q}`);
      if (ok) setRuns((data.runs || []).slice().reverse()); // newest first
    } catch (err) { reportSwallowed('schedule-modal.runs', err); }
  }, [project]);

  // Initial + SSE-driven load.
  useEffect(() => {
    if (!open) return undefined;
    loadTasks();
    const unsub = subscribeScheduledTasks(project, (data) => {
      if (data.type === 'task_changed') loadTasks();
      else if (data.type === 'task_run') { loadTasks(); if (data.taskId === selectedId) loadRuns(selectedId); }
    });
    return unsub;
  }, [open, project, loadTasks, loadRuns, selectedId]);

  // When the selection changes, hydrate the draft from the task (unless dirty).
  // Depends on tasks too so a refresh re-hydrates a clean draft; an empty selection with
  // a clean draft resets to a fresh blank form (fixes "abandoned edits persist").
  useEffect(() => {
    if (!selectedTask) {
      if (!dirty) { setDraft(_emptyDraft()); setRuns([]); }
      return;
    }
    if (!dirty) setDraft(_taskToDraft(selectedTask));
    loadRuns(selectedTask.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tasks, open]);

  // Reset ALL local state when the project changes (or the modal reopens onto a different
  // project) so a stale draft from project A can never be saved/run against project B.
  useEffect(() => {
    setSelectedId(null);
    setDraft(_emptyDraft());
    setDirty(false);
    setRuns([]);
  }, [project]);

  // ── preview (debounced, seq-guarded, abortable — review P2-4) ────────────
  useEffect(() => {
    if (!open) return undefined;
    const schedule = _draftToSchedule(draft);
    const seq = ++previewSeq.current;
    if (!schedule) { setPreview([]); return undefined; }
    const timer = setTimeout(async () => {
      if (seq !== previewSeq.current) return;
      try { previewAbort.current?.abort(); } catch { /* best-effort */ }
      const ac = new AbortController();
      previewAbort.current = ac;
      try {
        const { ok, data } = await _fetchJson('/api/scheduled-tasks/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schedule }), signal: ac.signal,
        });
        if (seq !== previewSeq.current) return;
        setPreview(ok && Array.isArray(data.next) ? data.next : []);
        if (data.timezone) setTz(data.timezone);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        reportSwallowed('schedule-modal.preview', err);
        if (seq === previewSeq.current) setPreview([]);
      }
    }, 400);
    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.scheduleKind, draft.hourlyMinute, draft.time, draft.weeklyDay, draft.cronExpr, draft.onceAt, open]);

  // Cleanup on close/unmount: cancel any in-flight preview.
  useEffect(() => () => { try { previewAbort.current?.abort(); } catch { /* best-effort */ } }, []);

  // ── mutations ─────────────────────────────────────────────────────────────
  const updateDraft = useCallback((patch) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); }, []);

  const handleSelect = useCallback((task) => {
    if (dirty && draft.id !== (task && task.id)) {
      Modal.confirm({
        title: t('ui.schedule.discardConfirm'),
        onOk: () => { setDirty(false); setSelectedId(task ? task.id : null); if (task) setDraft(_taskToDraft(task)); },
      });
      return;
    }
    setSelectedId(task ? task.id : null);
    if (task) { setDraft(_taskToDraft(task)); setDirty(false); }
  }, [dirty, draft.id]);

  const handleNew = useCallback(() => {
    if (dirty) {
      Modal.confirm({
        title: t('ui.schedule.discardConfirm'),
        onOk: () => { setDirty(false); setSelectedId(null); setDraft(_emptyDraft()); },
      });
      return;
    }
    setSelectedId(null);
    setDraft(_emptyDraft());
  }, [dirty, project, spawnAvailable]);

  const handleSave = useCallback(async () => {
    const schedule = _draftToSchedule(draft);
    if (!draft.prompt.trim()) { message.error(t('ui.schedule.error.invalid_prompt')); return; }
    if (!schedule) { message.error(t('ui.schedule.previewInvalid')); return; }
    setSaving(true);
    try {
      const isUpdate = draft.id !== null;
      const { ok, data } = await _fetchJson(isUpdate ? '/api/scheduled-tasks/update' : '/api/scheduled-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUpdate
          ? { id: draft.id, prompt: draft.prompt, mode: draft.mode, schedule, enabled: draft.enabled }
          : { project, instance, prompt: draft.prompt, mode: draft.mode, schedule, enabled: draft.enabled }),
      });
      if (!ok || data.ok === false) {
        message.error(`${t('ui.schedule.saveFailed')}: ${errorLabel(data.error)}`);
        return;
      }
      setDirty(false);
      message.success(t('ui.schedule.saved'));
      await loadTasks();
      if (!isUpdate && data.task) setSelectedId(data.task.id);
    } catch (err) {
      reportSwallowed('schedule-modal.save', err);
      message.error(t('ui.schedule.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [draft, project, instance, loadTasks]);

  const handleDelete = useCallback(() => {
    if (!draft.id) return;
    Modal.confirm({
      title: t('ui.schedule.deleteConfirm'),
      onOk: async () => {
        try {
          const { ok, data } = await _fetchJson('/api/scheduled-tasks/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draft.id }),
          });
          if (!ok || data.ok === false) { message.error(`${t('ui.schedule.deleteFailed')}: ${errorLabel(data.error)}`); return; }
          message.success(t('ui.schedule.deleted'));
          setDirty(false);
          setSelectedId(null);
          setDraft(_emptyDraft());
          await loadTasks(false);
        } catch (err) {
          reportSwallowed('schedule-modal.delete', err);
          message.error(t('ui.schedule.deleteFailed'));
        }
      },
    });
  }, [draft.id, project, spawnAvailable, loadTasks]);

  const handleRunNow = useCallback(async () => {
    if (!draft.id || dirty) return; // Run now operates on the SAVED version (P1-7)
    try {
      const { status, data } = await _fetchJson('/api/scheduled-tasks/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draft.id }),
      });
      if (status === 202 && data.ok) { message.success(t('ui.schedule.runStarted')); await loadRuns(draft.id); }
      else message.error(errorLabel(data.error));
    } catch (err) {
      reportSwallowed('schedule-modal.run', err);
      message.error(t('ui.schedule.error.internal'));
    }
  }, [draft.id, dirty, loadRuns]);

  const handleOpenSession = useCallback((run) => {
    if (!run.sessionId || typeof onResumeSession !== 'function') return;
    // Reuse AppBase's resume flow (confirm + attach view), not the raw util (P1-1).
    onClose();
    onResumeSession({ sessionUuid: run.sessionId });
  }, [onResumeSession, onClose]);

  const handleCancel = useCallback(() => {
    if (dirty) {
      Modal.confirm({ title: t('ui.schedule.discardConfirm'), onOk: () => { setDirty(false); onClose(); } });
      return;
    }
    onClose();
  }, [dirty, onClose]);

  // ── render ────────────────────────────────────────────────────────────────
  const canRunNow = !isNew && !dirty;
  const schedule = _draftToSchedule(draft);

  return (
    <Modal
      title={`${t('ui.schedule.title')}${project ? ` · ${project}` : ''}`}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={860}
      destroyOnHidden
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      <div className={styles.layout}>
        {/* Left: task list */}
        <div className={styles.listPane}>
          <div className={styles.listHeader}>
            <Button size="small" type="primary" onClick={handleNew}>{t('ui.schedule.newTask')}</Button>
          </div>
          <div className={styles.list}>
            {tasks.length === 0 && !loading ? (
              <div className={styles.emptyHint}>{t('ui.schedule.empty')}</div>
            ) : tasks.map(task => {
              const st = deriveTaskUiStatus(task);
              return (
                <button
                  key={task.id}
                  className={`${styles.listRow} ${task.id === selectedId ? styles.listRowActive : ''}`}
                  onClick={() => handleSelect(task)}
                >
                  <span className={`${styles.statusDot} ${styles[`status_${st}`]}`} title={t(`ui.schedule.status.${st}`)} />
                  <span className={styles.listRowMain}>
                    <span className={styles.listRowSummary} title={task.promptSummary || task.prompt}>{String(task.promptSummary || task.prompt || '').split('\n')[0].slice(0, 60) || '—'}</span>
                    <span className={styles.listRowMeta}>
                      {describeSchedule(task.schedule, tz)}
                      {' · '}
                      {task.enabled === false ? t('ui.schedule.status.paused') : formatNextRun(task.nextRunAt, tz)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: form + history */}
        <div className={styles.detailPane}>
          <div className={styles.field}>
            <label className={styles.label}>{t('ui.schedule.prompt')}</label>
            <Input.TextArea
              rows={3}
              value={draft.prompt}
              placeholder={t('ui.schedule.promptPlaceholder')}
              onChange={e => updateDraft({ prompt: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.modeRow}>
              <div className={styles.modeGroup}>
                <label className={styles.label}>{t('ui.schedule.mode')}</label>
                <Radio.Group
                  value={draft.mode}
                  onChange={e => updateDraft({ mode: e.target.value })}
                >
                  <Tooltip title={t('ui.schedule.modeInjectHint')}><Radio value="inject">{t('ui.schedule.modeInject')}</Radio></Tooltip>
                  <Tooltip title={spawnAvailable ? t('ui.schedule.modeSpawnHint') : t('ui.schedule.modeSpawnUnavailable')}>
                    <Radio value="spawn" disabled={!spawnAvailable}>{t('ui.schedule.modeSpawn')}</Radio>
                  </Tooltip>
                </Radio.Group>
              </div>
              <div className={styles.enabledGroup}>
                <label className={styles.label}>{t('ui.schedule.enabled')}</label>
                <Switch checked={draft.enabled} onChange={v => updateDraft({ enabled: v })} />
              </div>
            </div>
            {draft.mode === 'spawn' && (
              <div className={styles.permNote}>{t('ui.schedule.spawnPermNote')}</div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('ui.schedule.kindLabel')}</label>
            <div className={styles.scheduleRow}>
              <Select
                value={draft.scheduleKind}
                onChange={v => updateDraft({ scheduleKind: v })}
                options={KINDS.map(k => ({ value: k, label: t(`ui.schedule.kind.${k}`) }))}
                className={styles.kindSelect}
              />
              {draft.scheduleKind === 'hourly' && (
                <span className={styles.inlineCtl}>
                  {t('ui.schedule.minute')}
                  <InputNumber min={0} max={59} value={draft.hourlyMinute} onChange={v => updateDraft({ hourlyMinute: v ?? 0 })} />
                </span>
              )}
              {(draft.scheduleKind === 'daily' || draft.scheduleKind === 'weekdays' || draft.scheduleKind === 'weekly') && (
                <TimePicker
                  format="HH:mm"
                  value={draft.time ? dayjs(draft.time, 'HH:mm') : null}
                  onChange={v => updateDraft({ time: v ? v.format('HH:mm') : '09:00' })}
                  allowClear={false}
                />
              )}
              {draft.scheduleKind === 'weekly' && (
                <Select
                  value={draft.weeklyDay}
                  onChange={v => updateDraft({ weeklyDay: v })}
                  options={[1, 2, 3, 4, 5, 6, 7].map(d => ({ value: d, label: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2024, 0, d)) }))}
                  className={styles.weekdaySelect}
                />
              )}
              {draft.scheduleKind === 'cron' && (
                <Input
                  value={draft.cronExpr}
                  placeholder={t('ui.schedule.cronPlaceholder')}
                  onChange={e => updateDraft({ cronExpr: e.target.value })}
                  className={styles.cronInput}
                />
              )}
              {draft.scheduleKind === 'once' && (
                <DatePicker
                  showTime
                  value={draft.onceAt}
                  onChange={v => updateDraft({ onceAt: v })}
                />
              )}
            </div>
            <div className={styles.scheduleMeta}>
              {schedule && preview.length > 0 && (
                <span className={styles.nextRun}>{t('ui.schedule.nextRun')}: {formatNextRun(preview[0], tz)}</span>
              )}
              {schedule && !preview.length && (
                <span className={styles.muted}>{t('ui.schedule.nextRunNone')}</span>
              )}
              {!schedule && (
                <span className={styles.muted}>{t('ui.schedule.previewInvalid')}</span>
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <Button type="primary" loading={saving} onClick={handleSave} disabled={!dirty && !isNew}>
              {t('ui.schedule.save')}
            </Button>
            <Tooltip title={dirty ? t('ui.schedule.runNowDirtyHint') : ''}>
              <Button onClick={handleRunNow} disabled={!canRunNow}>{t('ui.schedule.runNow')}</Button>
            </Tooltip>
            {!isNew && (
              <Button danger onClick={handleDelete}>{t('ui.schedule.delete')}</Button>
            )}
          </div>

          {/* Run history */}
          {!isNew && (
            <div className={styles.history}>
              <div className={styles.historyTitle}>{t('ui.schedule.history')}</div>
              {runs.length === 0 ? (
                <div className={styles.emptyHint}>{t('ui.schedule.historyEmpty')}</div>
              ) : runs.map(run => (
                <div key={run.id} className={styles.runRow}>
                  <span className={`${styles.statusDot} ${styles[`run_${run.status}`]}`} />
                  <span className={styles.runTime}>{formatTimestamp(run.finishedAt || run.at, tz)}</span>
                  <span className={styles.runStatus}>
                    {runStatusLabel(run.status)}
                    {run.catchUp ? ` · ${t('ui.schedule.catchUp')}` : ''}
                    {run.manual ? ` · ${t('ui.schedule.manual')}` : ''}
                    {run.reason ? ` · ${reasonLabel(run.reason)}` : ''}
                  </span>
                  {run.durationMs != null && <span className={styles.runDuration}>{Math.round(run.durationMs / 100) / 10}s</span>}
                  {draft.mode === 'spawn' && run.sessionId && (run.status === 'completed' || run.status === 'error') && (
                    <Button size="small" type="link" onClick={() => handleOpenSession(run)}>{t('ui.schedule.openSession')}</Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
