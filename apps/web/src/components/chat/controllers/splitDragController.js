/**
 * Drag-resize controller for ChatView's terminal split and nav sidebar.
 *
 * Host-adapter pattern (see askFlowController.js for the reference contract):
 * a plain dependency-injected class — React state stays in ChatView.state and
 * is only touched through the host. No antd/i18n/JSX imports so the module is
 * statically loadable under node:test (the geometry it delegates to lives in
 * utils/splitDragCalc.js, which carries the unit tests).
 *
 * host interface (injected by ChatView at construction):
 *  - getState()            -> live this.state (activeSnapLine/terminalWidth/sidebarWidth)
 *  - setState(update)      -> this.setState
 *  - getSplitRect()        -> innerSplitRef.current?.getBoundingClientRect() ?? null
 *  - persistWidth(key, px) -> localStorage.setItem(key, String(px)) (guarded)
 *
 * The controller owns the drag lifecycle: the document mousemove/mouseup
 * listeners and document.body cursor/userSelect, restored on mouseup AND on
 * dispose() so an unmount mid-drag never leaves the page stuck in col-resize.
 * Render reads dragTarget() to place the snap-line overlay.
 */
import {
  computeTerminalSnapLines,
  computeSidebarSnapLines,
  clampTerminalWidth,
  clampSidebarWidth,
  findActiveSnapLine,
} from '../../../utils/splitDragCalc.js';

export const TERMINAL_WIDTH_STORAGE_KEY = 'cc-viewer-terminal-width';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'cc-viewer-sidebar-width';

export class SplitDragController {
  constructor(host) {
    this.host = host;
    this._resizing = false;
    this._dragTarget = null; // 'terminal' | 'sidebar' | null
    this._onMouseMove = null;
    this._onMouseUp = null;
  }

  dragTarget() {
    return this._dragTarget;
  }

  onTerminalHandleDown(e) {
    e.preventDefault();
    const rect = this.host.getSplitRect();
    const snapLines = rect ? computeTerminalSnapLines(rect.width) : [];
    this._beginDrag('terminal', snapLines, {
      move: (ev, r) => {
        const tw = clampTerminalWidth(r.right, ev.clientX, r.width);
        // Terminal snap distance is measured against the cursor position
        // within the container (the line marks where the divider sits).
        const activeSnapLine = findActiveSnapLine(ev.clientX - r.left, snapLines);
        this.host.setState({ terminalWidth: tw, activeSnapLine });
      },
      up: (state) => {
        if (state.activeSnapLine) {
          const newWidth = state.activeSnapLine.terminalPx;
          this.host.persistWidth(TERMINAL_WIDTH_STORAGE_KEY, newWidth);
          this.host.setState({ terminalWidth: newWidth, isDragging: false, activeSnapLine: null, snapLines: [], needsInitialSnap: false });
        } else {
          this.host.persistWidth(TERMINAL_WIDTH_STORAGE_KEY, state.terminalWidth);
          this.host.setState({ isDragging: false, activeSnapLine: null, snapLines: [], needsInitialSnap: false });
        }
      },
    });
  }

  onSidebarHandleDown(e) {
    e.preventDefault();
    const rect = this.host.getSplitRect();
    const snapLines = rect ? computeSidebarSnapLines(rect.width) : [];
    this._beginDrag('sidebar', snapLines, {
      move: (ev, r) => {
        const sw = clampSidebarWidth(ev.clientX, r.left, r.width);
        // Sidebar snap distance is measured against the clamped width itself.
        const activeSnapLine = findActiveSnapLine(sw, snapLines);
        this.host.setState({ sidebarWidth: sw, activeSnapLine });
      },
      up: (state) => {
        if (state.activeSnapLine) {
          const newWidth = state.activeSnapLine.linePosition;
          this.host.persistWidth(SIDEBAR_WIDTH_STORAGE_KEY, newWidth);
          this.host.setState({ sidebarWidth: newWidth, isDragging: false, activeSnapLine: null, snapLines: [] });
        } else {
          this.host.persistWidth(SIDEBAR_WIDTH_STORAGE_KEY, state.sidebarWidth);
          this.host.setState({ isDragging: false, activeSnapLine: null, snapLines: [] });
        }
      },
    });
  }

  _beginDrag(target, snapLines, { move, up }) {
    this._resizing = true;
    this._dragTarget = target;
    this.host.setState({ isDragging: true, snapLines });

    this._onMouseMove = (ev) => {
      if (!this._resizing) return;
      const rect = this.host.getSplitRect();
      if (!rect) return;
      move(ev, rect);
    };
    this._onMouseUp = () => {
      this._resizing = false;
      this._dragTarget = null;
      up(this.host.getState());
      this._teardownListeners();
    };
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  _teardownListeners() {
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
    this._onMouseMove = null;
    this._onMouseUp = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  dispose() {
    // Unmount mid-drag: drop listeners and restore the page cursor without
    // touching state (the component is going away).
    if (this._resizing || this._onMouseMove) {
      this._resizing = false;
      this._dragTarget = null;
      this._teardownListeners();
    }
  }
}
