import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Settings files are tiny in practice; this caps a hostile `--settings /dev/zero`
// (a never-EOF read that would hang the server event loop) or a huge-file read.
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

// Merges a user-supplied `--settings` launch arg into cc-viewer's injected settings
// object, so the final claude argv carries a SINGLE `--settings` flag.
//
// Why: claude's argv parser is last-wins for duplicate `--settings` (empirically
// verified on 2.1.212 — not documented). cc-viewer prepends its injected flag before
// user args, so a user-supplied `--settings` used to silently clobber the injected
// env.ANTHROPIC_BASE_URL proxy override (breaking capture) and the CCV_IM_DENY
// permissions.deny hardening. Merging keeps both: injected keys win, everything
// else the user set rides along.
//
// Parse rules pinned by experiments against claude 2.1.212:
// - Tokens after a literal `--` are prompt text, never flags → scan stops there.
// - `--settings <next>` consumes the next token as its value unconditionally, even
//   an option-like one (`--settings --print` → claude reads "--print" as a settings
//   path and hard-errors). The helper mirrors that consumption.
// - A trailing valueless `--settings` makes claude exit with "argument missing" →
//   left in place so claude surfaces its own usage error, exactly as pre-fix.
// - An empty `--settings=` does NOT error but still clobbers earlier `--settings`
//   flags via last-wins (the most dangerous form) → always stripped.
//
// Known accepted limitation (shared with withDefaultThinkingDisplay / hasArg): a
// literal "--settings" appearing before `--` as ANOTHER value-flag's argument
// (e.g. `--append-system-prompt "--settings"`) is indistinguishable without a full
// claude flag table. Probability negligible; bounded by the stop-at-`--` rule.

const FLAG = '--settings';

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Remove C0 control chars (and DEL) so a value/reason echoed into the embedded xterm
// (via emitSpawnNotice) or a log line cannot inject ANSI escape sequences — the raw
// user value and a JSON.parse SyntaxError can both carry ESC bytes.
function stripControls(s) {
  return String(s).replace(/[\u0000-\u001F\u007F]/g, '');
}

// Read + parse a user-pointed settings file DEFENSIVELY. The failure reason is echoed
// into a client-readable surface (the persistent terminal buffer + logs), so it must
// never disclose file contents or resolved paths — a raw readFileSync/JSON.parse error
// embeds the leading file bytes and the absolute path, turning the warning into a
// file-probing oracle. All failures collapse to generic, content-free messages; a
// statSync isFile()+size gate blocks /dev/zero-style hangs and oversized reads.
function readSettingsFile(path) {
  let st;
  try { st = statSync(path); } catch { throw new Error('settings file not found'); }
  if (!st.isFile()) throw new Error('settings path is not a regular file');
  if (st.size > MAX_SETTINGS_FILE_BYTES) throw new Error('settings file too large');
  let raw;
  try { raw = stripBom(readFileSync(path, 'utf8')); } catch { throw new Error('settings file could not be read'); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('settings file is not valid JSON'); }
  if (!isPlainObject(parsed)) throw new Error('settings file must be a JSON object');
  return parsed;
}

// Load a --settings value the way claude does: inline JSON when it looks like an
// object literal, otherwise a settings file path (resolved against the cwd claude
// itself will run with). Throws on any failure — caller turns that into a warning.
function loadSettingsValue(value, cwd) {
  const trimmed = stripBom(value).trim();
  if (trimmed === '') throw new Error('empty value');
  if (trimmed.startsWith('{')) {
    // Inline JSON is the user's own text; echoing it back on failure is not disclosure
    // (control chars are stripped at the warning surface). File contents are different —
    // handled by readSettingsFile, which never surfaces them.
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) throw new Error('settings must be a JSON object');
    return parsed;
  }
  return readSettingsFile(resolve(cwd, trimmed));
}

