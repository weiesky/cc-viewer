// Spawn-time model resolution from the CURRENTLY EFFECTIVE configuration.
//
// Replaces the old injection criterion for model-specific system prompts, which read
// `projects[cwd].lastModelUsage` from ~/.claude.json — a usage STATISTIC of the previous
// session, not configuration. A stale record (e.g. a past deepseek experiment) made ccv
// inject a third-party override prompt into an official-model session. The new criterion
// only trusts live configuration signals; with no signal it returns null and no model
// entry is injected (the CC_SYSTEM.md / CC_APPEND_SYSTEM.md sentinels are unaffected).
//
// Signal priority (best-effort heuristic — the shell-env vs settings.json-env ordering is
// a repo convention, not documented Claude Code semantics; a mismatch merely means "no
// injection" or "same-family entry", both harmless):
//   1. active third-party proxy profile for the spawned workspace (family mapping via
//      resolveProfileModel — the model the ccv proxy will actually route to)
//   2. env CLAUDE_MODEL > env ANTHROPIC_MODEL (shell exports inherited by the spawn)
//   3. settings.json `env.ANTHROPIC_MODEL` > settings.json top-level `model`
//      (the env block outranks the top-level field, mirroring how Claude Code applies it)
// Known limitation: a `--model` flag passed through extraArgs is not consulted.
//
// Pure disk reads — deliberately NOT importing server/interceptor.js: its module-level
// side effects (log init, watchFile) must not leak into pty-manager unit tests, and its
// live `_activeProfile` reflects the ccv process's CURRENT workspace, which is not
// necessarily the workspace being spawned (multi-workspace/tab mode). All paths are
// injectable for tests; the defaults derive from LOG_DIR / getClaudeConfigDir(), both
// covered by the L1b/L1c/L1d test-isolation barriers.
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { LOG_DIR, getClaudeConfigDir } from '../../findcc.js';
import { resolveProfileModel } from './interceptor-core.js';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null; // missing / unreadable / corrupt → treated as "no signal"
  }
}

function nonEmpty(v) {
  return (typeof v === 'string' && v.trim()) ? v.trim() : null;
}

// `model: "default"` means "let Claude Code pick" — it names no concrete model/family,
// so it must not participate in entry matching (an entry literally named DEFAULT is
// rejected by the entry-name grammar anyway). Other aliases (opus/sonnet/opusplan/…)
// stay verbatim: they express an explicit family intent and matching a same-family
// entry is the desired behavior.
function normalizeAlias(model) {
  if (!model) return null;
  return model.toLowerCase() === 'default' ? null : model;
}

/**
 * The active THIRD-PARTY proxy profile for the workspace being spawned, or null.
 * Resolution mirrors interceptor.js `_loadProxyProfile`: the workspace-scoped
 * `<logDir>/<project>/active-profile.json` activeId outranks the global
 * `profile.json` `active`; id 'max' is the built-in Default (= no third-party profile).
 * The project-dir derivation is character-identical to interceptor.js:353.
 */
function readActiveProfile(spawnDir, logDir) {
  const data = readJson(join(logDir, 'profile.json'));
  if (!data || !Array.isArray(data.profiles)) return null;
  let activeId = null;
  if (spawnDir) {
    const projectName = basename(spawnDir).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const ws = readJson(join(logDir, projectName, 'active-profile.json'));
    if (ws && typeof ws.activeId === 'string') activeId = ws.activeId;
  }
  if (!activeId) activeId = typeof data.active === 'string' ? data.active : null;
  if (!activeId || activeId === 'max') return null;
  const profile = data.profiles.find((p) => p && p.id === activeId);
  return (profile && profile.id !== 'max') ? profile : null;
}

/**
 * Resolve the model id the spawned claude session will effectively use, from live
 * configuration only. Returns null when no configuration signal exists — the caller
 * must then skip model-entry injection.
 *
 * @param {string} spawnDir workspace being launched (absolute path)
 * @param {Object} [env] environment (default process.env)
 * @param {{ logDir?: string, configDir?: string }} [opts] test seams for the data roots
 * @returns {string|null}
 */
export function resolveSpawnModel(spawnDir, env = process.env, opts = {}) {
  const logDir = opts.logDir || LOG_DIR;
  const configDir = opts.configDir || getClaudeConfigDir();

  // Base model: what claude itself is configured to request.
  let base = nonEmpty(env?.CLAUDE_MODEL) || nonEmpty(env?.ANTHROPIC_MODEL);
  if (!base) {
    const settings = readJson(join(configDir, 'settings.json'));
    base = nonEmpty(settings?.env?.ANTHROPIC_MODEL) || nonEmpty(settings?.model);
  }
  base = normalizeAlias(base);

  // Active third-party profile: the proxy rewrites requests per model family, so the
  // effective model is the mapping target; an unmapped family passes through as base.
  const profile = readActiveProfile(spawnDir, logDir);
  if (profile) {
    const mapped = base ? resolveProfileModel(base, profile) : null;
    return nonEmpty(mapped)
      || base
      || nonEmpty(profile.ANTHROPIC_MODEL)
      || nonEmpty(profile.activeModel) // legacy whole-replacement profiles
      || null;
  }
  return base;
}
