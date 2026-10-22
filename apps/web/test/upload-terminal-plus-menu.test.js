/**
 * upload-terminal-plus-menu.test.js — source anchors for folding the terminal toolbar's
 * standalone upload round button into the terminal's sparkle (+) quick-settings Popover,
 * mirroring the earlier ChatInputBar change (commit a2be00c4 + follow-up 3cf3e958).
 *
 * Source-anchor style per house precedent (upload-plus-menu.test.js, resume-history-menu.test.js):
 * the host is a React class component that can't be imported into node:test, so these
 * assertions read the source and fail loudly if a future refactor drops a link in the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const TERMINAL_PANEL = read('src/components/terminal/TerminalPanel.jsx');

describe('upload entry folded into the TerminalPanel sparkle quick-settings menu', () => {
  it('the sparkle Popover content carries an upload row before QuickAutoApproveRows', () => {
    // The Popover content is `<div className={styles.presetMenu}>`; the upload row must
    // be the first child so it sits at the top of the menu (aligned with ChatInputBar).
    const menu = TERMINAL_PANEL.match(/<div className=\{styles\.presetMenu\}>([\s\S]{0,4000}?)<QuickAutoApproveRows/);
    assert.ok(menu, 'sparkle Popover presetMenu must exist before QuickAutoApproveRows');
    assert.ok(
      /<button[\s\S]{0,300}?className=\{chrome\.quickMenuRow\}[\s\S]{0,600}?<UploadIcon \/>[\s\S]{0,200}?ui\.terminal\.upload/.test(menu[1]),
      'sparkle menu must contain a quickMenuRow upload button with UploadIcon + ui.terminal.upload label',
    );
  });

  it('the upload row onClick closes the Popover then opens the file picker', () => {
    // The row must close the controlled Popover first so the OS file picker isn't
    // obscured, then click the persistent hidden <input type=file> — the input and
    // handleFileUpload chain stay untouched.
    const row = TERMINAL_PANEL.match(/<button[\s\S]{0,100}?className=\{chrome\.quickMenuRow\}[\s\S]{0,600}?<UploadIcon \/>/);
    assert.ok(row, 'upload quickMenuRow must exist');
    assert.ok(
      /quickSettingsOpen:\s*false/.test(row[0]),
      'upload row onClick must set quickSettingsOpen: false to close the Popover',
    );
    assert.ok(
      /this\.fileInputRef\.current\?\.click\(\)/.test(row[0]),
      'upload row onClick must trigger the persistent hidden file input',
    );
  });

  it('the upload row onMouseEnter cancels hover-intent and collapses any open cascade', () => {
    // Mirror of commit 3cf3e958: top-level rows do not participate in hover-intent, so
    // moving diagonally from 历史会话 / AgentTeam would otherwise leave the cascade open.
    const row = TERMINAL_PANEL.match(/<button[\s\S]{0,100}?className=\{chrome\.quickMenuRow\}[\s\S]{0,800}?<UploadIcon \/>/);
    assert.ok(row, 'upload quickMenuRow must exist');
    assert.ok(/_qmHover\.cancel\(\)/.test(row[0]), 'upload row onMouseEnter must cancel hover-intent');
    assert.ok(
      /quickSettingsExpanded:\s*null/.test(row[0]),
      'upload row onMouseEnter must clear quickSettingsExpanded when set',
    );
  });

  it('the standalone toolbar upload round button is gone', () => {
    // The old button was a `styles.toolbarBtn` wrapping `<UploadIcon />` — assert no such
    // shape remains, robust to attribute reordering (mirrors upload-plus-menu.test.js).
    // Do not count `<UploadIcon />` occurrences: the commented-out mobile virtual-key
    // block around line 2136-2149 contains a second inert usage.
    assert.ok(
      !/className=\{[^}]*styles\.toolbarBtn[^}]*\}[^>]*>(?:(?!<\/button>)[\s\S])*?<UploadIcon \/>/.test(TERMINAL_PANEL),
      'no toolbarBtn round button may contain UploadIcon anymore',
    );
  });

  it('the persistent hidden file input and handleFileUpload are untouched', () => {
    // The whole point of folding the button into the menu is to reuse the existing
    // upload chain — assert both ends are still wired up.
    assert.ok(
      /<input type="file" ref=\{this\.fileInputRef\}/.test(TERMINAL_PANEL),
      'hidden <input type=file ref={this.fileInputRef}> must still exist',
    );
    assert.ok(
      /handleFileUpload = async \(e\) =>/.test(TERMINAL_PANEL),
      'handleFileUpload must still be defined',
    );
    assert.ok(
      /onChange=\{this\.handleFileUpload\}/.test(TERMINAL_PANEL),
      'hidden input onChange must still route to handleFileUpload',
    );
  });
});
