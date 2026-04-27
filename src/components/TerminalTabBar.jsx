import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTerminalContext } from './TerminalContext';
import { isMobile } from '../env';
import styles from './TerminalTabBar.module.css';

/**
 * Bottom tab bar for switching between multiple terminals.
 * Mobile: 44px touch targets, horizontal scroll, long-press to close.
 * PC: X close button on each tab, double-click to rename.
 */
export default function TerminalTabBar({ onOpenDashboard }) {
  const { terminals, activeTid, switchTerminal, createTerminal, closeTerminal, renameTerminal, sendMessage } = useTerminalContext();
  const [longPressTarget, setLongPressTarget] = useState(null);
  const longPressTimerRef = useRef(null);
  const scrollRef = useRef(null);

  // Rename state
  const [editingTid, setEditingTid] = useState(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingTid && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTid]);

  const handleTouchStart = useCallback((tid, e) => {
    // Long press detection for close (mobile only)
    longPressTimerRef.current = setTimeout(() => {
      setLongPressTarget(tid);
    }, 600);
  }, []);

  const handleTouchEnd = useCallback((tid) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTabClick = useCallback((tid) => {
    if (longPressTarget) return; // ignore click after long press
    switchTerminal(tid);
  }, [switchTerminal, longPressTarget]);

  // Double-click to enter rename mode
  const handleDoubleClick = useCallback((tid, currentTitle) => {
    setEditingTid(tid);
    setEditValue(currentTitle || '');
  }, []);

  // Confirm rename
  const commitRename = useCallback(() => {
    if (editingTid && editValue.trim()) {
      renameTerminal(editingTid, editValue.trim());
    }
    setEditingTid(null);
    setEditValue('');
  }, [editingTid, editValue, renameTerminal]);

  // Handle rename input key events
  const handleRenameKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      setEditingTid(null);
      setEditValue('');
    }
  }, [commitRename]);

  // PC close confirmation state
  const [pcCloseTarget, setPcCloseTarget] = useState(null);

  const handleClose = useCallback((tid) => {
    closeTerminal(tid);
    setLongPressTarget(null);
    setPcCloseTarget(null);
  }, [closeTerminal]);

  const handlePcCloseRequest = useCallback((tid) => {
    setPcCloseTarget(tid);
  }, []);

  const dismissPcClose = useCallback(() => {
    setPcCloseTarget(null);
  }, []);

  const handleCreate = useCallback(() => {
    createTerminal();
  }, [createTerminal]);

  // Detach a tmux-attached terminal by sending Ctrl+B then 'd' (with 100ms delay)
  const handleDetach = useCallback((tid) => {
    sendMessage({ type: 'input', data: '\x02', tid });
    setTimeout(() => {
      sendMessage({ type: 'input', data: 'd', tid });
    }, 100);
  }, [sendMessage]);

  const dismissLongPress = useCallback(() => {
    setLongPressTarget(null);
  }, []);

  const terminalList = Array.from(terminals.values());

  return (
    <div className={styles.tabBarContainer}>
      {/* Dashboard pull handle */}
      {onOpenDashboard && (
        <button
          className={styles.dashboardHandle}
          onClick={onOpenDashboard}
          aria-label="Open dashboard"
          title="Dashboard"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
      )}

      {/* Scrollable tab area */}
      <div className={styles.tabScroll} ref={scrollRef}>
        {terminalList.map((term, idx) => {
          const isActive = term.tid === activeTid;
          const isExited = term.status === 'exited';
          const isEditing = editingTid === term.tid;
          const isTmux = term.tid.startsWith('tmux-') || (term.title && term.title.startsWith('tmux:'));
          const displayLabel = isTmux
            ? `\u2388 ${term.title || `T${idx + 1}`}`
            : (term.title || `T${idx + 1}`);
          return (
            <button
              key={term.tid}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${isTmux ? styles.tabTmux : ''}`}
              onClick={() => handleTabClick(term.tid)}
              onDoubleClick={() => handleDoubleClick(term.tid, term.title || `T${idx + 1}`)}
              onTouchStart={isMobile ? (e) => handleTouchStart(term.tid, e) : undefined}
              onTouchEnd={isMobile ? () => handleTouchEnd(term.tid) : undefined}
              onTouchMove={isMobile ? handleTouchMove : undefined}
            >
              <span className={`${styles.statusDot} ${isExited ? styles.statusExited : styles.statusRunning}`} />
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className={styles.tabRenameInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  maxLength={32}
                />
              ) : (
                <span className={styles.tabLabel}>
                  {displayLabel}
                </span>
              )}
              {/* Detach button for tmux tabs */}
              {!isEditing && isTmux && (
                <span
                  className={styles.detachBtn}
                  onClick={(e) => { e.stopPropagation(); handleDetach(term.tid); }}
                  title="Detach tmux session"
                >
                  &#x23CF;
                </span>
              )}
              {/* PC: always show close button; Mobile: show only on long press */}
              {!isMobile && !isEditing && (
                <span
                  className={styles.pcCloseBtn}
                  onClick={(e) => { e.stopPropagation(); handlePcCloseRequest(term.tid); }}
                  title="Close terminal"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="2" y1="2" x2="8" y2="8" />
                    <line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
                </span>
              )}
              {isMobile && longPressTarget === term.tid && (
                <span className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); handleClose(term.tid); }}>
                  x
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Close confirmation overlay (mobile long press) */}
      {isMobile && longPressTarget && (
        <div className={styles.longPressOverlay} onClick={dismissLongPress}>
          <div className={styles.longPressCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.longPressText}>Close this terminal?</p>
            <div className={styles.longPressActions}>
              <button className={styles.longPressCancel} onClick={dismissLongPress}>Cancel</button>
              <button className={styles.longPressConfirm} onClick={() => handleClose(longPressTarget)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Close confirmation overlay (PC X button) */}
      {!isMobile && pcCloseTarget && (
        <div className={styles.longPressOverlay} onClick={dismissPcClose}>
          <div className={styles.longPressCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.longPressText}>Close this terminal? Process will be terminated.</p>
            <div className={styles.longPressActions}>
              <button className={styles.longPressCancel} onClick={dismissPcClose}>Cancel</button>
              <button className={styles.longPressConfirm} onClick={() => handleClose(pcCloseTarget)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add terminal button */}
      <button className={styles.addBtn} onClick={handleCreate} aria-label="New terminal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
