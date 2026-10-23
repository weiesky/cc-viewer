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

  it('disables spawn when spawnAvailable is false', () => {
    assert.ok(/disabled=\{!spawnAvailable\}/.test(MODAL), 'spawn radio disabled without spawnAvailable');
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
});
