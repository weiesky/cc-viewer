import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { apiUrl } from '../utils/apiUrl';

const TerminalContext = createContext(null);

let _tidCounter = 0;
function generateTid() {
  _tidCounter += 1;
  return `term-${Date.now()}-${_tidCounter}`;
}

export function TerminalProvider({ children }) {
  // terminals: Map<tid, {tid, status, cwd, createdAt, title}>
  const [terminals, setTerminals] = useState(new Map());
  const [activeTid, setActiveTid] = useState(null);
  const wsRef = useRef(null);
  const dataListenersRef = useRef(new Map()); // tid -> callback(data)
  const stateListenersRef = useRef(new Map()); // tid -> callback(msg)
  const pendingSubscribes = useRef([]);

  // Build WebSocket connection (shared across all terminals)
  const getWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }
    return null;
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal${token ? `?token=${token}` : ''}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Request terminal list on connect
      ws.send(JSON.stringify({ type: 'terminal-list' }));
      // Re-subscribe to any pending terminals
      for (const tid of pendingSubscribes.current) {
        ws.send(JSON.stringify({ type: 'terminal-subscribe', tid }));
      }
      pendingSubscribes.current = [];
      // Re-subscribe all active listeners (handles reconnect --
      // server only auto-subscribes default, so non-default terminals
      // would lose their data stream without this)
      for (const tid of dataListenersRef.current.keys()) {
        ws.send(JSON.stringify({ type: 'terminal-subscribe', tid }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'terminal-list') {
          // Populate known terminals from server
          const newMap = new Map();
          if (Array.isArray(msg.terminals)) {
            for (const t of msg.terminals) {
              newMap.set(t.tid, {
                tid: t.tid,
                status: t.running === false ? 'exited' : 'running',
                cwd: t.cwd || '',
                createdAt: t.createdAt || Date.now(),
                title: t.label || (t.cwd ? t.cwd.split('/').pop() : `Terminal`),
              });
            }
          }
          setTerminals(newMap);
          // If no active terminal but we have terminals, pick the first
          if (newMap.size > 0) {
            setActiveTid((prev) => {
              if (prev && newMap.has(prev)) return prev;
              return newMap.keys().next().value;
            });
          }
          return;
        }

        if (msg.type === 'terminal-created') {
          setTerminals((prev) => {
            const next = new Map(prev);
            next.set(msg.tid, {
              tid: msg.tid,
              status: 'running',
              cwd: msg.cwd || '',
              createdAt: Date.now(),
              title: msg.cwd ? msg.cwd.split('/').pop() : `Terminal`,
            });
            return next;
          });
          return;
        }

        if (msg.type === 'terminal-closed') {
          setTerminals((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.tid);
            if (existing) {
              next.set(msg.tid, { ...existing, status: 'exited' });
            }
            return next;
          });
          return;
        }

        // tmux-session-created: server handles auto-open Terminal.app
        if (msg.type === 'tmux-session-created') {
          return;
        }

        // Handle terminal-error: rollback optimistic terminal creation
        if (msg.type === 'terminal-error') {
          setTerminals((prev) => {
            const next = new Map(prev);
            if (msg.tid && next.has(msg.tid)) {
              next.delete(msg.tid);
            }
            return next;
          });
          // If the errored terminal was active, switch to another
          setActiveTid((prevTid) => {
            if (prevTid !== msg.tid) return prevTid;
            // Pick another terminal
            return null; // will be resolved by terminal-list update
          });
          return;
        }

        // Handle terminal-agnostic messages (no tid) before tid routing
        if (msg.type === 'toast' || msg.type === 'editor-open') {
          // Broadcast to all registered state listeners
          for (const listener of stateListenersRef.current.values()) {
            try { listener(msg); } catch {}
          }
          return;
        }

        // Route data/state/exit to specific terminal listeners
        if (msg.tid) {
          if (msg.type === 'data') {
            const listener = dataListenersRef.current.get(msg.tid);
            if (listener) listener(msg.data);
          } else if (msg.type === 'state' || msg.type === 'exit') {
            const listener = stateListenersRef.current.get(msg.tid);
            if (listener) listener(msg);
            if (msg.type === 'exit') {
              setTerminals((prev) => {
                const next = new Map(prev);
                const existing = next.get(msg.tid);
                if (existing) {
                  next.set(msg.tid, { ...existing, status: 'exited' });
                }
                return next;
              });
            }
          }
        } else {
          // Legacy single-terminal messages (no tid) -- route to active terminal
          // This provides backward compatibility with the existing server
          const tid = activeTidRef.current;
          if (tid) {
            if (msg.type === 'data') {
              const listener = dataListenersRef.current.get(tid);
              if (listener) listener(msg.data);
            } else if (msg.type === 'state' || msg.type === 'exit') {
              const listener = stateListenersRef.current.get(tid);
              if (listener) listener(msg);
            }
          }
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Reconnect after delay
      setTimeout(() => {
        connectWs();
      }, 2000);
    };

    wsRef.current = ws;
  }, []);

  // Keep a ref of activeTid for use in ws.onmessage callback
  const activeTidRef = useRef(activeTid);
  useEffect(() => {
    activeTidRef.current = activeTid;
  }, [activeTid]);

  // Connect on mount
  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  const sendMessage = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const createTerminal = useCallback((cwd) => {
    const tid = generateTid();
    sendMessage({ type: 'terminal-create', tid, cwd: cwd || '' });
    // Optimistically add to local state
    setTerminals((prev) => {
      const next = new Map(prev);
      next.set(tid, {
        tid,
        status: 'running',
        cwd: cwd || '',
        createdAt: Date.now(),
        title: cwd ? cwd.split('/').pop() : `Terminal`,
      });
      return next;
    });
    setActiveTid(tid);
    // Subscribe to this terminal's output
    sendMessage({ type: 'terminal-subscribe', tid });
    return tid;
  }, [sendMessage]);

  const closeTerminal = useCallback((tid) => {
    sendMessage({ type: 'terminal-close', tid });
    // Remove terminal and switch active if needed
    setTerminals((prev) => {
      const next = new Map(prev);
      next.delete(tid);
      // Also update activeTid based on the updated terminals map
      setActiveTid((prevTid) => {
        if (prevTid !== tid) return prevTid;
        const keys = Array.from(next.keys());
        return keys.length > 0 ? keys[keys.length - 1] : null;
      });
      return next;
    });
    // Cleanup listeners
    dataListenersRef.current.delete(tid);
    stateListenersRef.current.delete(tid);
  }, [sendMessage]);

  const switchTerminal = useCallback((tid) => {
    setActiveTid(tid);
  }, []);

  const renameTerminal = useCallback((tid, newLabel) => {
    if (!newLabel || !newLabel.trim()) return;
    const label = newLabel.trim();
    // Update local state immediately
    setTerminals((prev) => {
      const next = new Map(prev);
      const existing = next.get(tid);
      if (existing) {
        next.set(tid, { ...existing, title: label });
      }
      return next;
    });
    // Send rename request to server
    sendMessage({ type: 'terminal-rename', tid, label });
  }, [sendMessage]);

  const registerDataListener = useCallback((tid, callback) => {
    dataListenersRef.current.set(tid, callback);
    return () => dataListenersRef.current.delete(tid);
  }, []);

  const registerStateListener = useCallback((tid, callback) => {
    stateListenersRef.current.set(tid, callback);
    return () => stateListenersRef.current.delete(tid);
  }, []);

  const subscribeTerminal = useCallback((tid) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal-subscribe', tid }));
    } else {
      pendingSubscribes.current.push(tid);
    }
  }, []);

  const attachTmux = useCallback((sessionName, readOnly = false) => {
    const tid = `tmux-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    sendMessage({ type: 'terminal-attach-tmux', tid, session: sessionName, readOnly });
    // Optimistically add to local state
    setTerminals((prev) => {
      const next = new Map(prev);
      next.set(tid, {
        tid,
        status: 'running',
        cwd: '',
        createdAt: Date.now(),
        title: `tmux: ${sessionName}`,
      });
      return next;
    });
    setActiveTid(tid);
    // Subscribe to this terminal's output
    sendMessage({ type: 'terminal-subscribe', tid });
    return tid;
  }, [sendMessage]);

  const createTmuxSession = useCallback((sessionName, cwd) => {
    sendMessage({ type: 'terminal-create-tmux', sessionName, cwd });
  }, [sendMessage]);

  const openLocalTerminal = useCallback(async (sessionName) => {
    try {
      await fetch(apiUrl('/api/open-local-terminal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName }),
      });
    } catch { /* best-effort */ }
  }, []);

  const value = {
    terminals,
    activeTid,
    createTerminal,
    closeTerminal,
    switchTerminal,
    renameTerminal,
    attachTmux,
    createTmuxSession,
    openLocalTerminal,
    sendMessage,
    getWs,
    registerDataListener,
    registerStateListener,
    subscribeTerminal,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalContext() {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error('useTerminalContext must be used within TerminalProvider');
  }
  return ctx;
}

export default TerminalContext;
