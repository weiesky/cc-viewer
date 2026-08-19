// DingTalk bridge config — thin back-compat shim over the generic server/lib/im-config.js.
//
// The storage logic is now generic (keyed by platform descriptor); this module preserves the
// original DingTalk-specific public API so server/routes/dingtalk.js and the existing
// dingtalk-config tests keep working unchanged. New platforms use im-config.js directly.
import { getDescriptor, normalize, loadConfig, loadState, saveConfig } from './im-config.js';

export { getPrefsPath, encodeSecret, decodeSecret } from './im-config.js';

export const DEFAULT_DT_CONFIG = getDescriptor('dingtalk').defaults;

export function normalizeDingTalk(cfg) { return normalize('dingtalk', cfg); }
export function loadDingTalkConfig() { return loadConfig('dingtalk'); }
export function loadDingTalkState() { return loadState('dingtalk'); }
export function saveDingTalkConfig(cfg) { return saveConfig('dingtalk', cfg); }
