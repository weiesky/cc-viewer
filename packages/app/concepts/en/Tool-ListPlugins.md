# ListPlugins

Lists the user's enabled claude.ai plugins, optionally filtered by keyword.

## When to Use

- You need to know which plugins are already enabled — for example, to confirm what was installed after a `SuggestPluginInstall` card.
- The user asks what plugins they have.

## Activation

- Requires plugin registry access permission.
- Availability depends on session type and feature rollout — disabled in HIPAA environments, always available in remote sessions.

## Parameters

- `keywords` (array of strings, optional): Filter the list — up to 8 items, each 1–64 characters. Omit to list everything.

## Examples

### Example 1: List enabled plugins

```
ListPlugins()
```

### Example 2: Filter by keyword

```
ListPlugins(keywords=["figma"])
```

## Notes

- If the plugin catalog is unreachable (forbidden), the tool degrades to an empty list with a warning rather than failing.
