# Glob

## Definition

A fast file pattern matching tool that works with any codebase size. Returns matching file paths sorted by modification time.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | Yes | Glob pattern (e.g., `**/*.js`, `src/**/*.ts`) |
| `path` | string | No | Search directory, defaults to the current working directory. Do not pass "undefined" or "null" |

## Use Cases

**Good for:**
- Finding files by filename pattern
- Finding all files of a specific type (e.g., all `.tsx` files)
- Locating files first when searching for a specific class definition (e.g., `class Foo`)
- Multiple Glob calls can be issued in parallel within a single message

**Not good for:**
- Searching file contents — use Grep instead
- Open-ended exploration requiring multiple rounds of searching — use Task (Explore type) instead

## Notes

- Supports standard glob syntax: `*` matches single level, `**` matches multiple levels, `{}` matches alternatives
- Results are sorted by modification time
- Preferred over the `find` command in Bash

## Significance in cc-viewer

Glob calls appear in request logs as `tool_use` / `tool_result` content block pairs. The `tool_result` contains the list of matched file paths.

## Original Text

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
