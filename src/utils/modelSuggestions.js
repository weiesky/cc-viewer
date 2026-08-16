// Pure collector for the "+ Add model" name field's type-ahead suggestions.
// Sources: the hot-reload proxy profiles (GET /api/proxy-profiles) and
// settings.json (GET /api/claude-settings). CLIENT-SAFE (no Node APIs, no
// imports) so node:test can import it directly.

const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // keep in sync with server/lib/model-system-prompts.js

const PROFILE_MODEL_FIELDS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'activeModel', // legacy whole-replacement field; pre-migration files may still carry it
];

// Claude Code appends "[1m]" to configured model ids; mirror the server's
// strip1m (server/lib/interceptor-core.js) so e.g. "claude-opus-4-8[1m]"
// suggests "claude-opus-4-8" instead of being dropped by the name regex.
const strip1m = (s) => s.replace(/\[1m\]/gi, '').trim();

export function collectModelSuggestions(profilesData, claudeSettingsData) {
  const out = [];
  const seen = new Set(); // case-insensitive dedupe; first occurrence keeps its casing
  const push = (raw) => {
    if (typeof raw !== 'string') return;
    const v = strip1m(raw.trim());
    if (!v) return;
    if (v.toLowerCase() === 'default') return; // reserved tab name
    if (/_APPEND$/i.test(v)) return;           // reserved suffix (server rule)
    if (!MODEL_NAME_RE.test(v)) return;        // e.g. slash/colon ids the server would reject anyway
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  // All profiles are merged (an entry matches whatever model a future launch
  // resolves), then the default (Max/OAuth) profile's model signal from the
  // same hot-reload payload, then settings.json.
  for (const p of (profilesData?.profiles || [])) {
    if (!p || typeof p !== 'object') continue;
    for (const f of PROFILE_MODEL_FIELDS) push(p[f]);
  }
  push(profilesData?.defaultConfig?.model);
  const cs = claudeSettingsData || {};
  push(cs.model);
  push(cs.env?.ANTHROPIC_MODEL);
  return out;
}
