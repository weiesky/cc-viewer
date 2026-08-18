# ToolSearch

Fetches the full schema definitions for "deferred tools" on demand so they become callable. When many tools are available, some are not loaded up front — they appear only by name inside `<system-reminder>` messages. Until its schema is fetched, only the name is known and there is no parameter definition, so the tool cannot be invoked. `ToolSearch` takes a query, matches it against the deferred-tool list, and returns the matched tools' complete JSONSchema definitions inside a `<functions>` block. Once a tool's schema appears in the result, it is callable exactly like any tool defined at the top of the prompt.

## When to Use

- You need a deferred tool — its name appears in a `<system-reminder>`, but there is no parameter definition for it in the top-level tool list.
- You want to use an MCP server's tools (e.g. Slack, Gmail, computer-use) that are loaded on demand.
- You are not sure of the exact tool name for a capability and want to surface candidates by keyword in one shot.

If a tool's schema is already in context, do not search again — just call it.

## Activation

- On by default.
- Off when `ANTHROPIC_BASE_URL` points at a non-Anthropic endpoint (unless `ENABLE_TOOL_SEARCH` is set), when `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` is set, when the model lacks tool-reference support (Vertex AI models before Claude 4.5), or when denied via `"deny": ["ToolSearch"]`.

## Parameters

- `query` (string, required): The query used to locate deferred tools. Three forms are supported:
  - `select:Read,Edit,Grep` — fetch these exact tools by name.
  - `notebook jupyter` — keyword search, returning up to `max_results` best matches.
  - `+slack send` — require `slack` to appear in the tool name, then rank by the remaining terms.
- `max_results` (number, optional): Maximum number of results to return. Defaults to 5.

## Examples

### Example 1: Fetch by exact name

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Example 2: Keyword search

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Example 3: Load an entire MCP toolkit at once

When bulk-loading every tool of an MCP server (e.g. computer-use), use a single keyword search instead of selecting each one — the server name as a substring matches every tool under that server:

```
ToolSearch(query="computer-use", max_results=30)
```

## Notes

- Before invoking a deferred tool you must first fetch its schema with `ToolSearch` — calling it directly fails because the parameter definition is missing.
- When bulk-loading a whole toolkit (e.g. all of an MCP server's tools), prefer one keyword search over many `select:` calls to cut round-trips.
- Once a schema is fetched, the tool behaves exactly like any normal tool; do not re-search the same tool.
- Results come back as a `<functions>` block, each tool a single `<function>{...}</function>` line — the same encoding as the top-level tool list.
