/**
 * Unit tests for the avatar animation loading strategy helpers in
 * src/utils/teammateAvatars.js: stripSvgAnimations (static variant),
 * the { animated } option of getTeammateAvatar, shouldAnimateTeammateAvatar
 * (60s window policy), and pickAvatarAnimationTargets (buildAllItems scan).
 *
 * Note: the _shims loader stubs .svg?raw imports as plain strings without
 * <animate> markup, so real strip behavior is covered via the pure helper
 * with literal SVG strings; getTeammateAvatar option behavior is covered as
 * pass-through + reference stability.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let getTeammateAvatar, stripSvgAnimations, shouldAnimateTeammateAvatar, pickAvatarAnimationTargets;

before(async () => {
  const m = await import('../src/utils/teammateAvatars.js');
  getTeammateAvatar = m.getTeammateAvatar;
  stripSvgAnimations = m.stripSvgAnimations;
  shouldAnimateTeammateAvatar = m.shouldAnimateTeammateAvatar;
  pickAvatarAnimationTargets = m.pickAvatarAnimationTargets;
});

const ANIMATED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<path d="M1 1L2 2" fill="#111" stroke="#222" stroke-width="2.5" pathLength="1" stroke-dasharray="1">'
  + '<animate attributeName="stroke-dashoffset" values="1.01;0" keyTimes="0;1" dur="0.4s" begin="0s" fill="freeze"/></path>'
  + '<path d="M3 3L4 4" fill="#333">'
  + '<animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="0.8s" begin="0s" fill="freeze"/></path>'
  + '</svg>';

describe('stripSvgAnimations', () => {
  it('removes every <animate .../> element and keeps paths/attributes intact', () => {
    const out = stripSvgAnimations(ANIMATED_SVG);
    assert.ok(!out.includes('<animate'));
    assert.ok(out.includes('d="M1 1L2 2"'));
    assert.ok(out.includes('stroke-dasharray="1"'));
    assert.ok(out.includes('fill="#333"'));
    assert.equal((out.match(/<path/g) || []).length, 2);
    assert.equal((out.match(/<\/path>/g) || []).length, 2);
  });

  it('leaves animation-free strings unchanged and is idempotent', () => {
    const staticSvg = '<svg viewBox="0 0 100 100"><path d="M1 1" fill="#111"/></svg>';
    assert.equal(stripSvgAnimations(staticSvg), staticSvg);
    const once = stripSvgAnimations(ANIMATED_SVG);
    assert.equal(stripSvgAnimations(once), once);
  });
});

describe('getTeammateAvatar { animated } option', () => {
  it('keeps the legacy return shape and behavior when animated (default)', () => {
    const legacy = getTeammateAvatar('researcher-1');
    const explicit = getTeammateAvatar('researcher-1', { animated: true });
    assert.deepEqual(Object.keys(legacy).sort(), ['color', 'role', 'svg']);
    assert.deepEqual(explicit, legacy);
  });

  it('returns the same cached static string for same-role names (animated: false)', () => {
    const a = getTeammateAvatar('researcher-1', { animated: false });
    const b = getTeammateAvatar('researcher-2', { animated: false });
    assert.deepEqual(Object.keys(a).sort(), ['color', 'role', 'svg']);
    assert.ok(!a.svg.includes('<animate'));
    // Same role resolved for both names -> the cached static string is shared.
    assert.equal(a.role, b.role);
    assert.equal(a.svg, b.svg);
  });
});

describe('shouldAnimateTeammateAvatar', () => {
  const T0 = '2026-07-04T12:00:00.000Z';
  const at = (deltaMs) => new Date(Date.parse(T0) + deltaMs).toISOString();

  it('animates inside the window and at the exact boundary', () => {
    assert.equal(shouldAnimateTeammateAvatar(at(-30_000), T0), true);
    assert.equal(shouldAnimateTeammateAvatar(at(-60_000), T0), true);
    assert.equal(shouldAnimateTeammateAvatar(T0, T0), true);
  });

  it('does not animate outside the window', () => {
    assert.equal(shouldAnimateTeammateAvatar(at(-60_001), T0), false);
    assert.equal(shouldAnimateTeammateAvatar(at(-3_600_000), T0), false);
  });

  it('animates when the message is newer than latest (clock skew)', () => {
    assert.equal(shouldAnimateTeammateAvatar(at(5_000), T0), true);
  });

  it('defaults to animate on missing or invalid timestamps', () => {
    assert.equal(shouldAnimateTeammateAvatar(undefined, T0), true);
    assert.equal(shouldAnimateTeammateAvatar(T0, undefined), true);
    assert.equal(shouldAnimateTeammateAvatar('not-a-date', T0), true);
  });

  it('honors a custom window', () => {
    assert.equal(shouldAnimateTeammateAvatar(at(-90_000), T0, 120_000), true);
    assert.equal(shouldAnimateTeammateAvatar(at(-90_000), T0, 30_000), false);
  });

  it('accepts epoch-ms numbers for either side', () => {
    assert.equal(shouldAnimateTeammateAvatar(Date.parse(T0) - 10_000, Date.parse(T0)), true);
    assert.equal(shouldAnimateTeammateAvatar(at(-120_000), Date.parse(T0)), false);
  });
});

describe('pickAvatarAnimationTargets', () => {
  const iso = (s) => `2026-07-04T12:00:${s}.000Z`;

  it('finds the max timestamp and the last teammate row', () => {
    const { latestMs, newestTeammateIdx } = pickAvatarAnimationTargets([
      { ts: iso('01'), isTeammateAvatar: true },
      { ts: iso('05'), isTeammateAvatar: false },
      { ts: iso('03'), isTeammateAvatar: true },
    ]);
    assert.equal(latestMs, Date.parse(iso('05')));
    assert.equal(newestTeammateIdx, 2);
  });

  it('skips unparseable timestamps in the max and handles missing teammates', () => {
    const r1 = pickAvatarAnimationTargets([
      { ts: undefined, isTeammateAvatar: false },
      { ts: iso('02'), isTeammateAvatar: false },
      { ts: 'garbage', isTeammateAvatar: false },
    ]);
    assert.equal(r1.latestMs, Date.parse(iso('02')));
    assert.equal(r1.newestTeammateIdx, -1);
  });

  it('returns NaN latest and -1 index for empty input', () => {
    const r = pickAvatarAnimationTargets([]);
    assert.ok(Number.isNaN(r.latestMs));
    assert.equal(r.newestTeammateIdx, -1);
  });
});
