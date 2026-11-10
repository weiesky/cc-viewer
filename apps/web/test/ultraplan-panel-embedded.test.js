/**
 * Source-anchor tests for UltraplanPanel's host-agnostic extension props
 * (embedded / hideHeader / hideSend / templates / placeholder / maxFiles).
 * The schedule-task modal embeds the panel; these anchors guarantee the new props
 * stay OPTIONAL — the two Popover hosts (TerminalPanel toolbar, ChatInputBar)
 * pass none of them and must keep their exact current behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'terminal', 'UltraplanPanel.jsx'), 'utf-8');
const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'terminal', 'UltraplanPanel.module.css'), 'utf-8');

describe('UltraplanPanel host-agnostic props', () => {
  it('new props are destructured as optional trailing params (existing callers unaffected)', () => {
    const sig = SRC.match(/export default function UltraplanPanel\(\{([\s\S]*?)\}\)/);
    assert.ok(sig, 'props signature located');
    assert.ok(/templates, embedded, hideHeader, hideSend, placeholder, maxFiles,/.test(sig[1]), 'optional props must trail the required ones');
  });

  it('resize handle is only rendered outside embedded mode', () => {
    assert.ok(/\{!embedded && \(/.test(SRC), 'resize handle must be gated on !embedded');
    assert.ok(/className=\{`\$\{styles\.ultraplanPanel\}\$\{embedded \? ` \$\{styles\.embedded\}` : ''\}`\}/.test(SRC), 'root gains the embedded class');
  });

  it('header and send button are gated by hideHeader/hideSend', () => {
    assert.ok(/\{!hideHeader && \(/.test(SRC), 'header gated on !hideHeader');
    assert.ok(/\{!hideSend && \(/.test(SRC), 'send button gated on !hideSend');
  });

  it('Cmd/Ctrl+Enter uses optional chaining so a host without onSend never crashes', () => {
    assert.ok(!/[^?]\bonSend\(\)/.test(SRC.replace(/onSend=\{handleSave\}/, '')), 'bare onSend() call would throw when the prop is omitted');
    assert.ok(/onSend\?\.\(\)/.test(SRC), 'keydown handler must call onSend?.()');
  });

  it('the none template tab renders without icon or edit pencil', () => {
    const noneBranch = SRC.match(/if \(d\.kind === 'none'\) \{([\s\S]*?)\}\s*if \(d\.kind === 'builtin'\)/);
    assert.ok(noneBranch, 'none tab branch located before the builtin branch');
    assert.ok(/ui\.ultraplan\.noneTemplate/.test(noneBranch[1]), 'none tab uses its i18n label');
    assert.ok(!/expertIcon/.test(noneBranch[1]), 'none tab must not render an expert icon');
  });

  it('templates prop overrides the expert list; default path keeps the hidden filter', () => {
    const tabList = SRC.match(/const tabList = ([\s\S]*?);/);
    assert.ok(tabList, 'tabList derivation located');
    assert.ok(/Array\.isArray\(templates\)/.test(tabList[1]), 'templates override is guarded');
    assert.ok(/buildExpertList\(customExperts, expertOrder, expertHidden\)\s*\.filter\(d => !d\.hidden\)/.test(tabList[1]), 'default path keeps filtering hidden experts');
  });

  it('maxFiles disables upload and strips the paste handler when full', () => {
    assert.ok(/const filesFull = typeof maxFiles === 'number' && files\.length >= maxFiles;/.test(SRC), 'filesFull derivation');
    assert.ok(/onPaste=\{filesFull \? undefined : onPaste\}/.test(SRC), 'paste ignored when full');
    assert.ok(/disabled=\{filesFull\}/.test(SRC), 'upload button disabled when full');
  });

  it('placeholder prop overrides the default ultraplan placeholder', () => {
    assert.ok(/placeholder=\{placeholder \|\| t\('ui\.ultraplan\.placeholder'\)\}/.test(SRC));
  });
});

describe('UltraplanPanel embedded CSS (add-only rules)', () => {
  it('embedded mode pins the textarea to a fixed height and right-aligns the footer', () => {
    assert.ok(/\.ultraplanPanel\.embedded\s*\{[^}]*position:\s*static/.test(CSS), 'embedded root is statically positioned');
    assert.ok(/\.ultraplanPanel\.embedded \.ultraplanInputBox\s*\{[^}]*flex:\s*none/.test(CSS), 'inputBox must not flex-grow in embedded mode');
    assert.ok(/\.ultraplanPanel\.embedded \.ultraplanTextarea\s*\{[^}]*flex:\s*none;[^}]*height:\s*120px/.test(CSS), 'textarea fixed at 120px');
    assert.ok(/\.ultraplanPanel\.embedded \.ultraplanFooter\s*\{[^}]*justify-content:\s*flex-end/.test(CSS), 'footer right-aligned without the send button');
  });

  it('existing popover rules are untouched (no !important, no edits to the base textarea rule)', () => {
    assert.ok(!/!important/.test(CSS), '!important is forbidden');
    const base = CSS.match(/\.ultraplanTextarea\s*\{([\s\S]*?)\n\}/);
    assert.ok(base, 'base textarea rule located');
    assert.ok(/flex:\s*1 1 0/.test(base[1]), 'base textarea keeps flex grow for the popover hosts');
  });
});
