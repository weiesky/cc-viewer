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
 *  15. restore any native title= on a trigger (any attribute order), or delete
 *     a Tooltip/Popover JSX usage while keeping the import
 *  16. neuter .detailContent (drop pre-line, max-height: none, or drop the
 *     overflow-y) or remove the Popover open-guard for empty details
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

// Strip Tooltip/Popover opening tags so their own title prop is not counted by
// the native-title guard below. JSX attribute values can contain '>' inside
// braces (e.g. `{detail}</div>`), so tag scanning must track brace depth.
function stripOverlayTags(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const m = /^<(Tooltip|Popover)\b/.exec(src.slice(i));
    if (!m) { out += src[i]; i++; continue; }
    let j = i + m[0].length, depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    i = j + 1; out += ' ';
  }
  return out;
}

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

  it('antd Popover/Tooltip replace the native title tooltips', () => {
    assert.ok(jsx.includes("from 'antd'"), 'antd import present');
    assert.equal((jsx.match(/<Popover\b/g) || []).length, 2, 'two Popovers (row detail + collapsed current detail)');
    assert.equal((jsx.match(/<Tooltip\b/g) || []).length, 3, 'three Tooltips (doing/owner/chevron)');
    // After stripping the overlay tags (whose own title prop is legitimate),
    // no native title= may remain on any trigger element.
    assert.equal((stripOverlayTags(jsx).match(/\btitle=/g) || []).length, 0,
      'no native title= left on any trigger');
  });

  it('collapsed current bubble shows the task DETAIL, not a repeat of the title', () => {
    // The header Popover must be fed currentDetail (the task description), and
    // that derives from the task's description — not the visible `current` title.
    assert.ok(jsx.includes('content={<div className={styles.detailContent}>{currentDetail}</div>}'),
      'header Popover renders currentDetail in the detail container');
    assert.ok(jsx.includes('const currentDetail = currentTask ? (currentTask.description'),
      'currentDetail derives from the task description');
    assert.ok(jsx.includes('open={currentDetail ? undefined : false}'),
      'empty current detail never opens a bubble');
  });

  it('long detail renders inside a scrollable Popover content container', () => {
    assert.ok(jsx.includes('styles.detailContent'), 'Popover content uses detailContent class');
    assert.ok(jsx.includes('open={detail ? undefined : false}'),
      'empty detail never opens a bubble');
    assert.ok(jsx.includes('styles={{ body: DETAIL_POPOVER_STYLE }}'),
      'uses the non-deprecated styles.body API (not overlayInnerStyle)');
    // Placement contracts: both the row Popover and the collapsed-strip current
    // bubble use rightTop — bubble to the RIGHT of the text with its LEFT arrow at
    // the text, top-aligned so it stays clear of the row's trailing .doing/owner/
    // status (a plain "right" was measured to overlap .doing). Match the JSX
    // attribute at line start (indentation) so prose comments don't count.
    assert.equal((jsx.match(/^\s+placement="rightTop"/gm) || []).length, 2,
      'row Popover and collapsed current bubble both use rightTop (right side, left arrow, top-aligned)');
    const m = css.match(/\.detailContent\s*\{([^}]*)\}/);
    assert.ok(m, '.detailContent rule exists');
    assert.match(m[1], /white-space:\s*pre-line/, 'model-authored newlines preserved');
    assert.match(m[1], /max-height:\s*\d/, 'huge descriptions are height-capped');
    assert.match(m[1], /overflow-y:\s*auto/, 'long detail scrolls instead of covering the screen');
  });

  it('label shrinks to the text width so the Popover anchors to the blue text, not the full row', () => {
    const m = css.match(/\.label\s*\{([^}]*)\}/);
    assert.ok(m, '.label rule exists');
    // flex: 0 1 auto = shrink-to-fit text, may ellipsize, never grows to fill the
    // row. If this regresses to flex-grow (e.g. 1 1 auto), the bubble anchors to
    // the whole row block and its arrow stops tracking the text end.
    assert.match(m[1], /flex:\s*0\s+1\s+auto/, 'label is shrink-to-fit, not full-row');
    assert.ok(!/flex:\s*1\s+1/.test(m[1]), 'label must not flex-grow across the row');
  });

  it('collapsed current shrinks to the text width so the Tooltip arrow lands on the text', () => {
    const m = css.match(/\.current\s*\{([^}]*)\}/);
    assert.ok(m, '.current rule exists');
    // Same shrink-to-fit contract as .label: pointAtCenter centers on the
    // element, so a full-row span would push the arrow to the screen middle.
    assert.match(m[1], /flex:\s*0\s+1\s+auto/, 'current is shrink-to-fit, not full-row');
    assert.ok(!/flex:\s*1\s+1/.test(m[1]), 'current must not flex-grow across the strip');
  });

  it('.doing stays right-aligned after .label stopped flex-growing', () => {
    // .label is now shrink-to-fit (for the Popover anchor), so without
    // margin-left:auto the doing chip would hug the label text instead of the
    // cell's right edge. Lock the compensating margin. Strip comments first —
    // the rationale text itself mentions `margin-left:auto`.
    const m = css.match(/\.doing\s*\{([^}]*)\}/);
    assert.ok(m, '.doing rule exists');
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(body, /margin-left:\s*auto/, 'doing chip pinned to the cell right edge');
  });

  it('a spacer between current and dots right-aligns the dots + chevron', () => {
    // .current no longer flex-grows, so without an elastic spacer the dots and
    // chevron collapse onto the text instead of sitting at the right edge.
    assert.ok(jsx.includes('styles.spacer'), 'spacer element rendered');
    const iCurrent = jsx.indexOf('styles.current');
    const iSpacer = jsx.indexOf('styles.spacer');
    const iDots = jsx.indexOf('styles.dots');
    assert.ok(iCurrent > -1 && iSpacer > -1 && iDots > -1, 'all three landmarks present');
    assert.ok(iCurrent < iSpacer && iSpacer < iDots, 'spacer sits between current and dots');
    const m = css.match(/\.spacer\s*\{([^}]*)\}/);
    assert.ok(m, '.spacer rule exists');
    assert.match(m[1], /flex:\s*1\s+1\s+auto/, 'spacer absorbs the freed row width');
  });
});
