// Placeholder ANTHROPIC_API_KEY injection for spawned claude child processes.
//
// Root cause: Claude Code 2.1.x in interactive (non-print) mode runs an "unauthenticated
// connectivity check" at startup when the process carries no credential at all (no OAuth
// login state, no ANTHROPIC_AUTH_TOKEN, no ANTHROPIC_API_KEY), and judges the probe harshly —
// failing it prints "Not logged in / Please run /login" (or a connectivity error) and exits.
// In cc-viewer the real credential is injected by the proxy layer at forward time (the active
// proxy profile's apiKey is decrypted from the credential vault and written into the outgoing
// headers), so the spawned claude process itself holds no credential — which makes this startup
// check fire 100% of the time in CLI/SDK modes.
//
// Fix: when the user has not explicitly provided a credential via env, inject a placeholder
// ANTHROPIC_API_KEY so claude skips the unauthenticated check. The real credential is still
// injected by the proxy layer; the placeholder in outgoing requests is stripped/overwritten
// there, so it never pollutes the upstream API. We never overwrite a user-supplied
// ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY.
//
// Why ANTHROPIC_API_KEY and not ANTHROPIC_AUTH_TOKEN (double-source warning): claude 2.1.199
// warns "Both ANTHROPIC_AUTH_TOKEN and /login managed key set" when an env token source and an
// apiKey source are both non-none at the same time. Injecting ANTHROPIC_API_KEY keeps a single
// source and avoids that banner.
//
// Hard constraint: the placeholder value must appear in
// ~/.claude.json:customApiKeyResponses.approved — in interactive TUI mode claude only silently
// accepts an ANTHROPIC_API_KEY that is in `approved` (otherwise it shows a custom-API-key
// confirmation dialog). So the placeholder value here and the value ensureApiKeyApproved writes
// must be byte-identical; both share this module's CCV_API_KEY_PLACEHOLDER.
//
// Known trade-off: the placeholder is only safe when the proxy layer rewrites auth. With no
// proxy profile configured (direct api.anthropic.com), the proxy does not rewrite auth and the
// placeholder goes out as-is → 401 on the first /v1/messages (an in-session auth error, not a
// startup crash). That scenario means the user must supply a real credential anyway; treated as
// an acceptable improvement (startup crash → in-session auth error), not a regression.
//
// The placeholder is a non-secret literal that the claude child (Bash/MCP/hooks) inherits via
// env — it is only "make claude skip the check", NOT a real credential; never use it as a token
// in child scripts. Note ANTHROPIC_API_KEY is the default env name every Anthropic SDK reads.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveClaudeJsonPath } from './ensure-hooks.js';
import { getClaudeConfigDir } from '../../findcc.js';
import { renameSyncWithRetry } from './file-api.js';
import { reportSwallowed } from './error-report.js';

// The placeholder value. 10 chars: the full string and its slice(-20) truncation both match
// `approved` either way (the read side compares slice(-20)), so the two semantics agree.
// Non-secret by design — see the header comment.
export const CCV_API_KEY_PLACEHOLDER = 'ccv-proxy';

/**
 * When env has neither ANTHROPIC_AUTH_TOKEN nor ANTHROPIC_API_KEY, inject the placeholder
 * ANTHROPIC_API_KEY in place. If either is already present (user-supplied), leave it untouched.
 * Both keys are checked and either non-empty one suppresses injection — critical: if the user
 * pre-set a real ANTHROPIC_AUTH_TOKEN, also injecting a placeholder ANTHROPIC_API_KEY would make
 * claude see both an env token source and an env apiKey source (the same double-source warning).
 *
 * Note: OAuth login state (~/.claude/.credentials.json) is intentionally NOT in this env check —
 * even with OAuth present we still inject when env has no token/key. That is the desired behavior:
 * the injection exists to make claude skip its own auth check; the placeholder in outgoing
 * requests is replaced by the proxy layer with the real credential.
 *
 * @param {Record<string, string|undefined>} env child-process env to inject into (mutated)
 * @returns {boolean} true = injected the placeholder this call; false = a credential existed
 */
