// Shared proxy-mode detection logic.
// Used by App.jsx (showProxyStatsNav gate) and AppHeader.jsx (menu visibility, Electron tab bar).
//
// "Confirmed proxy" = a non-built-in profile is active, or the built-in Default
// points at a non-official endpoint (same api.anthropic.com test as ProxyModal's
// Max warning). Official subscription → returns false.
export function isProxyMode(activeProxyId, defaultConfig) {
  if (activeProxyId && activeProxyId !== 'max') return true;
  const origin = defaultConfig?.origin || '';
  return !!origin && !/api\.anthropic\.com/i.test(origin);
}
