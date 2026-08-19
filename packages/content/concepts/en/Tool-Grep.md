# Grep

Searches file contents using the ripgrep engine. Offers full regular expression support, file-type filtering, and three output modes so you can trade precision for compactness.

## When to Use

- Locating every call site of a function or every reference to an identifier
- Checking whether a string or error message appears anywhere in the codebase
- Counting occurrences of a pattern to gauge impact before refactoring
- Narrowing a search to a file type (`type: "ts"`) or glob (`glob: "**/*.tsx"`)
- Pulling cross-line matches such as multi-line struct definitions or JSX blocks with `multiline: true`

## Parameters

- `pattern` (string, required): The regular expression to search for. Uses ripgrep syntax, so literal braces need escaping (for example `interface\{\}` to find `interface{}`).
- `path` (string, optional): File or directory to search. Defaults to the current working directory.
- `glob` (string, optional): Filename filter such as `*.js` or `*.{ts,tsx}`.
- `type` (string, optional): File-type shortcut such as `js`, `py`, `rust`, `go`. More efficient than `glob` for standard languages.
- `output_mode` (enum, optional): `files_with_matches` (default, returns paths only), `content` (returns matching lines), or `count` (returns match tallies).
- `-i` (boolean, optional): Case-insensitive matching.
- `-n` (boolean, optional): Include line numbers in `content` mode. Defaults to `true`.
- `-A` (number, optional): Lines of context to show after each match (requires `content` mode).
- `-B` (number, optional): Lines of context before each match (requires `content` mode).
- `-C` / `context` (number, optional): Lines of context on both sides of each match.
- `multiline` (boolean, optional): Allow patterns to span newlines (`.` matches `\n`). Defaults to `false`.
- `head_limit` (number, optional): Limit returned lines, file paths, or count entries. Defaults to 250; pass `0` for unlimited (use sparingly).
- `offset` (number, optional): Skip the first N results before applying `head_limit`. Defaults to `0`.

## Examples

### Example 1: Find all call sites of a function
Set `pattern: "registerHandler\\("`, `output_mode: "content"`, and `-C: 2` to see the surrounding lines of each call.

### Example 2: Count matches across a type
Set `pattern: "TODO"`, `type: "py"`, and `output_mode: "count"` to see per-file TODO totals across Python sources.

### Example 3: Multiline struct match
Use `pattern: "struct Config \\{[\\s\\S]*?version"` with `multiline: true` to capture a field declared several lines into a Go struct.

## Notes

- Always prefer `Grep` over running `grep` or `rg` through `Bash`; the tool is optimized for correct permissions and structured output.
- Default output mode is `files_with_matches`, which is cheapest. Switch to `content` only when you need to see the lines themselves.
- Context flags (`-A`, `-B`, `-C`) are ignored unless `output_mode` is `content`.
- Large result sets burn context tokens. Use `head_limit`, `offset`, or tighter `glob`/`type` filters to stay focused.
- For filename discovery, use `Glob` instead; for open-ended investigations across many rounds, dispatch an `Agent` with the Explore agent.