// Shallow top-level merge with two special cases; injected keys win. Deep-merging
// other keys (hooks, statusLine, ...) would splice into structures the user owns.
function mergeSettings(userSettings, injectedSettings) {
  const merged = { ...userSettings };
  for (const [key, injectedValue] of Object.entries(injectedSettings)) {
    if (key === 'env' && isPlainObject(merged.env)) {
      merged.env = { ...merged.env, ...injectedValue };
    } else if (key === 'permissions' && isPlainObject(merged.permissions)) {
      const userDeny = Array.isArray(merged.permissions.deny) ? merged.permissions.deny : [];
      const injectedDeny = Array.isArray(injectedValue.deny) ? injectedValue.deny : [];
      merged.permissions = {
        ...merged.permissions,
        ...injectedValue,
        deny: [...new Set([...userDeny, ...injectedDeny])],
      };
    } else {
      merged[key] = injectedValue;
    }
  }
  return merged;
}

/**
 * Extract any user `--settings` occurrences from launch args and merge the last
 * one into the injected settings object (injected keys win; permissions.deny is
 * unioned). Never throws — a value that cannot be loaded is dropped and reported
 * via `warningDetail` so the caller can surface it (injection must never block spawn).
 *
 * @param {unknown} args launch args (user-controlled; may contain non-strings)
 * @param {object} injectedSettings cc-viewer's settings object (env.ANTHROPIC_BASE_URL, optional permissions.deny)
 * @param {{cwd?: string}} [opts] base dir for relative settings file paths — must match the cwd claude runs with
 * @returns {{args: unknown[], settingsJson: string, merged: boolean, warningDetail: {value: string, reason: string}|null}}
 *   args: input args with consumed `--settings` occurrences removed;
 *   settingsJson: JSON for the single injected flag (byte-identical to
 *   JSON.stringify(injectedSettings) when nothing merged);
 *   merged: whether a user value was folded in; warningDetail: load-failure parts
 *   ({value, reason}, control-chars stripped) for the caller to render/localize —
 *   the English sentence lives only in the `cli.settingsMergeFailed` i18n key, so
 *   there is no duplicated copy here to drift.
 */
export function mergeSettingsIntoArgs(args, injectedSettings, { cwd = process.cwd() } = {}) {
  const passthrough = { merged: false, warningDetail: null, settingsJson: JSON.stringify(injectedSettings) };
  if (!Array.isArray(args)) return { args: [], ...passthrough };

  const cleaned = [];
  let lastValue = null; // last consumed --settings value (claude is last-wins)
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (typeof token !== 'string') { cleaned.push(token); continue; }
    if (token === '--') { cleaned.push(...args.slice(i)); break; }
    if (token.startsWith(FLAG + '=')) {
      lastValue = token.slice(FLAG.length + 1); // may be '' — still stripped (empty form clobbers via last-wins)
      continue;
    }
    if (token === FLAG) {
      if (i + 1 >= args.length) { cleaned.push(token); continue; } // trailing valueless: claude errors "argument missing" itself
      lastValue = args[i + 1];
      i++;
      continue;
    }
    cleaned.push(token);
  }

  if (lastValue === null) return { args: cleaned, ...passthrough };

  try {
    if (typeof lastValue !== 'string') throw new Error('value is not a string');
    const userSettings = loadSettingsValue(lastValue, cwd);
    return {
      args: cleaned,
      settingsJson: JSON.stringify(mergeSettings(userSettings, injectedSettings)),
      merged: true,
      warningDetail: null,
    };
  } catch (err) {
    const shown = typeof lastValue === 'string' ? lastValue : String(lastValue);
    // Strip control chars: `shown` is raw user input and `err.message` from an inline
    // JSON.parse can echo user bytes — both flow into the terminal buffer / logs.
    return {
      args: cleaned,
      ...passthrough,
      warningDetail: { value: stripControls(shown), reason: stripControls(err?.message || err) },
    };
  }
}
