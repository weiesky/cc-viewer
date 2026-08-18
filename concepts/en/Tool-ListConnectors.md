# ListConnectors

Lists the MCP connectors installed for the user's claude.ai organization, optionally filtered by keyword.

## When to Use

- You need to know which connectors are already installed before suggesting new ones.
- The user asks what integrations their organization has.

## Parameters

- `keywords` (array of strings, optional): Filter the list — up to 8 items, each 1–64 characters. Omit to list everything.

## Examples

### Example 1: List all installed connectors

```
ListConnectors()
```

### Example 2: Filter by keyword

```
ListConnectors(keywords=["github"])
```

## Notes

- Only available in remote (claude.ai) sessions on the first-party API.
- Pair with `SearchMcpRegistry` (discovery) and `SuggestConnectors` (details) for the full find-and-enable flow.
