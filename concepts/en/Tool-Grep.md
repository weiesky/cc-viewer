# Grep

## Definition

A powerful content search tool based on ripgrep. Supports regular expressions, file type filtering, and multiple output modes.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | Yes | Regular expression search pattern |
| `path` | string | No | Search path (file or directory), defaults to current working directory |
| `glob` | string | No | Filename filter (e.g., `*.js`, `*.{ts,tsx}`) |
| `type` | string | No | File type filter (e.g., `js`, `py`, `rust`), more efficient than glob |
| `output_mode` | enum | No | Output mode: `files_with_matches` (default), `content`, `count` |
| `-i` | boolean | No | Case-insensitive search |
| `-n` | boolean | No | Show line numbers (content mode only), default true |
| `-A` | number | No | Number of lines to show after a match |
| `-B` | number | No | Number of lines to show before a match |
| `-C` / `context` | number | No | Number of lines to show before and after a match |
| `head_limit` | number | No | Limit the number of output entries, default 0 (unlimited) |
| `offset` | number | No | Skip the first N results |
| `multiline` | boolean | No | Enable multiline matching mode, default false |

## Use Cases

**Good for:**
- Searching for specific strings or patterns in the codebase
- Finding where functions/variables are used
- Filtering search results by file type
- Counting the number of matches

**Not good for:**
- Finding files by filename — use Glob instead
- Open-ended exploration requiring multiple rounds of searching — use Task (Explore type) instead

## Notes

- Uses ripgrep syntax (not grep); special characters like braces need escaping
- `files_with_matches` mode returns only file paths, most efficient
- `content` mode returns matching line content, supports context lines
- Multiline matching requires setting `multiline: true`
- Always prefer the Grep tool over `grep` or `rg` commands in Bash

## Significance in cc-viewer

Grep calls appear in request logs as `tool_use` / `tool_result` content block pairs. The `tool_result` contains the search results.

## Original Text

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
