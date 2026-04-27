import React, { Component } from 'react';
import TerminalContext from './TerminalContext';
import TerminalPanel from './TerminalPanel';
import TerminalTabBar from './TerminalTabBar';
import DashboardOverlay from './DashboardOverlay';
import styles from './MultiTerminalView.module.css';

/**
 * Multi-terminal view wrapper.
 *
 * Manages multiple TerminalPanel instances. Each gets its own DOM container
 * that is shown/hidden via CSS (display: none/block) to preserve xterm.js
 * scrollback buffers. Shares a single WebSocket via TerminalContext.
 *
 * For backward compatibility: if the multi-terminal server protocol is not
 * available (no terminal-list response), falls back to rendering a single
 * TerminalPanel without tid (legacy mode).
 */
class MultiTerminalView extends Component {
  static contextType = TerminalContext;

  constructor(props) {
    super(props);
    this.state = {
      dashboardVisible: false,
      // Track which terminals have been mounted (for lazy initialization)
      mountedTids: new Set(),
    };
    this._containerRef = React.createRef();
    this._wasVisible = false;
  }

  componentDidMount() {
    // Ensure at least one terminal exists. Check after a short delay
    // to let the context populate from server terminal-list response.
    this._initTimer = setTimeout(() => {
      const ctx = this.context;
      if (ctx && ctx.terminals.size === 0) {
        // No terminals from server -- fall back to single-terminal mode.
        // The TerminalPanel component will connect with its own WebSocket.
        this.setState({ legacyMode: true });
      }
    }, 1500);

    // iOS Safari: xterm.js canvas inside a CSS-transformed parent may render
    // blank. Detect when this component's container transitions from hidden
    // (transform: translateX(100%)) to visible and trigger a window resize
    // event so TerminalPanel re-fits the terminal.
    this._visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const isVisible = entry.isIntersecting;
          if (isVisible && !this._wasVisible) {
            // Container just became visible -- trigger resize on next frame
            // so xterm.js re-measures canvas dimensions.
            requestAnimationFrame(() => {
              window.dispatchEvent(new Event('resize'));
            });
          }
          this._wasVisible = isVisible;
        }
      },
      { threshold: 0.1 }
    );
    if (this._containerRef.current) {
      this._visibilityObserver.observe(this._containerRef.current);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // Track mounted tids
    const ctx = this.context;
    if (ctx) {
      const { activeTid, terminals } = ctx;
      if (activeTid && !this.state.mountedTids.has(activeTid)) {
        this.setState((prev) => {
          const next = new Set(prev.mountedTids);
          next.add(activeTid);
          return { mountedTids: next };
        });
      }
    }
  }

  componentWillUnmount() {
    if (this._initTimer) clearTimeout(this._initTimer);
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
    }
  }

  handleOpenDashboard = () => {
    this.setState({ dashboardVisible: true });
  };

  handleCloseDashboard = () => {
    this.setState({ dashboardVisible: false });
  };

  render() {
    const { modelName, onFilePath, onEditorOpen, pendingImages, onRemovePendingImage, onClearPendingImages, getChatScroller, onClearContextOptimistic } = this.props;
    const ctx = this.context;

    // Legacy mode: no multi-terminal support from server
    if (this.state.legacyMode || !ctx) {
      return (
        <div className={styles.container} ref={this._containerRef}>
          <div className={styles.terminalArea}>
            <TerminalPanel
              modelName={modelName}
              onFilePath={onFilePath}
              onEditorOpen={onEditorOpen}
              pendingImages={pendingImages}
              onRemovePendingImage={onRemovePendingImage}
              onClearPendingImages={onClearPendingImages}
              getChatScroller={getChatScroller}
              onClearContextOptimistic={onClearContextOptimistic}
            />
          </div>
        </div>
      );
    }

    const { terminals, activeTid } = ctx;
    const terminalList = Array.from(terminals.values());

    // If no terminals exist yet, show a single legacy TerminalPanel
    // This handles the case where the new protocol is available but
    // no terminals have been created yet.
    if (terminalList.length === 0) {
      return (
        <div className={styles.container} ref={this._containerRef}>
          <div className={styles.terminalArea}>
            <TerminalPanel
              modelName={modelName}
              onFilePath={onFilePath}
              onEditorOpen={onEditorOpen}
              pendingImages={pendingImages}
              onRemovePendingImage={onRemovePendingImage}
              onClearPendingImages={onClearPendingImages}
              getChatScroller={getChatScroller}
              onClearContextOptimistic={onClearContextOptimistic}
            />
          </div>
          <TerminalTabBar onOpenDashboard={this.handleOpenDashboard} />
          <DashboardOverlay
            visible={this.state.dashboardVisible}
            onClose={this.handleCloseDashboard}
          />
        </div>
      );
    }

    return (
      <div className={styles.container} ref={this._containerRef}>
        <div className={styles.terminalArea}>
          {terminalList.map((term) => {
            const isActive = term.tid === activeTid;
            // Only mount terminals that have been active at least once
            const isMounted = this.state.mountedTids.has(term.tid) || isActive;
            if (!isMounted) return null;
            return (
              <div
                key={term.tid}
                className={styles.terminalPane}
                style={{ display: isActive ? 'flex' : 'none' }}
              >
                <TerminalPanel
                  tid={term.tid}
                  modelName={modelName}
                  onFilePath={onFilePath}
                  onEditorOpen={onEditorOpen}
                  pendingImages={isActive ? pendingImages : []}
                  onRemovePendingImage={onRemovePendingImage}
                  onClearPendingImages={onClearPendingImages}
                  getChatScroller={getChatScroller}
                  onClearContextOptimistic={onClearContextOptimistic}
                  isActive={isActive}
                />
              </div>
            );
          })}
        </div>
        <TerminalTabBar onOpenDashboard={this.handleOpenDashboard} />
        <DashboardOverlay
          visible={this.state.dashboardVisible}
          onClose={this.handleCloseDashboard}
        />
      </div>
    );
  }
}

export default MultiTerminalView;
