/**
 * Source-contract tests for the new-workspace modal changes (2026-10-08):
 *   - WorkspaceList fetch /api/workspaces WITHOUT a limit param (we cut the
 *     render client-side; the response already carries everything).
 *   - Default render shows the first 5 rows; a "show more" <tr> at the bottom
 *     reveals the rest via setShowAll(true).
 *   - NewProjectModal passes embedded to WorkspaceList, which adds the
 *     .modalBody override class so the modal's own background shows through
 *     (instead of .root's full-page grey).
 *
 * We assert on the source because WorkspaceList is a function component with
 * fetch side-effects — running it in node:test would require a DOM shim and
 * a fetch stub, which is overkill for a pure layout/flag change. The pattern
 * matches the existing resume-history-menu / live-processes-refresh tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const listSrc = readFileSync(join(here, '../src/components/dashboard/WorkspaceList.jsx'), 'utf8');
const modalSrc = readFileSync(join(here, '../src/components/dashboard/NewProjectModal.jsx'), 'utf8');
const cssSrc = readFileSync(join(here, '../src/components/dashboard/WorkspaceList.module.css'), 'utf8');

describe('WorkspaceList showMore + modal-embed contract', () => {
  it('fetch /api/workspaces without a limit param (backend now supports limit; we render client-side)', () => {
    // The fetch URL must NOT carry ?limit= — the backend enriches top-N server-side,
    // but the base fields (name/path/lastUsed) for ALL rows arrive in one response,
    // so "show more" is a pure client-side reveal without a second fetch.
    assert.match(listSrc, /fetch\(apiUrl\('\/api\/workspaces'\)\)/);
    assert.ok(!listSrc.includes("/api/workspaces?limit="), 'must not pass limit — the showMore row is purely client-side');
  });

  it('stores the total field from the response', () => {
    assert.match(listSrc, /setTotal\(typeof\s+data\.total\s*===\s*'number'\s*\?\s*data\.total/);
  });

  it('defaults to showing only the first PREVIEW_ROWS rows (showAll=false)', () => {
    assert.match(listSrc, /const\s+PREVIEW_ROWS\s*=\s*\d+/);
    assert.match(listSrc, /const\s*\[\s*showAll\s*,\s*setShowAll\s*\]\s*=\s*useState\(false\)/);
    assert.match(listSrc, /showAll\s*\?\s*workspaces\s*:\s*workspaces\.slice\(0,\s*PREVIEW_ROWS\)/);
  });

  it('renders a showMore row at the bottom when more than PREVIEW_ROWS rows exist', () => {
    assert.match(listSrc, /!showAll\s*&&\s*workspaces\.length\s*>\s*PREVIEW_ROWS/);
    assert.match(listSrc, /className=\{`?\$?\{?styles\.tr\}?\s*\$\{styles\.showMoreRow\}?`?\}/);
    assert.match(listSrc, /onClick=\{\(\)\s*=>\s*setShowAll\(true\)\}/);
    assert.match(listSrc, /colSpan=\{5\}/);
    assert.match(listSrc, /t\('ui\.workspaces\.showMore',\s*\{\s*count:\s*workspaces\.length\s*-\s*PREVIEW_ROWS\s*\}\)/);
  });

  it('showMore row is inside the <tbody> (a true <tr>, not a sibling div)', () => {
    // The user explicitly asked for the button to be the LAST ROW of the table,
    // not a separate element below it. If someone moves it outside <tbody>,
    // HTML tables render it in the wrong place (or drop it).
    const tbodyMatch = listSrc.match(/<tbody>([\s\S]*?)<\/tbody>/);
    assert.ok(tbodyMatch, 'tbody exists');
    assert.ok(tbodyMatch[1].includes('showMoreRow'), 'showMore row is inside <tbody>');
  });

  it('NewProjectModal passes embedded prop to WorkspaceList', () => {
    assert.match(modalSrc, /<WorkspaceList[\s\S]{0,200}?embedded[\s\S]{0,200}?onLaunch=/);
  });

  it('WorkspaceList accepts an embedded prop', () => {
    assert.match(listSrc, /export default function WorkspaceList\(\{\s*onLaunch,\s*embedded\s*=\s*false\s*\}\)/);
  });

  it('embedded=true applies the .modalBody override (kills the grey backdrop)', () => {
    // When embedded, .root is augmented with .modalBody — order in the template
    // literal must put modalBody AFTER root so it wins by source order.
    assert.match(listSrc, /embedded\s*\?\s*`\$\{styles\.root\}\s*\$\{styles\.modalBody\}`\s*:\s*styles\.root/);
  });

  it('.modalBody CSS rule: transparent background, no min-height, no padding', () => {
    const m = cssSrc.match(/\.modalBody\s*\{([\s\S]*?)\}/);
    assert.ok(m, '.modalBody rule exists');
    const body = m[1];
    assert.match(body, /background:\s*transparent/);
    assert.match(body, /min-height:\s*auto/);
    assert.match(body, /padding:\s*0/);
  });

  it('.showMoreRow CSS rule exists with cursor:pointer and centered primary-color text', () => {
    const m = cssSrc.match(/\.showMoreRow\s*\{([\s\S]*?)\}/);
    assert.ok(m, '.showMoreRow rule exists');
    assert.match(m[1], /cursor:\s*pointer/);
    const m2 = cssSrc.match(/\.showMoreRow\s+\.td\s*\{([\s\S]*?)\}/);
    assert.ok(m2, '.showMoreRow .td rule exists');
    assert.match(m2[1], /text-align:\s*center/);
    assert.match(m2[1], /color:\s*var\(--color-primary\)/);
  });

  it('.root (grey background + 100vh) is UNCHANGED — only embedded mode overrides it', () => {
    // The full-page workspace mode must keep its grey background; only the
    // modal-embedded usage suppresses it via .modalBody. If someone edits .root
    // directly, the full-page mode will break.
    const m = cssSrc.match(/^\.root\s*\{([\s\S]*?)\}/m);
    assert.ok(m, '.root rule exists');
    assert.match(m[1], /min-height:\s*100vh/);
    assert.match(m[1], /background:\s*var\(--bg-base-alt\)/);
  });

  it('.modalBody is declared AFTER .root in the source (same-specificity override requires it)', () => {
    // The whole "kill the grey background in modal mode" trick relies on CSS
    // source order — both selectors are single-class (0,1,0), so the later
    // declaration wins. If someone moves .modalBody above .root, the modal
    // goes back to grey.
    const rootIdx = cssSrc.search(/^\.root\s*\{/m);
    const modalBodyIdx = cssSrc.search(/^\.modalBody\s*\{/m);
    assert.ok(rootIdx > 0, '.root declaration exists');
    assert.ok(modalBodyIdx > 0, '.modalBody declaration exists');
    assert.ok(modalBodyIdx > rootIdx,
      `.modalBody (idx=${modalBodyIdx}) must be declared after .root (idx=${rootIdx}) for the override to win`);
  });
});
