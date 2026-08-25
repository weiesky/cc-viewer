/**
 * proxy-chip-label.test.js — source-contract test for the proxy hot-switch chip
 * in the app header (AppHeader._renderProxyChip).
 *
 * The header chip must stay compact: it shows only the main profile label.
 * Sub-agent / teammate role assignments are NOT spelled out on the chip
 * ("· 子: X · 队: Y" made the header too verbose) — they live in the title
 * tooltip (ui.proxy.roleSummary) instead. The badges themselves still exist
 * inside ProxyModal's assignment area.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'dashboard', 'AppHeader.jsx');

const jsx = readFileSync(JSX_PATH, 'utf-8');

// The Tag block returned by _renderProxyChip.
const chipBlock = jsx.match(/_renderProxyChip\(\)\s*\{[\s\S]*?<Tag className=\{styles\.proxyProfileTag\}[\s\S]*?<\/Tag>/);

describe('proxy hot-switch chip — compact header label', () => {
  it('_renderProxyChip Tag block is found', () => {
    assert.ok(chipBlock, 'proxyProfileTag block inside _renderProxyChip exists');
  });

  it('label renders only the main profile label (no role badges)', () => {
    assert.ok(chipBlock[0].includes('{mainLabel}'), 'chip shows the main label');
    assert.ok(!chipBlock[0].includes("t('ui.proxy.badgeSubagent')"),
      'sub-agent badge is not rendered on the chip');
    assert.ok(!chipBlock[0].includes("t('ui.proxy.badgeTeammate')"),
      'teammate badge is not rendered on the chip');
  });

  it('role breakdown survives in the title tooltip (ui.proxy.roleSummary)', () => {
    assert.ok(chipBlock[0].includes('title={title}'), 'tooltip still attached');
    assert.ok(/const title = t\('ui\.proxy\.roleSummary'/.test(jsx),
      'title is built from ui.proxy.roleSummary (main/sub/team)');
    // The tooltip interpolation still receives the resolved sub/team labels.
    const titleCall = jsx.match(/t\('ui\.proxy\.roleSummary',\s*\{[\s\S]*?\}\)/);
    assert.ok(titleCall && titleCall[0].includes('subD') && titleCall[0].includes('teamD'),
      'roleSummary receives subD/teamD');
  });

  it('sub/teammate overrides still wake the chip up when main is Default (visibility guard kept)', () => {
    const fn = jsx.match(/_renderProxyChip\(\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fn && fn[0].includes('!subD && !teamD'),
      'dormant-Default guard still keys off subD/teamD');
  });
});
