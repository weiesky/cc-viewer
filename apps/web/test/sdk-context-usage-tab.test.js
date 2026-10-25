/**
 * Source-contract test: every t('ui.contextUsage.*') key referenced by SdkContextUsageTab
 * must resolve in src/i18n.js (a missing key silently falls back to the raw key string).
 * Pattern mirrors queue-bubbles.test.js / file-browser-modal.test.js.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT = readFileSync(join(here, '..', 'src', 'components', 'dashboard', 'SdkContextUsageTab.jsx'), 'utf-8');
const I18N_SRC = readFileSync(join(here, '..', 'src', 'i18n.js'), 'utf-8');
const CSS = readFileSync(join(here, '..', 'src', 'components', 'dashboard', 'SdkContextUsageTab.module.css'), 'utf-8');
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
let CATEGORY_COLOR_ROLES;

before(async () => {
  ({ CATEGORY_COLOR_ROLES } = await import('../src/utils/contextUsageView.js'));
});

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

describe('SdkContextUsageTab — readable grid and scrollable layout', () => {
  it('owns a bounded vertical scrollport without flex-shrinking expanded sections', () => {
    assert.match(CSS_CODE, /\.root\s*\{[^}]*box-sizing:\s*border-box/s);
    assert.match(CSS_CODE, /\.root\s*\{[^}]*height:\s*100%/s);
    assert.match(CSS_CODE, /\.root\s*\{[^}]*min-height:\s*0/s);
    assert.match(CSS_CODE, /\.root\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(CSS_CODE, /\.root\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it('declares both theme values for every category role used by the view model', () => {
    const dark = CSS_CODE.match(/^\.root\s*\{([^}]*)\}/m);
    const light = CSS_CODE.match(/:global\(\[data-theme="light"\]\)\s+\.root\s*\{([^}]*)\}/s);
    assert.ok(dark && light, 'missing theme category palette');
    assert.ok(CATEGORY_COLOR_ROLES.length >= 16, 'category role enumeration must not be empty');
    for (const suffix of CATEGORY_COLOR_ROLES) {
      const role = `--context-category-${suffix}`;
      assert.ok(dark[1].includes(`${role}:`), `missing dark ${role}`);
      assert.ok(light[1].includes(`${role}:`), `missing light ${role}`);
    }
  });

  it('uses fixed visible fill states instead of raw fractional opacity', () => {
    assert.match(COMPONENT, /cell\.fill/);
    assert.doesNotMatch(COMPONENT, /opacity:\s*cell\.(fullness|isFilled)/);
    assert.match(CSS_CODE, /\.gridCellPartial\s*\{[^}]*color-mix/s);
    assert.match(CSS_CODE, /\.gridCellFull\s*\{[^}]*background:\s*var\(--cell-color\)/s);
    assert.match(CSS_CODE, /\.gridCellBuffer\s*\{[^}]*background:\s*var\(--context-category-buffer\)/s);
    assert.match(CSS_CODE, /\.gridCellEmpty\s*\{[^}]*var\(--context-category-free-space/s);
    for (const fill of ['full', 'partial', 'empty', 'buffer']) {
      const className = `gridCell${fill[0].toUpperCase()}${fill.slice(1)}`;
      assert.match(COMPONENT, new RegExp(`${fill}: styles\\.${className}`));
    }
    assert.match(CSS_CODE, /\.gridCell\s*\{[^}]*flex:\s*0\s+0\s+10px/s);
    assert.match(CSS_CODE, /\.grid\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(CSS_CODE, /\.headerRow\s*\{[^}]*flex-wrap:\s*wrap/s);
    assert.doesNotMatch(CSS_CODE, /\.barSeg\s*\{[^}]*flex-shrink:\s*0/s);
    assert.match(COMPONENT, /className=\{styles\.barSeg\}/);
    assert.match(COMPONENT, /width:\s*`\$\{s\.pct\}%`/);
    assert.match(CSS_CODE, /\.barTrack\s*\{[^}]*display:\s*flex/s);
    assert.doesNotMatch(CSS_CODE, /\.barSeg\s*\+\s*\.barSeg/s);
    assert.doesNotMatch(CSS_CODE, /!important/);
  });
});
