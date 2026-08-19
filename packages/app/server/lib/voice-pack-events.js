// CLIENT-SAFE: no node deps. Imported by src/ — do not add fs/process/node: imports.
// Single source of truth for voice-pack event keys + their default bindings.
//
// Why a shared module: this list was previously duplicated across
//   - server/lib/voice-pack-manager.js (EVENT_KEYS for whitelist + reconcile)
//   - server/server.js (preferences merge / reconcile)
//   - src/AppBase.jsx (initial state default)
//   - src/components/settings/VoicePackSettings.jsx (UI rows + reset handler)
//   - scripts/gen-placeholder-voicepack.js (pattern table keys)
//   - src/components/chat/AskTimeoutCountdown.jsx (threshold list keys)
// Adding a 6th event meant editing 5+ files and any miss silently dropped audio
//(). All consumers now import from here.

// 注：timeoutWarning5min / timeoutWarning60s 已删除。AskUserQuestion 实质 24h 无超时后
// 倒计时不再渲染（AskTimeoutCountdown.jsx isInfiniteTimeout → null），剩余时间预警事件失去意义。
// 老用户 preferences.json 含这两个 key 由 server/lib/approval-modal-prefs.js _filterEvents 白名单
// 自动 strip，零迁移工作量。孤儿 audio 文件留待 cleanup CLI（backlog）。
export const EVENT_KEYS = [
  'planApproval',
  'askQuestion',
  'turnEnd',
];

// Per-event default binding when no user override is set:
//   - 'default' → play the bundled default-pack (butler) audio
//   - 'sanguo'  → play the bundled sanguo (三国) audio — initial seed for zh/zh-TW
//   - null      → event is OFF by default (user must opt in)
// turnEnd defaults to null because firing on every Claude reply is noisy
//( — frequency overload mitigation).
export const DEFAULT_BINDINGS = Object.freeze({
  planApproval: 'default',
  askQuestion: 'default',
  turnEnd: null,
});

// Bundled packs that ship inside the npm tarball under public/voice-packs/<id>/.
// Used as a value whitelist in reconcile (manager.js) and a dispatch table in the
// audio route (server.js) + URL builder (voicePackPlayer.js). Adding a third
// pack means appending its id here and dropping a public/voice-packs/<id>/
// directory + pack.json — no other code path needs editing.
export const BUNDLED_PACK_IDS = Object.freeze(['default', 'sanguo']);

// Locale → preferred bundled pack for initial seed of new users. Declarative
// map (not control flow) so adding a third pack that wants to capture some
// locale is a one-line table edit — never a new `if` branch.
// Match strategy: exact-match locale → pack; missing locale → fall through to
// DEFAULT_BINDINGS (butler).
// Locale strings are normalised lowercase before lookup (i18n.js LANG_MAP
// already folds variants like zh-Hans → zh, zh-HK → zh-TW; this map only
// needs the canonical forms produced by getLang()).
const LOCALE_DEFAULT_SEEDS = Object.freeze({
  zh: 'sanguo',
  'zh-tw': 'sanguo',
});

// Per-event default bindings for a given locale pack. Event keys that should
// stay off-by-default (turnEnd is noisy on every reply) keep null regardless
// of which pack the locale prefers.
function bindingsForPack(packId) {
  return Object.freeze({
    planApproval: packId,
    askQuestion: packId,
    turnEnd: null,
  });
}

// Initial-seed bindings for a fresh user, parameterised by detected locale.
// Locale is read **once** at first-launch in AppBase — runtime lang changes
// do NOT re-seed (that would silently mutate the user's persisted choice
// — "no silent migration" P0 rule).
// Pure function — safe to unit-test without mounting React.
export function getDefaultBindingsForLocale(locale) {
  const normalized = typeof locale === 'string' ? locale.toLowerCase() : '';
  const packId = LOCALE_DEFAULT_SEEDS[normalized];
  if (packId && BUNDLED_PACK_IDS.includes(packId)) {
    return bindingsForPack(packId);
  }
  return DEFAULT_BINDINGS;
}
