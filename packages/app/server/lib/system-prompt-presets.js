// Serves the built-in system-prompt presets (server/system-prompt-templates/presets/*)
// to the "Edit System Prompt" modal. Reads the manifest and renders each preset into
// raw editor text (placeholders left literal) via the system-prompt builder.
//
// This path is pure file reads + string ops — it does NOT call
// createSystemPromptVariables, so no git subprocess is spawned when serving.
import { listPresets, renderPresetTemplate, loadVariablesDoc } from './create_system_prompt.js';

// Returns a flat list of presets with their raw editor text:
//   [{ id, title, description, match, category, defaultMode, text }]
// Best-effort per entry: a preset that fails to load/render is logged and
// skipped rather than failing the whole list.
export function listSystemPromptPresets() {
  let manifest;
  try {
    manifest = listPresets();
  } catch (e) {
    console.warn('[CC Viewer] system-prompt presets manifest unreadable:', e.message);
    return [];
  }
  const categories = (manifest && manifest.categories) || {};
  const out = [];
  for (const [category, entries] of Object.entries(categories)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string') continue;
      let text;
      try {
        text = renderPresetTemplate(entry.id);
      } catch (e) {
        console.warn(`[CC Viewer] system-prompt preset "${entry.id}" render failed:`, e.message);
        continue;
      }
      out.push({
        id: entry.id,
        title: entry.title || entry.id,
        description: entry.description || '',
        match: entry.match || '',
        category,
        defaultMode: entry.defaultMode === 'override' ? 'override' : 'append',
        text,
      });
    }
  }
  return out;
}

// Returns the ${...} template-variable reference (systemPromptVariables.md) as
// markdown, or '' if it can't be read (best-effort; the modal hides its help
// affordance when empty). `lang` selects a localized systemPromptVariables.<lang>.md
// when one exists; anything else falls back to the English base.
export function getSystemPromptVariablesDoc(lang) {
  try {
    return loadVariablesDoc(lang);
  } catch (e) {
    console.warn('[CC Viewer] system-prompt variables doc unreadable:', e.message);
    return '';
  }
}

// Groups a flat preset list by category, preserving first-seen order.
export function groupPresetsByCategory(presets) {
  const categories = {};
  for (const p of presets) {
    (categories[p.category] || (categories[p.category] = [])).push(p);
  }
  return categories;
}
