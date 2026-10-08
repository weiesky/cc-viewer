/**
 * Source-contract tests for the Git-changes panel open-state persistence
 * (2026-10-08). The Git side panel (ChatView.state.gitChangesOpen) previously
 * had no storage backing — refreshing the page always closed it. The fix
 * mirrors the fileExplorerOpen pattern (ccv_fileExplorerOpen):
 *   - constructor reads localStorage.ccv_gitChangesOpen (default closed, with
 *     the same isPad branch as fileExplorerOpen),
 *   - a _setGitChangesOpen setter writes localStorage, then setState, with the
 *     _pendingGitRefresh consumption folded inside (mirrors _setFileExplorerOpen),
 *   - ACTIVE closes go through the setter: nav icon onClick, panel onClose,
 *     and the FileExplorer / Search icons' mutual-exclusion close,
 *   - PASSIVE closes stay as direct setState (no storage write): _detectGit
 *     (no-repo probe) and the jump-to-file paths — these are reactions to the
 *     environment, not user intent.
 *
 * ChatView is a class component, so we assert the source directly (the
 * pattern used by resume-history-menu / live-processes-refresh tests).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const chatViewSrc = readFileSync(join(here, '../src/components/chat/ChatView.jsx'), 'utf8');

describe('gitChangesOpen persistence', () => {
  it('constructor reads from localStorage with default-closed semantics + isPad branch', () => {
    // phone (isMobile && !isPad) always false; otherwise reads storage — and
    // yields to fileExplorer when both storages say "open" (mutual-exclusion restore).
    assert.match(
      chatViewSrc,
      /gitChangesOpen:\s*\(\(\)\s*=>\s*\{[\s\S]{0,500}?if\s*\(isMobile\s*&&\s*!isPad\)\s*return\s*false;[\s\S]{0,500}?localStorage\.getItem\('ccv_gitChangesOpen'\)\s*!==\s*'true'\)\s*return\s*false;[\s\S]{0,500}?localStorage\.getItem\('ccv_fileExplorerOpen'\)/,
    );
  });

  it('constructor restore is mutually exclusive with fileExplorerOpen (no double-open on refresh)', () => {
    // The git panel's restore must check the fileExplorer storage key and
    // decline when the latter resolves to open — otherwise a refresh after
    // "jump-to-file closed git passively while fileExplorer was opened"
    // would render both panels side-by-side (a state unreachable via clicks).
    const m = chatViewSrc.match(/gitChangesOpen:\s*\(\(\)\s*=>\s*\{[\s\S]*?\}\)\(\)/);
    assert.ok(m, 'gitChangesOpen IIFE initializer located');
    assert.match(m[0], /ccv_fileExplorerOpen/, 'restore must consult the fileExplorer storage key');
    assert.match(m[0], /return\s*!feOpen/, 'restore must yield when fileExplorer is open');
  });

  it('has a _setGitChangesOpen setter that writes localStorage (try/catch) then setState', () => {
    assert.match(
      chatViewSrc,
      /_setGitChangesOpen\(open\)\s*\{[\s\S]{0,400}?try\s*\{\s*localStorage\.setItem\('ccv_gitChangesOpen'[\s\S]{0,600}?this\.setState/,
    );
  });

  it('setter consumes _pendingGitRefresh on the opening branch (mirrors _setFileExplorerOpen)', () => {
    // The pending-signal consumption lives INSIDE the setter (not the nav onClick),
    // so any future "open" path can't forget to consume it.
    const m = chatViewSrc.match(/_setGitChangesOpen\(open\)\s*\{[\s\S]*?\n\s*\}\n/);
    assert.ok(m, '_setGitChangesOpen body located');
    assert.match(m[0], /if\s*\(open\s*&&\s*this\._pendingGitRefresh\)/);
    assert.match(m[0], /gitChangesRefresh:\s*\(prev\.gitChangesRefresh\s*\|\|\s*0\)\s*\+\s*1/);
  });

  it('panel onClose goes through the setter (active close)', () => {
    assert.match(
      chatViewSrc,
      /onClose=\{\(\)\s*=>\s*this\._setGitChangesOpen\(false\)\}/,
    );
  });

  it('nav icon onClick toggles through the setter (active toggle)', () => {
    const idx = chatViewSrc.indexOf("t('ui.gitChanges')");
    assert.ok(idx > 0, 'nav icon with ui.gitChanges title exists');
    const before = chatViewSrc.slice(Math.max(0, idx - 2000), idx);
    assert.match(before, /_setGitChangesOpen\(!this\.state\.gitChangesOpen\)/);
  });

  it('fileExplorer icon mutual-exclusion close goes through the setter (active close)', () => {
    // Fixes the "open git → click file-explorer → refresh → both panels open" bug:
    // the fileExplorer icon's onClick must also persist gitChangesOpen=false.
    const idx = chatViewSrc.indexOf("_setFileExplorerOpen(!this.state.fileExplorerOpen)");
    assert.ok(idx > 0, 'file-explorer nav onClick located');
    const window = chatViewSrc.slice(idx, idx + 400);
    assert.match(window, /_setGitChangesOpen\(false\)/);
  });

  it('search icon mutual-exclusion close goes through the setter (active close)', () => {
    // Search icon's onClick must also persist gitChangesOpen=false on its open branch.
    const idx = chatViewSrc.indexOf("t('ui.search')");
    assert.ok(idx > 0, 'search nav icon located');
    const before = chatViewSrc.slice(Math.max(0, idx - 1500), idx);
    assert.match(before, /_setGitChangesOpen\(false\)/);
  });

  it('constructive invariant: ccv_gitChangesOpen is written from exactly ONE place (the setter)', () => {
    // Counting all occurrences of the setItem call — if a future change adds
    // another write site (e.g. inside _detectGit), this test fails and forces
    // the author to decide whether that write is intentional.
    const matches = chatViewSrc.match(/localStorage\.setItem\('ccv_gitChangesOpen'/g) || [];
    assert.equal(matches.length, 1, `expected exactly 1 setItem site for ccv_gitChangesOpen, found ${matches.length}`);
  });

  it('passive close in _detectGit (no-git probe) does NOT persist', () => {
    // _detectGit closes the panel via direct setState (no storage write), so
    // switching to a no-git project doesn't clobber the remembered intent.
    assert.match(
      chatViewSrc,
      /setState\(\{\s*hasGit:\s*false,\s*gitChangesOpen:\s*false\s*\}\)/,
    );
  });
});

