// DingTalk bridge — thin back-compat shim.
//
// The bridge logic is now split into the generic orchestrator (server/lib/im-bridge-core.js) and
// the DingTalk adapter (server/lib/adapters/dingtalk-adapter.js). This module preserves the
// original DingTalk-specific public API (and test seams) so server/routes/dingtalk.js, server.js,
// and the existing dingtalk-bridge tests keep working unchanged. Importing it registers the
// DingTalk adapter with the core.
import * as core from './im-bridge-core.js';
import { __setClientFactory } from './adapters/dingtalk-adapter.js';

const ID = 'dingtalk';

// ─── test seams ───
export { __setClientFactory };
export const __setFetchForTests = (fn) => core.__setFetchForTests(fn);
export const __setMaxQueueForTests = (n) => core.__setMaxQueueForTests(ID, n);
export const __resetForTests = () => core.__resetForTests(ID);

// ─── lifecycle (delegate to the core, scoped to the DingTalk platform) ───
export const startBridge = (deps) => core.startBridge(ID, deps);
export const stopBridge = () => core.stopBridge(ID);
export const reloadBridge = (deps) => core.reloadBridge(ID, deps);
export const isBridgeRunning = () => core.isBridgeRunning(ID);
export const getBridgeStatus = () => core.getBridgeStatus(ID);
export const testConnection = (cfg) => core.testConnection(ID, cfg);

// notifyTurnEnd is global (the core routes by which platform owns the in-flight turn).
export const notifyTurnEnd = (sessionId, ts, transcriptPath) => core.notifyTurnEnd(sessionId, ts, transcriptPath);

// ─── pure helpers (re-exported unchanged) ───
export const extractLastAssistantText = core.extractLastAssistantText;
export const chunkText = core.chunkText;
