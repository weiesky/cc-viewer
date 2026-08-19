# Edit

Performs an exact string replacement inside an existing file. It is the preferred way to modify files because only the diff is transmitted, keeping edits precise and auditable.

## When to Use

- Fixing a bug in a single function without rewriting the surrounding file
- Updating a configuration value, version string, or import path
- Renaming a symbol across a file with `replace_all`
- Inserting a block near an anchor (expand `old_string` to include nearby context, then provide the replacement)
- Applying small, well-scoped edits as part of a multi-step refactor

## Parameters

- `file_path` (string, required): Absolute path of the file to modify.
- `old_string` (string, required): The exact text to search for. Must match character-for-character, including whitespace and indentation.
- `new_string` (string, required): The replacement text. Must differ from `old_string`.
- `replace_all` (boolean, optional): When `true`, replaces every occurrence of `old_string`. Defaults to `false`, which requires the match to be unique.

## Examples

### Example 1: Fix a single call site
Set `old_string` to the exact line `const port = 3000;` and `new_string` to `const port = process.env.PORT ?? 3000;`. The match is unique so `replace_all` can stay at its default.

### Example 2: Rename a symbol across a file
To rename `getUser` to `fetchUser` everywhere in `api.ts`, set `old_string: "getUser"`, `new_string: "fetchUser"`, and `replace_all: true`.

### Example 3: Disambiguate a repeated snippet
If `return null;` appears in several branches, widen `old_string` to include surrounding context (for example the preceding `if` line) so the match is unique. Otherwise the tool errors out rather than guess.

## Notes

- You must call `Read` on the file at least once in the current session before `Edit` will accept changes. Line-number prefixes from `Read` output are not part of the file content; do not include them in `old_string` or `new_string`.
- Whitespace must match exactly. Pay attention to tabs versus spaces and trailing spaces, especially in YAML, Makefiles, and Python.
- If `old_string` is not unique and `replace_all` is `false`, the edit fails. Either expand the context or enable `replace_all`.
- Prefer `Edit` over `Write` whenever the file already exists; `Write` overwrites the entire file and loses unrelated content if you are not careful.
- For multiple unrelated edits in the same file, issue several `Edit` calls in sequence rather than one large, fragile replacement.
- Avoid introducing emoji, marketing copy, or unrequested documentation blocks when editing source files.
