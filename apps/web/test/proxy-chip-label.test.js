/**
 * proxy-chip-label.test.js — source-contract test for the proxy hot-switch chip.
 *
 * The chip migrated out of AppHeader into the chat input bar (apps/web/src/components/
 * chat/ProxyChip.jsx, rendered via ChatView → ChatInputBar) so PC and iPad both show it
 * (Mobile never mounts AppHeader). This pins the label contract that migration must not
 * break.
 *
 * The chip must stay compact: it shows only the main profile label. Sub-agent / teammate
 * role assignments are NOT spelled out on the chip ("· 子: X · 队: Y" made it too verbose)
 * — they live in the title tooltip (ui.proxy.roleSummary) instead. The badges themselves
 * still exist inside ProxyModal's assignment area.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ProxyChip.jsx');

const jsx = readFileSync(JSX_PATH, 'utf-8');

// The Tag block returned for the proxy chip (className may not be the first attribute).
const chipBlock = jsx.match(/<Tag[\s\S]*?className=\{styles\.proxyChip\}[\s\S]*?<\/Tag>/);

describe('proxy hot-switch chip — compact input-bar label', () => {
  it('proxyChip Tag block is found', () => {
    assert.ok(chipBlock, 'proxyChip Tag block exists in ProxyChip.jsx');
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
    const titleCall = jsx.match(/t\('ui\.proxy\.roleSummary',\s*\{[\s\S]*?\}\)/);
    assert.ok(titleCall && titleCall[0].includes('subD') && titleCall[0].includes('teamD'),
      'roleSummary receives subD/teamD');
  });

  it('sub/teammate overrides still wake the chip up when main is Default (visibility guard kept)', () => {
    assert.ok(jsx.includes('!subD && !teamD'),
      'dormant-Default guard still keys off subD/teamD');
  });

  it('click is delegated to onOpenProxyModal (presentational — no local modal state)', () => {
    assert.ok(chipBlock[0].includes('onClick={onOpenProxyModal}'),
      'chip click raises onOpenProxyModal');
    assert.ok(!/setState|useState/.test(jsx), 'ProxyChip holds no modal state of its own');
  });

  it('SDK fallback chip is read-only (no onClick) and uses its own class', () => {
    const sdkChip = jsx.match(/<Tag className=\{styles\.sdkChip\}[\s\S]*?<\/Tag>/);
    assert.ok(sdkChip, 'sdkChip Tag present');
    assert.ok(!/onClick/.test(sdkChip[0]), 'SDK chip is non-clickable');
    assert.ok(jsx.includes('shouldRenderSdkModelChip'), 'uses the pure guard');
  });
});
