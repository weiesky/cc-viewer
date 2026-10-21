/**
 * upload-plus-menu.test.js — source anchors for the 2026-10-21 change that folded the
 * desktop standalone upload round button into the ChatInputBar (+) menu, aligning with
 * the mobile flat menu which already carried the upload entry.
 *
 * Source-anchor style per house precedent (resume-history-menu.test.js): the hosts are
 * React components that can't be imported into node:test, so these assertions read the
 * source and fail loudly if a future refactor drops a link in the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const CHAT_INPUT = read('src/components/chat/ChatInputBar.jsx');

describe('upload entry folded into the ChatInputBar (+) menu', () => {
  it('the desktop (+) menu carries an upload item wired to handleUploadPick', () => {
    // Desktop branch starts with `{!isMobile ? (`; the upload menu item must appear before
    // the cascade QuickAutoApproveRows so it sits at the top of the quick menu.
    const desktopBranch = CHAT_INPUT.match(/\{!isMobile \? \(([\s\S]{0,2000}?)<QuickAutoApproveRows/);
    assert.ok(desktopBranch, 'desktop (+) menu branch must exist before QuickAutoApproveRows');
    assert.ok(
      /<button[\s\S]{0,200}?className=\{chrome\.quickMenuRow\}[\s\S]{0,200}?onClick=\{handleUploadPick\}[\s\S]{0,300}?<UploadIcon \/>[\s\S]{0,200}?ui\.terminal\.upload/.test(desktopBranch[1]),
      'desktop (+) menu must contain a quickMenuRow upload button with UploadIcon + ui.terminal.upload label',
    );
  });

  it('the standalone desktop upload round button is gone from the input bar', () => {
    // Exactly two UploadIcon usages remain (desktop menu row + mobile menu row) and neither
    // may sit inside a standalone plusBtn round button — robust to attribute reordering.
    const iconUses = CHAT_INPUT.match(/<UploadIcon \/>/g) || [];
    assert.equal(iconUses.length, 2, 'UploadIcon must appear exactly twice (desktop + mobile menu rows)');
    assert.ok(
      !/className=\{[^}]*styles\.plusBtn[^}]*\}[^>]*>(?:(?!<\/button>)[\s\S])*?<UploadIcon \/>/.test(CHAT_INPUT),
      'no plusBtn round button may contain UploadIcon anymore',
    );
  });

  it('the mobile flat menu keeps its upload item (unchanged behavior)', () => {
    // Mobile branch is the `) : (` alternative of the menu ternary; the upload item is
    // its last row, so assert against the slice after the clear-context entry instead
    // of trying to balance JSX parens with a regex.
    const clearIdx = CHAT_INPUT.indexOf("t('ui.chatInput.clearContext')}");
    assert.ok(clearIdx > 0, 'mobile clear-context menu item must exist');
    const tail = CHAT_INPUT.slice(clearIdx, clearIdx + 800);
    assert.ok(
      /<button className=\{styles\.plusMenuItem\} onClick=\{handleUploadPick\}>[\s\S]{0,200}?<UploadIcon \/>/.test(tail),
      'mobile (+) menu must keep the upload item right after clear-context',
    );
  });

  it('handleUploadPick still closes the menu then opens a file picker feeding runUpload', () => {
    const pick = CHAT_INPUT.match(/const handleUploadPick = \(\) => \{([\s\S]{0,900}?)\n  \};/);
    assert.ok(pick, 'handleUploadPick must exist');
    assert.ok(/closePlusMenu\(\);/.test(pick[1]), 'handleUploadPick must close the (+) menu first');
    assert.ok(/document\.createElement\('input'\)/.test(pick[1]) && /input\.click\(\)/.test(pick[1]), 'handleUploadPick must spawn + click a file input');
    assert.ok(/await runUpload\(file\)/.test(pick[1]), 'handleUploadPick must feed the picked file into runUpload');
  });
});
