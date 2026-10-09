/**
 * resume-history-menu.test.js — source anchors for the 2026-10-06 migration that moved
 * the session-history list out of the Header hover dropdowns into the star quick-settings
 * menu (between perm & plan), added a Modal.confirm, and made resume a TRUE /resume switch.
 *
 * AppBase / the menu hosts are React classes/function components that can't be imported into
 * node:test directly, so per house precedent (detach-view-reset.test.js) these are
 * source-anchor assertions that fail loudly if a future refactor drops a link in the chain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const APPBASE = read('src/AppBase.jsx');
const APP = read('src/App.jsx');
const APPHEADER = read('src/components/dashboard/AppHeader.jsx');
const RESUME_POPOVER = read('src/components/chat/ResumeSessionsPopover.jsx');
const QUICK_ROWS = read('src/components/common/QuickAutoApproveRows.jsx');
const RESUME_ROW = read('src/components/common/ResumeSessionsRow.jsx');
const TERMINAL = read('src/components/terminal/TerminalPanel.jsx');
const CHAT_INPUT = read('src/components/chat/ChatInputBar.jsx');
const CHATVIEW = read('src/components/chat/ChatView.jsx');
const MOBILE = read('src/Mobile.jsx');
const RESUME_UTILS = read('src/utils/resumeSessions.js');

describe('star-menu migration — the history row lives after perm and plan', () => {
  it('QuickAutoApproveRows accepts a `middle` node rendered after the plan (index 1) row', () => {
    assert.ok(/middle/.test(QUICK_ROWS), 'QuickAutoApproveRows must accept a middle prop');
    assert.ok(/i === 1 && middle/.test(QUICK_ROWS), 'middle must render right after the plan row');
    assert.ok(/React\.Fragment key=\{row\.key\}/.test(QUICK_ROWS), 'middle must sit inside a keyed Fragment');
  });

  it('ResumeSessionsRow renders the shared ResumeSessionsList in a quickMenu cascade flyout', () => {
    assert.ok(/chrome\.quickMenuGroup/.test(RESUME_ROW) && /chrome\.quickMenuSubWrap/.test(RESUME_ROW), 'must use the cascade group/flyout classes');
    assert.ok(/<ResumeSessionsList/.test(RESUME_ROW), 'must reuse ResumeSessionsList');
    assert.ok(/project=\{project\}/.test(RESUME_ROW), 'must pass project down (follow viewed project)');
    assert.ok(/if \(!onResumeSession\) return null;/.test(RESUME_ROW), 'must render null without a resume handler (local-log)');
  });

  it('both menu hosts (TerminalPanel + ChatInputBar) mount ResumeSessionsRow as the middle node', () => {
    for (const [name, src] of [['TerminalPanel', TERMINAL], ['ChatInputBar', CHAT_INPUT]]) {
      assert.ok(/import ResumeSessionsRow/.test(src), `${name} must import ResumeSessionsRow`);
      assert.ok(/middle=\{[\s\S]{0,400}?<ResumeSessionsRow/.test(src), `${name} must pass ResumeSessionsRow via the middle prop`);
      assert.ok(/'history'/.test(src), `${name} must use the 'history' expanded key`);
    }
  });

  it('ChatView threads the resume handler + viewed project into both hosts and tracks them in SCU', () => {
    assert.ok(/onResumeSession=\{this\.props\.isLocalLog \? null : this\.props\.onResumeSession\}/.test(CHATVIEW), 'ChatView must gate onResumeSession on isLocalLog');
    assert.ok(CHATVIEW.split('onResumeSession={this.props.isLocalLog').length - 1 >= 2, 'ChatView must feed both ChatInputBar and TerminalPanel');
    assert.ok(/nextProps\.viewProject !== this\.props\.viewProject/.test(CHATVIEW), 'ChatView SCU must track viewProject');
    assert.ok(/nextProps\.attachedSid !== this\.props\.attachedSid/.test(CHATVIEW), 'ChatView SCU must track attachedSid');
    assert.ok(/nextProps\.onResumeSession !== this\.props\.onResumeSession/.test(CHATVIEW), 'ChatView SCU must track onResumeSession');
  });

  it('App.jsx passes onResumeSession to ChatView and no longer to AppHeader', () => {
    assert.ok(/onResumeSession=\{this\.handleResumeSession\}/.test(APP), 'App must pass onResumeSession to ChatView');
  });
});

describe('Header dropdown removal — no dangling resume UI in the header', () => {
  it('HeaderResumeDropdown is gone; the single-session branch keeps a plain HeaderProjectLabel', () => {
    assert.ok(!/function HeaderResumeDropdown/.test(APPHEADER), 'HeaderResumeDropdown must be removed');
    assert.ok(/<HeaderProjectLabel projectName=\{currentProject\} \/>/.test(APPHEADER), 'single-session branch must keep the plain project label');
  });

  it('HeaderProjectTabs no longer carries the hover dropdown / resumeOpen / ResumeSessionsList', () => {
    assert.ok(!/resumeOpen/.test(APPHEADER), 'resumeOpen state must be gone');
    assert.ok(!/import \{ ResumeSessionsList \}/.test(APPHEADER), 'ResumeSessionsList import must be gone from AppHeader');
  });

  it('AppHeader no longer references onResumeSession/attachedSid/isStreaming (props or SCU)', () => {
    assert.ok(!/onResumeSession/.test(APPHEADER), 'onResumeSession must be fully removed from AppHeader');
    assert.ok(!/attachedSid/.test(APPHEADER), 'attachedSid must be fully removed from AppHeader');
  });
});

describe('viewed-project scoping + true /resume confirm', () => {
  it('ResumeSessionsList fetches ?project= when given one and re-fetches on project change', () => {
    assert.ok(/qs\.set\('project', project\)/.test(RESUME_POPOVER), 'fetch must append ?project=');
    assert.ok(/\}, \[active, project\]\);/.test(RESUME_POPOVER), 'effect dep array must include project');
  });

  it('AppBase.handleResumeSession runs a centered Modal.confirm before switching', () => {
    const re = /handleResumeSession = \(row\) => \{[\s\S]{0,900}?Modal\.confirm\(\{[\s\S]{0,400}?centered: true/;
    assert.ok(re.test(APPBASE), 'handleResumeSession must open a centered Modal.confirm');
  });

  it('_doResumeSwitch POSTs the true-resume and only then attaches the view (carrying scope)', () => {
    const re = /_doResumeSwitch = async \(uuid\) => \{[\s\S]{0,1600}?await resumeSession\(uuid[\s\S]{0,800}?this\._applyViewAttach\(uuid, \{ project, instance: instanceKey \}\)/;
    assert.ok(re.test(APPBASE), '_doResumeSwitch must call resumeSession then _applyViewAttach with the target scope');
    // Parallel resume keeps the viewed project; bound resume clears it.
    assert.ok(/if \(scopeProject && scopeProject !== this\.state\.projectName\)/.test(APPBASE), '_applyViewAttach must branch on parallel vs bound scope');
    assert.ok(/viewedProject: scopeProject, viewedInstance: scopeInstance/.test(APPBASE), 'parallel resume must keep viewedProject/viewedInstance');
    assert.ok(/viewedProject: null, viewedInstance: null/.test(APPBASE), 'bound resume must clear the parallel view');
    assert.ok(/this\.initSSE\(\{ sid: uuid, project: scopeProject, instance: scopeInstance \}\)/.test(APPBASE), '_applyViewAttach must scope initSSE by the target project');
  });

  it('resumeSession util POSTs /api/resume-session with instanceKey support', () => {
    assert.ok(/export function resumeSession\(/.test(RESUME_UTILS), 'resumeSession util must exist');
    assert.ok(/doFetch\('\/api\/resume-session'/.test(RESUME_UTILS), 'resumeSession must POST /api/resume-session');
    assert.ok(/payload\.instanceKey = instanceKey/.test(RESUME_UTILS), 'resumeSession must carry instanceKey');
    assert.ok(/doReport\('pty\.resume'/.test(RESUME_UTILS), 'resumeSession must reportSwallowed on network failure');
  });

  it('Mobile resume list follows the viewed project', () => {
    assert.ok(/project=\{this\.state\.viewedProject \|\| this\.state\.projectName\}/.test(MOBILE), 'Mobile ResumeSessionsList must pass project');
  });
});
