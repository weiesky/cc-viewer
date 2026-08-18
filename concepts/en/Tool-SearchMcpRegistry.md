# SearchMcpRegistry

Searches the MCP connector registry by keyword to discover connectors that might help complete the task.

## When to Use

- The task would benefit from an external service (a database, an issue tracker, a SaaS API) and you want to check whether an MCP connector exists for it.
- The user names a product and asks to connect it — search the registry for a matching connector.

## Parameters

- `keywords` (array of strings, required): Keyword phrases describing the user's intent or a named product. 1–8 items, each 1–64 characters.

## Examples

### Example 1: Find a connector for a named product

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Returns registry entries whose connectors match the keywords. Resolve full connector details with `SuggestConnectors`.

## Notes

- Read-only and concurrency-safe; results are capped in size.
- Only available in remote (claude.ai) sessions on the first-party API.
- Searching installs nothing — it is purely discovery.
