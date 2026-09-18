/**
 * im-save-button.test.js — source contract for the settings-panel 「保存」 button
 * (ImPlatformSettings.jsx) that decouples persisting config from starting/stopping
 * the worker. The repo has no JSX transform/jsdom, so — like im-quit-button.test.js —
 * these are readFileSync source contracts, each paired with a mutation that must FAIL:
 *   1. make the save button drive the process (applyProcess:true) → recouples save+start
 *   2. drop the save button from the actions row
 *   3. make save flip enabled (save must not change the enabled switch)
 *   4. drop the dirty-check (saving must no-op when nothing changed)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'src', 'components', 'settings', 'ImPlatformSettings.jsx'), 'utf-8');

// Extract the `save` function body for scoped assertions.
const fnStart = SRC.indexOf('const save = async');
const fnEnd = SRC.indexOf('\n  };', fnStart);
const FN = SRC.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);

describe('IM settings-panel save button contract', () => {
  it('defines a save handler that persists without driving the process', () => {
    assert.ok(fnStart >= 0, 'save handler defined');
    // applyProcess:false = save-only (no restartProcess/stopProcess). This is the
    // decoupling invariant — save must NEVER pass true here.
    assert.ok(FN.includes('buildBody(valuesRef.current, enabledRef.current, false)'),
      'save passes applyProcess:false (persist only, no process drive)');
    assert.ok(!/buildBody\(valuesRef\.current, enabledRef\.current, true\)/.test(FN),
      'save must not drive the process (that is what start/stop are for)');
  });

  it('save keeps the current enabled state (does not flip the switch)', () => {
    assert.ok(FN.includes('enabledRef.current'), 'save uses the current enabled state, not a hardcoded true/false');
    assert.ok(!FN.includes('setEnabled('), 'save must not change enabled (start/stop own that)');
  });

  it('save no-ops when nothing changed (dirty check against lastSavedSig)', () => {
    assert.ok(FN.includes('lastSavedSigRef.current'), 'dirty check against lastSavedSig present');
    assert.ok(FN.includes('sig === lastSavedSigRef.current'),
      'returns early (no request) when the field signature is unchanged');
  });

  it('renders a 保存 button in the actions row wired to save', () => {
    assert.ok(SRC.includes('onClick={save}'), 'save button wired to the save handler');
    assert.ok(SRC.includes("_tr('ui.im.save', null, 'Save')"), 'button label uses ui.im.save (保存)');
    assert.ok(SRC.includes('loading={saving}'), 'save button has its own loading state');
  });
});
