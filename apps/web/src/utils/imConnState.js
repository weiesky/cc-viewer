// Shared derivation of the IM bridge connection status for the UI. The server reports
// `connection: { running, connected, connectionState?, lastError? }` where `connectionState`
// ('connected' | 'reconnecting' | 'disconnected') is the authoritative tri-state added alongside
// the legacy `connected` boolean; old workers (pre-tri-state builds) omit it, so both functions
// must reproduce the legacy behavior exactly when it is absent.
// Pure and dependency-free so node:test can import it directly.

/**
 * Chip-level state: 'connected' | 'reconnecting' | 'running' | 'error' | 'stopped'.
 * `reconnecting` outranks `lastError` — the server keeps the disconnect cause in lastError while
 * the SDK retries, so error-first ordering would permanently mask the retry state.
 */
export function deriveImConnState(connection) {
  if (!connection) return 'stopped';
  if (connection.connectionState) {
    if (connection.running && connection.connectionState === 'reconnecting') return 'reconnecting';
    if (connection.lastError) return 'error';
    if (connection.running && connection.connectionState === 'connected') return 'connected';
    if (connection.running) return 'running'; // disconnected-while-running without error (legacy parity)
    return 'stopped';
  }
  // Legacy payload (old worker): error → connected → running → stopped.
  if (connection.lastError) return 'error';
  if (connection.running && connection.connected) return 'connected';
  if (connection.running) return 'running';
  return 'stopped';
}

/**
 * Proc-state-aware badge decision shared by ImPlatformSettings.renderBadge and
 * ImConversationModal.renderStatus. Returns null when there is nothing to render, else
 * `{ key, fallback, color, withPort, error }` — the caller supplies its own translation call and
 * appends the port suffix when `withPort`. `color` is the antd Tag color (null = default grey).
 */
export function imBadgeModel({ procState, connection }) {
  // Reconnecting is only meaningful while the worker itself is alive (ready, or remote/no proc info).
  if (connection?.running && connection?.connectionState === 'reconnecting'
    && (!procState || procState === 'ready')) {
    return { key: 'ui.im.statusReconnecting', fallback: 'Reconnecting…', color: 'warning', withPort: procState === 'ready', error: null };
  }
  if (connection?.lastError) {
    return { key: 'ui.im.statusError', fallback: 'Error', color: 'error', withPort: false, error: connection.lastError };
  }
  if (procState) {
    if (procState === 'ready') {
      return connection?.connected
        ? { key: 'ui.im.statusConnected', fallback: 'Connected', color: 'success', withPort: true, error: null }
        : { key: 'ui.im.statusRunning', fallback: 'Running, connecting…', color: 'processing', withPort: true, error: null };
    }
    if (procState === 'booting') return { key: 'ui.im.statusBooting', fallback: 'Starting…', color: 'processing', withPort: false, error: null };
    if (procState === 'hung') return { key: 'ui.im.statusHung', fallback: 'Not responding', color: 'warning', withPort: false, error: null };
    return { key: 'ui.im.statusDisconnected', fallback: 'Disconnected', color: null, withPort: false, error: null }; // dead
  }
  // Remote fallback (no process info in the trimmed LAN response).
  if (!connection) return null;
  if (connection.connected) return { key: 'ui.im.statusConnected', fallback: 'Connected', color: 'success', withPort: false, error: null };
  if (connection.running) return { key: 'ui.im.statusRunning', fallback: 'Running, connecting…', color: 'processing', withPort: false, error: null };
  return { key: 'ui.im.statusDisconnected', fallback: 'Disconnected', color: null, withPort: false, error: null };
}
