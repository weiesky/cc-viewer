import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { Modal, Button, Input, Radio, Select, Switch, InputNumber, DatePicker, TimePicker, Tooltip, message } from 'antd';
import dayjs from 'dayjs';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { subscribeScheduledTasks } from '../../utils/scheduledTaskEvents';
import { resizeImageIfNeeded } from '../../utils/imageResize';
import { assembleScheduledPrompt } from '@ccv/core/ultraplanTemplates';
import { buildExpertList } from '../../utils/ultraplanExperts';
import { UltraplanController } from '../../utils/ultraplanController';
import { SettingsContext } from '../../contexts/SettingsContext';
import UltraplanPanel from '../terminal/UltraplanPanel';
import CustomUltraplanEditModal from '../terminal/CustomUltraplanEditModal';
import ImageLightbox from './ImageLightbox';
import {
  describeSchedule, deriveTaskUiStatus, formatNextRun, formatTimestamp,
  runStatusLabel, reasonLabel, errorLabel,
} from '../../utils/scheduleDescription';
import styles from './ScheduleTaskModal.module.css';

const KINDS = ['hourly', 'daily', 'weekdays', 'weekly', 'cron', 'once'];

// Quick-fill offsets for the one-time DatePicker, in minutes.
const ONCE_QUICK_OFFSETS = [
  { key: '5m', minutes: 5 },
  { key: '10m', minutes: 10 },
  { key: '30m', minutes: 30 },
  { key: '1h', minutes: 60 },
  { key: '3h', minutes: 180 },
];

// Mirrors the server-side cap (scheduled-task-store.js MAX_PROMPT_LEN); checked before
// save so an over-long assembled prompt (template + attachment paths + text) fails fast.
const MAX_PROMPT_LEN = 20000;
// Mirrors the server-side attachment cap.
const MAX_ATTACHMENTS = 20;

