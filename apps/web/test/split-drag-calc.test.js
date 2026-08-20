// Unit tests for src/utils/splitDragCalc.js — the pure snap/clamp geometry
// extracted from ChatView's terminal/sidebar drag handlers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTerminalSnapLines,
  computeSidebarSnapLines,
  clampTerminalWidth,
  clampSidebarWidth,
  findActiveSnapLine,
  TERMINAL_CHAR_WIDTH,
  RESIZER_WIDTH_PX,
  SNAP_THRESHOLD_PX,
} from '../src/utils/splitDragCalc.js';

describe('computeTerminalSnapLines', () => {
  it('produces one line per standard column count inside the 15%-75% band', () => {
    // 1400px container: 60col=468px..120col=936px (+5 resizer) all within 210..1050.
    const lines = computeTerminalSnapLines(1400);
    assert.deepEqual(lines.map(l => l.cols), [60, 80, 100, 120]);
    for (const l of lines) {
      assert.equal(l.terminalPx, l.cols * TERMINAL_CHAR_WIDTH);
      assert.equal(l.linePosition, 1400 - l.terminalPx - RESIZER_WIDTH_PX);
    }
  });

  it('drops lines wider than 75% of the container (narrow container)', () => {
    // 800px container: 75% = 600px → 80col(624+5) and above are dropped.
    const lines = computeTerminalSnapLines(800);
    assert.deepEqual(lines.map(l => l.cols), [60]);
  });

  it('drops lines narrower than 15% of the container (huge container)', () => {
    // 4000px container: 15% = 600px → 60col(468+5=473) is dropped, 80col(629) kept.
    const lines = computeTerminalSnapLines(4000);
    assert.deepEqual(lines.map(l => l.cols), [80, 100, 120]);
  });

  it('returns [] for zero/absent container width', () => {
    assert.deepEqual(computeTerminalSnapLines(0), []);
    assert.deepEqual(computeTerminalSnapLines(undefined), []);
  });
});

describe('computeSidebarSnapLines', () => {
  it('keeps only widths under 40% of the container, in legacy line shape', () => {
    // 700px container: 40% = 280 → 180, 240 kept; 300, 360 dropped.
    const lines = computeSidebarSnapLines(700);
    assert.deepEqual(lines, [
      { cols: 180, terminalPx: 180, linePosition: 180 },
      { cols: 240, terminalPx: 240, linePosition: 240 },
    ]);
  });

  it('returns [] when nothing fits or the container width is missing', () => {
    assert.deepEqual(computeSidebarSnapLines(400), []); // 40% = 160 < 180
    assert.deepEqual(computeSidebarSnapLines(0), []);
  });
});

describe('clamps', () => {
  it('clampTerminalWidth anchors to the right edge within 200px..75%', () => {
    assert.equal(clampTerminalWidth(1400, 900, 1400), 500); // free drag
    assert.equal(clampTerminalWidth(1400, 1350, 1400), 200); // floor
    assert.equal(clampTerminalWidth(1400, 0, 1400), 1050); // 75% ceiling
  });

  it('clampSidebarWidth anchors to the left edge within 160px..40%', () => {
    assert.equal(clampSidebarWidth(300, 0, 1000), 300); // free drag
    assert.equal(clampSidebarWidth(50, 0, 1000), 160); // floor
    assert.equal(clampSidebarWidth(900, 0, 1000), 400); // 40% ceiling
  });
});

describe('findActiveSnapLine', () => {
  const lines = [
    { cols: 60, terminalPx: 468, linePosition: 927 },
    { cols: 80, terminalPx: 624, linePosition: 771 },
  ];

  it('returns the nearest line when within the threshold', () => {
    assert.equal(findActiveSnapLine(920, lines).cols, 60);
    assert.equal(findActiveSnapLine(800, lines).cols, 80);
  });

  it('returns null when the nearest line is at or beyond the threshold', () => {
    // Nearest to 700 is 771 (distance 71 >= 60).
    assert.equal(findActiveSnapLine(700, lines), null);
    // Exactly at the threshold is NOT a snap (strict <, matching the old code).
    assert.equal(findActiveSnapLine(927 - SNAP_THRESHOLD_PX, lines), null);
    assert.notEqual(findActiveSnapLine(927 - SNAP_THRESHOLD_PX + 1, lines), null);
  });

  it('returns null for an empty or missing line list', () => {
    assert.equal(findActiveSnapLine(500, []), null);
    assert.equal(findActiveSnapLine(500, null), null);
  });
});
