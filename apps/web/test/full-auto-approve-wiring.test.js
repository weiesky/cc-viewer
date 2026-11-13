/**
 * full-auto-approve-wiring.test.js — 「完全免审批」(-2) 接线的源码锚点。
 *
 * -2 = 即时放行 + 解除 npm publish 硬闸（仅权限档；Plan 不提供）。这些锚点保证：
 *   1. 两个即时档判定统一走 isInstantAutoApproveValue，不散落 === AUTO_APPROVE_INSTANT
 *      （ChatView 源头直放 / PTY 屏幕检测 / ToolApprovalPanel 兜底）；
 *   2. Plan 即时判定保持 === AUTO_APPROVE_INSTANT（plan 的 -2 永远不即时；
 *      sdk-plan-approval-guard.test.js:51 也锚定同一行）；
 *   3. 档位数组只有 PERM 含 -2；
 *   4. 菜单红色档位样式存在且不含 !important（CLAUDE.md 禁令）。
 *
 * Source-anchor 风格同 sdk-plan-approval-guard.test.js：直接读源码断言，防止未来
 * 重构把某一路径落回 -1-only 比较。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const CHATVIEW = read('src/components/chat/ChatView.jsx');
const PANEL = read('src/components/approval/ToolApprovalPanel.jsx');
const OPTIONS = read('src/utils/autoApproveOptions.js');
const QUICK_ROWS = read('src/components/common/QuickAutoApproveRows.jsx');
const CHROME_CSS = read('src/components/common/sharedChrome.module.css');

describe('instant-tier detection is unified through isInstantAutoApproveValue', () => {
  it('ChatView: PTY prompt host + perm-hook fast path both use the helper', () => {
    const matches = CHATVIEW.match(/isInstantAutoApproveValue\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 isInstantAutoApproveValue call sites in ChatView, got ${matches.length}`);
    assert.ok(
      /isInstantAutoApprove: \(\) => isInstantAutoApproveValue\(this\.props\.autoApproveSeconds\)/.test(CHATVIEW),
      'PTY screen-prompt host must treat -2 as instant',
    );
    assert.ok(
      /isInstantAutoApproveValue\(effAutoSeconds\)/.test(CHATVIEW),
      'perm-hook-pending fast path must treat the server-stamped -2 as instant',
    );
  });

  it('ChatView: plan instant check stays === AUTO_APPROVE_INSTANT (plan never has the -2 tier)', () => {
    assert.ok(
      /if \(seconds === AUTO_APPROVE_INSTANT && !\(autoApproveAt > 0\)\) \{/.test(CHATVIEW),
      '_startPlanAutoApprove must NOT use isInstantAutoApproveValue — a hand-edited plan -2 is inert',
    );
  });

  it('ToolApprovalPanel: localWantsMore + instant fallback both use the helper', () => {
    const matches = PANEL.match(/isInstantAutoApproveValue\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 isInstantAutoApproveValue call sites in ToolApprovalPanel, got ${matches.length}`);
    assert.ok(!/AUTO_APPROVE_INSTANT/.test(PANEL), 'panel must not keep a -1-only comparison');
  });
});

describe('option sets and menu wiring', () => {
  it('PERM options include the full tier; PLAN options never do', () => {
    assert.ok(
      /PERM_AUTO_APPROVE_OPTIONS = \[0, 3, 5, 10, AUTO_APPROVE_INSTANT, AUTO_APPROVE_FULL\]/.test(OPTIONS),
      'perm tiers must end with the full tier',
    );
    assert.ok(
      /PLAN_AUTO_APPROVE_OPTIONS = \[0, 10, 30, 60, AUTO_APPROVE_INSTANT\]/.test(OPTIONS),
      'plan tiers must not gain the full tier',
    );
  });

  it('quick menu: -2 option is danger-tinted and closes the host menu', () => {
    assert.ok(/AUTO_APPROVE_FULL/.test(QUICK_ROWS), 'rows must reference the -2 constant');
    assert.ok(!/Modal\.confirm\(/.test(QUICK_ROWS), 'the confirm lives in AppBase.handleAutoApproveChange, not the renderer');
    assert.ok(/quickMenuOptionDanger/.test(QUICK_ROWS) && /quickMenuValueDanger/.test(QUICK_ROWS), 'danger classes must be applied');
    assert.ok(/onRequestClose/.test(QUICK_ROWS), 'selecting -2 must close the host menu before the confirm opens');
  });

  it('the danger confirm lives in AppBase.handleAutoApproveChange (covers every surface)', () => {
    const APPBASE = read('src/AppBase.jsx');
    assert.ok(
      /if \(seconds === AUTO_APPROVE_FULL && this\.state\.autoApproveSeconds !== AUTO_APPROVE_FULL\)/.test(APPBASE),
      'the guard must fire only when switching INTO -2 from any surface',
    );
    assert.ok(/Modal\.confirm\(\{/.test(APPBASE), 'danger Modal.confirm in the shared handler');
    assert.ok(/autoFocusButton: 'cancel'/.test(APPBASE), 'default focus must be Cancel (held Enter cannot confirm)');
    assert.ok(/okButtonProps: \{ danger: true \}/.test(APPBASE), 'danger OK button');
    assert.ok(/zIndex: 1200/.test(APPBASE), 'dialog must sit above the quick-settings Popover (1030)');
    assert.ok(
      /onOk: \(\) => \{[\s\S]*?updatePreferences\(\{ autoApproveSeconds: seconds \}\)[\s\S]*?\},/.test(APPBASE),
      'the value must only be applied inside onOk — never before the user confirms',
    );
  });
});

describe('danger styling', () => {
  it('sharedChrome defines the danger classes with the error token and no !important', () => {
    assert.ok(/\.quickMenuOption\.quickMenuOptionDanger/.test(CHROME_CSS), 'option danger class');
    assert.ok(/\.quickMenuOptionActive\.quickMenuOptionDanger/.test(CHROME_CSS), 'active+danger double class (specificity over the primary active rule)');
    assert.ok(/\.quickMenuValueDanger/.test(CHROME_CSS), 'current-value danger class');
    assert.ok(/var\(--color-error\)/.test(CHROME_CSS), 'danger classes must use the error token');
    assert.ok(!/!important/.test(CHROME_CSS), 'CLAUDE.md forbids !important');
  });

  it('error tokens exist in both themes', () => {
    const GLOBAL_CSS = read('src/global.css');
    assert.ok(/--color-error:/.test(GLOBAL_CSS), '--color-error defined');
    assert.ok(/--color-error-bg-light:/.test(GLOBAL_CSS), '--color-error-bg-light defined');
  });
});
