/**
 * App-level keepalive loop for /ws/terminal connections.
 *
 * Browsers cannot send WS control-frame pings, and a NAT/proxy can silently
 * half-open this socket: the client watchdog (TerminalWsContext) uses these frames
 * as its liveness signal, and without them a dead socket never fires onclose,
 * freezing every push-only consumer on this channel (sdk-context-usage blood bar,
 * approvals, queue state) until a page refresh.
 *
 * Extracted as its own module so the test seam (server-terminal-ws-ping.test.js)
 * loads ONLY this helper — a full server.js import in the shared test process
 * leaks module state into sibling server tests (same pattern as
 * setTerminalWssForTests, which ws-instance-isolation.test.js drives the same way).
 *
 * Send-only on purpose: a dead connection is skipped (readyState gate) and the
 * client-side watchdog owns close+reconnect, keeping the historical broadcast
 * semantics (skip non-OPEN, heal on reconnect) unchanged.
 */
import { reportSwallowed } from './error-report.js';

export const TERMINAL_WS_PING_MS = 25_000;

export function attachTerminalWsPing(ws, { setI = setInterval, clearI = clearInterval } = {}) {
  // Send the FIRST ping immediately on connect, not after one full interval. The
  // client resets its ping-seen evidence on every (re)connect; if the socket goes
  // half-open during the first 25s window before any ping arrives, the watchdog
  // would have no evidence and stay passive forever — a permanent freeze. An
  // immediate first frame closes that window.
  const sendPing = () => {
    if (ws.readyState !== 1) return;
    // A failed keepalive send is the server's only liveness signal for this socket —
    // report it (dedup-capped per tag, so a dead socket does not flood every 25s).
    try { ws.send(JSON.stringify({ type: 'ping', ts: Date.now() })); }
    catch (err) { reportSwallowed('ws.terminal-ping', err); }
  };
  sendPing();
  const pingTimer = setI(sendPing, TERMINAL_WS_PING_MS);
  pingTimer.unref?.();
  ws.on('close', () => clearI(pingTimer));
  return pingTimer;
}

