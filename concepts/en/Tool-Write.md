# Write

## Definition

Writes content to the local filesystem. Overwrites the file if it already exists.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Absolute path of the file (must be an absolute path) |
| `content` | string | Yes | The content to write |

## Use Cases

**Good for:**
- Creating new files
- When a complete rewrite of file content is needed

**Not good for:**
- Modifying partial content in a file — use Edit instead
- Should not proactively create documentation files (*.md) or READMEs unless the user explicitly requests it

## Notes

- If the target file already exists, it must first be read via Read, otherwise it will fail
- Overwrites the entire content of existing files
- Prefer using Edit for existing files; Write is only for creating new files or complete rewrites

## Significance in cc-viewer

Write calls appear in request logs as `tool_use` content blocks, with `input.content` containing the complete written content.

## Original Text

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
