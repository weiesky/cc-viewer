/**
 * Source-contract test: every t('ui.mcpStatus.*') key referenced by SdkMcpStatusTab must
 * resolve in src/i18n.js (a missing key silently falls back to the raw key string).
 * Pattern mirrors sdk-context-usage-tab.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT = readFileSync(join(here, '..', 'src', 'components', 'dashboard', 'SdkMcpStatusTab.jsx'), 'utf-8');
const I18N_SRC = readFileSync(join(here, '..', 'src', 'i18n.js'), 'utf-8');

describe('SdkMcpStatusTab — every t() key resolves in i18n.js', () => {
  it('all literal + status-enum ui.mcpStatus.* keys exist', () => {
    const keys = new Set();
    for (const m of COMPONENT.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1]);
    // Status-enum keys render via a template literal (t(`ui.mcpStatus.status.${key}`)) and
    // resolve dynamically; assert the concrete keys statusKey() can emit instead.
    for (const st of ['connected', 'failed', 'needsAuth', 'pending', 'disabled', 'unknown']) {
      keys.add(`ui.mcpStatus.status.${st}`);
    }
    assert.ok(keys.size > 0, 'no t() keys found — component source scan broken?');
    for (const key of keys) {
      assert.ok(I18N_SRC.includes(`"${key}": {`), `t('${key}') referenced but missing in src/i18n.js`);
    }
  });
});
