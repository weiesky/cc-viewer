/**
 * ask-auto-answer-menu.test.js — source anchors for the「问答题自动托管」(AskUserQuestion
 * auto-answer / hosting) quick-settings row: the third cascade row next to perm/plan,
 * its minute-tier value contract, and the full prop-threading chain AppBase → App/Mobile
 * → ChatView → ChatInputBar/TerminalPanel → QuickAutoApproveRows.
 *
 * The hosts are React classes/function components that can't be imported into node:test,
 * so per house precedent (resume-history-menu.test.js) these are source-anchor
 * assertions that fail loudly if a future refactor drops a link in the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const APPBASE = read('src/AppBase.jsx');
const APP = read('src/App.jsx');
const MOBILE = read('src/Mobile.jsx');
const QUICK_ROWS = read('src/components/common/QuickAutoApproveRows.jsx');
const CHAT_INPUT = read('src/components/chat/ChatInputBar.jsx');
const TERMINAL = read('src/components/terminal/TerminalPanel.jsx');
const CHATVIEW = read('src/components/chat/ChatView.jsx');
const PREFS_FORM = read('src/components/settings/PreferencesForm.jsx');
const APPHEADER = read('src/components/dashboard/AppHeader.jsx');
const OPTIONS = read('src/utils/autoApproveOptions.js');
const ICONS = read('src/components/common/quickMenuIcons.jsx');

describe('ask auto-answer option helpers (value contract)', () => {
  it('minute-tier options + OFF sentinel + converters live in the single source of truth', () => {
    assert.ok(/ASK_AUTO_ANSWER_OFF = -1/.test(OPTIONS), 'OFF sentinel must be -1');
    assert.ok(/ASK_AUTO_ANSWER_OPTIONS = \[0, 10, 20, 30, ASK_AUTO_ANSWER_OFF\]/.test(OPTIONS), 'tiers: 0/10/20/30 min + off');
    assert.ok(/export function askAutoAnswerValueLabel/.test(OPTIONS), 'minute-tier label mapper');
    assert.ok(/export function askAutoAnswerSelectOptions/.test(OPTIONS), 'antd Select options builder');
    assert.ok(/export function askAutoAnswerUiValue/.test(OPTIONS), 'pref → UI sentinel converter');
    assert.ok(/export function askAutoAnswerPrefValue/.test(OPTIONS), 'UI sentinel → pref converter');
    assert.ok(/ASK_AUTO_ANSWER_OFF\) return null/.test(OPTIONS), 'OFF persists null, never -1');
  });
});

describe('QuickAutoApproveRows — the third cascade row', () => {
  it('declares an ask row after perm and plan with minute semantics and a help trigger', () => {
    assert.ok(/key: 'ask'/.test(QUICK_ROWS), 'ask row must exist');
    assert.ok(/ui\.askAutoAnswer\.setting/.test(QUICK_ROWS), 'row label i18n key');
    assert.ok(/ui\.askAutoAnswer\.help/.test(QUICK_ROWS), 'row help i18n key');
    assert.ok(/askAutoAnswerUiValue\(askAutoAnswerMinutes\)/.test(QUICK_ROWS), 'row value must convert persisted null → OFF sentinel (else null highlights the 0-minute tier)');
    assert.ok(/formatLabel/.test(QUICK_ROWS), 'per-row formatter must exist (minute labels ≠ second labels)');
    assert.ok(/AskAnswerIcon/.test(ICONS), 'AskAnswerIcon must exist in quickMenuIcons');
  });

  it('row value AND submenu options both use the per-row formatter', () => {
    // The submenu would otherwise render "0s/10s/20s/30s" via the seconds mapper.
    assert.ok(/formatLabel\(row\.value, t\)/.test(QUICK_ROWS), 'row value must use row.formatLabel');
    assert.ok(/formatLabel\(v, t\)/.test(QUICK_ROWS), 'submenu options must use row.formatLabel');
  });

  it('the (?) help trigger is a stopPropagation span inside a click Tooltip', () => {
    assert.ok(/Tooltip title=\{row\.help\} trigger="click"/.test(QUICK_ROWS), 'click-triggered Tooltip');
    assert.ok(/role="button"/.test(QUICK_ROWS) && /onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(QUICK_ROWS), 'help trigger must not toggle the cascade');
    assert.ok(/QuestionCircleOutlined/.test(QUICK_ROWS), 'question-circle glyph');
  });
});

describe('QuickAutoApproveRows — 完全免审批 (-2) tier', () => {
  it('perm row carries the (?) help explaining 免审批 vs 完全免审批', () => {
    assert.ok(/key: 'perm'/.test(QUICK_ROWS), 'perm row must exist');
    assert.ok(/ui\.permission\.autoApprove\.help/.test(QUICK_ROWS), 'perm row help i18n key');
  });

  it('the -2 option is danger-tinted and the host menu closes before the confirm', () => {
    assert.ok(/AUTO_APPROVE_FULL/.test(QUICK_ROWS), 'rows must reference the -2 constant');
    assert.ok(/quickMenuOptionDanger/.test(QUICK_ROWS), 'the -2 option must get the danger class');
    assert.ok(/quickMenuValueDanger/.test(QUICK_ROWS), 'the current-value bracket must tint at -2');
    assert.ok(/onRequestClose/.test(QUICK_ROWS), 'selecting -2 must close the host menu (confirm dialog opens next)');
  });
});

describe('prop threading chain', () => {
  it('AppBase: initial null, null-aware hydrate, stable handler persisting via pref converter', () => {
    assert.ok(/askAutoAnswerMinutes: null/.test(APPBASE), 'initial approvalPrefs must default to null (off)');
    assert.ok(/data\.approvalModal\.askAutoAnswerMinutes !== undefined/.test(APPBASE), 'hydrate must be null-aware (persisted null is a real value, not "absent")');
    assert.ok(/handleAskAutoAnswerChange = \(uiValue\)/.test(APPBASE), 'stable class-property handler');
    assert.ok(/askAutoAnswerPrefValue\(uiValue\)/.test(APPBASE), 'handler must convert OFF sentinel → null before persisting');
  });

  it('App.jsx threads both props into ChatView', () => {
    assert.ok(/askAutoAnswerMinutes=\{this\.state\.approvalPrefs\?\.askAutoAnswerMinutes\}/.test(APP), 'App must pass askAutoAnswerMinutes');
    assert.ok(/onAskAutoAnswerChange=\{this\.handleAskAutoAnswerChange\}/.test(APP), 'App must pass onAskAutoAnswerChange');
  });

  it('ChatView tracks the tier in SCU and feeds both menu hosts', () => {
    assert.ok(/nextProps\.askAutoAnswerMinutes !== this\.props\.askAutoAnswerMinutes/.test(CHATVIEW), 'SCU must track askAutoAnswerMinutes');
    assert.ok(CHATVIEW.split('askAutoAnswerMinutes={this.props.askAutoAnswerMinutes}').length - 1 >= 2, 'ChatView must feed both ChatInputBar and TerminalPanel');
    assert.ok(CHATVIEW.split('onAskAutoAnswerChange={this.props.onAskAutoAnswerChange}').length - 1 >= 2, 'ChatView must feed both change handlers');
  });

  it('both menu hosts forward the props to QuickAutoApproveRows', () => {
    for (const [name, src] of [['ChatInputBar', CHAT_INPUT], ['TerminalPanel', TERMINAL]]) {
      assert.ok(/askAutoAnswerMinutes=\{(?:this\.props\.)?askAutoAnswerMinutes\}/.test(src), `${name} must pass askAutoAnswerMinutes`);
      assert.ok(/onAskAutoAnswerChange=\{(?:this\.props\.)?onAskAutoAnswerChange\}/.test(src), `${name} must pass onAskAutoAnswerChange`);
    }
  });

  it('Mobile threads both props (ChatView + TerminalPanel) and renders the settings Select', () => {
    assert.ok(MOBILE.split('askAutoAnswerMinutes={this.state.approvalPrefs?.askAutoAnswerMinutes}').length - 1 >= 2, 'Mobile must feed both hosts');
    assert.ok(/askAutoAnswerUiValue\(this\.state\.approvalPrefs\.askAutoAnswerMinutes\)/.test(MOBILE), 'Mobile settings Select must use the sentinel converter');
    assert.ok(/askAutoAnswerSelectOptions\(t\)/.test(MOBILE), 'Mobile settings Select must use minute-tier options');
  });

  it('settings surfaces (PreferencesForm + AppHeader drawer) use the minute-tier Select', () => {
    for (const [name, src] of [['PreferencesForm', PREFS_FORM], ['AppHeader', APPHEADER]]) {
      assert.ok(/ui\.askAutoAnswer\.setting/.test(src), `${name} must render the setting row`);
      assert.ok(/askAutoAnswerSelectOptions\(t\)/.test(src), `${name} must use minute-tier options`);
      assert.ok(/askAutoAnswerUiValue\(/.test(src), `${name} must convert pref → sentinel`);
      assert.ok(/askAutoAnswerPrefValue\(value\)/.test(src), `${name} must convert sentinel → pref on change`);
    }
  });
});

describe('countdown + interrupt chain', () => {
  it('ChatView exposes a stable handleAskAutoCancel and feeds both ChatMessage sites', () => {
    assert.ok(/handleAskAutoCancel = \(askId\) => this\._askFlow\.handleAskAutoCancel\(askId\)/.test(CHATVIEW), 'stable class-property delegate');
    assert.ok(CHATVIEW.split('onAskQuestionAutoCancel={this.handleAskAutoCancel}').length - 1 >= 2, 'both ChatMessage sites must receive onAskQuestionAutoCancel');
  });

  it('ChatView bubbles hosting fields + cancelAutoHosting handler for the modal fallback', () => {
    assert.ok(/askAutoAnswerAt: askMeta\?\.autoAnswerAt \?\? null/.test(CHATVIEW), 'bubbled ask must carry the deadline');
    assert.ok(/cancelAutoHosting: this\.handleAskAutoCancel/.test(CHATVIEW), 'fallback form needs the cancel handler');
  });
});
