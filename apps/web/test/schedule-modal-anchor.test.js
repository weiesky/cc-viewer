/**
 * schedule-modal-anchor.test.js — source anchors for the scheduled-task menu entry and
 * modal wiring. The hosts are React class components that can't mount in node:test, so
 * these read the source and fail loudly if a future refactor drops a link in the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const CHAT_INPUT = read('src/components/chat/ChatInputBar.jsx');
const TERMINAL_PANEL = read('src/components/terminal/TerminalPanel.jsx');
const CHAT_VIEW = read('src/components/chat/ChatView.jsx');
const APP_BASE = read('src/AppBase.jsx');
const MODAL = read('src/components/common/ScheduleTaskModal.jsx');
const MODAL_CSS = read('src/components/common/ScheduleTaskModal.module.css');

describe('scheduled-task (+) menu entry', () => {
  it('ChatInputBar accepts onOpenScheduleModal and renders a desktop row', () => {
    assert.ok(/onOpenScheduleModal/.test(CHAT_INPUT), 'prop accepted');
    const desktopRow = CHAT_INPUT.match(/onOpenScheduleModal && \([\s\S]{0,400}?ui\.schedule\.menuItem[\s\S]{0,400}?\)/);
    assert.ok(desktopRow, 'desktop row gated on onOpenScheduleModal');
    assert.ok(/ScheduleIcon/.test(CHAT_INPUT), 'ScheduleIcon used');
    // The row collapses any open cascade on hover (review P2-1).
    assert.ok(/qmHover\.cancel\(\)/.test(CHAT_INPUT));
  });

  it('ChatInputBar renders a mobile flat-menu row too', () => {
    assert.ok(/styles\.plusMenuItem[\s\S]{0,200}?onOpenScheduleModal/.test(CHAT_INPUT) || /onOpenScheduleModal[\s\S]{0,300}?styles\.plusMenuItem/.test(CHAT_INPUT), 'mobile row present');
  });

  it('TerminalPanel has scheduleModalVisible state + a menu row + the modal', () => {
    assert.ok(/scheduleModalVisible: false/.test(TERMINAL_PANEL), 'state declared');
    assert.ok(/scheduleModalVisible: true/.test(TERMINAL_PANEL), 'menu row sets it');
    assert.ok(/<ScheduleTaskModal/.test(TERMINAL_PANEL), 'modal rendered');
    assert.ok(/import ScheduleTaskModal from '\.\.\/common\/ScheduleTaskModal'/.test(TERMINAL_PANEL), 'shared component imported from common/');
  });

  it('ChatView holds scheduleModalVisible state, gates the entry, and renders the modal', () => {
    assert.ok(/scheduleModalVisible: false/.test(CHAT_VIEW), 'state declared');
    // Entry gate requires a resolvable project (review P1-6).
    assert.ok(/onOpenScheduleModal=\{[\s\S]{0,200}viewProject \|\| this\.props\.projectName[\s\S]{0,200}\}/.test(CHAT_VIEW), 'entry gated on project resolvable');
    assert.ok(/<ScheduleTaskModal/.test(CHAT_VIEW), 'modal rendered');
  });

  it('AppBase registers the scheduled_tasks SSE handler with a project scope guard', () => {
    assert.ok(/'scheduled_tasks': '_onScheduledTasks'/.test(APP_BASE), 'frame handler mapped');
    assert.ok(/_onScheduledTasks\(channel, event\)/.test(APP_BASE), 'handler defined');
    // review P1-2: the project guard runs before toasting/publishing. Assert the guard
    // markers appear within the handler (bounded by the next top-level handler comment).
    const start = APP_BASE.indexOf('_onScheduledTasks(channel, event)');
    const end = APP_BASE.indexOf('_onTurnActive(channel', start);
    const handler = APP_BASE.slice(start, end > start ? end : start + 2500);
    assert.ok(/data && data\.project/.test(handler), 'reads data.project');
    assert.ok(/channel\.scope/.test(handler) && /project/.test(handler), 'project scope guard present');
    assert.ok(/publishScheduledTaskEvent/.test(handler), 'publishes to modal subscribers');
  });
});

describe('ScheduleTaskModal component', () => {
  it('uses all 7 scheduled-task endpoints', () => {
    for (const ep of [
      '/api/scheduled-tasks',
      '/api/scheduled-tasks/update',
      '/api/scheduled-tasks/delete',
      '/api/scheduled-tasks/run',
      '/api/scheduled-tasks/preview',
      '/api/scheduled-tasks/runs',
    ]) {
      assert.ok(MODAL.includes(ep), `endpoint ${ep} referenced`);
    }
  });

  it('hides the run-mode radios entirely when spawn is unavailable (PTY mode)', () => {
    assert.ok(!/disabled=\{!spawnAvailable\}/.test(MODAL), 'no disabled spawn radio remains');
    assert.ok(/\{spawnAvailable && \([\s\S]{0,400}ui\.schedule\.mode['"]/.test(MODAL), 'mode group gated on spawnAvailable');
    assert.ok(/!spawnAvailable && isNew && draft\.mode !== 'inject'/.test(MODAL), 'leftover spawn mode normalized to inject (new drafts only)');
  });

  it('routes "open session" through onResumeSession, not a raw fetch (P1-1)', () => {
    assert.ok(/onResumeSession\(\{ sessionUuid/.test(MODAL), 'reuses the AppBase resume flow');
    assert.ok(!/fetch\(apiUrl\('\/api\/resume-session/.test(MODAL), 'no raw resume-session fetch');
  });

  it('aborts in-flight preview on cleanup and guards preview by sequence (P2-4)', () => {
    assert.ok(/previewAbort\.current\?\.abort\(\)/.test(MODAL), 'abort on cleanup');
    assert.ok(/previewSeq/.test(MODAL), 'sequence guard present');
  });

  it('CSS uses no !important (repo rule)', () => {
    assert.ok(!/!important/.test(MODAL_CSS), 'no !important in ScheduleTaskModal.module.css');
  });

  it('schedules are formatted with the server timezone (P1-5)', () => {
    assert.ok(/formatNextRun\([^,]+, (tz|serverTimezone)\)/.test(MODAL), 'list/history use server timezone');
  });

  it('uses a localized title without the project suffix and moves New task beside it', () => {
    const titleStart = MODAL.indexOf('title={(');
    const titleEnd = MODAL.indexOf('open={open}', titleStart);
    assert.ok(titleStart > -1 && titleEnd > titleStart, 'Modal title is a JSX node');
    const title = MODAL.slice(titleStart, titleEnd);
    assert.ok(/t\('ui\.schedule\.title'\)/.test(title), 'localized schedule title present');
    assert.ok(!/\$\{project\}/.test(title), 'title does not interpolate project');
    assert.ok(/showList &&[\s\S]{0,300}ui\.schedule\.newTask/.test(title), 'New task button is gated beside the title');
  });

  it('hides the task list and old empty-state controls until tasks exist', () => {
    assert.ok(/const showList = tasks\.length > 0;/.test(MODAL), 'showList derives from tasks');
    assert.ok(/\{showList && \(\s*<div className=\{styles\.listPane\}/.test(MODAL), 'list pane gated by showList');
    assert.ok(!/styles\.listHeader/.test(MODAL), 'old list header button container removed');
    assert.ok(!/ui\.schedule\.empty/.test(MODAL), 'zero-task inline empty hint removed');
  });

  it('keeps schedule warnings submit-only and removes the inline "None" row', () => {
    assert.ok(!/ui\.schedule\.nextRunNone/.test(MODAL), 'modal no longer renders nextRunNone');
    assert.ok(!/ui\.schedule\.previewInvalid/.test(MODAL), 'modal no longer renders previewInvalid inline');
    assert.ok(/schedule && preview\.length > 0[\s\S]{0,300}ui\.schedule\.nextRun/.test(MODAL), 'next-run preview still renders when available');
    const save = MODAL.match(/const handleSave = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/);
    assert.ok(save, 'handleSave body located');
    assert.ok(save[1].indexOf("ui.schedule.error.invalid_prompt") > -1, 'prompt validation remains');
    assert.ok(save[1].indexOf("ui.schedule.error.invalid_schedule") > -1, 'schedule validation uses submit error');
    assert.ok(save[1].indexOf("ui.schedule.error.invalid_prompt") < save[1].indexOf("ui.schedule.error.invalid_schedule"), 'prompt validation runs before schedule validation');
  });

  it('treats an empty cron expression as an invalid schedule before preview/save', () => {
    assert.ok(/const expr = draft\.cronExpr\.trim\(\);\s*return expr \? \{ kind: 'cron', expr \} : null;/.test(MODAL), 'empty cron returns null');
  });

  it('drops scheduled-task responses from a previous project', () => {
    assert.ok(/const loadProject = project;/.test(MODAL), 'loadTasks captures the requested project');
    assert.ok(/projectRef\.current/.test(MODAL), 'guard compares against the live project ref');
    assert.ok(/if \(loadProject !== projectRef\.current\) return;/.test(MODAL), 'stale project responses are ignored');
  });

  it('keeps "new task" mode sticky across list reloads (no auto re-select)', () => {
    assert.ok(/newTaskMode\.current = true;[\s\S]{0,200}setSelectedId\(null\)/.test(MODAL), 'handleNew marks new-task mode');
    assert.ok(/if \(newTaskMode\.current\) return null;/.test(MODAL), 'loadTasks does not re-select tasks[0] in new-task mode');
    assert.ok(/newTaskMode\.current = false;[\s\S]{0,200}setSelectedId\(task \? task\.id : null\)/.test(MODAL), 'handleSelect clears new-task mode');
  });

  it('hides the enabled switch for a new task and shows it when editing', () => {
    assert.ok(/\{!isNew && \([\s\S]{0,200}ui\.schedule\.enabled/.test(MODAL), 'enabled switch gated on !isNew');
    assert.ok(/\{\(spawnAvailable \|\| !isNew\) && \(/.test(MODAL), 'whole field hidden for new tasks in PTY mode');
  });

  it('never overwrites an existing task mode when the control is hidden (PTY)', () => {
    assert.ok(/if \(spawnAvailable\) updateBody\.mode = draft\.mode/.test(MODAL), 'update payload omits mode when hidden');
    assert.ok(/if \(!spawnAvailable && isNew && draft\.mode !== 'inject'\)/.test(MODAL), 'mode normalization only applies to a NEW draft');
  });

  it('hides the run-history block until an existing task has runs', () => {
    assert.ok(/\{!isNew && runs\.length > 0 && \(/.test(MODAL), 'history gated on existing task with runs');
    assert.ok(!/ui\.schedule\.historyEmpty/.test(MODAL), 'empty-history hint removed');
  });

  it('legacy (read-only) tasks disable save/run/delete', () => {
    assert.ok(/selectedTask\?\.legacy/.test(MODAL), 'legacy flag consulted');
    assert.ok(/disabled=\{!canRunNow \|\| !!selectedTask\?\.legacy\}/.test(MODAL), 'run disabled for legacy');
    assert.ok(/\{!isNew && !selectedTask\?\.legacy && \(/.test(MODAL), 'delete hidden for legacy');
  });

  it('title row CSS supports wrapping and removes dead list styles', () => {
    assert.ok(/\.titleRow\s*\{[\s\S]{0,200}flex-wrap: wrap/.test(MODAL_CSS), 'title row can wrap');
    assert.ok(!/\.listHeader\s*\{/.test(MODAL_CSS), 'listHeader style removed');
    assert.ok(!/\.muted\s*\{/.test(MODAL_CSS), 'muted style removed');
  });
});
