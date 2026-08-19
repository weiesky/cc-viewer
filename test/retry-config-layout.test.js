import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSX = readFileSync(join(ROOT, 'apps/web/src/components/settings/RetryConfigModal.jsx'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/web/src/components/settings/RetryConfigModal.module.css'), 'utf8');
const PANEL_JSX = readFileSync(join(ROOT, 'apps/web/src/components/proxy-stats/ProxyStatsModal.jsx'), 'utf8');
const SHELL_CSS = readFileSync(join(ROOT, 'apps/web/src/components/proxy-stats/ProxyStatsModal.module.css'), 'utf8');
const HEADER_JSX = readFileSync(join(ROOT, 'apps/web/src/components/dashboard/AppHeader.jsx'), 'utf8');
const APPBASE_JSX = readFileSync(join(ROOT, 'apps/web/src/AppBase.jsx'), 'utf8');
const DASHBOARD_JSX = readFileSync(join(ROOT, 'apps/web/src/components/proxy-stats/ProxyStatsDashboard.jsx'), 'utf8');

describe('RetryConfigForm layout', () => {
  it('groups strategy controls separately from execution parameters', () => {
    assert.match(JSX, /className=\{styles\.configGrid\}/);
    assert.match(JSX, /className=\{styles\.configGroup\}/);
    assert.match(JSX, /className=\{styles\.groupTitle\}/);
    assert.match(JSX, /ui\.retryConfig\.groupStrategy/);
    assert.match(JSX, /ui\.retryConfig\.groupExecution/);

    const modeIndex = JSX.indexOf("renderResetBtn('mode')");
    const statusIndex = JSX.indexOf("renderResetBtn('retryStatusCodes')");
    const numericIndex = JSX.indexOf('NUMERIC_FIELDS.map');
    assert.ok(modeIndex >= 0 && statusIndex > modeIndex, 'strategy group should contain mode before status codes');
    assert.ok(numericIndex > statusIndex, 'execution parameters should render after strategy controls');
  });

  it('uses two columns on wide config panels and returns to one column on narrow panels', () => {
    assert.match(CSS, /\.configGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
    assert.match(CSS, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*\.configGrid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(CSS, /\.configGroup\s*\{/);
  });

  it('lets the embedded config tab use the modal width without affecting the stats tab', () => {
    assert.match(SHELL_CSS, /\.configFormWrap\s*\{[^}]*max-width:\s*1120px/s);
    assert.match(SHELL_CSS, /\.configFormWrap\s*\{[^}]*margin:\s*0 auto/s);
  });

  it('keeps config and stats in one tabbed panel instead of nested modal surfaces', () => {
    assert.match(PANEL_JSX, /<Segmented/);
    assert.match(PANEL_JSX, /ui\.proxyStats\.tabConfig/);
    assert.match(PANEL_JSX, /ui\.proxyStats\.tabStats/);
    assert.doesNotMatch(PANEL_JSX, /BLUR_MASK_STYLE|<Modal|viewRetryConfig/);
    // RetryConfigModal.jsx must be form-only (no standalone Modal wrapper / blur mask):
    // the unified ProxyStatsModal owns the host Modal; this file exports just RetryConfigForm.
    assert.doesNotMatch(JSX, /BLUR_MASK_STYLE|<Modal/);
  });

  it('routes the hamburger entry to the unified config and stats panel on every viewport', () => {
    assert.match(HEADER_JSX, /label:\s*t\('ui\.proxyStats\.title'\)/);
    assert.match(HEADER_JSX, /onClick:\s*\(\)\s*=>\s*this\.props\.onToggleProxyStats\?\.\(\)/);
    assert.doesNotMatch(HEADER_JSX, /RetryConfigModal|retryConfigModalVisible/);
  });

  it('gives the config tab a working scroll viewport', () => {
    // .configScroll sizes itself with `flex: 1` + `min-height: 0`, which only
    // resolve against a flex parent with a definite height. If .body is left a
    // plain block box, the scroll child falls back to content height and .body's
    // own `overflow: hidden` clips the form — the Save button becomes unreachable
    // on short viewports. Pin the flex chain.
    const body = SHELL_CSS.match(/\.body\s*\{([^}]*)\}/s);
    assert.ok(body, '.body rule not found');
    assert.match(body[1], /display:\s*flex/, '.body must be a flex container');
    assert.match(body[1], /flex-direction:\s*column/, '.body must stack toolbar above content');
    assert.match(SHELL_CSS, /\.configScroll\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it('keeps the stats-tab refresh controls reachable', () => {
    // DashboardHeader used to render only under `!embedded`, while the sole call
    // site always passed `embedded` — so the auto-refresh toggle and the manual
    // Refresh button were unreachable while the 15s poll kept running. The
    // dashboard now takes no `embedded` prop and always renders the controls.
    assert.doesNotMatch(DASHBOARD_JSX, /\{!embedded &&/, 'refresh controls must not be gated behind !embedded');
    assert.doesNotMatch(PANEL_JSX, /<ProxyStatsDashboard\s+embedded/, 'dashboard no longer takes an embedded prop');
    assert.match(DASHBOARD_JSX, /<DashboardHeader\s+onRefresh=\{fetchData\}/);
    assert.match(DASHBOARD_JSX, /ui\.proxyStats\.autoRefresh/);
    assert.match(DASHBOARD_JSX, /ui\.proxyStats\.refresh/);
  });
});

describe('RetryConfigForm row geometry', () => {
  // The label+input cluster geometry is the whole point of this form's look:
  // a fixed-width right-aligned label column, a capped input cell, the whole
  // cluster horizontally centered inside the group box, and a mobile restack
  // to a single column at narrow viewports. Pinning these as assertions stops
  // a refactor from silently widening the label, dropping the centering, or
  // breaking the mobile single-column restack.

  it('stretches the two group boxes to equal height (align-items: stretch on .configGrid)', () => {
    assert.match(CSS, /\.configGrid\s*\{[\s\S]*?align-items:\s*stretch/s);
  });

  it('horizontally centers the label+input cluster inside each row (justify-content: center on .row)', () => {
    assert.match(CSS, /\.row\s*\{[\s\S]*?justify-content:\s*center/s);
  });

  it('pins the label column to a fixed 150px width (right-aligned down the rows)', () => {
    assert.match(CSS, /\.label\s*\{[\s\S]*?width:\s*150px/s);
  });

  it('caps the input cell at 320px so the cluster stays compact in a wide panel', () => {
    assert.match(CSS, /\.inputCell\s*\{[\s\S]*?width:\s*320px/s);
  });

  it('restacks the row to a single column under 640px (label above input, both full width)', () => {
    // The mobile media query must switch .row to column direction, stretch the
    // cells, left-align them, AND release the fixed label width to auto so the
    // label no longer holds a 150px column on a narrow screen.
    const mobileIdx = CSS.indexOf('@media (max-width: 640px)');
    assert.ok(mobileIdx >= 0, 'expected a @media (max-width: 640px) mobile restack block');
    const mobileBlock = CSS.slice(mobileIdx);
    assert.match(mobileBlock, /\.row\s*\{[\s\S]*?flex-direction:\s*column/s);
    assert.match(mobileBlock, /\.row\s*\{[\s\S]*?align-items:\s*stretch/s);
    assert.match(mobileBlock, /\.row\s*\{[\s\S]*?justify-content:\s*flex-start/s);
    assert.match(mobileBlock, /\.label\s*\{[\s\S]*?width:\s*auto/s);
    assert.match(mobileBlock, /\.label\s*\{[\s\S]*?justify-content:\s*flex-start/s);
    assert.match(mobileBlock, /\.label\s*\{[\s\S]*?text-align:\s*left/s);
    assert.match(mobileBlock, /\.inputCell\s*\{[\s\S]*?width:\s*auto/s);
  });
});

describe('handleRetryConfigChange save contract', () => {
  // Both assertions below must look only at this method's body: searching the
  // whole 2000+-line AppBase.jsx would pass vacuously as soon as any unrelated
  // `if (!r.ok)` appears earlier in the file.
  const methodBody = () => {
    const start = APPBASE_JSX.indexOf('handleRetryConfigChange =');
    const end = APPBASE_JSX.indexOf('\n  };', start);
    assert.ok(start >= 0 && end > start, 'handleRetryConfigChange block not found');
    return APPBASE_JSX.slice(start, end);
  };

  it('checks r.ok before decoding JSON so a rejected POST (4xx/5xx + JSON body) rolls back', () => {
    // The server returns 400/403 + a JSON body on rejection. Without an r.ok
    // guard, r.json() would resolve, the .catch (which rolls back the optimistic
    // update) would never fire, and the form would report a false "saved".
    // Pin the guard: an r.ok check MUST precede the .json() call.
    const block = methodBody();
    const okIdx = block.search(/if\s*\(\s*!r\.ok\s*\)/);
    const jsonIdx = block.search(/return\s+r\.json\s*\(\s*\)/);
    assert.ok(okIdx >= 0, 'handleRetryConfigChange must guard with `if (!r.ok)` before decoding');
    assert.ok(jsonIdx >= 0, 'handleRetryConfigChange must still decode JSON (after the ok guard)');
    assert.ok(okIdx < jsonIdx, 'the r.ok check must come before r.json()');
  });

  it('keeps comments English-only (CLAUDE.md) inside handleRetryConfigChange', () => {
    // No CJK characters in inline comments within the method body.
    assert.doesNotMatch(methodBody(), /[一-鿿㐀-䶿]/,
      'handleRetryConfigChange must not contain Chinese inline comments');
  });
});
