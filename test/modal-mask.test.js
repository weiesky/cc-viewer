/**
 * Guards for the blurred-overlay mask of the eight hamburger-menu feature modals.
 *
 * Two invariants:
 *  1. BLUR_MASK_STYLE mirrors the AskUserQuestion / plan approval overlay
 *     (`.backdrop` in src/components/approval/ApprovalModal.module.css). If
 *     either side changes without the other, this suite fails (readFileSync
 *     source-guard, same pattern as test/expert-i18n.test.js).
 *  2. EXACTLY the eight hamburger-menu feature modals consume BLUR_MASK_STYLE.
 *     The user requirement is "blur these pop-ups and no others" — this walk
 *     catches both a target dropping out AND another modal silently adopting
 *     the blur.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLUR_MASK_STYLE } from '../src/utils/modalMask.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVAL_CSS = readFileSync(join(ROOT, 'src/components/approval/ApprovalModal.module.css'), 'utf8');

// The eight top-level hamburger-menu feature modals (plus the constant's own module).
const EXPECTED_CONSUMERS = [
  'src/utils/modalMask.js',
  'src/App.jsx',                                    // Log Management
  'src/components/dashboard/AppHeader.jsx',         // Export user prompts
  'src/components/settings/PluginModal.jsx',        // Plugin Management
  'src/components/settings/ProcessModal.jsx',       // CCV Process Manager
  'src/components/settings/MessagingModal.jsx',     // Messaging Integration
  'src/components/settings/ProxyModal.jsx',         // Hot-Switch Proxy
  'src/components/settings/SystemTextModal.jsx',    // Edit System Prompt
  'src/components/settings/RetryConfigModal.jsx',   // Retry Config (proxy retry params)
].sort();

describe('BLUR_MASK_STYLE — sync with the approval-overlay reference', () => {
  it('is frozen (accidental mutation would leak between eight modals)', () => {
    assert.ok(Object.isFrozen(BLUR_MASK_STYLE));
  });

  it('background matches ApprovalModal .backdrop verbatim', () => {
    assert.ok(
      APPROVAL_CSS.includes(`background: ${BLUR_MASK_STYLE.background}`),
      `ApprovalModal.module.css no longer contains "background: ${BLUR_MASK_STYLE.background}" — ` +
      'the reference overlay changed (or the constant drifted); update both together',
    );
  });

  it('blur radius matches ApprovalModal .backdrop verbatim', () => {
    assert.ok(
      APPROVAL_CSS.includes(`backdrop-filter: ${BLUR_MASK_STYLE.backdropFilter}`),
      `ApprovalModal.module.css no longer contains "backdrop-filter: ${BLUR_MASK_STYLE.backdropFilter}" — ` +
      'the reference overlay changed (or the constant drifted); update both together',
    );
  });

  it('webkit prefix mirrors the unprefixed value', () => {
    assert.equal(BLUR_MASK_STYLE.WebkitBackdropFilter, BLUR_MASK_STYLE.backdropFilter);
  });
});

describe('BLUR_MASK_STYLE — exact consumer set (no other pop-up may adopt it)', () => {
  it('exactly the eight feature modals (plus the constant module) reference it', () => {
    const entries = readdirSync(join(ROOT, 'src'), { recursive: true, withFileTypes: true });
    const consumers = [];
    for (const ent of entries) {
      if (!ent.isFile() || !/\.(js|jsx)$/.test(ent.name)) continue;
      const abs = join(ent.parentPath ?? ent.path, ent.name);
      if (readFileSync(abs, 'utf8').includes('BLUR_MASK_STYLE')) {
        consumers.push(relative(ROOT, abs).split(sep).join('/'));
      }
    }
    assert.deepEqual(consumers.sort(), EXPECTED_CONSUMERS,
      'BLUR_MASK_STYLE consumer set changed — blurring a new modal (or dropping one of the eight) ' +
      'must be a deliberate decision: update EXPECTED_CONSUMERS with it');
  });

  it('each of the eight modal files wires it into a styles mask entry', () => {
    for (const file of EXPECTED_CONSUMERS) {
      if (file === 'src/utils/modalMask.js') continue;
      const text = readFileSync(join(ROOT, file), 'utf8');
      assert.ok(/mask:\s*BLUR_MASK_STYLE/.test(text),
        `${file} imports BLUR_MASK_STYLE but does not pass it as a \`mask:\` style entry`);
    }
  });
});
