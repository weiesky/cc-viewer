/**
 * schedule-nav-button.test.js — pure-function tests for the scheduleNav helpers plus
 * source anchors for the sidebar nav wiring. The hosts are React class components /
 * JSX that can't mount in node:test (no JSX transform in this repo), so wiring is
 * verified by reading the source and asserting the chain is intact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pendingTasks, taskPreview, serverClockOffset } from '../src/utils/scheduleNav.js';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const CHAT_VIEW = read('src/components/chat/ChatView.jsx');
const MODAL = read('src/components/common/ScheduleTaskModal.jsx');
const NAV_BUTTON = read('src/components/dashboard/ScheduleNavButton.jsx');
const NAV_CSS = read('src/components/dashboard/ScheduleNavButton.module.css');

// ── pure helpers ────────────────────────────────────────────────────────────

describe('pendingTasks', () => {
  it('keeps only enabled, non-running tasks with a finite nextRunAt', () => {
    const tasks = [
      { id: 'a', enabled: true, nextRunAt: 5000, running: false },   // kept
      { id: 'b', enabled: false, nextRunAt: 1000 },                   // paused — dropped
      { id: 'c', enabled: true, nextRunAt: null },                    // no nextRunAt — dropped
      { id: 'd', enabled: true, nextRunAt: 2000, running: true },     // running — dropped
      { id: 'e', enabled: true, nextRunAt: 3000 },                    // kept
      { id: 'f', enabled: true },                                     // missing nextRunAt — dropped
      { id: 'g', enabled: true, nextRunAt: NaN },                     // non-finite — dropped
    ];
    const out = pendingTasks(tasks);
    assert.deepEqual(out.map((t2) => t2.id), ['e', 'a']);
  });

  it('sorts by nextRunAt ascending', () => {
    const out = pendingTasks([
      { id: 'late', enabled: true, nextRunAt: 9000 },
      { id: 'soon', enabled: true, nextRunAt: 1000 },
      { id: 'mid', enabled: true, nextRunAt: 5000 },
    ]);
    assert.deepEqual(out.map((t2) => t2.id), ['soon', 'mid', 'late']);
  });

  it('returns an empty array for null/undefined/garbage input', () => {
    assert.deepEqual(pendingTasks(null), []);
    assert.deepEqual(pendingTasks(undefined), []);
    assert.deepEqual(pendingTasks('nope'), []);
    assert.deepEqual(pendingTasks([null, undefined, {}]), []);
  });

  it('treats missing enabled as enabled (legacy tasks)', () => {
    const out = pendingTasks([{ id: 'x', nextRunAt: 5000 }]);
    assert.equal(out.length, 1);
  });

  it('does not mutate the input array', () => {
    const input = [
      { id: 'b', enabled: true, nextRunAt: 2000 },
      { id: 'a', enabled: true, nextRunAt: 1000 },
    ];
    const original = [...input];
    pendingTasks(input);
    assert.deepEqual(input, original);
  });

  it('excludes Infinity nextRunAt', () => {
    assert.deepEqual(pendingTasks([{ id: 'x', enabled: true, nextRunAt: Infinity }]), []);
  });
});

describe('taskPreview', () => {
  it('uses promptSummary when present, falls back to prompt', () => {
    assert.equal(taskPreview({ promptSummary: 'sum', prompt: 'full' }), 'sum');
    assert.equal(taskPreview({ prompt: 'full text' }), 'full text');
    assert.equal(taskPreview({ promptSummary: '', prompt: 'full' }), 'full');
  });

  it('takes the first line and truncates to 60 chars', () => {
    assert.equal(taskPreview({ prompt: 'line1\nline2' }), 'line1');
    const long = 'x'.repeat(100);
    assert.equal(taskPreview({ prompt: long }).length, 60);
  });

  it('truncates promptSummary the same way', () => {
    const long = 'y'.repeat(100);
    assert.equal(taskPreview({ promptSummary: long }).length, 60);
    assert.equal(taskPreview({ promptSummary: 'first\nsecond' }), 'first');
  });

  it('falls back to an em dash for empty input', () => {
    assert.equal(taskPreview({}), '—');
    assert.equal(taskPreview(null), '—');
    assert.equal(taskPreview({ prompt: '' }), '—');
  });
});

describe('serverClockOffset', () => {
  it('computes serverTime minus clientNow', () => {
    assert.equal(serverClockOffset(15000, 10000), 5000);
    assert.equal(serverClockOffset(5000, 10000), -5000);
  });

  it('returns 0 when serverTime is missing or non-finite', () => {
    assert.equal(serverClockOffset(undefined), 0);
    assert.equal(serverClockOffset(null), 0);
    assert.equal(serverClockOffset(NaN), 0);
    assert.equal(serverClockOffset('nope'), 0);
  });
});

// ── source anchors ──────────────────────────────────────────────────────────

describe('ScheduleNavButton wiring', () => {
  it('ChatView imports and renders ScheduleNavButton in the nav sidebar', () => {
    assert.ok(/import ScheduleNavButton from '\.\.\/dashboard\/ScheduleNavButton'/.test(CHAT_VIEW), 'imported');
    assert.ok(/<ScheduleNavButton/.test(CHAT_VIEW), 'rendered');
  });

  it('ChatView gates the button on cliMode + !isLocalLog + project, bound to the element', () => {
    // Bound to <ScheduleNavButton so the assertion fails if the gate is removed
    // (the + menu has the same predicate — a bare predicate match would false-pass).
    const gate = CHAT_VIEW.match(/cliMode && !this\.props\.isLocalLog && \(this\.props\.viewProject \|\| this\.props\.projectName\)\s*&&\s*\(\s*<ScheduleNavButton/);
    assert.ok(gate, 'gate predicate bound to ScheduleNavButton element');
  });

  it('ChatView passes initialTaskId to ScheduleTaskModal and clears it on close', () => {
    assert.ok(/initialTaskId=\{this\.state\.scheduleModalTaskId\}/.test(CHAT_VIEW), 'initialTaskId prop passed');
    assert.ok(/scheduleModalVisible: false, scheduleModalTaskId: null/.test(CHAT_VIEW), 'onClose clears both');
    // Anchor the state initializer specifically (not just the onClose line).
    assert.ok(/scheduleModalVisible: false,\s*\n\s*scheduleModalTaskId: null/.test(CHAT_VIEW), 'state initialized');
  });

  it('ChatView onOpenTask sets both visible and task id', () => {
    assert.ok(/scheduleModalVisible: true, scheduleModalTaskId: taskId/.test(CHAT_VIEW), 'onOpenTask sets state');
  });
});

describe('ScheduleTaskModal initialTaskId handling', () => {
  it('accepts initialTaskId prop with a null default', () => {
    assert.ok(/initialTaskId = null/.test(MODAL), 'prop default');
  });

  it('has a live initialTaskIdRef so loadTasks never sees a stale value', () => {
    assert.ok(/initialTaskIdRef = useRef\(initialTaskId\)/.test(MODAL), 'ref declared');
    assert.ok(/initialTaskIdRef\.current = initialTaskId/.test(MODAL), 'ref updated per render');
    assert.ok(/initialTaskIdRef\.current/.test(MODAL), 'ref read in loadTasks');
  });

  it('has a one-shot handledInitialIdRef guard against SSE re-runs', () => {
    assert.ok(/handledInitialIdRef = useRef\(null\)/.test(MODAL), 'ref declared');
    assert.ok(/handledInitialIdRef\.current = initialTaskId/.test(MODAL), 'marked after locate');
    assert.ok(/handledInitialIdRef\.current === initialTaskId/.test(MODAL), 'checked before locate');
  });

  it('resets the guard when the modal closes', () => {
    assert.ok(/!open\) \{ handledInitialIdRef\.current = null/.test(MODAL), 'reset on close');
  });

  it('calls handleSelect(target) after marking the guard', () => {
    assert.ok(/handledInitialIdRef\.current = initialTaskId;\s*\n\s*handleSelect\(target\)/.test(MODAL), 'guard then select');
  });

  it('has a rowRefs Map for scrollIntoView', () => {
    assert.ok(/rowRefs = useRef\(new Map\(\)\)/.test(MODAL), 'ref map declared');
    assert.ok(/rowRefs\.current\.set\(task\.id, el\)/.test(MODAL), 'row ref registered');
    assert.ok(/rowRefs\.current\.delete\(task\.id\)/.test(MODAL), 'row ref cleaned up on unmount');
    assert.ok(/rowRefs\.current\.get\(initialTaskId\)\?\.scrollIntoView/.test(MODAL), 'scrolls to located row');
  });

  it('loadTasks prioritizes initialTaskId over tasks[0] via the ref', () => {
    assert.ok(/initialTaskIdRef\.current/.test(MODAL), 'reads ref not prop');
    assert.ok(/tid && \(data\.tasks \|\| \[\]\)\.some\(t2 => t2\.id === tid\)\) return tid/.test(MODAL), 'ref-based priority branch');
  });

  it('locate effect has eslint-disable for handleSelect dep omission', () => {
    assert.ok(/eslint-disable-next-line react-hooks\/exhaustive-deps/.test(MODAL), 'disable comment present');
  });
});

describe('ScheduleNavButton internals', () => {
  it('fetches and subscribes to scheduled task events', () => {
    assert.ok(/api\/scheduled-tasks/.test(NAV_BUTTON), 'fetches list API');
    assert.ok(/subscribeScheduledTasks/.test(NAV_BUTTON), 'subscribes to SSE');
  });

  it('has a stale-project guard on the response', () => {
    assert.ok(/if \(loadProject !== projectRef\.current\) return/.test(NAV_BUTTON), 'project guard');
  });

  it('returns unsubscribe from the SSE effect', () => {
    assert.ok(/return unsub/.test(NAV_BUTTON), 'cleanup returned');
  });

  it('uses destroyOnHidden (not deprecated destroyTooltipOnHide)', () => {
    assert.ok(/destroyOnHidden/.test(NAV_BUTTON), 'destroy on hidden');
    assert.ok(!/destroyTooltipOnHide/.test(NAV_BUTTON), 'no deprecated prop');
  });

  it('drives countdowns via formatCountdownClock + remainingSeconds', () => {
    assert.ok(/formatCountdownClock/.test(NAV_BUTTON), 'format imported');
    assert.ok(/remainingSeconds/.test(NAV_BUTTON), 'remaining imported');
  });

  it('corrects for server clock skew via serverClockOffset', () => {
    assert.ok(/serverClockOffset/.test(NAV_BUTTON), 'offset helper used');
  });

  it('closes the popover when a row is clicked', () => {
    assert.ok(/setOpen\(false\); onOpenTask/.test(NAV_BUTTON), 'closes before opening modal');
  });

  it('renders nothing when there are no pending tasks', () => {
    assert.ok(/if \(pending\.length === 0\) return null/.test(NAV_BUTTON), 'null render guard');
  });

  it('closes popover when the last pending task disappears', () => {
    assert.ok(/pending\.length === 0 && open\) setOpen\(false\)/.test(NAV_BUTTON), 'auto-close on empty');
  });

  it('uses a time-based cooldown for overdue reloads (not a boolean loop)', () => {
    assert.ok(/lastOverdueReloadRef/.test(NAV_BUTTON), 'timestamp ref');
    assert.ok(/OVERDUE_RELOAD_COOLDOWN_MS/.test(NAV_BUTTON), 'cooldown constant');
    // Must NOT have the old boolean pattern that caused the reload storm.
    assert.ok(!/expiredRef/.test(NAV_BUTTON), 'no boolean expiredRef');
  });

  it('tick is gated on open AND pending.length', () => {
    assert.ok(/!open \|\| pending\.length === 0\) return undefined/.test(NAV_BUTTON), 'tick gate');
  });

  it('reports JSON parse failures via reportSwallowed', () => {
    assert.ok(/reportSwallowed\('schedule-nav\.parse'/.test(NAV_BUTTON), 'parse error reported');
  });

  it('has status dot title for accessibility', () => {
    assert.ok(/title=\{t\(`ui\.schedule\.status\.\$\{st\}`\)\}/.test(NAV_BUTTON), 'status dot title');
  });

  it('has aria-haspopup and aria-expanded on the trigger', () => {
    assert.ok(/aria-haspopup="menu"/.test(NAV_BUTTON), 'haspopup');
    assert.ok(/aria-expanded=\{open\}/.test(NAV_BUTTON), 'expanded');
  });

  it('opens on click as well as hover (keyboard accessible)', () => {
    assert.ok(/trigger=\{\['hover', 'click'\]\}/.test(NAV_BUTTON), 'click trigger');
  });
});

describe('ScheduleNavButton CSS', () => {
  it('has no !important', () => {
    const stripped = NAV_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/!important/.test(stripped), 'no !important outside comments');
  });

  it('has all required classes', () => {
    for (const cls of ['.stPopover', '.stPopoverItem', '.stPopoverTitle', '.stTaskName', '.stCountdown', '.stNavBtn']) {
      assert.ok(NAV_CSS.includes(cls), `${cls} present`);
    }
  });

  it('has status dot classes for every deriveTaskUiStatus value', () => {
    for (const st of ['active', 'running', 'paused', 'completed', 'error']) {
      assert.ok(NAV_CSS.includes(`.stStatus_${st}`), `.stStatus_${st} present`);
    }
  });

  it('uses --bg-surface for hover (visible against --bg-elevated body)', () => {
    assert.ok(/\.stPopoverItem:hover\s*\{\s*background:\s*var\(--bg-surface\)/.test(NAV_CSS), 'visible hover bg');
  });

  it('constrains ScheduleIcon size', () => {
    assert.ok(/\.stNavBtn svg/.test(NAV_CSS), 'icon sizing rule');
    assert.ok(/width:\s*20px/.test(NAV_CSS), 'icon width');
    assert.ok(/height:\s*20px/.test(NAV_CSS), 'icon height');
  });

  it('has tabular-nums and min-width for countdown stability', () => {
    assert.ok(/font-variant-numeric:\s*tabular-nums/.test(NAV_CSS), 'tabular-nums');
    assert.ok(/min-width:\s*56px/.test(NAV_CSS), 'countdown min-width');
  });
});
