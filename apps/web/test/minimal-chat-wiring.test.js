/**
 * minimal-chat-wiring.test.js — source-contract test for the "minimal
 * conversation" preference (merge an agent's consecutive tool-only turns into
 * one bubble; utils/toolRunMerge.js is unit-tested separately in
 * tool-run-merge.test.js).
 *
 * Source-string contract style follows queue-bubbles.test.js: render-level
 * tests cannot run under node:test, so we assert the JSX/CSS wiring directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

const chatView = src('components', 'chat', 'ChatView.jsx');
const chatMessage = src('components', 'chat', 'ChatMessage.jsx');
const chatMessageCss = src('components', 'chat', 'ChatMessage.module.css');
const appJsx = src('App.jsx');
const mobileJsx = src('Mobile.jsx');
const appBase = src('AppBase.jsx');
const appHeader = src('components', 'dashboard', 'AppHeader.jsx');
const prefsForm = src('components', 'settings', 'PreferencesForm.jsx');

describe('minimal chat — ChatView wiring', () => {
  it('imports mergeToolRuns and applies it in buildAllItems only in pill mode', () => {
    assert.ok(chatView.includes("import { mergeToolRuns } from '../../utils/toolRunMerge';"));
    assert.ok(/if \(this\.props\.minimalChat && !showFullToolContent\) \{\s*const merged = mergeToolRuns\(rawAllItems, this\._toolRunCache\);/.test(chatView));
  });

  it('remaps tsItemMap through indexMap before _scrollTargetIdx is derived', () => {
    const mergeAt = chatView.indexOf('const merged = mergeToolRuns(');
    const remapAt = chatView.indexOf('tsItemMap[k] = merged.indexMap[tsItemMap[k]]');
    const scrollAt = chatView.indexOf('this._scrollTargetIdx = scrollToTimestamp && tsItemMap[scrollToTimestamp] != null');
    const avatarAt = chatView.indexOf('applyAvatarAnimationTargets(allItems, lastResponseTs)');
    assert.ok(mergeAt > 0 && remapAt > mergeAt && scrollAt > remapAt && avatarAt > remapAt,
      'merge → remap → _scrollTargetIdx / avatar pass ordering');
  });

  it('gates re-render and rebuild on the minimalChat prop', () => {
    assert.ok(chatView.includes('nextProps.minimalChat !== this.props.minimalChat ||'), 'shouldComponentUpdate');
    assert.ok(chatView.includes('|| prevProps.minimalChat !== this.props.minimalChat'), 'componentDidUpdate rebuild branch');
  });

  it('includes minimalChat in the per-session item-cache toggle signature', () => {
    const sig = chatView.match(/const toggleSig = `[^`]*`;/);
    assert.ok(sig, 'toggleSig found');
    // minimalChat is baked into every cached row element, so the cache must
    // invalidate when it flips; "derived per build" only keeps the CACHE raw,
    // not the elements' own props.
    assert.ok(sig[0].includes('minimalChat'), 'cache invalidates on minimalChat toggle');
  });

  it('highlight lookup also matches absorbed run members', () => {
    assert.ok(chatView.includes('(item.props?.runMembers || []).some(m => (m.props?.displayTs || m.props?.timestamp) === highlightTs)'));
  });

  it('owns a _toolRunCache Map', () => {
    assert.ok(chatView.includes('this._toolRunCache = new Map();'));
  });
});

describe('minimal chat — ChatMessage wiring', () => {
  it('uses the shared full-display policy instead of two inline tool-name lists', () => {
    assert.ok(chatMessage.includes("import { isFullDisplayTool } from '../../utils/toolDisplayPolicy';"));
    assert.equal((chatMessage.match(/const fullDisplay = isFullDisplayTool\(tu\.name\);/g) || []).length, 2, 'legacy + in-order renderers');
    assert.ok(!/tu\.name === 'Edit' \|\| tu\.name === 'Write'/.test(chatMessage), 'inline list removed');
  });

  it('shouldComponentUpdate compares the three run props', () => {
    assert.ok(chatMessage.includes('p.runMembers !== n.runMembers || p.runMember !== n.runMember || p.minimalChat !== n.minimalChat'));
  });

  it('render() dispatches run bubbles and run members before the role switch', () => {
    const m = chatMessage.match(/render\(\) \{\s*const \{ role \} = this\.props;\s*if \(this\.props\.runMembers\) return this\.renderToolRun\(\);\s*if \(this\.props\.runMember\) return this\.renderRunMember\(\);/);
    assert.ok(m, 'run dispatch precedes role dispatch');
  });

  it('run members suppress the "tools used" label in both renderers', () => {
    assert.equal((chatMessage.match(/let simplifiedLabelAdded = !!this\.props\.runMember;/g) || []).length, 2);
    assert.ok((chatView.match(/minimalChat=\{this\.props\.minimalChat\}/g) || []).length >= 4, 'ChatView passes minimalChat to bubbles');
  });

  it('run members surface their own call time in the pill popover', () => {
    assert.ok(chatMessage.includes('const runTime = this.props.runMember ? this.formatTime(this.props.timestamp) : null;'));
    assert.ok(chatMessage.includes('{runTime && <div className={styles.toolRunPopoverTime}>{runTime}</div>}'));
  });

  it('absorbed system prompts render as the grey starburst with an accessible label', () => {
    assert.ok(chatMessage.includes('renderSystemNoteIcon() {'));
    assert.ok(/className=\{styles\.toolRunSystemLogo\}\s*role="img"\s*tabIndex=\{0\}\s*aria-label=\{t\('ui\.systemMessage'\)\}\s*dangerouslySetInnerHTML=\{\{ __html: getSvgAvatar\('system'\) \}\}/.test(chatMessage));
  });

  it('shell split: assistant / sub-agent shells are shared by single turns and merged runs', () => {
    assert.ok(chatMessage.includes('_renderAssistantShell(innerContent) {'));
    assert.ok(chatMessage.includes('_renderSubAgentShell(innerContent) {'));
    assert.ok(/renderToolRun\(\) \{[\s\S]*?_renderSubAgentShell\(runMembers\)[\s\S]*?_renderAssistantShell\(runMembers\)/.test(chatMessage));
    // The zero-content early return survives the split.
    assert.ok(/renderAssistantMessage\(\) \{[\s\S]*?if \(innerContent\.length === 0\) return null;\s*return this\._renderAssistantShell\(innerContent\);/.test(chatMessage));
  });

  it('CSS: grey logo overrides the SVG fill via a stylesheet rule (no !important added)', () => {
    assert.ok(chatMessageCss.includes('.toolRunSystemLogo svg path {\n  fill: var(--text-muted);\n}'));
    assert.ok(chatMessageCss.includes('.toolRunPopoverTime {'));
    assert.ok(chatMessageCss.includes('.toolRunSystemBody {'));
    const tail = chatMessageCss.slice(chatMessageCss.indexOf('Minimal chat: merged tool runs'));
    assert.ok(!/!important;/.test(tail), 'no !important in the minimal-chat block');
  });
});

describe('minimal chat — preference plumbing', () => {
  it('AppBase derives the flag (default ON) and exposes a handler', () => {
    assert.ok(appBase.includes('minimalChat: prefs.minimalChat ?? true,'));
    assert.ok(appBase.includes("handleMinimalChatChange = (checked) => {\n    this.context.updatePreferences({ minimalChat: checked });"));
  });

  it('all three switches show ON for fresh installs (unset !== false)', () => {
    assert.ok(appHeader.includes('const minimalChat = _prefs.minimalChat !== false;'), 'AppHeader drawer');
    assert.ok(mobileJsx.includes('checked={prefs.minimalChat !== false}'), 'Mobile sheet');
    assert.ok(prefsForm.includes('checked={v.minimalChat !== false}'), 'PreferencesForm');
  });

  it('desktop and mobile pass minimalChat into ChatView', () => {
    assert.ok(appJsx.includes('minimalChat={prefs.minimalChat}'));
    assert.ok(mobileJsx.includes('minimalChat={prefs.minimalChat}'));
  });

  it('toggle rows exist on all three preference surfaces, nested under pill mode', () => {
    assert.ok(/\{!showFullToolContent && \([\s\S]{0,400}t\('ui\.minimalChat'\)[\s\S]{0,400}updatePreferences\(\{ minimalChat: checked \}\)/.test(appHeader), 'AppHeader drawer');
    assert.ok(/\{!prefs\.showFullToolContent && \([\s\S]{0,300}t\('ui\.minimalChat'\)[\s\S]{0,300}this\.handleMinimalChatChange/.test(mobileJsx), 'Mobile sheet');
    assert.ok(/\{!v\.showFullToolContent && \([\s\S]{0,300}t\('ui\.minimalChat'\)[\s\S]{0,300}patch\(\{ minimalChat: c \}\)/.test(prefsForm), 'PreferencesForm');
  });
});
