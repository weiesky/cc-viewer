/**
 * scratch-open-persist.test.js — the --sdk scratch terminal open/closed state
 * must persist across page refresh.
 *
 * Root cause: App owns the SDK scratch panel via `scratchOpen` (default false).
 * It was never persisted, so a refresh re-mounted App with scratchOpen=false and
 * the panel always closed — unlike the PTY terminal whose default is `true`
 * (and thus *appears* remembered). Fix: init `scratchOpen` from a global
 * `ccv_scratchOpen` localStorage key and write it through `_setScratchOpen`,
 * mirroring ChatView's `_setFileExplorerOpen`/`_setGitChangesOpen` pattern.
 *
 * Source-contract style (no JSX execution in node:test): assert the App.jsx
 * constructor reads the key, and the toggle sites route through the persisting
 * setter for the sdkMode branch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', 'src', 'App.jsx');
const src = readFileSync(APP, 'utf-8');

describe('App: --sdk scratch terminal open state persists (ccv_scratchOpen)', () => {
  it('constructor initializes scratchOpen from localStorage ccv_scratchOpen', () => {
    // The constructor must read the key with a 'true' compare and a safe default
    // (closed), NOT hard-code `scratchOpen: false`.
    assert.match(src, /scratchOpen:\s*\(\(\)\s*=>\s*\{[\s\S]*?localStorage\.getItem\('ccv_scratchOpen'\)\s*===\s*'true'[\s\S]*?\}\)\(\)/,
      'constructor must read ccv_scratchOpen === \'true\'');
    assert.doesNotMatch(src, /scratchOpen:\s*false,/, 'hard-coded scratchOpen:false defeats persistence');
  });

  it('has a _setScratchOpen setter that writes ccv_scratchOpen and setStates', () => {
    const m = src.match(/_setScratchOpen\s*=\s*\(open\)\s*=>\s*\{([\s\S]*?)\};/);
    assert.ok(m, '_setScratchOpen method must exist');
    const body = m[1];
    assert.match(body, /localStorage\.setItem\('ccv_scratchOpen', String\(!!open\)\)/, 'setter writes the key');
    assert.match(body, /setState\(\{ scratchOpen: !!open \}\)/, 'setter updates state');
  });

  it('both toggle sites route the sdkMode branch through _setScratchOpen (persisting), not a bare setState', () => {
    const toggles = src.match(/onToggleTerminal=\{[^}]*\}/g) || [];
    assert.ok(toggles.length >= 2, `expected ≥2 onToggleTerminal sites, got ${toggles.length}`);
    for (const t of toggles) {
      assert.ok(t.includes('_setScratchOpen('), `toggle must call _setScratchOpen for sdkMode: ${t.slice(0, 80)}`);
      assert.ok(!/scratchOpen:\s*!prev\.scratchOpen/.test(t), 'toggle must not flip scratchOpen via bare setState (would not persist)');
    }
  });
});