export function ensurePlaceholderApiKey(env) {
  if (!env || typeof env !== 'object') return false;
  // Normalize: a whitespace-only credential key is deleted outright. Upstream's credential-source
  // detection keys on "exists / truthy", so a blank string could be read as set → double-source.
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
    if (typeof env[k] === 'string' && env[k].trim() === '') delete env[k];
  }
  const hasToken = typeof env.ANTHROPIC_AUTH_TOKEN === 'string' && env.ANTHROPIC_AUTH_TOKEN.trim() !== '';
  const hasApiKey = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim() !== '';
  if (hasToken || hasApiKey) return false;
  env.ANTHROPIC_API_KEY = CCV_API_KEY_PLACEHOLDER;
  return true;
}

/**
 * Resolve the ANTHROPIC_API_KEY actually in effect for the child env after normalization:
 * the env's own key when non-blank (trimmed), else the placeholder value ensurePlaceholderApiKey
 * would inject. Callers pass this to ensureApiKeyApproved so we approve the key the child truly
 * carries (not the parent process's).
 * @param {Record<string, string|undefined>} env already-normalized child env
 * @returns {string} the effective ANTHROPIC_API_KEY (trimmed, never empty)
 */
export function resolveEffectiveApiKey(env) {
  const v = env && typeof env === 'object' ? env.ANTHROPIC_API_KEY : undefined;
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : CCV_API_KEY_PLACEHOLDER;
}

/**
 * Approve the child's effective ANTHROPIC_API_KEY in ~/.claude.json's
 * customApiKeyResponses.approved so interactive TUI mode silently accepts it (no custom-API-key
 * confirmation dialog). Idempotent, never overwrites other entries, atomic write, refuses to
 * write back a corrupt/unreadable file.
 * @param {{ configDir?: string, key?: string }} [opts]
 */
export function ensureApiKeyApproved({ configDir, key } = {}) {
  try {
    const claudeJsonPath = resolveClaudeJsonPath(configDir || getClaudeConfigDir());
    let claudeJson = null;
    if (existsSync(claudeJsonPath)) {
      try {
        claudeJson = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
        if (!claudeJson || typeof claudeJson !== 'object' || Array.isArray(claudeJson)) {
          console.warn(`[cc-viewer] ${claudeJsonPath} is not a JSON object, skipping apiKey approval write`);
          return;
        }
      } catch (err) {
        // P0 safety rule: unreadable/corrupt file → never overwrite.
        console.warn(`[cc-viewer] ${claudeJsonPath} is unreadable/unparseable (${err.message}), skipping apiKey approval write to avoid overwriting user config`);
        return;
      }
    } else {
      claudeJson = {}; // first run: safe to start from empty object
    }

    const approved = (typeof key === 'string' && key.trim() !== '') ? key.trim() : CCV_API_KEY_PLACEHOLDER;
    // Upstream stores approvals keyed by the key's slice(-20) tail; write both forms defensively
    // is unnecessary — the value is < 20 chars so full == tail. Keep a single canonical entry.
    if (!claudeJson.customApiKeyResponses || typeof claudeJson.customApiKeyResponses !== 'object' || Array.isArray(claudeJson.customApiKeyResponses)) {
      claudeJson.customApiKeyResponses = {};
    }
    const bag = claudeJson.customApiKeyResponses;
    if (!Array.isArray(bag.approved)) bag.approved = [];
    const tail = approved.slice(-20);
    if (bag.approved.includes(tail)) return; // idempotent

    bag.approved.push(tail);
    // Atomic write: tmp file + rename, preserving original file mode.
    try { mkdirSync(dirname(claudeJsonPath), { recursive: true }); } catch { /* existing dir / home */ }
    const tmpPath = `${claudeJsonPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    try {
      let targetMode = 0o600;
      try { targetMode = statSync(claudeJsonPath).mode & 0o777; } catch { /* new file */ }
      writeFileSync(tmpPath, JSON.stringify(claudeJson, null, 2), { encoding: 'utf-8', mode: targetMode });
      renameSyncWithRetry(tmpPath, claudeJsonPath);
    } catch (err) {
      try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    reportSwallowed('ccv.ensureApiKeyApproved', err);
  }
}