// Same pipeline as TerminalPanel.uploadFileAndGetPath, but returns the PERSISTENT path:
// a scheduled task can fire days later, after the /tmp copy has been cleaned, while
// persistPath (~/.claude/cc-viewer/<project>/images/) survives — and stays inside the
// file-access allowlist, so the executor's Claude can still read it at fire time.
async function _uploadAttachment(file) {
  const MAX_SIZE = 100 * 1024 * 1024; // 100MB
  let upload = file;
  try { upload = await resizeImageIfNeeded(file, 2000); } catch (err) { reportSwallowed('schedule-modal.upload-resize', err); upload = file; }
  if (upload.size > MAX_SIZE) throw new Error(t('ui.ultraplan.uploadTooLarge', { max: '100MB' }));
  const form = new FormData();
  form.append('file', upload);
  const res = await fetch(apiUrl('/api/upload'), { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || t('ui.ultraplan.uploadFailed'));
  // A scheduled attachment MUST land on the persistent path — the /tmp copy can be
  // cleaned days before the task fires, silently dead-linking the prompt prefix.
  if (!data.persistPath) throw new Error(t('ui.ultraplan.uploadFailed'));
  return data.persistPath;
}

function _emptyDraft() {
  return {
    id: null,
    prompt: '',
    // UltraPlan template tab. 'none' = empty template (default): the raw prompt is
    // sent as-is. Builtin keys wrap via ULTRAPLAN_VARIANTS; 'custom:<id>' uses the
    // expert body snapshot (templateContent) taken at save time.
    template: 'none',
    attachments: [],
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

// A draft counts as "blank" when nothing in it differs from the pristine new-task
// form. Blank drafts carry no user work, so closing/switching away must NOT prompt
// the discard-confirm — even if `dirty` was flipped by an incidental focus/click
// (e.g. opening the TimePicker and cancelling, or typing into the prompt and
// deleting it again). The template tab alone is NOT content: switching it without
// typing anything still counts as blank.
function _isBlankDraft(draft) {
  const e = _emptyDraft();
  return (
    draft.id === null
    && draft.prompt.trim() === ''
    && (!Array.isArray(draft.attachments) || draft.attachments.length === 0)
    && draft.mode === e.mode
    && draft.scheduleKind === e.scheduleKind
    && draft.hourlyMinute === e.hourlyMinute
    && draft.time === e.time
    && draft.weeklyDay === e.weeklyDay
    && draft.cronExpr === e.cronExpr
    && draft.onceAt === null
    && draft.enabled === e.enabled
  );
}

// Build the API schedule object from the draft's UI fields. Returns null when invalid.
function _draftToSchedule(draft) {
  switch (draft.scheduleKind) {
    case 'hourly': return { kind: 'hourly', minute: draft.hourlyMinute };
    case 'daily': return draft.time ? { kind: 'daily', time: draft.time } : null;
    case 'weekdays': return draft.time ? { kind: 'weekdays', time: draft.time } : null;
    case 'weekly': return draft.time ? { kind: 'weekly', day: draft.weeklyDay, time: draft.time } : null;
    case 'cron': {
      const expr = draft.cronExpr.trim();
      return expr ? { kind: 'cron', expr } : null;
    }
    case 'once': return draft.onceAt ? { kind: 'once', at: draft.onceAt.valueOf() } : null;
    default: return null;
  }
}

function _taskToDraft(task) {
  const s = task.schedule || {};
  return {
    id: task.id,
    prompt: task.prompt || '',
    template: task.template || 'none',
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
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
  const [saving, setSaving] = useState(false);
  const previewSeq = useRef(0);
  const previewAbort = useRef(null);
  // Set when the user explicitly enters "new task" mode (New button / delete).
  // While set, the auto-select in loadTasks must not re-pick tasks[0] — that
  // would immediately bounce the blank form back to the first task.
  const newTaskMode = useRef(false);

  // ── UltraPlan panel wiring (experts mirror + controller + sub-modals) ──────
  // The modal is a function component, so the shared UltraplanController (built for
  // class hosts) is bridged through an explicit key map: ultraplanFiles→attachments,
  // ultraplanVariant→template, expert keys→the preferences mirror state. draftRef
  // always points at the latest draft so controller reads never go stale.
  const { preferences, updatePreferences } = useContext(SettingsContext);
  const [expertPrefs, setExpertPrefs] = useState({ experts: [], order: [], hidden: [], ready: false });
  const [customEditor, setCustomEditor] = useState({ open: false, item: null });
  const [lightbox, setLightbox] = useState(null);

  // The component stays mounted while closed, so destroyOnHidden does not reset these
  // two sub-overlays — reset them on close, or they would resurface on the next open.
  useEffect(() => {
    if (!open) { setLightbox(null); setCustomEditor({ open: false, item: null }); }
  }, [open]);

  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const expertPrefsRef = useRef(expertPrefs);
  useEffect(() => { expertPrefsRef.current = expertPrefs; }, [expertPrefs]);

  // Hydrate the expert mirror from SettingsContext (same source TerminalPanel/ChatView
  // derive from props.preferences). Never touches the draft or dirty flag.
  useEffect(() => {
    if (!preferences) return;
    setExpertPrefs({
      experts: Array.isArray(preferences.customUltraplanExperts) ? preferences.customUltraplanExperts : [],
      order: Array.isArray(preferences.ultraplanExpertOrder) ? preferences.ultraplanExpertOrder : [],
      hidden: Array.isArray(preferences.ultraplanExpertHidden) ? preferences.ultraplanExpertHidden : [],
      ready: true,
    });
  }, [preferences]);

  // Dangling custom template: a 'custom:<id>' template whose expert no longer exists
  // falls back to 'none' ONLY for brand-new drafts. For a saved task the stored
  // templateContent snapshot still fires (executor uses the snapshot, not live prefs),
  // so rewriting template→'none' here would permanently drop the snapshot on the next
  // unrelated save — keep the key and let handleSave omit a fresh snapshot instead.
  // Builtin keys and 'none' are always valid and must NOT be reset (the shared hosts'
  // visibleExpertKeys fallback would otherwise clobber the empty-template default).
  useEffect(() => {
    if (!expertPrefs.ready || draft.id !== null) return;
    const cur = draft.template;
    if (typeof cur === 'string' && cur.startsWith('custom:')
        && !expertPrefs.experts.some(e => 'custom:' + e.id === cur)) {
      setDraft(d => (d.template === cur ? { ...d, template: 'none' } : d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertPrefs, draft.template]);

  const ultraplanRef = useRef(null);
  if (!ultraplanRef.current) {
    ultraplanRef.current = new UltraplanController({
      getState: () => ({
        ultraplanFiles: draftRef.current.attachments,
        customUltraplanExperts: expertPrefsRef.current.experts,
        ultraplanExpertOrder: expertPrefsRef.current.order,
        ultraplanExpertHidden: expertPrefsRef.current.hidden,
        ultraplanVariant: draftRef.current.template,
      }),
      // Translate the controller's hardcoded host keys onto draft fields / expert
      // mirror. Draft writes go through updateDraft (sets dirty); expert mirror
      // writes are preferences-backed and must not mark the task form dirty.
      setState: (updater) => {
        const prev = {
          ultraplanFiles: draftRef.current.attachments,
          customUltraplanExperts: expertPrefsRef.current.experts,
          ultraplanExpertOrder: expertPrefsRef.current.order,
          ultraplanExpertHidden: expertPrefsRef.current.hidden,
          ultraplanVariant: draftRef.current.template,
        };
        const patch = typeof updater === 'function' ? updater(prev) : updater;
        if (!patch) return;
        // Merge against the LIVE draft so overlapping upload/paste completions never
        // drop a file: a patch that grows the list wins (it carries the new file);
        // a same-length patch is a remove (controller's handleRemoveFile filters by
        // index) — apply it as-is; a patch computed from a stale prev (shorter than
        // the live list) is an append racing a completed sibling — keep the live list.
        if ('ultraplanFiles' in patch) {
          setDraft(d => {
            const next = Array.isArray(patch.ultraplanFiles) ? patch.ultraplanFiles : [];
            if (next.length < d.attachments.length && next.length !== d.attachments.length - 1) return d;
            return { ...d, attachments: next.slice(0, MAX_ATTACHMENTS) };
          });
          setDirty(true);
        }
        if ('ultraplanVariant' in patch) {
          setDraft(d => ({ ...d, template: patch.ultraplanVariant }));
          setDirty(true);
        }
        if ('customUltraplanExperts' in patch || 'ultraplanExpertOrder' in patch || 'ultraplanExpertHidden' in patch) {
          setExpertPrefs(p => ({
            ...p,
            ...('customUltraplanExperts' in patch ? { experts: patch.customUltraplanExperts } : {}),
            ...('ultraplanExpertOrder' in patch ? { order: patch.ultraplanExpertOrder } : {}),
            ...('ultraplanExpertHidden' in patch ? { hidden: patch.ultraplanExpertHidden } : {}),
          }));
        }
      },
      onUpdatePreferences: (p) => updatePreferences(p),
      uploadFile: (file) => _uploadAttachment(file),
      messageError: (msg) => message.error(msg),
      closeEditor: () => setCustomEditor({ open: false, item: null }),
      // Deleting the selected custom expert falls back to the empty template here
      // (the popover hosts keep their codeExpert default).
      fallbackVariant: 'none',
    });
  }
  const ultraplan = ultraplanRef.current;

  const isNew = draft.id === null;
  const selectedTask = useMemo(() => tasks.find(t2 => t2.id === selectedId) || null, [tasks, selectedId]);
  // Live project for in-flight guards: `project` inside a useCallback([project]) closure is
  // the RENDER-time value; a fetch started under project A must not write state after the
  // modal switches to B. The ref is updated by the project-reset effect below.
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  // ── data loading ──────────────────────────────────────────────────────────
  const loadTasks = useCallback(async (keepSelection = true) => {
    const loadProject = project;
    try {
      // instance 是关键授权证据:只看项目名时,同名/未注册项目会拿到摘要形态(无 prompt),
      // 导致编辑时 prompt 为空。带上 instance 让服务端按实例精确解析(见 _resolveProjectToCwd)。
      const params = new URLSearchParams();
      if (loadProject) params.set('project', loadProject);
      if (instance) params.set('instance', instance);
      const q = params.size ? `?${params}` : '';
      const { ok, data } = await _fetchJson(`/api/scheduled-tasks${q}`);
      // The modal can switch projects while a list fetch is in flight; ignore
      // responses for the old project so tasks/runs never cross over.
      if (loadProject !== projectRef.current) return;
      if (!ok) { message.error(t('ui.schedule.loadFailed')); return; }
      setSpawnAvailable(!!data.spawnAvailable);
      if (data.timezone) setTz(data.timezone);
      setTasks(data.tasks || []);
      // Don't clobber a dirty draft when the list refreshes (review P1-7).
      // And don't auto-select the first task while the user is in "new task"
      // mode — they explicitly asked for a blank form.
      setSelectedId(prev => {
        if (!keepSelection) return prev;
        if (prev && (data.tasks || []).some(t2 => t2.id === prev)) return prev;
        if (newTaskMode.current) return null;
        return (data.tasks && data.tasks[0] && data.tasks[0].id) || null;
      });
    } catch (err) {
      reportSwallowed('schedule-modal.load', err);
      message.error(t('ui.schedule.loadFailed'));
    }
  }, [project, instance]);

  const loadRuns = useCallback(async (id) => {
    if (!id) { setRuns([]); return; }
    const loadProject = project;
    try {
      const q = `?id=${encodeURIComponent(id)}${loadProject ? `&project=${encodeURIComponent(loadProject)}` : ''}`;
      const { ok, data } = await _fetchJson(`/api/scheduled-tasks/runs${q}`);
      if (loadProject !== projectRef.current) return;
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
    setTasks([]);
    setDraft(_emptyDraft());
    setDirty(false);
    setRuns([]);
  }, [project]);

  // The mode radio group is hidden when spawn isn't available (PTY mode); normalize a
  // leftover 'spawn' draft ONLY for a brand-new form (an existing task's stored mode must
  // survive an unrelated edit — silently flipping spawn→inject on save would change where
  // the task runs). For existing tasks the update payload below omits `mode` when the
  // control is hidden, so the server-side value is preserved.
  useEffect(() => {
    if (!spawnAvailable && isNew && draft.mode !== 'inject') setDraft(d => ({ ...d, mode: 'inject' }));
  }, [spawnAvailable, isNew, draft.mode]);

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
    // Blank drafts (no prompt, no schedule tweaks) carry no work — don't ask to discard.
    if (dirty && !_isBlankDraft(draft) && draft.id !== (task && task.id)) {
      Modal.confirm({
        title: t('ui.schedule.discardConfirm'),
        onOk: () => { newTaskMode.current = false; setDirty(false); setSelectedId(task ? task.id : null); if (task) setDraft(_taskToDraft(task)); },
      });
      return;
    }
    newTaskMode.current = false;
    setSelectedId(task ? task.id : null);
    if (task) { setDraft(_taskToDraft(task)); setDirty(false); }
  }, [dirty, draft]);

  const handleNew = useCallback(() => {
    if (dirty && !_isBlankDraft(draft)) {
      Modal.confirm({
        title: t('ui.schedule.discardConfirm'),
        onOk: () => { newTaskMode.current = true; setDirty(false); setSelectedId(null); setDraft(_emptyDraft()); },
      });
      return;
    }
    newTaskMode.current = true;
    setSelectedId(null);
    setDraft(_emptyDraft());
  }, [dirty, draft, project, spawnAvailable]);

  // Synchronous in-flight guard: Cmd/Ctrl+Enter in the embedded panel calls onSend on
  // every keydown (no e.repeat filter), and `saving` state is stale inside this closure,
  // so a held/double chord would POST twice and duplicate a new task. The shortcut must
  // also respect the Save button's disabled reasons (unchanged existing task / legacy).
  const savingRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    if ((!dirty && draft.id !== null) || selectedTask?.legacy) return;
    // A summary-shape task (project/instance unresolved → prompt/attachments stripped)
    // must never be overwritten with a blanked form.
    if (selectedTask && selectedTask.prompt === undefined) return;
    const isUpdateTask = draft.id !== null;
    const schedule = _draftToSchedule(draft);
    if (!draft.prompt.trim() && draft.attachments.length === 0) { message.error(t('ui.schedule.error.invalid_prompt')); return; }
    if (!schedule) { message.error(t('ui.schedule.error.invalid_schedule')); return; }
    // Custom template: snapshot the expert body so later edits/deletions of the expert
    // do not change what fires. A dangling id keeps the STORED snapshot — omitting the
    // field on update lets the server preserve it; only a brand-new task (no stored
    // snapshot to preserve) falls back to the empty template.
    let templateContent;
    let template = draft.template;
    if (typeof template === 'string' && template.startsWith('custom:')) {
      const item = expertPrefs.experts.find(e => 'custom:' + e.id === template);
      if (!item) {
        if (isUpdateTask) {
          // keep template + existing snapshot
        } else {
          template = 'none';
          setDraft(d => ({ ...d, template: 'none' }));
        }
      } else {
        templateContent = item.content;
      }
    }
    // Pre-check the assembled length against the server cap (template + quoted
    // attachment paths + text) so it fails here instead of as a save rejection.
    const assembled = assembleScheduledPrompt({ prompt: draft.prompt, template, templateContent, attachments: draft.attachments });
    if (!assembled || assembled.length > MAX_PROMPT_LEN) { message.error(t('ui.schedule.error.invalid_prompt')); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const isUpdate = draft.id !== null;
      // prompt stores the RAW user text only — the template wrapper and attachment
      // paths are injected at fire time by the executor (assembleScheduledPrompt).
      // When the mode control is hidden (PTY mode), never overwrite an existing task's
      // stored mode — the user had no way to see or change it.
      const updateBody = {
        id: draft.id, prompt: draft.prompt, schedule, enabled: draft.enabled,
        template, templateContent, attachments: draft.attachments,
      };
      if (spawnAvailable) updateBody.mode = draft.mode;
      const { ok, data } = await _fetchJson(isUpdate ? '/api/scheduled-tasks/update' : '/api/scheduled-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUpdate
          ? updateBody
          : { project, instance, prompt: draft.prompt, mode: draft.mode, schedule, enabled: draft.enabled, template, templateContent, attachments: draft.attachments }),
      });
      if (!ok || data.ok === false) {
        message.error(`${t('ui.schedule.saveFailed')}: ${errorLabel(data.error)}`);
        return;
      }
      setDirty(false);
      message.success(t('ui.schedule.saved'));
      await loadTasks();
      if (!isUpdate && data.task) { newTaskMode.current = false; setSelectedId(data.task.id); }
    } catch (err) {
      reportSwallowed('schedule-modal.save', err);
      message.error(t('ui.schedule.saveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, dirty, selectedTask, project, instance, loadTasks, expertPrefs]);

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
          // After deleting the open task the user lands on a blank form; stay in
          // new-task mode so the post-delete reload doesn't re-select tasks[0].
          newTaskMode.current = true;
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
    // Skip the discard-confirm when the draft is still the pristine blank form —
    // nothing was actually entered, so there is no work to lose.
    if (dirty && !_isBlankDraft(draft)) {
      Modal.confirm({ title: t('ui.schedule.discardConfirm'), onOk: () => { setDirty(false); onClose(); } });
      return;
    }
    onClose();
  }, [dirty, draft, onClose]);

  // ── render ────────────────────────────────────────────────────────────────
  const canRunNow = !isNew && !dirty;
  const showList = tasks.length > 0;
  const schedule = _draftToSchedule(draft);

  return (
    <Modal
      title={(
        <span className={styles.titleRow}>
          <span>{t('ui.schedule.title')}</span>
          {showList && (
            <Button size="small" type="primary" onClick={handleNew}>{t('ui.schedule.newTask')}</Button>
          )}
        </span>
      )}
      open={open}
      onCancel={handleCancel}
      footer={null}
      width={860}
      destroyOnHidden
      keyboard={!lightbox}
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      <div className={styles.layout}>
        {/* Left: task list (only once the project has at least one task) */}
        {showList && (
          <div className={styles.listPane}>
            <div className={styles.list}>
              {tasks.map(task => {
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
        )}

        {/* Right: form + history */}
        <div className={styles.detailPane}>
          <div className={styles.field}>
            <label className={styles.label}>{t('ui.schedule.prompt')}</label>
            <UltraplanPanel
              embedded
              hideHeader
              hideSend
              templates={[{ key: 'none', kind: 'none' }, ...buildExpertList(expertPrefs.experts, expertPrefs.order, expertPrefs.hidden).filter(d => !d.hidden)]}
              variant={draft.template}
              prompt={draft.prompt}
              files={draft.attachments}
              customExperts={expertPrefs.experts}
              expertOrder={expertPrefs.order}
              expertHidden={expertPrefs.hidden}
              placeholder={t('ui.schedule.promptPlaceholder')}
              maxFiles={MAX_ATTACHMENTS}
              onVariantChange={(key) => updateDraft({ template: key })}
              onPromptChange={(text) => updateDraft({ prompt: text })}
              onSend={handleSave}
              onUpload={ultraplan.handleUpload}
              onPaste={ultraplan.handlePaste}
              onRemoveFile={ultraplan.handleRemoveFile}
              onPreviewImage={(img) => setLightbox(img)}
              onOpenCustomEditor={(item) => setCustomEditor({ open: true, item })}
            />
          </div>

          {(spawnAvailable || !isNew) && (
            <div className={styles.field}>
              <div className={styles.modeRow}>
                {spawnAvailable && (
                  <div className={styles.modeGroup}>
                    <label className={styles.label}>{t('ui.schedule.mode')}</label>
                    <Radio.Group
                      value={draft.mode}
                      onChange={e => updateDraft({ mode: e.target.value })}
                    >
                      <Tooltip title={t('ui.schedule.modeInjectHint')}><Radio value="inject">{t('ui.schedule.modeInject')}</Radio></Tooltip>
                      <Tooltip title={t('ui.schedule.modeSpawnHint')}>
                        <Radio value="spawn">{t('ui.schedule.modeSpawn')}</Radio>
                      </Tooltip>
                    </Radio.Group>
                  </div>
                )}
                {/* The enabled switch only matters for existing tasks (pause/resume);
                    a new task always starts enabled, so the control is hidden there. */}
                {!isNew && (
                  <div className={styles.enabledGroup}>
                    <label className={styles.label}>{t('ui.schedule.enabled')}</label>
                    <Switch checked={draft.enabled} onChange={v => updateDraft({ enabled: v })} />
                  </div>
                )}
              </div>
              {spawnAvailable && draft.mode === 'spawn' && (
                <div className={styles.permNote}>{t('ui.schedule.spawnPermNote')}</div>
              )}
            </div>
          )}

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
            {draft.scheduleKind === 'once' && (
              <div className={styles.onceQuickGroup}>
                {ONCE_QUICK_OFFSETS.map(o => (
                  <button
                    key={o.key}
                    type="button"
                    className={styles.onceQuickBtn}
                    onClick={() => updateDraft({ onceAt: dayjs().add(o.minutes, 'minute').startOf('minute') })}
                  >
                    {t(`ui.schedule.quick.${o.key}`)}
                  </button>
                ))}
              </div>
            )}
            {schedule && preview.length > 0 && (
              <div className={styles.scheduleMeta}>
                <span className={styles.nextRun}>{t('ui.schedule.nextRun')}: {formatNextRun(preview[0], tz)}</span>
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <Button type="primary" loading={saving} onClick={handleSave} disabled={(!dirty && !isNew) || !!selectedTask?.legacy || (selectedTask && selectedTask.prompt === undefined)}>
              {t('ui.schedule.save')}
            </Button>
            <Tooltip title={dirty ? t('ui.schedule.runNowDirtyHint') : ''}>
              <Button onClick={handleRunNow} disabled={!canRunNow || !!selectedTask?.legacy}>{t('ui.schedule.runNow')}</Button>
            </Tooltip>
            {!isNew && !selectedTask?.legacy && (
              <Button danger onClick={handleDelete}>{t('ui.schedule.delete')}</Button>
            )}
          </div>

          {/* Run history (only for existing tasks with at least one run) */}
          {!isNew && runs.length > 0 && (
            <div className={styles.history}>
              <div className={styles.historyTitle}>{t('ui.schedule.history')}</div>
              {runs.map(run => (
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
      {/* Custom expert editor (shared with the UltraPlan popover hosts) and the
          attachment preview lightbox — rendered inside the modal tree, lightbox
          zIndex above the antd modal so previews stay on top. */}
      <CustomUltraplanEditModal
        open={customEditor.open}
        initial={customEditor.item}
        onSave={(item) => ultraplan.saveExpert(item)}
        onDelete={(id) => ultraplan.deleteExpert(id)}
        onClose={() => setCustomEditor({ open: false, item: null })}
      />
      {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.alt} zIndex={1100} onClose={() => setLightbox(null)} />}
    </Modal>
  );
}
