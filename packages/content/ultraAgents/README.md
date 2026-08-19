# ultraAgents — Preset Experts

This directory ships with the cc-viewer package. Each `*.json` file defines a
"preset expert" that appears in the **UltraPlan → Custom Expert Editor →
"Load Template"** modal. Users can select a preset to load its name and content
into the editor with one click, then customize and save as their own expert.

> Loading entry point: server-side `GET /api/ultra-agents` (read-only, no parameters),
> implemented in `server/lib/ultra-agents-api.js`. Non-`*.json` files in this directory
> (like this README) are ignored.

## JSON Format

```jsonc
{
  "id": "code-expert",          // Required. Unique identifier: [A-Za-z0-9._-] only, ≤200 chars,
                                // must not start with '.'. Used as a dedup key (first by filename
                                // sort wins when ids collide); not involved in path construction.
  "version": 1,                 // Optional. Forward-compat marker, ignored by current loader.
  "title":       { "zh": "代码专家", "en": "Code Expert" },  // Required. Expert name, inline localized (see below).
  "description": { "zh": "资深工程师…", "en": "Senior engineer…" }, // Optional. One-liner description, inline localized.
  "content":     "<system-reminder>\n…\n</system-reminder>"  // Required. Single-language body (see "content" below).
}
```

### title / description: inline localization in the JSON protocol layer

Both `title` and `description` support two forms, with **localization done inline in the JSON
protocol layer** (no external i18n dependency):

- **Plain string**: same text for all languages.
- **Localization object** `{ "zh": "…", "en": "…", "zh-TW": "…" }`: the frontend resolves based on
  the current UI language, with fallback order **exact language → region-stripped primary language
  (`zh-TW`→`zh`, `pt-BR`→`pt`) → `en` → `zh` → first non-empty value** (resolution logic in
  `src/utils/resolveLocalized.js`).

A single file can cover any number of languages; unsupported UI languages follow the fallback chain above.

### content: single-language

`content` is a **single-language string** (not localized). After loading and saving, it is sent
to Claude Code as the ultraplan scoped instruction. If `content` (after trimming) starts with
`<system-reminder>`, it is used as-is and **will not be double-wrapped** (see `buildCustomTemplate`
in `src/utils/ultraplanTemplates.js`). Preset `content` should therefore be written in the
`<system-reminder>`, `[SCOPED INSTRUCTION]` style.

> The `content` of the built-in `code-expert` / `research-expert` presets is **taken directly from**
> `src/utils/ultraplanTemplates.js`'s `ULTRAPLAN_VARIANTS.codeExpert` / `researchExpert`,
> and is pinned byte-for-byte by `test/ultra-agents-api.test.js` — to change the body, edit that
> source file and regenerate the JSON in this directory; do not hand-write a second copy here.

## Validation and Limits

Each file undergoes defensive validation at load time. Invalid files are skipped with
`console.warn` only — other files are unaffected:

- Must be valid JSON representing a **plain object** (not an array/scalar).
- `id` must pass the rules above; `title` and `content` must be a non-empty string or an object
  with at least one non-empty string value.
- Single file **≤ 256KB**, skipped if exceeded; valid experts **≤ 100**, excess ignored.
- Missing or invalid `description` is treated as an empty string.

## Existing Demos

| File | Expert | `title` / `description` | `content` source |
| --- | --- | --- | --- |
| `code-expert.json` | Code Expert / 代码专家 | Inline localized (all 18 languages) | `ULTRAPLAN_VARIANTS.codeExpert` |
| `research-expert.json` | Research Expert / 调研专家 | Inline localized (all 18 languages) | `ULTRAPLAN_VARIANTS.researchExpert` |

To add a new preset: drop a new `*.json` file in this directory (file name should match `id`),
and restart/refresh to see it in the modal.
