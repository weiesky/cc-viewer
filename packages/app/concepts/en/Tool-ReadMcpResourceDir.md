# ReadMcpResourceDir

Lists the entries of a directory-style resource exposed by a connected MCP server, addressed by its URI.

## When to Use

- An MCP server organizes resources hierarchically and you need to enumerate one level of that hierarchy.
- You want to browse before reading individual resources with `ReadMcpResource`.

## Activation

- Always enabled, but not exposed to the model's tool list — intended for thin-client / sidecar use.

## Parameters

- `server` (string, required): The MCP server name.
- `uri` (string, required): The directory resource URI to list.

## Examples

### Example 1: List a resource directory

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Returns the child entries the server exposes under that directory URI.

## Notes

- Only servers that model their resources as directories support this; flat servers will return an error or an empty listing — fall back to `ListMcpResources`.
- Combine with `ReadMcpResource` to drill into the entries that look relevant.
