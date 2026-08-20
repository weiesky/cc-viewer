// Spawn-time `${...}` template-variable rendering for injected system-prompt files.
//
// The Edit System Prompt editor stores entries (model entries under system_prompt/ and the
// CC_SYSTEM.md / CC_APPEND_SYSTEM.md sentinels) with `${...}` placeholders LITERAL — that is the
// editing surface documented by the "Dynamic Parameter Documentation" popup. The substitution has
// to happen when claude is launched: this module takes the args produced by
// buildSystemPromptFileArgs, and for every injected file whose content contains template
// variables, renders it via create_system_prompt.js and swaps in a rendered temp copy.
//
// Design constraints:
// - Files without `${...}` pass through untouched (zero cost — no variable collection, which
//   shells out to git several times, and no temp file).
// - missingVariableMode is 'keep': unknown placeholders stay literal, so user-authored prompt
//   text quoting shell syntax like `${HOME}` or `${1:-default}` is never eaten.
// - Any failure (unreadable file, variable collection throwing, temp write failing) falls back
//   to the raw path — rendering must never break the claude spawn.
// - Temp copies live under <tmpdir>/cc-viewer-rendered-prompts/<pid>/: per-process so two ccv
//   instances never clobber each other; sequential spawns of one instance overwrite the same
//   basename, which is safe because claude reads the file once at startup.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createSystemPrompt, createSystemPromptVariables } from './create_system_prompt.js';

// Detection only (no capture): does the text contain at least one `${...}` placeholder?
const TEMPLATE_VARIABLE_RE = /\$\{[^}]+\}/;

/** Per-process directory holding the rendered temp copies. */
export function renderedPromptDir(pid = process.pid) {
  return join(tmpdir(), 'cc-viewer-rendered-prompts', String(pid));
}

/**
 * Render template variables in the file args produced by buildSystemPromptFileArgs.
 *
 * @param {{ args: string[], loaded: string[], model: string|null }} sysPrompt
 * @param {{ cwd?: string, modelId?: string|null, variablesFactory?: Function }} [opts]
 *        cwd: workspace being launched (git/cwd/memory variables resolve against it);
 *        modelId: resolved model id from the last launch — becomes ${model.name} (the [1m]
 *        context-window suffix is stripped: it is a claude-code UI notation, not a model name);
 *        variablesFactory: test seam replacing createSystemPromptVariables.
 * @returns {{ args: string[], loaded: string[], model: string|null, entries: Array }}
 *          same shape; file paths whose content was rendered point at the temp copy
 *          instead. `entries` records the FINAL content of every injected file —
 *          [{flag, basename, content}] for successfully read files (rendered text when
 *          rendered, raw text when passed through — the launch-time bytes are what a
 *          later `-c`/`-r` pin must reuse, not whatever the source file says by then),
 *          or {flag, basename, content: null, unavailable: true} when the file could
 *          not be read/rendered (the arg falls back to the raw path; snapshot writers
 *          skip unavailable entries). Consumers that don't care can ignore the field.
 */
export function renderSystemPromptFileArgs(sysPrompt, opts = {}) {
  // Defensive: null / non-object → safe default, so the caller always gets a valid
  // spread target and the "loaded" notice guard (sysPrompt.loaded.length) can't throw.
  if (!sysPrompt || typeof sysPrompt !== 'object') return { args: [], loaded: [], model: null, entries: [] };
  const args = Array.isArray(sysPrompt.args) ? sysPrompt.args : [];
  if (args.length === 0) return { entries: [], ...sysPrompt };

  let variables = null; // lazy: collected once, and only if some file actually has placeholders
  const out = [...args];
  const entries = [];
  for (let i = 0; i + 1 < out.length; i += 2) {
    const flag = out[i];
    if (flag !== '--system-prompt-file' && flag !== '--append-system-prompt-file') continue;
    const path = out[i + 1];
    try {
      const text = readFileSync(path, 'utf-8');
      if (!TEMPLATE_VARIABLE_RE.test(text)) {
        entries.push({ flag, basename: basename(path), content: text }); // pass-through: pin the launch-time bytes
        continue;
      }
      if (!variables) {
        const factory = opts.variablesFactory || createSystemPromptVariables;
        const overrides = {};
        if (opts.modelId) overrides.model = { name: String(opts.modelId).replace(/\[1m\]$/, '') };
        variables = factory(overrides, { cwd: opts.cwd });
      }
      const rendered = createSystemPrompt(text, { variables, missingVariableMode: 'keep' });
      if (rendered === text) { // every placeholder unknown → nothing changed, keep raw path
        entries.push({ flag, basename: basename(path), content: text });
        continue;
      }
      const dir = renderedPromptDir();
      mkdirSync(dir, { recursive: true });
      const target = join(dir, basename(path));
      writeFileSync(target, rendered, 'utf-8');
      out[i + 1] = target;
      entries.push({ flag, basename: basename(path), content: rendered });
    } catch (e) {
      entries.push({ flag, basename: basename(path), content: null, unavailable: true });
      console.warn(`[CC Viewer] system-prompt template render failed for ${path} (injecting the raw file):`, e?.message || e);
    }
  }
  return { ...sysPrompt, args: out, entries };
}
