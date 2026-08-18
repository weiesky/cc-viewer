# REPL

Executes JavaScript in a persistent Node.js vm context inside the session. Top-level `await` is supported, and variables/functions defined in one call remain available in later calls.

## When to Use

- Quick computation, data transformation, or JSON wrangling that is easier in code than in shell one-liners.
- Multi-step scripting where intermediate state should persist between calls (counters, accumulated results).
- Probing an API or library behavior interactively before writing it into a file.

## Activation

- Off by default — set `CLAUDE_CODE_REPL=true` to enable it.
- In terminal (`cli`) and claude.ai (`remote`) sessions, a server-side feature flag may also enable it.
- When off, REPL is hidden from the model's tool list. When on, `Read`, `Glob`, `Grep`, `Bash`, `PowerShell`, and `NotebookEdit` are replaced by REPL shorthands.

## Parameters

- `code` (string, required): JavaScript code to execute. Supports top-level await. State persists across calls.
- `description` (string, optional): Clear, concise description of what this script does in active voice (5–10 words), e.g. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, optional): Timeout in milliseconds. Defaults to 30000; maximum 600000.

## Examples

### Example 1: Compute and reuse state

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Returns `2`; `counts` stays defined for subsequent REPL calls in the same session.

### Example 2: Top-level await with a longer timeout

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Notes

- State is per-session: restarting the session clears all definitions.
- This is a JavaScript (Node) environment — use Bash for shell commands, filesystem-heavy work, or non-JS runtimes.
- Long-running code should set an explicit `timeout`; the default 30s kills anything slower.
