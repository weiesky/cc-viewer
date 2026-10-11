/**
 * Source-contract test: every t('ui.contextUsage.*') key referenced by SdkContextUsageTab
 * must resolve in src/i18n.js (a missing key silently falls back to the raw key string).
 * Pattern mirrors queue-bubbles.test.js / file-browser-modal.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT = readFileSync(join(here, '..', 'src', 'components', 'dashboard', 'SdkContextUsageTab.jsx'), 'utf-8');
const I18N_SRC = readFileSync(join(here, '..', 'src', 'i18n.js'), 'utf-8');

describe('SdkContextUsageTab — every t() key resolves in i18n.js', () => {
  it('all literal ui.contextUsage.* keys exist', () => {
    const keys = new Set();
    for (const m of COMPONENT.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1]);
    // Template-literal section keys (t(`ui.contextUsage.section.${sec.key}`)) resolve
    // dynamically; assert the concrete section keys the component can emit instead.
    for (const sec of ['memoryFiles', 'mcpTools', 'deferredTools', 'systemTools', 'systemPromptSections', 'agents', 'skills', 'slashCommands', 'messageBreakdown', 'apiUsage']) {
      keys.add(`ui.contextUsage.section.${sec}`);
    }
    assert.ok(keys.size > 0, 'no t() keys found — component source scan broken?');
    for (const key of keys) {
      assert.ok(I18N_SRC.includes(`"${key}": {`), `t('${key}') referenced but missing in src/i18n.js`);
    }
  });
});
