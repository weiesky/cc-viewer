# ListMcpResources

Lists the resources exposed by connected MCP servers, optionally filtered to one server.

## When to Use

- You need to discover what resources (files, records, documents) an MCP server offers before reading them.
- You want an overview of all resources across every connected server.

## Activation

- Always enabled, but not exposed to the model's tool list — intended for thin-client / sidecar use.

## Parameters

- `server` (string, optional): Server name to filter resources by. Omit to list resources from all connected servers.

## Examples

### Example 1: List everything

```
ListMcpResources()
```

### Example 2: List one server's resources

```
ListMcpResources(server="github")
```

## Notes

- This is the discovery step: feed interesting URIs into `ReadMcpResource` (single resource) or `ReadMcpResourceDir` (directory listings).
- Servers connect and disconnect over the session lifetime; re-list if a server was just added.
