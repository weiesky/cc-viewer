import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { TerminalWsContext } from '../terminal/TerminalWsContext';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import {
  SDK_CONTEXT_DISABLED, nextPanelState, sdkContextFrameMatchesView, sdkContextPath,
} from '../../utils/contextUsageView';
import { projectKeyFromCwd } from '../../utils/projectKeyFromCwd';

const SdkContextUsageContext = createContext(SDK_CONTEXT_DISABLED);

export function useSdkContextUsage() {
  return useContext(SdkContextUsageContext);
}

/** One live SDK snapshot shared by the blood bars, drawer and full network panel. */
export function SdkContextUsageProvider({
  enabled = false,
  viewProject = null,
  viewInstance = null,
  clearVersion = 0,
  locked = false,
  optimistic = false,
  children,
}) {
  const ws = useContext(TerminalWsContext);
  const [state, dispatch] = useReducer(nextPanelState, { detail: null, status: 'disabled', lastTs: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [awaitingFresh, setAwaitingFresh] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(true);
  const scopeRef = useRef({});
  const requestRef = useRef(null);
  const queuedRefreshRef = useRef(null);
  const lastScopeRef = useRef('');
  const confirmedInstanceRef = useRef(null);
  const clearRef = useRef(clearVersion);
  const clearConfirmedRef = useRef(true);
  const clearTimerRef = useRef(null);
  const active = !!enabled && !!viewProject;
  const scopeKey = `${active ? '1' : '0'}\0${viewProject || ''}\0${viewInstance || ''}`;
  if (lastScopeRef.current === scopeKey && scopeRef.current.key) {
    scopeRef.current = { ...scopeRef.current, active, viewProject, viewInstance: viewInstance || confirmedInstanceRef.current };
  }

  const clearClearTimer = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const resetClearHold = useCallback(() => {
    clearClearTimer();
    clearConfirmedRef.current = true;
    setClearConfirmed(true);
    setAwaitingFresh(false);
  }, [clearClearTimer]);

  const cancel = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    queuedRefreshRef.current = null;
    if (request) request.controller.abort();
    setRefreshing(false);
  }, []);

  const refresh = useCallback(async (options = {}) => {
    const scope = { ...scopeRef.current };
    if (!scope.active) return;
    if (requestRef.current) {
      // Recovery triggers must not disappear into an older in-flight read. Keep one rerun;
      // repeated turn-end frames or a double-click do not create a request storm.
      if (options.retry) queuedRefreshRef.current = { ...options, scope };
      return requestRef.current.promise;
    }
    const controller = new AbortController();
    const request = { controller, startedAt: Date.now(), scope, promise: null };
    requestRef.current = request;
    setRefreshing(true);
    request.promise = (async () => {
      try {
        const res = await fetch(apiUrl(sdkContextPath(scope.viewProject, scope.viewInstance)), { signal: controller.signal });
        const body = await res.json();
        if (requestRef.current !== request || !scopeRef.current.active) return;
        const snapshot = body?.snapshot;
        if (snapshot && !sdkContextFrameMatchesView(snapshot, {
          project: scope.viewProject,
          instance: scope.viewInstance || snapshot.instanceKey,
        })) {
          dispatch({ kind: 'http-error' });
          return;
        }
        if (snapshot?.instanceKey && (!scope.viewInstance || snapshot.instanceKey === scope.viewInstance)) {
          if (!scope.explicitInstance) {
            confirmedInstanceRef.current = snapshot.instanceKey;
            scopeRef.current.viewInstance = snapshot.instanceKey;
          }
        }
        dispatch({ kind: 'http', body, startedAt: request.startedAt });
        if (snapshot?.usage && clearConfirmedRef.current) {
          resetClearHold();
        } else if (body?.reason === 'session-inactive' && !scope.explicitInstance && scope.viewInstance) {
          // A learned instance can die while the project remains live (relaunch/restart).
          // Drop only the inferred identity and re-resolve by project; an explicit pin never
          // falls through to another instance.
          confirmedInstanceRef.current = null;
          scopeRef.current.viewInstance = null;
          queuedRefreshRef.current = { retry: true, scope: { ...scopeRef.current } };
        }
        if (requestRef.current === request && queuedRefreshRef.current) {
          requestRef.current = null;
          setRefreshing(false);
          const queued = queuedRefreshRef.current;
          queuedRefreshRef.current = null;
          scopeRef.current = queued.scope;
          refresh({ retry: true });
        }
      } catch (err) {
        if (requestRef.current !== request || controller.signal.aborted) return;
        reportSwallowed('sdk-context-usage.fetch', err);
        dispatch({ kind: 'http-error' });
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null;
          setRefreshing(false);
          const queued = queuedRefreshRef.current;
          queuedRefreshRef.current = null;
          if (queued && scopeRef.current.active) {
            setTimeout(() => { if (scopeRef.current.active) refresh({ retry: true }); }, 0);
          }
        }
      }
    })();
    return request.promise;
  }, [resetClearHold]);

  useEffect(() => {
    if (lastScopeRef.current === scopeKey) return;
    lastScopeRef.current = scopeKey;
    confirmedInstanceRef.current = null;
    cancel();
    resetClearHold();
    // Derive the request scope from the new props, not the previous render's learned instance.
    scopeRef.current = { key: scopeKey, active, viewProject, viewInstance, explicitInstance: !!viewInstance };
    dispatch({ kind: 'reset', status: active ? 'loading' : 'disabled' });
    if (active) refresh();
  }, [active, scopeKey, viewProject, viewInstance, cancel, refresh, resetClearHold]);

  useEffect(() => {
    if (clearRef.current === clearVersion) return;
    clearRef.current = clearVersion;
    if (!scopeRef.current.active) return;
    cancel();
    clearConfirmedRef.current = false;
    setClearConfirmed(false);
    setAwaitingFresh(true);
    clearClearTimer();
    clearTimerRef.current = setTimeout(() => {
      // Missing clear confirmation must not pin the bar at zero forever. The normal WS clear
      // path is immediate; this is only the bounded recovery for a dead/lost control channel.
      resetClearHold();
      refresh({ retry: true });
    }, 30000);
    refresh({ retry: true });
  }, [clearVersion, cancel, refresh, clearClearTimer, resetClearHold]);

  useEffect(() => {
    const offMsg = ws.addMessageHandler((msg) => {
      try {
        if (msg?.type !== 'sdk-context-usage' || !scopeRef.current.active) return;
        const scope = scopeRef.current;
        const matches = sdkContextFrameMatchesView(msg, { project: scope.viewProject, instance: scope.viewInstance });
        if (!matches) {
          const sameProject = projectKeyFromCwd(msg.cwd) === scope.viewProject;
          if (sameProject && msg.instanceKey) {
            if (!scope.explicitInstance && scope.viewInstance && scope.viewInstance !== msg.instanceKey) {
              confirmedInstanceRef.current = null;
              scopeRef.current.viewInstance = null;
            }
            if (!scopeRef.current.viewInstance) refresh({ retry: true });
          }
          return;
        }
        if (!msg.usage) {
          // Any accepted server clear (including another client's /clear) is authoritative.
          // Do not fall back to the request-derived pre-clear percentage while awaiting fresh usage.
          clearConfirmedRef.current = true;
          setClearConfirmed(true);
          setAwaitingFresh(true);
          clearClearTimer();
          clearTimerRef.current = setTimeout(() => {
            resetClearHold();
            refresh({ retry: true });
          }, 30000);
        }
        dispatch({ kind: 'ws', frame: msg });
        if (msg.usage && clearConfirmedRef.current) resetClearHold();
      } catch (err) { reportSwallowed('sdk-context-usage.ws', err); }
    });
    const offState = ws.addStateListener((next) => {
      if (next === 'open' && scopeRef.current.active) refresh({ retry: true });
    });
    return () => { offMsg(); offState(); };
  }, [ws, refresh, clearClearTimer, resetClearHold]);

  useEffect(() => () => {
    clearClearTimer();
    cancel();
  }, [cancel, clearClearTimer]);

  const value = useMemo(() => ({
    enabled: active,
    locked: active && locked,
    optimistic: active && optimistic,
    awaitingFresh: active && awaitingFresh,
    clearConfirmed: active && clearConfirmed,
    status: active ? state.status : 'disabled',
    detail: active ? state.detail : null,
    refreshing,
    refresh,
  }), [active, locked, optimistic, awaitingFresh, clearConfirmed, state, refreshing, refresh]);

  return <SdkContextUsageContext.Provider value={value}>{children}</SdkContextUsageContext.Provider>;
}
