# Edit

## Definition

Edits files via exact string replacement. Replaces `old_string` with `new_string` in the file.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Absolute path of the file to modify |
| `old_string` | string | Yes | The original text to replace |
| `new_string` | string | Yes | The new replacement text (must differ from old_string) |
| `replace_all` | boolean | No | Whether to replace all matches, default `false` |

## Use Cases

**Good for:**
- Modifying specific code sections in existing files
- Fixing bugs, updating logic
- Renaming variables (with `replace_all: true`)
- Any scenario requiring precise file content modification

**Not good for:**
- Creating new files — use Write instead
- Large-scale rewrites — may need Write to overwrite the entire file

## Notes

- You must first read the file via Read before using this tool, otherwise it will error
- `old_string` must be unique in the file, otherwise the edit fails. If not unique, provide more context to make it unique, or use `replace_all`
- When editing text, preserve the original indentation (tabs/spaces); do not include the line number prefix from Read output
- Prefer editing existing files over creating new ones
- `new_string` must differ from `old_string`

## Significance in cc-viewer

Edit calls appear in request logs as `tool_use` content blocks, with `input` containing `old_string` and `new_string`, which can be used to track what modifications the model made to files.

## Original Text

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
