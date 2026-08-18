# SuggestConnectors

Resolves full connector payloads for `directoryUuid` values returned by `SearchMcpRegistry`, so the user can be offered concrete connectors to enable.

## When to Use

- After `SearchMcpRegistry` returns candidate connectors, to fetch their full details for presentation.

## Activation

- Only available in remote (claude.ai) sessions on the first-party API.

## Parameters

- `uuids` (array of strings, required): `directoryUuid` or `server_id` values to resolve. 1–32 items, each 1–64 characters.

## Examples

### Example 1: Resolve two registry hits

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Notes

- Never guess UUIDs — only resolve identifiers that came back from `SearchMcpRegistry`.
- The tool connects nothing itself; enabling a connector happens out of band.
