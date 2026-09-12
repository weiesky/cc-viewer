/**
 * task-progress-hud.test.js — source contract for the TaskProgressHud
 * collapsed-strip progress dots (and the expanded rows sharing the same
 * TaskStatusDot component).
 *
 * The repo has no JSX transform/jsdom, so — like floating-input-stack.test.js —
 * these are readFileSync source contracts. Every assertion was paired with a
 * deliberately-breaking mutation during authoring and confirmed to FAIL under
 * the mutation (pristine green + mutant red, per the source-contract policy):
 *   1. drop the collapsed-strip <TaskStatusDot> usage (keep only the row one)
 *   2. move the dots span after the chevron
 *   3. swap any two DOT_CLASS entries
 *   4. keep the old Unicode glyph ternary alongside the new dot
 *   5. drop the in_progress-only pulse (or pulse every status)
 *   6. drop aria-hidden from the dots row (pollutes the role=status live region)
 *   7. render the check path unconditionally (all three states get a check)
 *   8. drop overflow: hidden from .dots (long lists break the bar layout)
 *   9. change .dot to 3em (dots blow up the strip)
 *  10. recolor completed dots with --color-success (spec says grey)
 *  11. recolor .dotCheck with currentColor (check invisible against the disc)
 *  12. add a !important anywhere (repo-wide prohibition)
 *  13. delete the prefers-reduced-motion guard
 *  14. drop the all-completed hiding criterion (HUD lingers when done)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'TaskProgressHud.jsx');
const CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'TaskProgressHud.module.css');

const jsx = readFileSync(JSX_PATH, 'utf-8');
const css = readFileSync(CSS_PATH, 'utf-8');

describe('TaskProgressHud progress dots contract', () => {
  it('TaskStatusDot component exists and is used exactly twice (collapsed strip + expanded row)', () => {
    assert.ok(jsx.includes('function TaskStatusDot('), 'TaskStatusDot component defined');
    const usages = jsx.split('<TaskStatusDot').length - 1;
    assert.equal(usages, 2, 'TaskStatusDot used in the collapsed dots row AND in TaskRow');
  });

  it('collapsed strip order: .current → .dots → chevron', () => {
    const iCurrent = jsx.indexOf('styles.current');
    const iDots = jsx.indexOf('styles.dots');
    const iChevron = jsx.indexOf('styles.chevron');
    assert.ok(iCurrent > -1 && iDots > -1 && iChevron > -1, 'all three landmarks present');
    assert.ok(iCurrent < iDots && iDots < iChevron,
      'dots must sit between the current-task label and the chevron');
  });

  it('DOT_CLASS maps each status to its CSS-module class', () => {
    assert.ok(jsx.includes('completed: styles.dotDone'), 'completed → dotDone');
    assert.ok(jsx.includes('in_progress: styles.dotRunning'), 'in_progress → dotRunning');
    assert.ok(jsx.includes('pending: styles.dotPending'), 'pending → dotPending');
  });

  it('old Unicode glyph ternary (✓/●/○) is gone', () => {
    assert.ok(!jsx.includes("task.status === 'completed' ? '✓'"),
      'TaskRow must render TaskStatusDot, not the Unicode glyph ternary');
    assert.ok(!jsx.includes('styles.stateDone') && !jsx.includes('styles.stateRunning') && !jsx.includes('styles.statePending'),
      'old state-color classes must not be referenced anymore');
  });

  it('pulse animation applies to in_progress only', () => {
    assert.ok(jsx.includes("status === 'in_progress' ? ` ${styles.statePulse}` : ''"),
      'statePulse gated on in_progress');
  });

  it('dots row is aria-hidden (decorative; role=status count line is the announcement)', () => {
    assert.ok(jsx.includes('className={styles.dots} aria-hidden="true"'),
      'dots row carries aria-hidden');
  });

  it('check path renders only for completed tasks', () => {
    assert.ok(jsx.includes("{status === 'completed' && ("),
      'check path conditional on completed');
    const condIdx = jsx.indexOf("{status === 'completed' && (");
    const afterCond = jsx.slice(condIdx, condIdx + 200);
    assert.ok(afterCond.includes('<path'), 'path immediately follows the completed condition');
  });

  it('.dots clips overflow and never shrinks the count/current labels first', () => {
    const m = css.match(/\.dots\s*\{([^}]*)\}/);
    assert.ok(m, '.dots rule exists');
    assert.match(m[1], /display:\s*flex/);
    assert.match(m[1], /min-width:\s*0/);
    assert.match(m[1], /overflow:\s*hidden/, 'long task lists must clip, not break the bar');
    assert.match(m[1], /gap:/);
  });

  it('.dot is a sub-em square', () => {
    const m = css.match(/\.dot\s*\{([^}]*)\}/);
    assert.ok(m, '.dot rule exists');
    assert.match(m[1], /width:\s*0\.82em/);
    assert.match(m[1], /height:\s*0\.82em/);
  });

  it('completed dots are grey (spec), and --color-success is gone from the module', () => {
    const m = css.match(/\.dotDone\s*\{([^}]*)\}/);
    assert.ok(m, '.dotDone rule exists');
    assert.match(m[1], /--text-muted/, 'completed dot uses the muted grey token');
    assert.ok(!css.includes('--color-success'),
      'no green success color anywhere in this module (intentional visual change)');
    const run = css.match(/\.dotRunning\s*\{([^}]*)\}/);
    assert.ok(run && run[1].includes('--color-primary'), 'running dot keeps the primary color');
  });

  it('.dotCheck punches the check out in the surface color', () => {
    const m = css.match(/\.dotCheck\s*\{([^}]*)\}/);
    assert.ok(m, '.dotCheck rule exists');
    assert.match(m[1], /stroke:\s*var\(--bg-container\)/,
      'check must contrast against the filled disc in both themes');
    assert.match(m[1], /stroke-width:\s*2\.1/, 'check stroke must stay thick enough to be visible');
  });

  // Visual-spec locks: the user-facing promise of this feature is the SHAPE of
  // each state — completed = FILLED grey disc, running = FILLED primary disc,
  // pending = HOLLOW ring. Deleting any of these fills turns one state into
  // another (completed → indistinguishable from pending), so they are locked
  // independently of the class-name wiring above.
  it('.dotRing is hollow by default (pending state)', () => {
    const m = css.match(/\.dotRing\s*\{([^}]*)\}/);
    assert.ok(m, '.dotRing rule exists');
    assert.match(m[1], /fill:\s*none/, 'base ring must be hollow');
    assert.match(m[1], /stroke:\s*currentColor/);
  });

  it('.dotDone and .dotRunning fill the ring solid (distinguishes them from hollow pending)', () => {
    const done = css.match(/\.dotDone\s+\.dotRing\s*\{([^}]*)\}/);
    assert.ok(done, '.dotDone .dotRing rule exists');
    assert.match(done[1], /fill:\s*var\(--text-muted\)/, 'completed disc must be filled grey');
    const run = css.match(/\.dotRunning\s+\.dotRing\s*\{([^}]*)\}/);
    assert.ok(run, '.dotRunning .dotRing rule exists');
    assert.match(run[1], /fill:\s*currentColor/, 'running disc must be filled');
  });

  it('SVG geometry: circle radius and viewBox produce a ring with a visible hole', () => {
    assert.ok(jsx.includes('viewBox="0 0 16 16"'), 'viewBox 16');
    assert.ok(jsx.includes('r="6.25"'), 'circle radius leaves a ring inside the 16-unit box');
  });

  it('no !important anywhere in the module (excluding comments)', () => {
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!cssNoComments.includes('!important'), 'repo-wide prohibition');
  });

  it('prefers-reduced-motion guard still disables the pulse', () => {
    const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*\{[^}]*\}[^}]*)\}/);
    assert.ok(m, 'reduced-motion block exists');
    assert.match(m[1], /\.statePulse\s*\{\s*animation:\s*none/);
  });

  it('all-completed tasks still hide the HUD', () => {
    assert.ok(jsx.includes("tasks.some(x => x.status !== 'completed')"),
      'visible criterion unchanged');
  });
});
