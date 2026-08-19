# ReadMcpResource

Reads a single resource exposed by a connected MCP (Model Context Protocol) server, addressed by its URI.

## When to Use

- An MCP server advertises a resource (file, record, document) whose content you need in context.
- You have a concrete resource URI — from `ListMcpResources`, from the server's documentation, or from a previous tool result.

## Activation

- Always enabled, but not exposed to the model's tool list — intended for thin-client / sidecar use.

## Parameters

- `server` (string, required): The MCP server name.
- `uri` (string, required): The resource URI to read.

## Examples

### Example 1: Read a server resource by URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Returns the resource content as provided by the `github` MCP server.

## Notes

- Use `ListMcpResources` first if you don't know which resources a server exposes; use `ReadMcpResourceDir` for directory-style listings.
- The URI scheme is server-specific (`file://`, `https://`, custom schemes) — check what the target server advertises.
