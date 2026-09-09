/**
 * 全局分区拖拽反馈（zone-based drag overlay）的源码契约测试。
 *
 * 无 jsdom 环境，读源码断言关键接线：
 * 1. AppBase 的 dragZone 状态机（modal 抑制 / 内部移动抑制 / 分区门禁）；
 * 2. App.jsx 移除全屏 overlay、改写 data-external-drag-zone;Mobile 保留旧 overlay；
 * 3. ChatView 双 zone marker + dropZoneMask;CSS 用 :global 属性选择器点亮且无 !important；
 * 4. dragGuards.isOverModalPortal 的弹层选择器。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isOverModalPortal } from '../src/utils/dragGuards.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const APP_BASE = readFileSync(join(SRC, 'AppBase.jsx'), 'utf-8');
const APP = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
const MOBILE = readFileSync(join(SRC, 'Mobile.jsx'), 'utf-8');
const CHAT_VIEW = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const CHAT_CSS = readFileSync(join(SRC, 'components', 'chat', 'ChatView.module.css'), 'utf-8');
const DRAG_GUARDS = readFileSync(join(SRC, 'utils', 'dragGuards.js'), 'utf-8');

describe('dragGuards.isOverModalPortal', () => {
  it('detects antd modal/drawer/image-preview portals by event target', () => {
    assert.ok(DRAG_GUARDS.includes('.ant-modal-root, .ant-drawer, .ant-image-preview-root'),
      'portal selector must cover antd Modal / Drawer / Image preview');
    assert.ok(DRAG_GUARDS.includes('e.target.closest'),
      'detection must be target-based (rc-dialog keeps closed modals mounted)');
    assert.ok(DRAG_GUARDS.includes('export function isOverModalPortal'),
      'isOverModalPortal must be exported');
  });

  it('unit: true over a portal, false elsewhere, false on malformed events', () => {
    const el = (cls) => ({ closest: (sel) => (cls && sel.includes(cls) ? {} : null) });
    assert.equal(isOverModalPortal({ target: el('.ant-modal-root') }), true);
    assert.equal(isOverModalPortal({ target: el('.ant-drawer') }), true);
    assert.equal(isOverModalPortal({ target: el('.chatSection') }), false);
    assert.equal(isOverModalPortal({ target: null }), false);
    assert.equal(isOverModalPortal({}), false);
    assert.equal(isOverModalPortal(null), false);
  });
});

describe('AppBase drag state machine', () => {
  it('tracks dragZone state and only setStates on change', () => {
    assert.ok(APP_BASE.includes('dragZone: null'), 'dragZone state missing');
    assert.ok(APP_BASE.includes('_setDragZone'), 'guarded setter missing');
    assert.ok(APP_BASE.includes('if (this.state.dragZone !== zone)'),
      '_setDragZone must no-op when the zone is unchanged (dragover fires continuously)');
  });
  it('imports isOverModalPortal and suppresses drags over modal portals', () => {
    assert.ok(APP_BASE.includes("from './utils/dragGuards'"), 'dragGuards import missing');
    assert.ok(APP_BASE.includes('isOverModalPortal(e)'),
      'dragover/drop must bail when the pointer is over an antd portal');
  });
  it('internal tree moves never light the global zones', () => {
    assert.ok(APP_BASE.includes("e.dataTransfer.types.includes('text/x-internal-move')"),
      '_onDragOver must short-circuit tree-internal moves');
  });
  it('resolves the chat zone from the dragover target marker', () => {
    assert.ok(APP_BASE.includes(`e.target.closest('[data-drop-zone="chat"]')`),
      'dragover must look up the data-drop-zone="chat" marker');
    assert.ok(APP_BASE.includes(`this._setDragZone(overChat ? 'chat' : null)`),
      'zone must clear outside responsive regions');
  });
  it('mobile keeps the legacy full-screen overlay path', () => {
    // Anchor to the branch body — a bare 'if (isMobile) {' matches 4 other
    // sites in AppBase.jsx and would survive deletion of this early-return.
    assert.ok(APP_BASE.includes("if (isMobile) {\n      if (!this.state.isDragging) this.setState({ isDragging: true });"),
      'mobile must early-return into the legacy isDragging overlay inside _onDragOver');
  });
  it('desktop drop is zone-gated (non-responsive regions reject silently)', () => {
    assert.ok(APP_BASE.includes("if (!isMobile && dragZone !== 'chat') return;"),
      'drops outside the chat zone must be rejected on desktop');
    // Slice each handler body before asserting — the reset string exists in
    // more than one handler, so a file-wide includes() can't pin _onDragLeave.
    const leaveStart = APP_BASE.indexOf('_onDragLeave = (e) => {');
    const leaveBody = APP_BASE.slice(leaveStart, leaveStart + 400);
    assert.ok(leaveBody.includes('this.setState({ isDragging: false, dragZone: null });'),
      '_onDragLeave must reset both isDragging and dragZone');
    const dropStart = APP_BASE.indexOf('_onDrop = (e) => {');
    const dropBody = APP_BASE.slice(dropStart, dropStart + 400);
    assert.ok(dropBody.includes('this.setState({ isDragging: false, dragZone: null });'),
      '_onDrop must reset both isDragging and dragZone');
  });
  it('drag-abort safety net: document-level dragend/drop reset is registered and removed', () => {
    // Esc / focus-loss cancel a drag without dragleave — without this the chat
    // mask stays lit until the next dragover (and through preset-reorder drags).
    assert.ok(APP_BASE.includes("document.addEventListener('dragend', this._resetDragFeedback)"),
      'componentDidMount must register the dragend reset');
    assert.ok(APP_BASE.includes("document.removeEventListener('dragend', this._resetDragFeedback)"),
      'componentWillUnmount must remove the dragend reset');
  });
});

describe('App vs Mobile overlay split', () => {
  it('App no longer renders the full-screen overlay and exposes the zone attribute', () => {
    assert.ok(!APP.includes('styles.dragOverlay'),
      'App.jsx must not render the legacy full-screen dragOverlay');
    assert.ok(APP.includes('data-external-drag-zone={this.state.dragZone || undefined}'),
      'Layout must publish dragZone as data-external-drag-zone');
  });
  it('Mobile keeps the legacy overlay and never sets the zone attribute', () => {
    assert.ok(MOBILE.includes('styles.dragOverlay'),
      'Mobile must keep its legacy full-screen overlay');
    assert.ok(!MOBILE.includes('data-external-drag-zone'),
      'Mobile must not publish the zone attribute (masks stay hidden)');
  });
});

describe('ChatView drop zones', () => {
  it('chat section and terminal wrap both carry the chat zone marker', () => {
    const markers = CHAT_VIEW.split('data-drop-zone="chat"').length - 1;
    assert.ok(markers >= 2, `expected ≥2 data-drop-zone="chat" markers (chat + terminal), got ${markers}`);
    // The marker and the mask must sit on the same element, or the mask's
    // inset:0 references a narrower inner box and leaves an unlit strip.
    assert.ok(CHAT_VIEW.includes('<div className={styles.chatSection} data-drop-zone="chat">'),
      'chat zone marker must be on .chatSection (the mask positioning context)');
    assert.ok(CHAT_VIEW.includes('data-drop-zone="chat">\n                {/*'),
      'terminal zone marker must sit on .terminalPanelWrap with its mask');
  });
  it('renders an always-present mask node in each zone reusing ui.dragDropHint', () => {
    const masks = CHAT_VIEW.split('styles.dropZoneMask').length - 1;
    assert.ok(masks >= 2, `expected ≥2 dropZoneMask nodes, got ${masks}`);
    assert.ok(CHAT_VIEW.includes("t('ui.dragDropHint')"),
      'zone masks must reuse the existing ui.dragDropHint key');
  });
  it('mask is CSS-driven by the global attribute; the new rules use no !important', () => {
    assert.ok(CHAT_CSS.includes(".dropZoneMask"), 'dropZoneMask rule missing');
    assert.ok(CHAT_CSS.includes(":global([data-external-drag-zone='chat']) .dropZoneMask"),
      'mask must light up only under data-external-drag-zone="chat"');
    assert.ok(CHAT_CSS.includes('pointer-events: none'),
      'mask must not intercept drag/pointer events');
    // 仅约束本次新增的规则块（该文件历史遗留的 !important 不在本次范围）。
    // 从规则块起点截取到 :global 规则块结束为止。
    const maskStart = CHAT_CSS.indexOf('.dropZoneMask');
    const globalEnd = CHAT_CSS.indexOf('}', CHAT_CSS.indexOf(":global([data-external-drag-zone='chat'])"));
    const maskBlock = CHAT_CSS.slice(maskStart, globalEnd + 1);
    assert.ok(!maskBlock.includes('!important'), 'the new dropZoneMask rules must not use !important');
    assert.ok(maskBlock.includes('pointer-events: none'),
      'the dropZoneMask rule itself must carry pointer-events: none (file-wide check would be vacuous)');
  });
  it('terminalPanelWrap is the positioning context for its mask', () => {
    assert.ok(/\.terminalPanelWrap\s*\{[^}]*position:\s*relative/.test(CHAT_CSS),
      'terminalPanelWrap must be position:relative so the absolute mask covers it');
    // chatSection must also be the mask's containing block, or the 5px
    // .vResizer divider stays unlit between sidebar and chat zone.
    assert.ok(/\.chatSection\s*\{[^}]*position:\s*relative/.test(CHAT_CSS),
      'chatSection must be position:relative (mask + zone marker live on it)');
  });
});
