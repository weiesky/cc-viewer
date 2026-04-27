import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTerminalContext } from './TerminalContext';
import { apiUrl } from '../utils/apiUrl';
import { t } from '../i18n';
import styles from './DashboardOverlay.module.css';

/** Strip ANSI escape sequences from terminal output */
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[hl]/g, '');
}

/**
 * Pull-down dashboard overlay showing all terminal cards with live preview.
 * Slides down from the top of the screen with CSS transform.
 */
export default function DashboardOverlay({ visible, onClose }) {
  const { terminals, activeTid, switchTerminal, createTerminal, closeTerminal, attachTmux, createTmuxSession, openLocalTerminal } = useTerminalContext();
  const [previews, setPreviews] = useState({}); // tid -> string (last 2 lines)
  const [closeConfirmTid, setCloseConfirmTid] = useState(null);
  const [localTerminals, setLocalTerminals] = useState(null); // { tmux: { available, sessions } }
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [showNewTmux, setShowNewTmux] = useState(false);
  const [newTmuxName, setNewTmuxName] = useState('');
  const intervalRef = useRef(null);

  // Detect PC vs mobile for "Open in Terminal.app" button visibility
  const isPC = typeof window !== 'undefined'
    && window.innerWidth > 768
    && !/Mobile|iPhone|iPad|Android/i.test(navigator.userAgent);

  // Fetch preview data from REST API when visible
  const fetchPreviews = useCallback(async () => {
    const tids = Array.from(terminals.keys());
    if (tids.length === 0) return;

    const results = {};
    await Promise.all(
      tids.map(async (tid) => {
        try {
          const res = await fetch(apiUrl(`/api/terminals/${tid}/preview?lines=2`));
          if (res.ok) {
            const data = await res.json();
            results[tid] = data.preview || data.lines || '';
          }
        } catch {
          // Silently fail for individual previews
        }
      })
    );
    setPreviews((prev) => ({ ...prev, ...results }));
  }, [terminals]);

  // Fetch local tmux sessions
  const fetchLocalTerminals = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/local-terminals'));
      if (res.ok) {
        const data = await res.json();
        setLocalTerminals(data);
      }
    } catch {
      // Silently fail - local terminals are optional
    }
  }, []);

  // Poll previews every 1s while visible; local terminals every 5s
  const localIntervalRef = useRef(null);
  useEffect(() => {
    if (visible) {
      fetchPreviews();
      fetchLocalTerminals();
      intervalRef.current = setInterval(fetchPreviews, 1000);
      localIntervalRef.current = setInterval(fetchLocalTerminals, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (localIntervalRef.current) {
        clearInterval(localIntervalRef.current);
        localIntervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (localIntervalRef.current) {
        clearInterval(localIntervalRef.current);
        localIntervalRef.current = null;
      }
    };
  }, [visible, fetchPreviews, fetchLocalTerminals]);

  const handleCardClick = useCallback((tid) => {
    switchTerminal(tid);
    onClose();
  }, [switchTerminal, onClose]);

  const handleCreate = useCallback(() => {
    createTerminal();
    onClose();
  }, [createTerminal, onClose]);

  const handleClose = useCallback((e, tid) => {
    e.stopPropagation();
    setCloseConfirmTid(tid);
  }, []);

  const handleConfirmClose = useCallback(() => {
    if (closeConfirmTid) {
      closeTerminal(closeConfirmTid);
      setCloseConfirmTid(null);
    }
  }, [closeConfirmTid, closeTerminal]);

  const handleCancelClose = useCallback(() => {
    setCloseConfirmTid(null);
  }, []);

  const handleAttach = useCallback((sessionName, readOnly = false) => {
    attachTmux(sessionName, readOnly);
    onClose();
  }, [attachTmux, onClose]);

  const handleCreateTmux = useCallback(() => {
    const name = newTmuxName.trim() || `ccv-${Date.now()}`;
    createTmuxSession(name);
    setShowNewTmux(false);
    setNewTmuxName('');
    onClose();
  }, [newTmuxName, createTmuxSession, onClose]);

  const handleOpenLocal = useCallback((sessionName) => {
    openLocalTerminal(sessionName);
  }, [openLocalTerminal]);

  const terminalList = Array.from(terminals.values());
  const tmux = localTerminals?.tmux;
  const hasTmuxSessions = tmux?.available && tmux.sessions.length > 0;

  // Agent session pattern: split sessions into user vs agent groups
  const AGENT_PATTERN = /^(codex-|lb-|dispatch-|agent-|ce-|pair-|left-brain|right-brain|monitor-|eval-)/i;
  const userSessions = hasTmuxSessions ? tmux.sessions.filter((s) => !AGENT_PATTERN.test(s.name)) : [];
  const agentSessions = hasTmuxSessions ? tmux.sessions.filter((s) => AGENT_PATTERN.test(s.name)) : [];

  const renderSessionCard = (session) => (
    <div key={session.id} className={styles.tmuxCard}>
      <div className={styles.cardHeader}>
        <span className={`${styles.dot} ${session.attached ? styles.dotRunning : styles.dotExited}`} />
        <span className={styles.cardTitle}>{session.name}</span>
        <span className={styles.cardCwd}>
          {session.windows} win{session.windows !== 1 ? 's' : ''} / {session.panes.length} pane{session.panes.length !== 1 ? 's' : ''}
          {session.attached ? ' (attached)' : ''}
        </span>
        {/* Open in Terminal.app - works from any device since API runs on server */}
        {(
          <button
            className={styles.openLocalBtn}
            title="Open in Terminal.app"
            onClick={(e) => { e.stopPropagation(); handleOpenLocal(session.name); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
        <button
          className={styles.attachBtn}
          title={session.attached ? 'Attach (session is also attached elsewhere)' : 'Attach to this tmux session'}
          onClick={(e) => { e.stopPropagation(); handleAttach(session.name, false); }}
        >
          Attach
        </button>
        <button
          className={styles.attachBtnReadOnly}
          title="Attach read-only"
          onClick={(e) => { e.stopPropagation(); handleAttach(session.name, true); }}
        >
          RO
        </button>
      </div>
      {session.panes.map((pane) => (
        <div key={pane.index} className={styles.tmuxPaneInfo}>
          <span className={styles.tmuxPaneLabel}>
            .{pane.index} {pane.command} <span className={styles.tmuxPaneCwd}>{pane.cwd}</span>
          </span>
          {pane.preview && (
            <pre className={styles.tmuxPreview}>{stripAnsi(pane.preview)}</pre>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      {visible && <div className={styles.backdrop} onClick={onClose} />}
      {/* Sliding panel */}
      <div className={`${styles.overlay} ${visible ? styles.overlayVisible : ''}`}>
        <div className={styles.header}>
          <span className={styles.title}>{t('ui.terminal')} ({terminalList.length})</span>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.cardList}>
          {/* Local tmux sessions -- user sessions (always expanded) */}
          {userSessions.length > 0 && (
            <div className={styles.localSection}>
              <div className={styles.localSectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <line x1="2" y1="9" x2="22" y2="9" />
                  <line x1="10" y1="9" x2="10" y2="21" />
                </svg>
                <span>tmux Sessions ({userSessions.length})</span>
                <button
                  className={styles.newTmuxBtn}
                  onClick={() => setShowNewTmux((p) => !p)}
                  title="Create new tmux session"
                >
                  + tmux
                </button>
              </div>
              {showNewTmux && (
                <div className={styles.newTmuxInputRow}>
                  <input
                    className={styles.newTmuxInput}
                    type="text"
                    placeholder="session name"
                    value={newTmuxName}
                    onChange={(e) => setNewTmuxName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTmux(); if (e.key === 'Escape') setShowNewTmux(false); }}
                    autoFocus
                  />
                  <button className={styles.attachBtn} onClick={handleCreateTmux}>Create</button>
                </div>
              )}
              {userSessions.map(renderSessionCard)}
            </div>
          )}
          {/* Local tmux sessions -- agent sessions (collapsible) */}
          {agentSessions.length > 0 && (
            <div className={styles.localSection}>
              <button
                className={styles.agentSessionHeader}
                onClick={() => setAgentExpanded((prev) => !prev)}
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  style={{ transform: agentExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="9 6 15 12 9 18" />
                </svg>
                <span>Agent Sessions</span>
                <span className={styles.agentSessionCount}>{agentSessions.length}</span>
              </button>
              {agentExpanded && agentSessions.map(renderSessionCard)}
            </div>
          )}
          {/* No tmux sessions at all */}
          {tmux?.available && tmux.sessions.length === 0 && (
            <div className={styles.localSection}>
              <div className={styles.localSectionTitle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <line x1="2" y1="9" x2="22" y2="9" />
                  <line x1="10" y1="9" x2="10" y2="21" />
                </svg>
                <span>Local tmux Sessions</span>
                <button
                  className={styles.newTmuxBtn}
                  onClick={() => setShowNewTmux((p) => !p)}
                  title="Create new tmux session"
                >
                  + tmux
                </button>
              </div>
              {showNewTmux && (
                <div className={styles.newTmuxInputRow}>
                  <input
                    className={styles.newTmuxInput}
                    type="text"
                    placeholder="session name"
                    value={newTmuxName}
                    onChange={(e) => setNewTmuxName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTmux(); if (e.key === 'Escape') setShowNewTmux(false); }}
                    autoFocus
                  />
                  <button className={styles.attachBtn} onClick={handleCreateTmux}>Create</button>
                </div>
              )}
              {!showNewTmux && <div className={styles.tmuxEmpty}>No active tmux sessions found</div>}
            </div>
          )}
          {/* Managed terminals */}
          {terminalList.map((term) => {
            const isActive = term.tid === activeTid;
            const isExited = term.status === 'exited';
            const preview = previews[term.tid] || '';
            // Preview might be an array of lines or a string
            const previewText = stripAnsi(Array.isArray(preview) ? preview.join('\n') : String(preview));
            return (
              <div
                key={term.tid}
                className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
                onClick={() => handleCardClick(term.tid)}
              >
                <div className={styles.cardHeader}>
                  <span className={`${styles.dot} ${isExited ? styles.dotExited : styles.dotRunning}`} />
                  <span className={styles.cardTitle}>{term.title || term.tid}</span>
                  <span className={styles.cardCwd}>{term.cwd}</span>
                  <button className={styles.cardClose} onClick={(e) => handleClose(e, term.tid)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <pre className={styles.cardPreview}>{previewText || '...'}</pre>
              </div>
            );
          })}
          {/* New terminal card */}
          <button className={styles.newCard} onClick={handleCreate}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('ui.terminal.addItem')}</span>
          </button>
        </div>
      </div>
      {/* Close confirmation overlay */}
      {closeConfirmTid && (
        <div className={styles.confirmOverlay} onClick={handleCancelClose}>
          <div className={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.confirmText}>Close this terminal? Process will be terminated.</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={handleCancelClose}>Cancel</button>
              <button className={styles.confirmOk} onClick={handleConfirmClose}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
