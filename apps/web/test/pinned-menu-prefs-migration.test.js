/**
 * Source-contract tests for the pinned-menu persistence migration (2026-10):
 * the hamburger menu's pinned keys moved from localStorage (`ccv_pinnedMenuKeys`,
 * a JSON string) to server-side preferences.json (`pinnedMenuKeys`, a real array)
 * via the /api/preferences channel.
 *
 * The contract under test (AppHeader.jsx wiring, asserted via source regex — the
 * established pattern for class components in this repo, see
 * git-changes-open-persist.test.js / resume-history-menu.test.js):
 *   - constructor takes (props, context) and seeds pinnedKeys via initialPinnedKeys —
 *     an already-loaded preferences array wins; anything else starts EMPTY (no legacy
 *     seed: a stale seed could be POSTed over a newer server value, or reverted by a
 *     late initial GET through the componentDidUpdate sync channel),
 *   - componentDidMount subscribes _prefsReady → _hydratePinnedKeys, which guards on the
 *     logDir stamp (GET-failure payloads lack it), respects the _pinnedTouched latch,
 *     routes the migration POST through _persistQueue, and clears the legacy key as soon
 *     as the server holds an authoritative array (or after the migration POST succeeds),
 *   - togglePin persists in the setState commit callback through _queuePersistPinnedKeys
 *     (serialized POSTs — the server applies whole-array LWW, so races would drop pins),
 *   - componentDidUpdate re-syncs pins from props.preferences with a sameKeys content
 *     guard, gated by _prefsHydrated once the user has toggled before the hydrate,
 *   - the sCU whitelist covers nextProps.preferences,
 *   - no direct localStorage.setItem(PINNED_KEY) write remains (the preferences channel is
 *     the only writer; the legacy key is read once for migration and then removed).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appHeaderSrc = readFileSync(join(here, '../src/components/dashboard/AppHeader.jsx'), 'utf8');

describe('pinned-menu preferences migration (source contract)', () => {
  it('imports resolvePinnedKeys from utils/pinnedMenu', () => {
    assert.match(appHeaderSrc, /import\s*\{[^}]*\bresolvePinnedKeys\b[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/pinnedMenu'/);
  });

  it('constructor takes (props, context) and seeds pinnedKeys via initialPinnedKeys(context)', () => {
    assert.match(appHeaderSrc, /constructor\(props,\s*context\)\s*\{/);
    assert.match(appHeaderSrc, /pinnedKeys:\s*initialPinnedKeys\(context\)/);
  });

  it('componentDidMount subscribes _prefsReady → _hydratePinnedKeys', () => {
    assert.match(appHeaderSrc, /this\.context\._prefsReady\.then\(this\._hydratePinnedKeys\)/);
  });

  it('_hydratePinnedKeys guards on the logDir stamp and the _pinnedTouched latch', () => {
    const m = appHeaderSrc.match(/_hydratePinnedKeys\s*=\s*\(data\)\s*=>\s*\{[\s\S]*?\n  \};/);
    assert.ok(m, '_hydratePinnedKeys located');
    assert.match(m[0], /typeof data\.logDir !== 'string'\)\s*return/, 'must bail when the GET failed (no logDir stamp)');
    assert.match(m[0], /!this\._pinnedTouched/, 'must respect the user-touched latch');
    // Migration POST must go through _persistQueue so it can never race an in-flight toggle.
    assert.match(m[0], /this\._persistQueue\s*=\s*this\._persistQueue\.catch\(\(\)\s*=>\s*null\)\.then/, 'migration POST must be serialized through the queue');
    assert.match(m[0], /if \(resp\) clearLegacyPinnedRaw\(\)/, 'legacy key cleared after a successful migration POST');
    // An already-authoritative server array clears the legacy key immediately (dead data).
    assert.match(m[0], /else if \(Array\.isArray\(data\.pinnedMenuKeys\)\)\s*\{\s*clearLegacyPinnedRaw\(\)/);
  });

  it('togglePin persists in the setState commit callback via the serialized queue', () => {
    const m = appHeaderSrc.match(/togglePin\s*=\s*\(key\)\s*=>\s*\{[\s\S]*?\n  \};/);
    assert.ok(m, 'togglePin located');
    assert.match(m[0], /\(\)\s*=>\s*\{[\s\S]*?this\._queuePersistPinnedKeys\(this\.state\.pinnedKeys\)/, 'persistence must live in the commit callback');
    assert.match(appHeaderSrc, /_queuePersistPinnedKeys\(keys\)\s*\{[\s\S]*?this\._persistQueue\s*=\s*this\._persistQueue\.catch\(\(\)\s*=>\s*null\)\.then/, 'POSTs must be serialized through _persistQueue (self-healing chain)');
  });

  it('componentDidUpdate re-syncs pins from props.preferences with a sameKeys content guard', () => {
    const m = appHeaderSrc.match(/componentDidUpdate\(prevProps\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(m, 'componentDidUpdate located');
    assert.match(m[0], /prevProps\.preferences !== this\.props\.preferences/);
    assert.match(m[0], /!sameKeys\(keys, this\.state\.pinnedKeys\)/, 'must content-compare before setState (no update loop)');
    // Once the user has toggled before the hydrate, a late initial-GET payload must not
    // revert their action — the sync channel is gated on _prefsHydrated.
    assert.match(m[0], /this\._prefsHydrated/, 'sync channel must respect the pre-hydrate toggle latch');
  });

  it('sCU whitelist covers nextProps.preferences', () => {
    const m = appHeaderSrc.match(/shouldComponentUpdate\(nextProps, nextState\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(m, 'shouldComponentUpdate located');
    assert.match(m[0], /nextProps\.preferences !== this\.props\.preferences/);
  });

  it('no direct localStorage.setItem(PINNED_KEY) write remains', () => {
    assert.ok(!appHeaderSrc.includes('localStorage.setItem(PINNED_KEY'), 'writes must go through the preferences channel');
    // The legacy key is only read (migration source) and removed (post-migration cleanup).
    assert.match(appHeaderSrc, /localStorage\.getItem\(PINNED_KEY\)/);
    assert.match(appHeaderSrc, /localStorage\.removeItem\(PINNED_KEY\)/);
  });
});
